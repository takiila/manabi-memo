'use client';
import { addDateDays, calendarDayEntries, displayDay, localPlannerDateTime, type CalendarEntry } from './planner-model';

const DAYS = ['月', '火', '水', '木', '金', '土', '日'];
const FIRST_HOUR = 8;
const LAST_HOUR = 23;
const HOUR_HEIGHT = 54;
const PERIODS = [
  { label: '1限', time: '08:40' },
  { label: '2限', time: '10:20' },
  { label: '3限', time: '12:40' },
  { label: '4限', time: '14:20' },
  { label: '5限', time: '16:00' },
];

export function mondayOf(day: string) {
  const weekday = new Date(day + 'T12:00:00Z').getUTCDay();
  return addDateDays(day, -((weekday + 6) % 7));
}

export function datesInWeek(day: string) {
  const monday = mondayOf(day);
  return DAYS.map((_, index) => addDateDays(monday, index));
}

function timeMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : -1;
}

function usableStart(entry: CalendarEntry, day: string) {
  const minutes = timeMinutes(entry.time);
  // A multi-day event is a continuation, not a new appointment at its start hour.
  return displayDay(entry.at) === day && minutes >= FIRST_HOUR * 60 && minutes < LAST_HOUR * 60 ? minutes : -1;
}

function positionHeight(entry: CalendarEntry, day: string, start: number) {
  const fallbackMinutes = entry.kind === 'class' ? 90 : 55;
  if (!entry.end || displayDay(entry.end) !== day) return fallbackMinutes / 60 * HOUR_HEIGHT;
  const end = timeMinutes(localPlannerDateTime(entry.end).slice(11, 16));
  const minutes = end > start ? end - start : fallbackMinutes;
  return Math.max(36, Math.min(minutes, LAST_HOUR * 60 - start) / 60 * HOUR_HEIGHT);
}

function EntryLabel({ entry, onOpen }: { entry: CalendarEntry; onOpen: (entry: CalendarEntry) => void }) {
  const text = <><strong>{entry.title}</strong>{entry.time && <small>{entry.time}</small>}</>;
  const className = 'planner-week-chip kind-' + entry.kind + (entry.done ? ' done' : '');
  const canOpen = Boolean(entry.todoId || entry.sessionId || entry.courseId || (entry.kind === 'event' && entry.sourceId));
  return canOpen
    ? <button type="button" className={className} title={entry.detail || entry.title} onClick={() => onOpen(entry)}>{text}</button>
    : <span className={className} title={entry.detail || entry.title}>{text}</span>;
}

export function PlannerWeekView({ entries, selectedDay, mode, onDay, onOpen }: {
  entries: CalendarEntry[];
  selectedDay: string;
  mode: 'week' | 'classes';
  onDay: (day: string) => void;
  onOpen: (entry: CalendarEntry) => void;
}) {
  const dates = datesInWeek(selectedDay);
  const lists = dates.map(date => calendarDayEntries(entries, date));
  return <div className="planner-week-scroll" aria-label={mode === 'week' ? '週間スケジュール' : '大学時間割'}>
    {mode === 'week' ? <>
      <div className="planner-week-head">
        <span>時刻</span>{dates.map((date, index) => <button type="button" key={date} aria-pressed={date === selectedDay} onClick={() => onDay(date)}>{DAYS[index]}<small>{date.slice(5)}</small></button>)}
      </div>
      <div className="planner-week-untimed">
        <small>終日・時刻未設定</small>{lists.map((list, index) => <div key={dates[index]}>{list.filter(entry => usableStart(entry, dates[index]) < 0).map(entry => <EntryLabel key={entry.id} entry={entry} onOpen={onOpen} />)}</div>)}
      </div>
      <div className="planner-week-hours">
        <div className="planner-week-gutter">
          {Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, index) => <small key={index} style={{ top: index * HOUR_HEIGHT }}>{String(index + FIRST_HOUR).padStart(2, '0')}:00</small>)}
        </div>
        {lists.map((list, index) => <div className="planner-week-time-column" key={dates[index]} style={{ height: (LAST_HOUR - FIRST_HOUR) * HOUR_HEIGHT }}>
          {list.filter(entry => usableStart(entry, dates[index]) >= 0).map(entry => {
            const start = usableStart(entry, dates[index]);
            return <div key={entry.id} className="planner-week-timed" style={{ top: (start - FIRST_HOUR * 60) / 60 * HOUR_HEIGHT, height: positionHeight(entry, dates[index], start) }}>
              <EntryLabel entry={entry} onOpen={onOpen} />
            </div>;
          })}
        </div>)}
      </div>
    </> : <>
      <div className="planner-class-head"><span>授業枠</span>{dates.slice(0, 6).map((date, index) => <button type="button" key={date} aria-pressed={date === selectedDay} onClick={() => onDay(date)}>{DAYS[index]}<small>{date.slice(5)}</small></button>)}</div>
      {PERIODS.map(period => <div className="planner-class-row" key={period.label}>
        <span>{period.label}<small>{period.time}</small></span>
        {dates.slice(0, 6).map(date => <div key={date}>
          {lists[dates.indexOf(date)].filter(entry => entry.kind === 'class' && entry.time === period.time && displayDay(entry.at) === date).map(entry => <EntryLabel key={entry.id} entry={entry} onOpen={onOpen} />)}
        </div>)}
      </div>)}
      <p className="planner-hint">提出期限・試験・個人予定・日時未指定の授業回は、下の「選択日の予定」で確認できます。日曜日も日別一覧から確認できます。</p>
    </>}
  </div>;
}
