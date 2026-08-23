import assert from "node:assert/strict";
import test from "node:test";
import { decideSyncPlan, fingerprintState } from "../app/sync-model.ts";

const meta = (revision, fingerprint) => ({
  accountId: "account-1",
  enabled: true,
  revision,
  fingerprint,
  pdfHashes: {},
  pdfTokens: {},
});

test("初回同期では片側だけのデータを安全な向きへ移す", () => {
  assert.equal(decideSyncPlan({ localHasData: true, cloudExists: false, localFingerprint: "local", cloudFingerprint: "", cloudRevision: 0, meta: null }), "upload");
  assert.equal(decideSyncPlan({ localHasData: false, cloudExists: true, localFingerprint: "empty", cloudFingerprint: "cloud", cloudRevision: 3, meta: null }), "download");
});

test("初回に端末とクラウドの両方へ別データがあれば選択を求める", () => {
  assert.equal(decideSyncPlan({ localHasData: true, cloudExists: true, localFingerprint: "local", cloudFingerprint: "cloud", cloudRevision: 2, meta: null }), "choice");
});

test("最後の同期以降に片側だけ変わった場合は自動で同期できる", () => {
  assert.equal(decideSyncPlan({ localHasData: true, cloudExists: true, localFingerprint: "local-new", cloudFingerprint: "cloud-old", cloudRevision: 4, meta: meta(4, "cloud-old") }), "upload");
  assert.equal(decideSyncPlan({ localHasData: true, cloudExists: true, localFingerprint: "local-old", cloudFingerprint: "cloud-new", cloudRevision: 5, meta: meta(4, "local-old") }), "download");
});

test("端末とクラウドの双方が変わった場合は自動上書きしない", () => {
  assert.equal(decideSyncPlan({ localHasData: true, cloudExists: true, localFingerprint: "local-new", cloudFingerprint: "cloud-new", cloudRevision: 5, meta: meta(4, "old") }), "conflict");
});

test("状態フィンガープリントは同じ内容で安定し、内容変更を検出する", () => {
  const first = fingerprintState({ courses: [{ id: "c1" }], memos: [] });
  assert.equal(first, fingerprintState({ courses: [{ id: "c1" }], memos: [] }));
  assert.notEqual(first, fingerprintState({ courses: [{ id: "c1" }], memos: [{ id: "m1" }] }));
});

test("別アカウントの同期メタデータが残る端末では自動同期を止める", () => {
  assert.equal(decideSyncPlan({
    localHasData: true,
    cloudExists: false,
    localFingerprint: "local",
    cloudFingerprint: "",
    cloudRevision: 0,
    meta: meta(4, "old"),
    accountId: "account-2",
  }), "account-mismatch");
});

test("同じアカウントの同期メタデータは従来どおり利用できる", () => {
  assert.equal(decideSyncPlan({
    localHasData: true,
    cloudExists: true,
    localFingerprint: "old",
    cloudFingerprint: "new",
    cloudRevision: 5,
    meta: meta(4, "old"),
    accountId: "account-1",
  }), "download");
});
