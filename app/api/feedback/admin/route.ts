import { NextResponse } from "next/server";
import { execute, queryAll } from "@/lib/server/database";
import { FirebaseAuthError, verifyFirebaseRequest } from "../../../firebase-auth-server";

const FEEDBACK_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

export async function GET(request: Request) {
  try {
    const identity = await verifyFirebaseRequest(request);
    if (!identity) return json({ error: "ログインが必要です。" }, 401);
    const adminEmail = process.env.FEEDBACK_ADMIN_EMAIL?.trim().toLocaleLowerCase("en-US") ?? "";
    if (!adminEmail || identity.email.toLocaleLowerCase("en-US") !== adminEmail) return json({ error: "このページは管理者専用です。" }, 403);
    await execute("DELETE FROM feedback WHERE created_at < ?", [Date.now() - FEEDBACK_RETENTION_MS]);
    const items = await queryAll<{ id: string; category: string; message: string; reply_email: string | null; source_view: string; created_at: number }>(
      "SELECT id, category, message, reply_email, source_view, created_at FROM feedback ORDER BY created_at DESC LIMIT 200",
    );
    return json({ items });
  } catch (cause) {
    if (cause instanceof FirebaseAuthError) return json({ error: cause.message }, cause.status);
    console.error("Feedback admin failed", cause);
    return json({ error: "フィードバックを読み込めませんでした。" }, 503);
  }
}

function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "cache-control": "no-store" } });
}
