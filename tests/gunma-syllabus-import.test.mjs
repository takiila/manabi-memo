import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGunmaSyllabusDetail } from '../app/gunma-syllabus-import.ts';
import { planInboxCourses } from '../app/inbox-course-model.ts';
import { applyManabiImport, planManabiImport } from '../app/manabi-import-model.ts';

const key = { academicYear: 2026, courseCode: 'TEST001' };
const url = 'https://www.kyomu-sys.gunma-u.ac.jp/portal/Public/Syllabus/DetailMain.aspx?je_cd=1&lct_cd=TEST001&lct_year=2026';
const detail = {
  university: '群馬大学', adapter: 'gunma', year: 2026, course_code: 'TEST001',
  title: '架空の演習', semester: '後学期', instructors: '架空 教員', credits: '２', source_url: url,
  grading: 'レポート70%、発表30%。',
  sections: { 出席要件: '全10回中8回以上の出席', 単位取得条件: '全課題の提出' },
};

test('公式詳細と依頼キーを照合し、明示された科目情報と評価根拠を確認候補にする', () => {
  const pack = parseGunmaSyllabusDetail(detail, key);
  const [item] = pack.items;
  assert.equal(item.id, 'gunma.2026.TEST001');
  assert.equal(item.type, 'course');
  assert.equal(item.source.kind, 'syllabus');
  assert.deepEqual(item.data, { code: 'TEST001', term: '2026年度 後期', instructor: '架空 教員', credits: 2, syllabus_url: url });
  assert.equal(item.extensions['x-grading-method'], 'レポート70%、発表30%。');
  assert.equal(item.extensions['x-attendance-requirement'], '全10回中8回以上の出席');
  assert.equal(item.extensions['x-credit-requirement'], '全課題の提出');
  assert.equal(item.needs_review, true);
  const existing = { id: 'existing-course', title: '旧名称', term: '2026年度 後学期', code: 'TEST001', weekday: 5, period: 2, room: '別ソース', instructor: '' };
  const [match] = planInboxCourses([existing], [{ collection: pack.collection, item }]);
  assert.equal(match.course.id, 'existing-course');
  assert.equal(match.course.weekday, 5);
  assert.equal(match.course.room, '別ソース');
});

test('単位が確定できず欠席の例しかない詳細から、単位や出席要件を推測しない', () => {
  const [item] = parseGunmaSyllabusDetail({ ...detail, credits: '1–2', sections: { 受講上の注意: '欠席時は例を参照してください' } }, key).items;
  assert.equal(item.data.credits, undefined);
  assert.equal(item.extensions['x-attendance-requirement'], undefined);
  assert.equal(item.extensions['x-credit-requirement'], undefined);
  assert.match(item.uncertainties.join(' '), /単位数.*出席要件.*単位取得条件/);
});

test('大学、年度、科目コード、公式の公開詳細URLが照合できない結果を拒否する', () => {
  for (const bad of [
    { university: '別の大学' }, { year: 2025 }, { course_code: 'OTHER' }, { title: '' }, { semester: '' },
    { source_url: url.replace('lct_cd=TEST001', 'lct_cd=OTHER') },
    { source_url: url.replace('je_cd=1', 'je_cd=2') },
    { source_url: url + '&lct_year=2025' },
    { source_url: url + '&other=synthetic-secret' },
    { source_url: url.replace('https://www.', 'https://other@www.') },
    { source_url: url.replace('gunma-u.ac.jp/', 'example.test/') },
    { source_url: url.replace('/Public/Syllabus/', '/StudentApp/Grades/') },
  ]) {
    assert.throws(() => parseGunmaSyllabusDetail({ ...detail, ...bad }, key), error => !error.message.includes('synthetic-secret'));
  }
});

test('同じ年度・科目の再確認は同じIDを使い、評価条件の変更はInboxの履歴候補になる', () => {
  const original = parseGunmaSyllabusDetail(detail, key);
  const empty = { version: 1, records: [] };
  const ids = original.items.map(item => item.id);
  const saved = applyManabiImport(empty, original, ids, ids, JSON.stringify(empty));
  const identical = parseGunmaSyllabusDetail({ ...detail, source_url: url.replace('/portal', '/Portal').replace('je_cd=1&lct_cd=TEST001', 'lct_cd=TEST001&je_cd=1') }, key);
  assert.equal(planManabiImport(saved, identical)[0].kind, 'same');
  const updated = parseGunmaSyllabusDetail({ ...detail, grading: 'レポート100%。' }, key);
  assert.equal(planManabiImport(saved, updated)[0].kind, 'update');
  const next = applyManabiImport(saved, updated, ids, ids, JSON.stringify(saved));
  assert.equal(next.records.length, 1);
  assert.equal(next.records[0].history[0].item.extensions['x-grading-method'], 'レポート70%、発表30%。');
});
