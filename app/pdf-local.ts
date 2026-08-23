export type ProcessedTopic = {
  label: string;
  startPage: number;
  endPage: number;
};

export type ProcessedPdf = {
  pageCount: number;
  pageTexts: string[];
  topics: ProcessedTopic[];
  extractedCharacters: number;
  needsOcr: boolean;
  /** Processing notes that should be shown beside the PDF. */
  warnings: string[];
  /** True when text was deliberately capped to keep browser memory bounded. */
  textTruncated: boolean;
};

type ProgressHandler = (message: string, progress: number) => void;

// These limits are intentionally conservative for a phone browser. pdf.js has to
// keep the source bytes while it parses the document, so a seemingly harmless
// 200MB upload can briefly require several times that amount of memory.
// Keep the browser limit aligned with /api/sync/pdf so a locally accepted
// document can always be uploaded when cloud sync is enabled later.
export const MAX_PDF_FILE_SIZE_BYTES = 75 * 1024 * 1024;
export const PDF_FILE_SIZE_WARNING_BYTES = 25 * 1024 * 1024;
export const MAX_PDF_PAGE_COUNT = 500;
export const PDF_PAGE_COUNT_WARNING = 200;
export const MAX_EXTRACTED_CHARACTERS = 2_000_000;
export const MAX_PAGE_TEXT_CHARACTERS = 200_000;

export class PdfProcessingError extends Error {
  readonly code: "file-too-large" | "too-many-pages" | "invalid-pdf" | "processing-failed";

  constructor(
    message: string,
    code: "file-too-large" | "too-many-pages" | "invalid-pdf" | "processing-failed",
  ) {
    super(message);
    this.name = "PdfProcessingError";
    this.code = code;
  }
}

export function formatPdfProcessingError(cause: unknown) {
  if (cause instanceof PdfProcessingError) return cause.message;
  if (cause instanceof DOMException && cause.name === "QuotaExceededError") {
    return "端末の空き容量が足りません。不要な資料を削除するか、バックアップ後に整理してください。";
  }
  return "PDFを読み取れませんでした。PDFなしで始めるか、別のファイルをお試しください。";
}

export function pdfFileWarning(file: Pick<File, "size">) {
  return file.size >= PDF_FILE_SIZE_WARNING_BYTES
    ? "大きめのPDFです。端末のメモリと空き容量を使うため、他のタブを閉じてから処理してください。"
    : "";
}

export function pdfSizeLabel(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "サイズ不明";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

export async function processPdfLocally(
  file: File,
  onProgress: ProgressHandler,
): Promise<ProcessedPdf> {
  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw new PdfProcessingError("PDFファイルが空です。別のファイルを選んでください。", "processing-failed");
  }
  if (file.size > MAX_PDF_FILE_SIZE_BYTES) {
    throw new PdfProcessingError(
      `PDFが大きすぎます（上限 ${pdfSizeLabel(MAX_PDF_FILE_SIZE_BYTES)}）。ページを分けて追加してください。`,
      "file-too-large",
    );
  }

  onProgress("PDFを開いています", 8);
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  // Uint8Array is a view over the ArrayBuffer; it does not make another copy of
  // the upload. Page text is capped below and each page is cleaned immediately.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data: bytes });

  try {
    let document: Awaited<typeof loadingTask.promise>;
    try {
      document = await loadingTask.promise;
    } catch {
      throw new PdfProcessingError("PDFを開けませんでした。壊れていないPDFを選んでください。", "invalid-pdf");
    }
    if (document.numPages > MAX_PDF_PAGE_COUNT) {
      throw new PdfProcessingError(
        `PDFのページ数が多すぎます（${document.numPages}ページ）。上限は${MAX_PDF_PAGE_COUNT}ページです。ページを分けて追加してください。`,
        "too-many-pages",
      );
    }

    const pageTexts: string[] = [];
    let extractedCharacters = 0;
    let textTruncated = false;
    const warnings: string[] = [];
    if (file.size >= PDF_FILE_SIZE_WARNING_BYTES) warnings.push(pdfFileWarning(file));
    if (document.numPages >= PDF_PAGE_COUNT_WARNING) {
      warnings.push(`ページ数が多いPDFです（${document.numPages}ページ）。本文抽出は${MAX_EXTRACTED_CHARACTERS.toLocaleString("ja-JP")}文字までに制限します。`);
    }

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        // Once the retained text cap is reached, do not allocate another large
        // textContent object for every remaining page. Empty entries preserve
        // page numbering while keeping search memory bounded.
        if (extractedCharacters < MAX_EXTRACTED_CHARACTERS) {
          const textContent = await page.getTextContent();
          const chunks: string[] = [];
          for (const item of textContent.items) {
            if (!("str" in item)) continue;
            chunks.push(item.str);
            chunks.push("hasEOL" in item && item.hasEOL ? "\n" : " ");
          }
          const normalized = normalizePageText(chunks.join(""));
          const remaining = MAX_EXTRACTED_CHARACTERS - extractedCharacters;
          const pageText = normalized.slice(0, Math.min(MAX_PAGE_TEXT_CHARACTERS, remaining));
          pageTexts.push(pageText);
          extractedCharacters += pageText.length;
          if (pageText.length < normalized.length) textTruncated = true;
        } else {
          pageTexts.push("");
          textTruncated = true;
        }
      } finally {
        // pdf.js keeps page resources in caches unless explicitly cleaned.
        page.cleanup();
      }

      const progress = 10 + Math.round((pageNumber / document.numPages) * 65);
      onProgress(`${pageNumber} / ${document.numPages}ページを読み取り中`, progress);
    }

    if (textTruncated) {
      warnings.push(`本文抽出は${MAX_EXTRACTED_CHARACTERS.toLocaleString("ja-JP")}文字までです。検索できない部分は元PDFで確認してください。`);
    }
    const needsOcr = extractedCharacters < Math.max(80, document.numPages * 20);
    if (needsOcr) {
      warnings.push("画像中心のPDFです。本文検索・見出し整理は利用できません。OCR機能はこの端末版に含まれていません。");
    }

    onProgress("見出しと話題を整理しています", 83);
    const topics = buildTopics(pageTexts);
    onProgress("端末への保存を準備しています", 94);

    return {
      pageCount: document.numPages,
      pageTexts,
      topics,
      extractedCharacters,
      needsOcr,
      warnings: warnings.filter(Boolean),
      textTruncated,
    };
  } finally {
    // Cleanup is safe even when loading or page extraction fails.
    try {
      await loadingTask.promise.then((document) => document.cleanup()).catch(() => undefined);
    } catch { /* destroy below is the final cleanup path */ }
    await loadingTask.destroy();
  }
}

function normalizePageText(text: string) {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function buildTopics(pageTexts: string[]): ProcessedTopic[] {
  const candidates: Array<{ label: string; page: number }> = [];
  const seen = new Set<string>();

  pageTexts.forEach((text, index) => {
    const heading = pickHeading(text);
    if (!heading) return;
    const key = heading.replace(/[\s　・:：,、。―—\-]/g, "").toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ label: heading, page: index + 1 });
  });

  const selected = selectRepresentativeHeadings(candidates, 5);
  if (selected.length === 0) {
    return [{ label: "資料全体", startPage: 1, endPage: Math.max(pageTexts.length, 1) }];
  }

  return selected.map((topic, index) => ({
    label: topic.label,
    startPage: topic.page,
    endPage: index < selected.length - 1
      ? Math.max(topic.page, selected[index + 1].page - 1)
      : Math.max(topic.page, pageTexts.length),
  }));
}

function pickHeading(text: string) {
  const lines = text.split("\n").slice(0, 12);
  const ignored = /^(第?\s*\d+\s*(回|頁|ページ)?|\d+|目次|contents?|講義資料|授業資料|copyright|©)/i;
  const candidates = lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => {
      const length = Array.from(line).length;
      return length >= 4 && length <= 34 && !ignored.test(line) && !/[。！？!?]$/.test(line);
    })
    .map(({ line, index }) => ({
      line,
      score: (index < 5 ? 8 - index : 1) + (Array.from(line).length >= 7 ? 3 : 0),
    }))
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.line ?? null;
}

function selectRepresentativeHeadings(
  candidates: Array<{ label: string; page: number }>,
  limit: number,
) {
  if (candidates.length <= limit) return candidates;

  const selected: Array<{ label: string; page: number }> = [];
  for (let index = 0; index < limit; index += 1) {
    const sourceIndex = Math.round((index * (candidates.length - 1)) / (limit - 1));
    const candidate = candidates[sourceIndex];
    if (!selected.some((item) => item.page === candidate.page)) selected.push(candidate);
  }
  return selected.sort((a, b) => a.page - b.page);
}
