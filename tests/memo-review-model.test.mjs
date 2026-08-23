import test from "node:test";
import assert from "node:assert/strict";
import {
  isMemoReviewDue,
  normalizeMemoReview,
  scheduleMemoReview,
  startMemoReview,
  stopMemoReview,
} from "../app/memo-review-model.ts";

test("old memos receive safe review defaults", () => {
  assert.deepEqual(normalizeMemoReview(undefined), {
    pinned: false,
    reviewStage: 0,
    nextReviewAt: null,
    lastReviewedAt: null,
  });
});

test("review starts today and remembered intervals expand", () => {
  const started = startMemoReview("2026-08-14");
  assert.equal(isMemoReviewDue(started, "2026-08-14"), true);

  const first = scheduleMemoReview(started, "remembered", "2026-08-14");
  assert.equal(first.nextReviewAt, "2026-08-15");
  const second = scheduleMemoReview(first, "remembered", "2026-08-15");
  assert.equal(second.nextReviewAt, "2026-08-18");
  const third = scheduleMemoReview(second, "remembered", "2026-08-18");
  assert.equal(third.nextReviewAt, "2026-08-25");
});

test("again returns the memo to the first interval without losing pin", () => {
  const next = scheduleMemoReview({ pinned: true, reviewStage: 3, nextReviewAt: "2026-08-14" }, "again", "2026-08-14");
  assert.equal(next.pinned, true);
  assert.equal(next.reviewStage, 0);
  assert.equal(next.nextReviewAt, "2026-08-15");
});

test("stopping review keeps pin and clears only the schedule", () => {
  const stopped = stopMemoReview({ pinned: true, reviewStage: 2, nextReviewAt: "2026-08-14" });
  assert.equal(stopped.pinned, true);
  assert.equal(stopped.nextReviewAt, null);
  assert.equal(isMemoReviewDue(stopped, "2026-08-20"), false);
});
