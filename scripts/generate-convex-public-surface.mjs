// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const repoRoot = resolve(import.meta.dirname, "..");
const convexRoot = resolve(repoRoot, "convex");
const outputPath = resolve(repoRoot, "security/convex-public-surface.json");
const publicKinds = new Set(["action", "mutation", "query"]);
const functions = [];

for (const file of readdirSync(convexRoot).filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts")).sort()) {
  const source = ts.createSourceFile(file, readFileSync(resolve(convexRoot, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement) || !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer;
      if (!ts.isIdentifier(declaration.name) || !initializer || !ts.isCallExpression(initializer) || !ts.isIdentifier(initializer.expression)) continue;
      if (!publicKinds.has(initializer.expression.text)) continue;
      functions.push({ file, export: declaration.name.text, kind: initializer.expression.text });
    }
  }
}
functions.sort((a, b) => a.file.localeCompare(b.file) || a.export.localeCompare(b.export));
const output = JSON.stringify({
  schema: "aukora-convex-public-surface-v1",
  note: "Inventory only; inclusion is not a security approval.",
  publicFunctions: functions,
}, null, 2) + "\n";

if (process.argv.includes("--check")) {
  if (readFileSync(outputPath, "utf8") !== output) throw new Error("Convex public-surface inventory is stale");
  console.log(`Convex public surface: PASS (${functions.length} functions)`);
} else {
  process.stdout.write(output);
}
