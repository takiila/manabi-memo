import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { referencesForSync } from "../app/reference-sync-model.ts";

const probe = createServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const directory = await mkdtemp(path.join(tmpdir(), "manabi-reference-test-"));
const origin = `http://127.0.0.1:${port}`;
const logs = [];
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  env: { ...process.env, DATABASE_URL: path.join(directory, "test.sqlite"), LOCAL_FILE_STORE: path.join(directory, "objects"), SYNC_PDF_MODE: "references", TRUST_CHATGPT_AUTH_HEADERS: "true", ALLOWED_ACCOUNT_EMAILS: "owner@example.test,other@example.test", BLOB_READ_WRITE_TOKEN: "", BLOB_STORE_ID: "", S3_BUCKET: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => logs.push(String(chunk)));
server.stderr.on("data", (chunk) => logs.push(String(chunk)));
const headers = { origin, "sec-fetch-site": "same-origin", "content-type": "application/json", "oai-authenticated-user-email": "owner@example.test" };

async function request(url, init = {}) {
  const response = await fetch(origin + url, init);
  return { status: response.status, body: await response.json() };
}

try {
  const deadline = Date.now() + 25_000;
  while (true) {
    try { if ((await fetch(origin + "/api/auth/config")).status === 200) break; } catch {}
    if (Date.now() > deadline || server.exitCode !== null) throw new Error(logs.join(""));
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const local = { courses: [], sessions: [{ id: "lecture-1", hasPdf: true, fileName: "lecture.pdf", pageCount: 10, lastPdfPage: 7, pageTexts: ["not uploaded"], topics: [{ title: "not uploaded" }], noteText: "lecture note" }], memos: [{ id: "memo-1", sessionId: "lecture-1", page: 7, text: "page seven memo" }] };
  const cloud = referencesForSync(local, { "lecture-1": "a".repeat(64) });
  const body = (state, baseRevision = 0, deviceId = "desktop") => JSON.stringify({ baseRevision, schemaVersion: 13, state, pdfIds: [], pdfs: [], deviceId: `test-device-${deviceId}` });
  assert.equal((await request("/api/sync/state", { method: "POST", headers, body: body(local) })).status, 400);
  assert.equal((await request("/api/sync/pdf?sessionId=lecture-1", { method: "PUT", headers, body: "PDF" })).status, 403);
  assert.equal((await request("/api/sync/pdf/transfer", { method: "POST", headers, body: "{}" })).status, 403);
  const prepared = await request("/api/sync/state", { method: "POST", headers, body: body(cloud) });
  assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
  assert.equal((await request("/api/sync/state", { method: "POST", headers, body: JSON.stringify({ transactionId: prepared.body.transactionId }) })).status, 200);
  for (const device of ["phone", "laptop"]) {
    const downloaded = await request("/api/sync/state", { headers });
    assert.equal(downloaded.status, 200);
    assert.equal(downloaded.body.state.memos[0].page, 7);
    assert.equal(downloaded.body.state.memos[0].text, "page seven memo");
    assert.deepEqual(downloaded.body.state.sessions[0].pageTexts, []);
    assert.deepEqual(downloaded.body.pdfs, []);
    assert.equal((await request("/api/sync/state", { method: "POST", headers, body: body(cloud, 0, device) })).status, 409);
  }
  assert.equal((await request("/api/sync/state", { headers: { ...headers, "oai-authenticated-user-email": "other@example.test" } })).body.exists, false);
  assert.equal(local.sessions[0].hasPdf, true);
  console.log("Reference-only API: no PDF transfers, page-seven memo shared, revision conflicts and account isolation verified.");
} finally {
  const exited = new Promise((resolve) => server.once("exit", resolve));
  server.kill();
  await exited;
  await rm(directory, { recursive: true, force: true });
}
