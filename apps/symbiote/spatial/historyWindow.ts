// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Deterministic conversation-window assembly (issue #61, Auma's history advice — DETERMINISTIC half
 * only). Her guidance: don't hard-cap at a small N; keep the system grounding + anchor untouchable
 * (already true — those ride the SYSTEM message, not history), keep the most recent turns verbatim,
 * drop oldest-first when over budget — and CRUCIALLY, when anything is dropped, surface a visible
 * marker so a future turn can state its window as a fact instead of a hedge.
 *
 * The summarize-the-middle tier is deliberately NOT built here: summarizing requires model calls,
 * which is spend. Deterministic oldest-first truncation with an honest marker is the whole brick.
 *
 * Pure: no I/O, no clock, no throwing.
 */
export interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface WindowResult {
  /** The turns to actually send (most-recent, within budget), oldest→newest. */
  sent: HistoryTurn[];
  shownCount: number;
  elidedCount: number;
  totalCount: number;
}

export interface WindowOptions {
  /** Char budget for the replayed prior turns (a deterministic proxy for the token budget). */
  maxChars: number;
  /** Hard ceiling on turn count regardless of budget. */
  maxCount: number;
}

/** Keeps the most-recent turns that fit BOTH bounds, dropping oldest first. Always keeps at least the
 *  single most-recent turn even if it alone exceeds maxChars (losing the newest context is the worst
 *  outcome — better an over-budget single turn than none). Returns how many were elided. */
export function windowHistory(turns: HistoryTurn[], opts: WindowOptions): WindowResult {
  const total = turns.length;
  const kept: HistoryTurn[] = [];
  let chars = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (kept.length >= opts.maxCount) break;
    const c = turns[i].content.length;
    if (chars + c > opts.maxChars && kept.length > 0) break; // budget hit — but never drop the last kept one
    chars += c;
    kept.unshift(turns[i]);
  }
  return { sent: kept, shownCount: kept.length, elidedCount: total - kept.length, totalCount: total };
}

/** The visible window marker — '' when nothing was elided (absence means whole, her invariant), else a
 *  factual statement of exactly how much is shown vs dropped, which she is told to quote when asked. */
export function renderWindowStatus(r: WindowResult): string {
  if (r.elidedCount <= 0) return '';
  return (
    `\n\nConversation window: showing the last ${r.shownCount} of ${r.totalCount} prior turns; ` +
    `${r.elidedCount} older turn(s) were elided (dropped oldest-first to fit the window — not summarized). ` +
    `If asked how much of this conversation you can see, state this exactly rather than guessing.`
  );
}
