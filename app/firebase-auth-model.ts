const CLOCK_SKEW_SECONDS = 60;

export type FirebaseClaims = {
  aud?: unknown;
  auth_time?: unknown;
  email?: unknown;
  email_verified?: unknown;
  exp?: unknown;
  firebase?: { sign_in_provider?: unknown };
  iat?: unknown;
  iss?: unknown;
  name?: unknown;
  sub?: unknown;
  user_id?: unknown;
};

export type VerifiedFirebaseIdentity = {
  issuer: string;
  subject: string;
  provider: string;
  email: string;
  displayName: string;
};

export function validateFirebaseClaims(claims: FirebaseClaims, projectId: string, nowSeconds: number): VerifiedFirebaseIdentity {
  const expectedIssuer = `https://securetoken.google.com/${projectId}`;
  const subject = typeof claims.sub === "string" ? claims.sub : "";
  const email = typeof claims.email === "string" ? claims.email.trim().toLocaleLowerCase("en-US") : "";
  if (claims.aud !== projectId || claims.iss !== expectedIssuer) throw new FirebaseAuthError("ログイン先を確認できませんでした。", 401);
  if (!subject || subject.length > 128 || (typeof claims.user_id === "string" && claims.user_id !== subject)) {
    throw new FirebaseAuthError("アカウントIDを確認できませんでした。", 401);
  }
  if (typeof claims.exp !== "number" || claims.exp <= nowSeconds - CLOCK_SKEW_SECONDS) {
    throw new FirebaseAuthError("ログインの有効期限が切れています。", 401);
  }
  if (typeof claims.iat !== "number" || claims.iat > nowSeconds + CLOCK_SKEW_SECONDS) {
    throw new FirebaseAuthError("ログイン時刻を確認できませんでした。", 401);
  }
  if (typeof claims.auth_time !== "number" || claims.auth_time > nowSeconds + CLOCK_SKEW_SECONDS) {
    throw new FirebaseAuthError("本人確認時刻を確認できませんでした。", 401);
  }
  if (!email || claims.email_verified !== true) {
    throw new FirebaseAuthError("確認済みのメールアドレスが必要です。", 403);
  }
  const provider = typeof claims.firebase?.sign_in_provider === "string"
    ? claims.firebase.sign_in_provider
    : "firebase";
  const displayName = typeof claims.name === "string" && claims.name.trim() ? claims.name.trim() : email;
  return { issuer: expectedIssuer, subject, provider, email, displayName };
}

export class FirebaseAuthError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
