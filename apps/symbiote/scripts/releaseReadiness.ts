#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Eagle Eye (#86): `bun run release-check` — a repeatable REHEARSAL of the public-release pipeline.
//
// It stages a FIXTURE export (never the owner --final path), runs the TIER-1 secret scan + the
// friend-share audit ON THE EXPORTED TREE, verifies excluded paths are absent and the history is a
// single fresh root, then prints one READY / NOT-READY verdict via the pure core. It writes only to a
// throwaway temp dir (symlink-free) and cleans up. It publishes nothing and never runs the owner
// --final export. Read-only against the repo.

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import { join, resolve } from 'path';
import { evaluateReadiness, type ReadinessChecks } from './releaseReadinessCore';

const REPO = resolve(import.meta.dir, '..');
function run(cmd: string, args: string[], cwd = REPO): { ok: boolean; out: string } {
  try { return { ok: true, out: execFileSync(cmd, args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (e) { const err = e as { stdout?: string; stderr?: string }; return { ok: false, out: (err.stdout ?? '') + (err.stderr ?? '') }; }
}

function main(): void {
  // symlink-free temp base (macOS /tmp and /var are symlinks; the export refuses symlinked dests).
  const base = fs.realpathSync(os.tmpdir());
  const dest = join(base, `aukora-release-check-${Date.now()}`);
  const checks: Partial<ReadinessChecks> = {};
  try {
    // 1. stage a fixture export with a fresh single-root git history.
    const exp = run(process.execPath, ['scripts/releaseExport.ts', '--fixture', `--out=${dest}`, '--git']);
    checks.exportWrote = exp.ok && fs.existsSync(join(dest, 'RELEASE_MANIFEST.sha256'));
    if (!checks.exportWrote) { console.error('release-check: export did not stage —\n' + exp.out.split('\n').slice(-4).join('\n')); }

    if (checks.exportWrote) {
      // 2. TIER-1 secret scan ON THE EXPORTED TREE (the artifact must be clean even if source is red).
      checks.exportScanClean = run('bash', ['scripts/scan-secrets.sh'], dest).ok;
      // 3. excluded private/lab/coordination paths absent from the artifact.
      const mustBeAbsent = ['docs/NEBIUS_LAB_FINDINGS.md', 'docs/mesh/handoff/EAGLE_EYE.md', 'docs/CODEX_CHANNEL.md', 'scripts/scan-vectors.local.sh', '.git/../docs/mesh'];
      checks.excludedPathsAbsent = ['docs/NEBIUS_LAB_FINDINGS.md', 'docs/mesh', 'docs/CODEX_CHANNEL.md', 'scripts/scan-vectors.local.sh']
        .every((p) => !fs.existsSync(join(dest, p)));
      void mustBeAbsent;
      // 4. friend-share audit on the exported tree (both HEAD and history must read clean now).
      const fsa = run(process.execPath, ['scripts/friendShareAudit.ts'], dest);
      checks.friendShareHeadClean = /HEAD \/ GitHub ZIP: CLEAN/i.test(fsa.out) || fsa.ok;
      checks.friendShareHistoryClean = /clone \/ full history: CLEAN/i.test(fsa.out) || fsa.ok;
      // 5. fresh history is a single root commit.
      const log = run('git', ['-C', dest, 'log', '--oneline']);
      checks.freshHistoryOneRoot = log.ok && log.out.trim().split('\n').filter(Boolean).length === 1;
    }
    // 6. LICENSE present (source-level, quick).
    checks.licensePresent = fs.existsSync(join(REPO, 'LICENSE'));
    // 7. SECURITY.md contact filled (placeholder gone).
    checks.securityContactFilled = (() => {
      try { return !/<OWNER-FILL:/.test(fs.readFileSync(join(REPO, 'SECURITY.md'), 'utf-8')); } catch { return false; }
    })();
  } finally {
    try { fs.rmSync(dest, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  }

  const verdict = evaluateReadiness({
    exportWrote: !!checks.exportWrote, exportScanClean: !!checks.exportScanClean,
    excludedPathsAbsent: !!checks.excludedPathsAbsent, friendShareHeadClean: !!checks.friendShareHeadClean,
    friendShareHistoryClean: !!checks.friendShareHistoryClean, freshHistoryOneRoot: !!checks.freshHistoryOneRoot,
    licensePresent: !!checks.licensePresent, securityContactFilled: !!checks.securityContactFilled,
  });
  console.log(verdict.report);
  console.log('\n(rehearsal only — nothing was published; the certified artifact is the owner --final export.)');
  process.exit(verdict.pipelineSound ? 0 : 1); // owner items do NOT fail the check — only a pipeline fault does
}

if (/releaseReadiness\.ts$/.test(process.argv[1] ?? '')) main();
