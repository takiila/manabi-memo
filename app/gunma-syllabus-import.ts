import { parseManabiImport } from './manabi-import-model.ts';
import type { ImportItem, ManabiImport } from './manabi-import-types';

export const GUNMA_SYLLABUS_COLLECTION = 'gunma-public-syllabus';

type CourseKey = { academicYear: number; courseCode: string };

const syllabusOrigin = 'https://www.kyomu-sys.gunma-u.ac.jp';
const detailPath = '/portal/Public/Syllabus/DetailMain.aspx';

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nonempty(value: unknown) {
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

function verifiedSource(value: unknown, { academicYear, courseCode }: CourseKey) {
  const url = URL.parse(nonempty(value) ?? '');
  if (!url || url.origin !== syllabusOrigin || url.username || url.password || url.hash
    || url.pathname.toLowerCase() !== detailPath.toLowerCase()
    || url.searchParams.size !== 3 || url.searchParams.get('je_cd') !== '1'
    || url.searchParams.get('lct_cd') !== courseCode || url.searchParams.get('lct_year') !== String(academicYear)) {
    throw new Error('群馬大学の公開シラバス詳細URLを確認できません。');
  }
  const source = new URL(detailPath, syllabusOrigin);
  source.search = new URLSearchParams({ je_cd: '1', lct_cd: courseCode, lct_year: String(academicYear) }).toString();
  return source.href;
}

/** Maps an already retrieved public detail into one Inbox candidate. No university requests or writes. */
export function parseGunmaSyllabusDetail(raw: unknown, expected: CourseKey): ManabiImport {
  const { academicYear, courseCode } = expected;
  const detail = object(raw);
  const title = nonempty(detail.title);
  const semester = nonempty(detail.semester);
  if (!Number.isInteger(academicYear) || academicYear < 2000 || academicYear > 2200
    || !/^[A-Z0-9][A-Z0-9-]{0,39}$/.test(courseCode) || detail.university !== '群馬大学'
    || detail.year !== academicYear || detail.course_code !== courseCode || !title || !semester) {
    throw new Error('群馬大学の科目名・年度・学期・時間割コードを照合できません。');
  }
  const url = verifiedSource(detail.source_url, expected);
  const term = `${academicYear}年度 ${semester.replace(/^(前|後)学期$/, '$1期')}`;
  const instructor = nonempty(detail.instructors);
  const creditsText = nonempty(detail.credits)?.normalize('NFKC');
  const creditValue = typeof detail.credits === 'number' ? detail.credits
    : creditsText && /^\d+(?:\.\d+)?$/.test(creditsText) ? Number(creditsText) : NaN;
  const credits = creditValue >= 0 && creditValue <= 30 ? creditValue : undefined;

  const sections = object(detail.sections);
  const gradingMethod = nonempty(detail.grading);
  const gradingWeights = nonempty(sections['評価配分']);
  const attendance = nonempty(sections['出席要件']);
  const creditRequirement = nonempty(sections['単位取得条件']);
  const uncertainties = [
    '公開シラバスから本人の履修状態や授業日程は確認できません。',
    ...(!instructor ? ['担当教員が未確認です。'] : []),
    ...(credits === undefined ? ['単位数が未確認です。'] : []),
    ...(!gradingMethod ? ['成績評価方法が未確認です。'] : []),
    ...(!attendance ? ['出席要件が未確認です。'] : []),
    ...(!creditRequirement ? ['単位取得条件が未確認です。'] : []),
  ];
  const item: ImportItem = {
    id: `gunma.${academicYear}.${courseCode}`,
    type: 'course',
    title,
    source: { kind: 'syllabus', title: '群馬大学 公開シラバス', url },
    data: { code: courseCode, term, instructor, credits, syllabus_url: url },
    needs_review: true,
    uncertainties,
    extensions: {
      ...(gradingMethod ? { 'x-grading-method': gradingMethod } : {}),
      ...(gradingWeights ? { 'x-grading-weights': gradingWeights } : {}),
      ...(attendance ? { 'x-attendance-requirement': attendance } : {}),
      ...(creditRequirement ? { 'x-credit-requirement': creditRequirement } : {}),
    },
  };
  return parseManabiImport(JSON.stringify({ schema_version: '1.0', collection: GUNMA_SYLLABUS_COLLECTION, items: [item] }));
}
