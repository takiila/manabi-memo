import { NextResponse } from "next/server";
import {
  getFirebaseAccountIdentity,
  getLegacyChatGPTAccountIdentity,
  linkFirebaseIdentityToLegacyAccount,
} from "../../../account-server";
import { FirebaseAuthError } from "../../../firebase-auth-server";
import { isSameOriginRequest } from "@/lib/server/request-security";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return json({ error: "送信元を確認できませんでした。" }, 403);
  try {
    const [firebase, legacy] = await Promise.all([
      getFirebaseAccountIdentity(request),
      getLegacyChatGPTAccountIdentity(),
    ]);
    if (!firebase) return json({ error: "Firebaseアカウントでログインしてください。" }, 401);
    if (!legacy) return json({ error: "旧ChatGPT同期データを確認するには、ChatGPTでも本人確認してください。" }, 409);
    const result = await linkFirebaseIdentityToLegacyAccount(firebase, legacy);
    if (result.conflict) {
      return json({ error: "新旧アカウントの両方にクラウドデータがあります。自動統合せず、個別確認が必要です。", conflict: true }, 409);
    }
    return json({ ok: true, accountId: result.accountId });
  } catch (cause) {
    if (cause instanceof FirebaseAuthError) return json({ error: cause.message }, cause.status);
    return json({ error: cause instanceof Error ? cause.message : "アカウントを連携できませんでした。" }, 503);
  }
}

function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "cache-control": "no-store" } });
}
