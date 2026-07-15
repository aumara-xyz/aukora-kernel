// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Rehearsal terminal-status derivation — the loop-continuity truth fix (Round 6).
 *
 * The runner persists one bounded evidence summary per executed rehearsal; its `status` field is the
 * signability signal every reader trusts (GET /api/loop, Auma's read_rehearsal_logs, the #245
 * disposition join). The old inline derivation checked the generic AWAITING_OWNER_SIGNATURE wording
 * FIRST, so a transcript containing both the flow's boilerplate ("…stops at AWAITING_OWNER_SIGNATURE…")
 * AND an explicit `FAILED_AT: <stage>` persisted as signature-ready — a failed rehearsal that LOOKED
 * signable. Here the precedence is fixed and pinned by tests: explicit FAILED_AT terminal evidence
 * ALWAYS wins over generic awaiting language. Pure function, no I/O, no authority — it only names what
 * already happened.
 */

const FAILED_AT_RE = /FAILED_AT:?\s*([a-z_]+)/i;

/** Derive the persisted status from a rehearsal's full entry text.
 *  Precedence: explicit FAILED_AT stage > generic AWAITING_OWNER_SIGNATURE wording > unknown. */
export function deriveRehearsalTerminalStatus(allText: string): string {
  const failed = allText.match(FAILED_AT_RE);
  if (failed) return `FAILED_AT: ${failed[1]}`;
  if (/AWAITING_OWNER_SIGNATURE/.test(allText)) return 'AWAITING_OWNER_SIGNATURE';
  return 'unknown';
}

/** The one status readers may treat as signature-ready. Anything else must never appear signable. */
export function isSignableRehearsalStatus(status: string): boolean {
  return status === 'AWAITING_OWNER_SIGNATURE';
}
