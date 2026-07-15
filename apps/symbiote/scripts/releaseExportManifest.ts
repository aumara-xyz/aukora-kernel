// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Eagle Eye (#86): deterministic sanitized release export — the PURE, testable core.
//
// This module contains NO filesystem or git access. It decides, given the tracked-file list and a
// few booleans, exactly which product files go into a public export and which private/research/
// runtime paths are excluded, validates that a destination is safe, and produces a deterministic
// content manifest. All host I/O lives in scripts/releaseExport.ts.
//
// Nothing here reads file CONTENTS except the caller-supplied bytes it must hash for the manifest;
// it never emits values — the exclusion report is path/category/count only.

import { createHash } from 'crypto';

// ── the reviewed exclusion manifest (Codex reviews this list) ─────────────────────────────────────
// Every rule names WHY a path is private. Product code/docs that match none of these are exported.
export interface ExclusionRule { category: string; why: string; match: (p: string) => boolean }

const nebius = (p: string) => /(^|\/)nebius[^/]*\.md$/i.test(p) || /NEBIUS/.test(p);
export const EXCLUSION_RULES: ExclusionRule[] = [
  { category: 'history', why: 'git history is rebuilt fresh; source .git is never copied',
    match: (p) => p === '.git' || p.startsWith('.git/') },
  { category: 'research-lab', why: 'GHP / Nebius research and probe material — not part of the product export',
    match: (p) => p.startsWith('GHP/') || p.startsWith('dojobrain/') || p.startsWith('probes/') ||
      p.startsWith('docs/GHP_') || (p.startsWith('docs/') && nebius(p)) ||
      p === 'convex/dojo.ts' || p === 'convex/tests/dojo.test.ts' || p === 'scripts/agoraSnapshot.sh' },
  { category: 'lane-coordination', why: 'internal lane handoff logs + round snapshots + codex channel/agent operating docs',
    // docs/CODEX_* as a prefix (not just CHANNEL): CODEX_MEGA_PROMPT.md and CODEX_START_HERE.md are
    // internal agent-operations docs (#319 §2D). Over-excluding a future CODEX_* doc is the safe
    // failure mode for a sanitized export; under-excluding leaks internal ops.
    match: (p) => p.startsWith('docs/mesh/') || p.startsWith('docs/CODEX_') },
  { category: 'visitor-data', why: 'real visitor PII (chats + waitlist); only *.example.json ships',
    match: (p) => (/^lander\/data\/chats\/.+\.json$/.test(p) && !/\.example\.json$/.test(p)) || p === 'lander/data/waitlist.jsonl' },
  { category: 'owner-private', why: "owner's local scan vectors / any *.local.* — never ships",
    match: (p) => p === 'scripts/scan-vectors.local.sh' || /\.local\.[^/]+$/.test(p) },
  { category: 'runtime-state', why: 'local node state / lab-only artifacts (defense-in-depth)',
    match: (p) => p === 'state' || p.startsWith('state/') || p === 'lab_only' || p.startsWith('lab_only/') },
];

export interface Excluded { path: string; category: string }
export interface ExportPlan { include: string[]; exclude: Excluded[] }

/** Pure: split the tracked set into exported product files vs categorized exclusions (sorted). */
export function classifyForExport(trackedPaths: string[]): ExportPlan {
  const include: string[] = [];
  const exclude: Excluded[] = [];
  for (const raw of trackedPaths) {
    const p = raw.trim().replace(/^\.\//, '');
    if (!p) continue;
    const rule = EXCLUSION_RULES.find((r) => r.match(p));
    if (rule) exclude.push({ path: p, category: rule.category });
    else include.push(p);
  }
  include.sort();
  exclude.sort((a, b) => (a.category === b.category ? a.path.localeCompare(b.path) : a.category.localeCompare(b.category)));
  return { include, exclude };
}

/** Pure: path/category/count report (no contents, no private values). */
export function renderExclusionReport(exclude: Excluded[]): string {
  const byCat = new Map<string, string[]>();
  for (const e of exclude) (byCat.get(e.category) ?? byCat.set(e.category, []).get(e.category)!).push(e.path);
  const lines = [`EXPORT EXCLUSIONS — ${exclude.length} path(s) held back from the public artifact`];
  for (const [cat, paths] of [...byCat.entries()].sort()) {
    const why = EXCLUSION_RULES.find((r) => r.category === cat)?.why ?? '';
    lines.push(`  · ${cat} (${paths.length}) — ${why}`);
    for (const p of paths.sort()) lines.push(`      ${p}`);
  }
  return lines.join('\n');
}

// ── destination safety (refuse anything unsafe) ───────────────────────────────────────────────────
export interface DestFacts {
  destInsideSource: boolean;   // dest is within the source repo tree
  destExists: boolean;
  destNonEmpty: boolean;       // dest exists and is a non-empty directory
  destIsSymlink: boolean;      // dest (or a component) is a symlink
  sourceDirty: boolean;        // uncommitted changes in the source
  dryRun: boolean;
}
export type DestVerdict = { ok: true } | { ok: false; reason: string };

/** Pure: a real export writes ONLY to a fresh directory outside the source; everything else refuses. */
export function validateDestination(f: DestFacts): DestVerdict {
  if (f.destInsideSource) return { ok: false, reason: 'destination is inside the source repo — choose a NEW directory outside it' };
  if (f.destIsSymlink) return { ok: false, reason: 'destination path contains a symlink — refused (escape risk)' };
  if (f.destExists) return { ok: false, reason: 'destination already exists — choose a brand-new directory' };
  if (f.sourceDirty && !f.dryRun) return { ok: false, reason: 'source tree has uncommitted changes — commit/stash, or pass --dry-run' };
  return { ok: true };
}

// ── determinism: pinned metadata + content manifest ───────────────────────────────────────────────
export const PINNED_MTIME_MS = Date.UTC(2020, 0, 1, 0, 0, 0); // fixed so archives never vary by clock
/** Executables ship 0755, everything else 0644 — normalized, cross-platform, deterministic. */
export function exportMode(path: string, gitExecutable: boolean): number {
  return gitExecutable || /\.(sh|command)$/.test(path) ? 0o755 : 0o644;
}

/** Pure: the deterministic manifest — one `sha256␠␠path` line per file, sorted by path. Identical
 *  inputs (any order) ⇒ identical output ⇒ identical manifest hash across repeated exports. */
export function computeManifest(files: { path: string; content: Uint8Array | string }[]): string {
  const lines = files
    .map((f) => `${createHash('sha256').update(f.content).digest('hex')}  ${f.path.trim().replace(/^\.\//, '')}`)
    .sort();
  return lines.join('\n') + '\n';
}
export function manifestHash(manifest: string): string {
  return createHash('sha256').update(manifest).digest('hex');
}

// ── final-mode gate: never certify a "clean" final artifact without the owner's scan vectors ──────
export type ExportMode = 'dry-run' | 'fixture' | 'final';
export function finalModeAllowed(mode: ExportMode, ownerVectorsPresent: boolean): DestVerdict {
  if (mode === 'final' && !ownerVectorsPresent) {
    return { ok: false, reason: 'final export requires the owner-private scan vectors to certify clean; run --dry-run or --fixture instead (a non-owner node must not claim the final artifact is clean)' };
  }
  return { ok: true };
}
