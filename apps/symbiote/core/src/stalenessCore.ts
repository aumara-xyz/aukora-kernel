// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * STALENESS CORE (#183, Great Merge round 5, #178) — staleness as a system-wide primitive,
 * born from the focus-row contract's reader rules and generalized: "a focus row from nine days
 * ago presented as current is worse than waking cold."
 *
 * The rule, verbatim from the contract and held mechanically here:
 *   EXPIRY MEANS FLAGGED, NEVER HIDDEN — age is printed on every read; an artifact whose age
 *   cannot be determined is FLAGGED (waking confidently wrong is worse than waking cold); and a
 *   stale pending proposal cannot mint a signing challenge without the owner's EXPLICIT revive
 *   gesture. Nothing is ever silently dropped, auto-deleted, or auto-signed-past.
 *
 * This module is the ONE verdict implementation. Draft-time stampers (proposal artifact, intent
 * builder) call stampExpiresBy; read surfaces (/api/loop, the signing-assistant view, the gate)
 * call stalenessVerdict; the approve door's challenge mint calls challengeStalenessGate. Portal
 * chips (#194) render these verdicts — they never compute their own.
 *
 * AUTHORITY NOTE: nothing here signs, approves, or widens anything. The only behavioral change
 * at the gate is a NEW REFUSAL (stale without revive) — authority narrows toward deliberateness;
 * the owner's revive gesture restores exactly the availability that existed before, explicitly.
 */

/** Default draft horizon: 72h. #81 asked for expiry-by-default on proposals; the focus contract
 *  set 4h chat / 7d-signed-ceiling for rows. A draft work order is between those lifetimes: three
 *  days keeps a weekend-spanning draft alive and flags anything older — Codex may tune the
 *  constant at review; every stamper takes an explicit override. */
export const DEFAULT_DRAFT_HORIZON_MS = 72 * 3_600_000;

/** Chips want to warn before the cliff: "expiring soon" = under 12h of horizon left. */
export const EXPIRING_SOON_WINDOW_MS = 12 * 3_600_000;

/** Stamp an expiry at DRAFT time: createdAt + horizon, ISO. */
export function stampExpiresBy(createdAtIso: string, horizonMs: number = DEFAULT_DRAFT_HORIZON_MS): string {
  const t = Date.parse(createdAtIso);
  if (!Number.isFinite(t)) throw new Error('staleness_created_at_invalid');
  if (!Number.isFinite(horizonMs) || horizonMs <= 0) throw new Error('staleness_horizon_invalid');
  return new Date(t + horizonMs).toISOString();
}

export interface StalenessVerdict {
  state: 'fresh' | 'stale';
  /** stale OR unknown-age ⇒ true. FLAGGED, never hidden. */
  flagged: boolean;
  /** Milliseconds since creation; null only when unknowable. */
  ageMs: number | null;
  /** Age on EVERY read — "3h old", "9d old", or the honest "age unknown". */
  ageLabel: string;
  /** The boundary in force (stamped or derived), ISO; null when unknowable. */
  expiresBy: string | null;
  /** Which rule produced the boundary — provenance of the verdict itself. */
  horizon: 'stamped' | 'default-draft-72h' | 'unknown-age';
  /** fresh but within EXPIRING_SOON_WINDOW_MS of the boundary. */
  expiringSoon: boolean;
}

function ageLabelOf(ageMs: number): string {
  const mins = Math.max(0, Math.round(ageMs / 60_000));
  if (mins < 60) return `${mins}m old`;
  if (mins < 60 * 48) return `${Math.round(mins / 60)}h old`;
  return `${Math.round(mins / (60 * 24))}d old`;
}

/** THE verdict. Never throws; malformed inputs yield the flagged unknown-age verdict, because an
 *  artifact that cannot prove its age must never present as current. */
export function stalenessVerdict(
  artifact: { createdAt?: unknown; expiresBy?: unknown },
  nowMs: number,
  defaults: { horizonMs?: number } = {},
): StalenessVerdict {
  const createdMs = typeof artifact?.createdAt === 'string' ? Date.parse(artifact.createdAt) : NaN;
  const stampedMs = typeof artifact?.expiresBy === 'string' ? Date.parse(artifact.expiresBy) : NaN;

  if (!Number.isFinite(createdMs) && !Number.isFinite(stampedMs)) {
    return { state: 'stale', flagged: true, ageMs: null, ageLabel: 'age unknown', expiresBy: null, horizon: 'unknown-age', expiringSoon: false };
  }

  const boundaryMs = Number.isFinite(stampedMs)
    ? stampedMs
    : createdMs + (defaults.horizonMs ?? DEFAULT_DRAFT_HORIZON_MS);
  const horizon: StalenessVerdict['horizon'] = Number.isFinite(stampedMs) ? 'stamped' : 'default-draft-72h';
  const ageMs = Number.isFinite(createdMs) ? Math.max(0, nowMs - createdMs) : null;
  const ageLabel = ageMs === null ? 'age unknown' : ageLabelOf(ageMs);
  const stale = nowMs >= boundaryMs;
  return {
    state: stale ? 'stale' : 'fresh',
    flagged: stale || ageMs === null,
    ageMs,
    ageLabel,
    expiresBy: new Date(boundaryMs).toISOString(),
    horizon,
    expiringSoon: !stale && boundaryMs - nowMs <= EXPIRING_SOON_WINDOW_MS,
  };
}

export type ChallengeStalenessDecision =
  | { allow: true; revived: boolean; verdict: StalenessVerdict }
  | { allow: false; reason: 'proposal_stale'; verdict: StalenessVerdict };

/** The gate rule (#183 item 1): a stale/unknown-age proposal cannot mint a signing challenge
 *  unless the owner EXPLICITLY revives it in the same gesture. Fresh proposals pass untouched.
 *  Pure — the approve door marshals its request into this and honors the decision. */
export function challengeStalenessGate(verdict: StalenessVerdict, reviveRequested: boolean): ChallengeStalenessDecision {
  if (!verdict.flagged) return { allow: true, revived: false, verdict };
  if (reviveRequested) return { allow: true, revived: true, verdict };
  return { allow: false, reason: 'proposal_stale', verdict };
}

export function stalenessGrantsAuthority(): false { return false; }
