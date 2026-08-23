import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const enabled = process.env.SYNC_LIVE_TEST === "true";

if (!enabled) {
  console.log("SKIP live provider integration: set SYNC_LIVE_TEST=true with PostgreSQL and S3 credentials to opt in.");
  process.exit(0);
}

const required = ["DATABASE_URL", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  console.error(`live provider integration requires: ${missing.join(", ")}`);
  process.exit(1);
}
if (!/^postgres(?:ql)?:\/\//i.test(process.env.DATABASE_URL.trim())) {
  console.error("live provider integration requires DATABASE_URL to be a PostgreSQL URL.");
  process.exit(1);
}

const port = await availablePort();
const origin = `http://127.0.0.1:${port}`;
const runId = randomUUID();
const email = `manabi-sync-live-${runId}@example.invalid`;
const owner = requestHeaders(email);
const foreign = requestHeaders(`manabi-sync-live-foreign-${runId}@example.invalid`);
const output = [];
const server = spawn(process.execPath, [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: root,
  env: {
    ...process.env,
    TRUST_CHATGPT_AUTH_HEADERS: "true",
    // These values are read only from the caller environment; no credential
    // or endpoint is stored in this test.
    DATABASE_URL: process.env.DATABASE_URL,
    S3_BUCKET: process.env.S3_BUCKET,
    S3_REGION: process.env.S3_REGION,
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE,
    DATABASE_SSL: process.env.DATABASE_SSL,
    DATABASE_POOL_SIZE: process.env.DATABASE_POOL_SIZE,
    FIREBASE_API_KEY: "",
    FIREBASE_AUTH_DOMAIN: "",
    FIREBASE_PROJECT_ID: "",
    FIREBASE_APP_ID: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => output.push(String(chunk)));
server.stderr.on("data", (chunk) => output.push(String(chunk)));

let cleanupDone = false;
try {
  await waitForServer(`${origin}/api/auth/config`, server, output);
  const account = await jsonRequest(`${origin}/api/account`, { headers: owner });
  assert.equal(account.response.status, 200, JSON.stringify(account.body));
  assert.equal(account.body.authenticated, true);

  const firstPdf = bytes("live provider v1");
  const firstState = stateFor("v1");
  const firstManifest = manifestFor(firstState, firstPdf);
  const firstPrepare = await prepare(owner, 0, firstState, firstManifest, "live-device-1");
  assert.equal(firstPrepare.response.status, 200, JSON.stringify(firstPrepare.body));
  assert.equal(firstPrepare.body.revision, 1);

  const foreignUpload = await uploadPdf(foreign, firstPrepare.body.transactionId, firstPrepare.body.revision, firstManifest[0], firstPdf);
  assert.equal(foreignUpload.response.status, 404);
  const firstUpload = await uploadPdf(owner, firstPrepare.body.transactionId, firstPrepare.body.revision, firstManifest[0], firstPdf);
  assert.equal(firstUpload.response.status, 200, JSON.stringify(firstUpload.body));
  const firstCommit = await commit(owner, firstPrepare.body.transactionId);
  assert.equal(firstCommit.response.status, 200, JSON.stringify(firstCommit.body));
  assert.equal(firstCommit.body.revision, 1);
  await assertCloud(owner, "v1", firstPdf, 1);

  // A second terminal cannot commit from the stale base revision.
  const stale = await prepare(owner, 0, firstState, firstManifest, "live-device-2");
  assert.equal(stale.response.status, 409, JSON.stringify(stale.body));
  assert.equal(stale.body.conflict, true);

  const secondPdf = bytes("live provider v2");
  const secondState = stateFor("v2");
  const secondManifest = manifestFor(secondState, secondPdf);
  const secondPrepare = await prepare(owner, 1, secondState, secondManifest, "live-device-2");
  assert.equal(secondPrepare.response.status, 200, JSON.stringify(secondPrepare.body));
  assert.equal(secondPrepare.body.revision, 2);

  // A partial provider failure leaves the previous committed state readable.
  const badUpload = await uploadPdf(owner, secondPrepare.body.transactionId, secondPrepare.body.revision, secondManifest[0], bytes("wrong bytes"), secondManifest[0].sha256);
  // The request is rejected before staging because its declared SHA-256 does
  // not match the bytes; the transaction itself remains pending.
  assert.equal(badUpload.response.status, 400);
  const earlyCommit = await commit(owner, secondPrepare.body.transactionId);
  assert.equal(earlyCommit.response.status, 409);
  assert.equal(earlyCommit.body.incomplete, true);
  await assertCloud(owner, "v1", firstPdf, 1);

  // Re-uploading the correct object resumes the same transaction.
  const secondUpload = await uploadPdf(owner, secondPrepare.body.transactionId, secondPrepare.body.revision, secondManifest[0], secondPdf);
  assert.equal(secondUpload.response.status, 200, JSON.stringify(secondUpload.body));
  const secondCommit = await commit(owner, secondPrepare.body.transactionId);
  assert.equal(secondCommit.response.status, 200, JSON.stringify(secondCommit.body));
  assert.equal(secondCommit.body.revision, 2);
  await assertCloud(owner, "v2", secondPdf, 2);

  const isolated = await jsonRequest(`${origin}/api/sync/state`, { headers: foreign });
  assert.equal(isolated.response.status, 200);
  assert.equal(isolated.body.exists, false);
  const isolatedPdf = await fetch(`${origin}/api/sync/pdf?sessionId=session-1`, { headers: foreign });
  assert.equal(isolatedPdf.status, 404);

  const deleted = await jsonRequest(`${origin}/api/sync/state`, { method: "DELETE", headers: owner });
  assert.equal(deleted.response.status, 200, JSON.stringify(deleted.body));
  cleanupDone = true;
  const deletionMarker = await jsonRequest(`${origin}/api/sync/state`, { headers: owner });
  assert.equal(deletionMarker.response.status, 200);
  assert.equal(deletionMarker.body.deleted, true);
  console.log("live provider integration: PostgreSQL/S3 prepare/upload/commit, two devices, partial resume, isolation, PDF bytes, deletion passed");
} finally {
  if (!cleanupDone && server.exitCode === null) {
    try { await jsonRequest(`${origin}/api/sync/state`, { method: "DELETE", headers: owner }); } catch { /* preserve the test failure */ }
  }
  server.kill();
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
}

function stateFor(updatedAt) {
  return {
    courses: [],
    sessions: [{ id: "session-1", courseId: "course-1", course: "Live provider", hasPdf: true, updatedAt, fileName: "live.pdf", pageCount: 1 }],
    memos: [],
  };
}

function versionFor(state) {
  const session = state.sessions[0];
  return [session.id, session.updatedAt, session.fileName, String(session.pageCount)].join(":");
}

function manifestFor(state, value) {
  return [{
    sessionId: state.sessions[0].id,
    size: value.byteLength,
    sha256: createHash("sha256").update(value).digest("hex"),
    noteVersion: versionFor(state),
  }];
}

function bytes(value) { return new TextEncoder().encode(`%PDF-1.4\n% ${value}\n%%EOF\n`); }

async function prepare(headers, baseRevision, state, pdfs, deviceId) {
  return jsonRequest(`${origin}/api/sync/state`, {
    method: "POST",
    headers,
    body: JSON.stringify({ baseRevision, schemaVersion: 8, state, deviceId, pdfIds: pdfs.map((item) => item.sessionId), pdfs }),
  });
}

async function uploadPdf(headers, transactionId, revision, manifest, value, declaredHash = manifest.sha256) {
  return jsonRequest(`${origin}/api/sync/pdf?sessionId=${encodeURIComponent(manifest.sessionId)}&transactionId=${encodeURIComponent(transactionId)}`, {
    method: "PUT",
    headers: {
      ...headers,
      "content-type": "application/pdf",
      "x-content-sha256": declaredHash,
      "x-state-revision": String(revision),
      "x-note-version": encodeURIComponent(manifest.noteVersion),
    },
    body: value,
  });
}

async function commit(headers, transactionId) {
  return jsonRequest(`${origin}/api/sync/state`, { method: "POST", headers, body: JSON.stringify({ transactionId }) });
}

async function assertCloud(headers, updatedAt, expectedPdf, revision) {
  const cloud = await jsonRequest(`${origin}/api/sync/state`, { headers });
  assert.equal(cloud.response.status, 200, JSON.stringify(cloud.body));
  assert.equal(cloud.body.exists, true);
  assert.equal(cloud.body.revision, revision);
  assert.equal(cloud.body.state.sessions[0].updatedAt, updatedAt);
  assert.equal(cloud.body.pdfs.length, 1);
  const pdf = await fetch(`${origin}/api/sync/pdf?sessionId=session-1`, { headers });
  assert.equal(pdf.status, 200);
  assert.deepEqual(new Uint8Array(await pdf.arrayBuffer()), expectedPdf);
}

function requestHeaders(email) {
  return {
    origin,
    "sec-fetch-site": "same-origin",
    "oai-authenticated-user-email": email,
    "content-type": "application/json",
  };
}

async function jsonRequest(url, init) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function waitForServer(url, child, logs) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next server exited early.\n${logs.join("")}`);
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      // Server has not started listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for Next server.\n${logs.join("")}`);
}

async function availablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => probe.once("error", reject).listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => probe.close(resolve));
  if (!port) throw new Error("Could not allocate a live provider integration-test port.");
  return port;
}
