import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseManabiImport, planManabiImport, applyManabiImport, normalizeInformationInbox, mergeInformationInboxes } from '../app/manabi-import-model.ts';
import { createBackupFile, inspectBackupFile } from '../app/backup.ts';
import { mergeImportedState } from '../app/data-migration-model.ts';
import { normalizeCampusState } from '../app/campus-model.ts';
import { decideSyncPlan, fingerprintState } from '../app/sync-model.ts';

const item = (patch = {}) => ({ id: 'guidance-2026', type: 'event', title: 'ゼミガイダンス', source: { kind: 'pdf', title: '架空大学ゼミ案内' }, data: { starts_at: '2026-11-06T14:20:00+09:00', location: '講堂' }, ...patch });
const bundle = (items = [item()]) => ({ schema_version: '1.0', collection: 'example-university-2026', items });
const parse = (value) => parseManabiImport(JSON.stringify(value));
const empty = () => normalizeInformationInbox(undefined);
const commit = (inbox, pack, selected = pack.items.map(entry => entry.id), reviewed = selected) => applyManabiImport(inbox, pack, selected, reviewed, JSON.stringify(inbox));

test('Schema validates all examples and preserves explicitly unknown dates', async () => {
  for (const name of ['seminar', 'all-types']) {
    const raw = await readFile(new URL(`../examples/manabi-import-${name}.json`, import.meta.url), 'utf8');
    assert.ok(parseManabiImport(raw).items.length > 0);
  }
  assert.equal(parse(bundle([item({ data: { starts_at: null } })])).items[0].data.starts_at, null);
});

test('rejects malformed JSON, unsupported versions/types/fields and wrong values', () => {
  assert.throws(() => parseManabiImport('```json\n{}\n```'));
  for (const value of [
    { ...bundle(), schema_version: '2.0' }, { ...bundle(), extra: true }, bundle([]),
    bundle([item({ type: 'unknown' })]), bundle([item({ data: { due_at: '2026-11-06' } })]),
    bundle([item({ title: '  ' })]), bundle([item({ source: { kind: 'pdf', title: '資料', url: 'javascript:alert(1)' } })]),
    bundle([item({ data: { starts_at: '2026-02-30' } })]), bundle([item({ data: { starts_at: '2026-11-06T14:20:00' } })]),
    bundle([item({ data: { starts_at: '2026-11-07', ends_at: '2026-11-06' } })]),
    bundle([item(), item()]), bundle(Array.from({ length: 201 }, (_, index) => item({ id: `${index}` }))),
    bundle([item({ summary: 'あ'.repeat(400000) })]),
  ]) assert.throws(() => parse(value));
  assert.doesNotThrow(() => parse(bundle([item({ data: { starts_at: '2026-11-06' } })])));
});

test('preview is pure, repeat import is duplicate, changed date is explicit update with history', () => {
  const before = empty(), pack = parse(bundle());
  assert.equal(planManabiImport(before, pack)[0].kind, 'add');
  assert.equal(before.records.length, 0);
  const saved = commit(before, pack);
  assert.equal(saved.records[0].status, 'unread');
  assert.equal(planManabiImport(saved, pack)[0].kind, 'same');
  assert.deepEqual(commit(saved, pack), saved);
  const changed = parse(bundle([item({ data: { starts_at: '2026-11-08', location: '新会場' } })]));
  assert.equal(planManabiImport(saved, changed)[0].kind, 'update');
  assert.deepEqual(commit(saved, changed, []), saved);
  const next = commit(saved, changed);
  assert.equal(next.records[0].id, saved.records[0].id);
  assert.equal(next.records[0].history[0].item.data.location, '講堂');
  assert.equal(saved.records[0].history.length, 0);
});

test('unknown information and same-title different IDs require explicit review', () => {
  const pack = parse(bundle([item({ data: {} })]));
  assert.ok(planManabiImport(empty(), pack)[0].warnings.length);
  assert.throws(() => commit(empty(), pack, [pack.items[0].id], []));
  assert.equal(commit(empty(), pack).records.length, 1);
  const saved = commit(empty(), parse(bundle()));
  const other = parse(bundle([item({ id: 'other-guidance' })]));
  assert.ok(planManabiImport(saved, other)[0].warnings.some(message => message.includes('同じタイトル')));
  assert.equal(commit(saved, other).records.length, 2);
});

test('commit rejects stale preview and revalidates even direct calls', () => {
  const before = empty(), pack = parse(bundle()), baseline = JSON.stringify(before);
  const saved = commit(before, pack);
  assert.throws(() => applyManabiImport(saved, pack, [pack.items[0].id], [], baseline));
  assert.throws(() => commit(before, bundle([item({ type: 'invalid' })])));
  assert.throws(() => commit(before, pack, ['unknown']));
});

test('renaming an existing item to another item title also requires duplicate review', () => {
  const first = parse(bundle([item({ id: 'first', title: '最初の予定' }), item({ id: 'second', title: '別の予定' })]));
  const saved = commit(empty(), first);
  const changed = parse(bundle([item({ id: 'first', title: '別の予定' })]));
  const row = planManabiImport(saved, changed)[0];
  assert.equal(row.kind, 'update');
  assert.ok(row.warnings.some(warning => warning.includes('同じタイトル')));
  assert.throws(() => commit(saved, changed, ['first'], []));
  assert.equal(commit(saved, changed).records.length, 2);
});

test('normalization and merge preserve records/history/read status and reject corruption', () => {
  assert.deepEqual(empty(), { version: 1, records: [] });
  const saved = commit(empty(), parse(bundle()));
  saved.records[0].status = 'read';
  assert.deepEqual(normalizeInformationInbox(JSON.parse(JSON.stringify(saved))), saved);
  assert.throws(() => normalizeInformationInbox({ version: 2, records: [] }));
  assert.throws(() => normalizeInformationInbox({ version: 1, records: [{ item: {} }] }));
  assert.deepEqual(mergeInformationInboxes(saved, saved), saved);
  const changed = commit(saved, parse(bundle([item({ summary: '変更通知' })])));
  const merged = mergeInformationInboxes(saved, changed);
  assert.equal(merged.records.length, 2);
  assert.equal(merged.records[0].status, 'read');
  assert.notEqual(merged.records[0].id, merged.records[1].id);
  assert.equal(planManabiImport(merged, parse(bundle()))[0].kind, 'blocked');
});

test('Inbox survives full backup/restore and merging old notebook backups', async () => {
  const inbox = commit(empty(), parse(bundle()));
  const state = { courses: [], sessions: [], memos: [], globalTags: [], courseTags: {}, courseTemplates: {}, terms: ['2026'], activeTerm: '2026', tutorialSeen: true, campus: normalizeCampusState(undefined), displayPreferences: {}, inbox };
  const blob = await createBackupFile(state, []);
  const restored = await inspectBackupFile(new File([blob], 'sample.manabimemo'));
  assert.deepEqual(normalizeInformationInbox(restored.manifest.state.inbox), inbox);
  const oldState = { ...state };
  delete oldState.inbox;
  assert.deepEqual(mergeImportedState(state, oldState, []).state.inbox, inbox);
  assert.deepEqual(mergeImportedState(oldState, state, []).state.inbox, inbox);
  assert.deepEqual(mergeImportedState(state, state, []).state.inbox, inbox);
});

test('Inbox-only state is meaningful for first sync and changed read status changes fingerprint', () => {
  const inbox = commit(empty(), parse(bundle()));
  const first = fingerprintState({ inbox });
  const plan = decideSyncPlan({ localHasData: inbox.records.length > 0, cloudExists: true, localFingerprint: first, cloudFingerprint: 'remote-other', cloudRevision: 1, meta: null });
  assert.equal(plan, 'choice');
  inbox.records[0].status = 'read';
  assert.notEqual(fingerprintState({ inbox }), first);
});

test('stable comparison ignores object property order and separates information collections', () => {
  const saved = commit(empty(), parse(bundle()));
  const reordered = parse(bundle([{ data: { location: '講堂', starts_at: '2026-11-06T14:20:00+09:00' }, ...item(), source: { title: '架空大学ゼミ案内', kind: 'pdf' } }]));
  assert.equal(planManabiImport(saved, reordered)[0].kind, 'same');
  const otherCollection = parse({ ...bundle(), collection: 'other-university-2026' });
  assert.equal(planManabiImport(saved, otherCollection)[0].kind, 'add');
  assert.equal(commit(saved, otherCollection).records.length, 2);
});
