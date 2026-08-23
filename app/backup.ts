const MAGIC = "MANABI02";
const HEADER_BYTES = 12;
const MAX_BACKUP_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 50 * 1024 * 1024;
const MAX_PDF_COUNT = 1000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type BackupManifest<T> = {
  format: "manabi-memo-backup";
  version: 2;
  exportedAt: string;
  state: T;
  pdfs: Array<{
    sessionId: string;
    type: string;
    size: number;
    offset: number;
    sha256: string;
  }>;
};

export type InspectedBackup<T> = {
  manifest: BackupManifest<T>;
  pdfs: Array<{ id: string; blob: Blob }>;
  fileName: string;
  bytes: number;
  legacy: boolean;
};

// Non-generic UI state may keep an inspected backup while its normalized
// application state is tracked separately.
export type BackupInspection = InspectedBackup<object>;

export async function createBackupFile<T>(
  state: T,
  pdfs: Array<{ id: string; blob: Blob }>,
) {
  validatePdfInputs(pdfs);
  if (pdfs.length > MAX_PDF_COUNT) throw new Error("PDFの件数が上限を超えています");

  let offset = 0;
  const entries: BackupManifest<T>["pdfs"] = [];
  for (const { id, blob } of pdfs) {
    entries.push({
      sessionId: id,
      type: blob.type || "application/pdf",
      size: blob.size,
      offset,
      sha256: await sha256Blob(blob),
    });
    offset += blob.size;
    if (!Number.isSafeInteger(offset) || offset > MAX_BACKUP_BYTES) {
      throw new Error("バックアップが2GBを超えるため作成できません");
    }
  }

  const manifest: BackupManifest<T> = {
    format: "manabi-memo-backup",
    version: 2,
    exportedAt: new Date().toISOString(),
    state,
    pdfs: entries,
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  if (manifestBytes.byteLength === 0 || manifestBytes.byteLength > MAX_MANIFEST_BYTES) {
    throw new Error("バックアップのノートデータが大きすぎます");
  }
  if (HEADER_BYTES + manifestBytes.byteLength + offset > MAX_BACKUP_BYTES) {
    throw new Error("バックアップが2GBを超えるため作成できません");
  }

  const header = new Uint8Array(HEADER_BYTES);
  header.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(header.buffer).setUint32(8, manifestBytes.byteLength, false);
  return new Blob(
    [header, manifestBytes, ...pdfs.map((entry) => entry.blob)],
    { type: "application/x-manabi-memo" },
  );
}

export async function inspectBackupFile<T>(file: File): Promise<InspectedBackup<T>> {
  if (file.size > MAX_BACKUP_BYTES) throw new Error("バックアップが2GBを超えているため読み込めません");
  const header = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
  const magic = new TextDecoder().decode(header.slice(0, 8));

  if (magic !== MAGIC) return inspectLegacyJson<T>(file);
  if (header.byteLength !== HEADER_BYTES) throw new Error("バックアップの構造が壊れています");

  const manifestLength = new DataView(header.buffer).getUint32(8, false);
  if (
    manifestLength === 0
    || manifestLength > MAX_MANIFEST_BYTES
    || HEADER_BYTES + manifestLength > file.size
  ) {
    throw new Error("バックアップの構造が壊れています");
  }

  const manifest = JSON.parse(
    await file.slice(HEADER_BYTES, HEADER_BYTES + manifestLength).text(),
  ) as BackupManifest<T>;
  validateManifest(manifest);

  const payloadStart = HEADER_BYTES + manifestLength;
  const seenIds = new Set<string>();
  let expectedOffset = 0;
  const pdfs: Array<{ id: string; blob: Blob }> = [];
  for (const entry of manifest.pdfs) {
    if (
      !entry.sessionId
      || seenIds.has(entry.sessionId)
      || !Number.isSafeInteger(entry.size)
      || !Number.isSafeInteger(entry.offset)
      || entry.size < 0
      || entry.offset !== expectedOffset
      || !SHA256_PATTERN.test(entry.sha256)
      || payloadStart + entry.offset + entry.size > file.size
    ) {
      throw new Error("PDFデータの構造が壊れています");
    }
    seenIds.add(entry.sessionId);
    const blob = file.slice(
      payloadStart + entry.offset,
      payloadStart + entry.offset + entry.size,
      safeMimeType(entry.type),
    );
    if ((await sha256Blob(blob)) !== entry.sha256) {
      throw new Error(`PDFデータが破損しています: ${entry.sessionId}`);
    }
    pdfs.push({ id: entry.sessionId, blob });
    expectedOffset += entry.size;
  }

  if (payloadStart + expectedOffset !== file.size) {
    throw new Error("バックアップの末尾に不明なデータがあります");
  }
  return { manifest, pdfs, fileName: file.name, bytes: file.size, legacy: false };
}

async function inspectLegacyJson<T>(file: File): Promise<InspectedBackup<T>> {
  if (file.size > MAX_MANIFEST_BYTES) throw new Error("旧形式のバックアップが大きすぎます");
  const parsed = JSON.parse(await file.text()) as T | {
    format?: unknown;
    version?: unknown;
    exportedAt?: unknown;
    state?: T;
  };
  if (!parsed || typeof parsed !== "object") throw new Error("バックアップの内容が不正です");
  if ("format" in parsed && parsed.format === "manabi-memo-backup") {
    if (typeof parsed.version === "number" && parsed.version > 2) {
      throw new Error("このバックアップは新しい版で作られています");
    }
  }
  const state = "state" in parsed && parsed.state ? parsed.state : parsed as T;
  const exportedAt = "exportedAt" in parsed && typeof parsed.exportedAt === "string"
    ? parsed.exportedAt
    : "";
  return {
    manifest: {
      format: "manabi-memo-backup",
      version: 2,
      exportedAt,
      state,
      pdfs: [],
    },
    pdfs: [],
    fileName: file.name,
    bytes: file.size,
    legacy: true,
  };
}

function validateManifest<T>(value: BackupManifest<T>) {
  if (
    !value
    || typeof value !== "object"
    || value.format !== "manabi-memo-backup"
    || value.version !== 2
    || typeof value.exportedAt !== "string"
    || !("state" in value)
    || !Array.isArray(value.pdfs)
  ) {
    throw new Error("対応していないバックアップ形式です");
  }
  if (value.pdfs.length > MAX_PDF_COUNT) throw new Error("PDFの件数が上限を超えています");
}

function validatePdfInputs(pdfs: Array<{ id: string; blob: Blob }>) {
  const ids = new Set<string>();
  for (const pdf of pdfs) {
    if (!pdf.id || ids.has(pdf.id) || !(pdf.blob instanceof Blob)) {
      throw new TypeError("PDFデータが不正です");
    }
    ids.add(pdf.id);
  }
}

async function sha256Blob(blob: Blob) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeMimeType(value: unknown) {
  return typeof value === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(value)
    ? value
    : "application/pdf";
}
