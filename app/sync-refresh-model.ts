export function mayRefreshSync(input: { enabled: boolean; hydrated: boolean; localReady: boolean; visible: boolean; online: boolean; phase: string; busy: boolean }) {
  return input.enabled && input.hydrated && input.localReady && input.visible && input.online && !input.busy && (input.phase === 'synced' || input.phase === 'offline');
}

export function sameSyncSnapshot(before: { fingerprint: string; accountId: string }, current: { fingerprint: string; accountId: string }) {
  return before.fingerprint === current.fingerprint && before.accountId === current.accountId;
}

/** Invalidates requests and pending IndexedDB transactions when identity changes. */
export class SyncOperationScope {
  private controller = new AbortController();
  invalidate() { this.controller.abort(); this.controller = new AbortController(); }
  capture() {
    const signal = this.controller.signal;
    return { signal, assertCurrent: () => { if (signal.aborted) throw new Error('アカウント変更または同期停止により操作を中止しました。'); } };
  }
}
