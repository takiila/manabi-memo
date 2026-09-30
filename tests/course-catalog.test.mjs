import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCatalogProfile, filterCatalogRecords, planCatalogSelection, createCatalogPrompt } from '../app/course-catalog-model.ts';
import { normalizeInformationInbox, applyManabiImport, parseManabiImport, mergeInformationInboxes } from '../app/manabi-import-model.ts';
import { applyInboxCourses, ensureCourseNotes } from '../app/inbox-course-model.ts';
import { referencesForSync } from '../app/reference-sync-model.ts';
import { createBackupFile, inspectBackupFile } from '../app/backup.ts';
import { readFile } from 'node:fs/promises';

const profile = { university: '架空大学', faculty: '情報学部', academicYear: 2026, semester: '後期', syllabusUrl: 'https://example.com/syllabus' };
const item = (id, weekday, period, term = '2026年度 後期') => ({ id, type: 'course', title: `授業${id}`, source: { kind: 'syllabus', title: '公式シラバス' }, data: { code: id, term, weekday, period, instructor: '教員', credits: 2 } });
function catalog() {
  const bundle = parseManabiImport(JSON.stringify({ schema_version: '1.0', collection: 'sample-2026', items: [item('A', 1, 2), item('B', 1, 2), item('C', null, null), item('D', 4, 3, '2026年度 前期')] }));
  const empty = normalizeInformationInbox(undefined);
  return applyManabiImport(empty, bundle, bundle.items.map(entry => entry.id), bundle.items.map(entry => entry.id), JSON.stringify(empty));
}

test('大学設定が旧Inbox・バックアップ結合・参照同期で失われず、不正値は拒否する', () => {
  const inbox = { ...catalog(), catalogProfile: profile };
  assert.deepEqual(normalizeInformationInbox(inbox).catalogProfile, profile);
  assert.deepEqual(normalizeInformationInbox({ version: 1, records: [] }), { version: 1, records: [] });
  assert.deepEqual(mergeInformationInboxes(undefined, inbox).catalogProfile, profile);
  assert.equal(mergeInformationInboxes({ ...inbox, catalogProfile: { ...profile, university: '別大学' } }, inbox).catalogProfile.university, '別大学');
  assert.deepEqual(referencesForSync({ inbox }).inbox.catalogProfile, profile);
  for (const patch of [{ academicYear: 0 }, { semester: '不明' }, { syllabusUrl: 'javascript:alert(1)' }, { syllabusUrl: 'https://user:pass@example.com' }, { university: '' }]) assert.throws(() => normalizeCatalogProfile({ ...profile, ...patch }));
});

test('カタログは曜日・枠・年度学期・検索で絞れ、不明科目も残る', () => {
  const inbox = catalog();
  assert.equal(filterCatalogRecords(inbox, { term: '2026年度 後期', weekday: '1', period: '2' }).length, 2);
  assert.equal(filterCatalogRecords(inbox, { weekday: 'unknown' })[0].item.id, 'C');
  assert.equal(filterCatalogRecords(inbox, { query: '授業B' })[0].item.id, 'B');
  assert.equal(filterCatalogRecords(inbox, { collection: 'other' }).length, 0);
  assert.equal(inbox.records.length, 4);
});

test('未選択では講義・ノートを作らず、選んだ候補だけ登録する', () => {
  const inbox = catalog();
  assert.deepEqual(planCatalogSelection([], inbox, [], {}), []);
  const chosen = inbox.records.filter(record => record.item.id === 'B');
  const rows = planCatalogSelection([], inbox, chosen.map(record => record.id), {});
  const courses = applyInboxCourses([], rows, rows.map(row => row.key), '[]');
  const sessions = ensureCourseNotes(courses, [], course => ({ courseId: course.id, noteText: '' }));
  assert.equal(courses.length, 1);
  assert.equal(courses[0].code, 'B');
  assert.equal(sessions.length, 1);
  assert.equal(rows[0].warnings.some(warning => warning.includes('重な')), false);
  assert.equal(inbox.records.length, 4);
  assert.throws(() => planCatalogSelection([], inbox, ['missing-id'], {}), /選択/);
});

test('同枠の候補を複数選んだ時だけ競合を表示し、原情報を変更しない', () => {
  const inbox = catalog(), baseline = JSON.stringify(inbox);
  const rows = planCatalogSelection([], inbox, inbox.records.filter(record => ['A', 'B'].includes(record.item.id)).map(record => record.id), {});
  assert.equal(rows.every(row => row.warnings.some(warning => warning.includes('重な'))), true);
  assert.equal(JSON.stringify(inbox), baseline);
});

test('AI依頼文は大学・年度・公式検索・分割・未確認範囲を指定し、JSON契約を維持する', () => {
  const prompt = createCatalogPrompt(profile);
  for (const value of ['架空大学', '情報学部', '2026', '後期', 'https://example.com/syllabus', '200', 'weekday', 'period', 'シラバス', '未確認', 'collection']) assert.ok(prompt.includes(value));
  const schema = JSON.parse(prompt.split('JSON Schema:\n')[1]);
  assert.equal(schema.properties.schema_version.const, '1.0');
});

test('大学設定だけの端末も同期時に空と扱わず、完全バックアップで往復する', async () => {
  const inbox = { version: 1, records: [], catalogProfile: profile };
  const file = await createBackupFile({ inbox }, []);
  const restored = await inspectBackupFile(new File([file], 'catalog.manabimemo'));
  assert.deepEqual(normalizeInformationInbox(restored.manifest.state.inbox), inbox);
  const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /\|\| state\.inbox\?\.catalogProfile/);
});

test('反映学期を変えたら更新承認を解除し、保存設定が変わったら古いフォームを破棄する', async () => {
  const component = await readFile(new URL('../app/course-catalog.tsx', import.meta.url), 'utf8');
  assert.match(component, /onTerm=\{[^\n]+setApproved\(current => current\.filter\(value => value !== key\)\)/);
  const inbox = await readFile(new URL('../app/university-inbox.tsx', import.meta.url), 'utf8');
  assert.match(inbox, /<CourseCatalog key=\{JSON\.stringify\(inbox\.catalogProfile \?\? null\)\}/);
  assert.equal((inbox.match(/onTerm=\{[^\n]+setCourseSelected\(current => current\.filter\(value => value !== key\)\)/g) ?? []).length, 2);
});
