import { NextResponse } from "next/server";
import { execute, queryAll, queryOne } from "@/lib/server/database";
import { objectStore } from "@/lib/server/object-store";
import { MAX_PDF_BYTES } from "@/lib/server/pdf-transfer";
import { isSameOriginRequest } from "@/lib/server/request-security";
import { accountForRequest } from "../../../server-auth-response";
import { matchesNotePdfVersion, pdfVersionsFromState } from "../../../pdf-sync-model";
import { isCommittedPdfMetadata, normalizePdfManifest, type PdfSyncManifest } from "../../../sync-integrity-model";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const TRANSACTION_ID_PATTERN = /^[a-zA-Z0-9-]{16,100}$/;
type PdfRow = { session_id?: string; object_key: string; size: number; sha256: string; state_revision: number; note_version: string; updated_at?: number };
type TransactionRow = { id: string; user_id: string; target_revision: number; payload: string; status: string };

export async function GET(request: Request) {
  const auth = await accountForRequest(request);
  if ("response" in auth) return auth.response;
  const sessionId = requestedSessionId(request);
  if (!sessionId) return json({ error: "PDFの授業回IDを確認できません。" }, 400);
  const row = await queryOne<PdfRow>("SELECT object_key, size, sha256, state_revision, note_version FROM synced_pdf WHERE user_id = ? AND session_id = ?", [auth.account.id, sessionId]);
  if (!row) return json({ error: "PDFが見つかりません。" }, 404);
  const state = await queryOne<{ revision: number; payload: string; deleted_at: number | null; sync_complete: number }>("SELECT revision, payload, deleted_at, sync_complete FROM synced_app_state WHERE user_id = ?", [auth.account.id]);
  if (!state || state.deleted_at || Number(state.sync_complete) !== 1 || state.revision !== row.state_revision) return json({ error: "PDFに対応するクラウド状態が見つかりません。", conflict: true }, 409);
  let payload: unknown;
  try { payload = JSON.parse(state.payload); } catch { return json({ error: "PDFに対応するノートを確認できません。" }, 409); }
  if (!matchesNotePdfVersion(payload, sessionId, row.note_version)) return json({ error: "PDFに対応するノートの更新版がありません。", conflict: true }, 409);
  const allRows = await queryAll<PdfRow & { session_id?: string; updated_at?: number }>("SELECT session_id, object_key, size, sha256, state_revision, note_version, updated_at FROM synced_pdf WHERE user_id = ?", [auth.account.id]);
  const metadata = allRows.flatMap((item) => item.session_id ? [{ sessionId: item.session_id, size: item.size, sha256: item.sha256, stateRevision: item.state_revision, noteVersion: item.note_version }] : []);
  if (!isCommittedPdfMetadata(payload, state.revision, metadata)) return json({ error: "PDF一覧がクラウド状態と一致しません。", conflict: true }, 409);
  let object: Awaited<ReturnType<ReturnType<typeof objectStore>["get"]>>;
  try { object = await objectStore().get(row.object_key); } catch { return json({ error: "PDF本体を確認できませんでした。" }, 503); }
  if (!object) return json({ error: "PDF本体が見つかりません。" }, 404);
  const bytes = await new Response(object.body).arrayBuffer();
  if (bytes.byteLength !== row.size || await hashBytes(bytes) !== row.sha256) return json({ error: "PDF本体の整合性を確認できませんでした。" }, 409);
  return new Response(bytes, { headers: { "content-type": "application/pdf", "content-length": String(row.size), "x-content-sha256": row.sha256, "x-state-revision": String(row.state_revision), "x-note-version": encodeURIComponent(row.note_version), "cache-control": "private, no-store", "content-disposition": `inline; filename="${encodeURIComponent(sessionId)}.pdf"` } });
}

export async function PUT(request: Request) {
  if (!isSameOriginRequest(request)) return json({ error: "送信元を確認できませんでした。" }, 403);
  const auth = await accountForRequest(request);
  if ("response" in auth) return auth.response;
  const sessionId = requestedSessionId(request);
  const transactionParam = new URL(request.url).searchParams.get("transactionId");
  if (transactionParam !== null && !TRANSACTION_ID_PATTERN.test(transactionParam)) return json({ error: "同期トランザクションを確認できません。" }, 400);
  const transactionId = transactionParam ?? "";
  const sizeHeader = request.headers.get("content-length");
  const declaredSize = sizeHeader ? Number(sizeHeader) : null;
  if (!sessionId || (declaredSize !== null && (!Number.isFinite(declaredSize) || declaredSize <= 0 || declaredSize > MAX_PDF_BYTES))) return json({ error: "PDFのサイズまたは授業回IDを確認できません。" }, 400);
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLocaleLowerCase("en-US");
  if (contentType !== "application/pdf") return json({ error: "PDF形式のファイルだけ同期できます。" }, 415);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0 || (declaredSize !== null && bytes.byteLength !== declaredSize) || bytes.byteLength > MAX_PDF_BYTES) return json({ error: "PDFのサイズを確認できません。" }, 400);
  const sha256 = await hashBytes(bytes);
  const suppliedHash = request.headers.get("x-content-sha256");
  if (suppliedHash && (!SHA256_PATTERN.test(suppliedHash) || suppliedHash !== sha256)) return json({ error: "PDFの整合性を確認できませんでした。" }, 400);
  const suppliedRevision = Number(request.headers.get("x-state-revision"));
  const suppliedVersion = decodeHeaderValue(request.headers.get("x-note-version"));
  if (!Number.isSafeInteger(suppliedRevision) || suppliedRevision < 1 || !suppliedVersion) return json({ error: "PDFに対応するノートの更新版を確認できませんでした。" }, 400);

  if (transactionId) return stagePdf(auth.account.id, transactionId, sessionId, bytes, sha256, suppliedRevision, suppliedVersion);
  return putLegacyPdf(auth.account.id, sessionId, bytes, sha256, suppliedRevision, suppliedVersion);
}

export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) return json({ error: "送信元を確認できませんでした。" }, 403);
  const auth = await accountForRequest(request);
  if ("response" in auth) return auth.response;
  const sessionId = requestedSessionId(request);
  if (!sessionId) return json({ error: "PDFの授業回IDを確認できません。" }, 400);
  const row = await queryOne<{ object_key: string }>("SELECT object_key FROM synced_pdf WHERE user_id = ? AND session_id = ?", [auth.account.id, sessionId]);
  if (row) await objectStore().delete(row.object_key);
  await execute("DELETE FROM synced_pdf WHERE user_id = ? AND session_id = ?", [auth.account.id, sessionId]);
  return json({ ok: true });
}

async function stagePdf(accountId: string, transactionId: string, sessionId: string, bytes: ArrayBuffer, sha256: string, suppliedRevision: number, suppliedVersion: string) {
  if (!TRANSACTION_ID_PATTERN.test(transactionId)) return json({ error: "同期トランザクションを確認できません。" }, 400);
  const transaction = await queryOne<TransactionRow>("SELECT id, user_id, target_revision, payload, status FROM sync_transactions WHERE id = ? AND user_id = ?", [transactionId, accountId]);
  if (!transaction) return json({ error: "同期トランザクションが見つかりません。" }, 404);
  if (transaction.status === "committed") return json({ error: "同期トランザクションはすでに確定しています。", conflict: true }, 409);
  if (transaction.status !== "pending") return json({ error: "同期トランザクションは使用できません。", conflict: true }, 409);
  let state: unknown;
  try { state = JSON.parse(transaction.payload); } catch { return json({ error: "同期内容を確認できません。" }, 409); }
  const manifest = readManifest(state);
  const expectedVersion = pdfVersionsFromState(state)[sessionId];
  const expected = manifest?.find((item) => item.sessionId === sessionId);
  if (!manifest || !expected || expectedVersion !== suppliedVersion || expected.size !== bytes.byteLength || expected.sha256 !== sha256 || suppliedRevision !== transaction.target_revision) return json({ error: "PDFが同期対象のノート更新版・サイズ・SHA-256と一致しません。", conflict: true }, 409);
  const objectKey = `${accountId}/transactions/${encodeURIComponent(transactionId)}/${encodeURIComponent(sessionId)}.pdf`;
  await objectStore().put(objectKey, bytes, "application/pdf", { sha256, stateRevision: String(transaction.target_revision), noteVersion: suppliedVersion });
  const now = Date.now();
  try {
    await execute(
      "INSERT INTO sync_transaction_pdfs (transaction_id, user_id, session_id, object_key, size, sha256, state_revision, note_version, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(transaction_id, session_id) DO UPDATE SET object_key = excluded.object_key, size = excluded.size, sha256 = excluded.sha256, state_revision = excluded.state_revision, note_version = excluded.note_version, uploaded_at = excluded.uploaded_at",
      [transactionId, accountId, sessionId, objectKey, bytes.byteLength, sha256, transaction.target_revision, suppliedVersion, now],
    );
  } catch {
    return json({ error: "PDFの準備情報を保存できませんでした。" }, 503);
  }
  return json({ ok: true, transactionId, sessionId, size: bytes.byteLength, sha256, stateRevision: transaction.target_revision, noteVersion: suppliedVersion, staged: true });
}

async function putLegacyPdf(accountId: string, sessionId: string, bytes: ArrayBuffer, sha256: string, suppliedRevision: number, suppliedVersion: string) {
  const state = await queryOne<{ revision: number; payload: string; deleted_at: number | null; sync_complete: number }>("SELECT revision, payload, deleted_at, sync_complete FROM synced_app_state WHERE user_id = ?", [accountId]);
  if (!state) return json({ error: "先にノートデータを同期してください。" }, 409);
  if (state.deleted_at) return json({ error: "クラウドデータは削除済みです。", conflict: true }, 409);
  let statePayload: unknown;
  try { statePayload = JSON.parse(state.payload); } catch { return json({ error: "同期済みノートを確認できませんでした。" }, 409); }
  if (state.revision !== suppliedRevision || !matchesNotePdfVersion(statePayload, sessionId, suppliedVersion)) return json({ error: "ノートが別の端末で更新されています。PDFは上書きしませんでした。", conflict: true }, 409);
  const objectKey = `${accountId}/${encodeURIComponent(sessionId)}.pdf`;
  await objectStore().put(objectKey, bytes, "application/pdf", { sha256, stateRevision: String(state.revision), noteVersion: suppliedVersion });
  const now = Date.now();
  await execute(
    "INSERT INTO synced_pdf (user_id, session_id, object_key, size, sha256, state_revision, note_version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, session_id) DO UPDATE SET object_key = excluded.object_key, size = excluded.size, sha256 = excluded.sha256, state_revision = excluded.state_revision, note_version = excluded.note_version, updated_at = excluded.updated_at",
    [accountId, sessionId, objectKey, bytes.byteLength, sha256, state.revision, suppliedVersion, now],
  );
  const complete = await completeLegacyState(accountId, state.revision, statePayload);
  return json({ ok: true, sessionId, size: bytes.byteLength, sha256, stateRevision: state.revision, noteVersion: suppliedVersion, updatedAt: new Date(now).toISOString(), pending: !complete });
}

async function completeLegacyState(accountId: string, revision: number, state: unknown) {
  const rows = await queryAll<PdfRow>("SELECT session_id, object_key, size, sha256, state_revision, note_version, updated_at FROM synced_pdf WHERE user_id = ?", [accountId]);
  const expectedIds = new Set(Object.keys(pdfVersionsFromState(state)));
  const metadata = rows.flatMap((row) => row.session_id && expectedIds.has(row.session_id) ? [{ sessionId: row.session_id, size: row.size, sha256: row.sha256, stateRevision: row.state_revision, noteVersion: row.note_version }] : []);
  if (!isCommittedPdfMetadata(state, revision, metadata)) return false;
  for (const row of rows.filter((item) => item.session_id && expectedIds.has(item.session_id))) {
    const object = await objectStore().get(row.object_key);
    if (!object) return false;
    const bytes = await new Response(object.body).arrayBuffer();
    if (bytes.byteLength !== row.size || await hashBytes(bytes) !== row.sha256) return false;
  }
  for (const row of rows.filter((item) => item.session_id && !expectedIds.has(item.session_id))) {
    const sessionId = row.session_id;
    if (!sessionId) continue;
    try { await objectStore().delete(row.object_key); } catch { /* orphan cleanup can be retried without exposing the state */ }
    await execute("DELETE FROM synced_pdf WHERE user_id = ? AND session_id = ?", [accountId, sessionId]);
  }
  const stateRow = await queryOne<{ sync_complete: number; revision: number }>("SELECT sync_complete, revision FROM synced_app_state WHERE user_id = ?", [accountId]);
  if (!stateRow || stateRow.revision !== revision) return false;
  if (Number(stateRow.sync_complete) !== 1) {
    const result = await execute("UPDATE synced_app_state SET sync_complete = 1 WHERE user_id = ? AND revision = ? AND sync_complete = 0", [accountId, revision]);
    if (result.changes !== 1) return false;
  }
  return true;
}

function readManifest(state: unknown): PdfSyncManifest[] | null {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  return normalizePdfManifest((state as Record<string, unknown>).__syncPdfManifest);
}

function requestedSessionId(request: Request) { const value = new URL(request.url).searchParams.get("sessionId") ?? ""; return /^[a-zA-Z0-9._:-]{1,180}$/.test(value) ? value : ""; }
function decodeHeaderValue(value: string | null) { if (!value || value.length > 800) return ""; try { return decodeURIComponent(value); } catch { return ""; } }
async function hashBytes(bytes: ArrayBuffer) { const digest = await crypto.subtle.digest("SHA-256", bytes); return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""); }
function json(value: unknown, status = 200) { return NextResponse.json(value, { status, headers: { "cache-control": "no-store" } }); }
