import assert from 'node:assert/strict';
import test from 'node:test';
import { mayRefreshSync, sameSyncSnapshot } from '../app/sync-refresh-model.ts';
test('保存済み・表示中・同期ONの安全な状態のみ定期確認する', () => {
  const ready = { enabled: true, hydrated: true, localReady: true, visible: true, online: true, phase: 'synced', busy: false };
  assert.equal(mayRefreshSync(ready), true);
  for (const key of ['enabled', 'hydrated', 'localReady', 'visible', 'online']) assert.equal(mayRefreshSync({ ...ready, [key]: false }), false);
  for (const phase of ['checking', 'syncing', 'conflict', 'choice', 'account-mismatch', 'error']) assert.equal(mayRefreshSync({ ...ready, phase }), false);
  assert.equal(mayRefreshSync({ ...ready, busy: true }), false);
});
test('クラウド取得待ちに本文やアカウントが変わったら反映しない', () => {
  const original = { fingerprint: 'old', accountId: 'owner' };
  assert.equal(sameSyncSnapshot(original, original), true);
  assert.equal(sameSyncSnapshot(original, { ...original, fingerprint: 'edited' }), false);
  assert.equal(sameSyncSnapshot(original, { ...original, accountId: 'other' }), false);
});
test('アカウント切替は待機中の操作と保存を中止する', async () => {
  const { SyncOperationScope } = await import('../app/sync-refresh-model.ts');
  const scope = new SyncOperationScope();
  const first = scope.capture();
  scope.invalidate();
  assert.equal(first.signal.aborted, true);
  assert.throws(first.assertCurrent, /中止/);
  assert.doesNotThrow(scope.capture().assertCurrent);
});
