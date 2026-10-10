'use client';
import { useEffect, useRef, useState } from 'react';
import { TagInput } from './planner-tag-input';
import { PlannerCalendar } from './planner-calendar';
import { TaskDates } from './memo-checklist';
import { isTrashExpired } from './data-safety-model';
import { serializeEventDates, localPlannerDateTime, projectTodos, type ChecklistItem, type PlannerInput, type PlannerState, type TodoRow, type PersonalEvent } from './planner-model';
const SOURCE = { memo: '付箋由来', personal: '個人ToDo', assignment: '提出課題', study: '学習タスク' };
export function PlannerPanel({ state, disabled, onPatch, onPlanner, onMemo, onCourse, onSession }: { state: PlannerInput; disabled: boolean; onPatch: (row: TodoRow, patch: Partial<ChecklistItem>) => void; onPlanner: (state: PlannerState) => void; onMemo: (id: string) => void; onCourse: (id: string) => void; onSession: (id: string) => void }) {
  const [tab, setTab] = useState<'todo' | 'calendar' | 'events'>('todo'); const [query, setQuery] = useState(''); const [courseId, setCourseId] = useState(''); const [kind, setKind] = useState(''); const [tags, setTags] = useState<string[]>([]); const [status, setStatus] = useState('todo'); const [sort, setSort] = useState('due'); const [open, setOpen] = useState(''); const [newText, setNewText] = useState('');
  const [eventId, setEventId] = useState('');
  const selectedEventRef = useRef<HTMLElement>(null);
  useEffect(() => { if (tab === 'events' && eventId) { selectedEventRef.current?.scrollIntoView({ block: 'center' }); selectedEventRef.current?.focus(); } }, [tab, eventId]);
  const rows = projectTodos(state); const allTags = [...new Set(rows.flatMap(row => row.tags))].sort();
  const filtered = rows.filter(row => (status === 'all' || row.done === (status === 'done')) && (!courseId || row.courseId === courseId) && (!kind || row.source === kind) && tags.every(tag => row.tags.includes(tag)) && `${row.title} ${row.courseTitle} ${row.sessionTitle} ${row.tags.join(' ')}`.toLocaleLowerCase('ja-JP').includes(query.toLocaleLowerCase('ja-JP'))).sort((a, b) => sort === 'priority' ? Number(b.priority) - Number(a.priority) || (a.due || '9999').localeCompare(b.due || '9999') : sort === 'course' ? a.courseTitle.localeCompare(b.courseTitle, 'ja') : (a.due || '9999').localeCompare(b.due || '9999'));
  function selectTodo(id: string) { setTab('todo'); setStatus('all'); setQuery(''); setCourseId(''); setKind(''); setTags([]); setOpen(id); }
  return <section className="planner-panel"><header className="planner-heading"><div><small>付箋から、毎日の予定へ</small><h1>やること・カレンダー</h1><p>未完了 {rows.filter(row => !row.done).length}件 · 登録したチェック項目と課題をまとめて確認できます。</p></div></header>
    <nav className="planner-tabs" aria-label="やることの表示"><button type="button" aria-pressed={tab === 'todo'} onClick={() => setTab('todo')}>全体ToDo</button><button type="button" aria-pressed={tab === 'calendar'} onClick={() => setTab('calendar')}>統合カレンダー</button><button type="button" aria-pressed={tab === 'events'} onClick={() => setTab('events')}>個人予定・ごみ箱</button></nav>
    {tab === 'calendar' && <PlannerCalendar onSession={onSession} state={state} onTodo={selectTodo} onCourse={onCourse} onEvent={id => { setTab('events'); setEventId(id); }} />}
    {tab === 'todo' && <><form className="planner-add" onSubmit={e => { e.preventDefault(); if (!newText.trim() || disabled) return; onPlanner({ ...state.planner, todos: [...state.planner.todos, { id: `todo-${crypto.randomUUID()}`, text: newText.trim(), courseId, tags: [], done: false, registered: true, priority: false, due: '', workAt: '', deletedAt: null }] }); setNewText(''); }}><input aria-label="個人ToDoを追加" placeholder="やることを直接追加する" value={newText} disabled={disabled} onChange={e => setNewText(e.target.value)} /><button type="submit" disabled={disabled || !newText.trim()}>追加</button></form>
      <div className="planner-toolbar"><label>検索<input value={query} placeholder="本文・講義・タグ" onChange={e => setQuery(e.target.value)} /></label><label>科目<select aria-label="科目" value={courseId} onChange={e => setCourseId(e.target.value)}><option value="">すべて</option>{state.courses.filter(c => !c.deletedAt).map(c => <option key={c.id} value={c.id}>{c.title} · {c.term}</option>)}</select></label>
      <label>種類<select aria-label="種類" value={kind} onChange={e => setKind(e.target.value)}><option value="">すべて</option>{Object.entries(SOURCE).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>状態<select aria-label="状態" value={status} onChange={e => setStatus(e.target.value)}><option value="todo">未完了</option><option value="done">完了済み</option><option value="all">すべて</option></select></label><label>並び順<select aria-label="並び順" value={sort} onChange={e => setSort(e.target.value)}><option value="due">期限が近い順</option><option value="priority">優先表示順</option><option value="course">科目順</option></select></label></div>
      {allTags.length > 0 && <div className="planner-tags" aria-label="タグの絞り込み（すべて一致）">{allTags.map(tag => <button type="button" key={tag} aria-pressed={tags.includes(tag)} onClick={() => setTags(tags.includes(tag) ? tags.filter(t => t !== tag) : [...tags, tag])}>#{tag}</button>)}</div>}
      {!filtered.length && <p className="planner-empty">この条件のToDoはありません。付箋のチェック項目で全体ToDoへの登録を選ぶか、上から追加できます。</p>}
      <div className="todo-list">{filtered.map(row => <article key={row.id} className={`todo-card${row.done ? ' is-done' : ''}`}>
        <div className="todo-summary"><label><input type="checkbox" disabled={disabled} checked={row.done} onChange={e => onPatch(row, { done: e.target.checked })} /><span><strong>{row.title || '名称未設定'}</strong><small>{SOURCE[row.source]} · {row.courseTitle}{row.sessionTitle ? ` · ${row.sessionTitle}` : ''}</small></span></label><span>{row.due ? localPlannerDateTime(row.due).replace('T', ' ') + (row.due.length === 10 ? ' · 時刻未設定' : '') : '期限なし'}</span></div>
        <div className="planner-actions"><button type="button" onClick={() => setOpen(open === row.id ? '' : row.id)} aria-expanded={open === row.id}>編集・詳細</button>{row.source === 'memo' && <button type="button" onClick={() => onMemo(row.sourceId)}>元の付箋{row.page ? ` · 資料${row.page}ページ` : ''}</button>}{row.tags.map(tag => <small key={tag}>#{tag}</small>)}</div>
        {open === row.id && <div className="todo-detail"><label>内容<input value={row.title} disabled={disabled} onChange={e => onPatch(row, { text: e.target.value })} /></label><TaskDates item={row} allowWork={row.source === 'memo' || row.source === 'personal'} disabled={disabled || row.source === 'study'} onChange={patch => onPatch(row, patch)} />{row.source === 'study' && <p>学習タスクの期限は大学生活の学習計画から管理します。</p>}
          {row.source === 'memo' && <button type="button" disabled={disabled} onClick={() => onPatch(row, { registered: false })}>全体ToDoから解除（付箋には残す）</button>}
          {row.source === 'personal' && <><label>タグ（カンマ区切り）<TagInput tags={state.planner.todos.find(t => t.id === row.itemId)?.tags ?? []} disabled={disabled} onChange={tags => onPlanner({ ...state.planner, todos: state.planner.todos.map(t => t.id === row.itemId ? { ...t, tags } : t) })} /></label><button type="button" disabled={disabled} onClick={() => onPatch(row, { deletedAt: new Date().toISOString() })}>ごみ箱へ</button></>}
        </div>}
      </article>)}</div>
    </>}
    {tab === 'events' && <><EventEditor disabled={disabled} onAdd={event => onPlanner({ ...state.planner, events: [...state.planner.events, event] })} />
      <div className="calendar-agenda">{state.planner.events.filter(e => !e.deletedAt).map(event => <article key={event.id} ref={event.id === eventId ? selectedEventRef : undefined} tabIndex={-1} id={`planner-event-${event.id}`} className={event.id === eventId ? 'selected-event' : undefined}><EventEditor event={event} disabled={disabled} onAdd={updated => onPlanner({ ...state.planner, events: state.planner.events.map(e => e.id === updated.id ? updated : e) })} /><button type="button" disabled={disabled} onClick={() => onPlanner({ ...state.planner, events: state.planner.events.map(e => e.id === event.id ? { ...e, deletedAt: new Date().toISOString() } : e) })}>ごみ箱へ</button></article>)}</div>
      <details><summary>個人ToDo・予定のごみ箱（30日間）</summary>{state.planner.todos.filter(t => t.deletedAt && !isTrashExpired(t)).map(todo => <p key={todo.id}>{todo.text}<button type="button" disabled={disabled} onClick={() => onPlanner({ ...state.planner, todos: state.planner.todos.map(t => t.id === todo.id ? { ...t, deletedAt: null } : t) })}>復元</button></p>)}{state.planner.events.filter(t => t.deletedAt && !isTrashExpired(t)).map(event => <p key={event.id}>{event.title}<button type="button" disabled={disabled} onClick={() => onPlanner({ ...state.planner, events: state.planner.events.map(t => t.id === event.id ? { ...t, deletedAt: null } : t) })}>復元</button></p>)}</details>
    </>}
  </section>;
}
function EventEditor({ event, disabled, onAdd }: { event?: PersonalEvent; disabled: boolean; onAdd: (event: PersonalEvent) => void }) {
  const source = JSON.stringify(event ?? null);
  const [baseline, setBaseline] = useState(source);
  const [draft, setDraft] = useState(() => eventDraft(event));
  const [error, setError] = useState('');
  if (source !== baseline) { setBaseline(source); setDraft(eventDraft(event)); setError(''); }
  const { title, day, time, end, endTime, note } = draft;
  const edit = (key: keyof typeof draft, value: string) => setDraft(current => ({ ...current, [key]: value }));
  return <form className="event-editor" onSubmit={e => {
    e.preventDefault();
    if (disabled) return;
    const draftStart = day + (time ? `T${time}` : '');
    const draftEnd = end ? end + (endTime ? `T${endTime}` : '') : '';
    const { start, end: finish } = serializeEventDates(draftStart, draftEnd, event);
    if (!title.trim() || !day || (end && (end < day || (end === day && time && endTime && endTime < time)))) { setError('タイトルと開始日を入力し、終了を開始以降にしてください。'); return; }
    onAdd({ id: event?.id ?? `event-${crypto.randomUUID()}`, title: title.trim(), start, end: finish, note, deletedAt: null });
    setError('');
    if (!event) setDraft(eventDraft());
  }}><h3>{event ? '個人予定を編集' : '個人予定を追加'}</h3><fieldset disabled={disabled}>
    <label>タイトル<input value={title} onChange={e => edit('title', e.target.value)} /></label>
    <label>開始日<input type="date" value={day} onChange={e => edit('day', e.target.value)} /></label>
    <label>開始時刻（任意）<input type="time" value={time} onChange={e => edit('time', e.target.value)} /></label>
    <label>終了日（任意）<input type="date" value={end} onChange={e => edit('end', e.target.value)} /></label>
    <label>終了時刻（任意）<input type="time" value={endTime} onChange={e => edit('endTime', e.target.value)} /></label>
    <label>メモ<input value={note} onChange={e => edit('note', e.target.value)} /></label><button type="submit">{event ? '更新' : '追加'}</button>
  </fieldset>{error && <p role="alert">{error}</p>}</form>;
}

function eventDraft(event?: PersonalEvent) {
  const start = localPlannerDateTime(event?.start ?? '');
  const end = localPlannerDateTime(event?.end ?? '');
  return { title: event?.title ?? '', day: start.slice(0, 10), time: start.slice(11, 16), end: end.slice(0, 10), endTime: end.slice(11, 16), note: event?.note ?? '' };
}
