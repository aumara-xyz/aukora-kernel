// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AUTHORITY_PROFILES,
  CRYPTO_SUITES,
  KERNEL_SCHEMAS,
  PURPOSE_DOMAINS,
  RINGS,
  canonicalHash,
  canonicalJson,
} from "../packages/kernel/dist/index.js";

const repoRoot = resolve(import.meta.dirname, "..");
const packagePath = resolve(repoRoot, "packages/kernel/package.json");
const outputPath = resolve(repoRoot, "packages/kernel/conformance/manifest.json");
const packageManifest = JSON.parse(readFileSync(packagePath, "utf8"));
const vectorPaths = ["conformance/hybrid-v1.json", "conformance/v1.json"];
const rawSha256 = (value) => createHash("sha256").update(value).digest("hex");
const fileHash = (path) => rawSha256(readFileSync(resolve(repoRoot, "packages/kernel", path)));
const vectors = vectorPaths.map((path) => ({ path, sha256: fileHash(path) }));
const registry = { authorityProfiles: AUTHORITY_PROFILES, cryptoSuites: CRYPTO_SUITES, purposeDomains: PURPOSE_DOMAINS, rings: RINGS };
const policyContract = {
  schema: KERNEL_SCHEMAS.policy,
  closedTopLevelFields: ["rules", "sacred", "schema"],
  closedRuleFields: ["action", "maxRing", "requiresAuthorization", "resourceNamespace"],
  closedSacredFields: ["actionKind", "actionNamespace", "resourceNamespace"],
  duplicateRules: "refuse",
  unknownFields: "refuse",
};
const manifest = {
  schema: "aukora-kernel-compatibility-v1",
  package: { name: packageManifest.name, version: packageManifest.version },
  sourceBase: "2dd96f26d34c9e07649c2210ba1cbf64f6c026af",
  releaseCommit: null,
  tarballIntegrity: null,
  requirements: {
    ecmaTarget: "ES2022",
    node: packageManifest.engines.node,
    adapterAtomicity: "persist-next-state-and-final-receipt-or-neither",
    effectOrder: "execute-only-after-durable-allowed-consumption",
  },
  digests: {
    schemas: canonicalHash(KERNEL_SCHEMAS),
    policyContract: canonicalHash(policyContract),
    domainRegistry: canonicalHash(PURPOSE_DOMAINS),
    authorityProfiles: canonicalHash(AUTHORITY_PROFILES),
    registries: canonicalHash(registry),
    exports: canonicalHash(packageManifest.exports),
    vectorSet: rawSha256(vectors.map(({ path, sha256 }) => path + "\u0000" + sha256).join("\n")),
  },
  vectors,
};
const output = JSON.stringify(manifest, null, 2) + "\n";

if (process.argv.includes("--check")) {
  if (readFileSync(outputPath, "utf8") !== output) throw new Error("kernel compatibility manifest is stale");
  console.log("Kernel compatibility manifest: PASS");
} else {
  process.stdout.write(output);
}
