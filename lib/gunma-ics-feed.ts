import 'server-only';
import type { IncomingMessage } from 'node:http';
import { get } from 'node:https';
import { EmptyICalendarError, parseICalendar } from '../app/ical-import-model.ts';
import { MAX_IMPORT_BYTES } from '../app/manabi-import-model.ts';
import type { ManabiImport } from '../app/manabi-import-types';

const origin = 'https://mdl.media.gunma-u.ac.jp';
const pathname = '/calendar/export_execute.php';
// Moodle calendar/export.php emits these four fields for an existing subscription.
const queryKeys = ['userid', 'authtoken', 'preset_what', 'preset_time'] as const;
const eventScopes = ['all', 'user', 'groups', 'courses', 'categories'] as const;
const periods = ['weeknow', 'weeknext', 'monthnow', 'monthnext', 'recentupcoming', 'custom'] as const;
const credentialQuery = /(?:[?&]|&amp;)(?:authtoken|sesskey|wstoken|access_token)=/i;

export type GunmaIcsScope = {
  events: typeof eventScopes[number];
  period: typeof periods[number];
};

export type GunmaIcsFailure =
  | 'not-configured' | 'invalid-config' | 'redirect' | 'access-denied' | 'rate-limited'
  | 'http-error' | 'unexpected-response' | 'too-large' | 'network' | 'timeout' | 'invalid-calendar';

export type GunmaIcsFeedResult =
  | { status: 'received'; scope: GunmaIcsScope; bundle: ManabiImport }
  | { status: 'empty'; scope: GunmaIcsScope }
  | { status: 'failed'; reason: GunmaIcsFailure; scope?: GunmaIcsScope };

function parseSubscription(value: string) {
  if (value.length > 2048 || !value.startsWith(origin + pathname + '?')) return null;
  try {
    const supplied = new URL(value);
    if (supplied.origin !== origin || supplied.pathname !== pathname || supplied.hash || value.includes('#')) return null;
    if (supplied.searchParams.size !== queryKeys.length || queryKeys.some(key => supplied.searchParams.getAll(key).length !== 1)) return null;
    const [userId, token, events, period] = queryKeys.map(key => supplied.searchParams.get(key)!);
    const eventScope = eventScopes.find(allowed => allowed === events);
    const periodScope = periods.find(allowed => allowed === period);
    if (!/^[1-9][0-9]{0,18}$/.test(userId) || !/^[0-9a-f]{40}$/.test(token) || !eventScope || !periodScope) return null;
    const url = new URL(pathname, origin);
    url.search = new URLSearchParams({ userid: userId, authtoken: token, preset_what: events, preset_time: period }).toString();
    return { url, token, scope: { events: eventScope, period: periodScope } };
  } catch {
    return null;
  }
}

/** Reads only an existing calendar export. Provider errors and response URLs stay private. */
export async function readGunmaIcsFeed(
  subscriptionUrl: string | undefined,
  { request = get, timeoutMs = 15_000 }: { request?: typeof get; timeoutMs?: number } = {},
): Promise<GunmaIcsFeedResult> {
  if (!subscriptionUrl) return { status: 'failed', reason: 'not-configured' };
  const subscription = parseSubscription(subscriptionUrl);
  if (!subscription) return { status: 'failed', reason: 'invalid-config' };
  const { url, token, scope } = subscription;
  const fail = (reason: GunmaIcsFailure): GunmaIcsFeedResult => ({ status: 'failed', reason, scope });
  const signal = AbortSignal.timeout(timeoutMs);
  let response: IncomingMessage | undefined;
  let calendarBytes: Buffer;
  try {
    // Node HTTPS does not follow redirects, persist cookies, or use Next's fetch cache.
    response = await new Promise<IncomingMessage>((resolve, reject) => {
      request(url, {
        method: 'GET', signal, agent: false,
        headers: { Accept: 'text/calendar', 'Accept-Encoding': 'identity' },
      }, resolve).once('error', reject);
    });
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400) return fail('redirect');
    if (status === 401 || status === 403) return fail('access-denied');
    if (status === 429) return fail('rate-limited');
    if (status !== 200) return fail('http-error');
    const contentType = response.headers['content-type']?.split(';')[0].trim().toLowerCase();
    const encoding = response.headers['content-encoding'];
    if (contentType !== 'text/calendar' || (encoding && encoding !== 'identity')) return fail('unexpected-response');
    if (Number(response.headers['content-length']) > MAX_IMPORT_BYTES) return fail('too-large');
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of response) {
      signal.throwIfAborted();
      bytes += chunk.length;
      if (bytes > MAX_IMPORT_BYTES) return fail('too-large');
      chunks.push(chunk);
    }
    calendarBytes = Buffer.concat(chunks, bytes);
  } catch {
    return fail(signal.aborted ? 'timeout' : 'network');
  } finally {
    response?.destroy();
  }

  try {
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(calendarBytes);
    // Treat every calendar field as untrusted, including its optional URL and prose.
    const unfolded = raw.replace(/\r?\n[ \t]/g, '');
    if (unfolded.toLowerCase().includes(token) || credentialQuery.test(unfolded)) return fail('invalid-calendar');
    const bundle = await parseICalendar(raw);
    const stored = JSON.stringify(bundle);
    if (stored.toLowerCase().includes(token) || credentialQuery.test(stored)) return fail('invalid-calendar');
    return { status: 'received', scope, bundle };
  } catch (error) {
    return error instanceof EmptyICalendarError ? { status: 'empty', scope } : fail('invalid-calendar');
  }
}
