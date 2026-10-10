'use client';
import { useState, type ReactNode } from 'react';
import { PlannerQuickEntry } from './planner-quick-entry';
import {
  addDateDays, homeTodos, localPlannerDay, displayDay, localPlannerDateTime, normalizeHomeLayout,
  type HomeLayout, type PersonalEvent, type PersonalTodo, type TodoRow,
} from './planner-model';

const KEY = 'manabi-home-layout-v1';

export function PlannerHome({ rows, events, disabled, onOpen, onOpenEvents, onAddEvent, onAddTodo, children }: {
  rows: TodoRow[];
  events: PersonalEvent[];
  disabled: boolean;
  onOpen: () => void;
  onOpenEvents: () => void;
  onAddEvent: (event: PersonalEvent) => void;
  onAddTodo: (todo: PersonalTodo) => void;
  children: ReactNode;
}) {
  const [layout, setLayout] = useState<HomeLayout>(() => {
    try {
      const value = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
      return normalizeHomeLayout(value ? JSON.parse(value) : null);
    } catch {
      return normalizeHomeLayout(null);
    }
  });
  const [error, setError] = useState('');
  function change(next: HomeLayout) {
    setLayout(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); setError(''); }
    catch { setError('この端末の表示設定を保存できませんでした。'); }
  }

  const today = localPlannerDay();
  const soon = addDateDays(today, 6);
  const upcomingTodos = homeTodos(rows, today);
  const upcomingEvents = events.filter(event => !event.deletedAt && displayDay(event.start) <= soon &&
    displayDay(event.end || event.start) >= today).sort((a, b) => a.start.localeCompare(b.start));

  const eventsWidget = layout.events && <section className="planner-home-card">
    <div className="planner-heading">
      <div><small>今日から7日間</small><h2>近日の予定</h2></div>
      <button type="button" onClick={onOpenEvents}>すべての予定</button>
    </div>
    {!upcomingEvents.length && <p>直近の個人予定はありません。ゼミ・通院などを「すぐ登録」から追加できます。</p>}
    {upcomingEvents.slice(0, 5).map(event => <button type="button" key={event.id} className="home-todo-row" onClick={onOpenEvents}>
      <span><strong>{event.title}</strong><small>{event.note}</small></span>
      <small>{localPlannerDateTime(event.start).replace('T', ' ')}</small>
    </button>)}
    {upcomingEvents.length > 5 && <p>ほか{upcomingEvents.length - 5}件</p>}
  </section>;

  const todoWidget = layout.todo && <section className="planner-home-card">
    <div className="planner-heading">
      <div><small>今日・直近7日・優先表示</small><h2>今日やること</h2></div>
      <button type="button" onClick={onOpen}>すべてのToDo（{rows.filter(row => !row.done).length}）</button>
    </div>
    {!upcomingTodos.length && <p>直近の未完了ToDoはありません。</p>}
    {upcomingTodos.slice(0, 5).map(row => <button type="button" key={row.id} className="home-todo-row" onClick={onOpen}>
      <span><strong>{row.title}</strong><small>{row.courseTitle}</small></span>
      <small>{row.due ? `${localPlannerDateTime(row.due).replace('T', ' ')}${displayDay(row.due) < today ? ' · 期限切れ' : ''}` : '期限なし · 優先表示'}</small>
    </button>)}
    {upcomingTodos.length > 5 && <p>ほか{upcomingTodos.length - 5}件</p>}
  </section>;

  return <div className="planner-home">
    <PlannerQuickEntry disabled={disabled} onAddEvent={onAddEvent} onAddTodo={onAddTodo}/>
    <details className="home-customize">
      <summary>ホームをカスタマイズ</summary>
      <p>表示設定はこの端末に保存します。非表示にしてもデータは残ります。</p>
      <label><input type="checkbox" checked={layout.events} onChange={e => change({ ...layout, events: e.target.checked })}/>近日の予定</label>
      <label><input type="checkbox" checked={layout.todo} onChange={e => change({ ...layout, todo: e.target.checked })}/>今日やること</label>
      <label><input type="checkbox" checked={layout.timetable} onChange={e => change({ ...layout, timetable: e.target.checked })}/>時間割・最近のノート</label>
      <label>表示順<select value={layout.todoFirst ? 'todo' : 'timetable'} onChange={e => change({ ...layout, todoFirst: e.target.value === 'todo' })}>
        <option value="todo">予定・ToDo → 時間割</option><option value="timetable">時間割 → 予定・ToDo</option>
      </select></label>
      {error && <p role="alert">{error}</p>}
    </details>
    {layout.todoFirst && <>{eventsWidget}{todoWidget}</>}
    {layout.timetable && children}
    {!layout.todoFirst && <>{eventsWidget}{todoWidget}</>}
    {!layout.todo && !layout.timetable && !layout.events && <p>表示する項目をホームのカスタマイズから選べます。メニューのToDo・カレンダーは引き続き利用できます。</p>}
  </div>;
}
