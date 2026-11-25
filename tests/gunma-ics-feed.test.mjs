import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { register } from 'node:module';
import { Readable } from 'node:stream';
import test from 'node:test';

const testResolver = `export function resolve(specifier, context, next) {
  return next(specifier === 'server-only' ? 'next/dist/compiled/server-only/empty.js' : specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(testResolver)}`, import.meta.url);
const { readGunmaIcsFeed } = await import('../lib/gunma-ics-feed.ts');

const token = '1'.repeat(40);
const link = new URL('https://mdl.media.gunma-u.ac.jp/calendar/export_execute.php');
link.search = new URLSearchParams({ userid: '42', authtoken: token, preset_what: 'courses', preset_time: 'recentupcoming' });
const scope = { events: 'courses', period: 'recentupcoming' };
const empty = 'BEGIN:VCALENDAR\nVERSION:2.0\nMETHOD:PUBLISH\nEND:VCALENDAR';
const calendar = empty.replace('END:VCALENDAR', 'BEGIN:VEVENT\nUID:mock@example.test\nDTSTART:20261127T000000Z\nSUMMARY:模擬課題の提出期限\nEND:VEVENT\nEND:VCALENDAR');
const fixture = (parts, statusCode = 200, headers = {}) => Object.assign(Readable.from(parts.map(part => Buffer.from(part))), {
  statusCode, headers: { 'content-type': 'text/calendar; charset=utf-8', ...headers },
});
const reply = stream => (url, options, receive) => {
  assert.equal(url.href, link.href);
  assert.equal(options.method, 'GET');
  assert.equal(options.headers.Cookie, undefined);
  assert.equal(options.headers.Authorization, undefined);
  queueMicrotask(() => receive(stream));
  return new EventEmitter();
};

test('existing Moodle subscription returns only scope and normalized Inbox candidate', async () => {
  const result = await readGunmaIcsFeed(link.href, { request: reply(fixture([calendar])) });
  assert.equal(result.status, 'received');
  assert.deepEqual(result.scope, scope);
  assert.equal(result.bundle.items[0].type, 'assignment');
  assert.doesNotMatch(JSON.stringify(result), /authtoken|userid|mdl\.media/);
});

test('valid empty scope is distinct from login, malformed body, and HTTP failures', async () => {
  assert.deepEqual(await readGunmaIcsFeed(link.href, { request: reply(fixture([empty])) }), { status: 'empty', scope });
  for (const [body, status, headers, reason] of [
    ['<html>login</html>', 200, { 'content-type': 'text/html' }, 'unexpected-response'],
    ['Invalid authentication', 200, {}, 'invalid-calendar'],
    ['', 302, { location: 'https://example.test' }, 'redirect'],
    ['', 403, {}, 'access-denied'],
    ['', 429, {}, 'rate-limited'],
    ['', 500, {}, 'http-error'],
    [calendar, 206, {}, 'http-error'],
  ]) {
    assert.deepEqual(await readGunmaIcsFeed(link.href, { request: reply(fixture([body], status, headers)) }), { status: 'failed', reason, scope });
  }
});

test('refuses URLs outside the documented export operation before sending a request', async () => {
  const cases = [
    link.href.replace('https:', 'http:'), link.href.replace('mdl.media', 'evil.media'),
    link.href.replace('/calendar/export_execute.php', '/mod/quiz/startattempt.php'),
    link.href.replace('.ac.jp/', '.ac.jp:8443/'), link.href.replace('https://', 'https://somebody@'),
    link.href + '&generateurl=1', link.href + '&userid=43', link.href + '#secret',
    link.href.replace('preset_what=courses', 'preset_what=everything'),
    link.href.replace('userid=42', 'username=legacy'), link.href.replace(token, 'invalid'),
  ];
  for (const url of cases) {
    let called = false;
    const result = await readGunmaIcsFeed(url, { request() { called = true; throw new Error(token); } });
    assert.deepEqual(result, { status: 'failed', reason: 'invalid-config' });
    assert.equal(called, false);
  }
});

test('bounded payload and transport errors cannot expose feed credentials', async () => {
  for (const [stream, reason] of [
    [fixture([calendar], 200, { 'content-length': '1048577' }), 'too-large'],
    [fixture(['x'.repeat(1024 * 1024), 'x']), 'too-large'],
    [fixture([calendar.replace('模擬課題', token.slice(0, 20) + '\n ' + token.slice(20))]), 'invalid-calendar'],
    [fixture([calendar.replace('END:VEVENT', 'URL:https://example.test/activity?sesskey=mock\nEND:VEVENT')]), 'invalid-calendar'],
    [fixture([Buffer.from([0xff])]), 'invalid-calendar'],
  ]) {
    const result = await readGunmaIcsFeed(link.href, { request: reply(stream) });
    assert.deepEqual(result, { status: 'failed', reason, scope });
    assert.equal(stream.destroyed, true);
  }
  assert.deepEqual(await readGunmaIcsFeed(link.href, { request() { throw new Error(link.href); } }), { status: 'failed', reason: 'network', scope });
});

test('request deadline propagates to the HTTPS request without leaking provider errors', async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const result = await readGunmaIcsFeed(link.href, { timeoutMs: 5, request(_url, { signal }) {
      const request = new EventEmitter();
      signal.addEventListener('abort', () => request.emit('error', new Error(link.href)), { once: true });
      return request;
    } });
    assert.deepEqual(result, { status: 'failed', reason: 'timeout', scope });
  } finally {
    clearTimeout(keepAlive);
  }
});
