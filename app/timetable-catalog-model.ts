import type { InformationInbox } from './manabi-import-types';
import type { TransferCourse } from './course-transfer';
import { filterCatalogRecords } from './course-catalog-model.ts';
import { planInboxCourses } from './inbox-course-model.ts';

export function timetableCatalogCandidates(inbox: InformationInbox, term: string, weekday: number | null, period: number | null, query = '') {
  if (!term.trim() || (weekday === null) !== (period === null) || (weekday !== null && (!Number.isInteger(weekday) || weekday < 1 || weekday > 6)) || (period !== null && (!Number.isInteger(period) || period < 1 || period > 5))) throw new Error('対象の学期・曜日・授業枠を確認してください。');
  return filterCatalogRecords(inbox, { term, weekday: weekday === null ? '' : String(weekday), period: period === null ? '' : String(period), query });
}

export function planTimetableCandidate(courses: TransferCourse[], inbox: InformationInbox, id: string, term: string, weekday: number | null, period: number | null) {
  const matches = timetableCatalogCandidates(inbox, term, weekday, period).filter(record => record.id === id);
  if (matches.length !== 1) throw new Error('選んだ候補が対象の時間割にありません。もう一度選んでください。');
  return planInboxCourses(courses, matches)[0];
}
