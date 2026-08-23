import assert from "node:assert/strict";
import test from "node:test";
import { createBackupFile, inspectBackupFile } from "../app/backup.ts";
import { mergeImportedState } from "../app/data-migration-model.ts";
import { normalizeCampusState } from "../app/campus-model.ts";

test("PDFを含むバックアップをSHA-256検証付きで往復できる", async () => {
  const state = {
    courses: [{ id: "course-1", title: "情報社会論" }],
    sessions: [{ id: "session-1", noteText: "自分の考え" }],
    memos: [{ id: "memo-1", text: "重要" }],
  };
  const pdfBytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
  const backup = await createBackupFile(state, [
    { id: "session-1", blob: new Blob([pdfBytes], { type: "application/pdf" }) },
  ]);
  const file = new File([backup], "sample.manabimemo", { type: backup.type });
  const inspected = await inspectBackupFile(file);

  assert.deepEqual(inspected.manifest.state, state);
  assert.match(inspected.manifest.pdfs[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(inspected.pdfs.length, 1);
  assert.equal(inspected.pdfs[0].id, "session-1");
  assert.equal(inspected.legacy, false);
  assert.deepEqual(new Uint8Array(await inspected.pdfs[0].blob.arrayBuffer()), pdfBytes);
});

test("同じサイズのPDF内部破損をSHA-256で拒否する", async () => {
  const backup = await createBackupFile({ courses: [], sessions: [], memos: [] }, [
    { id: "session-1", blob: new Blob([new Uint8Array([1, 2, 3])], { type: "application/pdf" }) },
  ]);
  const bytes = new Uint8Array(await backup.arrayBuffer());
  bytes[bytes.length - 1] ^= 0xff;
  await assert.rejects(
    () => inspectBackupFile(new File([bytes], "corrupt.manabimemo")),
    /破損/,
  );
});

test("壊れたPDF境界を拒否する", async () => {
  const backup = await createBackupFile({ courses: [], sessions: [], memos: [] }, [
    { id: "session-1", blob: new Blob([new Uint8Array([1, 2, 3])], { type: "application/pdf" }) },
  ]);
  const file = new File([backup, new Uint8Array([4])], "broken.manabimemo");
  await assert.rejects(() => inspectBackupFile(file), /末尾|構造/);
});

test("重複したPDF IDの書き出しを拒否する", async () => {
  await assert.rejects(
    () => createBackupFile({}, [
      { id: "session-1", blob: new Blob([new Uint8Array([1])]) },
      { id: "session-1", blob: new Blob([new Uint8Array([2])]) },
    ]),
    /不正/,
  );
});

test("旧JSONバックアップをPDFなしとして読み込める", async () => {
  const state = { courses: [], sessions: [], memos: [] };
  const file = new File([
    JSON.stringify({ format: "manabi-memo-backup", version: 1, exportedAt: "2026-08-13T00:00:00.000Z", state }),
  ], "legacy.json", { type: "application/json" });
  const inspected = await inspectBackupFile(file);

  assert.deepEqual(inspected.manifest.state, state);
  assert.equal(inspected.manifest.exportedAt, "2026-08-13T00:00:00.000Z");
  assert.deepEqual(inspected.pdfs, []);
  assert.equal(inspected.legacy, true);
});

test("バックアップmergeはCampusの衝突レコードを再ID化し、参照とPDFを追従させる", () => {
  const campus = (suffix) => normalizeCampusState({
    assignments: [{ id: "assignment-1", courseId: "course-1", termId: "2026年度 前期", title: `${suffix}課題`, dueISO: "2026-08-20" }],
    assignmentTemplates: [{ id: "template-1", courseId: "course-1", termId: "2026年度 前期", title: `${suffix}テンプレート` }],
    exams: [{ id: "exam-1", courseId: "course-1", termId: "2026年度 前期", title: `${suffix}試験`, datetime: "2026-08-30T09:00" }],
    attendanceRecords: [{ id: "attendance-1", courseId: "course-1", dateISO: "2026-08-13" }],
    studyTasks: [
      { id: "task-1", termId: "2026年度 前期", sourceType: "assignment", sourceId: "assignment-1", title: `${suffix}着手`, dueISO: "2026-08-18" },
      { id: "exam-task-1", termId: "2026年度 前期", sourceType: "exam", sourceId: "exam-1", title: `${suffix}試験対策`, dueISO: "2026-08-28" },
    ],
  });
  const state = (suffix) => ({
    courses: [{ id: "course-1", title: "情報社会論", term: "2026年度 前期", weekday: null, period: null }],
    sessions: [{ id: "session-1", courseId: "course-1", course: "情報社会論" }],
    memos: [{ id: "memo-1", sessionId: "session-1", courseId: "course-1", course: "情報社会論" }],
    globalTags: [],
    courseTags: { "course-1": [suffix] },
    courseTemplates: { "course-1": `${suffix}型` },
    terms: ["2026年度 前期"],
    activeTerm: "2026年度 前期",
    tutorialSeen: true,
    campus: campus(suffix),
    displayPreferences: {},
  });

  const existing = state("existing");
  const incoming = state("incoming");
  const result = mergeImportedState(existing, incoming, [{ id: "session-1", blob: new Blob(["pdf"]) }]);
  const importedCourse = result.state.courses.find((item) => item.title.includes("読み込み"));
  assert.ok(importedCourse);
  assert.equal(result.state.courses.length, 2);
  assert.equal(result.state.sessions.length, 2);
  assert.equal(result.state.memos.length, 2);

  const importedAssignment = result.state.campus.assignments.find((item) => item.title === "incoming課題");
  const importedTemplate = result.state.campus.assignmentTemplates.find((item) => item.title === "incomingテンプレート");
  const importedExam = result.state.campus.exams.find((item) => item.title === "incoming試験");
  const importedAttendance = result.state.campus.attendanceRecords.find((item) => item.id !== "attendance-1");
  const importedTask = result.state.campus.studyTasks.find((item) => item.title === "incoming着手");
  const importedExamTask = result.state.campus.studyTasks.find((item) => item.title === "incoming試験対策");
  assert.ok(importedAssignment);
  assert.ok(importedTemplate);
  assert.ok(importedExam);
  assert.ok(importedAttendance);
  assert.ok(importedTask);
  assert.ok(importedExamTask);
  assert.notEqual(importedAssignment.id, "assignment-1");
  assert.notEqual(importedTemplate.id, "template-1");
  assert.notEqual(importedExam.id, "exam-1");
  assert.notEqual(importedAttendance.id, "attendance-1");
  assert.notEqual(importedTask.id, "task-1");
  assert.equal(importedAssignment.courseId, importedCourse.id);
  assert.equal(importedTemplate.courseId, importedCourse.id);
  assert.equal(importedExam.courseId, importedCourse.id);
  assert.equal(importedAttendance.courseId, importedCourse.id);
  assert.equal(importedTask.sourceId, importedAssignment.id);
  assert.equal(importedExamTask.sourceId, importedExam.id);
  assert.equal(result.pdfs.length, 1);
  assert.notEqual(result.pdfs[0].id, "session-1");
});
