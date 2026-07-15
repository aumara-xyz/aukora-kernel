// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Unified-diff apply engine (Brick #104 — throughput).
 *
 * Today a self-edit proposal carries WHOLE-FILE content (proposalHash.ts: ProposalFile = {relPath, content}).
 * On a large file, reproducing the entire new file byte-for-byte is fragile — one stray line and the model's
 * "new content" drifts from disk. #104 lets a proposal instead carry a unified DIFF; Fable reconstructs the
 * full content = applyUnifiedDiff(diskRead, proposalDiff) and feeds THAT to the unchanged
 * buildSelfEditProposalArtifact → hash → sandbox → gate → AUMLOK path. Nothing about authority moves.
 *
 * This file is ONLY the pure engine. It grants NO authority, applies NOTHING to disk, reads no network, and
 * touches no gate/signer/apply/convex module. The safety property is EXACT-MATCH reconstruction: applying a
 * diff verifies every context and removed line against the original at the hunk's location byte-for-byte, and
 * REFUSES (typed { ok:false, reason }) rather than guess, fuzzy-match, or half-apply. A diff that does not
 * cleanly apply is a refusal — never a silent best-effort. That refusal is what keeps the downstream hash the
 * owner signs bound to content that was actually derived from the real disk bytes.
 *
 * Line-ending policy: diffs and originals are split on LF, and a lone trailing CR is preserved as part of the
 * line's text (so a CRLF file round-trips: its lines end in '\r', matching is still exact, and re-joining on
 * '\n' restores the original CRLF bytes). We do NOT normalize CRLF→LF — normalization would let a diff apply
 * against bytes that differ from what is on disk, defeating exact-match. Trailing-newline behavior is preserved
 * exactly: a file ending without a final newline stays that way, one ending with a newline keeps it.
 */

/** A parsed hunk: the 1-based start lines + lengths from the @@ header, and the raw prefixed body lines. */
export interface Hunk {
  oldStart: number;
  oldLen: number;
  newStart: number;
  newLen: number;
  // Each entry keeps its leading marker (' ' context, '-' remove, '+' add) so apply can re-verify.
  lines: Array<{ marker: ' ' | '-' | '+'; text: string }>;
}

export type ParseResult = { ok: true; hunks: Hunk[] } | { ok: false; reason: string };
export type ApplyResult = { ok: true; content: string } | { ok: false; reason: string };

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Split into lines WITHOUT losing trailing-newline information. We split on '\n' and treat a terminal empty
 * element (from a trailing '\n') as the "file ends in newline" signal rather than a real empty last line.
 * Returns the line array (each line MAY carry a trailing '\r' for CRLF files) and whether the source ended
 * with a newline — both are needed to reconstruct the original bytes exactly.
 */
function splitLines(s: string): { lines: string[]; endsWithNewline: boolean } {
  if (s === '') return { lines: [], endsWithNewline: false };
  const endsWithNewline = s.endsWith('\n');
  const parts = s.split('\n');
  // A trailing '\n' yields a final '' element that is NOT a line of the file — drop it, but remember the flag.
  if (endsWithNewline) parts.pop();
  return { lines: parts, endsWithNewline };
}

/** Re-join lines to bytes, restoring the original trailing-newline behavior exactly. */
function joinLines(lines: string[], endsWithNewline: boolean): string {
  if (lines.length === 0) return endsWithNewline ? '\n' : '';
  return lines.join('\n') + (endsWithNewline ? '\n' : '');
}

/**
 * Parse standard unified-diff hunks. Leading '---'/'+++' file headers and 'diff --git'/'index' preamble lines
 * (only BEFORE the first @@) are skipped. Fails CLOSED: a malformed header, a body line without a valid
 * ' '/'-'/'+' marker, a hunk whose body line counts disagree with its header, or an empty diff-with-no-hunks
 * that isn't the legitimate empty-string case all return a typed refusal.
 */
export function parseUnifiedDiff(diff: string): ParseResult {
  if (typeof diff !== 'string') return { ok: false, reason: 'diff must be a string' };
  // An empty (or whitespace-only) diff is the legitimate "no-op" case — zero hunks, applies as identity.
  if (diff.trim() === '') return { ok: true, hunks: [] };

  const { lines } = splitLines(diff);
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  let seenHunk = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const header = raw.match(HUNK_HEADER);
    if (header) {
      // '\ No newline at end of file' is a marker line inside a hunk, handled below; a new @@ closes the prior.
      if (current) {
        const bad = countMismatch(current);
        if (bad) return { ok: false, reason: bad };
        hunks.push(current);
      }
      // Length defaults: an omitted count means 1 (unified-diff convention). A count of 0 is valid (pure add
      // or pure delete side). Start lines must be >= 1 for a non-empty side, but 0 is allowed when len is 0.
      const oldStart = Number(header[1]);
      const oldLen = header[2] === undefined ? 1 : Number(header[2]);
      const newStart = Number(header[3]);
      const newLen = header[4] === undefined ? 1 : Number(header[4]);
      if (![oldStart, oldLen, newStart, newLen].every(Number.isInteger)) {
        return { ok: false, reason: `hunk header has non-integer counts: ${raw}` };
      }
      if (oldLen < 0 || newLen < 0 || oldStart < 0 || newStart < 0) {
        return { ok: false, reason: `hunk header has negative counts: ${raw}` };
      }
      current = { oldStart, oldLen, newStart, newLen, lines: [] };
      seenHunk = true;
      continue;
    }
    if (!current) {
      // Before the first @@: tolerate the standard file-header/preamble noise, refuse anything else so a
      // malformed diff can't be silently swallowed.
      if (raw.startsWith('--- ') || raw.startsWith('+++ ') || raw.startsWith('diff ') || raw.startsWith('index ')) continue;
      if (raw === '') continue; // blank preamble line
      return { ok: false, reason: `unexpected line before first hunk header: ${JSON.stringify(raw.slice(0, 80))}` };
    }
    // Inside a hunk: '\ No newline at end of file' annotates the PRECEDING line; it carries no content and is
    // not counted — record nothing, the trailing-newline result is decided by exact match against the original.
    if (raw.startsWith('\\')) continue;
    const marker = raw[0];
    if (marker === ' ' || marker === '-' || marker === '+') {
      current.lines.push({ marker, text: raw.slice(1) });
      continue;
    }
    // A body line with no valid marker (and not the no-newline annotation) is malformed — refuse, never guess.
    // NOTE: a genuine empty context line in a unified diff is a single space (' '), which is handled above; a
    // truly empty string here means the diff body ran out / is corrupt.
    return { ok: false, reason: `unparseable diff line (no ' '/'-'/'+' marker): ${JSON.stringify(raw.slice(0, 80))}` };
  }

  if (current) {
    const bad = countMismatch(current);
    if (bad) return { ok: false, reason: bad };
    hunks.push(current);
  }
  if (!seenHunk) return { ok: false, reason: 'no hunk header (@@) found in a non-empty diff' };
  return { ok: true, hunks };
}

/** A hunk's declared old/new lengths must equal the count of context+removed / context+added body lines. */
function countMismatch(h: Hunk): string | null {
  let oldCount = 0;
  let newCount = 0;
  for (const l of h.lines) {
    if (l.marker === ' ') { oldCount++; newCount++; }
    else if (l.marker === '-') oldCount++;
    else newCount++;
  }
  if (oldCount !== h.oldLen) return `hunk @@ -${h.oldStart},${h.oldLen}: body has ${oldCount} old lines, header says ${h.oldLen}`;
  if (newCount !== h.newLen) return `hunk @@ +${h.newStart},${h.newLen}: body has ${newCount} new lines, header says ${h.newLen}`;
  return null;
}

/**
 * Apply the parsed hunks to `original`, producing the new full content. EXACT-MATCH is the whole point:
 * every context and removed line must equal the original line at the hunk's position byte-for-byte, or the
 * apply REFUSES. Hunks must be in order and non-overlapping (a hunk whose oldStart lands before the previous
 * hunk's consumed region is a refusal — we never re-order or fuzzy-locate).
 */
export function applyUnifiedDiff(original: string, diff: string): ApplyResult {
  if (typeof original !== 'string') return { ok: false, reason: 'original must be a string' };
  const parsed = parseUnifiedDiff(diff);
  if (!parsed.ok) return parsed;
  const hunks = parsed.hunks;

  const src = splitLines(original);
  const srcLines = src.lines;
  const out: string[] = [];
  // `cursor` is the 0-based index into srcLines of the next un-copied original line.
  let cursor = 0;

  for (const h of hunks) {
    // Header oldStart is 1-based. A hunk touching real lines starts at oldStart; the 0-based index is
    // oldStart-1. For a pure-insertion hunk (oldLen 0) oldStart is the line AFTER which to insert, so the
    // 0-based apply position is still oldStart-1 clamped to [0, len] — but we still verify context exactly.
    const hunkStart = h.oldLen === 0 && h.oldStart === 0 ? 0 : h.oldStart - 1;
    if (hunkStart < cursor) {
      return { ok: false, reason: `hunk @@ -${h.oldStart} overlaps or precedes a prior hunk (out-of-order)` };
    }
    if (hunkStart > srcLines.length) {
      return { ok: false, reason: `hunk @@ -${h.oldStart} starts past end of file (${srcLines.length} lines)` };
    }
    // Copy the untouched original lines between the previous hunk and this one, verbatim.
    for (let i = cursor; i < hunkStart; i++) out.push(srcLines[i]);
    cursor = hunkStart;

    for (const l of h.lines) {
      if (l.marker === '+') {
        // Added line: no original to match; emit as-is.
        out.push(l.text);
        continue;
      }
      // Context (' ') and removed ('-') lines MUST match the original at the cursor exactly.
      if (cursor >= srcLines.length) {
        return { ok: false, reason: `hunk @@ -${h.oldStart} expects more original lines than exist (needed line ${cursor + 1})` };
      }
      if (srcLines[cursor] !== l.text) {
        return {
          ok: false,
          reason: `context mismatch at original line ${cursor + 1}: diff expected ${JSON.stringify(l.text.slice(0, 80))}, file has ${JSON.stringify(srcLines[cursor].slice(0, 80))}`,
        };
      }
      if (l.marker === ' ') out.push(l.text); // context survives into output
      cursor++;                                // both ' ' and '-' consume one original line
    }
  }
  // Copy the tail of the original that no hunk touched.
  for (let i = cursor; i < srcLines.length; i++) out.push(srcLines[i]);

  // Trailing-newline: the reconstructed content keeps the ORIGINAL file's trailing-newline behavior. Unified
  // diffs express a change to the final newline via the '\ No newline at end of file' marker, which is
  // advisory-only here; the exact-match discipline means the safe, invariant-preserving choice is to keep the
  // original's terminal-newline state (Fable re-hashes the result, so any legitimate newline change still has
  // to survive the same gate — this engine never invents one).
  return { ok: true, content: joinLines(out, src.endsWithNewline) };
}

/** Pure stats helper: how many lines the diff adds/removes and how many hunks it has. Refusal-shaped on a
 *  malformed diff so a caller can't accidentally read zeros off garbage. */
export function diffStats(diff: string): { ok: true; added: number; removed: number; hunks: number } | { ok: false; reason: string } {
  const parsed = parseUnifiedDiff(diff);
  if (!parsed.ok) return parsed;
  let added = 0;
  let removed = 0;
  for (const h of parsed.hunks) {
    for (const l of h.lines) {
      if (l.marker === '+') added++;
      else if (l.marker === '-') removed++;
    }
  }
  return { ok: true, added, removed, hunks: parsed.hunks.length };
}
