import assert from "node:assert/strict";
import test from "node:test";
import { referencesForSync, referenceSyncFingerprint, retainLocalPdf, canApplyReferenceRestore } from "../app/reference-sync-model.ts";

const hash = "a".repeat(64);
const session = { id: "session-1", hasPdf: true, fileName: "lecture.pdf", pageCount: 12, lastPdfPage: 5, pageTexts: ["private PDF text"], topics: [{ title: "PDF excerpt" }], needsOcr: true, pdfWarnings: ["warning"], noteText: "my notes", updatedAt: "2026-09-30" };

test("クラウド確認中に端末の保存版やメモが変わったら反映を中止する", () => {
  assert.equal(canApplyReferenceRestore(3, 3, "same", "same"), true);
  assert.equal(canApplyReferenceRestore(3, 4, "same", "same"), false);
  assert.equal(canApplyReferenceRestore(3, 3, "old", "new"), false);
});

test("同期用コピーはPDF本文を除き、メモとページ参照を残し元データを変更しない", () => {
  const local = { sessions: [session], memos: [{ page: 5, text: "memo", x: 0.2, y: 0.3 }] };
  const cloud = referencesForSync(local, { "session-1": hash });
  assert.equal(cloud.sessions[0].hasPdf, false);
  assert.equal(cloud.sessions[0].pdfReferenceOnly, true);
  assert.equal(cloud.sessions[0].pdfReferenceSha256, hash);
  assert.deepEqual(cloud.sessions[0].pageTexts, []);
  assert.deepEqual(cloud.sessions[0].topics, []);
  assert.equal(cloud.sessions[0].lastPdfPage, 5);
  assert.equal(cloud.sessions[0].noteText, "my notes");
  assert.deepEqual(cloud.memos, local.memos);
  assert.equal(local.sessions[0].hasPdf, true);
  assert.deepEqual(local.sessions[0].pageTexts, ["private PDF text"]);
});

test("本体あり端末と参照のみ端末の同期判定は同じ、メモ変更は検知する", () => {
  const local = { sessions: [session] };
  const cloud = referencesForSync(local, { "session-1": hash });
  assert.equal(referenceSyncFingerprint(referencesForSync(local, { "session-1": hash })), referenceSyncFingerprint(cloud));
  assert.notEqual(referenceSyncFingerprint(local), referenceSyncFingerprint({ sessions: [{ ...cloud.sessions[0], noteText: "changed" }] }));
});

test("クラウド反映時は同じSHAの端末PDFを残し、クラウドのメモは採用する", () => {
  const remote = { ...referencesForSync({ sessions: [session] }, { "session-1": hash }).sessions[0], noteText: "new memo" };
  const merged = retainLocalPdf(remote, session, hash);
  assert.equal(merged.hasPdf, true);
  assert.equal(merged.noteText, "new memo");
  assert.deepEqual(merged.pageTexts, session.pageTexts);
  assert.equal(retainLocalPdf(remote, session, "b".repeat(64)).hasPdf, false);
  assert.equal(retainLocalPdf(remote, undefined, hash).hasPdf, true);
});

test("参照PDFのSHAだけが変わっても同期差分として検知する", () => {
  const local = { sessions: [session] };
  assert.notEqual(referenceSyncFingerprint(referencesForSync(local, { "session-1": hash })), referenceSyncFingerprint(referencesForSync(local, { "session-1": "b".repeat(64) })));
});

test("一度不一致になった参照も端末に残る元PDFのSHAが一致すれば再接続できる", () => {
  const remote = referencesForSync({ sessions: [session] }, { "session-1": hash }).sessions[0];
  const mismatch = { ...remote, pdfReferenceSha256: "b".repeat(64) };
  assert.equal(retainLocalPdf(remote, mismatch, hash).hasPdf, true);
});

test("古い参照にSHAがないときは同じ授業回・資料名・ページ数だけ復元する", () => {
  const remote = referencesForSync({ sessions: [session] }).sessions[0];
  assert.equal(retainLocalPdf(remote, session, hash).hasPdf, true);
  assert.equal(retainLocalPdf(remote, { ...session, id: "other" }, hash).hasPdf, false);
  assert.equal(retainLocalPdf(remote, { ...session, fileName: "other.pdf" }, hash).hasPdf, false);
});
