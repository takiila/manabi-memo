import assert from "node:assert/strict";
import test from "node:test";
import { retryTransient } from "../app/sync-retry-model.ts";

test("retries a 5xx response and returns the later success", async () => {
  let calls = 0;
  const response = await retryTransient(async () => ({ status: ++calls === 1 ? 503 : 200 }), { delay: async () => undefined });
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test("retries a transport exception and returns the later success", async () => {
  let calls = 0;
  const response = await retryTransient(async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("network down");
    return { status: 200 };
  }, { delay: async () => undefined });
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test("does not retry a 4xx response", async () => {
  let calls = 0;
  const response = await retryTransient(async () => ({ status: ++calls === 1 ? 409 : 200 }), { delay: async () => undefined });
  assert.equal(response.status, 409);
  assert.equal(calls, 1);
});

test("returns the final 5xx response after the attempt limit", async () => {
  let calls = 0;
  const response = await retryTransient(async () => {
    calls += 1;
    return { status: 503 };
  }, { maxAttempts: 3, delay: async () => undefined });
  assert.equal(response.status, 503);
  assert.equal(calls, 3);
});

test("rethrows the final transport exception after the attempt limit", async () => {
  let calls = 0;
  await assert.rejects(
    retryTransient(async () => {
      calls += 1;
      throw new Error("storage unavailable");
    }, { maxAttempts: 3, delay: async () => undefined }),
    /storage unavailable/,
  );
  assert.equal(calls, 3);
});
