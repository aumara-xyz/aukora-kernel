// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
//
// #78 ring-table coverage checker (decision-material verifier, grants no authority).
// Proves the DRAFT ring table classifies every git-tracked file into exactly one ring.
// Run from the repo root:  node docs/policy-rings/check-ring-coverage.mjs
// Exits non-zero on any unmatched file, same-specificity ring conflict, or dead rule.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tablePath = process.argv[2] ?? join(here, 'ring-table.json');
const table = JSON.parse(readFileSync(tablePath, 'utf8')).rules;
const files = execSync('git ls-files', { encoding: 'utf8' }).trim().split('\n');

// Precedence: exact file beats any glob; deeper directory globs beat shallower;
// dir/* (direct children) beats dir/** at the same directory.
function specificity(rule, file) {
  const g = rule.glob;
  if (g.endsWith('/**')) {
    const dir = g.slice(0, -3);
    return file.startsWith(dir + '/') ? dir.split('/').length * 100 : -1;
  }
  if (g.endsWith('/*')) {
    const dir = g.slice(0, -2);
    return file.startsWith(dir + '/') && !file.slice(dir.length + 1).includes('/')
      ? dir.split('/').length * 100 + 50
      : -1;
  }
  return g === file ? 1e9 : -1;
}

const unmatched = [];
const conflicts = [];
const perRing = {};
for (const f of files) {
  let best = -1;
  let winners = [];
  for (const r of table) {
    const s = specificity(r, f);
    if (s < 0) continue;
    if (s > best) { best = s; winners = [r]; }
    else if (s === best) winners.push(r);
  }
  if (best < 0) { unmatched.push(f); continue; }
  if (new Set(winners.map(r => r.ring)).size > 1) {
    conflicts.push({ file: f, rules: winners.map(r => `${r.glob}=>R${r.ring}`) });
  }
  perRing[winners[0].ring] = (perRing[winners[0].ring] ?? 0) + 1;
}
// reserved:true rules pin rings for files that do not exist yet (e.g. the future
// core/src/policyKernel.ts) — they are exempt from the dead-rule check.
const dead = table.filter(r => !r.reserved && !files.some(f => specificity(r, f) >= 0));

console.log(`tracked files: ${files.length}`);
console.log(`per-ring counts: ${JSON.stringify(perRing)}`);
console.log(`unmatched: ${unmatched.length}`);
unmatched.forEach(f => console.log(`  ${f}`));
console.log(`same-specificity ring conflicts: ${conflicts.length}`);
conflicts.forEach(c => console.log(`  ${c.file} :: ${c.rules.join(' | ')}`));
console.log(`dead rules (match nothing): ${dead.length}`);
dead.forEach(r => console.log(`  ${r.glob}`));

if (unmatched.length || conflicts.length || dead.length) {
  console.error('FAIL: ring table does not cleanly cover the tracked tree.');
  process.exit(1);
}
console.log('OK: every tracked file matches exactly one ring rule.');
