import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
register('./tsx-loader.mjs', import.meta.url);
import { normalizeChecklist, normalizePlanner, projectTodos, homeTodos, calendarEntries, patchChecklist, mergePlanner, normalizeHomeLayout, normalizeSessionDay, memoContentText, homeAttendanceRows, recordHomeAttendance, catchUpAttendanceRows, academicPriorities, academicBrief } from '../app/planner-model.ts';
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
  assert.deepEqual(normalizeHomeLayout(null), { todo: true, events: true, timetable: true, todoFirst: true });
  assert.deepEqual(normalizeHomeLayout({ todo: false, timetable: false, todoFirst: false }), { todo: false, events: true, timetable: false, todoFirst: false });
  assert.equal(normalizeHomeLayout({ events: false }).events, false);
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


test('チェック項目だけの付箋を表示し、削除済み項目は検索本文に含めない', () => {
  assert.equal(memoContentText({ text: '', checklist: [item] }), item.text);
  assert.equal(memoContentText({ text: '', checklist: [{ ...item, deletedAt: '2026-10-09T00:00:00Z' }] }), '');
});
test('旧ノートの授業日は未指定、不正な日付・日時は拒否する', () => {
  assert.equal(normalizeSessionDay(undefined), '');
  assert.equal(normalizeSessionDay('2026-10-09'), '2026-10-09');
  for (const day of ['2026-02-30', '2026-10-09T12:00', null, 42]) assert.throws(() => normalizeSessionDay(day));
});
test('指定した授業日から同じ授業回を参照し、通常時間割との重複・削除済みノートを表示しない', () => {
  const input = { ...state, sessions: [{ ...state.sessions[0], scheduledOn: '2026-10-09' }] };
  const entries = calendarEntries(input, '2026-10', course.term);
  const dated = entries.filter(e => e.kind === 'session');
  assert.equal(dated.length, 1);
  assert.equal(dated[0].sessionId, 's');
  assert.equal(dated[0].at, '2026-10-09');
  assert.equal(dated[0].time, '');
  assert.equal(entries.some(e => e.kind === 'class' && e.at.startsWith('2026-10-09')), false);
  for (const key of ['sessions', 'courses']) assert.equal(calendarEntries({ ...input, [key]: input[key].map(row => ({ ...row, deletedAt: '2026-10-09T00:00:00Z' })) }, '2026-10', course.term).some(e => e.kind === 'session'), false);
  assert.equal(calendarEntries(input, '2026-10', '別の学期').some(e => e.kind === 'session'), false);
});

test('週間表示で重複・同時刻・短時間・離れた予定のクリック領域を分離', async () => {
  const { layoutTimedWeekEntries, timedRange } = await import('../app/planner-week-layout.ts');
  const event = (id, start, end) => ({ id, title: id, kind: 'event', at: '2026-10-12T' + start, end: end ? '2026-10-12T' + end : '', time: start, done: false, sourceId: id, detail: '' });
  const data = [
    event('A', '13:00', '14:00'),
    event('B', '13:15', '14:15'),
    event('C', '13:20', '13:30'),
    event('D', '15:00', '16:00'),
    event('E', '15:10', '15:15'),
    event('F', '17:00', '17:20'),
  ];
  const placed = layoutTimedWeekEntries(data, '2026-10-12');
  assert.equal(placed.length, data.length);
  assert.deepEqual(new Set(placed.slice(0, 3).map(v => v.lane)).size, 3);
  assert.ok(placed.slice(0, 3).every(v => v.laneCount === 3));
  assert.equal(placed.find(v => v.entry.id === 'D').laneCount, 2);
  assert.equal(placed.find(v => v.entry.id === 'E').laneCount, 2);
  assert.equal(placed.find(v => v.entry.id === 'F').laneCount, 1);
  assert.equal(timedRange(event('short', '13:00', '13:05'), '2026-10-12').end, 13 * 60 + 40);
  assert.equal(timedRange(data[0], '2026-10-13'), null);
  assert.deepEqual(layoutTimedWeekEntries([event('same1','14:00','14:30'),event('same2','14:00','14:30')], '2026-10-12').map(v=>v.lane), [0,1]);
  assert.deepEqual(layoutTimedWeekEntries([event('first','14:00','14:30'),event('second','14:45','15:15')], '2026-10-12').map(v=>v.laneCount), [1,1]);
});

test('ホームのクイック登録はゼミガイダンス・通院・資格勉強を既存データに記録する', async () => {
  const { buildQuickEntry } = await import('../app/planner-quick-entry-model.ts');
  const base = { kind: 'event', title: 'ゼミガイダンス', day: '2026-10-15', time: '14:00', endTime: '15:00', due: '', workDay: '', workTime: '', note: '大学内の会場', priority: false, tags: [] };
  const seminar = buildQuickEntry(base, 'seminar');
  assert.equal(seminar.kind, 'event');
  assert.equal(seminar.record.start, '2026-10-15T14:00');
  assert.equal(seminar.record.end, '2026-10-15T15:00');
  const hospital = buildQuickEntry({ ...base, title: '通院', day: '2026-10-16', time: '09:30', endTime: '', note: '' }, 'clinic');
  assert.equal(hospital.record.start, '2026-10-16T09:30');
  assert.equal(hospital.record.end, '');
  assert.throws(() => buildQuickEntry({ ...base, endTime: '13:00' }, 'invalid'), /終了時刻/);
  assert.throws(() => buildQuickEntry({ ...base, day: '' }, 'invalid'), /日付/);
  const study = buildQuickEntry({ ...base, kind: 'todo', title: ' AWS SAA 勉強 ', day: '', time: '', endTime: '',
    due: '2026-10-20', workDay: '2026-10-17', workTime: '19:00', priority: true, tags: ['資格勉強', '資格勉強', 'AWS'] }, 'study');
  assert.equal(study.kind, 'todo');
  assert.equal(study.record.workAt, '2026-10-17T19:00');
  assert.equal(study.record.due, '2026-10-20');
  assert.deepEqual(study.record.tags, ['資格勉強','AWS']);
  assert.equal(study.record.text, 'AWS SAA 勉強');
  assert.throws(() => buildQuickEntry({ ...base, kind:'todo', workTime:'19:00' }, 'bad'), /作業時刻/);
  const personalState = { ...state, planner: normalizePlanner({ version:1, todos:[study.record], events:[seminar.record,hospital.record] }) };
  const entries = calendarEntries(personalState, '2026-10', 'all');
  assert.ok(entries.some(e => e.kind === 'event' && e.title === 'ゼミガイダンス' && e.time === '14:00'));
  assert.ok(entries.some(e => e.kind === 'event' && e.title === '通院' && e.time === '09:30'));
  assert.ok(entries.some(e => e.kind === 'work' && e.title === 'AWS SAA 勉強' && e.time === '19:00'));
  assert.ok(entries.some(e => e.kind === 'todo' && e.title === 'AWS SAA 勉強' && e.time === ''));
  assert.equal(homeTodos(projectTodos(personalState), '2026-10-15').some(t => t.title === 'AWS SAA 勉強'), true);
});

test('今日の出席は未確認と欠席を分け、既存の出席記録だけを同じIDで更新する', () => {
  const day = '2026-10-09';
  const [row] = homeAttendanceRows(state, day, course.term);
  assert.equal(row.status, null);
  assert.equal(row.period, 2);
  assert.equal(state.campus.attendanceRecords.length, 0);
  const saved = recordHomeAttendance(state.campus, row, 'present', '2026-10-09T02:00:00Z');
  assert.equal(saved.attendanceRecords.length, 1);
  assert.equal(homeAttendanceRows({ ...state, campus: saved }, day, course.term)[0].status, 'present');
  const updated = recordHomeAttendance(saved, row, 'late', '2026-10-09T02:10:00Z');
  assert.equal(updated.attendanceRecords.length, 1);
  assert.equal(updated.attendanceRecords[0].id, saved.attendanceRecords[0].id);
  assert.equal(updated.attendanceRecords[0].status, 'late');
  assert.equal(saved.attendanceRecords[0].status, 'present');
  const duplicate = { ...saved, attendanceRecords: [...saved.attendanceRecords, { ...saved.attendanceRecords[0], id: 'legacy-duplicate' }] };
  assert.equal(homeAttendanceRows({ ...state, campus: duplicate }, day, course.term)[0].conflict, true);
  assert.equal(recordHomeAttendance(duplicate, row, 'absent', '2026-10-09T03:00:00Z'), duplicate);
  assert.equal(homeAttendanceRows(state, '2026-10-10', course.term).length, 0);
});
test('学年暦の休講・曜日振替を今日の出席に反映する', () => {
  const rules = [{ id: 'off', type: 'event', term: course.term, title: '休講', source: { title: '学年暦' }, data: { starts_at: '2026-10-09' }, extensions: { 'x-class-calendar': 'no_class' } },
    { id: 'swap', type: 'event', term: course.term, title: '金曜授業', source: { title: '学年暦' }, data: { starts_at: '2026-10-15' }, extensions: { 'x-class-weekday': 5 } }].map(item => ({ id: item.id, collection: 'calendar', item }));
  const input = { ...state, inbox: { records: rules } };
  assert.equal(homeAttendanceRows(input, '2026-10-09', course.term).length, 0);
  assert.equal(homeAttendanceRows(input, '2026-10-15', course.term)[0].courseId, course.id);
});


test('数日使わなくても未確認出席を提示し、欠席を自動作成しない', () => {
  const day = '2026-10-15';
  const rows = catchUpAttendanceRows(state, day, course.term);
  assert.deepEqual(rows.map(row => row.day), ['2026-10-09']);
  assert.equal(state.campus.attendanceRecords.length, 0);
  const saved = recordHomeAttendance(state.campus, rows[0], 'present', '2026-10-15T01:00:00Z');
  assert.equal(catchUpAttendanceRows({ ...state, campus: saved }, day, course.term).length, 0);
});
test('優先事項は直近提出物・試験を表示し、過去の期限や未照合のInboxを区別する', () => {
  const assignment = (id, dueISO, status = 'todo') => ({ id, courseId: 'c', termId: course.term, title: id, dueISO, status, importance: 2 });
  const campus = { ...state.campus, assignments: [assignment('old', '2026-10-08'), assignment('report', '2026-10-10'), assignment('done', '2026-10-09', 'done'), assignment('unknown', '')],
    exams: [{ id: 'e', title: '試験', courseId: 'c', datetime: '2026-10-20' }] };
  const inbox = { records: [{ id: 'ics', item: { type: 'assignment', title: '未照合課題', source: { title: 'LMS' }, data: { due_at: '2026-10-09' } } }] };
  const result = academicPriorities({ ...state, campus, inbox }, course.term, new Date(2026, 9, 9, 9));
  assert.equal(result[0].source, 'inbox');
  assert.equal(result.find(item => item.id === 'assignment:report').group, 'urgent');
  assert.equal(result.find(item => item.id === 'assignment:old').group, 'overdue');
  assert.equal(result.find(item => item.id === 'exam:e').group, 'upcoming');
  assert.equal(result.find(item => item.id === 'assignment:unknown').group, 'review');
  assert.ok(result.find(item => item.id === 'inbox:ics').reason.includes('紐付け未確認'));
  assert.ok(!result.some(item => item.id === 'assignment:done'));
});


test('相談用の文章は未照合状態と日時を伝え、ノートやPDFの本文を含めない', () => {
  const input = { ...state, memos: [{ ...memo, text: 'private-note-body', checklist: [] }] };
  const brief = academicBrief(input, course.term, new Date(2026, 9, 9, 9));
  assert.match(brief, /大学側の最新情報は未照合/);
  assert.match(brief, /2026-10-09 09:00/);
  assert.match(brief, /数理論理学/);
  assert.doesNotMatch(brief, /private-note-body/);
});
test('不正な日時は画面表示へ渡さず確認候補にする', () => {
  const campus = { ...state.campus, assignments: [{ id: 'bad', title: '期限未確認', courseId: 'c', dueISO: 'badZ', status: 'todo' }] };
  const item = academicPriorities({ ...state, campus }, course.term, new Date(2026, 9, 9, 9)).find(item => item.id === 'assignment:bad');
  assert.equal(item.group, 'review');
  assert.equal(item.at, '');
});


test('学業APIは明示確認・科目ID・現状照合を要求し、対象外の情報を保持する',async()=>{
 const {academicSnapshot,applyAcademicCommand}=await import('../app/academic-api-model.ts');
 const input={...state,campus:{...state.campus,assignments:[{id:'a',courseId:'c',title:'課題',status:'todo',dueISO:'2026-10-09',note:'private-note'}]},sessions:[{id:'s',noteText:'private-body'}]};
 const snapshot=academicSnapshot(input);
 assert.equal(snapshot.assignments[0].id,'a');
 assert.doesNotMatch(JSON.stringify(snapshot),/private-note|private-body/);
 const command={kind:'assignment_submitted',courseId:'c',assignmentId:'a',expectedStatus:'todo',confirmed:true};
 assert.throws(()=>applyAcademicCommand(input,{...command,confirmed:false},'2026-10-09','2026-10-09T00:00:00Z'));
 assert.throws(()=>applyAcademicCommand(input,{...command,courseId:'other'},'2026-10-09','2026-10-09T00:00:00Z'));
 const next=applyAcademicCommand(input,command,'2026-10-09','2026-10-09T00:00:00Z');
 assert.equal(next.campus.assignments[0].status,'done');
 assert.equal(next.campus.assignments[0].note,'private-note');
 assert.equal(next.sessions,input.sessions);
 assert.equal(applyAcademicCommand(next,command,'2026-10-09','2026-10-09T00:00:00Z'),next);
 assert.equal(input.campus.assignments[0].status,'todo');
});

test('未着手の試験範囲は学習実績にせず、同じ範囲の自力解答記録を消さない',async()=>{
 const {reviewTopics,weeklyLearning}=await import('../app/learning-model.ts');
 const first={id:'p',courseId:'c',topic:'証明',day:'2026-10-08',outcome:'planned',minutes:0,createdAt:'2026-10-08T01:00:00Z'};
 const done={...first,id:'d',day:'2026-10-09',outcome:'independent',minutes:15,createdAt:'2026-10-09T01:00:00Z'};
 const later={...first,id:'p2',day:'2026-10-10'};
 assert.equal(weeklyLearning([first],'2026-10-09').days,0);
 assert.equal(weeklyLearning([first,done,later],'2026-10-10').days,1);
 assert.equal(reviewTopics([first,done,later],'2026-10-10')[0].outcome,'independent');
 assert.match(academicBrief({...state,campus:{...state.campus,studyEvidence:[first,done]}},course.term,new Date(2026,9,10)),/自力で解答/);
});
test('課題と試験の作成は出典、確定日時、安定IDを要求し同名を重複させない',async()=>{
 const {applyAcademicCommand}=await import('../app/academic-api-model.ts');
 const command={kind:'assignment_create',confirmed:true,courseId:'c',recordId:'new',title:'新しい課題',at:'2026-10-10',source:'講義案内'};
 const next=applyAcademicCommand(state,command,'2026-10-09','2026-10-09T00:00:00Z');
 assert.equal(next.campus.assignments[0].dueISO,'2026-10-10');
 assert.equal(next.campus.assignments[0].status,'todo');
 assert.equal(applyAcademicCommand(next,command,'2026-10-09','2026-10-09T01:00:00Z'),next);
 assert.throws(()=>applyAcademicCommand(next,{...command,recordId:'other'},'2026-10-09','2026-10-09T01:00:00Z'));
 assert.throws(()=>applyAcademicCommand(state,{...command,source:''},'2026-10-09','2026-10-09T01:00:00Z'));
 assert.throws(()=>applyAcademicCommand(state,{...command,at:'2026-02-30'},'2026-10-09','2026-10-09T01:00:00Z'));
 const exam=applyAcademicCommand(state,{...command,kind:'exam_create'},'2026-10-09','2026-10-09T01:00:00Z');
 assert.equal(exam.campus.exams[0].datetime,'2026-10-10');
});

test('ChatGPT連携のOAuthは固定HTTPS先・PKCE・resource・scopeを要求する',async()=>{
 const {configuredOAuth,parseAuthorization,authorizationRedirect,pkceMatches,tokenClientAllowed}=await import('../lib/server/academic-oauth-model.ts');
 const cfg=configuredOAuth({MANABI_MCP_ENABLED:'true',MANABI_MCP_ORIGIN:'https://app.example.test',MANABI_MCP_CLIENT_ID:'test-client',MANABI_MCP_REDIRECT_URI:'https://chatgpt.com/connector_platform_oauth_redirect'});
 assert.ok(cfg);
 assert.equal(configuredOAuth({MANABI_MCP_ENABLED:'true',MANABI_MCP_ORIGIN:'https://app.example.test',MANABI_MCP_CLIENT_ID:'test-client',MANABI_MCP_REDIRECT_URI:'https://evil.example.test'}),null);
 const verifier='dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',challenge='E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
 assert.equal(pkceMatches(verifier,challenge),true);assert.equal(pkceMatches(verifier+'x',challenge),false);
 const params=new URLSearchParams({client_id:cfg.clientId,redirect_uri:cfg.redirectUri,response_type:'code',resource:cfg.resource,scope:'manabi.read manabi.write',state:'test-state',code_challenge:challenge,code_challenge_method:'S256'});
 const request=parseAuthorization(params,cfg);
 assert.equal(new URL(authorizationRedirect(cfg,request,'fake-code')).searchParams.get('iss'),cfg.issuer);
 for(const [key,value] of [['redirect_uri','https://evil.example.test'],['resource','https://other.example.test'],['code_challenge_method','plain'],['scope','manabi.admin']]){
   const bad=new URLSearchParams(params);bad.set(key,value);assert.throws(()=>parseAuthorization(bad,cfg));
 }
 assert.equal(tokenClientAllowed(new URLSearchParams({client_id:'test-client'}),'',cfg),true);
 assert.equal(tokenClientAllowed(new URLSearchParams({client_id:'wrong'}),'',cfg),false);
});

test('MCPツールは未確認の書き込みと未知の操作を拒否する',async()=>{
 const {toolCommand,validModernHeaders,compactSummary,academicTools}=await import('../app/academic-mcp-model.ts');
 assert.equal(academicTools.length,8);
 const args={expectedRevision:2,courseId:'c',confirmed:true,day:'2026-10-09',status:'present',expectedStatus:null};
 assert.equal(toolCommand('record_attendance',args).input.command.kind,'attendance');
 assert.throws(()=>toolCommand('record_attendance',{...args,confirmed:false}));
 assert.throws(()=>toolCommand('record_attendance',{...args,user_id:'other'}));
 assert.throws(()=>toolCommand('delete_all',{}));
 const body={method:'tools/call',params:{name:'record_attendance',_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28'}}};
 const headers=new Headers({'MCP-Protocol-Version':'2026-07-28','Mcp-Method':'tools/call','Mcp-Name':'record_attendance'});
 assert.equal(validModernHeaders(body,headers),true);headers.set('Mcp-Name','other');assert.equal(validModernHeaders(body,headers),false);
 const summary=compactSummary({ok:true,data:{activeTerm:'T',courses:[{id:'a',term:'T'},{id:'b',term:'old'}],assignments:[{courseId:'b',title:'old'},{courseId:'a',title:'new'}]}});
 assert.equal(summary.data.courses.length,1);
 assert.equal(summary.data.assignments[0].title,'new');
});
test('科目別の大学記録を保存済み科目IDに結び、古い巡回から本人訂正を保護する', async () => {
  const { academicPriorities, EMPTY_PLANNER } = await import('../app/planner-model.ts');
  const { academicCourseDetail, applyAcademicCommand } = await import('../app/academic-api-model.ts');
  const { normalizeCampusState } = await import('../app/campus-model.ts');
  const { projectAcademicRecords, courseRecordTotals } = await import('../app/academic-records-model.ts');
  const term = '2026年度 後期';
  const courses = [{ id: 'existing-course', title: '論理設計', term }];
  const source = { kind: 'web', title: '模擬LMS' };
  const fact = (id, type, title, summary, extensions = {}, data = {}) => ({
    id: 'inbox:' + id, collection: id.startsWith('history') ? 'gunma-academic-history-2026' : 'gunma-course-review-2026',
    item: { id, type, title, summary, term, source, extensions, data, uncertainties: ['模擬資料との確認が必要'] },
    updatedAt: '2026-11-26T00:00:00Z', history: [],
  });
  const report = fact('lms.assign.71364', 'assignment', '論理設計｜レポート課題', '12/4の第8回講義後に公開。期限欄と不一致。',
    { 'x-lms-submission-status': 'overdue-unsubmitted' }, { course_code: 'JB5011', due_at: '2026-11-15' });
  const history = fact('history.assign.71364', 'announcement', '論理設計｜レポート課題の提出履歴', 'LMS表示は未提出。告知12/4公開。');
  const input = { courses, campus: {}, inbox: { version: 1, records: [report, history] } };
  const [before] = projectAcademicRecords(input.inbox, courses, { assignments: [], exams: [] }, '2026-11-27');
  assert.equal(before.state, 'pending-release');
  assert.equal(before.dueAt, null);
  assert.equal(before.evidence.length, 2);
  const plannerInput = { ...input, planner: EMPTY_PLANNER, memos: [], sessions: [], campus: normalizeCampusState({}) };
  const priorities = academicPriorities(plannerInput, term, new Date('2026-11-27T00:00:00+09:00'));
  assert.equal(priorities.filter(row => row.title.includes('レポート課題')).length, 1);
  assert.equal(priorities.find(row => row.title.includes('レポート課題')).group, 'review');
  assert.equal(projectAcademicRecords(input.inbox, courses, { assignments: [], exams: [] }, '2026-12-05')[0].state, 'unknown');
  const next = applyAcademicCommand(input, { kind: 'academic_correction', courseId: courses[0].id, recordId: before.id,
    correctionId: 'report-1', confirmed: true, value: 'submitted', reason: '本人が模擬提出を確認' }, '2026-12-05', '2026-12-05T01:00:00Z');
  const restored = JSON.parse(JSON.stringify({ ...next, campus: normalizeCampusState(next.campus) }));
  const otherSession = academicCourseDetail(restored, courses[0].id, 0);
  assert.equal(otherSession.records[0].state, 'submitted');
  assert.equal(otherSession.records[0].correctionHistory.length, 1);
  assert.equal(otherSession.records[0].evidence.length, 2);
  assert.equal(otherSession.totals.assignment.submitted, 1);
  assert.equal(academicCourseDetail(restored, 'unknown-course', 0), null);
  assert.deepEqual(restored.inbox, input.inbox);
  const lateWork = [1, 2, 3, 4].map(i => fact('lms.assign.' + i, 'assignment', '論理設計｜課題' + i, '模擬課題',
    { 'x-lms-submission-status': 'submitted', 'x-late-submission': true, 'x-attendance-assignment': i !== 4 }));
  const records = projectAcademicRecords({ version: 1, records: lateWork }, courses, { assignments: [], exams: [] }, '2026-11-27');
  assert.equal(courseRecordTotals(records).lateAttendanceAssignmentRule.provisionalAbsenceEquivalent, 1);
  lateWork[0].item.extensions['x-official-attendance-rule'] = '正式基準を優先';
  assert.equal(courseRecordTotals(projectAcademicRecords({ version: 1, records: lateWork }, courses, { assignments: [], exams: [] })).lateAttendanceAssignmentRule.provisionalAbsenceEquivalent, null);
});
