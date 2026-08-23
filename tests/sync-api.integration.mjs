import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dataRoot = path.join(root, ".data", "sync-api-integration");
const databasePath = path.join(dataRoot, "sync.sqlite");
const objectPath = path.join(dataRoot, "objects");
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");

await rm(dataRoot, { recursive: true, force: true });
const port = await availablePort();
const origin = `http://127.0.0.1:${port}`;
const output = [];
const server = spawn(process.execPath, [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: root,
  env: {
    ...process.env,
    TRUST_CHATGPT_AUTH_HEADERS: "true",
    DATABASE_URL: `sqlite:${databasePath}`,
    LOCAL_FILE_STORE: objectPath,
    FIREBASE_API_KEY: "",
    FIREBASE_AUTH_DOMAIN: "",
    FIREBASE_PROJECT_ID: "",
    FIREBASE_APP_ID: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => output.push(String(chunk)));
server.stderr.on("data", (chunk) => output.push(String(chunk)));

try {
  await waitForServer(`${origin}/api/auth/config`, server, output);

  const owner = requestHeaders("owner@example.test");
  const other = requestHeaders("other@example.test");
  const account = await jsonRequest(`${origin}/api/account`, { headers: owner });
  assert.equal(account.response.status, 200);
  assert.equal(account.body.authenticated, true);

  const firstPdf = new TextEncoder().encode("%PDF-1.4\n% manabi sync integration v1\n%%EOF\n");
  const firstState = stateFor("v1");
  const firstManifest = manifestFor(firstState, firstPdf);
  const firstPrepare = await jsonRequest(`${origin}/api/sync/state`, {
    method: "POST",
    headers: owner,
    body: JSON.stringify(syncBody(0, firstState, firstManifest, "device-integration-1")),
  });
  assert.equal(firstPrepare.response.status, 200, JSON.stringify(firstPrepare.body));
  assert.equal(firstPrepare.body.revision, 1);
  assert.equal(typeof firstPrepare.body.transactionId, "string");

  const beforeCommit = await jsonRequest(`${origin}/api/sync/state`, { headers: owner });
  assert.equal(beforeCommit.body.exists, false);
  assert.equal(beforeCommit.body.pending, true);

  const foreignUpload = await uploadPdf(origin, other, firstPrepare.body.transactionId, firstPrepare.body.revision, firstManifest[0], firstPdf);
  assert.equal(foreignUpload.response.status, 404);

  const firstUpload = await uploadPdf(origin, owner, firstPrepare.body.transactionId, firstPrepare.body.revision, firstManifest[0], firstPdf);
  assert.equal(firstUpload.response.status, 200, JSON.stringify(firstUpload.body));
  const firstCommit = await jsonRequest(`${origin}/api/sync/state`, {
    method: "POST",
    headers: owner,
    body: JSON.stringify({ transactionId: firstPrepare.body.transactionId }),
  });
  assert.equal(firstCommit.response.status, 200, JSON.stringify(firstCommit.body));
  assert.equal(firstCommit.body.revision, 1);

  const firstCloud = await jsonRequest(`${origin}/api/sync/state`, { headers: owner });
  assert.equal(firstCloud.response.status, 200);
  assert.equal(firstCloud.body.exists, true);
  assert.equal(firstCloud.body.revision, 1);
  assert.equal(firstCloud.body.state.sessions[0].updatedAt, "v1");
  assert.equal(firstCloud.body.pdfs.length, 1);

  const downloaded = await fetch(`${origin}/api/sync/pdf?sessionId=session-1`, { headers: owner });
  assert.equal(downloaded.status, 200);
  assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), firstPdf);

  const stalePrepare = await jsonRequest(`${origin}/api/sync/state`, {
    method: "POST",
    headers: owner,
    body: JSON.stringify(syncBody(0, firstState, firstManifest, "device-integration-2")),
  });
  assert.equal(stalePrepare.response.status, 409);
  assert.equal(stalePrepare.body.conflict, true);

  const secondPdf = new TextEncoder().encode("%PDF-1.4\n% manabi sync integration v2\n%%EOF\n");
  const secondState = stateFor("v2");
  const secondManifest = manifestFor(secondState, secondPdf);
  const secondPrepare = await jsonRequest(`${origin}/api/sync/state`, {
    method: "POST",
    headers: owner,
    body: JSON.stringify(syncBody(1, secondState, secondManifest, "device-integration-2")),
  });
  assert.equal(secondPrepare.response.status, 200, JSON.stringify(secondPrepare.body));
  assert.equal(secondPrepare.body.revision, 2);

  const earlyCommit = await jsonRequest(`${origin}/api/sync/state`, {
    method: "POST",
    headers: owner,
    body: JSON.stringify({ transactionId: secondPrepare.body.transactionId }),
  });
  assert.equal(earlyCommit.response.status, 409);
  assert.equal(earlyCommit.body.incomplete, true);

  const cloudDuringPartialUpload = await jsonRequest(`${origin}/api/sync/state`, { headers: owner });
  assert.equal(cloudDuringPartialUpload.body.revision, 1);
  assert.equal(cloudDuringPartialUpload.body.state.sessions[0].updatedAt, "v1");

  const secondUpload = await uploadPdf(origin, owner, secondPrepare.body.transactionId, secondPrepare.body.revision, secondManifest[0], secondPdf);
  assert.equal(secondUpload.response.status, 200, JSON.stringify(secondUpload.body));
  const secondCommit = await jsonRequest(`${origin}/api/sync/state`, {
    method: "POST",
    headers: owner,
    body: JSON.stringify({ transactionId: secondPrepare.body.transactionId }),
  });
  assert.equal(secondCommit.response.status, 200, JSON.stringify(secondCommit.body));
  assert.equal(secondCommit.body.revision, 2);

  const secondCloud = await jsonRequest(`${origin}/api/sync/state`, { headers: owner });
  assert.equal(secondCloud.body.revision, 2);
  assert.equal(secondCloud.body.state.sessions[0].updatedAt, "v2");

  const isolatedAccount = await jsonRequest(`${origin}/api/sync/state`, { headers: other });
  assert.equal(isolatedAccount.body.exists, false);
  const isolatedPdf = await fetch(`${origin}/api/sync/pdf?sessionId=session-1`, { headers: other });
  assert.equal(isolatedPdf.status, 404);

  const removedPdf = await jsonRequest(`${origin}/api/sync/pdf?sessionId=session-1`, {
    method: "DELETE",
    headers: owner,
  });
  assert.equal(removedPdf.response.status, 200);
  const incompleteCloud = await jsonRequest(`${origin}/api/sync/state`, { headers: owner });
  assert.equal(incompleteCloud.body.incomplete, true);
  assert.equal(incompleteCloud.body.state, null);

  const deleted = await jsonRequest(`${origin}/api/sync/state`, { method: "DELETE", headers: owner });
  assert.equal(deleted.response.status, 200);
  const deletionMarker = await jsonRequest(`${origin}/api/sync/state`, { headers: owner });
  assert.equal(deletionMarker.body.deleted, true);

  process.stdout.write("sync API integration: prepare/upload/commit, partial failure, conflict, owner isolation, missing PDF, deletion passed\n");
} finally {
  server.kill();
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  await rm(dataRoot, { recursive: true, force: true });
}

function stateFor(updatedAt) {
  return {
    courses: [],
    sessions: [{ id: "session-1", courseId: "course-1", course: "Integration", hasPdf: true, updatedAt, fileName: "integration.pdf", pageCount: 1 }],
    memos: [],
  };
}

function versionFor(state) {
  const session = state.sessions[0];
  return [session.id, session.updatedAt, session.fileName, String(session.pageCount)].join(":");
}

function manifestFor(state, bytes) {
  return [{
    sessionId: state.sessions[0].id,
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    noteVersion: versionFor(state),
  }];
}

function syncBody(baseRevision, state, pdfs, deviceId) {
  return { baseRevision, schemaVersion: 8, state, deviceId, pdfIds: pdfs.map((item) => item.sessionId), pdfs };
}

function requestHeaders(email) {
  return {
    origin,
    "sec-fetch-site": "same-origin",
    "oai-authenticated-user-email": email,
    "content-type": "application/json",
  };
}

async function uploadPdf(baseUrl, headers, transactionId, revision, manifest, bytes) {
  return jsonRequest(`${baseUrl}/api/sync/pdf?sessionId=${encodeURIComponent(manifest.sessionId)}&transactionId=${encodeURIComponent(transactionId)}`, {
    method: "PUT",
    headers: {
      ...headers,
      "content-type": "application/pdf",
      "x-content-sha256": manifest.sha256,
      "x-state-revision": String(revision),
      "x-note-version": encodeURIComponent(manifest.noteVersion),
    },
    body: bytes,
  });
}

async function jsonRequest(url, init) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function waitForServer(url, child, logs) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next server exited early.\n${logs.join("")}`);
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      // Server has not started listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for Next server.\n${logs.join("")}`);
}

async function availablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => probe.once("error", reject).listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => probe.close(resolve));
  if (!port) throw new Error("Could not allocate an integration-test port.");
  return port;
}
