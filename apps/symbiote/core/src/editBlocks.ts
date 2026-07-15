// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Search/replace EDIT BLOCKS — the LLM-friendly authoring format for #104 (Round A).
 *
 * WHY THIS EXISTS: the unified-diff path (unifiedDiff.ts) is correct and safe, but raw unified diffs are a
 * poor fit for model drafters — they must hand-count `@@ -a,b +c,d @@` line numbers and reproduce context
 * lines by absolute position, which small coding models get wrong constantly (observed live: a Kimi drafter
 * refused 5×, each on a wrong header count or a mis-positioned context line). Exact-match REFUSED every bad
 * diff — the safety property worked — but the loop never reached signature because the model couldn't author
 * a clean diff against a large file. Edit blocks remove the line-arithmetic entirely: the model gives an
 * exact snippet to FIND and its REPLACEMENT. No line numbers, no counts, no positional context.
 *
 * THE SAFETY PROPERTY IS PRESERVED (this is the whole point): a `find` snippet must occur in the current
 * disk bytes EXACTLY ONCE. Zero matches → refuse (the model hallucinated content). More than one match →
 * refuse (ambiguous — we never guess which). So the reconstruction is still bound byte-for-byte to real disk
 * content: the model cannot edit bytes it did not accurately see, and the owner still signs a full-content
 * hash over the result. This grants no authority and applies nothing; it is a transport format for how a
 * change is authored, exactly like content and diff.
 */

/** One search/replace edit: find this EXACT text in the current file, replace it with that. */
export interface EditBlock { find: string; replace: string }

export type ApplyEditsResult = { ok: true; content: string } | { ok: false; reason: string };

const MAX_EDITS = 50;
const MAX_FIND = 20_000;

/** Count OVERLAPPING occurrences of `needle` in `hay` (literal string, not a regex) — every start position
 *  where the full needle matches. This is what the ambiguity guard needs: a SELF-OVERLAPPING find (its
 *  prefix equals its suffix, e.g. "\n\n" in "\n\n\n", "==" in "===", or a "../../" path run) genuinely
 *  matches at more than one position, so it is ambiguous and must REFUSE — not silently edit the first.
 *  Counting non-overlapping would undercount those to 1 and defeat the guard (adversarial-review find,
 *  2026-07-06). A find that truly appears once still counts 1. */
function countOccurrences(hay: string, needle: string): number {
  if (needle === '') return -1; // sentinel: an empty find is meaningless — caller refuses
  let n = 0;
  let from = 0;
  for (;;) {
    const i = hay.indexOf(needle, from);
    if (i < 0) return n;
    n++;
    from = i + 1; // advance by ONE so overlapping matches are each counted (ambiguity is genuine)
  }
}

/**
 * Apply search/replace edit blocks to `original`, producing the new full content. Each `find` must match the
 * CURRENT working text EXACTLY ONCE (fail-closed on 0 matches = not found, or >1 = ambiguous). Edits apply in
 * order against the running result — so a later edit sees earlier edits' output, and an edit whose `find` was
 * consumed/altered by an earlier edit refuses rather than silently no-ops. A `find` equal to its `replace`
 * refuses (a no-op edit is a drafting error, not a change). Order-independence is NOT assumed: the model is
 * told to keep edits non-overlapping.
 */
export function applyEditBlocks(original: string, edits: EditBlock[]): ApplyEditsResult {
  if (typeof original !== 'string') return { ok: false, reason: 'original must be a string' };
  if (!Array.isArray(edits) || edits.length === 0) return { ok: false, reason: 'no edits provided' };
  if (edits.length > MAX_EDITS) return { ok: false, reason: `too many edits (max ${MAX_EDITS})` };

  let working = original;
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    if (!e || typeof e.find !== 'string' || typeof e.replace !== 'string') {
      return { ok: false, reason: `edit ${i} needs find + replace strings` };
    }
    if (e.find === '') return { ok: false, reason: `edit ${i} has an empty find (nothing to locate)` };
    if (e.find.length > MAX_FIND) return { ok: false, reason: `edit ${i} find is too large (> ${MAX_FIND} chars)` };
    if (e.find === e.replace) return { ok: false, reason: `edit ${i} find equals replace (no-op — not a real change)` };
    const count = countOccurrences(working, e.find);
    if (count === 0) {
      return { ok: false, reason: `edit ${i}: find text not present in the current file (did you copy it exactly from the real file?)` };
    }
    if (count > 1) {
      return { ok: false, reason: `edit ${i}: find text is ambiguous — it occurs ${count} times; include more surrounding context so it matches exactly once` };
    }
    const at = working.indexOf(e.find);
    working = working.slice(0, at) + e.replace + working.slice(at + e.find.length);
  }
  return { ok: true, content: working };
}
