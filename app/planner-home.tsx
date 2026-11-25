'use client';
import { useState, type ReactNode } from 'react';
import { PlannerQuickEntry } from './planner-quick-entry';
import { AcademicAlerts } from './academic-alerts';
import type { AttendanceStatus } from './campus-model';
import {
  addDateDays, homeTodos, localPlannerDay, displayDay, localPlannerDateTime, normalizeHomeLayout,
  type HomeLayout, type PersonalEvent, type PersonalTodo, type TodoRow, type HomeAttendanceRow, type AcademicPriority,
} from './planner-model';

const KEY = 'manabi-home-layout-v1';

export function PlannerHome({ rows, events, disabled, onOpen, onOpenEvents, onAddEvent, onAddTodo, attendance, onReviewSources, academic, onBuildBrief, learning, children }: {
  rows: TodoRow[];
  events: PersonalEvent[];
  disabled: boolean;
  onOpen: () => void;
  onOpenEvents: () => void;
  onAddEvent: (event: PersonalEvent) => void;
  onAddTodo: (todo: PersonalTodo) => void;
  academic?: { items: AcademicPriority[]; onOpen: (item: AcademicPriority) => void };
  attendance?: { rows: HomeAttendanceRow[]; pending?: HomeAttendanceRow[]; onRecord: (row: HomeAttendanceRow, status: AttendanceStatus) => void; onOpen: () => void };
  onReviewSources?: () => void;
  onBuildBrief?: () => string;
  learning?: ReactNode;
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
  const [briefOpen, setBriefOpen] = useState(false);
  const [briefMessage, setBriefMessage] = useState('');
  const brief = briefOpen && !disabled && onBuildBrief ? onBuildBrief() : '';
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
    {!upcomingTodos.length && <p>登録済みの直近の未完了ToDoは0件です。未取得の課題や締切変更は含まれません。</p>}
    {upcomingTodos.slice(0, 5).map(row => <button type="button" key={row.id} className="home-todo-row" onClick={onOpen}>
      <span><strong>{row.title}</strong><small>{row.courseTitle}</small></span>
      <small>{row.due ? `${localPlannerDateTime(row.due).replace('T', ' ')}${displayDay(row.due) < today ? ' · 期限切れ' : ''}` : '期限なし · 優先表示'}</small>
    </button>)}
    {upcomingTodos.length > 5 && <p>ほか{upcomingTodos.length - 5}件</p>}
  </section>;

  return <div className="planner-home">
    <section className="planner-home-card" aria-label="大学情報の確認状況">
      <div className="planner-heading">
        <div><small>情報の確認状況</small><h2>大学側の最新情報：未照合</h2></div>
        {onReviewSources && <button type="button" onClick={onReviewSources}>大学情報Inboxを開く</button>}
      </div>
      <p>表示は登録済みの情報に基づきます。LMSの新着課題・締切変更・個別の休講や補講を自動確認していません。</p>
      <p>予定が0件でも、授業や提出物がないとは限りません。</p>
    </section>
    {academic && <section className="planner-home-card" aria-label="学業の優先事項">
      <div className="planner-heading"><div><small>登録済みの課題・試験・大学情報</small><h2>今、優先すること</h2></div>
        <a href="/connect/manabi">ChatGPT連携の管理</a>
        {onBuildBrief && <button type="button" onClick={() => { setBriefOpen(true); setBriefMessage(''); }}>ChatGPTへの相談文を作る</button>}
      </div>
      {brief && <div className="todo-detail">
        <p>相談文を確認してから、ご自身のChatGPTへ貼り付けてください。ノート本文・PDF・アカウント情報は含みません。</p>
        <textarea aria-label="ChatGPTへの相談文" readOnly value={brief} rows={5}/>
        <button type="button" onClick={async () => {
          try { await navigator.clipboard.writeText(brief); setBriefMessage('相談文をコピーしました。'); }
          catch { setBriefMessage('自動コピーできませんでした。上の相談文を選択してコピーしてください。'); }
        }}>相談文をコピー</button>
        <button type="button" onClick={() => { setBriefOpen(false); setBriefMessage(''); }}>閉じる</button>
        {briefMessage && <p role="status">{briefMessage}</p>}
      </div>}
      <AcademicAlerts items={academic.items} disabled={disabled}/>
      {!academic.items.length && <p>該当する登録済み情報はありません。未取得の課題・試験は含まれません。</p>}
      {(['urgent', 'overdue', 'upcoming', 'review'] as const).map(group => {
        const items = academic.items.filter(item => item.group === group);
        if (!items.length) return null;
        const label = { urgent: '今日・明日', overdue: '期限経過・対応確認', upcoming: '近日の課題・試験準備', review: '期限・日程未確認' }[group];
        return <section key={group}><h3>{label}（{items.length}件）</h3>
          {items.slice(0, 4).map(item => <button type="button" key={item.id} className="home-todo-row" onClick={() => academic.onOpen(item)}>
            <span><strong>{item.title}</strong><small>{item.courseTitle} · {item.reason}</small></span>
            <small>{item.at ? localPlannerDateTime(item.at).replace('T', ' ') : '日時未設定'}</small>
          </button>)}
          {items.length > 4 && <p>ほか{items.length - 4}件。全体ToDo・大学情報Inbox・試験管理で確認してください。</p>}
        </section>;
      })}
    </section>}
    {attendance && <section className="planner-home-card">
      <div className="planner-heading">
        <div><small>{today} · 未確認は欠席に含めません</small><h2>今日の出席</h2></div>
        <button type="button" onClick={attendance.onOpen}>出席・大学生活管理</button>
      </div>
      {!attendance.rows.length && <p>登録済みの今日の授業は0件です。休講・授業なしとは確定できません。</p>}
      {attendance.rows.map(row => <article key={row.courseId} className="today-course">
        <div><strong>{row.title}</strong><small> · {row.period ? `${row.period}限` : '時限未確認'} · {row.conflict ? '重複記録・要確認' : row.status === 'present' ? '出席' : row.status === 'late' ? '遅刻' : row.status === 'absent' ? '欠席' : '未確認'}</small></div>
        <div className="attendance-buttons" aria-label={`${row.title}の出席`}>
          {(['present', 'late', 'absent'] as const).map(status => <button key={status} type="button" disabled={disabled || row.conflict} aria-pressed={row.status === status} className={row.status === status ? 'active' : ''} onClick={() => attendance.onRecord(row, status)}>{status === 'present' ? '出席' : status === 'late' ? '遅刻' : '欠席'}</button>)}
        </div>
      </article>)}
      <p>時間割・学年暦・登録済み授業日をもとに表示しています。個別の休講・補講は確認してください。</p>
      {!!attendance.pending?.length && <details>
        <summary>過去7日間の未確認出席（{attendance.pending.length}件）</summary>
        <p>実際に授業があったことと出席状況を確認してから記録してください。未確認を欠席にはしません。</p>
        {attendance.pending.map(row => <article key={row.courseId + ':' + row.day} className="today-course">
          <div><strong>{row.title}</strong><small> · {row.day} · {row.conflict ? '重複記録・要確認' : '未確認'}</small></div>
          <div className="attendance-buttons" aria-label={row.day + ' ' + row.title + 'の出席'}>
            {(['present', 'late', 'absent'] as const).map(status => <button key={status} type="button" disabled={disabled || row.conflict} onClick={() => attendance.onRecord(row, status)}>{status === 'present' ? '出席' : status === 'late' ? '遅刻' : '欠席'}</button>)}
          </div>
        </article>)}
      </details>}
    </section>}
    {learning}
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
