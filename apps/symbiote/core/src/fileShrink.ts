// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Shared #91 file-shrink / truncation detector. A proposal that replaces an EXISTING repo file with
 * substantially smaller content (the class of defect the first #35 rehearsal surfaced — a 362-line doc
 * proposed back as 27 lines) is the highest-consequence, easiest-to-miss failure of a full-file-replacement
 * apply lane. This one module computes the before/after line + byte counts and the shrink verdict so both
 * surfaces that warn about it — the AUMLOK signing assistant (sign-time) and the workbench evidence packet
 * (run-time) — use the SAME logic, never two drifting copies.
 *
 * Reads the LIVE repo file's SIZE only (line/byte counts), never returns its content, and refuses to read
 * an unsafe/out-of-repo relPath — so it exposes no file content and cannot escape the repo.
 */
import * as fs from 'fs';
import * as path from 'path';
import { isSafeRelPath } from './sandboxApply';

// The shrink verdict fires if ANY of three rules trips (an OR, so a large file that keeps >50% but still
// loses hundreds of lines is NOT missed — the gap an adversarial review found: 500→300 kept 60% and slipped
// through the fraction-only test). Rule 1 = severe fractional shrink on any file; rule 2 = a large ABSOLUTE
// deletion regardless of fraction (the "comment-only change that deletes hundreds of lines" class); rule 3 =
// a moderate fractional + moderate absolute drop.
export const SHRINK_LINE_FRACTION = 0.5;        // rule 1: proposed ≤ 50% of the original line count …
export const SHRINK_MIN_DELETED_LINES = 20;     // … AND ≥ this many lines dropped → warn
export const SHRINK_ABS_DELETED_LINES = 100;    // rule 2: ANY file that loses ≥ this many lines → warn
export const SHRINK_MODERATE_FRACTION = 0.75;   // rule 3: proposed ≤ 75% of the original …
export const SHRINK_MODERATE_DELETED = 50;      // … AND ≥ this many lines dropped → warn

export interface FileShrinkResult {
  relPath: string;
  existsInRepo: boolean;
  beforeLines: number | null; // null = new file (or an unsafe path we refused to read)
  afterLines: number;
  beforeBytes: number | null;
  afterBytes: number;
  netLineDelta: number | null; // after - before
  netByteDelta: number | null;
  shrinkWarning: boolean; // an existing file replaced by substantially smaller content
}

/** The repo root, from this module's own location (core/src/..  ->  repo root). */
export function defaultRepoRoot(): string {
  return path.resolve(__dirname, '..', '..');
}

function countLinesBytes(content: string): { lines: number; bytes: number } {
  return { lines: content.length === 0 ? 0 : content.split('\n').length, bytes: Buffer.byteLength(content, 'utf8') };
}

/** Live repo file size ONLY for a safe, in-repo relPath. null for a new/unsafe path. Never returns content. */
function repoFileCounts(repoRoot: string, relPath: string): { lines: number; bytes: number } | null {
  if (!isSafeRelPath(relPath)) return null;
  const abs = path.resolve(repoRoot, relPath);
  if (abs !== repoRoot && !abs.startsWith(repoRoot + path.sep)) return null; // belt: never escape the repo
  try {
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
    return countLinesBytes(fs.readFileSync(abs, 'utf8'));
  } catch {
    return null;
  }
}

/** Compute the shrink verdict for one proposed file against the live repo file. Never throws. */
export function computeFileShrink(repoRoot: string, relPath: string, content: string): FileShrinkResult {
  const after = countLinesBytes(content);
  const before = repoFileCounts(repoRoot, relPath);
  const existsInRepo = before !== null;
  const deleted = existsInRepo ? before!.lines - after.lines : 0;
  const shrinkWarning =
    existsInRepo && (
      (after.lines <= before!.lines * SHRINK_LINE_FRACTION && deleted >= SHRINK_MIN_DELETED_LINES) ||
      deleted >= SHRINK_ABS_DELETED_LINES ||
      (after.lines <= before!.lines * SHRINK_MODERATE_FRACTION && deleted >= SHRINK_MODERATE_DELETED)
    );
  return {
    relPath,
    existsInRepo,
    beforeLines: before?.lines ?? null,
    afterLines: after.lines,
    beforeBytes: before?.bytes ?? null,
    afterBytes: after.bytes,
    netLineDelta: before ? after.lines - before.lines : null,
    netByteDelta: before ? after.bytes - before.bytes : null,
    shrinkWarning,
  };
}

/** Convenience: shrink verdicts for every file in a proposal. */
export function computeProposalShrinks(repoRoot: string, files: Array<{ relPath: string; content: string }>): FileShrinkResult[] {
  return files.map((f) => computeFileShrink(repoRoot, f.relPath, f.content));
}
