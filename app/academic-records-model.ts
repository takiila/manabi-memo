import type { InformationInbox, InformationRecord } from './manabi-import-types';

export const correctionValues = ['submitted', 'unsubmitted', 'unknown', 'present', 'late', 'absent'] as const;
export type AcademicCorrection = {
  id: string; courseId: string; recordId: string; value: typeof correctionValues[number]; reason: string; recordedAt: string;
};
export function normalizeAcademicCorrections(value: unknown): AcademicCorrection[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('訂正履歴の保存形式を確認してください。');
  const seen = new Set<string>();
  return value.map(row => {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id || seen.has(row.id)
      || typeof row.courseId !== 'string' || !row.courseId || typeof row.recordId !== 'string' || !row.recordId
      || !correctionValues.includes(row.value) || typeof row.reason !== 'string' || !row.reason.trim()
      || typeof row.recordedAt !== 'string' || !Number.isFinite(Date.parse(row.recordedAt))) {
      throw new Error('訂正履歴の保存形式を確認してください。');
    }
    seen.add(row.id);
    const { id, courseId, recordId, value, reason, recordedAt } = row;
    return { id, courseId, recordId, value, reason, recordedAt };
  });
}

type Course = { id: string; title: string; term: string; code?: string; deletedAt?: unknown; archivedAt?: unknown };
type ManagedWork = { id: string; courseId: string; title: string; status?: string };
type Campus = { assignments: ManagedWork[]; exams: ManagedWork[]; academicCorrections?: AcademicCorrection[] };
type Kind = 'assignment' | 'exam' | 'attendance' | 'quiz' | 'grading' | 'material' | 'notice';
const titleKey = (value: string) => value.normalize('NFKC').replace(/[\s　]+/g, '');
const activityTitle = (value: string, course: Course) => {
  const normalized = titleKey(value);
  const name = titleKey(course.title);
  return normalized.startsWith(name) ? normalized.slice(name.length).replace(/^\|/, '') : normalized;
};
const knownNames: Record<string, string> = { JB5013: 'オペレーティングシステム', LB2609: '英語202' };
const text = (value: unknown) => typeof value === 'string' ? value : '';
const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
const localToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format();

function identify(record: InformationRecord): { key: string; kind: Kind } {
  const { item } = record;
  const id = text(item.id);
  // The two older import collections use different prefixes for the same Moodle activity.
  const assignment = /^(?:lms|history)\.assign\.(\d+)$/.exec(id);
  if (assignment) return { key: 'lms.assign.' + assignment[1], kind: 'assignment' };
  const explicit = item.extensions?.['x-academic-kind'];
  const kind = item.type === 'assignment' || item.type === 'exam' ? item.type
    : explicit === 'attendance' || explicit === 'quiz' || explicit === 'grading' || explicit === 'material' ? explicit
    : /^history\.quiz\./.test(id) ? 'quiz'
    : /^(?:candidate\.|os\.JB5013\.)/.test(id) ? 'attendance'
    : /^(?:coverage\.|syllabus\.)/.test(id) ? 'grading'
    : item.type === 'document' || /^books\./.test(id) ? 'material'
    : /^classroom\.JB5008\./.test(id) ? 'assignment' : 'notice';
  return { key: id ? record.collection + ':' + id : record.id, kind };
}

function resolveCourse(record: InformationRecord, courses: Course[]) {
  const { item } = record;
  const dataCode = 'course_code' in item.data ? item.data.course_code : item.type === 'course' ? item.data.code : null;
  const code = titleKey(text(dataCode || item.extensions?.['x-course-code'])).toUpperCase();
  const label = titleKey(knownNames[code] || item.title.split(/[｜|]/)[0]);
  const normalizedTitle = item.title.normalize('NFKC');
  const match = courses.filter(course => {
    if (course.deletedAt || course.archivedAt || !item.term || titleKey(item.term) !== titleKey(course.term)) return false;
    if (code && course.code) return titleKey(course.code).toUpperCase() === code;
    return label === titleKey(course.title) || (item.type === 'exam' && normalizedTitle.startsWith(course.title.normalize('NFKC') + ' '));
  });
  if (match.length === 1) return match[0];
}

function legacyDate(summary: string, term: unknown, pattern: RegExp) {
  const m = pattern.exec(summary);
  const year = /^(\d{4})年度/.exec(text(term))?.[1];
  if (!m || !year) return null;
  const yyyy = /後期/.test(text(term)) && +m[1] <= 3 ? String(+year + 1) : year;
  const formatted = yyyy + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0');
  return date(formatted);
}

export function projectAcademicRecords(inbox: InformationInbox, courses: Course[], campus: Campus, today = localToday()) {
  const grouped = new Map<string, { key: string; kind: Kind; course?: Course; records: InformationRecord[] }>();
  for (const record of inbox.records) {
    const { key, kind } = identify(record);
    const course = resolveCourse(record, courses);
    const identities = [{key, kind}];
    if (/^classroom\.JB5008\.\d{2}-\d{2}$/.test(record.item.id)) identities.push({key: key + ':attendance', kind: 'attendance'});
    for (const identity of identities) {
      const groupKey = JSON.stringify([course?.id ?? null, record.item.term ?? null, identity.key]);
      const group = grouped.get(groupKey) ?? { ...identity, course, records: [] };
      group.records.push(record);
      grouped.set(groupKey, group);
    }
  }
  return Array.from(grouped.values()).map(({ key, kind, course, records }) => {
    const sorted = [...records].sort((a, b) => Date.parse(text(b.item.extensions?.['x-observed-at']) || b.updatedAt) - Date.parse(text(a.item.extensions?.['x-observed-at']) || a.updatedAt));
    const primary = sorted.find(row => row.item.type === 'assignment' || row.item.type === 'exam') ?? sorted[0];
    const { item } = primary;
    const data = item.data;
    const evidence = sorted.map(row => {
      const { item: fact } = row;
      return {
        id: row.id, itemId: fact.id, title: fact.title, collection: row.collection, summary: fact.summary ?? null,
        source: { title: fact.source.title, kind: fact.source.kind, locator: fact.source.locator ?? null },
        observedAt: fact.extensions?.['x-observed-at'] ?? row.updatedAt,
        uncertainties: fact.uncertainties ?? [], needsReview: fact.needs_review === true,
        changeCount: row.history?.length ?? 0,
      };
    });
    const newest = sorted[0].item;
    const summary = text(newest.summary);
    const correctionHistory = (campus.academicCorrections ?? []).filter(row => row.courseId === course?.id && row.recordId === key);
    const correction = correctionHistory.at(-1) ?? null;
    const matches = course && (kind === 'assignment' || kind === 'exam')
      ? (kind === 'assignment' ? campus.assignments : campus.exams).filter(row => row.courseId === course.id && (row.id === key
        || activityTitle(row.title, course) === activityTitle(item.title, course))) : [];
    const managed = matches.length === 1 ? matches[0] : undefined;
    const legacyAssignment = /^history\.assign\./.test(newest.id);
    const classworkScore = /^classroom\.JB5008\./.test(newest.id) ? /^(\d+)\/(\d+)[。、]/.exec(summary) : null;
    const legacyStatus = legacyAssignment ? /LMS表示は(提出済み|未提出)/.exec(summary)?.[1] : null;
    const raw = newest.extensions?.['x-lms-submission-status']
      ?? (classworkScore || legacyStatus === '提出済み' ? 'submitted' : legacyStatus === '未提出' ? 'unsubmitted' : null);
    const isLogicReport = key === 'lms.assign.71364' && item.term === '2026年度 後期'
      && sorted.some(row => /12\/4[^。]*(?:公開|講義)/.test(text(row.item.summary)));
    const releaseAt = date(newest.extensions?.['x-release-at']) ?? (isLogicReport ? '2026-12-04' : null);
    const observedDue = date('due_at' in data ? data.due_at : null)
      ?? (legacyAssignment && !isLogicReport ? legacyDate(summary, item.term, /期限 (\d{1,2})\/(\d{1,2})\s+\d{2}:\d{2}（/) : null);
    const assignmentDue = isLogicReport ? null : observedDue;
    const pendingRelease = releaseAt !== null && today < releaseAt.slice(0, 10);
    const state = kind === 'assignment'
      ? correction ? correction.value
      : managed?.status === 'done' || raw === 'submitted' ? 'submitted'
      : pendingRelease || (!isLogicReport && raw === 'pending-release') ? 'pending-release'
      : isLogicReport ? 'unknown'
      : raw === 'overdue-unsubmitted' || (raw === 'unsubmitted' && assignmentDue !== null && assignmentDue.slice(0, 10) < today) ? 'overdue'
      : raw === 'unsubmitted' ? 'unsubmitted' : 'unknown'
      : kind === 'attendance' ? correction?.value ?? (/^candidate\./.test(item.id) || summary.includes('回答控えあり') ? 'candidate' : 'unknown')
      : kind === 'quiz' ? /完了/.test(summary) && /進行中/.test(summary) ? 'mixed-attempts' : /完了/.test(summary) ? 'completed' : /進行中/.test(summary) ? 'in-progress' : 'unknown'
      : null;
    const scoreMatch = kind === 'assignment' ? classworkScore : null;
    const score = newest.extensions?.['x-score'] ?? (scoreMatch ? Number(scoreMatch[1]) : null);
    const maxScore = newest.extensions?.['x-max-score'] ?? (scoreMatch ? Number(scoreMatch[2]) : null);
    const scoreKnown = (kind === 'assignment' || kind === 'quiz') && typeof score === 'number' && typeof maxScore === 'number' && Number.isFinite(score) && Number.isFinite(maxScore) && score >= 0 && maxScore > 0;
    const classDay = date(newest.extensions?.['x-class-day']) ?? legacyDate(
      /^os\.JB5013\./.test(item.id) ? item.title : /^candidate\./.test(item.id) ? item.title : summary, item.term,
      /^os\.JB5013\./.test(item.id) ? /(\d{2})\/(\d{2}) 出席確認/ : /^candidate\./.test(item.id) ? /(\d{1,2})月(\d{1,2})日/ : /授業日(\d{1,2})\/(\d{1,2})/);
    return {
      id: key, courseId: course?.id ?? null, term: item.term ?? null, kind, title: key.endsWith(':attendance') ? item.title + '（出席確認）' : item.title, state, releaseAt, classDay,
      dueAt: assignmentDue, startsAt: date('starts_at' in data ? data.starts_at : null),
      detail: ('instructions' in data ? data.instructions : 'scope' in data ? data.scope : null) ?? null,
      materialName: 'filename' in data ? data.filename ?? null : null,
      evaluationConditions: kind === 'grading' ? evidence.flatMap(row => row.summary ? [row.summary] : []) : [],
      evaluationWeights: kind === 'grading' ? evidence.flatMap(row =>
        Array.from((row.summary ?? '').matchAll(/(?:^|[。、・、\s])([\p{L}]{1,20})[：:]?\s*(\d{1,3})[%％]/gu), match => ({
          component: match[1], percent: Number(match[2]),
        })).filter(weight => weight.percent <= 100)) : [],
      score: scoreKnown ? { earned: score, max: maxScore } : null,
      attendanceAssignment: newest.extensions?.['x-attendance-assignment'] === true,
      lateSubmission: newest.extensions?.['x-late-submission'] === true || /^classroom\.JB5008\./.test(item.id) && summary.includes('期限後の完了'),
      officialAttendanceRule: typeof newest.extensions?.['x-official-attendance-rule'] === 'string' ? newest.extensions['x-official-attendance-rule'] : null,
      evidence, correctionHistory, managedId: managed?.id ?? null, managedConflict: matches.length > 1,
      inboxId: primary.id, source: item.source,
    };
  });
}

export function courseRecordTotals(records: ReturnType<typeof projectAcademicRecords>) {
  const count = (kind: Kind, state: string) => records.filter(row => row.kind === kind && row.state === state).length;
  const officialRules = [...new Set(records.flatMap(row => row.officialAttendanceRule ? [row.officialAttendanceRule] : []))];
  const confirmedLate = records.filter(row => row.kind === 'assignment' && row.state === 'submitted' && row.attendanceAssignment && row.lateSubmission).length;
  const mayHaveOfficialRule = records.some(row => row.kind === 'grading' && row.evaluationConditions.some(text => /出席|欠席|遅刻/.test(text)));
  return {
    assignment: { submitted: count('assignment', 'submitted'), unsubmitted: count('assignment', 'unsubmitted'), overdue: count('assignment', 'overdue'), pendingRelease: count('assignment', 'pending-release'), unknown: count('assignment', 'unknown') },
    attendance: { candidate: count('attendance', 'candidate'), unknown: count('attendance', 'unknown'), correctedPresent: count('attendance', 'present'), correctedLate: count('attendance', 'late'), correctedAbsent: count('attendance', 'absent') },
    quizzes: { completed: count('quiz', 'completed'), inProgress: count('quiz', 'in-progress'), mixedAttempts: count('quiz', 'mixed-attempts'), unknown: count('quiz', 'unknown') },
    gradedActivityCount: records.filter(row => row.score !== null).length,
    lateAttendanceAssignmentRule: {
      threshold: 3, confirmedLate, officialRules,
      provisionalAbsenceEquivalent: officialRules.length || mayHaveOfficialRule ? null : Math.floor(confirmedLate / 3),
      policy: '出席用と確認できた課題の提出遅れだけを集計。教員の正式基準を優先し、正式出席は更新しません。',
    },
  };
}
