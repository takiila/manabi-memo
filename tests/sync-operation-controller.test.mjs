import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalEditDuringSync, SyncOperationController, shouldCheckRemote } from '../app/sync-operation-controller.ts';

test('editing aborts a protected download but leaves an upload snapshot running', () => {
  const controller = new SyncOperationController();
  const upload = controller.begin('a', 'old');
  controller.observeLocalFingerprint('new');
  assert.equal(upload.signal.aborted, false);
  controller.finish(upload);
  const download = controller.begin('a', 'old');
  controller.protectLocal(download);
  controller.observeLocalFingerprint('new');
  assert.equal(download.signal.aborted, true);
  assert.ok(download.signal.reason instanceof LocalEditDuringSync);
});

test('one controller serializes automatic, focus and button sync requests', () => {
  const controller = new SyncOperationController();
  const token = controller.begin('account-a', 'original');
  assert.ok(token);
  assert.equal(controller.begin('account-a', 'original'), null);
  controller.finish(token);
  assert.ok(controller.begin('account-a', 'edited'));
});

test('stop or account switch invalidates late results without unlocking a newer operation', () => {
  const controller = new SyncOperationController();
  const old = controller.begin('account-a', 'original');
  controller.cancel();
  assert.equal(old.signal.aborted, true);
  const current = controller.begin('account-b', 'new');
  assert.equal(controller.isCurrent(old, 'account-a'), false);
  controller.finish(old);
  assert.equal(controller.begin('account-b', 'new'), null);
  assert.equal(controller.isCurrent(current, 'account-b'), true);
  assert.equal(controller.isCurrent(current, 'account-a'), false);
});

test('download may only apply while the same account and captured local content remain current', () => {
  const controller = new SyncOperationController();
  const token = controller.begin('account-a', 'original');
  assert.equal(controller.canApply(token, 'account-a', 'original'), true);
  assert.equal(controller.canApply(token, 'account-a', 'edited-during-download'), false);
  assert.equal(controller.canApply(token, 'account-b', 'original'), false);
  controller.cancel();
  assert.equal(controller.canApply(token, 'account-a', 'original'), false);
});

test('background refresh requires a ready device and never dismisses a user decision', () => {
  const input = { enabled: true, hydrated: true, visible: true, online: true, phase: 'synced' };
  assert.equal(shouldCheckRemote(input), true);
  for (const phase of ['choice', 'conflict', 'account-mismatch', 'checking', 'syncing']) {
    assert.equal(shouldCheckRemote({...input, phase}), false);
  }
  for (const key of ['enabled', 'hydrated', 'visible', 'online']) {
    assert.equal(shouldCheckRemote({...input, [key]: false}), false);
  }
  assert.equal(shouldCheckRemote({...input, phase: 'offline'}), true);
});
