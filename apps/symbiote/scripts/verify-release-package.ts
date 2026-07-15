#!/usr/bin/env bun
// Release packaging guard: every browser module imported by the Spatial shell must
// exist and be tracked. This catches the "works locally because an untracked file
// exists, breaks in a fresh clone" class before a handoff.

import { existsSync } from 'fs';
import { join, resolve } from 'path';

const repo = resolve(import.meta.dir, '..');
const shell = join(repo, 'spatial', 'app', 'shell.js');
const text = await Bun.file(shell).text();

const imports = [...text.matchAll(/from\s+['"]\/app\/([^'"]+)['"]/g)]
  .map((m) => `spatial/app/${m[1]}`)
  .sort();

const missing: string[] = [];
const untracked: string[] = [];

for (const rel of imports) {
  const abs = join(repo, rel);
  if (!existsSync(abs)) {
    missing.push(rel);
    continue;
  }
  const tracked = Bun.spawnSync(['git', 'ls-files', '--error-unmatch', rel], {
    cwd: repo,
    stdout: 'ignore',
    stderr: 'ignore',
  }).exitCode === 0;
  if (!tracked) untracked.push(rel);
}

if (missing.length || untracked.length) {
  console.error('Release package guard failed: Spatial shell imports modules a fresh clone will not have.');
  for (const rel of missing) console.error(`  missing:   ${rel}`);
  for (const rel of untracked) console.error(`  untracked: ${rel}`);
  process.exit(1);
}

console.log(`OK: Spatial shell imports ${imports.length} tracked app module(s).`);
