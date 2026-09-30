export type PdfVersionedSession = {
  id?: unknown;
  hasPdf?: unknown;
  updatedAt?: unknown;
  fileName?: unknown;
  pageCount?: unknown;
  pdfSyncMode?: unknown;
  pdfSha256?: unknown;
};

export type PdfSyncMode = 'cloud' | 'local-only';

/** Preserve original bytes across remote replacement, deletion and account changes. */
export async function archiveDevicePdfs<T extends { id: string; blob: Blob }>(entries: T[]): Promise<T[]> {
  const archives = new Map<string, T>();
  for (const entry of entries) {
    let id = entry.id;
    if (!id.startsWith('retained-pdf:')) {
      const digest = await crypto.subtle.digest('SHA-256', await entry.blob.arrayBuffer());
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      id = `retained-pdf:${entry.id}:${hash}`;
    }
    archives.set(id, { ...entry, id });
  }
  return [...archives.values()];
}

export function normalizePdfSyncFields(session: PdfVersionedSession): { pdfSyncMode: PdfSyncMode; pdfSha256: string } {
  return {
    pdfSyncMode: session.pdfSyncMode === 'local-only' ? 'local-only' : 'cloud',
    pdfSha256: typeof session.pdfSha256 === 'string' && /^[a-f0-9]{64}$/.test(session.pdfSha256) ? session.pdfSha256 : '',
  };
}

export async function retainDevicePdfs<T extends { id: string; blob: Blob }>(sessions: PdfVersionedSession[], entries: T[]): Promise<T[]> {
  const retained: T[] = [];
  for (const entry of entries) {
    const session = sessions.find(item => item.id === entry.id && item.hasPdf === true && item.pdfSyncMode === 'local-only');
    const expected = session && normalizePdfSyncFields(session).pdfSha256;
    if (!expected) continue;
    const digest = await crypto.subtle.digest('SHA-256', await entry.blob.arrayBuffer());
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash === expected) retained.push(entry);
  }
  return retained;
}

export function notePdfVersion(session: PdfVersionedSession) {
  if (typeof session.id !== "string" || session.hasPdf !== true || session.pdfSyncMode === 'local-only') return "";
  return [
    session.id,
    typeof session.updatedAt === "string" ? session.updatedAt : "",
    typeof session.fileName === "string" ? session.fileName : "",
    typeof session.pageCount === "number" ? String(session.pageCount) : "",
  ].join(":");
}

export function pdfVersionsFromState(state: unknown) {
  if (!state || typeof state !== "object" || !("sessions" in state) || !Array.isArray(state.sessions)) return {};
  return Object.fromEntries(state.sessions.flatMap((session) => {
    if (!session || typeof session !== "object") return [];
    const version = notePdfVersion(session as PdfVersionedSession);
    return version && typeof (session as PdfVersionedSession).id === "string"
      ? [[(session as PdfVersionedSession).id as string, version]]
      : [];
  }));
}

export function matchesNotePdfVersion(state: unknown, sessionId: string, suppliedVersion: string) {
  return pdfVersionsFromState(state)[sessionId] === suppliedVersion;
}
