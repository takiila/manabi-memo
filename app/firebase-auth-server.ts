import {
  FirebaseAuthError,
  validateFirebaseClaims,
  type FirebaseClaims,
  type VerifiedFirebaseIdentity,
} from "./firebase-auth-model";

const FIREBASE_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

type FirebaseJwtHeader = {
  alg?: unknown;
  kid?: unknown;
  typ?: unknown;
};

type FirebaseJwk = JsonWebKey & { kid?: string; kty?: string };

let cachedKeys: { expiresAt: number; keys: FirebaseJwk[] } | null = null;

export function firebaseProjectId() {
  const value = process.env.FIREBASE_PROJECT_ID;
  return typeof value === "string" ? value.trim() : "";
}

export async function verifyFirebaseRequest(request: Request): Promise<VerifiedFirebaseIdentity | null> {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) return null;
  return verifyFirebaseIdToken(match[1]);
}

export async function verifyFirebaseIdToken(token: string): Promise<VerifiedFirebaseIdentity> {
  const projectId = firebaseProjectId();
  if (!projectId) throw new FirebaseAuthError("Firebase認証はまだ設定されていません。", 503);
  if (token.length > 16_384) throw new FirebaseAuthError("ログイン情報が大きすぎます。", 401);

  const parts = token.split(".");
  if (parts.length !== 3) throw new FirebaseAuthError("ログイン情報を確認できませんでした。", 401);
  const header = decodeJson<FirebaseJwtHeader>(parts[0]);
  const claims = decodeJson<FirebaseClaims>(parts[1]);
  if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) {
    throw new FirebaseAuthError("ログイン情報の署名形式を確認できませんでした。", 401);
  }

  const identity = validateFirebaseClaims(claims, projectId, Math.floor(Date.now() / 1000));
  const jwk = (await firebaseJwks()).find((item) => item.kid === header.kid && item.kty === "RSA");
  if (!jwk) throw new FirebaseAuthError("ログイン情報の署名鍵を確認できませんでした。", 401);

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    decodeBase64Url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) throw new FirebaseAuthError("ログイン情報の署名が一致しません。", 401);
  return identity;
}

async function firebaseJwks() {
  if (cachedKeys && cachedKeys.expiresAt > Date.now()) return cachedKeys.keys;
  const response = await fetch(FIREBASE_JWKS_URL, { headers: { accept: "application/json" } });
  if (!response.ok) throw new FirebaseAuthError("認証サービスへ接続できませんでした。", 503);
  const body = await response.json() as { keys?: FirebaseJwk[] };
  if (!Array.isArray(body.keys) || body.keys.length === 0) throw new FirebaseAuthError("認証鍵を取得できませんでした。", 503);
  const maxAge = Number(response.headers.get("cache-control")?.match(/max-age=(\d+)/i)?.[1] ?? 3600);
  cachedKeys = { keys: body.keys, expiresAt: Date.now() + Math.max(300, Math.min(maxAge, 21_600)) * 1000 };
  return body.keys;
}

function decodeJson<T>(value: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
  } catch {
    throw new FirebaseAuthError("ログイン情報を読み取れませんでした。", 401);
  }
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new FirebaseAuthError("ログイン情報を読み取れませんでした。", 401);
  }
}

export { FirebaseAuthError } from "./firebase-auth-model";
export type { VerifiedFirebaseIdentity } from "./firebase-auth-model";
