import { displayDay, localPlannerDateTime, type CalendarEntry } from './planner-model';

/** Timed appointments are laid out without overlapping click/tap targets. */
export const WEEK_FIRST_HOUR = 8;
export const WEEK_LAST_HOUR = 23;
export const WEEK_HOUR_HEIGHT = 54;
const MIN_VISIBLE_MINUTES = 40;

function minutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : -1;
}

export type PlacedWeekEntry = {
  entry: CalendarEntry;
  start: number;
  end: number;
  lane: number;
  laneCount: number;
};

export function timedRange(entry: CalendarEntry, day: string): { start: number; end: number } | null {
  const start = minutes(entry.time);
  if (displayDay(entry.at) !== day || start < WEEK_FIRST_HOUR * 60 || start >= WEEK_LAST_HOUR * 60) return null;
  const fallback = entry.kind === 'class' ? 90 : 55;
  let actualEnd = start + fallback;
  if (entry.end && displayDay(entry.end) === day) {
    const explicitEnd = minutes(localPlannerDateTime(entry.end).slice(11, 16));
    if (explicitEnd > start) actualEnd = explicitEnd;
  } else if (entry.end && displayDay(entry.end) > day) {
    actualEnd = WEEK_LAST_HOUR * 60;
  }
  // Very short events need enough space to be operated, so they reserve
  // a minimum vertical interval for collision detection as well.
  return { start, end: Math.min(WEEK_LAST_HOUR * 60, Math.max(start + MIN_VISIBLE_MINUTES, actualEnd)) };
}

export function layoutTimedWeekEntries(entries: CalendarEntry[], day: string): PlacedWeekEntry[] {
  const active = entries.flatMap(entry => {
    const range = timedRange(entry, day);
    return range ? [{ entry, ...range, lane: 0, laneCount: 1 }] : [];
  }).sort((a, b) => a.start - b.start || b.end - a.end || a.entry.id.localeCompare(b.entry.id));

  let group: typeof active = [];
  let groupEnd = -1;
  const flush = () => {
    if (!group.length) return;
    const lanes: number[] = [];
    for (const item of group) {
      let lane = lanes.findIndex(end => end <= item.start);
      if (lane < 0) { lane = lanes.length; lanes.push(item.end); }
      else lanes[lane] = item.end;
      item.lane = lane;
    }
    for (const item of group) item.laneCount = lanes.length;
    group = [];
    groupEnd = -1;
  };
  for (const item of active) {
    if (group.length && item.start >= groupEnd) flush();
    group.push(item);
    groupEnd = Math.max(groupEnd, item.end);
  }
  flush();
  return active;
}
