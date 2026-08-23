import "server-only";

import { execute, queryAll, queryOne } from "@/lib/server/database";
import { inspectStoredObject, objectStore } from "@/lib/server/object-store";
import { matchesNotePdfVersion, pdfVersionsFromState } from "@/app/pdf-sync-model";
import { isCommittedPdfMetadata, normalizePdfManifest } from "@/app/sync-integrity-model";

export const MAX_PDF_BYTES = 75 * 1024 * 1024;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const TRANSACTION_ID_PATTERN = /^[a-zA-Z0-9-]{16,100}$/;
const SESSION_ID_PATTERN = /^[a-zA-Z0-9._:-]{1,180}$/;

type PdfRow = {
  session_id?: string;
  object_key: string;
  size: number;
  sha256: string;
  state_revision: number;
  note_version: string;
};

type TransactionRow = {
  id: string;
  target_revision: number;
  payload: string;
  status: string;
};

export type PendingPdfTransfer = {
  transactionId: string;
  sessionId: string;
  size: number;
  sha256: string;
  stateRevision: number;
  noteVersion: string;
};

type TransferFailure = { ok: false; status: number; error: string; conflict?: boolean };
type TransferSuccess<T> = { ok: true; value: T };
export type TransferResult<T> = TransferFailure | TransferSuccess<T>;

export function parsePendingPdfTransfer(value: unknown): PendingPdfTransfer | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const transactionId = typeof body.transactionId === "string" ? body.transactionId : "";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const size = typeof body.size === "number" ? body.size : NaN;
  const sha256 = typeof body.sha256 === "string" ? body.sha256 : "";
  const stateRevision = typeof body.stateRevision === "number" ? body.stateRevision : NaN;
  const noteVersion = typeof body.noteVersion === "string" ? body.noteVersion : "";
  if (
    !TRANSACTION_ID_PATTERN.test(transactionId)
    || !SESSION_ID_PATTERN.test(sessionId)
    || !Number.isSafeInteger(size)
    || size <= 0
    || size > MAX_PDF_BYTES
    || !SHA256_PATTERN.test(sha256)
    || !Number.isSafeInteger(stateRevision)
    || stateRevision < 1
    || !noteVersion
    || noteVersion.length > 800
  ) return null;
  return { transactionId, sessionId, size, sha256, stateRevision, noteVersion };
}

export function directPdfObjectKey(accountId: string, input: PendingPdfTransfer) {
  return stagingPdfObjectKey(accountId, input.transactionId, input.sessionId);
}

export function stagingPdfObjectKey(accountId: string, transactionId: string, sessionId: string) {
  return `${stagingPdfPrefix(accountId, transactionId)}${encodeURIComponent(sessionId)}.pdf`;
}

export function stagingPdfPrefix(accountId: string, transactionId: string) {
  return `staging/${encodeURIComponent(accountId)}/${encodeURIComponent(transactionId)}/`;
}

export function committedPdfObjectKey(accountId: string, transactionId: string, promotionId: string, sessionId: string) {
  return `accounts/${encodeURIComponent(accountId)}/pdfs/${encodeURIComponent(transactionId)}/${encodeURIComponent(promotionId)}/${encodeURIComponent(sessionId)}.pdf`;
}

export async function validatePendingPdfTransfer(accountId: string, input: PendingPdfTransfer): Promise<TransferResult<TransactionRow>> {
  const transaction = await queryOne<TransactionRow>(
    "SELECT id, target_revision, payload, status FROM sync_transactions WHERE id = ? AND user_id = ?",
    [input.transactionId, accountId],
  );
  if (!transaction) return failure("同期トランザクションが見つかりません。", 404);
  if (transaction.status === "committed") return failure("同期トランザクションはすでに確定しています。", 409, true);
  if (transaction.status !== "pending") return failure("同期トランザクションは使用できません。", 409, true);
  let state: unknown;
  try {
    state = JSON.parse(transaction.payload);
  } catch {
    return failure("同期内容を確認できません。", 409, true);
  }
  const manifest = state && typeof state === "object" && !Array.isArray(state)
    ? normalizePdfManifest((state as Record<string, unknown>).__syncPdfManifest)
    : null;
  const expected = manifest?.find((item) => item.sessionId === input.sessionId);
  const expectedVersion = pdfVersionsFromState(state)[input.sessionId];
  if (
    !manifest
    || !expected
    || expectedVersion !== input.noteVersion
    || expected.size !== input.size
    || expected.sha256 !== input.sha256
    || transaction.target_revision !== input.stateRevision
  ) return failure("PDFが同期対象のノート更新版・サイズ・SHA-256と一致しません。", 409, true);
  return { ok: true, value: transaction };
}

export async function completeDirectPdfUpload(accountId: string, input: PendingPdfTransfer): Promise<TransferResult<{ objectKey: string }>> {
  const validation = await validatePendingPdfTransfer(accountId, input);
  if (!validation.ok) return validation;
  const objectKey = directPdfObjectKey(accountId, input);
  let inspected: Awaited<ReturnType<typeof inspectStoredObject>>;
  try {
    inspected = await inspectStoredObject(objectKey, input.size);
  } catch {
    return failure("PDF本体を確認できませんでした。", 503);
  }
  if (!inspected || inspected.tooLarge || inspected.size !== input.size || inspected.sha256 !== input.sha256) {
    try {
      await objectStore().delete(objectKey);
    } catch {
      // The uncommitted object remains unreachable and can be removed with the transaction prefix later.
    }
    return failure("PDF本体のサイズまたはSHA-256を確認できませんでした。", 409);
  }
  const previous = await queryOne<{ object_key: string }>(
    "SELECT object_key FROM sync_transaction_pdfs WHERE transaction_id = ? AND user_id = ? AND session_id = ?",
    [input.transactionId, accountId, input.sessionId],
  );
  const now = Date.now();
  try {
    await execute(
      "INSERT INTO sync_transaction_pdfs (transaction_id, user_id, session_id, object_key, size, sha256, state_revision, note_version, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(transaction_id, session_id) DO UPDATE SET object_key = excluded.object_key, size = excluded.size, sha256 = excluded.sha256, state_revision = excluded.state_revision, note_version = excluded.note_version, uploaded_at = excluded.uploaded_at",
      [input.transactionId, accountId, input.sessionId, objectKey, input.size, input.sha256, input.stateRevision, input.noteVersion, now],
    );
  } catch {
    return failure("PDFの準備情報を保存できませんでした。", 503);
  }
  if (previous?.object_key && previous.object_key !== objectKey) {
    try {
      await objectStore().delete(previous.object_key);
    } catch {
      // The transaction row already points at the verified replacement.
    }
  }
  return { ok: true, value: { objectKey } };
}

export async function resolveCommittedPdf(accountId: string, sessionId: string): Promise<TransferResult<PdfRow>> {
  if (!SESSION_ID_PATTERN.test(sessionId)) return failure("PDFの授業回IDを確認できません。", 400);
  const row = await queryOne<PdfRow>(
    "SELECT object_key, size, sha256, state_revision, note_version FROM synced_pdf WHERE user_id = ? AND session_id = ?",
    [accountId, sessionId],
  );
  if (!row) return failure("PDFが見つかりません。", 404);
  const state = await queryOne<{ revision: number; payload: string; deleted_at: number | null; sync_complete: number }>(
    "SELECT revision, payload, deleted_at, sync_complete FROM synced_app_state WHERE user_id = ?",
    [accountId],
  );
  if (!state || state.deleted_at || Number(state.sync_complete) !== 1 || state.revision !== row.state_revision) {
    return failure("PDFに対応するクラウド状態が見つかりません。", 409, true);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(state.payload);
  } catch {
    return failure("PDFに対応するノートを確認できません。", 409, true);
  }
  if (!matchesNotePdfVersion(payload, sessionId, row.note_version)) {
    return failure("PDFに対応するノートの更新版がありません。", 409, true);
  }
  const allRows = await queryAll<PdfRow & { session_id?: string }>(
    "SELECT session_id, object_key, size, sha256, state_revision, note_version FROM synced_pdf WHERE user_id = ?",
    [accountId],
  );
  const metadata = allRows.flatMap((item) => item.session_id ? [{
    sessionId: item.session_id,
    size: item.size,
    sha256: item.sha256,
    stateRevision: item.state_revision,
    noteVersion: item.note_version,
  }] : []);
  if (!isCommittedPdfMetadata(payload, state.revision, metadata)) {
    return failure("PDF一覧がクラウド状態と一致しません。", 409, true);
  }
  try {
    const inspected = await inspectStoredObject(row.object_key, row.size);
    if (!inspected || inspected.tooLarge || inspected.size !== row.size || inspected.sha256 !== row.sha256) {
      return failure("PDF本体のサイズまたはSHA-256を確認できません。", 409, true);
    }
  } catch {
    return failure("PDF本体を確認できません。", 503);
  }
  return { ok: true, value: row };
}

function failure(error: string, status: number, conflict = false): TransferFailure {
  return { ok: false, error, status, ...(conflict ? { conflict: true } : {}) };
}
