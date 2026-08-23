import assert from "node:assert/strict";
import test from "node:test";
import { validateFirebaseClaims } from "../app/firebase-auth-model.ts";

const now = 1_786_600_000;
const projectId = "manabi-memo-auth";

function claims(patch = {}) {
  return {
    aud: projectId,
    iss: `https://securetoken.google.com/${projectId}`,
    sub: "firebase-user-123",
    user_id: "firebase-user-123",
    email: "Student@Example.com",
    email_verified: true,
    exp: now + 3600,
    iat: now - 20,
    auth_time: now - 30,
    name: "学習者",
    firebase: { sign_in_provider: "google.com" },
    ...patch,
  };
}

test("確認済みFirebase claimを安定したissuerとsubjectへ変換する", () => {
  assert.deepEqual(validateFirebaseClaims(claims(), projectId, now), {
    issuer: `https://securetoken.google.com/${projectId}`,
    subject: "firebase-user-123",
    provider: "google.com",
    email: "student@example.com",
    displayName: "学習者",
  });
});

test("未確認メールではクラウド所有者を作らない", () => {
  assert.throws(() => validateFirebaseClaims(claims({ email_verified: false }), projectId, now), (error) => error.status === 403);
});

test("別プロジェクト・期限切れ・subject不一致を拒否する", () => {
  assert.throws(() => validateFirebaseClaims(claims({ aud: "other" }), projectId, now), (error) => error.status === 401);
  assert.throws(() => validateFirebaseClaims(claims({ exp: now - 120 }), projectId, now), (error) => error.status === 401);
  assert.throws(() => validateFirebaseClaims(claims({ user_id: "different" }), projectId, now), (error) => error.status === 401);
});
