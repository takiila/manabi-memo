import assert from "node:assert/strict";
import test from "node:test";

test("Cloudflare R2へ5分間のprivate GET/PUT署名URLを発行する", async () => {
  const previous = Object.fromEntries([
    "BLOB_READ_WRITE_TOKEN",
    "VERCEL_OIDC_TOKEN",
    "BLOB_STORE_ID",
    "S3_BUCKET",
    "S3_REGION",
    "S3_ENDPOINT",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
  ].map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    BLOB_READ_WRITE_TOKEN: "",
    VERCEL_OIDC_TOKEN: "",
    BLOB_STORE_ID: "",
    S3_BUCKET: "manabi-private",
    S3_REGION: "auto",
    S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
    S3_ACCESS_KEY_ID: "test-access-key",
    S3_SECRET_ACCESS_KEY: "test-secret-key",
  });

  try {
    const { getObjectStore } = await import(`../lib/server/object-store.ts?r2-test=${Date.now()}`);
    const store = getObjectStore();
    assert.equal(store.kind, "cloudflare-r2-private");
    assert.equal(typeof store.copy, "function");
    assert.equal(typeof store.createDirectUpload, "function");
    assert.equal(typeof store.createDirectDownload, "function");

    const before = Date.now();
    const upload = await store.createDirectUpload("user/transactions/tx/session.pdf", {
      contentType: "application/pdf",
      maximumSizeInBytes: 75 * 1024 * 1024,
    });
    const download = await store.createDirectDownload("user/pdfs/session.pdf");
    for (const transfer of [upload, download]) {
      const signed = new URL(transfer.url);
      assert.match(signed.hostname, /\.r2\.cloudflarestorage\.com$/);
      assert.equal(signed.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
      assert.equal(signed.searchParams.get("X-Amz-Expires"), "300");
      assert.ok(transfer.expiresAt >= before + 299_000);
      assert.ok(transfer.expiresAt <= Date.now() + 301_000);
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
