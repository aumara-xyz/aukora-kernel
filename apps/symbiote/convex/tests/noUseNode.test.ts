// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * S1a GATE (a) — NO "use node" anywhere in the vendored kernel slice. Every vendored module must run in the
 * default Convex isolate (V8 runtime); a "use node" directive would silently move a module to the Node.js
 * action runtime, widening the attack/dependency surface the S1a ratification excluded. Scans real files on
 * disk (fs), not a bundler view, so a stray file that no test imports still trips the gate.
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

// The directive is a QUOTED string literal ('use node' / "use node"); a raw substring scan would false-positive
// on prose like "reuse node_revocations" (popResolver.ts). Matching the quoted literal ANYWHERE in the file is
// still strictly wider than Convex's real trigger (a directive prologue at the top of the file) — no escape hatch.
const USE_NODE_DIRECTIVE = /['"]use node['"]/;

describe('S1a gate — no "use node" in the vendored slice', () => {
  it("no .ts file under convex/ (excluding node_modules, _generated, tests) contains the directive", () => {
    const files = listTsFiles(CONVEX_DIR);
    expect(files.length).toBeGreaterThan(10); // sanity: the walk actually found the vendored modules
    const offenders = files.filter((p) => USE_NODE_DIRECTIVE.test(readFileSync(p, "utf8"))).map((p) => relative(CONVEX_DIR, p));
    expect(offenders).toEqual([]);
  });
});
