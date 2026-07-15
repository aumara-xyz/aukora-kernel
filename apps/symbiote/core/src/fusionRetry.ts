// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Governed adaptive retry for TRANSIENT Fusion non_votes. When a model was CONTACTED but its reply didn't
 * parse (empty_response / invalid_json / schema_mismatch) or was rate-limited, ONE bounded retry of only
 * that (model, shard) pair may recover a real vote. Load-bearing guarantees:
 *   - retries ONLY failed pairs, never the whole council;
 *   - retries ONLY transient/repairable failures — never an unknown slug / auth failure / bad endpoint;
 *   - at most ONE retry per pair; total retries bounded by COUNCIL_RETRY_BUDGET (no retry-until-green);
 *   - NEVER fabricates a vote — a non_vote stays a non_vote unless a REAL valid retry response arrives;
 *   - final quorum is recomputed with classifyVote (adapter failures stay non_votes, never a fake RED).
 * Advisory in, never authority out. This module is PURE; the live re-run happens in run-council.
 */
import { classifyVote, evaluateFusionQuorum, type AdvisoryResult } from './fusionConfig';
import { scanForbiddenKeys, scanForbiddenValues, normalizeKey } from './forbiddenContent';

export const FUSION_RETRY_SCHEMA = 'fusion-retry-v1' as const;

// Transient/repairable failures worth ONE retry — a provider was contacted but no valid vote came back.
// NOT here (permanent, a retry won't help): missing_key, bad_endpoint, http_4xx (unknown slug / auth),
// rate_cap (budget), network/wall-clock timeout, http_5xx, adapter_failure.
export const RETRYABLE_REASONS: ReadonlySet<string> = new Set(['empty_response', 'invalid_json', 'schema_mismatch', 'rate_limited']);

export interface RetryPairLike { model: string; label: string; adapterFailure: boolean; failureReason?: string; provider_contacted?: boolean; }

/** A failed pair is retryable iff it was a REAL contacted call that failed transiently. */
export function isRetryable(r: RetryPairLike): boolean {
  if (!r.adapterFailure) return false;             // only failed pairs
  if (r.provider_contacted !== true) return false; // provider must have been contacted (excludes missing_key/bad_endpoint)
  return RETRYABLE_REASONS.has(r.failureReason ?? '');
}

export interface RetryPairPlan { model: string; shard: string; failureReason: string; decision: 'retry' | 'skip'; skipReason?: string; }
export interface RetryPlan { retryBudget: number; retry: RetryPairPlan[]; skip: RetryPairPlan[]; }

/** Plan which failed pairs to retry: retryable ones up to retryBudget; everything else skipped WITH a
 *  reason. Only failed pairs appear; a healthy vote is never in the plan. Deterministic order (input order). */
export function planRetry(results: RetryPairLike[], retryBudget: number): RetryPlan {
  const budget = Math.max(0, Math.floor(Number.isFinite(retryBudget) ? retryBudget : 0));
  const failed = results.filter(r => r.adapterFailure);
  const retry: RetryPairPlan[] = [];
  const skip: RetryPairPlan[] = [];
  for (const r of failed) {
    const shard = r.label;
    const reason = r.failureReason ?? 'unknown';
    if (!isRetryable(r)) {
      const skipReason = r.provider_contacted !== true ? 'provider not contacted (permanent)' : `non-transient failure (${reason})`;
      skip.push({ model: r.model, shard, failureReason: reason, decision: 'skip', skipReason });
    } else if (retry.length >= budget) {
      skip.push({ model: r.model, shard, failureReason: reason, decision: 'skip', skipReason: 'retry budget exhausted' });
    } else {
      retry.push({ model: r.model, shard, failureReason: reason, decision: 'retry' });
    }
  }
  return { retryBudget: budget, retry, skip };
}

/** Merge retry outcomes into the original results: a retry that produced a REAL vote (not an adapter failure,
 *  a GREEN/YELLOW/RED per classifyVote) SUPERSEDES only its matching (model, shard) non_vote. A retry that
 *  also failed changes nothing. Never fabricates a vote; never touches a healthy vote. */
export function applyRetryResults(
  original: AdvisoryResult[],
  retryResults: AdvisoryResult[],
): { merged: AdvisoryResult[]; superseded: Array<{ model: string; shard: string; toVote: string }> } {
  const key = (m: string, l: string) => `${m}|${l}`;
  const valid = new Map<string, AdvisoryResult>();
  for (const rr of retryResults) {
    if (rr.adapterFailure) continue;                 // a retry that also failed is not a vote
    if (classifyVote(rr) === 'non_vote') continue;   // only a real GREEN/YELLOW/RED can supersede
    valid.set(key(rr.model, rr.label), rr);
  }
  const superseded: Array<{ model: string; shard: string; toVote: string }> = [];
  const merged = original.map(o => {
    if (!o.adapterFailure) return o;                 // never touch a healthy vote
    const rr = valid.get(key(o.model, o.label));
    if (rr) { superseded.push({ model: o.model, shard: o.label, toVote: classifyVote(rr) }); return rr; }
    return o;                                        // no valid retry → stays a non_vote
  });
  return { merged, superseded };
}

// ── versioned advisory artifact + fail-closed validation (mirrors fusionRunArtifact) ──

export interface FusionRetryArtifactV1 {
  schema: typeof FUSION_RETRY_SCHEMA;
  advisoryOnly: true;
  grantsAuthority: false;
  createdAt: string;
  councilBudget: number;
  retryBudget: number;
  totalCallCap: number; // councilBudget + retryBudget — the hard ceiling on total calls
  originalFailedPairs: Array<{ model: string; shard: string; reason: string }>;
  retryAttemptedPairs: Array<{ model: string; shard: string; reason: string }>;
  notRetried: Array<{ model: string; shard: string; reason: string; skipReason: string }>;
  supersededPairs: Array<{ model: string; shard: string; toVote: string }>;
  stillFailedPairs: Array<{ model: string; shard: string; reason: string }>;
  quorumBefore: { status: string; completedVotes: number; nonVotes: number };
  quorumAfter: { status: string; completedVotes: number; nonVotes: number };
}

export function buildFusionRetryArtifact(input: {
  createdAt: string; councilBudget: number; retryBudget: number;
  plan: RetryPlan; before: AdvisoryResult[]; after: AdvisoryResult[];
  superseded: Array<{ model: string; shard: string; toVote: string }>;
}): FusionRetryArtifactV1 {
  const qb = evaluateFusionQuorum(input.before);
  const qa = evaluateFusionQuorum(input.after);
  return {
    schema: FUSION_RETRY_SCHEMA, advisoryOnly: true, grantsAuthority: false,
    createdAt: input.createdAt,
    councilBudget: input.councilBudget, retryBudget: input.retryBudget,
    totalCallCap: input.councilBudget + input.retryBudget,
    originalFailedPairs: input.before.filter(r => r.adapterFailure).map(r => ({ model: r.model, shard: r.label, reason: r.failureReason ?? 'unknown' })),
    retryAttemptedPairs: input.plan.retry.map(p => ({ model: p.model, shard: p.shard, reason: p.failureReason })),
    notRetried: input.plan.skip.map(p => ({ model: p.model, shard: p.shard, reason: p.failureReason, skipReason: p.skipReason ?? '' })),
    supersededPairs: input.superseded,
    stillFailedPairs: input.after.filter(r => r.adapterFailure).map(r => ({ model: r.model, shard: r.label, reason: r.failureReason ?? 'unknown' })),
    quorumBefore: { status: qb.status, completedVotes: qb.completedVotes, nonVotes: qb.nonVotes },
    quorumAfter: { status: qa.status, completedVotes: qa.completedVotes, nonVotes: qa.nonVotes },
  };
}

const AUTHORITY_KEY_RE = /(authoritygranted|authoritychanged|gatechanged|gateunlock|gateopen|unlock|promote|promotion|approval|approved|approve|authorize|authoris|capabilitygrant|grantauthority|livepromotion|selfmodify)/;

// The EXACT top-level keys a valid fusion-retry-v1 may carry — an unknown top-level key fails closed.
const ALLOWED_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  'schema', 'advisoryOnly', 'grantsAuthority', 'createdAt', 'councilBudget', 'retryBudget', 'totalCallCap',
  'originalFailedPairs', 'retryAttemptedPairs', 'notRetried', 'supersededPairs', 'stillFailedPairs',
  'quorumBefore', 'quorumAfter',
]);

function scanAuthorityShapedKeys(obj: unknown): string[] {
  const found: string[] = [];
  const walk = (o: unknown, p: string) => {
    if (o === null || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach((v, i) => walk(v, `${p}[${i}]`)); return; }
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const norm = normalizeKey(k);
      if (norm !== 'advisoryonly' && norm !== 'grantsauthority' && (norm === 'authority' || AUTHORITY_KEY_RE.test(norm))) found.push(p ? `${p}.${k}` : k);
      walk(v, p ? `${p}.${k}` : k);
    }
  };
  walk(obj, '');
  return found;
}

export function validateFusionRetryArtifact(a: unknown): { valid: boolean; reason?: string } {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { valid: false, reason: 'not an object' };
  const art = a as Record<string, unknown>;
  if (art.schema !== FUSION_RETRY_SCHEMA) return { valid: false, reason: 'unknown/legacy schema — fail closed' };
  for (const k of Object.keys(art)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(k)) return { valid: false, reason: `unknown top-level key '${k}' — allow-list fails closed` };
  }
  if (art.advisoryOnly !== true) return { valid: false, reason: 'advisoryOnly must be true' };
  if (art.grantsAuthority !== false) return { valid: false, reason: 'grantsAuthority must be false' };
  const ak = scanAuthorityShapedKeys(art);
  if (ak.length) return { valid: false, reason: `authority-shaped key(s) forbidden: ${ak.join(', ')}` };
  const sk = scanForbiddenKeys(art);
  if (sk.length) return { valid: false, reason: `forbidden secret/PoP/signature field(s): ${sk.join(', ')}` };
  const sv = scanForbiddenValues(art);
  if (sv.length) return { valid: false, reason: `secret-shaped value(s) at: ${sv.join(', ')}` };
  return { valid: true };
}
