import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { JSDOM } from 'jsdom';
import { createElement as h, act, useState } from 'react';

register('./tsx-loader.mjs', import.meta.url);
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
dom.window.HTMLElement.prototype.scrollIntoView = function () {};
const { createRoot } = await import('react-dom/client');
const { CourseMemoPanel } = await import('../app/course-memo-panel.tsx');
const { SessionStartDialog } = await import('../app/session-start-dialog.tsx');
const { PlannerPanel } = await import('../app/planner-panel.tsx');
const { PlannerCalendar } = await import('../app/planner-calendar.tsx');
const { TaskDates } = await import('../app/memo-checklist.tsx');
const { EMPTY_CAMPUS_STATE } = await import('../app/campus-model.ts');
const { normalizePlanner, normalizeChecklist } = await import('../app/planner-model.ts');

const noop = () => {};
function mount(element) {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); act(() => root.render(element));
  return { host, render: element => act(() => root.render(element)), close: () => { act(() => root.unmount()); host.remove(); } };
}
function button(host, text) { const found = [...host.querySelectorAll('button')].find(el => el.textContent === text); assert.ok(found, text); return found; }
function input(host, label) { const found = [...host.querySelectorAll('label')].find(el => el.textContent.startsWith(label))?.querySelector('input'); assert.ok(found, label); return found; }
function fill(el, value) {
  act(() => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new dom.window.Event('input', { bubbles: true })); el.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
}
function click(el) { act(() => el.click()); }
const course = { id: 'c', title: '講義', term: '2026年度 後期', weekday: null, period: null, instructor: '', room: '' };
const state = { courses: [course], sessions: [], memos: [], campus: EMPTY_CAMPUS_STATE, inbox: { records: [] }, planner: { version: 1, todos: [], events: [] } };

test('授業回0件でも日程登録への操作があり、作成後は日付を変更・解除できる', () => {
  let created = 0; let day = '';
  const props = { disabled: false, memos: [], sessions: [], onPatch: noop, onOpen: noop, onCreateSession: () => created++, onSchedule: (_, value) => day = value };
  const view = mount(h(CourseMemoPanel, props));
  try {
    assert.equal(view.host.querySelector('details').open, true);
    click(button(view.host, '授業回と日付を登録')); assert.equal(created, 1);
    const session = { id: 's', courseId: 'c', sessionNumber: '1', title: 'ノート', scheduledOn: '' };
    view.render(h(CourseMemoPanel, { ...props, sessions: [session] }));
    const date = view.host.querySelector('input[type=date]'); fill(date, '2026-10-12'); assert.equal(day, '2026-10-12');
    view.render(h(CourseMemoPanel, { ...props, sessions: [{ ...session, scheduledOn: day }] }));
    assert.equal(date.value, day); fill(date, ''); assert.equal(day, '');
    view.render(h(CourseMemoPanel, { ...props, sessions: [], disabled: true })); assert.equal(button(view.host, '授業回と日付を登録').disabled, true);
  } finally { view.close(); }
});
test('新規授業回の開始時に日付を選択でき、回数の入力中にもフォーカスを失わない', () => {
  let result;
  function Harness() { const [number, setNumber] = useState('1'); return h(SessionStartDialog, { course, schedule: '曜日・時限未設定', sessionNumber: number, setSessionNumber: setNumber, disabled: false, starting: false, progress: { message: '', progress: 0 }, error: '', draftPdf: null, setDraftPdf: noop, onClose: noop, onStart: day => result = day }); }
  const view = mount(h(Harness));
  try {
    fill(input(view.host, '授業日'), '2026-10-12');
    const number = view.host.querySelector('[aria-label="授業回"]'); number.focus(); fill(number, '12');
    assert.equal(document.activeElement, number);
    fill(input(view.host, '授業日'), '2026-10-19'); click(button(view.host, 'この授業のノートを始める')); assert.equal(result, '2026-10-19');
    fill(number, '1'); assert.equal(input(view.host, '授業日').value, '2026-10-12');
  } finally { view.close(); }
});
test('既存授業回の授業日を続きから開く際も保持し、PDF選択や解除で消さない', () => {
  let result;
  const props = { course, schedule: '曜日・時限未設定', sessionNumber: '3', setSessionNumber: noop, disabled: false, starting: false, progress: { message: '', progress: 0 }, error: '', draftPdf: null, setDraftPdf: noop, existing: { scheduledOn: '2026-10-13' }, onClose: noop, onStart: day => result = day };
  const view = mount(h(SessionStartDialog, props));
  try {
    assert.equal(input(view.host, '授業日').value, '2026-10-13');
    view.render(h(SessionStartDialog, { ...props, draftPdf: new dom.window.File(['pdf'], 'test.pdf') }));
    click(button(view.host, 'この授業のノートを始める')); assert.equal(result, '2026-10-13');
    view.render(h(SessionStartDialog, props)); fill(input(view.host, '授業日'), ''); click(button(view.host, 'この授業のノートを続ける')); assert.equal(result, '');
  } finally { view.close(); }
});
test('カレンダーの初期表示が別学期の授業日を隠さず、授業回ノートを開ける', () => {
  let opened;
  const today = new Date(); const day = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const inputState = { ...state, courses: [{ ...course, id: 'old', term: '2025年度 前期' }, course], sessions: [{ id: 's', courseId: 'c', sessionNumber: '1', title: 'ノート', scheduledOn: day }] };
  const view = mount(h(PlannerCalendar, { state: inputState, onTodo: noop, onCourse: noop, onEvent: noop, onSession: id => opened = id }));
  try { assert.equal(view.host.querySelector('select').value, 'all'); click(button(view.host, '開く')); assert.equal(opened, 's'); } finally { view.close(); }
});
test('期限の日付・時刻・作業予定を別々に変更し、期限を空に戻せる', () => {
  let result;
  function Harness() { const [item, setItem] = useState({ due: '', workAt: '', priority: false }); return h(TaskDates, { item, onChange: patch => { result = { ...item, ...patch }; normalizeChecklist([{ id: 'i', text: 'todo', done: false, registered: true, ...result }]); setItem(result); } }); }
  const view = mount(h(Harness));
  try { fill(input(view.host, '期限の日付'), '2026-10-12'); fill(input(view.host, '期限の時刻'), '13:00'); assert.equal(result.due, '2026-10-12T13:00'); fill(input(view.host, '作業する日時'), '2026-10-11T10:00'); assert.equal(result.workAt, '2026-10-11T10:00'); fill(input(view.host, '期限の日付'), ''); assert.equal(result.due, ''); assert.equal(input(view.host, '期限の時刻').disabled, true); } finally { view.close(); }
});
test('個人予定を繰り返し編集しても入力欄が再作成されず、保存・ごみ箱・復元が反映される', () => {
  let saved; let externalUpdate;
  function Harness() { const [planner, setPlanner] = useState({ ...state.planner, events: [{ id: 'e', title: '予定', start: '2026-10-12', end: '', note: '', deletedAt: null }] }); externalUpdate = setPlanner; return h(PlannerPanel, { state: { ...state, planner }, disabled: false, onPatch: noop, onPlanner: value => { saved = normalizePlanner(value); setPlanner(saved); }, onMemo: noop, onCourse: noop, onSession: noop }); }
  const view = mount(h(Harness));
  try {
    click(button(view.host, '個人予定・ごみ箱')); const editor = view.host.querySelector('.calendar-agenda .event-editor'); const title = input(editor, 'タイトル');
    fill(title, '変更した予定'); title.focus(); click(button(editor, '更新')); assert.equal(saved.events[0].title, '変更した予定'); assert.equal(input(editor, 'タイトル'), title);
    fill(input(editor, '開始日'), '2026-10-14'); click(button(editor, '更新')); assert.equal(saved.events[0].start, '2026-10-14');
    act(() => externalUpdate({ ...saved, events: [{ ...saved.events[0], title: '別端末からの変更', start: '2026-10-15' }] }));
    assert.equal(input(editor, 'タイトル'), title); assert.equal(title.value, '別端末からの変更'); assert.equal(input(editor, '開始日').value, '2026-10-15');
    click(button(view.host, 'ごみ箱へ')); assert.ok(saved.events[0].deletedAt); click(button(view.host, '復元')); assert.equal(saved.events[0].deletedAt, null);
  } finally { view.close(); }
});

test('個人予定をカレンダーから開くと、その予定の編集欄を選択してフォーカスする', () => {
  const today = new Date(); const day = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const planner = { ...state.planner, events: [{ id: 'other', title: '別の予定', start: '2025-01-01', end: '', note: '', deletedAt: null }, { id: 'target', title: '対象の予定', start: day, end: '', note: '', deletedAt: null }] };
  const view = mount(h(PlannerPanel, { state: { ...state, planner }, disabled: false, onPatch: noop, onPlanner: noop, onMemo: noop, onCourse: noop, onSession: noop }));
  try { click(button(view.host, '統合カレンダー')); click(button(view.host, '開く')); const selected = view.host.querySelector('.selected-event'); assert.equal(selected.id, 'planner-event-target'); assert.equal(input(selected, 'タイトル').value, '対象の予定'); assert.equal(document.activeElement, selected); } finally { view.close(); }
});
