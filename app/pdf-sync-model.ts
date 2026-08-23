export type PdfVersionedSession = {
  id?: unknown;
  hasPdf?: unknown;
  updatedAt?: unknown;
  fileName?: unknown;
  pageCount?: unknown;
};

export function notePdfVersion(session: PdfVersionedSession) {
  if (typeof session.id !== "string" || session.hasPdf !== true) return "";
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
