import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
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
  env: { ...process.env, DATABASE_URL: path.join(directory, "test.sqlite"), LOCAL_FILE_STORE: path.join(directory, "objects"), SYNC_PDF_MODE: "references", MANABI_MCP_ENABLED:"true", MANABI_MCP_ORIGIN:"https://app.example.test", MANABI_MCP_CLIENT_ID:"test-client", MANABI_MCP_REDIRECT_URI:"https://chatgpt.com/connector_platform_oauth_redirect", MANABI_MCP_CLIENT_SECRET:"", FIREBASE_PROJECT_ID:"test-project", TRUST_CHATGPT_AUTH_HEADERS: "true", ALLOWED_ACCOUNT_EMAILS: "owner@example.test,other@example.test", BLOB_READ_WRITE_TOKEN: "", BLOB_STORE_ID: "", S3_BUCKET: "" },
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
  const local = { activeTerm:"T", courses: [{id:"c1",title:"Test course",term:"T",code:"TEST1",weekday:1,period:1}], campus:{assignments:[],exams:[],attendanceRecords:[],studyEvidence:[]}, sessions: [{ id: "lecture-1", scheduledOn: "2026-10-09", hasPdf: true, fileName: "lecture.pdf", pageCount: 10, lastPdfPage: 7, pageTexts: ["not uploaded"], topics: [{ title: "not uploaded" }], noteText: "lecture note" }], memos: [{ id: "memo-1", sessionId: "lecture-1", page: 7, text: "page seven memo", checklist: [{ id: "check-1", text: "review proof", done: false, registered: true, due: "2026-10-09", priority: true, workAt: "", deletedAt: null }] }], planner: { version: 1, todos: [{ id: "personal-1", text: "review material", done: false, registered: true, due: "", priority: false, workAt: "", deletedAt: null, courseId: "", tags: ["review"] }], events: [{ id: "event-1", title: "appointment", start: "2026-10-10", end: "", note: "", deletedAt: null }] } };
  const imported = (type, summary, data, id) => ({
    id, collection: "gunma-course-review-2026", updatedAt: "2026-11-26T04:19:12+09:00",
    item: { id, type, title: id, term: "T", summary, data,
      uncertainties: ["Confirm in university system"],
      source: { kind: "web", title: "Synthetic source", url: "https://private.example.test/" },
      extensions: { "x-observed-at": "2026-11-26T04:19:12+09:00", "x-course-code": "TEST1" } }
  });
  local.inbox = { version: 1, records: [
    imported("assignment", "Conflicting deadline", {}, "assignment-fixture"),
    imported("exam", "Scope unconfirmed", { starts_at: "2026-12-01" }, "exam-fixture"),
    imported("announcement", "Report 40%; attendance required; lesson 7 published", {}, "evaluation-fixture"),
  ] };
  const cloud = referencesForSync(local, { "lecture-1": "a".repeat(64) });
  const body = (state, baseRevision = 0, deviceId = "desktop") => JSON.stringify({ baseRevision, schemaVersion: 15, state, pdfIds: [], pdfs: [], deviceId: `test-device-${deviceId}` });
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
    assert.deepEqual(downloaded.body.state.memos[0].checklist, local.memos[0].checklist);
    assert.deepEqual(downloaded.body.state.planner, local.planner);
    assert.equal(downloaded.body.schemaVersion, 15);
    assert.equal(downloaded.body.state.sessions[0].scheduledOn, "2026-10-09");
    assert.deepEqual(downloaded.body.pdfs, []);
    assert.equal((await request("/api/sync/state", { method: "POST", headers, body: body(cloud, 0, device) })).status, 409);
  }
  assert.equal((await request("/api/sync/state", { headers: { ...headers, "oai-authenticated-user-email": "other@example.test" } })).body.exists, false);
  assert.equal(local.sessions[0].hasPdf, true);
  const badDay = { ...cloud, sessions: [{ ...cloud.sessions[0], scheduledOn: "2026-02-30" }] };
  assert.equal((await request("/api/sync/state", { method: "POST", headers, body: body(badDay, 1) })).status, 400);
  const malformed = { ...cloud, planner: { ...cloud.planner, todos: [{ ...cloud.planner.todos[0], due: "2026-02-30" }] } };
  assert.equal((await request("/api/sync/state", { method: "POST", headers, body: body(malformed, 1) })).status, 400);
  // Seed synthetic authorization codes after the ordinary account-isolation tests.
  // Firebase sign-in/consent is not simulated here; the token and MCP HTTP endpoints are real.
  const metadata=await request("/.well-known/oauth-protected-resource");
  assert.equal(metadata.status,200);
  const resource="https://app.example.test/mcp", redirect="https://chatgpt.com/connector_platform_oauth_redirect";
  assert.equal(metadata.body.resource,resource);
  assert.equal((await request("/.well-known/oauth-authorization-server")).body.code_challenge_methods_supported[0],"S256");
  const rpc=(method,params={},token,extra={})=>request("/mcp",{method:"POST",headers:{"content-type":"application/json",...(token?{authorization:"Bearer "+token}:{}),...extra},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});
  const call=(name,args,token)=>rpc("tools/call",{name,arguments:args},token);
  assert.equal((await rpc("initialize",{protocolVersion:"2025-11-25"})).body.result.protocolVersion,"2025-11-25");
  assert.equal((await rpc("tools/list")).body.result.tools.length,8);
  assert.equal((await rpc("tools/list",{},undefined,{origin:"https://evil.example.test"})).status,403);
  assert.equal((await call("get_academic_summary",{})).body.result.isError,true);
  const db=new DatabaseSync(path.join(directory,"test.sqlite"));
  const sha=value=>createHash("sha256").update(value).digest("hex");
  const verifier=randomBytes(32).toString("base64url");
  const challenge=createHash("sha256").update(verifier).digest("base64url");
  const user=db.prepare("SELECT user_id FROM synced_app_state WHERE revision=1").get().user_id;
  const issuer="https://securetoken.google.com/test-project", subject="synthetic-firebase-owner", now=Date.now();
  db.prepare("INSERT INTO auth_identities (issuer,subject,provider,account_id,verified_at,created_at,last_seen_at) VALUES (?,?,?,?,?,?,?)").run(issuer,subject,"firebase",user,now,now,now);
  function seed(scope){
    const code=randomBytes(32).toString("base64url");
    db.prepare("INSERT INTO academic_oauth_codes (code_hash,user_id,identity_issuer,identity_subject,email,client_id,redirect_uri,resource,scope,challenge,expires_at,used_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)").run(sha(code),user,issuer,subject,"owner@example.test","test-client",redirect,resource,scope,challenge,Date.now()+60000);
    return code;
  }
  const tokenRequest=(fields)=>request("/api/academic-oauth/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:"test-client",resource,...fields})});
  const exchange=(code,proof=verifier)=>tokenRequest({grant_type:"authorization_code",code,redirect_uri:redirect,code_verifier:proof});
  try {
    const readCode=seed("manabi.read");
    assert.equal((await exchange(readCode,randomBytes(32).toString("base64url"))).status,400);
    const readToken=await exchange(readCode);
    assert.equal(readToken.status,200,JSON.stringify(readToken.body));
    assert.equal((await exchange(readCode)).status,400);
    const snapshot=await call("get_academic_summary",{},readToken.body.access_token);
    assert.equal(snapshot.body.result.isError,false,JSON.stringify(snapshot.body));
    assert.equal(snapshot.body.result.structuredContent.data.courses[0].id,"c1");
    assert.ok(!JSON.stringify(snapshot.body).includes("lecture note"));
    assert.ok(!JSON.stringify(snapshot.body).includes("private.example.test"));
    const observed = snapshot.body.result.structuredContent.data.university;
    assert.equal(observed.find(item => item.type === "assignment").summary, "Conflicting deadline");
    assert.equal(observed.find(item => item.type === "exam").dates.starts_at, "2026-12-01");
    assert.match(observed.find(item => item.id === "evaluation-fixture").summary, /Report 40%; attendance required; lesson 7/);
    const attendance={expectedRevision:1,courseId:"c1",confirmed:true,day:"2026-10-09",status:"present",expectedStatus:null};
    assert.equal((await call("record_attendance",attendance,readToken.body.access_token)).body.result.isError,true);
    const otherReadToken=await exchange(seed("manabi.read"));
    const firstDetail=await call("get_course_academic_detail",{courseId:"c1"},readToken.body.access_token);
    const secondDetail=await call("get_course_academic_detail",{courseId:"c1"},otherReadToken.body.access_token);
    assert.equal(firstDetail.body.result.isError,false,JSON.stringify(firstDetail.body));
    assert.deepEqual(firstDetail.body.result.structuredContent,secondDetail.body.result.structuredContent);
    assert.equal(firstDetail.body.result.structuredContent.data.course.id,"c1");
    assert.equal(firstDetail.body.result.structuredContent.data.records.length,3);
    assert.equal(firstDetail.body.result.structuredContent.data.records[0].evidence[0].summary,"Conflicting deadline");
    assert.ok(!JSON.stringify(firstDetail.body).includes("private.example.test"));
    assert.equal((await call("get_course_academic_detail",{courseId:"missing"},otherReadToken.body.access_token)).body.result.isError,true);
    const writer=await exchange(seed("manabi.read manabi.write"));
    assert.equal(writer.status,200);
    const saved=await call("record_attendance",attendance,writer.body.access_token);
    assert.equal(saved.body.result.isError,false,JSON.stringify(saved.body));
    assert.equal(saved.body.result.structuredContent.revision,2);
    assert.equal((await call("record_attendance",attendance,writer.body.access_token)).body.result.isError,true);
    const restored=await request("/api/sync/state",{headers});
    assert.equal(restored.body.state.campus.attendanceRecords[0].status,"present");
    assert.equal(restored.body.state.memos[0].text,"page seven memo");
    assert.equal((await request("/api/sync/state",{headers:{...headers,"oai-authenticated-user-email":"other@example.test"}})).body.exists,false);
    const refreshed=await tokenRequest({grant_type:"refresh_token",refresh_token:writer.body.refresh_token});
    assert.equal(refreshed.status,200);
    assert.equal((await call("get_academic_summary",{},writer.body.access_token)).body.result.isError,true);
    assert.equal((await call("get_academic_summary",{},refreshed.body.access_token)).body.result.isError,false);
    assert.equal((await tokenRequest({grant_type:"refresh_token",refresh_token:writer.body.refresh_token})).status,400);
    assert.equal((await call("get_academic_summary",{},refreshed.body.access_token)).body.result.isError,true);
  } finally { db.close(); }
  console.log("Academic MCP: token exchange, PKCE, scopes, privacy, write/revision, refresh rotation and replay revocation verified with synthetic identities.");
  console.log("Reference-only API: no PDF transfers, page-seven memo shared, revision conflicts and account isolation verified.");
} finally {
  const exited = new Promise((resolve) => server.once("exit", resolve));
  server.kill();
  await exited;
  await rm(directory, { recursive: true, force: true });
}
