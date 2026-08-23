import { NextResponse } from "next/server";
import { objectStore } from "@/lib/server/object-store";
import {
  completeDirectPdfUpload,
  directPdfObjectKey,
  parsePendingPdfTransfer,
  resolveCommittedPdf,
  validatePendingPdfTransfer,
} from "@/lib/server/pdf-transfer";
import { isSameOriginRequest } from "@/lib/server/request-security";
import { accountForRequest } from "@/app/server-auth-response";

type TransferBody = {
  operation?: unknown;
  sessionId?: unknown;
};

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return json({ error: "送信元を確認できませんでした。" }, 403);
  const auth = await accountForRequest(request);
  if ("response" in auth) return auth.response;
  let body: TransferBody & Record<string, unknown>;
  try {
    body = await request.json() as TransferBody & Record<string, unknown>;
  } catch {
    return json({ error: "PDF転送の内容を読み取れませんでした。" }, 400);
  }

  const store = objectStore();
  if (!store.createDirectUpload || !store.createDirectDownload) return json({ direct: false });

  if (body.operation === "prepare-upload") {
    const input = parsePendingPdfTransfer(body);
    if (!input) return json({ error: "PDF転送の内容を確認できませんでした。" }, 400);
    const validation = await validatePendingPdfTransfer(auth.account.id, input);
    if (!validation.ok) return json(validation, validation.status);
    const objectKey = directPdfObjectKey(auth.account.id, input);
    try {
      const transfer = await store.createDirectUpload(objectKey, {
        contentType: "application/pdf",
        maximumSizeInBytes: input.size,
      });
      return json({ direct: true, uploadUrl: transfer.url, expiresAt: transfer.expiresAt });
    } catch {
      return json({ error: "PDFの安全なアップロード先を準備できませんでした。" }, 503);
    }
  }

  if (body.operation === "complete-upload") {
    const input = parsePendingPdfTransfer(body);
    if (!input) return json({ error: "PDF転送の完了内容を確認できませんでした。" }, 400);
    const result = await completeDirectPdfUpload(auth.account.id, input);
    if (!result.ok) return json(result, result.status);
    return json({
      direct: true,
      ok: true,
      transactionId: input.transactionId,
      sessionId: input.sessionId,
      size: input.size,
      sha256: input.sha256,
      stateRevision: input.stateRevision,
      noteVersion: input.noteVersion,
      staged: true,
    });
  }

  if (body.operation === "prepare-download") {
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const resolved = await resolveCommittedPdf(auth.account.id, sessionId);
    if (!resolved.ok) return json(resolved, resolved.status);
    try {
      const transfer = await store.createDirectDownload(resolved.value.object_key);
      return json({
        direct: true,
        downloadUrl: transfer.url,
        expiresAt: transfer.expiresAt,
        sessionId,
        size: resolved.value.size,
        sha256: resolved.value.sha256,
        stateRevision: resolved.value.state_revision,
        noteVersion: resolved.value.note_version,
      });
    } catch {
      return json({ error: "PDFの安全なダウンロード先を準備できませんでした。" }, 503);
    }
  }

  return json({ error: "PDF転送の操作を確認できませんでした。" }, 400);
}

function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "cache-control": "no-store" } });
}
