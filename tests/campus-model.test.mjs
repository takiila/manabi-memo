import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_CAMPUS_STATE,
  calculateGpaProjection,
  isArchivedStudyTask,
  isWithinNextDays,
  normalizeCampusState,
  readLegacyCampusBundle,
  readLegacyCampusState,
  refreshGeneratedStudyTasks,
} from "../app/campus-model.ts";
import { parseCampusAccessMode } from "../lib/server/campus-access-policy.ts";
import { allowedAccountConfigurationValid, parseAllowedAccountEmails } from "../lib/server/account-access-policy.ts";

test("2〜3人運営のメール許可リストを正規化して重複排除する", () => {
  assert.deepEqual(parseAllowedAccountEmails(" A@example.test, b@example.test;A@EXAMPLE.TEST\n c@example.test "), [
    "a@example.test",
    "b@example.test",
    "c@example.test",
  ]);
  assert.deepEqual(parseAllowedAccountEmails(undefined), []);
  assert.equal(allowedAccountConfigurationValid("a@example.test,b@example.test,c@example.test"), true);
  assert.equal(allowedAccountConfigurationValid("a@example.test,b@example.test,c@example.test,d@example.test"), false);
});

test("少人数公開用Campusアクセスは明示設定時だけ全認証ユーザーへ開く", () => {
  assert.equal(parseCampusAccessMode("authenticated"), "authenticated");
  assert.equal(parseCampusAccessMode(" AUTHENTICATED "), "authenticated");
  assert.equal(parseCampusAccessMode(undefined), "invite");
  assert.equal(parseCampusAccessMode("invalid"), "invite");
});

test("欠損した旧Campusデータへ安全な既定値を補完する", () => {
  const normalized = normalizeCampusState({
    assignments: [{ id: "a1", title: "課題", dueISO: "2026-08-20T23:59", status: "broken" }],
    studyTasks: [{ id: "t1", sourceId: "a1", sourceType: "assignment", dueISO: "2026-08-18", title: "着手" }],
  });
  assert.equal(normalized.assignments[0].status, "todo");
  assert.equal(normalized.assignments[0].termId, "学期未設定");
  assert.equal(normalized.studyTasks[0].status, "todo");
  assert.equal(normalized.planningProfile.supportMode, "off");
});

test("試験・提出物からstable IDの学習タスクを冪等生成する", () => {
  const state = normalizeCampusState({
    ...EMPTY_CAMPUS_STATE,
    planningProfile: { ...EMPTY_CAMPUS_STATE.planningProfile, supportMode: "standard" },
    assignments: [{ id: "a1", title: "レポート", dueISO: "2026-08-20T23:59", status: "todo", termId: "2026前期" }],
    exams: [{ id: "e1", title: "期末試験", datetime: "2026-08-30T09:00", termId: "2026前期" }],
  });
  const once = refreshGeneratedStudyTasks(state, "2026-08-13");
  const twice = refreshGeneratedStudyTasks(once, "2026-08-13");
  assert.equal(once.studyTasks.length, 4);
  assert.deepEqual(twice.studyTasks.map((task) => task.id), once.studyTasks.map((task) => task.id));
});

test("完了から14日を超えた学習タスクだけをarchived扱いにする", () => {
  const task = normalizeCampusState({ studyTasks: [{ id: "t1", sourceId: "a1", sourceType: "assignment", title: "着手", dueISO: "2026-07-01", status: "done", doneAtISO: "2026-07-20" }] }).studyTasks[0];
  assert.equal(isArchivedStudyTask(task, "2026-08-03"), false);
  assert.equal(isArchivedStudyTask(task, "2026-08-04"), true);
});

test("Campusの直近7日は今日を含む7日間だけを対象にする", () => {
  assert.equal(isWithinNextDays("2026-08-13T23:59", "2026-08-13"), true);
  assert.equal(isWithinNextDays("2026-08-19T23:59", "2026-08-13"), true);
  assert.equal(isWithinNextDays("2026-08-20T00:00", "2026-08-13"), false);
  assert.equal(isWithinNextDays("2026-08-12", "2026-08-13"), false);
});

test("cmtr名前空間を読み取り、元キーを変更せず移行候補を作る", () => {
  const values = new Map([
    ["cmtr:assignments", JSON.stringify([{ id: "a1", title: "週次課題", dueISO: "2026-08-20", status: "todo" }])],
    ["cmtr:studyTasks", JSON.stringify([{ id: "t1", sourceType: "assignment", sourceId: "a1", title: "着手", dueISO: "2026-08-18" }])],
  ]);
  const storage = { getItem: (key) => values.get(key) ?? null };
  const migrated = readLegacyCampusState(storage, "2026年度 前期");
  assert.equal(migrated.assignments[0].termId, "2026年度 前期");
  assert.equal(migrated.studyTasks[0].sourceId, "a1");
  assert.equal(values.has("cmtr:assignments"), true);
});

test("旧CMTRの学期・授業IDと時間割配置を保った移行候補を作る", () => {
  const values = new Map([
    ["cmtr:terms", JSON.stringify([{ id: "term-2026-s", name: "2026年度 前期" }])],
    ["cmtr:activeTermId", JSON.stringify("term-2026-s")],
    ["cmtr:termViewMode", JSON.stringify("active")],
    ["cmtr:courses", JSON.stringify([{ id: "course-physics", name: "物理学", termId: "term-2026-s", teacher: "山田先生", classroom: "A101" }])],
    ["cmtr:timetable", JSON.stringify({ mon: [null, { courseId: "course-physics" }] })],
    ["cmtr:assignments", JSON.stringify([{ id: "assignment-1", courseId: "course-physics", termId: "term-2026-s", title: "レポート", dueISO: "2026-08-20" }])],
    ["cmtr:assignmentTemplates", JSON.stringify([{ id: "template-1", courseId: "course-physics", termId: "term-2026-s", title: "毎週の小レポート" }])],
    ["cmtr:exams", JSON.stringify([{ id: "exam-1", courseId: "course-physics", termId: "term-2026-s", title: "期末試験", datetime: "2026-08-30T09:00" }])],
    ["cmtr:studyTasks", JSON.stringify([{ id: "task-1", termId: "term-2026-s", sourceType: "assignment", sourceId: "assignment-1", title: "着手", dueISO: "2026-08-18" }])],
  ]);
  const storage = { getItem: (key) => values.get(key) ?? null };
  const bundle = readLegacyCampusBundle(storage, "学期未設定");
  assert.equal(bundle.activeTermName, "2026年度 前期");
  assert.equal(bundle.termViewMode, "active");
  assert.deepEqual(bundle.courses[0], {
    id: "course-physics",
    title: "物理学",
    termId: "term-2026-s",
    termName: "2026年度 前期",
    instructor: "山田先生",
    weekday: 1,
    period: 2,
    room: "A101",
    createdAt: bundle.courses[0].createdAt,
  });
  assert.equal(bundle.campus.assignments[0].courseId, "course-physics");
  assert.equal(bundle.campus.assignments[0].termId, "2026年度 前期");
  assert.equal(bundle.campus.assignmentTemplates[0].termId, "2026年度 前期");
  assert.equal(bundle.campus.exams[0].termId, "2026年度 前期");
  assert.equal(bundle.campus.studyTasks[0].termId, "2026年度 前期");
  assert.equal(bundle.campus.studyTasks[0].sourceId, "assignment-1");
  assert.equal(values.has("cmtr:courses"), true);
});

test("旧CMTRの未知の学期IDも学期一覧へ残して表示不能にしない", () => {
  const values = new Map([
    ["cmtr:assignments", JSON.stringify([{ id: "assignment-unknown-term", termId: "legacy-special-term", title: "特別課題", dueISO: "2026-09-01" }])],
  ]);
  const bundle = readLegacyCampusBundle({ getItem: (key) => values.get(key) ?? null }, "2026年度 前期");
  assert.ok(bundle);
  assert.equal(bundle.campus.assignments[0].termId, "legacy-special-term");
  assert.equal(bundle.termNames.includes("legacy-special-term"), true);
});

test("科目別評価計画から累積GPAを算出する", () => {
  const profile = normalizeCampusState({ gpaProfile: {
    currentGpa: 3,
    earnedCredits: 20,
    targetCumulativeGpa: 3.2,
    maxGpa: 4.3,
    plans: [
      { id: "p1", courseName: "A", credits: 2, targetGrade: "S" },
      { id: "p2", courseName: "B", credits: 2, targetGrade: "A" },
    ],
  } }).gpaProfile;
  const result = calculateGpaProjection(profile);
  assert.equal(result.plannedCredits, 4);
  assert.equal(result.plannedGpa, 4.15);
  assert.ok(result.projectedCumulative > 3);
});
