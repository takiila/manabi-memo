// Study evidence is explicit and append-only; viewing an answer is not mastery.
export const STUDY_OUTCOMES = ['planned', 'explanation', 'hinted', 'independent', 'retained'] as const;
export type StudyOutcome = typeof STUDY_OUTCOMES[number];
export type StudyEvidence = { id: string; courseId: string; topic: string; outcome: StudyOutcome; day: string; minutes: number; createdAt: string };
export const OUTCOME_LABELS: Record<StudyOutcome, string> = { planned: '未着手・試験範囲', explanation: '解説を確認', hinted: 'ヒントありで解答', independent: '自力で解答', retained: '日を空けて自力で解答' };
export function studyDay(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
}
function validDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value+'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === value;
}
export function normalizeStudyEvidence(value: unknown): StudyEvidence[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10000) throw new Error('学習記録の形式が不正です。');
  const ids = new Set<string>();
  return value.map(raw => {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id || raw.id.length > 180 || ids.has(raw.id) ||
        typeof raw.courseId !== 'string' || !raw.courseId || raw.courseId.length > 180 ||
        typeof raw.topic !== 'string' || !raw.topic.trim() || raw.topic.length > 160 ||
        !STUDY_OUTCOMES.includes(raw.outcome) || !validDay(raw.day) ||
        !Number.isInteger(raw.minutes) || raw.minutes < 0 || raw.minutes > 1440 || (raw.outcome === 'planned' && raw.minutes !== 0) ||
        typeof raw.createdAt !== 'string' || !Number.isFinite(Date.parse(raw.createdAt))) throw new Error('学習記録の形式が不正です。元の情報は変更していません。');
    ids.add(raw.id);
    return { id: raw.id, courseId: raw.courseId, topic: raw.topic.trim(), outcome: raw.outcome, day: raw.day, minutes: raw.minutes, createdAt: raw.createdAt };
  });
}
export function addEvidence(records: StudyEvidence[], record: StudyEvidence) {
  if (records.some(item => item.id === record.id)) return records;
  return normalizeStudyEvidence([...records, record]);
}
function addDays(day: string, days: number) {
  const date = new Date(day+'T12:00:00Z'); date.setUTCDate(date.getUTCDate()+days); return date.toISOString().slice(0,10);
}
export function reviewTopics(records: StudyEvidence[], today: string) {
  if (!validDay(today)) return [];
  const latest = new Map<string, StudyEvidence>();
  for (const item of records.filter(item => item.day <= today).sort((a,b) => a.day.localeCompare(b.day) || a.createdAt.localeCompare(b.createdAt))) {
    const key=JSON.stringify([item.courseId,item.topic.normalize('NFKC').trim()]);
    if(item.outcome==='planned' && latest.has(key))continue;
    latest.set(key,item);
  }
  const offsets: Record<StudyOutcome, number> = { planned: 0, explanation: 1, hinted: 1, independent: 3, retained: 7 };
  return [...latest.values()].map(item => ({ ...item, reviewOn: addDays(item.day,offsets[item.outcome]) }))
    .sort((a,b) => a.reviewOn.localeCompare(b.reviewOn) || a.topic.localeCompare(b.topic,'ja'));
}
export type PlanCandidate = { id: string; title: string; group: 'urgent'|'overdue'|'upcoming'|'review'; source: 'task'|'exam'|'inbox' };
export function dailyStudyPlan(items: PlanCandidate[], topics: ReturnType<typeof reviewTopics>, today: string, budget: number) {
  const available = Math.max(0,Math.min(240,Math.floor(Number.isFinite(budget) ? budget : 0)));
  const checks = items.filter(item => item.source === 'inbox' || item.group === 'review' || item.group === 'overdue');
  const assignments = items.filter(item => item.source === 'task' && !item.id.startsWith('study:') && ['urgent','upcoming'].includes(item.group));
  const exam = items.find(item => item.source === 'exam' && item.group !== 'review');
  const topic = topics.find(item => item.reviewOn <= today);
  const blocks: { title: string; minutes: number; reason: string }[] = [];
  let remaining = available;
  function block(title:string,minutes:number,reason:string) {
    const amount = Math.min(remaining,minutes); if(amount<=0)return;
    blocks.push({title,minutes:amount,reason}); remaining-=amount;
  }
  if(checks.length) block('期限・大学情報を確認',10,'未照合・期限経過は解決済みとみなさない');
  if(assignments.length) block(assignments[0].title, Math.max(15,remaining-(topic||exam?10:0)), '締切の近い課題に着手（完了時間は未確認）');
  if(topic) block(topic.topic+(topic.outcome==='planned'?'：範囲を確認し演習1問':'：解答を見ずに復習'),15,topic.outcome==='planned'?'未着手の試験範囲です':'前回の学習結果から復習予定日を迎えています');
  else if(exam) block(exam.title+'：範囲確認と演習1問',15,'試験準備を少しでも開始する');
  return { available, blocks, remaining, checks: checks.length, urgent: items.filter(item=>item.group==='urgent').length };
}

export function weeklyLearning(records: StudyEvidence[],today:string) {
  if(!validDay(today))return {days:0,minutes:0,independent:0,attempts:0};
  const start=addDays(today,-6);
  const attempts=records.filter(row=>row.day>=start&&row.day<=today&&row.outcome!=='planned');
  return {days:new Set(attempts.map(row=>row.day)).size,minutes:attempts.reduce((sum,row)=>sum+row.minutes,0),independent:attempts.filter(row=>row.outcome==='independent'||row.outcome==='retained').length,attempts:attempts.length};
}
