import { NextResponse } from "next/server";
import { getAccountIdentity } from "./account-server";
import { FirebaseAuthError } from "./firebase-auth-server";

export async function accountForRequest(request: Request) {
  try {
    const account = await getAccountIdentity(request);
    if (!account) return { response: authJson("ログインが必要です。", 401) } as const;
    return { account } as const;
  } catch (cause) {
    if (cause instanceof FirebaseAuthError) return { response: authJson(cause.message, cause.status) } as const;
    return { response: authJson("ログイン状態を確認できませんでした。", 503) } as const;
  }
}

function authJson(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}
