import type { CampusState } from './campus-model';
import type { InformationInbox } from './manabi-import-types';

export type ChecklistItem = { id: string; text: string; done: boolean; registered: boolean; due: string; priority: boolean; workAt: string; deletedAt: string | null };
export type PersonalTodo = ChecklistItem & { courseId: string; tags: string[] };
export type PersonalEvent = { id: string; title: string; start: string; end: string; note: string; deletedAt: string | null };
export type PlannerState = { version: 1; todos: PersonalTodo[]; events: PersonalEvent[] };
export type PlannerCourse = { id: string; title: string; term: string; weekday: number | null; period: number | null; deletedAt?: string | null; archivedAt?: string | null; code?: string };
export type PlannerMemo = { id: string; courseId: string; sessionId: string; text: string; tags: string[]; page: number | null; checklist?: ChecklistItem[]; deletedAt?: string | null };
export type PlannerSession = { id: string; courseId: string; sessionNumber: string; title: string; deletedAt?: string | null };
export type PlannerInput = { courses: PlannerCourse[]; sessions: PlannerSession[]; memos: PlannerMemo[]; campus: CampusState; planner: PlannerState; inbox: InformationInbox };
export type TodoRow = { id: string; source: 'memo' | 'personal' | 'assignment' | 'study'; sourceId: string; itemId: string; title: string; done: boolean; due: string; priority: boolean; workAt: string; tags: string[]; courseId: string; courseTitle: string; term: string; sessionTitle: string; page: number | null };
export type CalendarEntry = { id: string; title: string; kind: 'todo' | 'work' | 'assignment' | 'exam' | 'study' | 'class' | 'event' | 'university'; at: string; end?: string; time: string; done: boolean; todoId?: string; sourceId?: string; url?: string; courseId?: string; detail: string };
export const EMPTY_PLANNER: PlannerState = { version: 1, todos: [], events: [] };
export type HomeLayout = { todo: boolean; timetable: boolean; todoFirst: boolean };
export function normalizeHomeLayout(value: unknown): HomeLayout {
  const v = value && typeof value === 'object' ? value as Partial<HomeLayout> : {};
  return { todo: v.todo !== false, timetable: v.timetable !== false, todoFirst: v.todoFirst !== false };
}
function record(v: unknown): v is Record<string, unknown> { return Boolean(v && typeof v === 'object' && !Array.isArray(v)); }
function string(v: unknown, limit = 10000) { if (typeof v !== 'string' || v.length > limit) throw new Error('ToDo・予定の保存形式を確認できません。元データは変更していません。'); return v; }
function deleted(v: unknown) { if (v === undefined || v === null) return null; const s = string(v, 100); if (!Number.isFinite(Date.parse(s))) throw new Error('ごみ箱の日付が不正です。'); return s; }
export function dateKey(value: string) { return value.slice(0, 10); }
export function isPlannerDate(value: unknown, empty = true): value is string {
  if (empty && value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value)) return false;
  const day = value.slice(0, 10);
  const parsed = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return false;
  if (value.length > 10 && (!Number.isFinite(Date.parse(value)) || Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59)) return false;
  return true;
}
function date(v: unknown) { if (v === undefined) return ''; if (!isPlannerDate(v)) throw new Error('ToDo・予定の日付が不正です。'); return v; }
function unique<T extends { id: string }>(rows: T[]) { if (new Set(rows.map(v => v.id)).size !== rows.length) throw new Error('ToDo・予定のIDが重複しています。'); return rows; }
export function normalizeChecklist(value: unknown, limit = 1000): ChecklistItem[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > limit) throw new Error('チェック項目の保存形式を確認できません。');
  return unique(value.map(v => {
    if (!record(v)) throw new Error('チェック項目の保存形式が不正です。');
    const id = string(v.id, 180); if (!id) throw new Error('チェック項目のIDがありません。');
    for (const key of ['done', 'registered', 'priority']) if (v[key] !== undefined && typeof v[key] !== 'boolean') throw new Error('チェック項目の状態が不正です。');
    return { id, text: string(v.text), done: v.done === true, registered: v.registered === true, due: date(v.due), priority: v.priority === true, workAt: date(v.workAt), deletedAt: deleted(v.deletedAt) };
  }));
}
export function normalizePlanner(value: unknown): PlannerState {
  if (value === undefined) return { version: 1, todos: [], events: [] };
  if (!record(value) || value.version !== 1 || !Array.isArray(value.todos) || !Array.isArray(value.events) || value.todos.length > 20000 || value.events.length > 20000) throw new Error('ToDo・予定の保存形式を確認できません。');
  const todos = normalizeChecklist(value.todos, 20000).map((item, index) => {
    const raw = value.todos as Record<string, unknown>[];
    const row = raw[index];
    if (row.tags !== undefined && (!Array.isArray(row.tags) || row.tags.some(v => typeof v !== 'string'))) throw new Error('ToDoのタグが不正です。');
    return { ...item, courseId: row.courseId === undefined ? '' : string(row.courseId, 180), tags: [...new Set((row.tags ?? []) as string[])] };
  });
  const events = unique(value.events.map(v => {
    if (!record(v)) throw new Error('予定の保存形式が不正です。');
    const id = string(v.id, 180); const title = string(v.title); const start = date(v.start); const end = date(v.end);
    if (!id || !title.trim() || !start || (end && (end.length === 10 ? displayDay(end) < displayDay(start) : new Date(end).getTime() < new Date(start).getTime()))) throw new Error('予定の日時・IDが不正です。');
    return { id, title, start, end, note: v.note === undefined ? '' : string(v.note), deletedAt: deleted(v.deletedAt) };
  }));
  return { version: 1, todos, events };
}
export function patchChecklist(items: ChecklistItem[], id: string, patch: Partial<Omit<ChecklistItem, 'id'>>) {
  return normalizeChecklist(items.map(item => item.id === id ? { ...item, ...patch, id: item.id } : item));
}
export function projectTodos(state: PlannerInput): TodoRow[] {
  const courses = new Map(state.courses.filter(c => !c.deletedAt).map(c => [c.id, c]));
  const sessions = new Map(state.sessions.filter(s => !s.deletedAt && courses.has(s.courseId)).map(s => [s.id, s]));
  const rows: TodoRow[] = [];
  const add = (courseId: string, row: Omit<TodoRow, 'courseTitle' | 'term'> & { term?: string }) => {
    const course = courses.get(courseId);
    if (courseId && !course) return;
    rows.push({ ...row, courseTitle: course?.title ?? '個人ToDo', term: course?.term ?? row.term ?? '' });
  };
  for (const memo of state.memos) {
    const session = sessions.get(memo.sessionId);
    if (memo.deletedAt || !session || session.courseId !== memo.courseId) continue;
    for (const item of memo.checklist ?? []) {
      if (!item.registered || item.deletedAt) continue;
      add(memo.courseId, { id: `memo:${memo.id}:${item.id}`, source: 'memo', sourceId: memo.id, itemId: item.id, title: item.text, done: item.done, due: item.due, priority: item.priority, workAt: item.workAt, tags: memo.tags, courseId: memo.courseId, sessionTitle: `第${session.sessionNumber}回 · ${session.title}`, page: memo.page });
    }
  }
  for (const item of state.planner.todos) if (!item.deletedAt) add(item.courseId, { id: `personal:${item.id}`, source: 'personal', sourceId: item.id, itemId: item.id, title: item.text, done: item.done, due: item.due, priority: item.priority, workAt: item.workAt, tags: item.tags, courseId: item.courseId, sessionTitle: '', page: null });
  for (const item of state.campus.assignments) add(item.courseId, { id: `assignment:${item.id}`, source: 'assignment', sourceId: item.id, itemId: item.id, title: item.title, done: item.status === 'done', due: item.dueISO, priority: item.importance === 3, workAt: '', tags: [], courseId: item.courseId, sessionTitle: '提出課題', page: null });
  for (const item of state.campus.studyTasks) {
    const source = item.sourceType === 'exam' ? state.campus.exams.find(v => v.id === item.sourceId) : state.campus.assignments.find(v => v.id === item.sourceId);
    if (!source) continue;
    add(source.courseId, { id: `study:${item.id}`, source: 'study', sourceId: item.id, itemId: item.id, title: item.title, done: item.status === 'done', due: item.dueISO, priority: item.intensity === 'hard', workAt: '', tags: [], courseId: source.courseId, sessionTitle: '学習タスク', page: null });
  }
  return rows;
}
export function homeTodos<T extends { done: boolean; due: string; priority?: boolean }>(rows: T[], today: string): T[] {
  const end = addDateDays(today, 6);
  return rows.filter(row => !row.done && (row.priority || (row.due && displayDay(row.due) <= end))).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
}
export function addDateDays(day: string, days: number) { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
export function localPlannerDay(now = new Date()) { return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
function displayTime(at: string) { if (at.length === 10) return ''; if (/(Z|[+-]\d{2}:\d{2})$/.test(at)) return new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(at)); return at.slice(11, 16); }
export function displayDay(at: string) { return at.length > 10 && /(Z|[+-]\d{2}:\d{2})$/.test(at) ? localPlannerDay(new Date(at)) : dateKey(at); }
export function calendarEntries(state: PlannerInput, month: string, term: string): CalendarEntry[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return [];
  const result: CalendarEntry[] = [];
  const push = (entry: Omit<CalendarEntry, 'time'>) => { if (isPlannerDate(entry.at, false)) result.push({ ...entry, time: displayTime(entry.at), at: entry.at }); };
  for (const todo of projectTodos(state)) {
    if (term !== 'all' && todo.term && todo.term !== term) continue;
    if (todo.due) push({ id: `due:${todo.id}`, title: todo.title, kind: todo.source === 'memo' || todo.source === 'personal' ? 'todo' : todo.source, at: todo.due, done: todo.done, todoId: todo.id, detail: `${todo.courseTitle} · 締切` });
    if (todo.workAt) push({ id: `work:${todo.id}`, title: todo.title, kind: 'work', at: todo.workAt, done: todo.done, todoId: todo.id, detail: `${todo.courseTitle} · 作業予定` });
  }
  for (const exam of state.campus.exams) {
    const course = state.courses.find(c => c.id === exam.courseId && !c.deletedAt);
    if (course && (term === 'all' || course.term === term)) push({ id: `exam:${exam.id}`, title: exam.title, kind: 'exam', at: exam.datetime, done: false, courseId: course.id, detail: `${course.title} · ${exam.location}` });
  }
  for (const event of state.planner.events) if (!event.deletedAt) push({ id: `event:${event.id}`, title: event.title, kind: 'event', at: event.start, end: event.end, done: false, sourceId: event.id, detail: event.note });
  for (const record of state.inbox.records) {
    const item = record.item;
    if (term !== 'all' && item.term && item.term !== term) continue;
    let at = ''; let end = '';
    switch (item.type) {
      case 'event': at = item.data.starts_at ?? ''; end = item.data.ends_at ?? ''; break;
      case 'deadline': case 'assignment': at = item.data.due_at ?? ''; break;
      case 'exam': at = item.data.starts_at ?? ''; end = item.data.ends_at ?? ''; break;
      case 'registration': at = item.data.opens_at ?? ''; end = item.data.closes_at ?? ''; break;
      case 'seminar': at = item.data.guidance_at ?? item.data.application_start ?? ''; end = item.data.application_end ?? ''; break;
    }
    if (at) push({ id: `inbox:${record.id}`, title: item.title, kind: 'university', at, end, done: false, sourceId: record.id, url: item.source.url ?? '', detail: `${record.collection} · ${item.source.title}` });
  }
  const last = new Date(`${month}-01T12:00:00Z`); last.setUTCMonth(last.getUTCMonth() + 1); last.setUTCDate(0);
  const times: Record<number, string> = { 1: '08:40', 2: '10:20', 3: '12:40', 4: '14:20', 5: '16:00' };
  for (let day = 1; day <= last.getUTCDate(); day++) {
    const key = `${month}-${String(day).padStart(2, '0')}`; const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();
    for (const course of state.courses) {
      if (course.deletedAt || course.archivedAt || !course.period || !times[course.period] || (term !== 'all' && course.term !== term)) continue;
      const rules = state.inbox.records.map(r => r.item).filter(item => item.type === 'event' && item.term === course.term && !item.needs_review);
      const inRange = (item: typeof rules[number]) => item.type === 'event' && isPlannerDate(item.data.starts_at, false) && dateKey(item.data.starts_at) <= key && dateKey(item.data.ends_at ?? item.data.starts_at) >= key;
      const periods = rules.filter(item => item.extensions?.['x-class-calendar'] === 'teaching_period');
      if (periods.length && !periods.some(inRange)) continue;
      if (rules.some(item => item.extensions?.['x-class-calendar'] === 'no_class' && inRange(item))) continue;
      const override = rules.find(item => typeof item.extensions?.['x-class-weekday'] === 'number' && inRange(item));
      const actualWeekday = override ? Number(override.extensions?.['x-class-weekday']) : weekday;
      if (course.weekday !== actualWeekday) continue;
      push({ id: `class:${course.id}:${key}`, title: course.title, kind: 'class', at: `${key}T${times[course.period]}`, done: false, courseId: course.id, detail: `${override ? '学年暦の曜日変更' : '通常時間割'} · ${course.period}限` });
    }
  }
  return result.filter(entry => displayDay(entry.at).startsWith(month) || (entry.end && displayDay(entry.at) < `${month}-01` && displayDay(entry.end) >= `${month}-01`)).sort((a, b) => a.at.localeCompare(b.at));
}
export function calendarDayEntries(entries: CalendarEntry[], day: string) { return entries.filter(e => displayDay(e.at) === day || (e.end && displayDay(e.at) <= day && displayDay(e.end) >= day)); }
export function mergePlanner(existing: PlannerState, incoming: PlannerState, courseMap: ReadonlyMap<string, string>): PlannerState {
  function merge<T extends { id: string }>(left: T[], right: T[]): T[] { const used = new Set(left.map(v => v.id)); return [...left, ...right.map(v => { let id = v.id; let n = 1; while (used.has(id)) id = `${v.id}-import-${n++}`; used.add(id); return { ...v, id }; })]; }
  return { version: 1, todos: merge(existing.todos, incoming.todos.map(t => ({ ...t, courseId: courseMap.get(t.courseId) ?? t.courseId }))), events: merge(existing.events, incoming.events) };
}

export function localPlannerDateTime(at: string) { return !at ? '' : at.length > 10 ? `${displayDay(at)}T${displayTime(at)}` : at; }
export function serializeEventDates(start: string, end: string, original?: Pick<PersonalEvent, 'start' | 'end'>) {
  const zoned = [original?.start, original?.end].some(value => value && /(Z|[+-]\d{2}:\d{2})$/.test(value));
  const serialize = (draft: string, previous = '') => {
    if (draft === localPlannerDateTime(previous)) return previous;
    return zoned && draft.length > 10 ? new Date(draft).toISOString() : draft;
  };
  return { start: serialize(start, original?.start), end: serialize(end, original?.end) };
}
