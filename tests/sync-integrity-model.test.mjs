import assert from "node:assert/strict";
import test from "node:test";
import {
  expectedPdfIds,
  isCommittedPdfMetadata,
  normalizePdfManifest,
  validatePdfManifest,
} from "../app/sync-integrity-model.ts";

const hash = "a".repeat(64);
const state = {
  courses: [],
  sessions: [{ id: "session-1", hasPdf: true, updatedAt: "v2", fileName: "lecture.pdf", pageCount: 2 }],
  memos: [],
};
const version = "session-1:v2:lecture.pdf:2";
const manifest = [{ sessionId: "session-1", size: 3, sha256: hash, noteVersion: version }];

test("PDF manifest must cover every PDF referenced by the state", () => {
  assert.deepEqual(expectedPdfIds(state), ["session-1"]);
  assert.equal(validatePdfManifest(state, [], ["session-1"]).ok, false);
  assert.equal(validatePdfManifest(state, manifest, ["session-1"]).ok, true);
});

test("a stale note version cannot be used to prepare a transaction", () => {
  assert.equal(validatePdfManifest(state, [{ ...manifest[0], noteVersion: "stale" }], ["session-1"]).ok, false);
});

test("invalid or duplicate SHA-256 metadata is rejected", () => {
  assert.equal(normalizePdfManifest([{ ...manifest[0], sha256: "not-a-hash" }]), null);
  assert.equal(normalizePdfManifest([manifest[0], manifest[0]]), null);
});

test("committed PDF metadata must match revision, note version, and hash shape", () => {
  const valid = [{ sessionId: "session-1", size: 3, sha256: hash, stateRevision: 4, noteVersion: version }];
  assert.equal(isCommittedPdfMetadata(state, 4, valid), true);
  assert.equal(isCommittedPdfMetadata(state, 3, valid), false);
  assert.equal(isCommittedPdfMetadata(state, 4, [{ ...valid[0], noteVersion: "stale" }]), false);
  // The server separately hashes object bytes; this model checks the metadata shape.
  assert.equal(isCommittedPdfMetadata(state, 4, [{ ...valid[0], sha256: "b".repeat(64) }]), true);
  assert.equal(isCommittedPdfMetadata(state, 4, [{ ...valid[0], sha256: "bad" }]), false);
});

test("a state without PDFs has an empty committed set", () => {
  assert.equal(isCommittedPdfMetadata({ courses: [], sessions: [], memos: [] }, 1, []), true);
  assert.equal(isCommittedPdfMetadata({ courses: [], sessions: [], memos: [] }, 1, [{ sessionId: "orphan", size: 1, sha256: hash, stateRevision: 1, noteVersion: "orphan" }]), false);
});
