import assert from 'node:assert/strict';
import test from 'node:test';
import { registrationEntries, displayImportValue } from '../app/import-registration-model.ts';
import { parseManabiImport, normalizeInformationInbox, planManabiImport, applyManabiImport } from '../app/manabi-import-model.ts';
import { planInboxCourses, applyInboxCourses, ensureCourseNotes } from '../app/inbox-course-model.ts';
import { timetableCatalogCandidates } from '../app/timetable-catalog-model.ts';
import { informationWarnings } from '../app/manabi-import-model.ts';

const bundle = parseManabiImport(JSON.stringify({ schema_version: '1.0', collection: 'example-timetable', items: Array.from({ length: 5 }, (_, index) => ({ id: `course-${index}`, type: 'course', title: `架空講義${index}`, source: { kind: 'screenshot', title: '架空時間割' }, term: '2026年度 後期', needs_review: index < 4, uncertainties: index < 4 ? ['科目コード未確認'] : [], data: { term: '2026年度 後期', weekday: index < 3 ? 4 : 5, period: [1, 2, 3, 1, 3][index], instructor: '架空教員', room: '301', credits: 2 } })) }));
test('情報5件が保存済みでも、再保存せず講義5件とノートを確認登録できる', () => {
  const empty = normalizeInformationInbox(undefined);
  const inbox = applyManabiImport(empty, bundle, bundle.items.map(item => item.id), bundle.items.map(item => item.id), JSON.stringify(empty));
  const rows = planManabiImport(inbox, bundle);
  assert.ok(rows.every(row => row.kind === 'same'));
  const entries = registrationEntries(rows, bundle.collection, []);
  assert.equal(entries.length, 5);
  const planned = planInboxCourses([], entries);
  assert.ok(planned.every(row => row.kind === 'add'));
  const courses = applyInboxCourses([], planned, planned.map(row => row.key), '[]');
  const sessions = ensureCourseNotes(courses, [], course => ({ courseId: course.id, noteText: '' }));
  assert.equal(sessions.length, 5);
  assert.equal(courses[0].weekday, 4); assert.equal(courses[0].period, 1);
  assert.equal(timetableCatalogCandidates(inbox, '2026年度 後期', 4, 1).length, 1);
  assert.equal(planInboxCourses(courses, entries).filter(row => row.kind === 'add').length, 0);
  assert.deepEqual(applyManabiImport(inbox, bundle, [], [], JSON.stringify(inbox)), inbox);
});
test('未選択の新規・更新・適用不可項目は講義登録に混ぜない', () => {
  const rows = ['add', 'update', 'same', 'blocked'].map((kind, index) => ({ kind, item: bundle.items[index] }));
  assert.deepEqual(registrationEntries(rows, 'sample', []).map(entry => entry.item.id), ['course-2']);
  assert.deepEqual(registrationEntries(rows, 'sample', ['course-0', 'course-1', 'course-3']).map(entry => entry.item.id), ['course-0', 'course-1', 'course-2']);
});
test('曜日の整数を日本語で表示し、授業枠の時間帯と不明値を区別する', () => {
  assert.equal(displayImportValue(4, 'weekday'), '木曜日（4）');
  assert.equal(displayImportValue(5, 'weekday'), '金曜日（5）');
  assert.match(displayImportValue(3, 'period'), /3枠.*12:40.*14:10/);
  assert.equal(displayImportValue(null, 'weekday'), '未確認');
  assert.equal(displayImportValue(2, 'credits'), '2');
});
test('トップレベルで確認済みの学期を未確認と誤表示しない', () => {
  const item = structuredClone(bundle.items[4]);
  delete item.data.term;
  assert.equal(informationWarnings(item).some(value => value.includes('年度・学期')), false);
});
