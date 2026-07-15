// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Portable staleness law.
 *
 * Expiry means flagged, never hidden. Unknown age is flagged. A stale or
 * unknown-age proposal cannot mint a signing challenge without an explicit
 * owner revive gesture. This module is pure: callers supply the current time,
 * and it performs no I/O, signing, mutation, or authority grant.
 */

export const DEFAULT_DRAFT_HORIZON_MS = 72 * 3_600_000;
export const EXPIRING_SOON_WINDOW_MS = 12 * 3_600_000;

export function stampExpiresBy(createdAtIso: string, horizonMs: number = DEFAULT_DRAFT_HORIZON_MS): string {
  const createdMs = Date.parse(createdAtIso);
  if (!Number.isFinite(createdMs)) throw new Error("staleness_created_at_invalid");
  if (!Number.isFinite(horizonMs) || horizonMs <= 0) throw new Error("staleness_horizon_invalid");
  return new Date(createdMs + horizonMs).toISOString();
}

export interface StalenessVerdict {
  readonly state: "fresh" | "stale";
  readonly flagged: boolean;
  readonly ageMs: number | null;
  readonly ageLabel: string;
  readonly expiresBy: string | null;
  readonly horizon: "stamped" | "default-draft-72h" | "unknown-age";
  readonly expiringSoon: boolean;
}

function ageLabelOf(ageMs: number): string {
  const minutes = Math.max(0, Math.round(ageMs / 60_000));
  if (minutes < 60) return `${minutes}m old`;
  if (minutes < 60 * 48) return `${Math.round(minutes / 60)}h old`;
  return `${Math.round(minutes / (60 * 24))}d old`;
}

export function stalenessVerdict(
  artifact: { readonly createdAt?: unknown; readonly expiresBy?: unknown } | null,
  nowMs: number,
  defaults: { readonly horizonMs?: number } = {},
): StalenessVerdict {
  const createdMs = typeof artifact?.createdAt === "string" ? Date.parse(artifact.createdAt) : Number.NaN;
  const stampedMs = typeof artifact?.expiresBy === "string" ? Date.parse(artifact.expiresBy) : Number.NaN;

  if (!Number.isFinite(createdMs) && !Number.isFinite(stampedMs)) {
    return {
      state: "stale",
      flagged: true,
      ageMs: null,
      ageLabel: "age unknown",
      expiresBy: null,
      horizon: "unknown-age",
      expiringSoon: false,
    };
  }

  const boundaryMs = Number.isFinite(stampedMs)
    ? stampedMs
    : createdMs + (defaults.horizonMs ?? DEFAULT_DRAFT_HORIZON_MS);
  const horizon: StalenessVerdict["horizon"] = Number.isFinite(stampedMs)
    ? "stamped"
    : "default-draft-72h";
  const ageMs = Number.isFinite(createdMs) ? Math.max(0, nowMs - createdMs) : null;
  const stale = nowMs >= boundaryMs;

  return {
    state: stale ? "stale" : "fresh",
    flagged: stale || ageMs === null,
    ageMs,
    ageLabel: ageMs === null ? "age unknown" : ageLabelOf(ageMs),
    expiresBy: new Date(boundaryMs).toISOString(),
    horizon,
    expiringSoon: !stale && boundaryMs - nowMs <= EXPIRING_SOON_WINDOW_MS,
  };
}

export type ChallengeStalenessDecision =
  | { readonly allow: true; readonly revived: boolean; readonly verdict: StalenessVerdict }
  | { readonly allow: false; readonly reason: "proposal_stale"; readonly verdict: StalenessVerdict };

export function challengeStalenessGate(
  verdict: StalenessVerdict,
  reviveRequested: boolean,
): ChallengeStalenessDecision {
  if (!verdict.flagged) return { allow: true, revived: false, verdict };
  if (reviveRequested) return { allow: true, revived: true, verdict };
  return { allow: false, reason: "proposal_stale", verdict };
}

export function stalenessGrantsAuthority(): false {
  return false;
}
