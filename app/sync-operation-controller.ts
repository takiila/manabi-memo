export type SyncOperation = Readonly<{ id: number; accountId: string; fingerprint: string; signal: AbortSignal }>;
export class LocalEditDuringSync extends Error {}

/** Owns operation lifetime independently of React render timing. */
export class SyncOperationController {
  private sequence = 0;
  private active: SyncOperation | null = null;
  private abort: AbortController | null = null;
  private protectedLocal = false;

  begin(accountId: string, fingerprint: string): SyncOperation | null {
    if (this.active) return null;
    this.abort = new AbortController();
    this.protectedLocal = false;
    this.active = { id: ++this.sequence, accountId, fingerprint, signal: this.abort.signal };
    return this.active;
  }

  isCurrent(operation: SyncOperation, accountId: string | undefined) {
    return this.active === operation && operation.accountId === accountId;
  }

  canApply(operation: SyncOperation, accountId: string | undefined, fingerprint: string) {
    return this.isCurrent(operation, accountId) && operation.fingerprint === fingerprint;
  }

  protectLocal(operation: SyncOperation) {
    if (this.active === operation) this.protectedLocal = true;
  }

  observeLocalFingerprint(fingerprint: string) {
    if (this.protectedLocal && this.active && this.active.fingerprint !== fingerprint) {
      this.abort?.abort(new LocalEditDuringSync());
    }
  }

  finish(operation: SyncOperation) {
    if (this.active === operation) { this.active = null; this.abort = null; }
  }

  cancel() {
    this.abort?.abort();
    this.abort = null;
    this.active = null;
  }
}

export function shouldCheckRemote(input: { enabled: boolean; hydrated: boolean; visible: boolean; online: boolean; phase: string }) {
  return input.enabled && input.hydrated && input.visible && input.online
    && ['idle', 'synced', 'offline', 'error'].includes(input.phase);
}
