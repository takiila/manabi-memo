import assert from 'node:assert/strict';
import test from 'node:test';
import { planInboxCourses, applyInboxCourses, courseEntryKey, ensureCourseNotes } from '../app/inbox-course-model.ts';

const entry = (data = {}, id = 'cs1') => ({ collection: 'uni-2026', item: { id, type: 'course', title: '情報学', source: { kind: 'syllabus', title: '公式資料' }, data } });
const apply = (courses, entries, terms = {}, selected) => {
  const rows = planInboxCourses(courses, entries, terms);
  return applyInboxCourses(courses, rows, selected ?? rows.filter(row => row.kind === 'add').map(row => row.key), JSON.stringify(courses));
};

test('JSON講義が時間割の講義になり、同じ入力を再反映しても重複しない', () => {
  const input = entry({ code: 'CS101', term: '2026年度後学期', weekday: 2, period: 3, room: '101' });
  const next = apply([], [input]);
  assert.equal(next[0].term, '2026年度 後期');
  assert.equal(next[0].weekday, 2);
  assert.equal(next[0].period, 3);
  assert.deepEqual(apply(next, [input]), next);
});

test('科目コード・曜日不明でも出典IDで一意に登録し、年度不明は手動確認する', () => {
  const input = entry({ term: '2年次後期' });
  assert.equal(planInboxCourses([], [input])[0].kind, 'blocked');
  const next = apply([], [input], { [courseEntryKey(input)]: '2026年度 後期' });
  assert.equal(next[0].weekday, null);
  assert.equal(next[0].period, null);
  assert.equal(next[0].code, undefined);
  assert.equal(planInboxCourses(next, [input], { [courseEntryKey(input)]: '2026年度 後期' })[0].kind, 'same');
});

test('明示選択した更新だけ反映し、既存ノート・省略情報を消さない', () => {
  const input = entry({ code: 'CS101', term: '2026年度 後期', weekday: 1, period: 2 });
  const original = { ...apply([], [input])[0], notes: '手書きメモ', instructor: '教員', room: '201' };
  const changed = entry({ code: 'CS101', term: '2026年度 後期', weekday: 2, period: 2 });
  const rows = planInboxCourses([original], [changed]);
  assert.equal(rows[0].kind, 'update');
  assert.deepEqual(applyInboxCourses([original], rows, [], JSON.stringify([original])), [original]);
  const result = applyInboxCourses([original], rows, [rows[0].key], JSON.stringify([original]));
  assert.equal(result[0].room, '201');
  assert.equal(result[0].notes, '手書きメモ');
  assert.equal(result[0].instructor, '教員');
  assert.equal(result[0].weekday, 2);
  assert.equal(result[0].id, original.id);
});

test('競合・削除済み・確認後変更で既存データを上書きしない', () => {
  const input = entry({ code: 'CS101', term: '2026年度 後期', weekday: 1, period: 2 });
  const original = apply([], [input]);
  assert.equal(planInboxCourses([{ ...original[0], deletedAt: '2026-01-01' }], [input])[0].kind, 'blocked');
  assert.equal(planInboxCourses([], [input, entry({ ...input.item.data, code: 'CS102' }, 'cs2')])[0].warnings.some(text => text.includes('重な')), true);
  assert.throws(() => applyInboxCourses(original, planInboxCourses([], [input]), [courseEntryKey(input)], '[]'), /変わ/);
  assert.equal(planInboxCourses([], [input, { ...input }])[0].kind, 'blocked');
});

test('講義ノートを一度だけ作成し、既存ノート・PDF・ごみ箱を保持する', () => {
  const courses = apply([], [entry({ term: '2026年度 後期' })]);
  const create = course => ({ id: `note:${course.id}`, courseId: course.id, noteText: '', hasPdf: false });
  const first = ensureCourseNotes(courses, [], create);
  assert.equal(first.length, 1);
  const original = [{ ...first[0], noteText: '残す本文', hasPdf: true, deletedAt: '2026-09-01' }];
  assert.deepEqual(ensureCourseNotes(courses, original, create), original);
});

test('別学期への再利用は前学期の講義・ノート参照を動かさず新規登録する', () => {
  const input = entry({ code: 'CS101', term: '2026年度 前期' });
  const original = apply([], [input]);
  const rows = planInboxCourses(original, [input], { [courseEntryKey(input)]: '2026年度 後期' });
  assert.equal(rows[0].kind, 'add');
  const result = applyInboxCourses(original, rows, [rows[0].key], JSON.stringify(original));
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], original[0]);
  assert.notEqual(result[0].id, result[1].id);
});

test('同名でも異なる科目コードは別講義、年度不明の後期だけは反映不可', () => {
  const first = entry({ code: 'CS101', term: '2026年度 後期' });
  const second = entry({ code: 'CS102', term: '2026年度 後期' }, 'cs2');
  assert.equal(planInboxCourses([], [first, second]).every(row => row.kind === 'add'), true);
  assert.equal(planInboxCourses([], [entry({ term: '後期' })])[0].kind, 'blocked');
  assert.equal(planInboxCourses([], [entry({ term: '2026年度 未確認' })])[0].kind, 'blocked');
  assert.equal(planInboxCourses([], [entry({ term: '2026年度 ?' })])[0].kind, 'blocked');
});

test('別の出典の同一講義は片方を選んで回復でき、両方の登録は拒否する', () => {
  const first = entry({ code: 'CS101', term: '2026年度 後期' });
  const second = { ...first, collection: 'another-source' };
  const rows = planInboxCourses([], [first, second]);
  assert.equal(applyInboxCourses([], rows, [rows[0].key], '[]').length, 1);
  assert.throws(() => applyInboxCourses([], rows, rows.map(row => row.key), '[]'), /重複/);
});
