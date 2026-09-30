import assert from 'node:assert/strict';
import test from 'node:test';
import { archiveDevicePdfs, pdfVersionsFromState, retainDevicePdfs, normalizePdfSyncFields } from '../app/pdf-sync-model.ts';
import { createHash } from 'node:crypto';
import { createBackupFile, inspectBackupFile } from '../app/backup.ts';

const blob = new Blob(['%PDF-test'], {type:'application/pdf'});
const hash = createHash('sha256').update('%PDF-test').digest('hex');
const session = {id:'s1',hasPdf:true,pdfSyncMode:'local-only',pdfSha256:hash,fileName:'lecture.pdf',pageCount:3};

test('remote PDF replacement archives original bytes without presenting them as the new PDF', async () => {
  const entries = [{id:'s1',blob}];
  const archives = await archiveDevicePdfs(entries);
  assert.equal(archives[0].id, `retained-pdf:s1:${hash}`);
  assert.equal(await archives[0].blob.text(), await blob.text());
  assert.deepEqual(await retainDevicePdfs([{...session,pdfSha256:'f'.repeat(64)}], entries), []);
  assert.deepEqual(await archiveDevicePdfs([...entries,...archives]), archives);
});

test('device-only PDF metadata and notes travel without a cloud PDF version', () => {
  assert.deepEqual(pdfVersionsFromState({sessions:[session]}), {});
  assert.equal(Object.keys(pdfVersionsFromState({sessions:[{...session,pdfSyncMode:'cloud'}]})).length, 1);
  assert.equal(normalizePdfSyncFields({}).pdfSyncMode, 'cloud');
});

test('cloud restore keeps only matching device-only PDFs and works on an empty phone', async () => {
  assert.deepEqual(await retainDevicePdfs([session], []), []);
  const entries = [{id:'s1',blob},{id:'unrelated',blob}];
  assert.deepEqual(await retainDevicePdfs([session], entries), [entries[0]]);
  assert.deepEqual(await retainDevicePdfs([{...session,pdfSha256:'f'.repeat(64)}], entries), []);
  assert.deepEqual(await retainDevicePdfs([{...session,pdfSyncMode:'cloud'}], entries), []);
});

test('phone backup preserves a device-only PDF reference without its bytes', async () => {
  const state = {sessions:[session], campus:{assignments:[{id:'a1',dueISO:'2026-10-05T09:00',status:'done'}]}};
  const backup = await createBackupFile(state, []);
  const restored = await inspectBackupFile(new File([backup], 'phone.manabimemo'));
  assert.deepEqual(restored.manifest.state, state);
  assert.deepEqual(restored.pdfs, []);
});
