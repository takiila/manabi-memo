import assert from "node:assert/strict";
import test from "node:test";
import {
  activeOnly,
  isTrashExpired,
  mayInitializeEmptyDevice,
  normalizeDisplayPreferences,
  purgeExpiredTrash,
  trashDaysRemaining,
  trashOnly,
} from "../app/data-safety-model.ts";

test("Campus Muster is hidden until the display setting is explicitly enabled", () => {
  assert.deepEqual(normalizeDisplayPreferences(undefined), { campusMusterEnabled: false });
  assert.deepEqual(normalizeDisplayPreferences({ campusMusterEnabled: true }), { campusMusterEnabled: true });
});

test("active and trashed records are separated without losing either", () => {
  const values = [{ id: "active" }, { id: "trash", deletedAt: "2026-08-01T00:00:00.000Z" }];
  const now = new Date("2026-08-14T00:00:00.000Z");
  assert.deepEqual(activeOnly(values).map((value) => value.id), ["active"]);
  assert.deepEqual(trashOnly(values, now).map((value) => value.id), ["trash"]);
});

test("trash records remain restorable for 30 days", () => {
  const value = { deletedAt: "2026-08-01T00:00:00.000Z" };
  assert.equal(trashDaysRemaining(value, new Date("2026-08-14T00:00:00.000Z")), 17);
  assert.equal(isTrashExpired(value, new Date("2026-08-30T23:59:59.000Z")), false);
  assert.equal(isTrashExpired(value, new Date("2026-08-31T00:00:00.000Z")), true);
});

test("only expired trash is purged", () => {
  const values = [
    { id: "active" },
    { id: "recent", deletedAt: "2026-08-10T00:00:00.000Z" },
    { id: "expired", deletedAt: "2026-07-01T00:00:00.000Z" },
  ];
  assert.deepEqual(purgeExpiredTrash(values, new Date("2026-08-14T00:00:00.000Z")).map((value) => value.id), ["active", "recent"]);
});

test("an invalid deletion timestamp never hides a record", () => {
  const values = [{ id: "kept", deletedAt: "not-a-date" }];
  assert.deepEqual(activeOnly(values).map((value) => value.id), ["kept"]);
  assert.deepEqual(trashOnly(values).map((value) => value.id), []);
});

test("device initialization requires both backup acknowledgement and typed confirmation", () => {
  assert.equal(mayInitializeEmptyDevice({ backupConfirmed: false, confirmationText: "初期化" }), false);
  assert.equal(mayInitializeEmptyDevice({ backupConfirmed: true, confirmationText: "" }), false);
  assert.equal(mayInitializeEmptyDevice({ backupConfirmed: true, confirmationText: "初期化" }), true);
});
