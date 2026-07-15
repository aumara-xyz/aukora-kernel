// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
//
// Fu canonical-parity guard (R25). apps/fu is a deliberately self-contained, standalone-extractable
// vendored snapshot: it keeps BYTE-IDENTICAL copies of the canonical Fu primitives rather than importing
// them across the app boundary (a cross-boundary `export * from '../../../src/...'` typechecks in-repo but
// would break the app's ability to build/test/publish in isolation — see R25 Lane A findings). Vendoring
// is therefore the accepted design, and this script is the safety that vendoring otherwise lacks: it fails
// LOUDLY the moment an apps/fu copy drifts from its root canonical, so a duplicate can never silently fork.
//
// It also catches a NEW canonical file added under src/evidence or src/council that was not mirrored into
// apps/fu (missing twin), and an apps/fu evidence file with no canonical parent (orphan). Run in root CI.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = path.resolve(import.meta.dirname, "..");
const sha = (abs) => crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
const rel = (abs) => path.relative(root, abs).split(path.sep).join("/");

// (appCopy, rootCanonical) pairs. The 7 EvidencePack files are derived from the canonical dir so a new
// canonical evidence file is caught automatically; the 3 flat council/glyph/ledger copies are explicit
// because apps/fu flattens them (apps/fu/src/aukoraFuX.ts) relative to the nested canonical (src/council/).
const pairs = [];

const evidenceCanonicalDir = path.join(root, "src/evidence");
for (const name of fs.readdirSync(evidenceCanonicalDir).sort()) {
  if (!name.endsWith(".ts")) continue;
  pairs.push({
    app: path.join(root, "apps/fu/src/evidence", name),
    canonical: path.join(evidenceCanonicalDir, name),
  });
}

for (const base of ["aukoraFuCouncil.ts", "aukoraFuGlyph.ts", "aukoraFuSpendLedger.ts"]) {
  pairs.push({
    app: path.join(root, "apps/fu/src", base),
    canonical: path.join(root, "src/council", base),
  });
}

// Orphan check: every apps/fu evidence copy must have a canonical parent.
const appEvidenceDir = path.join(root, "apps/fu/src/evidence");
const canonicalEvidenceNames = new Set(fs.readdirSync(evidenceCanonicalDir).filter((n) => n.endsWith(".ts")));
const orphans = fs
  .readdirSync(appEvidenceDir)
  .filter((n) => n.endsWith(".ts") && !canonicalEvidenceNames.has(n))
  .map((n) => `apps/fu/src/evidence/${n}`);

const problems = [];
for (const { app, canonical } of pairs) {
  if (!fs.existsSync(canonical)) { problems.push(`missing canonical: ${rel(canonical)}`); continue; }
  if (!fs.existsSync(app)) { problems.push(`missing vendored copy: ${rel(app)} (canonical ${rel(canonical)} exists)`); continue; }
  const a = sha(app), c = sha(canonical);
  if (a !== c) problems.push(`DRIFT: ${rel(app)} (${a.slice(0, 12)}) != ${rel(canonical)} (${c.slice(0, 12)})`);
}
for (const o of orphans) problems.push(`orphan vendored evidence file with no canonical parent: ${o}`);

if (problems.length) {
  console.error("Fu canonical parity: FAILED");
  for (const p of problems) console.error(`- ${p}`);
  console.error(`\nEither re-sync the apps/fu copy to its root canonical, or (if the divergence is intended)`);
  console.error(`update this guard and record the delta — never let a vendored duplicate fork silently.`);
  process.exit(1);
}

console.log(`Fu canonical parity: verified (${pairs.length} vendored copies byte-identical to their root canonical)`);
