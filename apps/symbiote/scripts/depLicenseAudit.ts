#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Eagle Eye (#86): dependency-license compatibility audit for the AGPL-3.0-or-later choice.
//
//   bun scripts/depLicenseAudit.ts
//
// Walks installed node_modules across the workspaces and classifies each dependency's DECLARED license
// against AGPL-3.0-or-later. Honest limitation (printed): this reads the `license` field of each package's
// manifest — it is a first-pass signal, not a full legal license-file audit. Nothing here changes code or
// publishes; it prints counts + the exact packages a human must review. Exit is non-zero only if a known
// INCOMPATIBLE license is found (a `review` list never fails the command — it is a worklist).

import * as fs from 'fs';
import { join, resolve } from 'path';
import { classifyDependencyLicense, type DepVerdict } from './licensePosture';

const REPO = resolve(import.meta.dir, '..');
const ROOTS = ['core/node_modules', 'convex/node_modules', 'node_modules', 'memory/embedder/node_modules'];

function declaredLicense(pkg: Record<string, unknown>): string {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license === 'object' && typeof (pkg.license as { type?: unknown }).type === 'string') {
    return (pkg.license as { type: string }).type; // legacy {type,url}
  }
  if (Array.isArray(pkg.licenses) && pkg.licenses[0]?.type) return String(pkg.licenses[0].type);
  return '';
}

function walkNodeModules(root: string, seen: Map<string, string>): void {
  let entries: string[] = [];
  try { entries = fs.readdirSync(root); } catch { return; }
  for (const e of entries) {
    if (e === '.bin') continue;
    const dir = join(root, e);
    if (e.startsWith('@')) { // scope dir → recurse one level
      try { for (const sub of fs.readdirSync(dir)) recordPkg(join(dir, sub), `${e}/${sub}`, seen); } catch { /* skip */ }
    } else {
      recordPkg(dir, e, seen);
    }
    const nested = join(dir, 'node_modules');
    if (fs.existsSync(nested)) walkNodeModules(nested, seen);
  }
}
function recordPkg(dir: string, name: string, seen: Map<string, string>): void {
  if (seen.has(name)) return;
  try {
    const pkg = JSON.parse(fs.readFileSync(join(dir, 'package.json'), 'utf-8'));
    seen.set(name, declaredLicense(pkg));
  } catch { /* not a package dir */ }
}

function main(): void {
  const seen = new Map<string, string>();
  for (const r of ROOTS) walkNodeModules(join(REPO, r), seen);

  const buckets: Record<DepVerdict, string[]> = { compatible: [], review: [], incompatible: [] };
  for (const [name, lic] of seen) buckets[classifyDependencyLicense(lic)].push(`${name} (${lic || 'undeclared'})`);

  console.log(`DEPENDENCY-LICENSE AUDIT vs AGPL-3.0-or-later — ${seen.size} installed package(s)`);
  console.log(`  compatible:   ${buckets.compatible.length}`);
  console.log(`  review:       ${buckets.review.length}`);
  console.log(`  INCOMPATIBLE: ${buckets.incompatible.length}`);
  if (buckets.incompatible.length) {
    console.log('\nINCOMPATIBLE (must be resolved before public release):');
    for (const p of buckets.incompatible.sort()) console.log(`  ✗ ${p}`);
  }
  if (buckets.review.length) {
    console.log('\nREVIEW (undeclared/unknown/custom — a human should confirm):');
    for (const p of buckets.review.sort().slice(0, 60)) console.log(`  ? ${p}`);
    if (buckets.review.length > 60) console.log(`  … and ${buckets.review.length - 60} more`);
  }
  console.log('\nNote: first-pass audit of DECLARED license fields — not a full license-file review. Advisory.');
  process.exit(buckets.incompatible.length ? 1 : 0);
}

if (/depLicenseAudit\.ts$/.test(process.argv[1] ?? '')) main();
