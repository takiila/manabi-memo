import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const templatePath = path.join(root, "public", "sw.template.js");
const outputPath = path.join(root, "public", "sw.js");
const template = await readFile(templatePath, "utf8");
const deploymentSeed = process.env.VERCEL_GIT_COMMIT_SHA
  || process.env.GITHUB_SHA
  || process.env.MANABI_MEMO_BUILD_ID
  || new Date().toISOString();
const version = createHash("sha256").update(`${deploymentSeed}\n${template}`).digest("hex").slice(0, 16);
const output = template.replaceAll("__CACHE_VERSION__", version);

await writeFile(outputPath, output, "utf8");
process.stdout.write(`service worker cache version: ${version}\n`);
