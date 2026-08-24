import type { ProcessedTopic } from "./pdf-local";

export type PdfReferenceFields = {
  pdfReferenceOnly: boolean;
  pdfReferenceSha256: string;
  pdfReleasedAt: string | null;
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export function normalizePdfReferenceFields(value: unknown, hasPdf: boolean, fileName: string, pageCount: number): PdfReferenceFields {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const referenceOnly = !hasPdf && source.pdfReferenceOnly === true && Boolean(fileName) && pageCount > 0;
  return {
    pdfReferenceOnly: referenceOnly,
    pdfReferenceSha256: referenceOnly && typeof source.pdfReferenceSha256 === "string" && SHA256_PATTERN.test(source.pdfReferenceSha256)
      ? source.pdfReferenceSha256
      : "",
    pdfReleasedAt: referenceOnly ? cleanIso(source.pdfReleasedAt) : null,
  };
}

export function makeLightweightPdfPatch(input: { fileName?: string; pageCount: number; lastPdfPage: number }, sha256: string) {
  const pageCount = integer(input.pageCount, 1, 10_000) || 1;
  return {
    fileName: cleanText(input.fileName, 260),
    pageCount,
    lastPdfPage: Math.min(Math.max(integer(input.lastPdfPage, 1, pageCount) || 1, 1), pageCount),
    pageTexts: [] as string[],
    topics: [] as ProcessedTopic[],
    needsOcr: false,
    pdfWarnings: [] as string[],
    hasPdf: false,
    pdfReferenceOnly: true,
    pdfReferenceSha256: SHA256_PATTERN.test(sha256) ? sha256 : "",
    pdfReleasedAt: new Date().toISOString(),
  };
}

export function fullPdfPatch() {
  return { pdfReferenceOnly: false, pdfReferenceSha256: "", pdfReleasedAt: null };
}

export function isMatchingPdfReference(reference: { pdfReferenceSha256?: string; fileName?: string; pageCount?: number }, candidate: { sha256: string; fileName: string; pageCount: number }) {
  if (reference.pdfReferenceSha256 && SHA256_PATTERN.test(reference.pdfReferenceSha256)) return reference.pdfReferenceSha256 === candidate.sha256;
  return cleanText(reference.fileName, 260) === cleanText(candidate.fileName, 260)
    && integer(reference.pageCount, 1, 10_000) === integer(candidate.pageCount, 1, 10_000);
}

export async function sha256Blob(blob: Blob) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cleanText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function cleanIso(value: unknown) {
  if (typeof value !== "string" || value.length > 40) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function integer(value: unknown, minimum: number, maximum: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum ? value : 0;
}
