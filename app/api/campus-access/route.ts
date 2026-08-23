import { NextResponse } from "next/server";
import { accountForRequest } from "../../server-auth-response";
import { execute, queryOne } from "@/lib/server/database";
import { isSameOriginRequest } from "@/lib/server/request-security";
import { campusAccessForAuthenticatedUsers } from "@/lib/server/campus-access-policy";

type AccessBody = { code?: unknown };

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "送信元を確認できませんでした。" }, { status: 403 });
  }
  const auth = await accountForRequest(request);
  if ("response" in auth) return auth.response;
  const account = auth.account;
  if (campusAccessForAuthenticatedUsers()) return NextResponse.json({ ok: true, access: "authenticated" });

  let body: AccessBody;
  try {
    body = await request.json() as AccessBody;
  } catch {
    return NextResponse.json({ error: "招待コードを読み取れませんでした。" }, { status: 400 });
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code || code.length > 80) {
    return NextResponse.json({ error: "招待コードをご確認ください。" }, { status: 400 });
  }

  const now = Date.now();
  const attemptWindow = await queryOne<{ attempts: number; window_started_at: number }>(
    "SELECT attempts, window_started_at FROM campus_invite_attempts WHERE user_id = ?",
    [account.id],
  );
  const withinWindow = Boolean(attemptWindow && now - attemptWindow.window_started_at < 60 * 60 * 1000);
  if (withinWindow && (attemptWindow?.attempts ?? 0) >= 8) {
    return NextResponse.json({ error: "短時間の確認上限に達しました。しばらくしてからお試しください。" }, { status: 429 });
  }

  const expected = typeof process.env.CAMPUS_BETA_CODE === "string"
    ? process.env.CAMPUS_BETA_CODE
    : process.env.NODE_ENV !== "production" ? "CMTR-PREVIEW" : "";
  if (!expected) {
    return NextResponse.json({ error: "現在、招待受付の準備中です。" }, { status: 503 });
  }

  const [actualDigest, expectedDigest] = await Promise.all([digest(code), digest(expected)]);
  if (!timingSafeEqual(actualDigest, expectedDigest)) {
    await execute(
      "INSERT INTO campus_invite_attempts (user_id, attempts, window_started_at) VALUES (?, 1, ?) ON CONFLICT(user_id) DO UPDATE SET attempts = CASE WHEN ? - window_started_at < 3600000 THEN attempts + 1 ELSE 1 END, window_started_at = CASE WHEN ? - window_started_at < 3600000 THEN window_started_at ELSE ? END",
      [account.id, now, now, now, now],
    );
    return NextResponse.json({ error: "招待コードが一致しません。" }, { status: 403 });
  }

  await execute(
    "INSERT INTO campus_memberships (user_id, activated_at, revoked_at) VALUES (?, ?, NULL) ON CONFLICT(user_id) DO UPDATE SET activated_at = excluded.activated_at, revoked_at = NULL",
    [account.id, now],
  );
  await execute("DELETE FROM campus_invite_attempts WHERE user_id = ?", [account.id]);

  return NextResponse.json({ ok: true });
}

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}
