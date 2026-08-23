import assert from "node:assert/strict";
import test from "node:test";
import { matchesNotePdfVersion, notePdfVersion, pdfVersionsFromState } from "../app/pdf-sync-model.ts";

test("PDF version changes with the linked note update", () => {
  const first = notePdfVersion({ id: "s1", hasPdf: true, updatedAt: "2026-08-14T01:00:00.000Z", fileName: "a.pdf", pageCount: 2 });
  const second = notePdfVersion({ id: "s1", hasPdf: true, updatedAt: "2026-08-14T02:00:00.000Z", fileName: "a.pdf", pageCount: 2 });
  assert.notEqual(first, second);
});

test("a PDF upload is accepted only for the current linked note version", () => {
  const state = { sessions: [{ id: "s1", hasPdf: true, updatedAt: "v2", fileName: "a.pdf", pageCount: 2 }] };
  const versions = pdfVersionsFromState(state);
  assert.equal(matchesNotePdfVersion(state, "s1", versions.s1), true);
  assert.equal(matchesNotePdfVersion(state, "s1", "stale-version"), false);
  assert.equal(matchesNotePdfVersion(state, "missing", versions.s1), false);
});
