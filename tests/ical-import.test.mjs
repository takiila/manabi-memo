import assert from 'node:assert/strict';
import test from 'node:test';
import { parseICalendar } from '../app/ical-import-model.ts';
import { applyManabiImport, planManabiImport } from '../app/manabi-import-model.ts';
import { normalizeCampusState } from '../app/campus-model.ts';
import { calendarEntries } from '../app/planner-model.ts';

const event = (extra = '') => `BEGIN:VEVENT\nUID:example-1@example.test\nSUMMARY:演習の提出期限\nDTSTART:20261026T145900Z\nDTEND:20261026T145900Z\nCATEGORIES:TEST1001\n${extra}\nEND:VEVENT`;
const calendar = (events = event(), props = '') => `BEGIN:VCALENDAR\nVERSION:2.0\nMETHOD:PUBLISH\n${props}\n${events}\nEND:VCALENDAR\n`;
const empty = () => ({ version: 1, records: [] });
const commit = (inbox, bundle) => applyManabiImport(inbox, bundle, bundle.items.map(i => i.id), bundle.items.map(i => i.id), JSON.stringify(inbox));

test('LMSの折り返し・エスケープ・UTCを保持し、開始案内と提出期限を区別する', async () => {
  const raw = calendar(event('DESCRIPTION:メモ\\n次の行\\,続き\\;記号\\\\\n\t末尾') + '\n' + event().replace('example-1', 'example-2').replace('演習の提出期限', '小テストの受験可能期間の開始')).replaceAll('\n', '\r\n');
  const pack = await parseICalendar(raw);
  assert.equal(pack.items.length, 2);
  const [assignment, start] = pack.items;
  assert.equal(assignment.type, 'assignment');
  assert.equal(assignment.data.due_at, '2026-10-26T14:59:00Z');
  assert.equal(assignment.data.course_code, 'TEST1001');
  assert.equal(assignment.summary, 'メモ\n次の行,続き;記号\\末尾');
  assert.equal(start.type, 'event');
  assert.equal(start.data.starts_at, start.data.ends_at);
  assert.ok(pack.items.every(i => i.needs_review));
});

test('UIDで再取り込みを照合し、書き出し時刻に依存せず締切変更の履歴を残す', async () => {
  const pack = await parseICalendar(calendar(event('DTSTAMP:20261025T000000Z')));
  const saved = commit(empty(), pack);
  assert.equal(planManabiImport(saved, await parseICalendar(calendar(event('DTSTAMP:20261026T000000Z'))))[0].kind, 'same');
  const update = await parseICalendar(calendar(event().replaceAll('20261026T145900Z', '20261027T145900Z')));
  assert.equal(planManabiImport(saved, update)[0].kind, 'update');
  const next = commit(saved, update);
  assert.equal(next.records.length, 1);
  assert.equal(next.records[0].id, saved.records[0].id);
  assert.equal(next.records[0].history[0].item.data.due_at, '2026-10-26T14:59:00Z');
  assert.equal(saved.records[0].history.length, 0);
  assert.equal(planManabiImport(saved, await parseICalendar(calendar(event().replace('演習の提出期限', '演習の開始'))))[0].kind, 'blocked');
});

test('確認とbaselineを省略できず、カレンダーには課題の実時刻を反映する', async () => {
  const pack = await parseICalendar(calendar());
  assert.throws(() => applyManabiImport(empty(), pack, [pack.items[0].id], [], JSON.stringify(empty())), /確認/);
  const inbox = commit(empty(), pack);
  assert.throws(() => applyManabiImport(inbox, pack, [pack.items[0].id], [pack.items[0].id], JSON.stringify(empty())));
  const entries = calendarEntries({ courses: [], sessions: [], memos: [], campus: normalizeCampusState(), planner: { version: 1, todos: [], events: [] }, inbox }, '2026-10', 'all');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].at, '2026-10-26T14:59:00Z');
});

test('日付のみは時刻を作らず、終日DTENDの排他的な境界を変換する', async () => {
  const pack = await parseICalendar(calendar(event().replace('演習の提出期限', '終日予定').replace('DTSTART:20261026T145900Z', 'DTSTART;VALUE=DATE:20261026').replace('DTEND:20261026T145900Z', 'DTEND;VALUE=DATE:20261028')));
  assert.deepEqual(pack.items[0].data, { starts_at: '2026-10-26', ends_at: '2026-10-27' });
  const tokyo = await parseICalendar(calendar(event().replaceAll(':20261026T145900Z', ';TZID=Asia/Tokyo:20261026T235900')));
  assert.equal(tokyo.items[0].data.due_at, '2026-10-26T23:59:00+09:00');
});

test('繰り返し・取り消し・未知の時差等は一部だけを保存せず全体を停止する', async () => {
  for (const extra of ['RRULE:FREQ=WEEKLY', 'RDATE:20261102T145900Z', 'EXDATE:20261026T145900Z', 'RECURRENCE-ID:20261026T145900Z', 'DURATION:PT1H', 'STATUS:CANCELLED', 'BEGIN:VALARM\nEND:VALARM']) await assert.rejects(parseICalendar(calendar(event(extra))));
  for (const raw of [
    calendar().replace('METHOD:PUBLISH', 'METHOD:CANCEL'), calendar(event(), 'BEGIN:VTIMEZONE\nEND:VTIMEZONE'),
    calendar().replaceAll('20261026T145900Z', '20261026T145900'), calendar().replace('DTSTART:', 'DTSTART;TZID=Unknown/Zone:'),
    calendar().replaceAll('20261026T145900Z', '20260230T145900Z'), calendar().replaceAll('20261026T145900Z', '20261026T245900Z'),
    calendar().replace('DTEND:20261026T145900Z', 'DTEND:20261025T145900Z'),
    calendar().replace('DTEND:20261026T145900Z', 'DTEND:20261027T145900Z'),
    calendar(event('UID:second')), calendar(event() + '\n' + event()), calendar().replace('END:VEVENT', ''), calendar().replace('VERSION:2.0', 'VERSION:1.0'),
    calendar(event('URL:javascript:alert(1)')), calendar(event('URL:https://user:secret@example.com/')),
    calendar(Array.from({ length: 201 }, (_, i) => event().replace('example-1', `example-${i}`)).join('\n')), 'x'.repeat(1024 * 1024 + 1),
  ]) await assert.rejects(parseICalendar(raw));
});

test('再エクスポートで欠けた予定は消さず、LMS本文を文字列として保持する', async () => {
  const both = await parseICalendar(calendar(event('DESCRIPTION:<script>alert(1)</script>') + '\n' + event().replace('example-1', 'example-2')));
  const saved = commit(empty(), both);
  const next = commit(saved, await parseICalendar(calendar()));
  assert.equal(next.records.length, 2);
  assert.equal(saved.records[0].item.summary, '<script>alert(1)</script>');
});
