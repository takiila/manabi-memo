import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeChecklist, normalizePlanner, projectTodos, homeTodos, calendarEntries, patchChecklist, mergePlanner, normalizeHomeLayout } from '../app/planner-model.ts';
import { EMPTY_CAMPUS_STATE } from '../app/campus-model.ts';

const item = { id: 'check1', text: '証明を復習', done: false, registered: true, due: '2026-10-09', priority: false, workAt: '', deletedAt: null };
const course = { id: 'c', title: '数理論理学', term: '2026年度 後期', weekday: 5, period: 2 };
const memo = { id: 'm', courseId: 'c', sessionId: 's', text: '復習', tags: ['テスト対策'], page: 3, checklist: [item] };
const state = { courses: [course], sessions: [{ id: 's', courseId: 'c', sessionNumber: '3', title: '証明' }], memos: [memo], campus: EMPTY_CAMPUS_STATE, planner: { version: 1, todos: [], events: [] }, inbox: { records: [] } };

test('旧データは空、不正な新形式は消去せず拒否する', () => {
  assert.deepEqual(normalizeChecklist(undefined), []);
  assert.deepEqual(normalizePlanner(undefined), { version: 1, todos: [], events: [] });
  assert.throws(() => normalizeChecklist([{ ...item, due: '2026-02-30' }]));
  assert.throws(() => normalizeChecklist([item, item]));
  assert.throws(() => normalizePlanner({ version: 2, todos: [], events: [] }));
});
test('選択登録と解除は同じID・チェック・期限を維持する', () => {
  const list = patchChecklist([item], item.id, { done: true, registered: false });
  assert.equal(list[0].id, item.id);
  assert.equal(list[0].due, item.due);
  assert.equal(list[0].done, true);
  assert.equal(projectTodos({ ...state, memos: [{ ...memo, checklist: list }] }).length, 0);
  assert.equal(projectTodos({ ...state, memos: [{ ...memo, checklist: patchChecklist(list, item.id, { registered: true }) }] })[0].done, true);
});
test('削除済みの項目・付箋・授業回・講義を表示せず復元で戻る', () => {
  for (const key of ['memos', 'sessions', 'courses']) {
    assert.equal(projectTodos({ ...state, [key]: state[key].map(row => ({ ...row, deletedAt: '2026-10-08T00:00:00Z' })) }).length, 0);
  }
  assert.equal(projectTodos({ ...state, memos: [{ ...memo, checklist: [{ ...item, deletedAt: '2026-10-08T00:00:00Z' }] }] }).length, 0);
  assert.equal(projectTodos(state).length, 1);
});
test('ホームは期限切れ・直近7日・優先表示の未完了だけ', () => {
  const rows = [{ due: '2026-10-01', done: false }, { due: '2026-10-15', done: false }, { due: '2026-10-16', done: false }, { due: '', priority: true, done: false }, { due: '', done: false }, { due: '2026-10-09', done: true }];
  assert.equal(homeTodos(rows, '2026-10-09').length, 3);
});
test('日付のみを時刻未設定で表示、期限なしは出さず、作業日時は締切と別', () => {
  const checklist = [item, { ...item, id: 'check2', due: '', workAt: '2026-10-10T13:00' }, { ...item, id: 'check3', registered: false }];
  const entries = calendarEntries({ ...state, courses: [{ ...course, weekday: null }], memos: [{ ...memo, checklist }] }, '2026-10', 'all');
  const todo = entries.filter(row => row.kind === 'todo' || row.kind === 'work');
  assert.equal(todo.length, 2);
  assert.equal(todo[0].at, '2026-10-09');
  assert.equal(todo[0].time, '');
  assert.equal(todo[1].kind, 'work');
  assert.equal(todo[1].time, '13:00');
});
test('同一項目を重複生成せず登録解除でカレンダーから消える', () => {
  assert.equal(calendarEntries(state, '2026-10', course.term).filter(row => row.kind === 'todo').length, 1);
  assert.equal(calendarEntries({ ...state, memos: [{ ...memo, checklist: [{ ...item, registered: false }] }] }, '2026-10', course.term).filter(row => row.kind === 'todo').length, 0);
});
test('バックアップの個人ToDo・予定のID衝突を回避し科目参照を移す', () => {
  const planner = { version: 1, todos: [{ ...item, courseId: 'c', tags: [] }], events: [{ id: 'e', title: '予定', start: '2026-10-09', end: '', note: '', deletedAt: null }] };
  const merged = mergePlanner(planner, planner, new Map([['c', 'c-new']]));
  assert.equal(merged.todos.length, 2);
  assert.notEqual(merged.todos[0].id, merged.todos[1].id);
  assert.equal(merged.todos[1].courseId, 'c-new');
  assert.notEqual(merged.events[0].id, merged.events[1].id);
});
test('ホーム設定の旧値を補完し順序重複を除く', () => {
  assert.deepEqual(normalizeHomeLayout(null), { todo: true, timetable: true, todoFirst: true });
  assert.deepEqual(normalizeHomeLayout({ todo: false, timetable: false, todoFirst: false }), { todo: false, timetable: false, todoFirst: false });
});

test('学年暦の授業期間・休講・曜日変更を通常時間割へ反映する', () => {
  const rules = [
    { id: 'period', title: '後期', data: { starts_at: '2026-10-01', ends_at: '2027-02-01' }, extensions: { 'x-class-calendar': 'teaching_period' } },
    { id: 'holiday', title: '休講', data: { starts_at: '2026-10-09' }, extensions: { 'x-class-calendar': 'no_class' } },
    { id: 'swap', title: '月曜日の授業', data: { starts_at: '2026-10-15' }, extensions: { 'x-class-weekday': 1 } },
  ].map(row => ({ id: row.id, collection: 'calendar', item: { ...row, type: 'event', term: course.term, source: { title: '学年暦' } } }));
  const input = { ...state, courses: [course, { ...course, id: 'monday', weekday: 1 }], inbox: { records: rules } };
  const october = calendarEntries(input, '2026-10', course.term);
  assert.equal(october.filter(e => e.kind === 'class' && e.at.startsWith('2026-10-09')).length, 0);
  assert.equal(october.find(e => e.kind === 'class' && e.at.startsWith('2026-10-15')).courseId, 'monday');
  assert.equal(calendarEntries(input, '2027-03', course.term).filter(e => e.kind === 'class').length, 0);
});

test('添付学年暦の取り込みデータが公開Schemaに準拠し、同じ取り込みを重複させない', async () => {
  const { readFile } = await import('node:fs/promises');
  const { parseManabiImport, planManabiImport, applyManabiImport } = await import('../app/manabi-import-model.ts');
  const pack = parseManabiImport(await readFile(new URL('../examples/gunma-info-2026-academic-calendar.json', import.meta.url), 'utf8'));
  const initial = { version: 1, records: [] };
  const plan = planManabiImport(initial, pack);
  assert.equal(plan.some(r => r.kind === 'blocked'), false);
  const inbox = applyManabiImport(initial, pack, pack.items.map(i => i.id), pack.items.map(i => i.id), JSON.stringify(initial));
  assert.equal(planManabiImport(inbox, pack).every(r => r.kind === 'same'), true);
  const dateRows = calendarEntries({ ...state, inbox }, '2026-10', course.term);
  assert.equal(dateRows.some(e => e.kind === 'class' && e.at.startsWith('2026-10-12')), false);
});
test('ホームの期限判定は時差を含む予定を端末の日付に合わせる', () => {
  const previous = process.env.TZ; process.env.TZ = 'Asia/Tokyo';
  try {
    assert.equal(homeTodos([{done:false,due:'2026-10-15T23:00:00Z'}], '2026-10-09').length, 0);
  } finally { process.env.TZ = previous; }
});
test('時差付き予定の開始だけ編集しても、サーバー側の日時検証を通る', async () => {
  const { serializeEventDates } = await import('../app/planner-model.ts');
  const previous = process.env.TZ; process.env.TZ = 'Asia/Tokyo';
  try {
    const dates = serializeEventDates('2026-10-09T12:00', '2026-10-09T13:00', {start:'2026-10-09T02:00:00Z',end:'2026-10-09T04:00:00Z'});
    assert.equal(dates.start, '2026-10-09T03:00:00.000Z');
    assert.equal(dates.end, '2026-10-09T04:00:00Z');
    process.env.TZ='UTC';
    assert.doesNotThrow(()=>normalizePlanner({version:1,todos:[],events:[{id:'e',title:'予定',...dates,note:'',deletedAt:null}]}));
  } finally { process.env.TZ = previous; }
});
