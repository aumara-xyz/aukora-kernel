// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EdgeVM } from "@edge-runtime/vm";
import { build } from "esbuild";

const repoRoot = resolve(import.meta.dirname, "..");
const vector = JSON.parse(readFileSync(resolve(repoRoot, "packages/kernel/conformance/v1.json"), "utf8")).reducerVectors[0];
const expectedHash = vector.expected.receiptDraft.draftHash;

const entry = [
  'import { canonicalJson, decide } from "./packages/kernel/dist/index.js";',
  "const vector=" + JSON.stringify(vector) + ";",
  "const policyBytes=new TextEncoder().encode(vector.policyCanonicalJson);",
  "const result=decide(vector.request,vector.trustedState,policyBytes,vector.nowMs);",
  "globalThis.__aukoraKernelRuntimeResult=canonicalJson(result);",
].join("\n");

const bundled = await build({
  stdin: { contents: entry, resolveDir: repoRoot, sourcefile: "aukora-kernel-runtime-entry.mjs" },
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  write: false,
  metafile: true,
  logLevel: "silent",
});
const browserBundle = bundled.outputFiles[0].text;
if (/\b(?:node:fs|node:path|node:crypto|process\.env|require\s*\()/.test(browserBundle)) {
  throw new Error("browser bundle contains a forbidden Node capability");
}

const edge = new EdgeVM();
edge.evaluate(browserBundle);
const edgeResult = JSON.parse(edge.evaluate("globalThis.__aukoraKernelRuntimeResult"));
if (edgeResult.receiptDraft.draftHash !== expectedHash) throw new Error("Edge Runtime result mismatch");

let bunStatus = "SKIP (not installed)";
const bun = spawnSync("bun", ["--version"], { cwd: repoRoot, encoding: "utf8" });
if (bun.status === 0) {
  const output = execFileSync("bun", ["packages/kernel/examples/observe.mjs"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const bunResult = JSON.parse(output);
  if (bunResult.decision.code !== "allowed" || bunResult.receiptDraft.sequence !== 1) throw new Error("Bun result mismatch");
  bunStatus = `PASS (${bun.stdout.trim()})`;
} else if (process.env.AUKORA_REQUIRE_BUN === "1") {
  throw new Error("Bun is required but not installed");
}

console.log(`Kernel runtimes: PASS (Edge Runtime; browser bundle ${browserBundle.length} bytes; Bun ${bunStatus})`);
