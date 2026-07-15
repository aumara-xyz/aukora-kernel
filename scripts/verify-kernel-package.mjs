// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const run = (command, args, options = {}) => execFileSync(command, args, {
  cwd: repoRoot,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
  ...options,
});

const dryRun = JSON.parse(run("npm", ["pack", "--workspace", "@aukora/kernel", "--dry-run", "--json"]))[0];
const paths = dryRun.files.map((entry) => entry.path);
const required = ["LICENSE", "NOTICE", "PROVENANCE.md", "README.md", "SBOM.cdx.json", "conformance/v1.json", "conformance/hybrid-v1.json", "conformance/manifest.json", "examples/observe.mjs", "dist/index.js", "dist/index.d.ts", "src/index.ts", "package.json"];
const allowed = /^(?:LICENSE|NOTICE|PROVENANCE\.md|README\.md|SBOM\.cdx\.json|package\.json|conformance\/[^/]+\.json|examples\/[^/]+\.mjs|dist\/[^/]+\.(?:js|js\.map|d\.ts|d\.ts\.map)|src\/[^/]+\.ts)$/;
const failures = [
  ...required.filter((path) => !paths.includes(path)).map((path) => `missing package file: ${path}`),
  ...paths.filter((path) => !allowed.test(path)).map((path) => `unexpected package file: ${path}`),
];
if (failures.length) throw new Error(failures.join("\n"));

const temporary = mkdtempSync(join(tmpdir(), "aukora-kernel-package-"));
try {
  const filename = run("npm", ["pack", "--workspace", "@aukora/kernel", "--pack-destination", temporary, "--silent"]).trim().split("\n").at(-1);
  if (!filename) throw new Error("package filename missing");
  const smoke = join(temporary, "smoke");
  mkdirSync(smoke);
  writeFileSync(join(smoke, "package.json"), "{\"private\":true,\"type\":\"module\"}\n");
  run("npm", ["install", join(temporary, filename), "--ignore-scripts", "--silent", "--no-audit", "--no-fund"], { cwd: smoke });
  const installedManifest = JSON.parse(readFileSync(join(smoke, "node_modules", "@aukora", "kernel", "package.json"), "utf8"));
  if (Object.prototype.hasOwnProperty.call(installedManifest.dependencies ?? {}, "convex")) throw new Error("installed package depends on Convex");
  const verify = [
    'import { AUKORA_KERNEL_PACKAGE_VERSION, canonicalBytes, decide } from "@aukora/kernel";',
    'import { verifyAumlokPromotionV2 } from "@aukora/kernel/authority";',
    'import { canonicalJson } from "@aukora/kernel/canonical";',
    'import { verifyArtifactChain } from "@aukora/kernel/evidence";',
    'import { merkleRoot } from "@aukora/kernel/merkle";',
    'import { decodePolicy } from "@aukora/kernel/reducer";',
    'import { PURPOSE_DOMAINS } from "@aukora/kernel/registries";',
    'import { assertKernelRequest } from "@aukora/kernel/schemas";',
    'const policy={schema:"aukora-policy-v1",rules:[{action:{namespace:"example",kind:"record",verb:"observe"},resourceNamespace:"artifact",maxRing:"observe",requiresAuthorization:false}],sacred:[]};',
    'const state={schema:"aukora-trusted-state-v1",salama:{active:false,reason:null},trustedRoots:[],consumedIds:[],receiptHead:{count:0,headHash:null}};',
    'const request={schema:"aukora-kernel-request-v1",requestId:"vector-observe-1",action:{namespace:"example",kind:"record",verb:"observe"},resource:{namespace:"artifact",id:"sample"},ring:"observe",payloadHash:null,consumptionId:null,humanClearance:false,authorization:null,evidenceRefs:[]};',
    'const result=decide(request,state,canonicalBytes(policy),1735689600000);',
    'if(typeof verifyAumlokPromotionV2!=="function"||typeof canonicalJson!=="function"||typeof verifyArtifactChain!=="function"||typeof merkleRoot!=="function"||typeof decodePolicy!=="function"||typeof assertKernelRequest!=="function"||!PURPOSE_DOMAINS.aumlokPromotion) process.exit(1);',
    'const vectorUrl=import.meta.resolve("@aukora/kernel/conformance/v1.json");',
    'const manifestUrl=import.meta.resolve("@aukora/kernel/conformance/manifest.json");',
    'const sbomUrl=import.meta.resolve("@aukora/kernel/SBOM.cdx.json");',
    'if(!vectorUrl.endsWith("/conformance/v1.json")||!manifestUrl.endsWith("/conformance/manifest.json")||!sbomUrl.endsWith("/SBOM.cdx.json")) process.exit(1);',
    'if(AUKORA_KERNEL_PACKAGE_VERSION!=="0.1.0"||result.receiptDraft.draftHash!=="98208d936f65135cf93879fab5fcd275c31141c95eb635c9853654e543e562ec") process.exit(1);',
  ].join("");
  run(process.execPath, ["--input-type=module", "-e", verify], { cwd: smoke });
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

console.log(`Kernel package: PASS (${paths.length} files; empty-project install verified)`);
