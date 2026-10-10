type PublicAuthConfig = {
  enabled: boolean;
  config?: { apiKey: string; appId: string; authDomain: string; projectId: string };
};

export type AuthConfigFailure = 'network' | 'timeout' | 'http' | 'invalid';

export class AuthConfigError extends Error {
  readonly reason: AuthConfigFailure;
  constructor(reason: AuthConfigFailure, message: string) {
    super(message);
    this.reason = reason;
    this.name = 'AuthConfigError';
  }
}

/** Never mistake a failed request or malformed response for intentionally disabled auth. */
export async function loadPublicAuthConfig(
  request: typeof fetch = fetch,
  timeoutMs = 8000,
): Promise<PublicAuthConfig> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await request('/api/auth/config', { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new AuthConfigError('http', '認証設定を取得できませんでした。時間を置いて再試行してください。');
    let value: unknown;
    try { value = await response.json(); }
    catch { throw new AuthConfigError('invalid', '認証設定の応答を読み取れませんでした。'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new AuthConfigError('invalid', '認証設定の形式が不正です。');
    }
    const result = value as Record<string, unknown>;
    if (result.enabled === false) return { enabled: false };
    const config = result.config;
    if (result.enabled !== true || !config || typeof config !== 'object' || Array.isArray(config)) {
      throw new AuthConfigError('invalid', '認証設定の形式が不正です。');
    }
    const fields = config as Record<string, unknown>;
    if (['apiKey', 'appId', 'authDomain', 'projectId'].some(key => typeof fields[key] !== 'string' || !(fields[key] as string).trim())) {
      throw new AuthConfigError('invalid', '認証設定に必要な情報がありません。');
    }
    return { enabled: true, config: {
      apiKey: fields.apiKey as string, appId: fields.appId as string,
      authDomain: fields.authDomain as string, projectId: fields.projectId as string,
    } };
  } catch (cause) {
    if (cause instanceof AuthConfigError) throw cause;
    if (controller.signal.aborted) throw new AuthConfigError('timeout', '認証サーバーの応答がありません。通信を確認して再試行してください。');
    throw new AuthConfigError('network', '認証サーバーに接続できません。通信を確認して再試行してください。');
  } finally {
    clearTimeout(timer);
  }
}
