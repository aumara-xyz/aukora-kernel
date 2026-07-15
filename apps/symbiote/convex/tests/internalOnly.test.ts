// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * S1a GATE (b) — INTERNAL-ONLY surface (B1): no vendored module may register a PUBLIC Convex function.
 * Public registration happens through the bare builders `mutation(...)` / `query(...)` / `action(...)`
 * (from ./_generated/server); internalMutation/internalQuery/internalAction are the only allowed builders.
 * We scan the real files on disk (fs) so a stray module no test imports still trips the gate:
 *   1. strip block + line comments (a docstring may legitimately SAY "mutation(");
 *   2. match \b(mutation|query|action)\s*( where the word is NOT a property access (`.query(` is ctx.db.query)
 *      and NOT the tail of a longer identifier (internalMutation, httpAction, etc. — case-sensitive);
 *   3. zero matches allowed.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const CONVEX_DIR = join(dirname(fileURLToPath(import.meta.url)), ".."); // tests/ lives inside convex/
const EXCLUDED_DIRS = new Set(["node_modules", "_generated", "tests"]);

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!EXCLUDED_DIRS.has(name)) out.push(...listTsFiles(p));
    } else if (name.endsWith(".ts")) {
      out.push(p);
    }
  }
  return out;
}

const stripComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

// Word must start the expression (not `.query(` member access, not `internalQuery(`/`httpAction(` identifiers).
const PUBLIC_BUILDER = /(^|[^.\w$])(mutation|query|action)\s*\(/g;

describe("S1a gate — every registered function in the vendored slice is internal-only", () => {
  it("no .ts file under convex/ (excluding node_modules, _generated, tests) calls a public builder", () => {
    const files = listTsFiles(CONVEX_DIR);
    expect(files.length).toBeGreaterThan(10); // sanity: the walk actually found the vendored modules
    const offenders: string[] = [];
    for (const p of files) {
      const code = stripComments(readFileSync(p, "utf8"));
      for (const m of code.matchAll(PUBLIC_BUILDER)) {
        offenders.push(`${relative(CONVEX_DIR, p)}: public builder \`${m[2]}(\``);
      }
    }
    expect(offenders).toEqual([]);
  });
});
