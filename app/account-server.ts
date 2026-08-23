import "server-only";

import { execute, queryOne } from "@/lib/server/database";
import { objectStore } from "@/lib/server/object-store";
import { getChatGPTUser } from "./chatgpt-auth";
import { verifyFirebaseRequest, type VerifiedFirebaseIdentity } from "./firebase-auth-server";

export type AccountIdentity = {
  id: string;
  displayName: string;
  email: string;
  issuer: string;
  subject: string;
  provider: string;
};

type AuthIdentity = {
  issuer: string;
  subject: string;
  provider: string;
  email: string;
  displayName: string;
};

const CHATGPT_ISSUER = "https://chatgpt.com/sites";

export async function getAccountIdentity(request?: Request): Promise<AccountIdentity | null> {
  if (request?.headers.get("authorization")) {
    const firebase = await verifyFirebaseRequest(request);
    return firebase ? resolveAccount(firebase) : null;
  }
  return getLegacyChatGPTAccountIdentity();
}

export async function getFirebaseAccountIdentity(request: Request): Promise<AccountIdentity | null> {
  const firebase = await verifyFirebaseRequest(request);
  return firebase ? resolveAccount(firebase) : null;
}

export async function getLegacyChatGPTAccountIdentity(): Promise<AccountIdentity | null> {
  if (process.env.TRUST_CHATGPT_AUTH_HEADERS !== "true") return null;
  const user = await getChatGPTUser();
  if (!user) return null;
  const legacyKey = await sha256(user.email.trim().toLocaleLowerCase("en-US"));
  const existing = await queryOne<{ id: string }>("SELECT id FROM accounts WHERE provider_key = ?", [legacyKey]);
  const accountId = existing?.id ?? crypto.randomUUID();
  const now = Date.now();
  if (!existing) {
    await execute(
      "INSERT INTO accounts (id, provider_key, created_at, last_seen_at) VALUES (?, ?, ?, ?) ON CONFLICT(provider_key) DO UPDATE SET last_seen_at = excluded.last_seen_at",
      [accountId, legacyKey, now, now],
    );
  }
  await execute(
    "INSERT INTO auth_identities (issuer, subject, provider, account_id, verified_at, created_at, last_seen_at) VALUES (?, ?, 'chatgpt', ?, ?, ?, ?) ON CONFLICT(issuer, subject) DO UPDATE SET last_seen_at = excluded.last_seen_at",
    [CHATGPT_ISSUER, legacyKey, accountId, now, now, now],
  );
  const linked = await queryOne<{ account_id: string }>(
    "SELECT account_id FROM auth_identities WHERE issuer = ? AND subject = ?",
    [CHATGPT_ISSUER, legacyKey],
  );
  if (!linked) throw new Error("旧アカウントを準備できませんでした。");
  await execute("UPDATE accounts SET last_seen_at = ? WHERE id = ?", [now, linked.account_id]);
  return { id: linked.account_id, displayName: user.displayName, email: user.email, issuer: CHATGPT_ISSUER, subject: legacyKey, provider: "chatgpt" };
}

export async function linkFirebaseIdentityToLegacyAccount(firebase: AccountIdentity, legacy: AccountIdentity) {
  if (firebase.provider === "chatgpt" || legacy.provider !== "chatgpt") throw new Error("連携する認証を確認できませんでした。");
  if (firebase.id === legacy.id) return { accountId: legacy.id, alreadyLinked: true };
  const [firebaseState, firebasePdfs, firebaseMembership, otherIdentities, orphanedObjects] = await Promise.all([
    queryOne("SELECT user_id FROM synced_app_state WHERE user_id = ?", [firebase.id]),
    queryOne("SELECT session_id FROM synced_pdf WHERE user_id = ? LIMIT 1", [firebase.id]),
    queryOne("SELECT user_id FROM campus_memberships WHERE user_id = ?", [firebase.id]),
    queryOne("SELECT issuer FROM auth_identities WHERE account_id = ? AND NOT (issuer = ? AND subject = ?) LIMIT 1", [firebase.id, firebase.issuer, firebase.subject]),
    objectStore().hasPrefix(`${firebase.id}/`),
  ]);
  if (firebaseState || firebasePdfs || firebaseMembership || otherIdentities || orphanedObjects) return { accountId: firebase.id, conflict: true };
  const identityUpdate = await execute(
    `UPDATE auth_identities SET account_id = ?, last_seen_at = ?
     WHERE issuer = ? AND subject = ? AND account_id = ?
       AND NOT EXISTS (SELECT 1 FROM synced_app_state WHERE user_id = ?)
       AND NOT EXISTS (SELECT 1 FROM synced_pdf WHERE user_id = ?)
       AND NOT EXISTS (SELECT 1 FROM campus_memberships WHERE user_id = ?)
       AND NOT EXISTS (SELECT 1 FROM auth_identities WHERE account_id = ? AND NOT (issuer = ? AND subject = ?))`,
    [legacy.id, Date.now(), firebase.issuer, firebase.subject, firebase.id, firebase.id, firebase.id, firebase.id, firebase.id, firebase.issuer, firebase.subject],
  );
  await execute("DELETE FROM campus_invite_attempts WHERE user_id = ? AND NOT EXISTS (SELECT 1 FROM auth_identities WHERE account_id = ?)", [firebase.id, firebase.id]);
  await execute("DELETE FROM accounts WHERE id = ? AND NOT EXISTS (SELECT 1 FROM auth_identities WHERE account_id = ?)", [firebase.id, firebase.id]);
  if (identityUpdate.changes !== 1) return { accountId: firebase.id, conflict: true };
  return { accountId: legacy.id, linked: true };
}

async function resolveAccount(identity: VerifiedFirebaseIdentity | AuthIdentity): Promise<AccountIdentity> {
  const now = Date.now();
  let linked = await queryOne<{ account_id: string }>("SELECT account_id FROM auth_identities WHERE issuer = ? AND subject = ?", [identity.issuer, identity.subject]);
  if (!linked) {
    const accountId = crypto.randomUUID();
    const providerKey = `identity:${await sha256(`${identity.issuer}\u0000${identity.subject}`)}`;
    try {
      await execute("INSERT INTO accounts (id, provider_key, created_at, last_seen_at) VALUES (?, ?, ?, ?)", [accountId, providerKey, now, now]);
      await execute(
        "INSERT INTO auth_identities (issuer, subject, provider, account_id, verified_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [identity.issuer, identity.subject, identity.provider, accountId, now, now, now],
      );
    } catch {
      // 同じ初回リクエストが並行した場合は、先に作成された対応を採用する。
    }
    linked = await queryOne<{ account_id: string }>("SELECT account_id FROM auth_identities WHERE issuer = ? AND subject = ?", [identity.issuer, identity.subject]);
  }
  if (!linked) throw new Error("アカウントを準備できませんでした。");
  await execute("UPDATE accounts SET last_seen_at = ? WHERE id = ?", [now, linked.account_id]);
  await execute("UPDATE auth_identities SET provider = ?, last_seen_at = ? WHERE issuer = ? AND subject = ?", [identity.provider, now, identity.issuer, identity.subject]);
  return { id: linked.account_id, displayName: identity.displayName, email: identity.email, issuer: identity.issuer, subject: identity.subject, provider: identity.provider };
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
