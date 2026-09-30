import type { TransferCourse } from './course-transfer';
import type { ImportItem } from './manabi-import-types';

export type CourseEntry = { collection: string; item: ImportItem };
export type InboxCourseRow = { key: string; entry: CourseEntry; course: TransferCourse; existing?: TransferCourse; kind: 'add' | 'update' | 'same' | 'blocked'; warnings: string[] };
export function courseEntryKey(entry: CourseEntry) { return JSON.stringify([entry.collection, entry.item.id]); }
export function normalizeImportTerm(term: string) {
  return term.trim().replace(/^(\d{4})年度\s*(前|後)(?:学期|期)$/, '$1年度 $2期');
}

export function planInboxCourses(existing: TransferCourse[], entries: CourseEntry[], terms: Record<string, string> = {}): InboxCourseRow[] {
  const rows = entries.filter(entry => entry.item.type === 'course').map((entry): InboxCourseRow => {
    if (entry.item.type !== 'course') throw new Error('講義情報ではありません。');
    const key = courseEntryKey(entry), data = entry.item.data;
    const term = normalizeImportTerm(terms[key] ?? data.term ?? entry.item.term ?? '');
    const id = `import-course:${JSON.stringify([entry.collection, entry.item.id, term])}`;
    const matches = existing.filter(course => normalizeImportTerm(course.term) === term && (course.id === id || (data.code ? course.code === data.code || (!course.code && course.title === entry.item.title) : course.title === entry.item.title)));
    const previous = matches[0];
    const course: TransferCourse = {
      ...previous, id: previous?.id ?? id, title: entry.item.title, term,
      code: data.code ?? previous?.code,
      instructor: data.instructor ?? previous?.instructor ?? '', room: data.room ?? previous?.room ?? '',
      weekday: data.weekday ?? previous?.weekday ?? null, period: data.period ?? previous?.period ?? null,
      credits: data.credits ?? previous?.credits ?? null,
      syllabusUrl: data.syllabus_url ?? previous?.syllabusUrl ?? '',
      notes: previous?.notes ?? entry.item.summary ?? '', createdAt: previous?.createdAt ?? '',
    };
    const warnings: string[] = [];
    const termMissing = !/^(?:20\d{2}|21\d{2}|2200)年度\s*(?:前期|後期|通年|[春夏秋冬]学期|第[1-4](?:四半期|クォーター)|[1-4]Q)$/.test(term);
    if (termMissing) warnings.push('対象年度・学期を入力してください。年次だけでは年度を確定できません。');
    if (course.weekday === null || course.period === null) warnings.push('曜日・時限が未確認です。時間割の「未配置」に登録し、授業ノートは使えます。');
    if (entry.item.needs_review || entry.item.uncertainties?.length) warnings.push(...(entry.item.uncertainties ?? []), ...(entry.item.needs_review ? ['AIの要確認情報があります。出典を確認してください。'] : []));
    const blocked = termMissing || matches.length > 1 || Boolean(previous?.deletedAt || previous?.archivedAt);
    if (matches.length > 1 || previous?.deletedAt || previous?.archivedAt) warnings.push('同じ講義が複数あるか、ごみ箱・保管中です。先に整理してください。');
    const changed = previous && ['title', 'term', 'code', 'instructor', 'room', 'weekday', 'period', 'credits', 'syllabusUrl'].some(field => (previous[field as keyof TransferCourse] ?? '') !== (course[field as keyof TransferCourse] ?? ''));
    return { key, entry, course, existing: previous, kind: blocked ? 'blocked' : !previous ? 'add' : changed ? 'update' : 'same', warnings };
  });
  for (const row of rows) {
    if (rows.filter(other => other.key === row.key).length > 1) row.kind = 'blocked';
    if (courseSelectionConflict(rows.filter(other => other === row || sameCourseTarget(other, row)))) row.warnings.push('複数の入力が同じ講義に一致します。チェックする対象を一つに絞ってください。');
    if (row.course.weekday !== null && [...existing.filter(course => course.id !== row.course.id && !course.deletedAt && !course.archivedAt), ...rows.filter(other => other !== row).map(other => other.course)].some(course => course.term === row.course.term && course.weekday === row.course.weekday && course.period === row.course.period)) row.warnings.push('同じ曜日・時限の講義と重なります。既存講義の配置は変更しません。');
  }
  return rows;
}

function sameCourseTarget(left: InboxCourseRow, right: InboxCourseRow) {
  return left.key === right.key || left.course.id === right.course.id || (left.course.term === right.course.term && (left.course.code && right.course.code ? left.course.code === right.course.code : left.course.title === right.course.title));
}

export function courseSelectionConflict(rows: InboxCourseRow[]) {
  return rows.some((row, index) => rows.some((other, otherIndex) => index !== otherIndex && sameCourseTarget(row, other)));
}

export function applyInboxCourses(existing: TransferCourse[], rows: InboxCourseRow[], selected: string[], baseline: string): TransferCourse[] {
  if (JSON.stringify(existing) !== baseline) throw new Error('確認後に講義が変わりました。もう一度解析してください。');
  if (selected.some(key => !rows.some(row => row.key === key))) throw new Error('選択された講義がプレビューにありません。');
  if (courseSelectionConflict(rows.filter(row => selected.includes(row.key)))) throw new Error('選択した講義が重複しています。一つだけ選んでください。');
  const result = existing.slice();
  for (const row of rows.filter(row => selected.includes(row.key))) {
    if (row.kind === 'blocked') throw new Error('対象学期や重複を確認してから反映してください。');
    if (row.kind === 'add') result.push({ ...row.course, createdAt: new Date().toISOString() });
    if (row.kind === 'update') {
      const index = result.findIndex(course => course.id === row.course.id);
      result[index] = row.course;
    }
  }
  return result;
}

export function ensureCourseNotes<Session extends { courseId: string }>(courses: TransferCourse[], sessions: Session[], create: (course: TransferCourse) => Session): Session[] {
  return [...sessions, ...courses.filter(course => !course.deletedAt && !course.archivedAt && !sessions.some(session => session.courseId === course.id)).map(create)];
}
