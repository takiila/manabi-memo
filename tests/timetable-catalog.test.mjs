import assert from 'node:assert/strict';
import test from 'node:test';
import { timetableCatalogCandidates, planTimetableCandidate } from '../app/timetable-catalog-model.ts';
import { applyManabiImport, normalizeInformationInbox, parseManabiImport } from '../app/manabi-import-model.ts';
import { applyInboxCourses, ensureCourseNotes } from '../app/inbox-course-model.ts';

function catalog() {
  const bundle = parseManabiImport(JSON.stringify({ schema_version: '1.0', collection: 'test', items: [
    ['wed', '2026年度後学期', 3, 1], ['fri', '2026年度 後期', 5, 1], ['old', '2025年度 後期', 3, 1], ['unknown', '2026年度 後期', null, null],
  ].map(([id, term, weekday, period]) => ({ id, type: 'course', title: id, source: { kind: 'syllabus', title: '公式' }, data: { term, weekday, period, code: id, instructor: '教員', room: '301', credits: 2 } })) }));
  const empty = normalizeInformationInbox();
  return applyManabiImport(empty, bundle, bundle.items.map(item => item.id), bundle.items.map(item => item.id), JSON.stringify(empty));
}
test('時間割の年度学期・曜日・枠に一致する候補だけを表示する', () => {
  const inbox = catalog();
  assert.deepEqual(timetableCatalogCandidates(inbox, '2026年度 後期', 3, 1).map(record => record.item.id), ['wed']);
  assert.equal(timetableCatalogCandidates(inbox, '2026年度 後期', null, null).length, 3);
  assert.throws(() => timetableCatalogCandidates(inbox, '2026年度 後期', 3, null));
});
test('選択後も枠を検証し、情報・ノートを保持して一度だけ登録する', () => {
  const inbox = catalog(), record = inbox.records.find(record => record.item.id === 'wed');
  const row = planTimetableCandidate([], inbox, record.id, '2026年度 後期', 3, 1);
  const courses = applyInboxCourses([], [row], [row.key], '[]');
  assert.equal(courses[0].instructor, '教員'); assert.equal(courses[0].room, '301'); assert.equal(courses[0].credits, 2);
  const sessions = ensureCourseNotes(courses, [], course => ({ courseId: course.id, noteText: '本文' }));
  const again = planTimetableCandidate(courses, inbox, record.id, '2026年度 後期', 3, 1);
  assert.equal(again.kind, 'same');
  assert.equal(ensureCourseNotes(courses, sessions, () => assert.fail()).length, 1);
  assert.throws(() => planTimetableCandidate([], inbox, record.id, '2026年度 後期', 5, 1));
  assert.throws(() => planTimetableCandidate([], inbox, 'missing', '2026年度 後期', 3, 1));
  const occupied = [{ ...courses[0], id: 'different', code: 'different', title: '既存' }];
  assert.ok(planTimetableCandidate(occupied, inbox, record.id, '2026年度 後期', 3, 1).warnings.some(value => value.includes('重な')));
  assert.equal(occupied[0].weekday, 3);
});
