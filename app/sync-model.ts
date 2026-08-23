export type LocalSyncMeta = {
  accountId: string;
  enabled: boolean;
  revision: number;
  fingerprint: string;
  pdfHashes: Record<string, string>;
  pdfTokens: Record<string, string>;
};

export type SyncPlan = "upload" | "download" | "choice" | "synced" | "conflict" | "account-mismatch";

export function decideSyncPlan(input: {
  localHasData: boolean;
  cloudExists: boolean;
  localFingerprint: string;
  cloudFingerprint: string;
  cloudRevision: number;
  meta: LocalSyncMeta | null;
  accountId?: string;
}): SyncPlan {
  if (input.meta && input.accountId && input.meta.accountId !== input.accountId) return "account-mismatch";
  if (!input.cloudExists) return "upload";
  if (!input.localHasData) return "download";
  if (input.localFingerprint === input.cloudFingerprint) return "synced";
  if (!input.meta || !input.meta.enabled) return "choice";
  if (input.cloudRevision === input.meta.revision) {
    return input.localFingerprint === input.meta.fingerprint ? "synced" : "upload";
  }
  if (input.cloudRevision > input.meta.revision) {
    return input.localFingerprint === input.meta.fingerprint ? "download" : "conflict";
  }
  return "conflict";
}

export function fingerprintState(value: unknown) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  }
  return `${text.length}-${(hash >>> 0).toString(36)}`;
}
