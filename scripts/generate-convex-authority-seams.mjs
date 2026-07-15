// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const repoRoot = resolve(import.meta.dirname, "..");
const convexRoot = resolve(repoRoot, "convex");
const outputPath = resolve(repoRoot, "security/convex-authority-seams.json");
const sourceFiles = readdirSync(convexRoot).filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts")).sort();
const sources = new Map();

for (const file of sourceFiles) {
  const text = readFileSync(resolve(convexRoot, file), "utf8");
  sources.set(file, {
    text,
    ast: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
  });
}

function exportsFor(file) {
  const entry = sources.get(file);
  if (!entry) throw new Error(`authority seam source missing: ${file}`);
  const exports = [];
  for (const statement of entry.ast.statements) {
    if (!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      exports.push({ name: statement.name.text, kind: "plain-function" });
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const initializer = declaration.initializer;
        const kind = initializer && ts.isCallExpression(initializer) && ts.isIdentifier(initializer.expression)
          ? initializer.expression.text
          : "value";
        exports.push({ name: declaration.name.text, kind });
      }
    }
  }
  return exports.sort((a, b) => a.name.localeCompare(b.name));
}

function importedBy(file) {
  const moduleName = `./${file.replace(/\.ts$/, "")}`;
  const callers = [];
  for (const [candidate, entry] of sources) {
    if (candidate === file) continue;
    for (const statement of entry.ast.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === moduleName) {
        callers.push(candidate);
        break;
      }
    }
  }
  return callers.sort();
}

const definitions = [
  {
    file: "sessionResolver.ts",
    kind: "legacy-demo-bearer-session-resolver",
    defaultState: "disabled-unless-AUKORA_DEMO_SESSIONS_ENABLED",
    environment: ["AUKORA_DEMO_SESSIONS_ENABLED", "AUMA_NODE_ID"],
    requiredExports: ["DEMO_SESSIONS_FLAG", "requireFounderUserId", "resolveFounderUserId", "resolveSession"],
    note: "Plain exported helpers are authority dependencies even though they are not Convex client callables.",
  },
  {
    file: "popResolver.ts",
    kind: "proof-of-possession-authority-resolver",
    defaultState: "verify-only; demo drivers internal",
    environment: ["AUKORA_DEMO_ATTACKER_SEED", "AUKORA_DEMO_FOUNDER_SEED", "AUKORA_DEMO_ROTATION_NEW_SEED", "AUKORA_DEMO_ROTATION_OLD_SEED", "AUKORA_POP_RATE_CAP", "AUMA_NODE_ID", "AUMA_OPERATOR_SEED"],
    requiredExports: ["requireDemoOperatorSeed", "resolvePoPSession", "runKeyRotation", "runPopCrash"],
    note: "Resolves method/argument/node-bound signed capabilities against pinned public keys.",
  },
  {
    file: "runtimeConfig.ts",
    kind: "fail-closed-adapter-configuration",
    defaultState: "required",
    environment: ["AUMA_HEAD_KEY_ID", "AUMA_NODE_ID"],
    requiredExports: ["flagEnabled", "requireDemoSeed", "requireHeadKeyId", "requireNodeId"],
    note: "Central source for explicit node/head identifiers and disposable demo seed injection.",
  },
  {
    file: "aumlokRootRegistry.ts",
    kind: "aumlok-root-lifecycle-entrypoints",
    defaultState: "public signed protocol surface",
    environment: [],
    requiredExports: ["aumlokGenesisMint", "aumlokRevokeRoot", "aumlokRotateRoot"],
    note: "Public exposure requires PoP, method, argument, node, freshness, and replay verification.",
  },
  {
    file: "aumlokManifests.ts",
    kind: "aumlok-delegation-lifecycle-entrypoints",
    defaultState: "public signed protocol surface",
    environment: ["AUMA_NODE_ID"],
    requiredExports: ["aumlokManifestConsume", "aumlokManifestSelfRevoke", "aumlokMintManifest", "aumlokRevokeManifest"],
    note: "Root/subject signatures and single-consumption state are security-critical.",
  },
  {
    file: "aumlokCeremony.ts",
    kind: "self-sovereign-root-birth-entrypoint",
    defaultState: "public signed protocol surface",
    environment: ["AUMA_NODE_ID"],
    requiredExports: ["aumlokCeremonyMint", "ceremonyHead", "serializeCeremonyV1", "serializeSummaryV1"],
    note: "Public root birth is authorized by a fresh root proof-of-possession; unknown signed-shape fields refuse.",
  },
  {
    file: "codeAttestation.ts",
    kind: "release-evidence-demo",
    defaultState: "internal-only",
    environment: ["AUKORA_DEMO_ATTACKER_RELEASE_SEED", "AUKORA_DEMO_RELEASE_SEED"],
    requiredExports: ["runCodeAttestation", "verifyManifest"],
    note: "The empirical attack runner is internal and accepts only explicitly configured disposable seeds.",
  },
];

const seams = definitions.map((definition) => {
  const exports = exportsFor(definition.file);
  const names = new Set(exports.map((entry) => entry.name));
  for (const required of definition.requiredExports) {
    if (!names.has(required)) throw new Error(`authority seam export missing: ${definition.file}:${required}`);
  }
  const text = sources.get(definition.file).text;
  const directEnvironment = [...text.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((match) => match[1]);
  return {
    file: definition.file,
    kind: definition.kind,
    defaultState: definition.defaultState,
    note: definition.note,
    exports,
    importedBy: importedBy(definition.file),
    environment: [...new Set([...definition.environment, ...directEnvironment])].sort(),
    vAnyCount: (text.match(/\bv\.any\s*\(/g) ?? []).length,
  };
});

const ambientFallbacks = [];
const deterministicSeedLiterals = [];
for (const [file, entry] of sources) {
  entry.text.split(/\r?\n/).forEach((line, index) => {
    if (/process\.env\.[A-Z0-9_]+\s*\?\?\s*["'`]/.test(line)) ambientFallbacks.push({ file, line: index + 1 });
    if (/["'][0-9a-f]{2}["']\.repeat\(32\)/.test(line)) deterministicSeedLiterals.push({ file, line: index + 1 });
  });
}
if (ambientFallbacks.length) throw new Error(`ambient deployment fallback found: ${JSON.stringify(ambientFallbacks)}`);
if (deterministicSeedLiterals.length) throw new Error(`deterministic seed literal found in Convex source: ${JSON.stringify(deterministicSeedLiterals)}`);

const output = `${JSON.stringify({
  schema: "aukora-convex-authority-seams-v1",
  note: "Authority-dependency inventory; this complements, and does not replace, the public callable-surface inventory.",
  invariants: {
    ambientDeploymentFallbacks: "forbidden",
    deterministicSeedLiteralsInConvexSource: "forbidden",
    demoBearerSessions: "disabled by default",
  },
  seams,
}, null, 2)}\n`;

if (process.argv.includes("--check")) {
  if (readFileSync(outputPath, "utf8") !== output) throw new Error("Convex authority-seam inventory is stale");
  console.log(`Convex authority seams: PASS (${seams.length} seams)`);
} else if (process.argv.includes("--write")) {
  writeFileSync(outputPath, output);
  console.log(`wrote ${outputPath}`);
} else {
  process.stdout.write(output);
}
