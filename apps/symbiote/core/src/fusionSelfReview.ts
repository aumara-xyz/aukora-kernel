// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Fusion self-review v1 — Fusion inspects its OWN run artifacts and produces an advisory improvement report
 * for the next round. It is a MIRROR, not a hand: it reads fusion-run-v1 (+ optional fusion-retry-v1 and
 * fusion-advisory-v1), computes reliability / cost / non-vote / retry / model-health findings, and ranks a
 * single recommended next SAFE change. It does NOT call models, run tools, spawn processes, write memory,
 * touch the gate, import any authority/signing/AUMLOK module, mutate source, or promote anything. Advisory
 * in, never authority out. This module is PURE (no fs, no network, no side effects).
 */
import { scanForbiddenKeys, scanForbiddenValues, normalizeKey } from './forbiddenContent';

export const FUSION_SELF_REVIEW_SCHEMA = 'fusion-self-review-v1' as const;

const NO_AUTHORITY = 'ADVISORY ONLY. This self-review is evidence, not a decision. It does not authorize, promote, sign, run a tool, write memory, or change anything. Fusion points; Aukora decides through tests/receipts/rollback; AUMLOK authorizes.';

export interface FusionSelfReviewV1 {
  schema: typeof FUSION_SELF_REVIEW_SCHEMA;
  advisoryOnly: true;
  grantsAuthority: false;
  createdAt: string;
  sources: { run: string | null; retry: string | null; advisory: string | null }; // short SUMMARIES (not hashes → no crypto/signing dep)
  reliability: { totalCells: number; nonVotes: number; nonVoteRate: number; completedVotes: number; quorumStatus: string };
  costBudget: { planned: number; scheduled: number; unscheduled: number; budget: number; coverageGap: number };
  nonVotePatterns: Array<{ model: string; count: number; reasons: string[] }>;
  retryEffectiveness: { attempted: number; recovered: number; stillFailed: number; recoveryRate: number; completedBefore: number; completedAfter: number };
  modelHealth: Array<{ model: string; respondedShards: number; nonVoteShards: number; overallVote: string; flag: 'ok' | 'high_non_vote' }>;
  suggestions: string[];
  recommendedNextChange: string;
  doesNotAuthorize: string;
}

// ── defensive accessors (inputs are untrusted `unknown`; fail closed) ──
const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : null);
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const str = (x: unknown): string => (typeof x === 'string' ? x : '');
const round = (x: number): number => Math.round(x * 1000) / 1000;

/** Build the self-review from the run artifact (required) + optional retry/advisory artifacts. Returns null
 *  (fail closed) if the run artifact is missing or not a valid fusion-run-v1. */
export function buildFusionSelfReview(input: { createdAt: string; run?: unknown; retry?: unknown; advisory?: unknown }): FusionSelfReviewV1 | null {
  const run = obj(input.run);
  if (!run || run.schema !== 'fusion-run-v1' || !Array.isArray(run.cells)) return null; // no run → nothing to review

  const cells = arr(run.cells).map(obj).filter(Boolean) as Record<string, unknown>[];
  const runQuorum = obj(run.quorum) ?? {};
  const models = arr(run.models).map(obj).filter(Boolean) as Record<string, unknown>[];

  // reliability
  const totalCells = cells.length;
  const nonVoteCells = cells.filter(c => str(c.vote) === 'non_vote');
  const completedVotes = num(runQuorum.completedVotes);
  const reliability = {
    totalCells, nonVotes: nonVoteCells.length,
    nonVoteRate: totalCells ? round(nonVoteCells.length / totalCells) : 0,
    completedVotes, quorumStatus: str(runQuorum.status) || 'UNKNOWN',
  };

  // cost / budget (prefer the advisory schedule summary; else derive from the run)
  const advisory = obj(input.advisory);
  const sched = advisory && advisory.schema === 'fusion-advisory-v1' ? obj(advisory.scheduleSummary) : null;
  const planned = sched ? num(sched.planned) : arr(run.council).length * arr(run.shards).length;
  const scheduled = sched ? num(sched.scheduled) : totalCells;
  const budget = sched ? num(sched.budget) : scheduled;
  const unscheduled = sched ? num(sched.unscheduled) : Math.max(0, planned - scheduled);
  const costBudget = { planned, scheduled, unscheduled, budget, coverageGap: unscheduled };

  // non-vote patterns (which models non-vote, and why) — derived from the run's own non-vote list/cells
  const byModel = new Map<string, { count: number; reasons: Set<string> }>();
  for (const c of nonVoteCells) {
    const m = str(c.model); if (!m) continue;
    if (!byModel.has(m)) byModel.set(m, { count: 0, reasons: new Set() });
    const e = byModel.get(m)!; e.count++;
    const reason = str(c.findingSummary).replace(/^non-vote \(([^)]*)\).*/, '$1') || 'unknown';
    e.reasons.add(reason.slice(0, 40));
  }
  const nonVotePatterns = [...byModel.entries()].map(([model, e]) => ({ model, count: e.count, reasons: [...e.reasons] })).sort((a, b) => b.count - a.count);

  // retry effectiveness (optional)
  const retry = obj(input.retry);
  const validRetry = retry && retry.schema === 'fusion-retry-v1';
  const attempted = validRetry ? arr(retry!.retryAttemptedPairs).length : 0;
  const recovered = validRetry ? arr(retry!.supersededPairs).length : 0;
  const stillFailed = validRetry ? arr(retry!.stillFailedPairs).length : 0;
  const qBefore = validRetry ? obj(retry!.quorumBefore) : null;
  const qAfter = validRetry ? obj(retry!.quorumAfter) : null;
  const retryEffectiveness = {
    attempted, recovered, stillFailed,
    recoveryRate: attempted ? round(recovered / attempted) : 0,
    completedBefore: qBefore ? num(qBefore.completedVotes) : completedVotes,
    completedAfter: qAfter ? num(qAfter.completedVotes) : completedVotes,
  };

  // model health
  const modelHealth = models.map(m => {
    const responded = num(m.respondedShards), nonVote = num(m.nonVoteShards);
    return { model: str(m.model), respondedShards: responded, nonVoteShards: nonVote, overallVote: str(m.overallVote) || 'non_vote', flag: (nonVote > responded ? 'high_non_vote' : 'ok') as 'ok' | 'high_non_vote' };
  });

  // suggestions (advisory only) + a single ranked recommended next change
  const suggestions: string[] = [];
  const unhealthy = modelHealth.filter(m => m.flag === 'high_non_vote');
  if (costBudget.coverageGap > 0) suggestions.push(`Budget covers only ${scheduled}/${planned} planned calls — raise COUNCIL_BUDGET for full shard coverage (${costBudget.coverageGap} not scheduled).`);
  if (unhealthy.length) suggestions.push(`Model(s) with a high non-vote rate: ${unhealthy.map(m => m.model).join(', ')} — review reliability or roster inclusion (adapter fixes, JSON mode, or replacement).`);
  if (attempted > 0) suggestions.push(`Retry lane recovered ${recovered}/${attempted} transient non-vote(s) (${round(retryEffectiveness.recoveryRate * 100)}%).`);
  if (stillFailed > 0) suggestions.push(`${stillFailed} pair(s) still failed after retry — consider raising COUNCIL_RETRY_BUDGET or reviewing those models.`);
  if (reliability.nonVoteRate > 0.3) suggestions.push(`High non-vote rate (${round(reliability.nonVoteRate * 100)}%) — parse robustness or roster health needs attention.`);
  if (!suggestions.length) suggestions.push('Reliability looks healthy this run — no change recommended.');

  const recommendedNextChange =
    stillFailed > 0 ? 'Raise COUNCIL_RETRY_BUDGET or review the models that still fail after retry.'
    : unhealthy.length ? `Review the reliability of ${unhealthy.map(m => m.model).join(', ')} (adapter/JSON-mode fix or roster change).`
    : costBudget.coverageGap > 0 ? 'Raise COUNCIL_BUDGET for full shard coverage.'
    : reliability.nonVoteRate > 0.3 ? 'Harden reply parsing / roster health before the next run.'
    : 'No change needed — Fusion reliability is healthy this round.';

  return {
    schema: FUSION_SELF_REVIEW_SCHEMA, advisoryOnly: true, grantsAuthority: false,
    createdAt: input.createdAt,
    sources: {
      run: `fusion-run-v1 (${totalCells} cells, ${reliability.quorumStatus})`,
      retry: validRetry ? `fusion-retry-v1 (${attempted} attempted, ${recovered} recovered)` : null,
      advisory: sched ? `fusion-advisory-v1 (budget ${budget}, ${scheduled}/${planned} scheduled)` : null,
    },
    reliability, costBudget, nonVotePatterns, retryEffectiveness, modelHealth,
    suggestions, recommendedNextChange, doesNotAuthorize: NO_AUTHORITY,
  };
}

// ── fail-closed validation (advisory in, never authority out) ──
const AUTHORITY_KEY_RE = /(authoritygranted|authoritychanged|gatechanged|gateunlock|gateopen|unlock|promote|promotion|approval|approved|approve|authorize|authoris|capabilitygrant|grantauthority|livepromotion|selfmodify)/;

// The EXACT top-level keys a valid fusion-self-review-v1 may carry — an unknown top-level key fails closed.
const ALLOWED_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  'schema', 'advisoryOnly', 'grantsAuthority', 'createdAt', 'sources', 'reliability', 'costBudget',
  'nonVotePatterns', 'retryEffectiveness', 'modelHealth', 'suggestions', 'recommendedNextChange', 'doesNotAuthorize',
]);

function scanAuthorityShapedKeys(o: unknown): string[] {
  const found: string[] = [];
  const walk = (v: unknown, p: string) => {
    if (v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach((e, i) => walk(e, `${p}[${i}]`)); return; }
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const norm = normalizeKey(k);
      if (norm !== 'advisoryonly' && norm !== 'grantsauthority' && norm !== 'doesnotauthorize' && (norm === 'authority' || AUTHORITY_KEY_RE.test(norm))) found.push(p ? `${p}.${k}` : k);
      walk(val, p ? `${p}.${k}` : k);
    }
  };
  walk(o, '');
  return found;
}

export function validateFusionSelfReview(a: unknown): { valid: boolean; reason?: string } {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { valid: false, reason: 'not an object' };
  const art = a as Record<string, unknown>;
  if (art.schema !== FUSION_SELF_REVIEW_SCHEMA) return { valid: false, reason: 'unknown/legacy schema — fail closed' };
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
