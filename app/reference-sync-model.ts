type PdfSession = {
  id?: string;
  hasPdf?: boolean;
  fileName?: string;
  pageCount?: number;
  pageTexts?: string[];
  topics?: unknown[];
  needsOcr?: boolean;
  pdfWarnings?: string[];
  pdfReferenceOnly?: boolean;
  pdfReferenceSha256?: string;
  pdfReleasedAt?: string | null;
};

export function canApplyReferenceRestore(expectedRevision: number, currentRevision: number, expectedFingerprint: string, currentFingerprint: string) {
  return expectedRevision === currentRevision && expectedFingerprint === currentFingerprint;
}

export function referencesForSync<Container extends object>(state: Container, hashes: Record<string, string> = {}): Container {
  if (!("sessions" in state) || !Array.isArray(state.sessions)) return state;
  return {
    ...state,
    sessions: state.sessions.map((session: PdfSession) => ({
      ...session,
      hasPdf: false,
      pageTexts: [],
      topics: [],
      needsOcr: false,
      pdfWarnings: [],
      pdfReferenceOnly: Boolean((session.hasPdf || session.pdfReferenceOnly) && session.fileName && (session.pageCount ?? 0) > 0),
      pdfReferenceSha256: session.hasPdf ? hashes[session.id ?? ""] ?? "" : session.pdfReferenceSha256 ?? "",
      pdfReleasedAt: null,
    })),
  };
}

export function referenceSyncFingerprint(state: unknown) {
  const projected = state && typeof state === "object" ? referencesForSync(state) : state;
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]));
  };
  const text = JSON.stringify(canonical(projected));
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return `${text.length}-${(hash >>> 0).toString(36)}`;
}

export function retainLocalPdf<Session extends PdfSession>(remote: Session, local: Session | undefined, sha256: string): Session {
  if (!remote.pdfReferenceOnly || (local && remote.id !== local.id)) return remote;
  const matches = remote.pdfReferenceSha256
    ? remote.pdfReferenceSha256 === sha256
    : local?.hasPdf && remote.fileName === local.fileName && remote.pageCount === local.pageCount;
  if (!matches) return remote;
  return { ...remote, hasPdf: true, pageTexts: local?.hasPdf ? local.pageTexts : [], topics: local?.hasPdf ? local.topics : [], needsOcr: local?.hasPdf ? local.needsOcr : false, pdfWarnings: local?.hasPdf ? local.pdfWarnings : [], pdfReferenceOnly: false, pdfReferenceSha256: "", pdfReleasedAt: null };
}
