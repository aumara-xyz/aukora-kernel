// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * fusion-run-v1 — the OBSERVER artifact the Fusion dashboard renders.
 *
 * This is the single, self-contained, schema-versioned shape that turns a raw council run
 * (AdvisoryResult[] + quorum + governance) into everything the observer needs: the per-(model×shard)
 * grid, a DERIVED confidence distribution per cell, a real pairwise Jensen–Shannon DIVERGENCE MATRIX,
 * per-shard consensus strength, and the contrarian (highest-divergence) model.
 *
 * BOUNDARY (load-bearing, mirrors fusionAdvisoryArtifact): advisoryOnly=true, grantsAuthority=false.
 * It carries VERDICTS, CONFIDENCES, DIVERGENCES, and short finding summaries — never a signature, PoP,
 * nonce, promotion, or any authority field. Advisory in, never authority out. The poisoning-resistant
 * quorum classification is REUSED from fusionConfig (classifyVote / evaluateFusionQuorum), never
 * re-implemented — a non-responding model is a non_vote here too, never a fake RED.
 */
import { classifyVote, type AdvisoryResult, type QuorumEvaluation, type FusionVote } from './fusionConfig';
import { scrubSecrets, collectEnvSecrets } from './externalReview';
import { scanForbiddenKeys, scanForbiddenValues, normalizeKey } from './forbiddenContent';

export const FUSION_RUN_SCHEMA = 'fusion-run-v1' as const;

export interface VerdictDistribution { g: number; y: number; r: number } // sums to 1; the "risk-axis" distribution

export interface FusionCell {
  model: string;
  shard: string;
  vote: FusionVote;                 // GREEN | YELLOW | RED | non_vote (poisoning-resistant)
  confidence: number;               // [0,1] the model's own stated confidence (0 for non_vote)
  dist: VerdictDistribution;        // DERIVED: voted-verdict mass = confidence, remainder split (documented)
  provider_contacted: boolean;      // a non_vote with provider_contacted=true was a real API call that failed/empty
  adapterFailure: boolean;
  findingSummary: string;           // short, human — never raw prompt / secret
}

export interface FusionModelAgg {
  model: string;
  overallVote: FusionVote;          // worst-wins across the model's shards (RED>YELLOW>GREEN); non_vote if it never responded
  meanConfidence: number;
  dist: VerdictDistribution;        // mean of the model's per-shard distributions
  meanDivergence: number;           // mean JS divergence from every OTHER completed model (0 = perfectly aligned)
  isContrarian: boolean;            // the single highest-meanDivergence completed model this run
  respondedShards: number;
  nonVoteShards: number;
}

export interface FusionPerShard {
  shard: string;
  consensusStrength: number;        // 1 - mean pairwise JS divergence among completed votes (1 = unanimous)
  verdicts: { g: number; y: number; r: number; nonVote: number };
  dominant: FusionVote;
}

export interface FusionRunArtifactV1 {
  schema: typeof FUSION_RUN_SCHEMA;
  advisoryOnly: true;
  grantsAuthority: false;
  runId: string;
  createdAt: string;                // ISO — caller-supplied (this module is pure)
  target: string;                   // what was reviewed
  council: string[];                // models contacted
  shards: string[];
  quorum: {
    status: string;
    greenVotes: number; yellowVotes: number; redVotes: number; nonVotes: number; completedVotes: number;
    reason: string;
  };
  cells: FusionCell[];
  models: FusionModelAgg[];
  divergenceMatrix: { models: string[]; js: number[][] }; // symmetric; NaN-free; non_vote rows/cols are -1 (N/A)
  perShard: FusionPerShard[];
  contrarian: { model: string; meanDivergence: number } | null;
  nonVotes: Array<{ model: string; reason: string; provider_contacted: boolean }>;
  governanceLines: string[];        // the printable 4-part governance report
}

// ── derivation + information-theoretic helpers ──

const EPS = 1e-9;

/** Derive a risk-axis distribution from a discrete verdict + the model's stated confidence.
 *  Voted bucket gets `confidence`; the remaining mass is split evenly over the other two buckets.
 *  Documented + honest: this is a DERIVED distribution for divergence math, not a claimed logprob. */
export function deriveDistribution(vote: FusionVote, confidence: number): VerdictDistribution {
  const c = Math.max(0, Math.min(1, confidence));
  const rest = (1 - c) / 2;
  switch (vote) {
    case 'GREEN': return { g: c, y: rest, r: rest };
    case 'YELLOW': return { g: rest, y: c, r: rest };
    case 'RED': return { g: rest, y: rest, r: c };
    default: return { g: 1 / 3, y: 1 / 3, r: 1 / 3 }; // non_vote → maximally uncertain (never influences a verdict)
  }
}

function klDiv(p: number[], q: number[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const pi = p[i] + EPS, qi = q[i] + EPS;
    s += pi * Math.log2(pi / qi);
  }
  return Math.max(0, s);
}

/** Jensen–Shannon divergence (base-2, symmetric, bounded [0,1]) between two risk-axis distributions. */
export function jsDivergence(a: VerdictDistribution, b: VerdictDistribution): number {
  const p = [a.g, a.y, a.r], q = [b.g, b.y, b.r];
  const m = p.map((_, i) => (p[i] + q[i]) / 2);
  const js = 0.5 * klDiv(p, m) + 0.5 * klDiv(q, m);
  return Math.max(0, Math.min(1, js));
}

function worstVote(votes: FusionVote[]): FusionVote {
  if (votes.includes('RED')) return 'RED';
  if (votes.includes('YELLOW')) return 'YELLOW';
  if (votes.includes('GREEN')) return 'GREEN';
  return 'non_vote';
}

function meanDist(ds: VerdictDistribution[]): VerdictDistribution {
  if (!ds.length) return { g: 1 / 3, y: 1 / 3, r: 1 / 3 };
  const g = ds.reduce((s, d) => s + d.g, 0) / ds.length;
  const y = ds.reduce((s, d) => s + d.y, 0) / ds.length;
  const r = ds.reduce((s, d) => s + d.r, 0) / ds.length;
  return { g, y, r };
}

/** Scrub model-derived free text before it enters the artifact: strip env secrets, then REDACT any residual
 *  secret-shaped value (private-key block, sk-/bearer token, 64-hex run, production wire). The observer only
 *  ever shows advisory summary text — never a raw prompt, chain-of-thought, or secret. */
function cleanText(raw: unknown, cap = 240): string {
  let t = scrubSecrets(String(raw ?? ''), collectEnvSecrets());
  if (scanForbiddenValues([t]).length > 0) t = '[redacted — secret-shaped content]';
  return t.slice(0, cap);
}

function shortSummary(r: AdvisoryResult): string {
  if (r.adapterFailure) return `non-vote (${r.failureReason ?? 'unknown'}${r.provider_contacted ? ', provider contacted' : ''})`;
  const bits = [r.findings, r.risks].filter(Boolean).join(' · ');
  return cleanText(bits || '(no findings text)');
}

// ── the builder ──

export interface FusionRunInput {
  runId: string;
  createdAt: string;
  target: string;
  council: string[];
  results: AdvisoryResult[];
  quorum: QuorumEvaluation;
  governanceLines: string[];
}

/** Result labels arrive as "model:shard:category" (the orchestrator bakes the model in). Normalize to the
 *  SHARD name so cells group by the real shards, not per (model×shard) — otherwise per-shard consensus is
 *  N trivial "100%" rows instead of one per shard. */
function normShard(label: string): string {
  const parts = String(label).split(':');
  return parts.length >= 2 ? parts[1] : label;
}

export function buildFusionRunArtifact(input: FusionRunInput): FusionRunArtifactV1 {
  const { results } = input;
  const shards = Array.from(new Set(results.map(r => normShard(r.label)))).sort();
  const modelOrder = [...input.council];

  // cells: one per result (model × shard)
  const cells: FusionCell[] = results.map(r => {
    const vote = classifyVote(r);
    const confidence = vote === 'non_vote' ? 0 : Math.max(0, Math.min(1, r.confidence ?? 0.5));
    return {
      model: r.model,
      shard: normShard(r.label),
      vote,
      confidence,
      dist: deriveDistribution(vote, confidence),
      provider_contacted: r.provider_contacted ?? false,
      adapterFailure: r.adapterFailure,
      findingSummary: shortSummary(r),
    };
  });

  // per-model aggregation
  const models: FusionModelAgg[] = modelOrder.map(model => {
    const mine = cells.filter(c => c.model === model);
    const responded = mine.filter(c => c.vote !== 'non_vote');
    const dist = meanDist(responded.map(c => c.dist));
    const meanConfidence = responded.length ? responded.reduce((s, c) => s + c.confidence, 0) / responded.length : 0;
    return {
      model,
      overallVote: worstVote(mine.map(c => c.vote)),
      meanConfidence,
      dist,
      meanDivergence: 0, // filled below once all model dists exist
      isContrarian: false,
      respondedShards: responded.length,
      nonVoteShards: mine.length - responded.length,
    };
  });

  // pairwise JS divergence matrix over MODEL-LEVEL mean distributions (completed models only; -1 = N/A)
  const completed = new Set(models.filter(m => m.respondedShards > 0).map(m => m.model));
  const js: number[][] = models.map((mi, i) => models.map((mj, j) => {
    if (i === j) return 0;
    if (!completed.has(mi.model) || !completed.has(mj.model)) return -1;
    return jsDivergence(mi.dist, mj.dist);
  }));

  // mean divergence per completed model (average over other completed models)
  models.forEach((m, i) => {
    if (!completed.has(m.model)) { m.meanDivergence = -1; return; }
    const row = js[i].filter((v, j) => j !== i && v >= 0);
    m.meanDivergence = row.length ? row.reduce((s, v) => s + v, 0) / row.length : 0;
  });
  // contrarian = highest mean divergence among completed models (needs ≥2 completed to be meaningful)
  let contrarian: FusionRunArtifactV1['contrarian'] = null;
  const completedModels = models.filter(m => completed.has(m.model));
  if (completedModels.length >= 2) {
    const top = completedModels.reduce((a, b) => (b.meanDivergence > a.meanDivergence ? b : a));
    if (top.meanDivergence > 0) { top.isContrarian = true; contrarian = { model: top.model, meanDivergence: top.meanDivergence }; }
  }

  // per-shard consensus
  const perShard: FusionPerShard[] = shards.map(shard => {
    const sc = cells.filter(c => c.shard === shard);
    const resp = sc.filter(c => c.vote !== 'non_vote');
    let meanPairJs = 0, pairs = 0;
    for (let i = 0; i < resp.length; i++) for (let j = i + 1; j < resp.length; j++) { meanPairJs += jsDivergence(resp[i].dist, resp[j].dist); pairs++; }
    const consensusStrength = pairs ? Math.max(0, 1 - meanPairJs / pairs) : (resp.length === 1 ? 1 : 0);
    return {
      shard,
      consensusStrength,
      verdicts: {
        g: sc.filter(c => c.vote === 'GREEN').length,
        y: sc.filter(c => c.vote === 'YELLOW').length,
        r: sc.filter(c => c.vote === 'RED').length,
        nonVote: sc.filter(c => c.vote === 'non_vote').length,
      },
      dominant: worstVote(resp.map(c => c.vote)),
    };
  });

  const q = input.quorum;
  return {
    schema: FUSION_RUN_SCHEMA,
    advisoryOnly: true,
    grantsAuthority: false,
    runId: input.runId,
    createdAt: input.createdAt,
    target: input.target,
    council: modelOrder,
    shards,
    quorum: {
      status: q.status,
      greenVotes: q.greenVotes, yellowVotes: q.yellowVotes, redVotes: q.redVotes,
      nonVotes: q.nonVotes, completedVotes: q.completedVotes, reason: q.reason,
    },
    cells,
    models,
    divergenceMatrix: { models: modelOrder, js },
    perShard,
    contrarian,
    nonVotes: cells.filter(c => c.vote === 'non_vote').map(c => ({ model: c.model, reason: c.findingSummary, provider_contacted: c.provider_contacted })),
    governanceLines: input.governanceLines.map(l => cleanText(l, 2000)),
  };
}

// ── fail-closed validation (mirrors fusionAdvisoryArtifact: advisory in, never authority out) ──
// Reuses the CANONICAL forbiddenContent scanners (scanForbiddenKeys / scanForbiddenValues) rather than a
// weaker duplicate list, plus an authority-shaped-key scan. advisoryOnly / grantsAuthority are the exempt
// posture markers (both pinned below).
const AUTHORITY_KEY_RE = /(authoritygranted|authoritychanged|gatechanged|gateunlock|gateopen|unlock|promote|promotion|approval|approved|approve|authorize|authoris|capabilitygrant|grantauthority|livepromotion|selfmodify)/;

// The EXACT top-level keys a valid fusion-run-v1 may carry (mirrors fusionAdvisoryArtifact's positive
// allow-list). An unknown top-level key fails closed — a validator that only checks required fields would
// let arbitrary unsigned "shadow" fields ride along uninspected.
const ALLOWED_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  'schema', 'advisoryOnly', 'grantsAuthority', 'runId', 'createdAt', 'target', 'council', 'shards',
  'quorum', 'cells', 'models', 'divergenceMatrix', 'perShard', 'contrarian', 'nonVotes', 'governanceLines',
]);

function scanAuthorityShapedKeys(obj: unknown): string[] {
  const found: string[] = [];
  const walk = (o: unknown, p: string) => {
    if (o === null || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach((v, i) => walk(v, `${p}[${i}]`)); return; }
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const full = p ? `${p}.${k}` : k;
      const norm = normalizeKey(k);
      if (norm !== 'advisoryonly' && norm !== 'grantsauthority' && (norm === 'authority' || AUTHORITY_KEY_RE.test(norm))) found.push(full);
      walk(v, full);
    }
  };
  walk(obj, '');
  return found;
}

export function validateFusionRunArtifact(a: unknown): { valid: boolean; reason?: string } {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { valid: false, reason: 'not an object' };
  const art = a as Record<string, unknown>;
  if (art.schema !== FUSION_RUN_SCHEMA) return { valid: false, reason: 'unknown/legacy schema — fail closed' };
  for (const k of Object.keys(art)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(k)) return { valid: false, reason: `unknown top-level key '${k}' — allow-list fails closed` };
  }
  if (art.advisoryOnly !== true) return { valid: false, reason: 'advisoryOnly must be true' };
  if (art.grantsAuthority !== false) return { valid: false, reason: 'grantsAuthority must be false' };
  const authorityKeys = scanAuthorityShapedKeys(art);
  if (authorityKeys.length) return { valid: false, reason: `authority-shaped key(s) forbidden: ${authorityKeys.join(', ')}` };
  const secretKeys = scanForbiddenKeys(art);
  if (secretKeys.length) return { valid: false, reason: `forbidden secret/PoP/signature/private-key field(s): ${secretKeys.join(', ')}` };
  const secretValues = scanForbiddenValues(art);
  if (secretValues.length) return { valid: false, reason: `secret-shaped value(s) at: ${secretValues.join(', ')}` };
  return { valid: true };
}
