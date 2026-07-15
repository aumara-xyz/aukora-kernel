#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Eagle Eye (#86): deterministic sanitized release export — the CLI.
//
//   bun scripts/releaseExport.ts --dry-run                 # plan only, write nothing (safe default)
//   bun scripts/releaseExport.ts --fixture --out=<newdir>  # write a sanitized export (synthetic-safe)
//   bun scripts/releaseExport.ts --final   --out=<newdir> [--git]   # owner-only; needs local scan vectors
//
// Reads ONLY tracked current-tree files from the source (never .git history). Writes ONLY to an
// explicit NEW directory OUTSIDE the source. Never pushes, publishes, tags, or rewrites the repo.
// Excludes private/research/runtime lanes per the reviewed manifest. Deterministic: pinned modes +
// mtime + sorted content manifest. `--git` builds a fresh one-root-commit tree (no old history).

import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import { join, dirname, resolve, sep, parse, relative } from 'path';
import {
  classifyForExport, renderExclusionReport, validateDestination, finalModeAllowed,
  computeManifest, manifestHash, exportMode, PINNED_MTIME_MS, type ExportMode,
} from './releaseExportManifest';

const REPO = resolve(import.meta.dir, '..');
const arg = (name: string) => process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const val = (name: string) => arg(name)?.split('=')[1];

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf-8' });
}
function trackedFiles(): string[] {
  return git(['ls-files']).split('\n').map((s) => s.trim()).filter(Boolean);
}
function executableSet(): Set<string> {
  // git stores mode 100755 for executables — the deterministic, cross-platform source of truth.
  const set = new Set<string>();
  for (const line of git(['ls-files', '-s']).split('\n')) {
    const m = /^(\d{6})\s+[0-9a-f]+\s+\d+\s+(.+)$/.exec(line.trim());
    if (m && m[1] === '100755') set.add(m[2]);
  }
  return set;
}
function sourceDirty(): boolean {
  try { return git(['status', '--porcelain']).trim().length > 0; } catch { return true; }
}
function pathHasSymlink(abs: string): boolean {
  const root = parse(abs).root;
  const parts = relative(root, abs).split(sep).filter(Boolean);
  let cursor = root;
  for (const part of parts) {
    cursor = join(cursor, part);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') break;
      return true; // inaccessible path components are not safe export destinations
    }
  }
  return false;
}
function destFacts(out: string, dryRun: boolean) {
  const abs = resolve(out);
  const destExists = fs.existsSync(abs);
  let destNonEmpty = false;
  try { destNonEmpty = destExists && fs.readdirSync(abs).length > 0; } catch { destNonEmpty = true; }
  const destInsideSource = (abs + sep).startsWith(REPO + sep) || abs === REPO;
  return { destInsideSource, destExists, destNonEmpty, destIsSymlink: pathHasSymlink(abs), sourceDirty: sourceDirty(), dryRun };
}
function refuse(reason: string): never { console.error(`RELEASE EXPORT — REFUSED: ${reason}`); process.exit(1); }

function readIncludedFiles(paths: string[]): Array<{ path: string; content: Buffer }> {
  return paths.map((p) => {
    const full = resolve(REPO, p);
    if (full !== REPO && !(full + sep).startsWith(REPO + sep)) refuse(`tracked path escaped source root: ${p}`);
    let st: fs.Stats;
    try { st = fs.lstatSync(full); } catch { refuse(`tracked path is missing from source: ${p}`); }
    if (!st.isFile() || st.isSymbolicLink()) refuse(`tracked path is not a regular file: ${p}`);
    return { path: p, content: fs.readFileSync(full) };
  });
}

function verifyFinalExport(stage: string, vectorFile: string): void {
  const result = spawnSync('bash', ['scripts/verify-public-readiness.sh'], {
    cwd: stage,
    env: { ...process.env, AUKORA_PUBLIC_READINESS_ALLOW_FIND: '1', AUKORA_SCAN_VECTORS_FILE: vectorFile },
    encoding: 'utf-8',
  });
  if (result.status !== 0 || result.error) throw new Error('owner-vector public-readiness scan failed on staged export');
}

function main(): void {
  const mode: ExportMode = arg('final') ? 'final' : arg('fixture') ? 'fixture' : 'dry-run';
  const out = val('out');
  const withGit = !!arg('git');
  const ownerVectorsPresent = fs.existsSync(join(REPO, 'scripts', 'scan-vectors.local.sh'));

  // Guardrails that apply before any write.
  if (arg('push') || arg('publish')) refuse('publishing/pushing is out of scope for this command');
  const fm = finalModeAllowed(mode, ownerVectorsPresent);
  if (!fm.ok) refuse(fm.reason);

  const tracked = trackedFiles();
  const execSet = executableSet();
  const plan = classifyForExport(tracked);

  // Manifest we WOULD produce (computed from source bytes; identical run-to-run).
  const files = readIncludedFiles(plan.include);
  const manifest = computeManifest(files);
  const mhash = manifestHash(manifest);

  console.log(`RELEASE EXPORT — mode=${mode}${withGit ? ' +git' : ''}`);
  console.log(renderExclusionReport(plan.exclude));
  console.log(`\nINCLUDE: ${plan.include.length} product file(s) · EXCLUDE: ${plan.exclude.length}`);
  console.log(`MANIFEST sha256: ${mhash}`);

  if (mode === 'dry-run') {
    console.log('\nDRY RUN — nothing written. Re-run with --fixture/--final and --out=<new dir outside the repo>.');
    process.exit(0);
  }

  if (!out) refuse('--out=<new directory outside the source repo> is required for a real export');
  const df = destFacts(out, false);
  const dv = validateDestination(df);
  if (!dv.ok) refuse(dv.reason);

  const abs = resolve(out);
  const stage = fs.mkdtempSync(join(dirname(abs), '.aukora-export-'));
  try {
    for (const f of files) {
      const target = join(stage, f.path);
      fs.mkdirSync(dirname(target), { recursive: true });
      fs.writeFileSync(target, f.content);
      fs.chmodSync(target, exportMode(f.path, execSet.has(f.path)));
      fs.utimesSync(target, new Date(PINNED_MTIME_MS), new Date(PINNED_MTIME_MS));
    }
    fs.writeFileSync(join(stage, 'RELEASE_MANIFEST.sha256'), manifest);
    fs.writeFileSync(join(stage, 'EXPORT_EXCLUSIONS.txt'), renderExclusionReport(plan.exclude) + '\n');

    const missing = plan.include.filter((p) => !fs.existsSync(join(stage, p)));
    const leaked = plan.exclude.filter((e) => fs.existsSync(join(stage, e.path)));
    if (missing.length || leaked.length) throw new Error(`export self-check failed (missing=${missing.length}, leaked=${leaked.length})`);

    if (withGit) {
      const env = { ...process.env, GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z',
        GIT_AUTHOR_NAME: 'Aumara', GIT_AUTHOR_EMAIL: 'release@aumara.xyz', GIT_COMMITTER_NAME: 'Aumara', GIT_COMMITTER_EMAIL: 'release@aumara.xyz' };
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: stage, env });
      execFileSync('git', ['add', '-A'], { cwd: stage, env });
      execFileSync('git', ['commit', '-q', '-m', 'Aukora Symbiote — sanitized public export (fresh root, no prior history)'], { cwd: stage, env });
    }
    if (mode === 'final') verifyFinalExport(stage, join(REPO, 'scripts', 'scan-vectors.local.sh'));
    fs.renameSync(stage, abs); // same-parent atomic promotion only after every final check passes
  } catch (e) {
    fs.rmSync(stage, { recursive: true, force: true });
    refuse(e instanceof Error ? e.message : String(e));
  }

  console.log(`\nWROTE ${files.length} file(s) to ${abs}  (staged, scanned when final, then atomically promoted)`);
  console.log(withGit ? 'Fresh one-root-commit git tree created — no old history.' : 'Add --git for a fresh no-history tree.');
  console.log('NOT pushed, NOT published. Run scripts/scan-release-archive.sh on any archive before sharing.');
  if (mode === 'fixture') console.log('MODE=fixture — synthetic/dry exercise only; NOT a certified-clean owner artifact.');
  process.exit(0);
}

if (/releaseExport\.ts$/.test(process.argv[1] ?? '')) main();
