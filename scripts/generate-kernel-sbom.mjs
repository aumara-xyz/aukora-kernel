// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const lock = JSON.parse(readFileSync(resolve(repoRoot, "package-lock.json"), "utf8"));
const packageManifest = JSON.parse(readFileSync(resolve(repoRoot, "packages/kernel/package.json"), "utf8"));
const outputPath = resolve(repoRoot, "packages/kernel/SBOM.cdx.json");
const names = ["@noble/ciphers", "@noble/curves", "@noble/hashes", "@noble/post-quantum"];
const purl = (name, version) => `pkg:npm/${encodeURIComponent(name)}@${version}`;

function lockEntry(name, expectedVersion) {
  const matches = Object.entries(lock.packages)
    .filter(([path, entry]) => path.endsWith(`node_modules/${name}`) && entry.version === expectedVersion)
    .map(([, entry]) => entry);
  const unique = new Map(matches.map((entry) => [JSON.stringify([entry.version, entry.integrity, entry.license]), entry]));
  if (unique.size !== 1) throw new Error(`expected one resolved identity for ${name}@${expectedVersion}; found ${unique.size}`);
  return [...unique.values()][0];
}

const versions = {
  "@noble/ciphers": "2.2.0",
  "@noble/curves": "2.2.0",
  "@noble/hashes": "2.2.0",
  "@noble/post-quantum": "0.6.1",
};
const components = names.map((name) => {
  const version = versions[name];
  const entry = lockEntry(name, version);
  const component = {
    type: "library",
    "bom-ref": purl(name, version),
    group: name.split("/")[0],
    name: name.split("/")[1],
    version,
    scope: "required",
    purl: purl(name, version),
    licenses: [{ license: { id: entry.license ?? "MIT" } }],
  };
  if (typeof entry.integrity === "string" && entry.integrity.startsWith("sha512-")) {
    component.hashes = [{ alg: "SHA-512", content: entry.integrity.slice("sha512-".length) }];
  }
  return component;
});
const rootRef = purl(packageManifest.name, packageManifest.version);
const refs = Object.fromEntries(names.map((name) => [name, purl(name, versions[name])]));
const sbom = {
  "$schema": "http://cyclonedx.org/schema/bom-1.5.schema.json",
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  version: 1,
  metadata: {
    tools: [{ vendor: "Aukora", name: "generate-kernel-sbom.mjs", version: "1" }],
    component: {
      type: "library",
      "bom-ref": rootRef,
      group: "@aukora",
      name: "kernel",
      version: packageManifest.version,
      scope: "required",
      purl: rootRef,
      licenses: [{ license: { id: packageManifest.license } }],
    },
  },
  components,
  dependencies: [
    { ref: rootRef, dependsOn: [refs["@noble/curves"], refs["@noble/hashes"], refs["@noble/post-quantum"]] },
    { ref: refs["@noble/ciphers"], dependsOn: [] },
    { ref: refs["@noble/curves"], dependsOn: [refs["@noble/hashes"]] },
    { ref: refs["@noble/hashes"], dependsOn: [] },
    { ref: refs["@noble/post-quantum"], dependsOn: [refs["@noble/ciphers"], refs["@noble/curves"], refs["@noble/hashes"]] },
  ],
};
const output = JSON.stringify(sbom, null, 2) + "\n";

if (process.argv.includes("--check")) {
  if (readFileSync(outputPath, "utf8") !== output) throw new Error("kernel SBOM is stale");
  console.log("Kernel SBOM: PASS");
} else {
  process.stdout.write(output);
}
