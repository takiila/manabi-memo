import { NextResponse } from "next/server";
import { queryAll, queryOne, withTransaction } from "@/lib/server/database";
import { objectStore } from "@/lib/server/object-store";
import { isSameOriginRequest } from "@/lib/server/request-security";
import { accountForRequest } from "../../../server-auth-response";
import { pdfVersionsFromState } from "../../../pdf-sync-model";
import {
  isCommittedPdfMetadata,
  normalizePdfManifest,
  validatePdfManifest,
  type PdfSyncManifest,
  type PdfSyncMetadata,
} from "../../../sync-integrity-model";

const MAX_STATE_BYTES = 4_500_000;
const MAX_PDF_IDS = 1000;
const DEVICE_ID_PATTERN = /^[a-zA-Z0-9._:-]{8,120}$/;
const TRANSACTION_ID_PATTERN = /^[a-zA-Z0-9-]{16,100}$/;

type PutBody = { baseRevision?: unknown; schemaVersion?: unknown; state?: unknown; deviceId?: unknown; pdfIds?: unknown };
type TransactionBody = PutBody & { transactionId?: unknown; pdfs?: unknown };
type StateRow = {
  revision: number;
  schema_version: number;
  payload: string;
  updated_at: number;
  updated_by: string;
  deleted_at: number | null;
  pdf_manifest: string;
  sync_complete: number;
};
type PdfRow = { session_id: string; object_key: string; size: number; sha256: string; state_revision: number; note_version: string; updated_at: number };
type TransactionRow = {
  id: string;
  user_id: string;
  base_revision: number;
  target_revision: number;
  schema_version: number;
  payload: string;
  device_id: string;
  status: string;
  created_at: number;
  updated_at: number;
  committed_at: number | null;
};
type TransactionPdfRow = {
  transaction_id: string;
  user_id: string;
  session_id: string;
  object_key: string;
  size: number;
  sha256: string;
  state_revision: number;
  note_version: string;
  uploaded_at: number;
};

export async function GET(request: Request) {
  const auth = await accountForRequest(request);
  if ("response" in auth) return auth.response;
  const row = await queryOne<StateRow>(
    "SELECT revision, schema_version, payload, updated_at, updated_by, deleted_at, pdf_manifest, sync_complete FROM synced_app_state WHERE user_id = ?",
    [auth.account.id],
  );
  if (!row) {
    const pending = await pendingTransaction(auth.account.id);
    return json({ exists: false, revision: 0, pdfs: [], pending: Boolean(pending), pendingTransactionId: pending?.id ?? null });
  }
  if (row.deleted_at) {
    return json({ exists: true, deleted: true, revision: row.revision, schemaVersion: row.schema_version, state: null, updatedAt: new Date(row.updated_at).toISOString(), updatedBy: row.updated_by, pdfs: [] });
  }

  let state: unknown;
  try { state = JSON.parse(row.payload); } catch { return json({ error: "クラウドデータを読み取れませんでした。" }, 500); }
  const pending = await pendingTransaction(auth.account.id);
  if (Number(row.sync_complete) !== 1) {
    return json({ exists: false, pending: true, revision: row.revision, pdfs: [], pendingTransactionId: pending?.id ?? null });
  }

  let inspected: Awaited<ReturnType<typeof inspectPdfSet>>;
  try { inspected = await inspectPdfSet(auth.account.id, row.revision, state); } catch { return json({ error: "PDF本体を確認できませんでした。" }, 503); }
  if (!inspected.valid) {
    return json({ exists: true, pending: true, incomplete: true, revision: row.revision, schemaVersion: row.schema_version, state: null, updatedAt: new Date(row.updated_at).toISOString(), updatedBy: row.updated_by, pdfs: [], pendingTransactionId: pending?.id ?? null });
  }
  return json({ exists: true, revision: row.revision, schemaVersion: row.schema_version, state, updatedAt: new Date(row.updated_at).toISOString(), updatedBy: row.updated_by, pdfs: inspected.pdfs });
}

/**
 * Legacy state PUT is kept for old clients. When PDFs are referenced it now
 * writes an incomplete marker and remains invisible to GET until every
 * matching PDF PUT arrives. New clients use POST prepare/commit below.
 */
export async function PUT(request: Request) {
  if (!isSameOriginRequest(request)) return json({ error: "送信元を確認できませんでした。" }, 403);
  const auth = await accountForRequest(request);
  if ("response" in auth) return auth.response;
  let body: PutBody;
  try { body = await request.json() as PutBody; } catch { return json({ error: "同期内容を読み取れませんでした。" }, 400); }
  const parsed = parseStateBody(body);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);

  const accountId = auth.account.id;
  const now = Date.now();
  let result: { revision: number; complete: boolean; oldObjects: string[] };
  try {
    result = await withTransaction(async (transaction) => {
      const current = firstOrNull(await transaction.queryAll<StateRow>(
        "SELECT revision, schema_version, payload, updated_at, updated_by, deleted_at, pdf_manifest, sync_complete FROM synced_app_state WHERE user_id = ?",
        [accountId],
      ));
      const currentRevision = current?.revision ?? 0;
      if (currentRevision !== parsed.baseRevision) throw new SyncConflictError(currentRevision, current?.updated_at ?? null);
      const nextRevision = currentRevision + 1;
      const complete = parsed.pdfIds.length === 0;
      const manifest = JSON.stringify(parsed.pdfIds.map((sessionId) => ({ sessionId, noteVersion: parsed.pdfVersions[sessionId] })));
      const oldRows = complete ? await transaction.queryAll<{ session_id: string; object_key: string }>("SELECT session_id, object_key FROM synced_pdf WHERE user_id = ?", [accountId]) : [];
      if (current) {
        const update = await transaction.execute(
          "UPDATE synced_app_state SET revision = ?, schema_version = ?, payload = ?, updated_at = ?, updated_by = ?, deleted_at = NULL, pdf_manifest = ?, sync_complete = ? WHERE user_id = ? AND revision = ?",
          [nextRevision, parsed.schemaVersion, parsed.payload, now, parsed.deviceId, manifest, complete ? 1 : 0, accountId, parsed.baseRevision],
        );
        if (update.changes !== 1) throw new SyncConflictError(nextRevision, now);
      } else {
        await transaction.execute(
          "INSERT INTO synced_app_state (user_id, revision, schema_version, payload, updated_at, updated_by, deleted_at, pdf_manifest, sync_complete) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)",
          [accountId, nextRevision, parsed.schemaVersion, parsed.payload, now, parsed.deviceId, manifest, complete ? 1 : 0],
        );
      }
      if (complete) {
        for (const row of oldRows.filter((item) => !parsed.pdfIds.includes(item.session_id))) {
          await transaction.execute("DELETE FROM synced_pdf WHERE user_id = ? AND session_id = ?", [accountId, row.session_id]);
        }
      }
      return { revision: nextRevision, complete, oldObjects: oldRows.filter((row) => !parsed.pdfIds.includes(row.session_id)).map((row) => row.object_key) };
    });
  } catch (cause) {
    if (cause instanceof SyncConflictError) return conflictResponse(cause.currentRevision, cause.updatedAt);
    return json({ error: "現在クラウドへ保存できません。" }, 503);
  }
  for (const key of result.oldObjects) {
    try { await objectStore().delete(key); } catch { /* metadata is already consistent; a later cleanup may remove the orphan */ }
  }
  return json({ ok: true, revision: result.revision, pending: !result.complete, updatedAt: new Date(now).toISOString() });
}

/**
 * POST without a transactionId prepares a snapshot. POST with a transactionId
 * commits it after all staged PDF objects and their hashes have been checked.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return json({ error: "送信元を確認できませんでした。" }, 403);
  const auth = await accountForRequest(request);
  if ("response" in auth) return auth.response;
  let body: TransactionBody;
  try { body = await request.json() as TransactionBody; } catch { return json({ error: "同期内容を読み取れませんでした。" }, 400); }
  if (typeof body.transactionId === "string" && body.transactionId) return commitTransaction(auth.account.id, body.transactionId);
  return prepareTransaction(auth.account.id, body);
}

export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) return json({ error: "送信元を確認できませんでした。" }, 403);
  const auth = await accountForRequest(request);
  if ("response" in auth) return auth.response;
  const accountId = auth.account.id;
  const now = Date.now();
  const deleted = await withTransaction(async (transaction) => {
    const current = firstOrNull(await transaction.queryAll<{ revision: number; schema_version: number }>("SELECT revision, schema_version FROM synced_app_state WHERE user_id = ?", [accountId]));
    const nextRevision = (current?.revision ?? 0) + 1;
    await transaction.execute("DELETE FROM synced_pdf WHERE user_id = ?", [accountId]);
    await transaction.execute("DELETE FROM sync_transaction_pdfs WHERE user_id = ?", [accountId]);
    await transaction.execute("DELETE FROM sync_transactions WHERE user_id = ?", [accountId]);
    await transaction.execute(
      "INSERT INTO synced_app_state (user_id, revision, schema_version, payload, updated_at, updated_by, deleted_at, pdf_manifest, sync_complete) VALUES (?, ?, ?, 'null', ?, 'account-delete', ?, '[]', 1) ON CONFLICT(user_id) DO UPDATE SET revision = excluded.revision, schema_version = excluded.schema_version, payload = 'null', updated_at = excluded.updated_at, updated_by = excluded.updated_by, deleted_at = excluded.deleted_at, pdf_manifest = '[]', sync_complete = 1",
      [accountId, nextRevision, current?.schema_version ?? 1, now, now],
    );
    return { nextRevision };
  });
  try { await objectStore().deletePrefix(`${accountId}/`); } catch { /* deletion marker is durable; orphan cleanup is safe to retry later */ }
  return json({ ok: true, revision: deleted.nextRevision });
}

async function prepareTransaction(accountId: string, body: TransactionBody) {
  const parsed = parseStateBody(body);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const validation = validatePdfManifest(parsed.state, body.pdfs, parsed.pdfIds);
  if (!validation.ok) return json({ error: "状態とPDFの一覧・ノート更新版が一致しません。" }, 400);
  const transactionId = crypto.randomUUID();
  const now = Date.now();
  try {
    const targetRevision = await withTransaction(async (transaction) => {
      const current = firstOrNull(await transaction.queryAll<{ revision: number; updated_at: number }>("SELECT revision, updated_at FROM synced_app_state WHERE user_id = ?", [accountId]));
      const currentRevision = current?.revision ?? 0;
      if (currentRevision !== parsed.baseRevision) throw new SyncConflictError(currentRevision, current?.updated_at ?? null);
      const target = currentRevision + 1;
      const payloadWithManifest = JSON.stringify({ ...(parsed.state as Record<string, unknown>), __syncPdfManifest: validation.manifest });
      await transaction.execute(
        "INSERT INTO sync_transactions (id, user_id, base_revision, target_revision, schema_version, payload, device_id, status, created_at, updated_at, committed_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL)",
        [transactionId, accountId, parsed.baseRevision, target, parsed.schemaVersion, payloadWithManifest, parsed.deviceId, now, now],
      );
      return target;
    });
    return json({ ok: true, transactionId, revision: targetRevision, baseRevision: parsed.baseRevision, pdfs: validation.manifest });
  } catch (cause) {
    if (cause instanceof SyncConflictError) return conflictResponse(cause.currentRevision, cause.updatedAt);
    return json({ error: "同期の準備を保存できませんでした。" }, 503);
  }
}

async function commitTransaction(accountId: string, transactionId: string) {
  if (!TRANSACTION_ID_PATTERN.test(transactionId)) return json({ error: "同期トランザクションを確認できません。" }, 400);
  const transactionRow = await queryOne<TransactionRow>("SELECT id, user_id, base_revision, target_revision, schema_version, payload, device_id, status, created_at, updated_at, committed_at FROM sync_transactions WHERE id = ? AND user_id = ?", [transactionId, accountId]);
  if (!transactionRow) return json({ error: "同期トランザクションが見つかりません。" }, 404);
  if (transactionRow.status === "committed") return json({ ok: true, transactionId, revision: transactionRow.target_revision, committed: true });
  if (transactionRow.status !== "pending") return json({ error: "同期トランザクションは使用できません。", conflict: true }, 409);

  let state: unknown;
  try { state = JSON.parse(transactionRow.payload); } catch { return json({ error: "同期内容を確認できません。" }, 409); }
  const manifest = readTransactionManifest(state);
  if (!manifest) return json({ error: "同期内容とPDF一覧を確認できません。" }, 409);
  const committedPayload = statePayloadWithoutManifest(state);
  const rows = await queryAll<TransactionPdfRow>("SELECT transaction_id, user_id, session_id, object_key, size, sha256, state_revision, note_version, uploaded_at FROM sync_transaction_pdfs WHERE transaction_id = ? AND user_id = ? ORDER BY session_id", [transactionId, accountId]);
  if (!sameManifest(manifest, rows, transactionRow.target_revision)) return json({ error: "PDFのアップロードが完了していません。", incomplete: true }, 409);
  try {
    for (const row of rows) {
      const bytes = await objectBytes(row.object_key);
      if (!bytes || bytes.byteLength !== row.size || await hashBytes(bytes) !== row.sha256) return json({ error: "PDF本体の整合性を確認できませんでした。", incomplete: true }, 409);
    }
  } catch {
    return json({ error: "PDF本体を確認できませんでした。" }, 503);
  }

  let committed: { oldObjects: string[] };
  try {
    committed = await withTransaction(async (transaction) => {
      const latestTransaction = firstOrNull(await transaction.queryAll<TransactionRow>("SELECT id, user_id, base_revision, target_revision, schema_version, payload, device_id, status, created_at, updated_at, committed_at FROM sync_transactions WHERE id = ? AND user_id = ?", [transactionId, accountId]));
      if (!latestTransaction) throw new MissingTransactionError();
      if (latestTransaction.status === "committed") return { oldObjects: [] };
      if (latestTransaction.status !== "pending") throw new SyncConflictError(latestTransaction.target_revision, latestTransaction.updated_at);
      const current = firstOrNull(await transaction.queryAll<StateRow>("SELECT revision, schema_version, payload, updated_at, updated_by, deleted_at, pdf_manifest, sync_complete FROM synced_app_state WHERE user_id = ?", [accountId]));
      const currentRevision = current?.revision ?? 0;
      if (currentRevision !== latestTransaction.base_revision) {
        await transaction.execute("UPDATE sync_transactions SET status = 'aborted', updated_at = ? WHERE id = ? AND status = 'pending'", [Date.now(), transactionId]);
        throw new SyncConflictError(currentRevision, current?.updated_at ?? null);
      }
      const oldRows = await transaction.queryAll<{ object_key: string }>("SELECT object_key FROM synced_pdf WHERE user_id = ?", [accountId]);
      const now = Date.now();
      const pdfManifest = JSON.stringify(manifest);
      if (current) {
        const update = await transaction.execute(
          "UPDATE synced_app_state SET revision = ?, schema_version = ?, payload = ?, updated_at = ?, updated_by = ?, deleted_at = NULL, pdf_manifest = ?, sync_complete = 1 WHERE user_id = ? AND revision = ?",
          [latestTransaction.target_revision, latestTransaction.schema_version, committedPayload, now, latestTransaction.device_id, pdfManifest, accountId, latestTransaction.base_revision],
        );
        if (update.changes !== 1) throw new SyncConflictError(latestTransaction.target_revision, now);
      } else {
        await transaction.execute(
          "INSERT INTO synced_app_state (user_id, revision, schema_version, payload, updated_at, updated_by, deleted_at, pdf_manifest, sync_complete) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 1)",
          [accountId, latestTransaction.target_revision, latestTransaction.schema_version, committedPayload, now, latestTransaction.device_id, pdfManifest],
        );
      }
      await transaction.execute("DELETE FROM synced_pdf WHERE user_id = ?", [accountId]);
      for (const row of rows) {
        await transaction.execute(
          "INSERT INTO synced_pdf (user_id, session_id, object_key, size, sha256, state_revision, note_version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [accountId, row.session_id, row.object_key, row.size, row.sha256, latestTransaction.target_revision, row.note_version, now],
        );
      }
      await transaction.execute("UPDATE sync_transactions SET status = 'committed', updated_at = ?, committed_at = ? WHERE id = ? AND status = 'pending'", [now, now, transactionId]);
      return { oldObjects: oldRows.map((row) => row.object_key) };
    });
  } catch (cause) {
    if (cause instanceof MissingTransactionError) return json({ error: "同期トランザクションが見つかりません。" }, 404);
    if (cause instanceof SyncConflictError) return conflictResponse(cause.currentRevision, cause.updatedAt);
    return json({ error: "クラウド同期を確定できませんでした。" }, 503);
  }
  const newObjects = new Set(rows.map((row) => row.object_key));
  for (const key of committed.oldObjects.filter((value) => !newObjects.has(value))) {
    try { await objectStore().delete(key); } catch { /* DB commit is already a consistent snapshot; clean-up can be retried later. */ }
  }
  return json({ ok: true, transactionId, revision: transactionRow.target_revision, committed: true });
}

function parseStateBody(body: PutBody) {
  const baseRevision = integerInRange(body.baseRevision, 0, Number.MAX_SAFE_INTEGER);
  const schemaVersion = integerInRange(body.schemaVersion, 1, 1000);
  const deviceId = typeof body.deviceId === "string" && DEVICE_ID_PATTERN.test(body.deviceId) ? body.deviceId : "";
  const pdfIds = normalizePdfIds(body.pdfIds);
  const state = body.state;
  if (baseRevision === null || schemaVersion === null || !deviceId || !validStateShape(state) || !pdfIds) return { ok: false as const, error: "同期内容の形式を確認できませんでした。", status: 400 as const };
  const payload = JSON.stringify(state);
  if (new TextEncoder().encode(payload).byteLength > MAX_STATE_BYTES) return { ok: false as const, error: "ノートデータが同期上限を超えています。PDFを除いた状態でも大きすぎます。", status: 413 as const };
  const pdfVersions = pdfVersionsFromState(state);
  if (!sameStringSet(pdfIds, Object.keys(pdfVersions).sort())) return { ok: false as const, error: "状態とPDFの一覧が一致しません。", status: 400 as const };
  return { ok: true as const, baseRevision, schemaVersion, deviceId, pdfIds, pdfVersions, state, payload };
}

function readTransactionManifest(state: unknown) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  return normalizePdfManifest((state as Record<string, unknown>).__syncPdfManifest);
}

function statePayloadWithoutManifest(state: unknown) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return JSON.stringify(state);
  const copy = { ...(state as Record<string, unknown>) };
  delete copy.__syncPdfManifest;
  return JSON.stringify(copy);
}

function sameManifest(manifest: PdfSyncManifest[], rows: TransactionPdfRow[], revision: number) {
  if (manifest.length !== rows.length) return false;
  const byId = new Map(rows.map((row) => [row.session_id, row]));
  return manifest.every((item) => {
    const row = byId.get(item.sessionId);
    return Boolean(row && row.state_revision === revision && row.size === item.size && row.sha256 === item.sha256 && row.note_version === item.noteVersion);
  });
}

async function inspectPdfSet(userId: string, revision: number, state: unknown) {
  const rows = await queryAll<PdfRow>("SELECT session_id, object_key, size, sha256, state_revision, note_version, updated_at FROM synced_pdf WHERE user_id = ? ORDER BY session_id", [userId]);
  const metadata: PdfSyncMetadata[] = rows.map((row) => ({ sessionId: row.session_id, size: row.size, sha256: row.sha256, stateRevision: row.state_revision, noteVersion: row.note_version }));
  if (!isCommittedPdfMetadata(state, revision, metadata)) return { valid: false as const, pdfs: [] };
  for (const row of rows) {
    const bytes = await objectBytes(row.object_key);
    if (!bytes || bytes.byteLength !== row.size || await hashBytes(bytes) !== row.sha256) return { valid: false as const, pdfs: [] };
  }
  return { valid: true as const, pdfs: rows.map(toPdfMetadata) };
}

async function pendingTransaction(userId: string) {
  return queryOne<{ id: string; target_revision: number }>("SELECT id, target_revision FROM sync_transactions WHERE user_id = ? AND status = 'pending' ORDER BY updated_at DESC LIMIT 1", [userId]);
}

async function objectBytes(key: string) {
  const object = await objectStore().get(key);
  if (!object) return null;
  return new Response(object.body).arrayBuffer();
}

async function hashBytes(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toPdfMetadata(row: PdfRow) {
  return { sessionId: row.session_id, size: row.size, sha256: row.sha256, stateRevision: row.state_revision, noteVersion: row.note_version, updatedAt: new Date(row.updated_at).toISOString() };
}

function normalizePdfIds(value: unknown) {
  if (!Array.isArray(value) || value.length > MAX_PDF_IDS) return null;
  const ids = value.filter((item): item is string => typeof item === "string" && validSessionId(item));
  return ids.length === value.length && new Set(ids).size === ids.length ? ids.sort() : null;
}

function validStateShape(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  if (!Array.isArray(state.courses) || !Array.isArray(state.sessions) || !Array.isArray(state.memos)) return false;
  if (state.courses.length > 5000 || state.sessions.length > 20000 || state.memos.length > 100000) return false;
  if (state.campus !== undefined && (!state.campus || typeof state.campus !== "object" || Array.isArray(state.campus))) return false;
  return true;
}

function validSessionId(value: string) { return /^[a-zA-Z0-9._:-]{1,180}$/.test(value); }
function integerInRange(value: unknown, minimum: number, maximum: number) { return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : null; }
function sameStringSet(left: string[], right: string[]) { return left.length === right.length && left.every((value, index) => value === right[index]); }
function firstOrNull<T>(rows: T[]) { return rows[0] ?? null; }
function json(value: unknown, status = 200) { return NextResponse.json(value, { status, headers: { "cache-control": "no-store" } }); }
function conflictResponse(currentRevision: number, updatedAt: number | null) { return json({ error: "別の端末で新しい変更が見つかりました。", conflict: true, currentRevision, updatedAt: updatedAt === null ? null : new Date(updatedAt).toISOString() }, 409); }

class SyncConflictError extends Error {
  constructor(readonly currentRevision: number, readonly updatedAt: number | null) { super("SYNC_CONFLICT"); }
}

class MissingTransactionError extends Error {}
