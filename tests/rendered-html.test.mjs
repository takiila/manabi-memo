import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MAX_PDF_FILE_SIZE_BYTES,
  PdfProcessingError,
  PDF_FILE_SIZE_WARNING_BYTES,
  formatPdfProcessingError,
  pdfFileWarning,
  pdfSizeLabel,
  processPdfLocally,
} from "../app/pdf-local.ts";

test("ページメタデータとPWA manifestにまなびメモの名称が設定されている", async () => {
  const [layout, manifestText, sw, offline] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    readFile(new URL("../public/offline.html", import.meta.url), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);

  assert.match(layout, /title:\s*["']まなびメモ["']/);
  assert.equal(manifest.name, "まなびメモ");
  assert.equal(manifest.start_url, "/");
  assert.match(layout, /width:\s*["']device-width["']/);
  assert.match(sw, /\/offline\.html/);
  assert.match(sw, /_next\/static/);
  assert.match(offline, /オフラインで利用中/);
});

test("Firebase未設定時のCampus利用範囲をREADMEと画面で明示する", async () => {
  const [readme, page, campus] = await Promise.all([
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/campus-module.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(readme, /Firebase未設定時はCampus.*有効化できず/);
  assert.match(readme, /1ファイル75 MB・500ページ/);
  assert.match(page, /Firebase未設定のため、招待ベータは利用できません/);
  assert.match(page, /OCR機能はこの端末版に含まれていません/);
  assert.match(campus, /Firebaseが設定されていないため/);
});

test("PDFのメモリ上限と利用者向け警告を固定する", () => {
  assert.equal(MAX_PDF_FILE_SIZE_BYTES, 75 * 1024 * 1024);
  assert.equal(pdfFileWarning({ size: PDF_FILE_SIZE_WARNING_BYTES }).includes("メモリ"), true);
  assert.equal(pdfFileWarning({ size: PDF_FILE_SIZE_WARNING_BYTES - 1 }), "");
  assert.match(pdfSizeLabel(MAX_PDF_FILE_SIZE_BYTES), /75 MB/);
  assert.match(formatPdfProcessingError(new Error("broken")), /PDFを読み取れません/);
});

test("上限超過PDFはpdf.jsを起動せずに拒否する", async () => {
  await assert.rejects(
    processPdfLocally({ size: MAX_PDF_FILE_SIZE_BYTES + 1, arrayBuffer: async () => new ArrayBuffer(0) }, () => undefined),
    (cause) => cause instanceof PdfProcessingError && cause.code === "file-too-large",
  );
});

test("主要導線とモバイル向けレイアウト契約を保つ", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  for (const label of ["講義を追加", "PDFを追加", "ノートを見返す", "Campus Muster", "設定"]) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /PDFなしでも始められます/);
  assert.match(page, /PDFはこの端末内で処理/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /\.mobile-nav/);
  assert.match(css, /min-height: 44px/);
});
