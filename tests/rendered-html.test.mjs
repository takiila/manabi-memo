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
  assert.doesNotMatch(sw, /__CACHE_VERSION__/);
  assert.match(sw, /SKIP_WAITING/);
  assert.match(offline, /オフラインで利用中/);
});

test("Firebase未設定時と少人数公開時のCampus利用範囲をREADMEと画面で明示する", async () => {
  const [readme, page, campus] = await Promise.all([
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/campus-module.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(readme, /CAMPUS_ACCESS_MODE=authenticated.*認証済み利用者全員/);
  assert.match(readme, /Firebase未設定時も端末内の基本機能は利用可能/);
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
  assert.match(page, /端末データの読込を再試行/);
  assert.match(page, /サイトデータを消さずにバックアップまたは復旧相談/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /\.mobile-nav/);
  assert.match(css, /min-height: 44px/);
});

test("新構想のPDF軽量参照と学び・遊び共有導線を保つ", async () => {
  const [page, campus, shared, reference] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/campus-module.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/shared-campus-calendar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/pdf-reference-card.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /容量を軽くする/);
  assert.match(reference, /元のPDFを再追加/);
  assert.match(campus, /遊びも学びも、予定から整える/);
  assert.match(shared, /遊び候補/);
  assert.match(shared, /個人予定は自動共有されません/);
  assert.match(shared, /参加できる/);
});
