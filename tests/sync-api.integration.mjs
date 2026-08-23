import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
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
    CAMPUS_ACCESS_MODE: "authenticated",
    ALLOWED_ACCOUNT_EMAILS: "owner@example.test,other@example.test,third@example.test",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => output.push(String(chunk)));
server.stderr.on("data", (chunk) => output.push(String(chunk)));

try {
  await waitForServer(`${origin}/api/auth/config`, server, output);

  const owner = requestHeaders("owner@example.test");
  const other = requestHeaders("other@example.test");
  const third = requestHeaders("third@example.test");
  const outsider = requestHeaders("outsider@example.test");
  const account = await jsonRequest(`${origin}/api/account`, { headers: owner });
  assert.equal(account.response.status, 200);
  assert.equal(account.body.authenticated, true);
  assert.equal(account.body.campusBeta, true);
  assert.equal(account.body.campusAccess, "authenticated");
  for (const headers of [other, third]) {
    const result = await jsonRequest(`${origin}/api/account`, { headers });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.campusBeta, true);
  }
  const blockedAccount = await jsonRequest(`${origin}/api/account`, { headers: outsider });
  assert.equal(blockedAccount.response.status, 403);
  const blockedSync = await jsonRequest(`${origin}/api/sync/state`, { headers: outsider });
  assert.equal(blockedSync.response.status, 403);
  const health = await jsonRequest(`${origin}/api/health`);
  assert.equal(health.body.pdfStorage, "local-files");
  assert.equal(health.body.directPdfTransfer, false);
  assert.equal(health.body.campusAccess, "authenticated");

  const blockedSharedCalendar = await jsonRequest(`${origin}/api/shared-calendar`, { headers: outsider });
  assert.equal(blockedSharedCalendar.response.status, 403);

  const createdSharedCalendar = await jsonRequest(`${origin}/api/shared-calendar`, {
    method: "POST",
    headers: owner,
    body: JSON.stringify({
      action: "create",
      kind: "assignment",
      termLabel: "2026年度 前期",
      courseLabel: "統計学",
      title: "共有レポート",
      dueAt: "2026-09-10T17:00",
      note: "提出方法を全員で確認",
    }),
  });
  assert.equal(createdSharedCalendar.response.status, 201, JSON.stringify(createdSharedCalendar.body));
  assert.equal(createdSharedCalendar.body.members.length, 3);
  const sharedEvent = createdSharedCalendar.body.events.find((event) => event.title === "共有レポート");
  assert.equal(typeof sharedEvent.id, "string");

  const ownerCompletion = await jsonRequest(`${origin}/api/shared-calendar`, {
    method: "POST",
    headers: owner,
    body: JSON.stringify({ action: "set-completion", eventId: sharedEvent.id, completed: true, memberEmail: "third@example.test" }),
  });
  assert.deepEqual(ownerCompletion.body.events[0].completions.map((item) => item.email), ["owner@example.test"]);
  const otherCompletion = await jsonRequest(`${origin}/api/shared-calendar`, {
    method: "POST",
    headers: other,
    body: JSON.stringify({ action: "set-completion", eventId: sharedEvent.id, completed: true }),
  });
  assert.equal(otherCompletion.response.status, 200);

  const sharedOnThirdDevice = await jsonRequest(`${origin}/api/shared-calendar`, { headers: third });
  assert.equal(sharedOnThirdDevice.response.status, 200);
  assert.deepEqual(sharedOnThirdDevice.body.events[0].completions.map((item) => item.email).sort(), ["other@example.test", "owner@example.test"]);

  const updatedSharedCalendar = await jsonRequest(`${origin}/api/shared-calendar`, {
    method: "POST",
    headers: other,
    body: JSON.stringify({
      action: "update",
      eventId: sharedEvent.id,
      expectedUpdatedAt: sharedEvent.updatedAt,
      kind: "assignment",
      termLabel: "2026年度 前期",
      courseLabel: "統計学",
      title: "共有レポート",
      dueAt: "2026-09-11T17:00",
      note: "締切変更を全員で確認",
    }),
  });
  assert.equal(updatedSharedCalendar.response.status, 200, JSON.stringify(updatedSharedCalendar.body));
  const updatedSharedEvent = updatedSharedCalendar.body.events[0];
  assert.equal(updatedSharedEvent.updatedBy, "other@example.test");
  assert.equal(updatedSharedEvent.note, "締切変更を全員で確認");

  const staleSharedUpdate = await jsonRequest(`${origin}/api/shared-calendar`, {
    method: "POST",
    headers: owner,
    body: JSON.stringify({
      action: "update",
      eventId: sharedEvent.id,
      expectedUpdatedAt: sharedEvent.updatedAt,
      kind: "check",
      termLabel: "2026年度 前期",
      courseLabel: "統計学",
      title: "古い画面からの更新",
      dueAt: "2026-09-12T17:00",
      note: "競合する内容",
    }),
  });
  assert.equal(staleSharedUpdate.response.status, 409);
  assert.equal(staleSharedUpdate.body.conflict, true);

  const trashedSharedCalendar = await jsonRequest(`${origin}/api/shared-calendar`, {
    method: "POST",
    headers: third,
    body: JSON.stringify({ action: "trash", eventId: sharedEvent.id, expectedUpdatedAt: updatedSharedEvent.updatedAt }),
  });
  assert.equal(trashedSharedCalendar.response.status, 200);
  const trashedSharedEvent = trashedSharedCalendar.body.events[0];
  assert.equal(typeof trashedSharedEvent.deletedAt, "string");
  const sharedTrashOnOtherDevice = await jsonRequest(`${origin}/api/shared-calendar`, { headers: other });
  assert.equal(sharedTrashOnOtherDevice.body.events[0].deletedAt, trashedSharedEvent.deletedAt);

  const restoredSharedCalendar = await jsonRequest(`${origin}/api/shared-calendar`, {
    method: "POST",
    headers: owner,
    body: JSON.stringify({ action: "restore", eventId: sharedEvent.id, expectedUpdatedAt: trashedSharedEvent.updatedAt }),
  });
  assert.equal(restoredSharedCalendar.response.status, 200);
  assert.equal(restoredSharedCalendar.body.events[0].deletedAt, null);
  assert.deepEqual(restoredSharedCalendar.body.events[0].completions.map((item) => item.email).sort(), ["other@example.test", "owner@example.test"]);

  const expiredTrash = await jsonRequest(`${origin}/api/shared-calendar`, {
    method: "POST",
    headers: third,
    body: JSON.stringify({ action: "trash", eventId: sharedEvent.id, expectedUpdatedAt: restoredSharedCalendar.body.events[0].updatedAt }),
  });
  assert.equal(expiredTrash.response.status, 200);
  const expiredEvent = expiredTrash.body.events[0];
  const integrationDatabase = new DatabaseSync(databasePath, { timeout: 5000 });
  integrationDatabase.prepare("UPDATE shared_calendar_events SET deleted_at = ? WHERE id = ?").run(Date.now() - 31 * 24 * 60 * 60 * 1000, sharedEvent.id);
  integrationDatabase.close();
  const rejectedExpiredRestore = await jsonRequest(`${origin}/api/shared-calendar`, {
    method: "POST",
    headers: owner,
    body: JSON.stringify({ action: "restore", eventId: sharedEvent.id, expectedUpdatedAt: expiredEvent.updatedAt }),
  });
  assert.equal(rejectedExpiredRestore.response.status, 409);
  const afterExpiredRestore = await jsonRequest(`${origin}/api/shared-calendar`, { headers: owner });
  assert.equal(afterExpiredRestore.body.events.length, 0);

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

  const directCapability = await jsonRequest(`${origin}/api/sync/pdf/transfer`, {
    method: "POST",
    headers: owner,
    body: JSON.stringify({
      operation: "prepare-upload",
      transactionId: firstPrepare.body.transactionId,
      stateRevision: firstPrepare.body.revision,
      ...firstManifest[0],
    }),
  });
  assert.equal(directCapability.response.status, 200);
  assert.equal(directCapability.body.direct, false);

  const beforeCommit = await jsonRequest(`${origin}/api/sync/state`, { headers: owner });
  assert.equal(beforeCommit.body.exists, false);
  assert.equal(beforeCommit.body.pending, true);

  const foreignUpload = await uploadPdf(origin, other, firstPrepare.body.transactionId, firstPrepare.body.revision, firstManifest[0], firstPdf);
  assert.equal(foreignUpload.response.status, 404);

  const firstUpload = await uploadPdf(origin, owner, firstPrepare.body.transactionId, firstPrepare.body.revision, firstManifest[0], firstPdf);
  assert.equal(firstUpload.response.status, 200, JSON.stringify(firstUpload.body));
  const commitFirstTransaction = () => jsonRequest(`${origin}/api/sync/state`, {
    method: "POST",
    headers: owner,
    body: JSON.stringify({ transactionId: firstPrepare.body.transactionId }),
  });
  const [firstCommit, duplicateFirstCommit] = await Promise.all([commitFirstTransaction(), commitFirstTransaction()]);
  assert.equal(firstCommit.response.status, 200, JSON.stringify(firstCommit.body));
  assert.equal(duplicateFirstCommit.response.status, 200, JSON.stringify(duplicateFirstCommit.body));
  assert.equal(firstCommit.body.revision, 1);
  const objectsAfterPromotion = await readdir(objectPath, { recursive: true });
  assert.equal(objectsAfterPromotion.some((entry) => String(entry).includes("staging") && String(entry).endsWith(".pdf")), false);
  assert.equal(objectsAfterPromotion.filter((entry) => String(entry).includes("accounts") && String(entry).endsWith("session-1.pdf")).length, 1);

  const firstCloud = await jsonRequest(`${origin}/api/sync/state`, { headers: owner });
  assert.equal(firstCloud.response.status, 200);
  assert.equal(firstCloud.body.exists, true);
  assert.equal(firstCloud.body.revision, 1);
  assert.equal(firstCloud.body.state.sessions[0].updatedAt, "v1");
  assert.equal(firstCloud.body.state.campus.degreePlan.categories[0].name, "owner卒業要件");
  assert.equal(firstCloud.body.state.campus.gpaProfile.earnedCredits, 40);
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
  assert.equal(secondCloud.body.state.campus.assignments[0].title, "owner-v2提出物");

  const losingPdf = new TextEncoder().encode("%PDF-1.4\n% stale concurrent upload\n%%EOF\n");
  const losingState = stateFor("v3-losing");
  const losingManifest = manifestFor(losingState, losingPdf);
  const losingPrepare = await jsonRequest(`${origin}/api/sync/state`, {
    method: "POST",
    headers: owner,
    body: JSON.stringify(syncBody(2, losingState, losingManifest, "device-integration-losing")),
  });
  assert.equal(losingPrepare.response.status, 200, JSON.stringify(losingPrepare.body));
  const losingUpload = await uploadPdf(origin, owner, losingPrepare.body.transactionId, losingPrepare.body.revision, losingManifest[0], losingPdf);
  assert.equal(losingUpload.response.status, 200, JSON.stringify(losingUpload.body));

  const winningPdf = new TextEncoder().encode("%PDF-1.4\n% winning concurrent upload\n%%EOF\n");
  const winningState = stateFor("v3-winning");
  const winningManifest = manifestFor(winningState, winningPdf);
  const winningPrepare = await jsonRequest(`${origin}/api/sync/state`, {
    method: "POST",
    headers: owner,
    body: JSON.stringify(syncBody(2, winningState, winningManifest, "device-integration-winning")),
  });
  assert.equal(winningPrepare.response.status, 200, JSON.stringify(winningPrepare.body));
  const winningUpload = await uploadPdf(origin, owner, winningPrepare.body.transactionId, winningPrepare.body.revision, winningManifest[0], winningPdf);
  assert.equal(winningUpload.response.status, 200, JSON.stringify(winningUpload.body));
  const winningCommit = await jsonRequest(`${origin}/api/sync/state`, {
    method: "POST",
    headers: owner,
    body: JSON.stringify({ transactionId: winningPrepare.body.transactionId }),
  });
  assert.equal(winningCommit.response.status, 200, JSON.stringify(winningCommit.body));
  assert.equal(winningCommit.body.revision, 3);

  const losingCommit = await jsonRequest(`${origin}/api/sync/state`, {
    method: "POST",
    headers: owner,
    body: JSON.stringify({ transactionId: losingPrepare.body.transactionId }),
  });
  assert.equal(losingCommit.response.status, 409);
  assert.equal(losingCommit.body.conflict, true);
  const remainingObjects = await readdir(objectPath, { recursive: true });
  assert.equal(remainingObjects.some((entry) => String(entry).includes(losingPrepare.body.transactionId) && String(entry).endsWith(".pdf")), false);

  const isolatedAccount = await jsonRequest(`${origin}/api/sync/state`, { headers: other });
  assert.equal(isolatedAccount.body.exists, false);
  const isolatedPdf = await fetch(`${origin}/api/sync/pdf?sessionId=session-1`, { headers: other });
  assert.equal(isolatedPdf.status, 404);

  const otherPcState = stateWithoutPdfFor("other", "pc-v1", 52);
  await commitState(origin, other, 0, otherPcState, "device-other-pc");
  const otherPhoneCloud = await jsonRequest(`${origin}/api/sync/state`, { headers: other });
  assertAccountState(otherPhoneCloud.body, "other", "pc-v1", 52, 1);

  const otherPhoneState = stateWithoutPdfFor("other", "phone-v2", 56);
  await commitState(origin, other, 1, otherPhoneState, "device-other-phone");
  const otherPcCloud = await jsonRequest(`${origin}/api/sync/state`, { headers: other });
  assertAccountState(otherPcCloud.body, "other", "phone-v2", 56, 2);

  const thirdPcState = stateWithoutPdfFor("third", "pc-v1", 68);
  await commitState(origin, third, 0, thirdPcState, "device-third-pc");
  const thirdPhoneCloud = await jsonRequest(`${origin}/api/sync/state`, { headers: third });
  assertAccountState(thirdPhoneCloud.body, "third", "pc-v1", 68, 1);

  const thirdPhoneState = stateWithoutPdfFor("third", "phone-v2", 72);
  await commitState(origin, third, 1, thirdPhoneState, "device-third-phone");
  const thirdPcCloud = await jsonRequest(`${origin}/api/sync/state`, { headers: third });
  assertAccountState(thirdPcCloud.body, "third", "phone-v2", 72, 2);

  const ownerAfterThreeAccounts = await jsonRequest(`${origin}/api/sync/state`, { headers: owner });
  assert.equal(ownerAfterThreeAccounts.body.state.campus.degreePlan.categories[0].name, "owner卒業要件");
  assert.equal(ownerAfterThreeAccounts.body.state.memos[0].text, "owner-v3-winningメモ");
  assert.notEqual(otherPcCloud.body.state.memos[0].text, thirdPcCloud.body.state.memos[0].text);

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

  process.stdout.write("sync API integration: 3 users x PC/phone, shared calendar/completion/trash, Campus/CMTR graduation data, PDF integrity, conflict cleanup, account isolation, deletion passed\n");
} finally {
  server.kill();
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  await rm(dataRoot, { recursive: true, force: true });
}

function stateFor(updatedAt, user = "owner") {
  return {
    courses: [{ id: `course-${user}`, title: `${user}講義` }],
    sessions: [{ id: "session-1", courseId: `course-${user}`, course: `${user}講義`, hasPdf: true, updatedAt, fileName: "integration.pdf", pageCount: 1 }],
    memos: [{ id: `memo-${user}`, text: `${user}-${updatedAt}メモ`, updatedAt }],
    terms: ["2026年度 前期"],
    activeTerm: "2026年度 前期",
    campus: campusStateFor(user, updatedAt, 40),
  };
}

function stateWithoutPdfFor(user, updatedAt, earnedCredits) {
  const state = stateFor(updatedAt, user);
  return { ...state, sessions: [], campus: campusStateFor(user, updatedAt, earnedCredits) };
}

function campusStateFor(user, updatedAt, earnedCredits) {
  return {
    schemaVersion: 1,
    betaAccess: { enabled: true, activatedAt: "2026-08-24T00:00:00.000Z", importedLegacyAt: null },
    assignments: [{ id: `assignment-${user}`, courseId: `course-${user}`, title: `${user}-${updatedAt}提出物`, dueISO: "2026-09-30", status: "todo" }],
    assignmentTemplates: [],
    exams: [{ id: `exam-${user}`, courseId: `course-${user}`, title: `${user}試験`, startsAtISO: "2026-10-01T09:00:00.000Z" }],
    attendanceRecords: [{ id: `attendance-${user}`, courseId: `course-${user}`, dateISO: "2026-08-24", status: "present" }],
    studyTasks: [{ id: `task-${user}`, sourceId: `assignment-${user}`, sourceType: "assignment", title: `${user}学習`, dueISO: "2026-09-29", status: "todo", doneAtISO: null }],
    planningProfile: { supportMode: "standard", style: "steady", steadyDaysBeforeDue: 7, balancedDaysBeforeDue: 3, lastMinuteDaysBeforeDue: 1, showStudyOnDashboard: true, showStudyOnCalendar: true },
    gpaProfile: { currentGpa: 3.2, earnedCredits, targetCumulativeGpa: 3.4, maxGpa: 4.3, plans: [{ id: `grade-${user}`, courseId: `course-${user}`, courseName: `${user}講義`, credits: 2, targetGrade: "A" }] },
    degreePlan: { categories: [{ id: `degree-${user}`, name: `${user}卒業要件`, requiredCredits: 124, earnedCredits }] },
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

async function commitState(baseUrl, headers, baseRevision, state, deviceId) {
  const prepare = await jsonRequest(`${baseUrl}/api/sync/state`, {
    method: "POST",
    headers,
    body: JSON.stringify(syncBody(baseRevision, state, [], deviceId)),
  });
  assert.equal(prepare.response.status, 200, JSON.stringify(prepare.body));
  const commit = await jsonRequest(`${baseUrl}/api/sync/state`, {
    method: "POST",
    headers,
    body: JSON.stringify({ transactionId: prepare.body.transactionId }),
  });
  assert.equal(commit.response.status, 200, JSON.stringify(commit.body));
  assert.equal(commit.body.revision, baseRevision + 1);
}

function assertAccountState(body, user, updatedAt, earnedCredits, revision) {
  assert.equal(body.exists, true);
  assert.equal(body.revision, revision);
  assert.equal(body.state.memos[0].text, `${user}-${updatedAt}メモ`);
  assert.equal(body.state.campus.assignments[0].title, `${user}-${updatedAt}提出物`);
  assert.equal(body.state.campus.gpaProfile.earnedCredits, earnedCredits);
  assert.equal(body.state.campus.degreePlan.categories[0].name, `${user}卒業要件`);
  assert.equal(body.state.campus.degreePlan.categories[0].earnedCredits, earnedCredits);
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
