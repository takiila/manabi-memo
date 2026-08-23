export type PdfSyncManifest = {
  sessionId: string;
  size: number;
  sha256: string;
  noteVersion: string;
};

export type PdfSyncMetadata = PdfSyncManifest & {
  stateRevision: number;
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

/**
 * Returns the exact PDF set implied by a state payload. A PDF cannot be
 * considered optional when its session says hasPdf=true: the state and the
 * object store are committed as one logical snapshot.
 */
export function expectedPdfVersions(state: unknown) {
  if (!state || typeof state !== "object" || !("sessions" in state) || !Array.isArray(state.sessions)) return {};
  return Object.fromEntries(state.sessions.flatMap((session) => {
    if (!session || typeof session !== "object") return [];
    const value = session as Record<string, unknown>;
    if (typeof value.id !== "string" || value.hasPdf !== true) return [];
    const version = [
      value.id,
      typeof value.updatedAt === "string" ? value.updatedAt : "",
      typeof value.fileName === "string" ? value.fileName : "",
      typeof value.pageCount === "number" ? String(value.pageCount) : "",
    ].join(":");
    return [[value.id, version]];
  }));
}

export function expectedPdfIds(state: unknown) {
  return Object.keys(expectedPdfVersions(state)).sort();
}

export function normalizePdfManifest(value: unknown): PdfSyncManifest[] | null {
  if (!Array.isArray(value) || value.length > 1000) return null;
  const ids = new Set<string>();
  const output: PdfSyncManifest[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const candidate = item as Record<string, unknown>;
    const sessionId = typeof candidate.sessionId === "string" && /^[a-zA-Z0-9._:-]{1,180}$/.test(candidate.sessionId)
      ? candidate.sessionId
      : "";
    const size = typeof candidate.size === "number" && Number.isSafeInteger(candidate.size) && candidate.size > 0 && candidate.size <= 75 * 1024 * 1024
      ? candidate.size
      : null;
    const sha256 = typeof candidate.sha256 === "string" && SHA256_PATTERN.test(candidate.sha256) ? candidate.sha256 : "";
    const noteVersion = typeof candidate.noteVersion === "string" && candidate.noteVersion.length > 0 && candidate.noteVersion.length <= 800
      ? candidate.noteVersion
      : "";
    if (!sessionId || size === null || !sha256 || !noteVersion || ids.has(sessionId)) return null;
    ids.add(sessionId);
    output.push({ sessionId, size, sha256, noteVersion });
  }
  return output.sort((left, right) => left.sessionId.localeCompare(right.sessionId));
}

/**
 * Validates that a transaction manifest is neither missing nor adding a PDF
 * that the state does not reference. This is deliberately strict so a
 * missing local IndexedDB blob fails before the state can be published.
 */
export function validatePdfManifest(state: unknown, value: unknown, declaredIds?: unknown) {
  const manifest = normalizePdfManifest(value);
  const expected = expectedPdfVersions(state);
  const ids = normalizeIds(declaredIds) ?? Object.keys(expected).sort();
  if (!manifest || !sameStringSet(ids, Object.keys(expected))) return { ok: false as const, reason: "pdf-set" };
  if (manifest.length !== ids.length) return { ok: false as const, reason: "pdf-count" };
  for (const item of manifest) {
    if (expected[item.sessionId] !== item.noteVersion) return { ok: false as const, reason: "pdf-version" };
  }
  return { ok: true as const, manifest, expected };
}

/**
 * Checks the DB metadata side of a committed snapshot. Object bytes are
 * checked by the server route as well; this function keeps the revision,
 * note-version and set checks reusable in browser-safe tests.
 */
export function isCommittedPdfMetadata(state: unknown, revision: number, rows: PdfSyncMetadata[]) {
  const expected = expectedPdfVersions(state);
  if (rows.length !== Object.keys(expected).length) return false;
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.sessionId) || expected[row.sessionId] !== row.noteVersion || row.stateRevision !== revision || row.size <= 0 || !SHA256_PATTERN.test(row.sha256)) return false;
    seen.add(row.sessionId);
  }
  return seen.size === Object.keys(expected).length;
}

function normalizeIds(value: unknown) {
  if (!Array.isArray(value) || value.length > 1000) return null;
  const ids = value.filter((item): item is string => typeof item === "string" && /^[a-zA-Z0-9._:-]{1,180}$/.test(item));
  return ids.length === value.length && new Set(ids).size === ids.length ? ids.sort() : null;
}

function sameStringSet(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
