// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * 24Z.82 — the PURE recall-region writer, split out of bootRecall.ts so the durability behavior is unit-testable WITHOUT a
 * Convex/effect dependency (bootRecall.ts imports convex/browser at module load → not importable from the vitest suite).
 * This module has ZERO heavy imports: given the current AGENTS.md text, the Convex STATUS, and the (possibly empty) recalled
 * block, it returns the new text + an outcome. The three durability invariants Codex required all live here as one function:
 *   • status "down"  → return the text UNCHANGED (byte-identical PRESERVE — an apply while Convex is down never blanks her).
 *   • status "empty" → region body = "(no memories yet)".
 *   • a drifted/old BEGIN marker → replace IN-PLACE by prefix match (never spawn a 2nd block).
 * §13: this only shapes an ADVISORY block she READS — it is never authority.
 */
export const RECALL_BEGIN = "<!-- AUKORA_RECALL:BEGIN (auto — your recalled memory; do NOT hand-edit) -->";
export const RECALL_BEGIN_PREFIX = "<!-- AUKORA_RECALL:BEGIN"; // match by PREFIX so a parenthetical drift can't spawn a 2nd block
export const RECALL_END = "<!-- AUKORA_RECALL:END -->";
export const EMPTY_BODY = "(no memories yet — nothing recalled)";

export type RecallStatus = "ok" | "empty" | "down";
export type RecallOutcome = "wrote" | "empty" | "preserved";

/**
 * Compute the new AGENTS.md text for a given Convex status + recalled block. PURE (no I/O). The caller writes `text` to disk
 * UNLESS outcome === "preserved" (Convex down → must not touch the file at all, to guarantee byte-identical preservation).
 */
export function applyRecallRegion(
  currentText: string,
  status: RecallStatus,
  block: string,
): { text: string; outcome: RecallOutcome } {
  if (status === "down") return { text: currentText, outcome: "preserved" }; // Convex unreachable → keep existing block verbatim
  const isEmpty = status === "empty" || !block;
  const body = isEmpty ? EMPTY_BODY : block;
  const region = `${RECALL_BEGIN}\n${body}\n${RECALL_END}`; // always WRITE the canonical marker
  const bi = currentText.indexOf(RECALL_BEGIN_PREFIX); // but FIND any existing marker by prefix → replace-in-place
  const ei = currentText.indexOf(RECALL_END);
  let text: string;
  // require a well-formed BEGIN…END (ei > bi); a malformed END-before-BEGIN or BEGIN-without-END falls to append (and a
  // proper pair next run replaces cleanly) rather than producing a garbled slice. (review LOW — robustness, pre-existing.)
  if (bi >= 0 && ei > bi) text = currentText.slice(0, bi) + region + currentText.slice(ei + RECALL_END.length);
  else text = currentText.replace(/\s*$/, "") + "\n\n## Recalled memory (advisory)\n" + region + "\n";
  return { text, outcome: isEmpty ? "empty" : "wrote" };
}
