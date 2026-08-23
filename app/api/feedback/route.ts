import { NextResponse } from "next/server";
import { execute, queryAll } from "@/lib/server/database";
import { isSameOriginRequest } from "@/lib/server/request-security";

const categories = new Set(["bug", "usability", "request", "other"]);
const FEEDBACK_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

type FeedbackBody = {
  category?: unknown;
  message?: unknown;
  replyEmail?: unknown;
  sourceView?: unknown;
  deviceId?: unknown;
  website?: unknown;
};

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "送信元を確認できませんでした。" }, { status: 403 });

  let body: FeedbackBody;
  try { body = await request.json() as FeedbackBody; } catch { return NextResponse.json({ error: "入力内容を読み取れませんでした。" }, { status: 400 }); }
  if (typeof body.website === "string" && body.website.trim()) return NextResponse.json({ ok: true });

  const category = typeof body.category === "string" ? body.category : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const replyEmail = typeof body.replyEmail === "string" ? body.replyEmail.trim() : "";
  const sourceView = typeof body.sourceView === "string" ? body.sourceView.slice(0, 40) : "unknown";
  const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
  if (!categories.has(category) || message.length < 5 || message.length > 2000) return NextResponse.json({ error: "種類と5〜2,000文字の内容を入力してください。" }, { status: 400 });
  if (!/^[a-zA-Z0-9-]{20,80}$/.test(deviceId)) return NextResponse.json({ error: "送信の準備に失敗しました。ページを開き直してください。" }, { status: 400 });
  if (replyEmail && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyEmail) || replyEmail.length > 200)) return NextResponse.json({ error: "返信先メールアドレスをご確認ください。" }, { status: 400 });

  try {
    const now = Date.now();
    await execute("DELETE FROM feedback WHERE created_at < ?", [now - FEEDBACK_RETENTION_MS]);
    const recent = await queryAll<{ id: string }>("SELECT id FROM feedback WHERE device_id = ? AND created_at >= ? LIMIT 5", [deviceId, now - 60 * 60 * 1000]);
    if (recent.length >= 5) return NextResponse.json({ error: "短時間の送信上限に達しました。しばらくしてからお試しください。" }, { status: 429 });
    await execute(
      "INSERT INTO feedback (id, category, message, reply_email, source_view, device_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'new', ?)",
      [crypto.randomUUID(), category, message, replyEmail || null, sourceView, deviceId, now],
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Feedback submission failed", error);
    return NextResponse.json({ error: "現在送信できません。少し時間をおいてお試しください。" }, { status: 503 });
  }
}
