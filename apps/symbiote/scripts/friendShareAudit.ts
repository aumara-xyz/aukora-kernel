#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Eagle Eye (#86): friend-share audit — is this repo safe to hand to a friend, and by which route?
//
// TWO SEPARATE, HONEST VERDICTS (a GitHub ZIP and a git clone are different exposure surfaces):
//   • HEAD / ZIP     — what a `Download ZIP` or `git archive` contains = the TRACKED files at HEAD.
//   • clone / history — what a `git clone` exposes = every version in the full history.
// A green HEAD does NOT imply a green history: visitor data removed at HEAD still lives in past
// commits until a clean-history export is produced. This audit reports both, and never conflates them.
//
// Live-data = real visitor PII (lander chats + waitlist). Explicitly-synthetic `*.example.json`
// fixtures are allowed. Pure classification is unit-tested; the CLI shells to git only when run.

import { execFileSync } from 'child_process';

/** A path is live visitor data (real PII) unless it is an explicitly-synthetic .example fixture. */
export function isLiveDataPath(p: string): boolean {
  const path = p.trim().replace(/^\.\//, '');
  if (!path) return false;
  if (/^lander\/data\/chats\/.+\.json$/.test(path)) return !/\.example\.json$/.test(path);
  if (path === 'lander/data/waitlist.jsonl') return true;
  return false;
}

/** Pure: given a list of paths, return the live-data (PII) ones. */
export function classifyLiveDataPaths(paths: string[]): string[] {
  return Array.from(new Set(paths.filter(isLiveDataPath))).sort();
}

export interface AuditVerdicts {
  headClean: boolean;
  historyClean: boolean;
  headHits: string[];
  historyHits: string[];
}

/** Pure verdict builder from the two path lists (tracked-at-HEAD, ever-in-history). */
export function auditFromLists(trackedPaths: string[], historyPaths: string[]): AuditVerdicts {
  const headHits = classifyLiveDataPaths(trackedPaths);
  const historyHits = classifyLiveDataPaths(historyPaths);
  return {
    headHits,
    historyHits,
    headClean: headHits.length === 0,
    historyClean: historyHits.length === 0,
  };
}

// ── CLI (runs only when invoked directly; import for tests stays pure) ────────────────────────────
function gitLines(args: string[]): string[] {
  try {
    return execFileSync('git', args, { encoding: 'utf-8' }).split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function runCli(): void {
  const scope = (process.argv.find((a) => a.startsWith('--scope='))?.split('=')[1] ?? 'both') as 'head' | 'history' | 'both';
  const tracked = gitLines(['ls-files']);
  // Every path ever touched under the live-data globs across ALL history.
  const history = gitLines(['log', '--all', '--pretty=format:', '--name-only',
    '--', 'lander/data/chats', 'lander/data/waitlist.jsonl']);
  const v = auditFromLists(tracked, history);

  const line = (label: string, clean: boolean, hits: string[]) => {
    console.log(`  ${clean ? '✓' : '✗'} ${label}: ${clean ? 'CLEAN' : 'NOT CLEAN'}`);
    if (!clean) for (const h of hits) console.log(`        · ${h}`);
  };
  console.log('FRIEND-SHARE AUDIT — lander visitor data (PII)');
  line('HEAD / GitHub ZIP', v.headClean, v.headHits);
  line('clone / full history', v.historyClean, v.historyHits);
  if (!v.historyClean) {
    console.log('  NOTE: history stays RED until a clean-history export is produced (Eagle Eye round 3).');
  }

  const pass = scope === 'head' ? v.headClean : scope === 'history' ? v.historyClean : (v.headClean && v.historyClean);
  process.exit(pass ? 0 : 1);
}

// Run the CLI only when this file is the invoked entrypoint (bun scripts/friendShareAudit.ts).
// When a test imports it, process.argv[1] is the test runner, so runCli never fires. Avoids
// import.meta (which the core tsconfig's module target rejects), keeping the file tsc-clean.
if (typeof process !== 'undefined' && /friendShareAudit\.ts$/.test(process.argv[1] ?? '')) runCli();
