import assert from "node:assert/strict";
import test from "node:test";
import {
  incompleteMembers,
  isValidSharedDateTime,
  normalizeSharedCalendarSnapshot,
  sharedCalendarCacheKey,
  sharedCourseProgress,
} from "../app/shared-calendar-model.ts";

const members = [
  { email: "owner@example.test", displayName: "Owner" },
  { email: "other@example.test", displayName: "Other" },
  { email: "third@example.test", displayName: "Third" },
];

function event(id, overrides = {}) {
  return {
    id,
    kind: "assignment",
    termLabel: "2026年度 前期",
    courseLabel: "統計学",
    title: "共有課題",
    dueAt: "2026-09-01T17:00",
    note: "提出方法を確認",
    createdBy: "owner@example.test",
    updatedBy: "owner@example.test",
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
    deletedAt: null,
    completions: [],
    ...overrides,
  };
}

test("共有カレンダーのキャッシュを許可メンバーだけに正規化する", () => {
  const normalized = normalizeSharedCalendarSnapshot({
    currentUser: " OWNER@EXAMPLE.TEST ",
    members: [...members, { email: "not-an-email", displayName: "invalid" }],
    events: [event("event-0000000001", {
      completions: [
        { email: "other@example.test", completedAt: "2026-08-24T01:00:00.000Z" },
        { email: "outsider@example.test", completedAt: "2026-08-24T01:00:00.000Z" },
      ],
    }), { id: "bad", title: "invalid" }],
    fetchedAt: "2026-08-24T02:00:00.000Z",
  });
  assert.equal(normalized.currentUser, "owner@example.test");
  assert.equal(normalized.members.length, 3);
  assert.equal(normalized.events.length, 1);
  assert.deepEqual(normalized.events[0].completions.map((item) => item.email), ["other@example.test"]);
});

test("完了していないメンバーを表示名つきで返す", () => {
  const target = event("event-0000000002", { completions: [{ email: "owner@example.test", completedAt: "2026-08-24T01:00:00.000Z" }] });
  assert.deepEqual(incompleteMembers(target, members).map((member) => member.displayName), ["Other", "Third"]);
});

test("科目進捗は課題と確認事項だけをメンバー人数分で集計する", () => {
  const events = [
    event("event-0000000003", { completions: members.slice(0, 2).map((member) => ({ email: member.email, completedAt: "2026-08-24T01:00:00.000Z" })) }),
    event("event-0000000004", { kind: "check", completions: [{ email: "owner@example.test", completedAt: "2026-08-24T01:00:00.000Z" }] }),
    event("event-0000000005", { kind: "event", completions: members.map((member) => ({ email: member.email, completedAt: "2026-08-24T01:00:00.000Z" })) }),
    event("event-0000000006", { termLabel: "別学期" }),
  ];
  const progress = sharedCourseProgress(events, members, "2026年度 前期");
  assert.equal(progress.length, 1);
  assert.equal(progress[0].eventCount, 2);
  assert.equal(progress[0].completedChecks, 3);
  assert.equal(progress[0].totalChecks, 6);
  assert.equal(progress[0].percent, 50);
  assert.deepEqual(progress[0].incompleteMembers.sort(), ["other@example.test", "third@example.test"]);
});

test("共有キャッシュキーはメール表記を正規化する", () => {
  assert.equal(sharedCalendarCacheKey(" Owner@Example.Test "), "manabi-shared-calendar-v1:owner@example.test");
  assert.equal(sharedCalendarCacheKey("invalid"), "");
});

test("実在しない日時と30日を超えたごみ箱キャッシュを除外する", () => {
  assert.equal(isValidSharedDateTime("2026-02-28T23:59"), true);
  assert.equal(isValidSharedDateTime("2026-02-30T17:00"), false);
  assert.equal(isValidSharedDateTime("2026-12-01T24:00"), false);
  const normalized = normalizeSharedCalendarSnapshot({
    currentUser: "owner@example.test",
    members,
    events: [event("event-0000000007", { deletedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString() })],
    fetchedAt: new Date().toISOString(),
  });
  assert.equal(normalized.events.length, 0);
});
