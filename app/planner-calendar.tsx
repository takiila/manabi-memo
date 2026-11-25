'use client';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { PlannerWeekView, datesInWeek } from './planner-week-view';
import { addDateDays } from './planner-model';
import { calendarDayEntries, calendarEntries, localPlannerDateTime, localPlannerDay, type PlannerInput, type CalendarEntry } from './planner-model';
type CalendarView = 'week' | 'classes' | 'month';
function subscribeCalendarView(notify: () => void) {
  window.addEventListener('storage', notify);
  return () => window.removeEventListener('storage', notify);
}
function deviceCalendarView(): CalendarView {
  try {
    const stored = window.localStorage.getItem('manabi-calendar-view-v1');
    if (stored === 'week' || stored === 'classes' || stored === 'month') return stored;
    return window.matchMedia?.('(max-width: 700px)').matches ? 'month' : 'week';
  } catch { return 'week'; }
}
export const CALENDAR_LABELS = { todo: 'ToDo締切', work: '作業予定', assignment: '提出課題', study: '学習', exam: '試験', class: '授業', session: '授業回ノート', event: '個人予定', university: '大学情報' };
export function PlannerCalendar({ state, onTodo, onCourse, onEvent, onSession }: { state: PlannerInput; onTodo: (id: string) => void; onCourse: (id: string) => void; onEvent: (id: string) => void; onSession: (id: string) => void }) {
  const [month, setMonth] = useState(localPlannerDay().slice(0, 7)); const [day, setDay] = useState(localPlannerDay()); const [term, setTerm] = useState('all');
  const [showDone, setShowDone] = useState(false); const [showClass, setShowClass] = useState(true);
  const storedView = useSyncExternalStore<CalendarView>(subscribeCalendarView, deviceCalendarView, () => 'week');
  const [overrideView, setOverrideView] = useState<'week' | 'classes' | 'month' | null>(null);
  const view = overrideView ?? storedView;
  function changeView(next: 'week' | 'classes' | 'month') {
    setOverrideView(next);
    try { window.localStorage.setItem('manabi-calendar-view-v1', next); } catch { /* session only */ }
  }
  const sourceMonths = view === 'month' ? [month] : [...new Set(datesInWeek(day).map(date => date.slice(0, 7)))];
  const monthKey = sourceMonths.join(',');
  const entries = useMemo(() => {
    const all = monthKey.split(',').flatMap(key => calendarEntries(state, key, term));
    return [...new Map(all.map(entry => [entry.id, entry])).values()]
      .filter(e => (showDone || !e.done) && (showClass || e.kind !== 'class'));
  }, [state, monthKey, term, showDone, showClass]);
  const first = new Date(`${month}-01T12:00:00Z`); const count = new Date(first.getUTCFullYear(), first.getUTCMonth() + 1, 0).getDate(); const offset = (first.getUTCDay() + 6) % 7;
  function shift(amount: number) { const next = new Date(`${month}-01T12:00:00Z`); next.setUTCMonth(next.getUTCMonth() + amount); const value = next.toISOString().slice(0, 7); setMonth(value); setDay(`${value}-01`); }
  function shiftWeek(amount: number) { const next = addDateDays(day, amount * 7); setDay(next); setMonth(next.slice(0, 7)); }
  function open(entry: CalendarEntry) { if (entry.todoId) onTodo(entry.todoId); else if (entry.sessionId) onSession(entry.sessionId); else if (entry.kind === 'event' && entry.sourceId) onEvent(entry.sourceId); else if (entry.courseId) onCourse(entry.courseId); }
  const daily = calendarDayEntries(entries, day);
  return <section className="planner-calendar"><div className="planner-view-switch" role="group" aria-label="カレンダー表示方式">
    <button type="button" aria-pressed={view === 'week'} onClick={() => changeView('week')}>週間スケジュール</button>
    <button type="button" aria-pressed={view === 'classes'} onClick={() => changeView('classes')}>大学時間割</button>
    <button type="button" aria-pressed={view === 'month'} onClick={() => changeView('month')}>月表示</button>
  </div><div className="planner-toolbar">
    {view === 'month' ? <><button type="button" aria-label="前の月" onClick={() => shift(-1)}>‹</button><label>表示月<input type="month" value={month} onChange={e => { if (!e.target.value) return; setMonth(e.target.value); setDay(`${e.target.value}-01`); }} /></label><button type="button" aria-label="次の月" onClick={() => shift(1)}>›</button></>
    : <div className="planner-week-controls"><button type="button" aria-label="前の週" onClick={() => shiftWeek(-1)}>‹ 前週</button><strong>{datesInWeek(day)[0]} 〜 {datesInWeek(day)[6]}</strong><button type="button" aria-label="次の週" onClick={() => shiftWeek(1)}>次週 ›</button><button type="button" onClick={() => { const today = localPlannerDay(); setDay(today); setMonth(today.slice(0, 7)); }}>今日</button></div>}
    <label>学期<select value={term} onChange={e => setTerm(e.target.value)}><option value="all">すべて</option>{[...new Set(state.courses.filter(c => !c.deletedAt).map(c => c.term))].map(t => <option key={t}>{t}</option>)}</select></label>
    <label><input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} />完了済みも表示</label><label><input type="checkbox" checked={showClass} onChange={e => setShowClass(e.target.checked)} />通常時間割</label></div>
    <p className="planner-hint">取り込み済みの学年暦で授業期間・休講・曜日変更を反映します。未登録の休講・補講は自動判定できないため、授業情報と照合してください。</p>
    {view === 'month' ? <div className="calendar-grid" role="group" aria-label={`${month}のカレンダー`}>{['月', '火', '水', '木', '金', '土', '日'].map(v => <strong key={v}>{v}</strong>)}{Array.from({ length: offset }, (_, i) => <span key={`blank-${i}`} />)}
      {Array.from({ length: count }, (_, i) => { const key = `${month}-${String(i + 1).padStart(2, '0')}`; const rows = calendarDayEntries(entries, key); return <button type="button" key={key} className={`calendar-day${key === day ? ' selected' : ''}${key === localPlannerDay() ? ' today' : ''}`} aria-pressed={key === day} aria-label={`${key} ${rows.length}件`} onClick={() => setDay(key)}><b>{i + 1}</b>{rows.slice(0, 3).map(row => <span className={`calendar-chip kind-${row.kind}${row.done ? ' done' : ''}`} key={row.id}>{row.title}</span>)}{rows.length > 3 && <small>ほか{rows.length - 3}件</small>}</button>; })}</div>
    : <PlannerWeekView entries={entries} selectedDay={day} mode={view} onDay={setDay} onOpen={open} />}
    <h3>{day} の予定</h3>{!daily.length && <p>この日の予定はありません。</p>}<div className="calendar-agenda">{daily.map(row => <article key={row.id} className={`calendar-entry${row.done ? ' done' : ''}`}><div><small>{CALENDAR_LABELS[row.kind]} · {row.time || (row.kind === 'todo' || row.kind === 'assignment' ? '期限時刻未設定' : '時刻未設定')}{row.done ? ' · 完了' : ''}</small><h4>{row.title}</h4><p>{row.detail}</p>{row.end && <small>{localPlannerDateTime(row.at).replace('T', ' ')} 〜 {localPlannerDateTime(row.end).replace('T', ' ')}</small>}</div>
      {row.todoId || row.courseId || row.kind === 'event' ? <button type="button" onClick={() => open(row)}>開く</button> : null}{row.url && /^https?:\/\//i.test(row.url) && <a href={row.url} target="_blank" rel="noreferrer">出典</a>}
    </article>)}</div>
  </section>;
}
