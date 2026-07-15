// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Proposal DIFF PREVIEW (#105 read layer) — the honest "what am I about to sign?" view.
 *
 * A pending proposal artifact carries each file's FULL new content. To let the owner SEE what a change does
 * without a terminal, this computes a bounded line-level diff between the CURRENT disk file and the proposed
 * content. It is strictly READ-ONLY and grants nothing: it reads the live file through the SAME #75-confined
 * resolver read_file uses (symlink-denied, realpath-confined, sensitive/secret-path REFUSED), bounds the
 * output, and runs the forbidden-content scanner over every emitted line so a secret-shaped string can never
 * reach the browser via a preview. It never writes, signs, or applies.
 *
 * The diff is a prefix/suffix trim: identical leading and trailing lines are dropped, and the changed middle
 * is shown as removed ('-') and added ('+') lines with a few context (' ') lines on each side. This is
 * exact for the common case (a small change inside a large file — a comment above a constant) and always
 * bounded, so a huge file never floods the response.
 */
import { resolveRepoReadPath, sensitiveReason } from './repoReadPathResolver';
import { isSafeRelPath } from './sandboxApply';
import { scanForbiddenValues } from './forbiddenContent';
import { lineHasSecretContent } from './changeRiskClassifier';
import * as fs from 'fs';
import * as path from 'path';

export interface ProposalPreview {
  relPath: string;
  isNewFile: boolean;         // the target does not exist on disk (whole file is added)
  hunk: string;               // the bounded, secret-scanned unified-style preview text ('' if nothing to show)
  addedLines: number;
  removedLines: number;
  truncated: boolean;         // the diff was larger than the bound and was cut
  secretRedacted: boolean;    // at least one line was withheld because it scanned as forbidden/secret-shaped
  refusedReason: string | null; // the disk read was refused (e.g. sensitive path) — no preview, but say why
}

const MAX_PREVIEW_LINES = 120;      // hard cap on emitted diff lines
const MAX_PREVIEW_CHARS = 8_000;    // hard cap on emitted characters
const CONTEXT_LINES = 3;            // context lines kept around the changed region

function splitLines(s: string): string[] {
  // drop a single trailing newline's empty element so counts read naturally
  const parts = s.split('\n');
  if (parts.length && parts[parts.length - 1] === '' && s.endsWith('\n')) parts.pop();
  return parts;
}

/** True iff a single line scans as forbidden/secret-shaped (so the preview withholds it). Uses BOTH secret
 *  detectors the project trusts: forbiddenContent's FORBIDDEN_VALUE_RE (PEM, sk-, hex runs, hosts…) AND
 *  changeRiskClassifier's SECRET_CONTENT_PATTERNS (AWS/GitHub/Slack tokens, hardcoded credentials). Using
 *  only the first missed the latter class — an adversarial-review find (2026-07-06); the union closes it. */
function lineIsForbidden(line: string): boolean {
  return lineHasSecretContent(line) || scanForbiddenValues({ v: line }).length > 0;
}

/**
 * Compute the bounded, secret-scanned preview for one proposed file. repoRoot + the CONFINED resolver mean a
 * sensitive/secret target refuses (no preview, reason stated) rather than leaking. Never throws.
 */
export function computeProposalPreview(repoRoot: string, relPath: string, proposedContent: string): ProposalPreview {
  const base: ProposalPreview = {
    relPath, isNewFile: false, hunk: '', addedLines: 0, removedLines: 0,
    truncated: false, secretRedacted: false, refusedReason: null,
  };

  // Path safety is separated from existence: a SAFE, in-repo path that does not yet exist is a legitimate
  // NEW file (whole proposed content is "added"); only a lexically-unsafe or escaping path refuses. An
  // EXISTING file is read through the FULL #75-confined resolver (which additionally refuses sensitive/
  // symlinked targets) — so an existing secret/sensitive file is never previewed.
  if (!isSafeRelPath(relPath)) return { ...base, refusedReason: `unsafe path (lexical): ${relPath}` };
  // Sensitive/secret/authority-shaped paths refuse REGARDLESS of whether the file exists — a proposal that
  // adds a NEW file at such a path must never have its content previewed (defense in depth alongside the
  // upstream sacred-path refusal in propose_patch and the per-line secret scan below).
  const sens = sensitiveReason(relPath);
  if (sens) return { ...base, refusedReason: `sensitive path refused: ${sens}` };
  const abs = path.resolve(repoRoot, relPath);
  const rootAbs = path.resolve(repoRoot);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return { ...base, refusedReason: `path escapes repo root: ${relPath}` };

  let diskContent = '';
  let isNewFile = false;
  if (fs.existsSync(abs)) {
    const resolved = resolveRepoReadPath(relPath, { root: repoRoot });
    if (!resolved.ok) return { ...base, refusedReason: resolved.reason }; // sensitive/symlink → refuse, leak nothing
    try {
      if (fs.statSync(resolved.real).isFile()) diskContent = fs.readFileSync(resolved.real, 'utf-8');
      else return { ...base, refusedReason: `diff target is not a file: ${relPath}` };
    } catch { return { ...base, refusedReason: `diff target unreadable: ${relPath}` }; }
  } else {
    isNewFile = true; // safe, in-repo, not-yet-existing → new file
  }

  const oldLines = isNewFile ? [] : splitLines(diskContent);
  const newLines = splitLines(proposedContent);

  // prefix/suffix trim to isolate the changed middle
  let p = 0;
  while (p < oldLines.length && p < newLines.length && oldLines[p] === newLines[p]) p++;
  let sOld = oldLines.length;
  let sNew = newLines.length;
  while (sOld > p && sNew > p && oldLines[sOld - 1] === newLines[sNew - 1]) { sOld--; sNew--; }

  const removed = oldLines.slice(p, sOld);
  const added = newLines.slice(p, sNew);
  base.addedLines = added.length;
  base.removedLines = removed.length;
  base.isNewFile = isNewFile;

  if (removed.length === 0 && added.length === 0) {
    return base; // identical (or only the reconstructed trailing-newline differs) — nothing to show
  }

  const ctxBefore = oldLines.slice(Math.max(0, p - CONTEXT_LINES), p);
  const ctxAfterStart = sOld;
  const ctxAfter = oldLines.slice(ctxAfterStart, Math.min(oldLines.length, ctxAfterStart + CONTEXT_LINES));

  const out: string[] = [];
  let chars = 0;
  let truncated = false;
  let secretRedacted = false;
  const push = (prefix: string, line: string): boolean => {
    if (out.length >= MAX_PREVIEW_LINES) { truncated = true; return false; }
    if (lineIsForbidden(line)) { secretRedacted = true; out.push(`${prefix} [line withheld — scanned as secret-shaped]`); return true; }
    const rendered = `${prefix} ${line}`;
    if (chars + rendered.length > MAX_PREVIEW_CHARS) { truncated = true; return false; }
    chars += rendered.length + 1;
    out.push(rendered);
    return true;
  };

  out.push(`@@ ${relPath}${isNewFile ? ' (new file)' : ''} @@`);
  for (const l of ctxBefore) if (!push(' ', l)) break;
  for (const l of removed) if (!push('-', l)) break;
  for (const l of added) if (!push('+', l)) break;
  if (!truncated) for (const l of ctxAfter) if (!push(' ', l)) break;

  base.hunk = out.join('\n');
  base.truncated = truncated;
  base.secretRedacted = secretRedacted;
  return base;
}
