import assert from "node:assert/strict";
import test from "node:test";

import { DeadlineError, runResourceWithinDeadline, settleWithin } from "../app/async-deadline.ts";

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

test("runResourceWithinDeadline closes an opened resource when its read hangs", async () => {
  const calls = [];
  const resource = { id: "database" };
  await assert.rejects(
    runResourceWithinDeadline({
      open: async () => resource,
      use: async () => new Promise(() => undefined),
      close: (value) => calls.push(`close:${value.id}`),
      milliseconds: 5,
      message: "read timeout",
      onDeadline: (value) => calls.push(`abort:${value?.id ?? "none"}`),
    }),
    (error) => error instanceof DeadlineError && error.message === "read timeout",
  );
  assert.deepEqual(calls, ["abort:database", "close:database"]);
});

test("runResourceWithinDeadline closes a database that opens after the deadline without reading it", async () => {
  let resolveOpen;
  const calls = [];
  const opening = new Promise((resolve) => { resolveOpen = resolve; });
  const result = runResourceWithinDeadline({
    open: () => opening,
    use: async () => { calls.push("read"); return "state"; },
    close: () => calls.push("close"),
    milliseconds: 5,
    message: "open timeout",
    onDeadline: (value) => calls.push(value ? "abort:open" : "abort:none"),
  });
  await assert.rejects(result, (error) => error instanceof DeadlineError);
  resolveOpen({ id: "late-database" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, ["abort:none", "close"]);
});

test("runResourceWithinDeadline closes once after a successful read", async () => {
  let closeCount = 0;
  const result = await runResourceWithinDeadline({
    open: async () => ({ id: "database" }),
    use: async () => "state",
    close: () => { closeCount += 1; },
    milliseconds: 50,
    message: "timeout",
  });
  assert.equal(result, "state");
  assert.equal(closeCount, 1);
});
