import assert from "node:assert/strict";
import test from "node:test";

import { DeadlineError, settleWithin } from "../app/async-deadline.ts";

test("settleWithin returns a completed storage result", async () => {
  assert.equal(await settleWithin(Promise.resolve("ready"), 50, "timeout"), "ready");
});

test("settleWithin preserves storage failures", async () => {
  await assert.rejects(settleWithin(Promise.reject(new Error("blocked")), 50, "timeout"), /blocked/);
});

test("settleWithin turns a hanging storage request into a finite failure", async () => {
  await assert.rejects(
    settleWithin(new Promise(() => undefined), 5, "端末データが応答しません"),
    (error) => error instanceof DeadlineError && error.message === "端末データが応答しません",
  );
});
