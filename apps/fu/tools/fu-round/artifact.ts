// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * FuRoundArtifactV1 — the canonical, digestible record of one Fu council round over an exact review
 * target. Pure: no I/O. Reuses the frozen D6 EvidencePack canonicalizer + secret catalogue (never
 * modifies them). advisoryOnly:true / grantsAuthority:false are structural literals — the artifact
 * records a review; it confers nothing.
 *
 * Honesty invariants:
 *  - `mode` distinguishes live-model / recorded-replay / synthetic-fixture / offline.
 *  - `liveEligible` is true ONLY for mode==='live' with a real provider contact and ≥1 paid call and
 *    ≥1 genuine vote. Synthetic and replay artifacts can NEVER be liveEligible (requirement 8).
 *  - `validateFuRoundArtifact` refuses on unknown field, secret-shaped content, or an authority literal
 *    (requirement 9); the controller refuses earlier on missing evidence / mismatched target / staleness.
 */
import { canonicalString, sha256Hex, textHasSecret, uint64BE } from '../../src/evidence/index';

export const FU_ROUND_SCHEMA = 'aukora-fu-round-v1';
/** Domain-separated, length-framed digest domain (same construction as the pack digest, different tag). */
export const FU_ROUND_DIGEST_DOMAIN = 'aukora-fu-round-artifact-v1';

export type FuRoundMode = 'live' | 'replay' | 'synthetic' | 'offline';

export type SeatOutcomeStatus =
  | 'voted' | 'nonvote_empty' | 'nonvote_malformed' | 'nonvote_truncated' | 'nonvote_substituted'
  | 'nonvote_unverified' | 'nonvote_timeout' | 'nonvote_error' | 'nonvote_no_provider';

export interface FuRoundSeatRecord {
  readonly seatId: string;
  readonly requested: string;            // the seat's canonical model slug we asked for
  readonly served: string | null;        // the model the provider actually served (null if not contacted)
  readonly status: SeatOutcomeStatus;
  readonly responseDigest: string | null; // sha256 over this seat's ordered raw responses; null if none
  readonly costMicroUsd: number; // integer micro-USD (USD×1e6); floats break the safe-integer canonicalizer
}

export interface FuRoundNonVote { readonly seatId: string; readonly status: SeatOutcomeStatus; readonly reason: string; }

export interface FuRoundArtifactV1 {
  readonly schema: typeof FU_ROUND_SCHEMA;
  readonly mode: FuRoundMode;
  readonly liveEligible: boolean;
  readonly target: {
    readonly repoId: string;
    readonly commit: string;   // 40-hex
    readonly tree: string;     // 40-hex
    readonly path: string;     // relative POSIX path reviewed
  };
  readonly evidencePackDigest: string;   // packDigest of the sealed D6 EvidencePack for the target
  readonly claimBasisDigest: string;     // ClaimBasis.digest (frozen before any call)
  readonly requestedRoster: readonly string[];  // seat slugs requested, in seat order
  readonly servedRoster: readonly string[];      // distinct served identities actually returned (sorted)
  readonly seats: readonly FuRoundSeatRecord[];
  readonly votes: number;
  readonly nonVotes: readonly FuRoundNonVote[];
  readonly dissent: {
    readonly verdict: 'consensus' | 'consensus-suspect' | 'divergence' | 'insufficient-quorum';
    readonly geometrySuspect: boolean;
    readonly dissentingSeatIds: readonly string[]; // voters whose stance opposes the weighted majority
  };
  readonly quorum: {
    readonly met: boolean;
    readonly minVotes: number;
    readonly minFamilies: number;
    readonly requireSeatId: string | null;
    readonly votingFamilies: number;
    readonly fableVerified: boolean;
  };
  readonly synthesis: {
    readonly source: 'synthesis' | 'fallback-top-hyp' | 'insufficient-quorum';
    readonly answer: string;
    readonly usedClaims: readonly string[] | null;
  };
  readonly providerContacted: boolean;
  readonly paidCalls: number;
  readonly estimatedCostMicroUsd: number; // integer micro-USD
  readonly actualCostMicroUsd: number;    // integer micro-USD
  readonly advisoryOnly: true;
  readonly grantsAuthority: false;
}

const HEX40 = /^[0-9a-f]{40}$/;
const REL_POSIX = /^(?!\/)(?!.*\/\/)(?!.*(^|\/)\.\.(\/|$))[^\0\\]+$/;
const MODES: readonly FuRoundMode[] = ['live', 'replay', 'synthetic', 'offline'];
const SEAT_STATUS: readonly SeatOutcomeStatus[] = [
  'voted', 'nonvote_empty', 'nonvote_malformed', 'nonvote_truncated', 'nonvote_substituted',
  'nonvote_unverified', 'nonvote_timeout', 'nonvote_error', 'nonvote_no_provider',
];
const TOP_KEYS = [
  'schema', 'mode', 'liveEligible', 'target', 'evidencePackDigest', 'claimBasisDigest',
  'requestedRoster', 'servedRoster', 'seats', 'votes', 'nonVotes', 'dissent', 'quorum',
  'synthesis', 'providerContacted', 'paidCalls', 'estimatedCostMicroUsd', 'actualCostMicroUsd',
  'advisoryOnly', 'grantsAuthority',
];

/** Canonical bytes = the evidence canonicalizer over the artifact (JCS-aligned, key-sorted). */
export function canonicalFuRound(a: FuRoundArtifactV1): string { return canonicalString(a); }

/** Domain-separated, length-framed digest: sha256( utf8(domain) ‖ 0x00 ‖ uint64BE(len C) ‖ C ). */
export function fuRoundDigest(a: FuRoundArtifactV1): string {
  const c = new TextEncoder().encode(canonicalFuRound(a));
  const domain = new TextEncoder().encode(FU_ROUND_DIGEST_DOMAIN);
  const pre = new Uint8Array(domain.length + 1 + 8 + c.length);
  pre.set(domain, 0); pre[domain.length] = 0; pre.set(uint64BE(c.length), domain.length + 1);
  pre.set(c, domain.length + 9);
  return sha256Hex(pre);
}

export type FuRoundValidation = { ok: true } | { ok: false; code: string; message: string };
const bad = (code: string, message: string): FuRoundValidation => ({ ok: false, code, message });

function ordinaryObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  if (p !== Object.prototype && p !== null) return false;
  if (Object.getOwnPropertySymbols(v).length > 0) return false;
  return Object.getOwnPropertyNames(v).length === Object.keys(v).length;
}

/**
 * Refuse (requirement 9) an artifact with an unknown field, secret-shaped content, or an authority
 * literal. Closed-schema at the top level + the nested closed shapes; secret scan over every free-text
 * field; the advisory/authority literals are pinned exactly.
 */
export function validateFuRoundArtifact(a: unknown): FuRoundValidation {
  if (!ordinaryObject(a)) return bad('E_NOT_OBJECT', 'artifact must be an ordinary object');
  const keys = Object.keys(a);
  for (const k of keys) if (!TOP_KEYS.includes(k)) return bad('E_UNKNOWN_FIELD', `unknown field ${k}`);
  for (const k of TOP_KEYS) if (!(k in a)) return bad('E_MISSING_FIELD', `missing field ${k}`);
  const o = a as Record<string, unknown>;
  if (o.schema !== FU_ROUND_SCHEMA) return bad('E_SCHEMA', 'bad schema');
  if (o.advisoryOnly !== true) return bad('E_ADVISORY_LITERAL', 'advisoryOnly must be true');
  if (o.grantsAuthority !== false) return bad('E_AUTHORITY_LITERAL', 'grantsAuthority must be false');
  if (!MODES.includes(o.mode as FuRoundMode)) return bad('E_BAD_ENUM', 'bad mode');
  if (typeof o.liveEligible !== 'boolean') return bad('E_WRONG_TYPE', 'liveEligible');
  // synthetic/replay can never be liveEligible (requirement 8)
  if ((o.mode === 'synthetic' || o.mode === 'replay' || o.mode === 'offline') && o.liveEligible === true) {
    return bad('E_LIVE_INELIGIBLE', `${String(o.mode)} artifact cannot claim live review`);
  }
  const t = o.target;
  if (!ordinaryObject(t) || Object.keys(t).length !== 4) return bad('E_TARGET', 'bad target');
  if (typeof t.repoId !== 'string' || !HEX40.test(String(t.commit)) || !HEX40.test(String(t.tree)) || typeof t.path !== 'string' || !REL_POSIX.test(String(t.path))) {
    return bad('E_TARGET', 'bad target fields');
  }
  for (const hk of ['evidencePackDigest', 'claimBasisDigest']) {
    if (!/^[0-9a-f]{64}$/.test(String(o[hk]))) return bad('E_BAD_SHA', `${hk} not 64-hex`);
  }
  if (!Array.isArray(o.seats)) return bad('E_WRONG_TYPE', 'seats');
  for (const s of o.seats as unknown[]) {
    if (!ordinaryObject(s) || Object.keys(s).length !== 6) return bad('E_SEAT', 'bad seat record');
    if (typeof s.seatId !== 'string' || typeof s.requested !== 'string') return bad('E_SEAT', 'seat ids');
    if (!(s.served === null || typeof s.served === 'string')) return bad('E_SEAT', 'served');
    if (!SEAT_STATUS.includes(s.status as SeatOutcomeStatus)) return bad('E_SEAT', 'seat status');
    if (!(s.responseDigest === null || /^[0-9a-f]{64}$/.test(String(s.responseDigest)))) return bad('E_SEAT', 'responseDigest');
    if (!Number.isSafeInteger(s.costMicroUsd) || (s.costMicroUsd as number) < 0) return bad('E_SEAT', 'costMicroUsd');
  }
  // Numeric sanity.
  for (const nk of ['votes', 'paidCalls', 'estimatedCostMicroUsd', 'actualCostMicroUsd']) {
    if (!Number.isSafeInteger(o[nk]) || (o[nk] as number) < 0) return bad('E_WRONG_TYPE', nk);
  }
  if (typeof o.providerContacted !== 'boolean') return bad('E_WRONG_TYPE', 'providerContacted');
  // Secret + authority scan over every free-text surface (answer, reasons, roster, paths).
  const texts: string[] = [String(t.path), String(t.repoId)];
  const syn = o.synthesis as Record<string, unknown> | undefined;
  if (syn && typeof syn.answer === 'string') texts.push(syn.answer);
  for (const nv of (o.nonVotes as Array<Record<string, unknown>> | undefined) ?? []) if (typeof nv.reason === 'string') texts.push(nv.reason);
  for (const r of (o.requestedRoster as unknown[] | undefined) ?? []) texts.push(String(r));
  for (const r of (o.servedRoster as unknown[] | undefined) ?? []) texts.push(String(r));
  for (const s of (o.seats as Array<Record<string, unknown>> | undefined) ?? []) { texts.push(String(s.requested)); if (typeof s.served === 'string') texts.push(s.served); }
  for (const txt of texts) if (textHasSecret(txt)) return bad('E_SECRET_CONTENT', 'secret-shaped content in artifact');
  return { ok: true };
}
