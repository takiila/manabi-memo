export type MemoReviewFields = {
  pinned?: boolean;
  reviewStage?: number;
  nextReviewAt?: string | null;
  lastReviewedAt?: string | null;
};

export type MemoReviewResult = "remembered" | "again";

const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14] as const;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function memoDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeMemoReview(value: MemoReviewFields | null | undefined): Required<MemoReviewFields> {
  const reviewStage = typeof value?.reviewStage === "number" && Number.isFinite(value.reviewStage)
    ? Math.min(REVIEW_INTERVAL_DAYS.length - 1, Math.max(0, Math.round(value.reviewStage)))
    : 0;
  return {
    pinned: value?.pinned === true,
    reviewStage,
    nextReviewAt: isDateKey(value?.nextReviewAt) ? value.nextReviewAt : null,
    lastReviewedAt: isDateKey(value?.lastReviewedAt) ? value.lastReviewedAt : null,
  };
}

export function startMemoReview(today = memoDateKey()): Required<MemoReviewFields> {
  return {
    pinned: false,
    reviewStage: 0,
    nextReviewAt: today,
    lastReviewedAt: null,
  };
}

export function scheduleMemoReview(
  value: MemoReviewFields,
  result: MemoReviewResult,
  today = memoDateKey(),
): Required<MemoReviewFields> {
  const current = normalizeMemoReview(value);
  if (result === "again") {
    return {
      ...current,
      reviewStage: 0,
      nextReviewAt: addDays(today, 1),
      lastReviewedAt: today,
    };
  }
  const interval = REVIEW_INTERVAL_DAYS[current.reviewStage];
  return {
    ...current,
    reviewStage: Math.min(REVIEW_INTERVAL_DAYS.length - 1, current.reviewStage + 1),
    nextReviewAt: addDays(today, interval),
    lastReviewedAt: today,
  };
}

export function isMemoReviewDue(value: MemoReviewFields, today = memoDateKey()) {
  const nextReviewAt = normalizeMemoReview(value).nextReviewAt;
  return Boolean(nextReviewAt && nextReviewAt <= today);
}

export function stopMemoReview(value: MemoReviewFields): Required<MemoReviewFields> {
  const current = normalizeMemoReview(value);
  return { ...current, reviewStage: 0, nextReviewAt: null };
}

function addDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_KEY_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}
