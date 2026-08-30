import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const textExtensions = new Set([
  ".cmd",
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
  ".txt",
  ".webmanifest",
  ".yaml",
  ".yml",
]);

function trackedTextSnapshot() {
  const paths = execFileSync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean)
    .filter((path) => path !== "public/pdf.worker.min.mjs")
    .filter((path) => textExtensions.has(extname(path)) || path === ".env.example" || path === "LICENSE");

  return paths
    .map((path) => `\n--- ${path} ---\n${readFileSync(join(repositoryRoot, path), "utf8")}`)
    .join("");
}

test("公開対象ファイルに個人用URL・個人端末パス・代表的な秘密情報を含めない", () => {
  const source = trackedTextSnapshot();
  const privateKeyHeader = new RegExp(["-----BEGIN", "(?:RSA |EC |OPENSSH )?", "PRIVATE KEY-----"].join(" "));
  const githubToken = new RegExp(`g${"h"}[pousr]_[A-Za-z0-9]{20,}`);
  const openAiToken = new RegExp(`${"s"}k-[A-Za-z0-9_-]{20,}`);
  const awsAccessKey = new RegExp(`${"AK"}IA[0-9A-Z]{16}`);

  assert.doesNotMatch(source, /https?:\/\/[^\s`)]+\.chatgpt\.site\/?/i);
  assert.doesNotMatch(source, /C:\\Users\\[^\\\s]+/i);
  assert.doesNotMatch(source, privateKeyHeader);
  assert.doesNotMatch(source, githubToken);
  assert.doesNotMatch(source, openAiToken);
  assert.doesNotMatch(source, awsAccessKey);

  const emails = source.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  for (const email of emails) {
    assert.match(email, /@(example\.com|example\.test|system\.gserviceaccount\.com)$/i);
  }
});

test("追跡対象の環境変数例に秘密値を設定しない", () => {
  const environmentExample = readFileSync(join(repositoryRoot, ".env.example"), "utf8");
  const sensitiveNames = /(?:TOKEN|PASSWORD|SECRET|PRIVATE_KEY|ACCESS_KEY)/i;

  for (const line of environmentExample.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match && sensitiveNames.test(match[1])) {
      assert.equal(match[2].trim(), "", `${match[1]} must remain empty in .env.example`);
    }
  }
});
