// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani

import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const sourceRoot = join(repoRoot, "packages", "kernel", "src");
const packagePath = join(repoRoot, "packages", "kernel", "package.json");

const forbidden = [
  ["Convex import", /(?:from\s+["'](?:convex(?:\/[^"']*)?|.*\/?_generated\/[^"']*)["']|import\s*\(["'](?:convex|.*\/?_generated\/))/],
  ["Node/platform import", /(?:from\s+["'](?:node:)?(?:fs|path|os|child_process|net|http|https|tls|dgram|worker_threads|cluster)(?:\/[^"']*)?["']|import\s*\(["'](?:node:)?(?:fs|path|os|child_process|net|http|https|tls|dgram))/],
  ["private repository import", /(?:aukora-symbiote|aukora-os|node-template|\.\.\/\.\.\/\.\.\/)/],
  ["ambient environment", /\bprocess(?:\.env)?\b/],
  ["ambient clock", /\bDate\s*(?:\.|\()/],
  ["ambient randomness", /\b(?:Math\.random|crypto\.getRandomValues|crypto\.randomUUID|globalThis\.crypto)\b/],
  ["network API", /\b(?:fetch|WebSocket|XMLHttpRequest|EventSource|sendBeacon)\s*\(/],
  ["runtime-specific global", /\b(?:Bun|Deno)\b/],
  ["ML-KEM/AEAD transport", /(?:ml[_-]?kem|xchacha|chacha20|@noble\/ciphers)/i],
  ["execution/apply surface", /(?:execFile|spawn|liveApply|writeFile|git\s)/],
];

async function filesUnder(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await filesUnder(path));
    else if (entry.isFile() && path.endsWith(".ts")) out.push(path);
  }
  return out;
}

const failures = [];
for (const file of await filesUnder(sourceRoot)) {
  const text = await readFile(file, "utf8");
  for (const [label, pattern] of forbidden) {
    if (pattern.test(text)) failures.push(`${relative(repoRoot, file)}: ${label}`);
  }
}

const manifest = JSON.parse(await readFile(packagePath, "utf8"));
if (manifest.name !== "@aukora/kernel") failures.push("package name must be @aukora/kernel");
if (manifest.sideEffects !== false) failures.push("package must declare sideEffects=false");
if (JSON.stringify(manifest.dependencies ?? {}).includes("convex")) failures.push("portable package may not depend on Convex");
const allowedPackageFiles = ["dist", "conformance", "examples", "LICENSE", "NOTICE", "PROVENANCE.md", "README.md", "SBOM.cdx.json", "src"];
if (!Array.isArray(manifest.files)
  || manifest.files.length !== allowedPackageFiles.length
  || manifest.files.some((p) => !allowedPackageFiles.includes(p))) {
  failures.push(`package files allowlist must equal: ${allowedPackageFiles.join(", ")}`);
}
if (!manifest.exports?.["."]?.import || !manifest.exports?.["."]?.types) failures.push("package must expose import and types entrypoints");
for (const subpath of ["authority", "canonical", "evidence", "merkle", "reducer", "registries", "schemas"]) {
  if (!manifest.exports?.[`./${subpath}`]?.import || !manifest.exports?.[`./${subpath}`]?.types) {
    failures.push(`package subpath export missing: ${subpath}`);
  }
}
if (manifest.exports?.["./conformance/v1.json"] !== "./conformance/v1.json"
  || manifest.exports?.["./conformance/hybrid-v1.json"] !== "./conformance/hybrid-v1.json"
  || manifest.exports?.["./conformance/manifest.json"] !== "./conformance/manifest.json") {
  failures.push("package must expose frozen conformance vectors and compatibility manifest");
}
if (manifest.exports?.["./SBOM.cdx.json"] !== "./SBOM.cdx.json") failures.push("package must expose its CycloneDX SBOM");

if (failures.length) {
  console.error("Portable boundary violations:\n" + failures.map((f) => `- ${f}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Portable boundary: PASS");
}
