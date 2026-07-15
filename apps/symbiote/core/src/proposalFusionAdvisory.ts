// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * proposal-fusion-advisory-v1 — the council's verdict TRAVELS WITH the proposal.
 *
 * Great Merge round 1 (issue #178, Fusion lane). Before this, a Fusion review's
 * outcome lived only in the workbench transcript (and Kira's advisory capture):
 * by the time the owner sat down to sign, the council's reading was gone. This
 * module persists a BOUNDED advisory sidecar keyed by proposalHash next to the
 * pending-proposals lane (`<home>/aumlok/proposal-advisories/<hash>.json`) so
 * any signing surface — the in-shell AUMLOK screen (#177), /api/loop, or the
 * owner's own `cat` — can show the council's opinion at the decision moment.
 *
 * The line that never moves: this file is EVIDENCE PLUMBING, not authority. The
 * advisory is pinned advisoryOnly:true / grantsAuthority:false, the apply lane
 * never reads it, and a missing/invalid/RED sidecar changes nothing about what
 * the owner may sign. Validation is fail-closed on write AND read: an invalid
 * advisory is refused rather than written, and a tampered file on disk yields a
 * refusal, never a partially-trusted object (fields are allow-listed and
 * re-capped on read; unknown fields are never echoed).
 */
import * as fs from 'fs';
import * as path from 'path';
import type { SelfEditReviewSummary } from './selfEditReviewCouncil';

const GOAL_CAP = 400;
const INSIGHT_CAP = 600;
const RECOMMENDATION_CAP = 300;
const MAX_RECOMMENDATIONS = 5;
const MODEL_SLUG_CAP = 80;
const MAX_COUNCIL_MODELS = 10;
const SKIP_REASON_CAP = 300;

const VERDICTS = ['GREEN', 'YELLOW', 'RED', 'NO_QUORUM'] as const;
const GATE_ACTIONS = ['proceed', 'proceed_with_caution', 'retry', 'quarantine', 'self_patch'] as const;
const HASH_RE = /^[0-9a-f]{64}$/;

export interface ProposalFusionAdvisoryV1 {
  schema: 'proposal-fusion-advisory-v1';
  proposalHash: string; // 64-hex — the key that binds this advisory to ONE exact proposal
  createdAt: string;
  goal: string;
  overallVerdict: (typeof VERDICTS)[number];
  gateAction: (typeof GATE_ACTIONS)[number];
  insight: string;
  phaseLocked: boolean;
  quorum: {
    status: string;
    completedVotes: number;
    nonVotes: number;
    greenVotes: number;
    yellowVotes: number;
    redVotes: number;
  };
  councilModels: string[];
  recommendations: string[];
  skippedReason: string | null;
  advisoryOnly: true;
  grantsAuthority: false;
}

/** Same home-resolution rule as pendingProposalsDir (selfEditProposalArtifact.ts) — the sidecars live
 *  beside the proposals they describe, outside the repo tree. */
export function proposalAdvisoriesDir(homeDir?: string): string {
  const home = homeDir ?? process.env.AUKORA_SYMBIOTE_HOME ?? path.join(process.env.HOME || '', '.aukora-symbiote');
  return path.join(home, 'aumlok', 'proposal-advisories');
}

const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

export function buildProposalFusionAdvisory(input: {
  proposalHash: string;
  review: SelfEditReviewSummary;
  createdAt?: string;
}): ProposalFusionAdvisoryV1 {
  const r = input.review;
  return {
    schema: 'proposal-fusion-advisory-v1',
    proposalHash: input.proposalHash,
    createdAt: input.createdAt ?? new Date().toISOString(),
    goal: cap(r.goal ?? '', GOAL_CAP),
    overallVerdict: r.overallVerdict,
    gateAction: r.gateAction,
    insight: cap(r.insight ?? '', INSIGHT_CAP),
    phaseLocked: r.phaseLocked === true,
    quorum: {
      status: String(r.quorum?.status ?? 'unknown'),
      completedVotes: Number(r.quorum?.completedVotes ?? 0),
      nonVotes: Number(r.quorum?.nonVotes ?? 0),
      greenVotes: Number(r.quorum?.greenVotes ?? 0),
      yellowVotes: Number(r.quorum?.yellowVotes ?? 0),
      redVotes: Number(r.quorum?.redVotes ?? 0),
    },
    councilModels: (r.councilModels ?? []).slice(0, MAX_COUNCIL_MODELS).map((m) => cap(String(m), MODEL_SLUG_CAP)),
    recommendations: (r.recommendations ?? []).slice(0, MAX_RECOMMENDATIONS).map((x) => cap(String(x), RECOMMENDATION_CAP)),
    skippedReason: r.skippedReason ? cap(r.skippedReason, SKIP_REASON_CAP) : null,
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

/** Fail-closed shape check. Anything that isn't exactly the pinned advisory shape is refused. */
export function validateProposalFusionAdvisory(a: unknown): { valid: true } | { valid: false; reason: string } {
  if (!a || typeof a !== 'object') return { valid: false, reason: 'not an object' };
  const v = a as Record<string, unknown>;
  if (v.schema !== 'proposal-fusion-advisory-v1') return { valid: false, reason: `wrong schema: ${String(v.schema)}` };
  if (typeof v.proposalHash !== 'string' || !HASH_RE.test(v.proposalHash)) return { valid: false, reason: 'proposalHash is not 64-hex' };
  if (typeof v.createdAt !== 'string' || !v.createdAt) return { valid: false, reason: 'createdAt missing' };
  if (typeof v.goal !== 'string' || v.goal.length > GOAL_CAP) return { valid: false, reason: 'goal missing or over cap' };
  if (!VERDICTS.includes(v.overallVerdict as (typeof VERDICTS)[number])) return { valid: false, reason: `unknown verdict: ${String(v.overallVerdict)}` };
  if (!GATE_ACTIONS.includes(v.gateAction as (typeof GATE_ACTIONS)[number])) return { valid: false, reason: `unknown gateAction: ${String(v.gateAction)}` };
  if (typeof v.insight !== 'string' || v.insight.length > INSIGHT_CAP) return { valid: false, reason: 'insight missing or over cap' };
  if (typeof v.phaseLocked !== 'boolean') return { valid: false, reason: 'phaseLocked not boolean' };
  const q = v.quorum as Record<string, unknown> | undefined;
  if (!q || typeof q !== 'object' || typeof q.status !== 'string') return { valid: false, reason: 'quorum missing' };
  for (const k of ['completedVotes', 'nonVotes', 'greenVotes', 'yellowVotes', 'redVotes'] as const) {
    if (typeof q[k] !== 'number' || !Number.isFinite(q[k] as number)) return { valid: false, reason: `quorum.${k} not a number` };
  }
  if (!Array.isArray(v.councilModels) || v.councilModels.length > MAX_COUNCIL_MODELS || v.councilModels.some((m) => typeof m !== 'string' || m.length > MODEL_SLUG_CAP)) {
    return { valid: false, reason: 'councilModels malformed or over cap' };
  }
  if (!Array.isArray(v.recommendations) || v.recommendations.length > MAX_RECOMMENDATIONS || v.recommendations.some((r) => typeof r !== 'string' || r.length > RECOMMENDATION_CAP)) {
    return { valid: false, reason: 'recommendations malformed or over cap' };
  }
  if (v.skippedReason !== null && (typeof v.skippedReason !== 'string' || v.skippedReason.length > SKIP_REASON_CAP)) {
    return { valid: false, reason: 'skippedReason malformed' };
  }
  if (v.advisoryOnly !== true) return { valid: false, reason: 'advisoryOnly must be pinned true' };
  if (v.grantsAuthority !== false) return { valid: false, reason: 'grantsAuthority must be pinned false' };
  return { valid: true };
}

/** Validate-then-write. Refuses invalid advisories instead of writing them (fail-closed); the CALLER
 *  treats a refusal as non-blocking — a missing sidecar never fails a review or a proposal. */
export function writeProposalFusionAdvisory(advisory: ProposalFusionAdvisoryV1, homeDir?: string): { ok: true; path: string } | { ok: false; reason: string } {
  const check = validateProposalFusionAdvisory(advisory);
  if (!check.valid) return { ok: false, reason: `refused (fail-closed): ${check.reason}` };
  try {
    const dir = proposalAdvisoriesDir(homeDir);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const filePath = path.join(dir, `${advisory.proposalHash}.json`);
    fs.writeFileSync(filePath, JSON.stringify(advisory, null, 2), { mode: 0o600 });
    return { ok: true, path: filePath };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Read the advisory for ONE proposal. The hash is the only accepted key (64-hex — a traversal-shaped
 *  string never reaches the filesystem), the stored file is UNTRUSTED (re-validated, fields allow-listed
 *  by reconstruction — unknown fields are never echoed). Never throws. */
export function readProposalFusionAdvisory(proposalHash: string, homeDir?: string): { ok: true; advisory: ProposalFusionAdvisoryV1 } | { ok: false; reason: string } {
  if (typeof proposalHash !== 'string' || !HASH_RE.test(proposalHash)) return { ok: false, reason: 'proposalHash is not 64-hex' };
  const filePath = path.join(proposalAdvisoriesDir(homeDir), `${proposalHash}.json`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    return { ok: false, reason: `cannot read advisory: ${e instanceof Error ? e.message : String(e)}` };
  }
  const check = validateProposalFusionAdvisory(parsed);
  if (!check.valid) return { ok: false, reason: `stored advisory refused (fail-closed): ${check.reason}` };
  const p = parsed as ProposalFusionAdvisoryV1;
  if (p.proposalHash !== proposalHash) return { ok: false, reason: 'stored advisory is keyed to a different proposal' };
  // Reconstruct explicitly — the allow-list IS the shape; nothing else survives the read.
  return {
    ok: true,
    advisory: {
      schema: 'proposal-fusion-advisory-v1',
      proposalHash: p.proposalHash,
      createdAt: p.createdAt,
      goal: p.goal,
      overallVerdict: p.overallVerdict,
      gateAction: p.gateAction,
      insight: p.insight,
      phaseLocked: p.phaseLocked,
      quorum: {
        status: p.quorum.status,
        completedVotes: p.quorum.completedVotes,
        nonVotes: p.quorum.nonVotes,
        greenVotes: p.quorum.greenVotes,
        yellowVotes: p.quorum.yellowVotes,
        redVotes: p.quorum.redVotes,
      },
      councilModels: [...p.councilModels],
      recommendations: [...p.recommendations],
      skippedReason: p.skippedReason,
      advisoryOnly: true,
      grantsAuthority: false,
    },
  };
}
