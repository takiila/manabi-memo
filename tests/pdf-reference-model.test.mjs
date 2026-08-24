import assert from "node:assert/strict";
import test from "node:test";
import {
  fullPdfPatch,
  isMatchingPdfReference,
  makeLightweightPdfPatch,
  normalizePdfReferenceFields,
} from "../app/pdf-reference-model.ts";

const hash = "a".repeat(64);

test("PDF軽量化は本体由来データを外して参照情報を残す", () => {
  const patch = makeLightweightPdfPatch({ fileName: "lecture.pdf", pageCount: 24, lastPdfPage: 7 }, hash);
  assert.equal(patch.hasPdf, false);
  assert.equal(patch.pdfReferenceOnly, true);
  assert.equal(patch.pdfReferenceSha256, hash);
  assert.equal(patch.fileName, "lecture.pdf");
  assert.equal(patch.pageCount, 24);
  assert.equal(patch.lastPdfPage, 7);
  assert.deepEqual(patch.pageTexts, []);
  assert.deepEqual(patch.topics, []);
});

test("旧データでは明示された軽量参照だけを有効にする", () => {
  assert.deepEqual(normalizePdfReferenceFields({ pdfReferenceOnly: true, pdfReferenceSha256: hash, pdfReleasedAt: "2026-08-24T00:00:00.000Z" }, false, "lecture.pdf", 10), {
    pdfReferenceOnly: true,
    pdfReferenceSha256: hash,
    pdfReleasedAt: "2026-08-24T00:00:00.000Z",
  });
  assert.equal(normalizePdfReferenceFields({ pdfReferenceOnly: true }, true, "lecture.pdf", 10).pdfReferenceOnly, false);
  assert.equal(normalizePdfReferenceFields({ pdfReferenceOnly: true }, false, "", 0).pdfReferenceOnly, false);
});

test("再追加PDFはSHA-256を優先し、旧参照は名前とページ数で照合する", () => {
  assert.equal(isMatchingPdfReference({ pdfReferenceSha256: hash, fileName: "lecture.pdf", pageCount: 10 }, { sha256: hash, fileName: "renamed.pdf", pageCount: 10 }), true);
  assert.equal(isMatchingPdfReference({ pdfReferenceSha256: hash }, { sha256: "b".repeat(64), fileName: "lecture.pdf", pageCount: 10 }), false);
  assert.equal(isMatchingPdfReference({ fileName: "lecture.pdf", pageCount: 10 }, { sha256: hash, fileName: "lecture.pdf", pageCount: 10 }), true);
  assert.deepEqual(fullPdfPatch(), { pdfReferenceOnly: false, pdfReferenceSha256: "", pdfReleasedAt: null });
});
