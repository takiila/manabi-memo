'use client';
import { useState, type ReactNode } from 'react';
import { homeTodos, localPlannerDay, displayDay, localPlannerDateTime, normalizeHomeLayout, type HomeLayout, type TodoRow } from './planner-model';
const KEY = 'manabi-home-layout-v1';
export function PlannerHome({ rows, onOpen, children }: { rows: TodoRow[]; onOpen: () => void; children: ReactNode }) {
  const [layout, setLayout] = useState<HomeLayout>(() => { try { const value = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY); return normalizeHomeLayout(value ? JSON.parse(value) : null); } catch { return normalizeHomeLayout(null); } }); const [error, setError] = useState('');
  function change(next: HomeLayout) { setLayout(next); try { localStorage.setItem(KEY, JSON.stringify(next)); setError(''); } catch { setError('この端末の表示設定を保存できませんでした。'); } }
  const today = localPlannerDay(); const upcoming = homeTodos(rows, today);
  const todo = layout.todo && <section className="planner-home-card"><div className="planner-heading"><div><small>今日・直近7日・優先表示</small><h2>今日やること</h2></div><button type="button" onClick={onOpen}>すべてのToDo（{rows.filter(r => !r.done).length}）</button></div>
    {!upcoming.length && <p>直近の未完了ToDoはありません。</p>}{upcoming.slice(0, 5).map(row => <button type="button" key={row.id} className="home-todo-row" onClick={onOpen}><span><strong>{row.title}</strong><small>{row.courseTitle}</small></span><small>{row.due ? `${localPlannerDateTime(row.due).replace('T', ' ')}${displayDay(row.due) < today ? ' · 期限切れ' : ''}` : '期限なし · 優先表示'}</small></button>)}{upcoming.length > 5 && <p>ほか{upcoming.length - 5}件</p>}
  </section>;
  return <div className="planner-home"><details className="home-customize"><summary>ホームをカスタマイズ</summary><p>表示設定はこの端末に保存します。非表示にしてもデータは残ります。</p><label><input type="checkbox" checked={layout.todo} onChange={e => change({ ...layout, todo: e.target.checked })} />今日やること</label><label><input type="checkbox" checked={layout.timetable} onChange={e => change({ ...layout, timetable: e.target.checked })} />時間割・最近のノート</label><label>表示順<select value={layout.todoFirst ? 'todo' : 'timetable'} onChange={e => change({ ...layout, todoFirst: e.target.value === 'todo' })}><option value="todo">ToDo → 時間割</option><option value="timetable">時間割 → ToDo</option></select></label>{error && <p role="alert">{error}</p>}</details>
    {layout.todoFirst && todo}{layout.timetable && children}{!layout.todoFirst && todo}{!layout.todo && !layout.timetable && <p>表示する項目をホームのカスタマイズから選べます。メニューのToDo・カレンダーは引き続き利用できます。</p>}
  </div>;
}
