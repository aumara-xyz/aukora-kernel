// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Auto-drain day budget (wishlist Brick 3.3, owner-granted 2026-07-08) — the pure core of the rate
 * limit that makes a default-ON background drainer safe: "keeps auto-drain from becoming
 * auto-drain-your-laptop." A drain run = one model-backed rehearsal; this caps how many the drainer
 * may START per calendar day (UTC), fail-closed.
 *
 * Pure: no fs/clock — the caller passes today's ISO date and the parsed state in, and persists the
 * returned state. Tolerant of garbage on the way in (a corrupt budget file resets to a fresh day,
 * never throws); strict on the way out (exhausted means NO, there is no override field).
 *
 * NOT authority: the budget gates COMPUTE SPEND only. Every rehearsal it allows still runs the same
 * governed chain and stops at AWAITING_OWNER_SIGNATURE. Every one it refuses stays queued, untouched,
 * for tomorrow or for the owner's own terminal run.
 */

export const DEFAULT_DRAIN_BUDGET_PER_DAY = 12;

export interface DrainBudgetStateV1 {
  schema: 'aukora-drain-budget-v1';
  /** UTC calendar day this count belongs to, YYYY-MM-DD. */
  day: string;
  /** rehearsals STARTED this day (refused starts don't count — nothing ran). */
  used: number;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** UTC calendar day of an ISO timestamp. */
export function utcDayOf(nowIso: string): string {
  return String(nowIso).slice(0, 10);
}

/** Parse persisted state tolerantly: anything malformed or from another day resets to a fresh, empty
 *  day. A reset can only ever INCREASE what today may spend up to the max — but the max is small and
 *  the alternative (throwing on a corrupt file) would stop the drain entirely, which is the owner's
 *  off-switch's job, not a parse error's. */
export function readDrainBudgetState(raw: unknown, nowIso: string): DrainBudgetStateV1 {
  const today = utcDayOf(nowIso);
  const fresh: DrainBudgetStateV1 = { schema: 'aukora-drain-budget-v1', day: today, used: 0 };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fresh;
  const a = raw as Record<string, unknown>;
  if (a.schema !== 'aukora-drain-budget-v1') return fresh;
  if (typeof a.day !== 'string' || !DAY_RE.test(a.day) || a.day !== today) return fresh; // new day = new budget
  const used = typeof a.used === 'number' && Number.isFinite(a.used) && a.used >= 0 ? Math.floor(a.used) : 0;
  return { schema: 'aukora-drain-budget-v1', day: today, used };
}

/** A nonsensical max (NaN, 0, negative) falls back to the default — never to unlimited. */
export function effectiveDrainMax(max: number | undefined): number {
  return Number.isFinite(max) && (max as number) >= 1 ? Math.floor(max as number) : DEFAULT_DRAIN_BUDGET_PER_DAY;
}

/** Try to spend one rehearsal from today's budget. ok:false = exhausted (state unchanged) — the
 *  caller must not start the run and must not persist anything. */
export function consumeDrainBudget(
  state: DrainBudgetStateV1,
  nowIso: string,
  max?: number,
): { ok: true; next: DrainBudgetStateV1; remaining: number } | { ok: false; reason: string; remaining: 0 } {
  const cap = effectiveDrainMax(max);
  const current = readDrainBudgetState(state, nowIso); // re-normalizes across a midnight rollover
  if (current.used >= cap) {
    return { ok: false, reason: `drain budget exhausted for ${current.day} (${current.used}/${cap} rehearsals started) — queue holds until tomorrow or the owner's own run`, remaining: 0 };
  }
  const next: DrainBudgetStateV1 = { ...current, used: current.used + 1 };
  return { ok: true, next, remaining: cap - next.used };
}
