// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Self-edit review council — Fusion (+ Kira read-only memory) reviewing ONE specific proposed
 * change, not the whole codebase. `run-council.ts`'s existing 5-shard machinery
 * (`ShardEvidence`/`buildContextShards`) is a FIXED, hardcoded shape for whole-codebase safety-posture
 * review — it cannot review an arbitrary proposal without inventing a 6th shard inside a shared,
 * already-tested module. Instead, this reuses the lower-level real primitives directly, and (as of
 * 2026-07-01, per issue #12's resolution) the real reasoning engine is `aukoraFuEngine.ts`'s
 * `AukoraFuEngine` — a glyph-native, KL-divergence + shear-interference multi-model council — REPLACING
 * (not augmenting) the prior categorical GREEN/YELLOW/RED-per-model vote this file used through
 * `performExternalReview`. `buildFusionRunArtifact`/`buildFusionSelfReview` and `evaluateFusionQuorum`
 * still expect the shared `AdvisoryResult[]`/`QuorumEvaluation` shapes (confirmed by reading their
 * actual signatures), so this file adapts `AukoraFuEngine`'s `GlyphPacket[]` output into that shape via
 * `packetsToAdvisoryResults()` below, rather than inventing a second results type or changing the
 * shared fusion-run-v1/fusion-self-review-v1 schemas.
 *
 * HARD LINE: this is Fusion (and Kira) as REVIEWER, never as a hand. Either can recommend; neither
 * can authorize, sign, apply, or mutate anything. Kimi (moonshotai/kimi-k2.7-code) is just one roster
 * model here if reachable — never the engine that drafts the proposal. Kira's `recall()` surfaces
 * cited, advisory-only prior context (it cannot write memory or grant authority — `kiraBrain.ts`'s
 * own `grantsAuthority: false` is pinned throughout its schema).
 *
 * A new safety surface this introduces: proposal file CONTENT is chat-composed (unlike the whole-codebase
 * review's fixed, already-vetted source files) and gets sent to a THIRD-PARTY API for the first time via
 * this path. Before sending anything, the same `classifyRisk` secret-content scan the sandbox heartbeat
 * already uses is run over the proposal; if it flags secret-shaped content, the external review is
 * refused (not silently redacted) and the proposal's sandbox/test results still stand on their own.
 */
import * as path from 'path';
import { createHash } from 'crypto';
import {
  AukoraFuEngine, confidenceToNumber, defaultCouncil, knownCouncil,
  type CouncilMember, type GlyphPacket, type Contradiction, type SecurityIncident,
} from './aukoraFuEngine';
import { evaluateFusionQuorum, resolveApiKey, resolveFusionCouncil, type AdvisoryResult, type QuorumEvaluation } from './fusionConfig';
import { classifyRisk } from './changeRiskClassifier';
import type { ProposalFile } from './proposalHash';
import { buildFusionRunArtifact, validateFusionRunArtifact, type FusionRunArtifactV1 } from './fusionRunArtifact';
import { buildFusionSelfReview, validateFusionSelfReview, type FusionSelfReviewV1 } from './fusionSelfReview';
import { loadBrainState, recall, type RecallResult } from './kiraBrain';

const MAX_EVIDENCE_CHARS = 12_000;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function buildEvidencePack(goal: string, files: ProposalFile[], testResult: { passed: boolean; ran: string[]; detail: string }): string {
  const fileBlocks = files.map((f) => `--- FILE: ${f.relPath} ---\n${f.content}`).join('\n\n');
  const pack = [
    'You are reviewing ONE proposed, sandbox-tested code change before a human decides whether to sign it for live apply.',
    `GOAL: ${goal}`,
    `SANDBOX TEST RESULT: passed=${testResult.passed} ran=${JSON.stringify(testResult.ran)} detail=${testResult.detail}`,
    '',
    fileBlocks,
  ].join('\n');
  return pack.slice(0, MAX_EVIDENCE_CHARS);
}

function defaultKiraStatePath(): string {
  return process.env.AUKORA_KIRA_STATE ?? path.join(path.resolve(__dirname, '..', '..'), 'state', 'kira', 'brain.json');
}

/** Read-only Kira recall for advisory context. Never throws (a missing/corrupt state file reads as
 *  "no prior context" rather than failing the whole review) and never mutates the brain state. */
function tryKiraRecall(goal: string, files: ProposalFile[], statePath: string): RecallResult | null {
  try {
    const state = loadBrainState(statePath);
    const query = [goal, ...files.map((f) => f.relPath)].join(' ');
    return recall(state, query, 5);
  } catch {
    return null; // absent/corrupt state — advisory context is simply unavailable, not fatal
  }
}

/** Maps a glyph stance to the shared categorical verdict vocabulary evaluateFusionQuorum expects.
 *  ⊕ (strong agree) -> GREEN. ⊘ (reject/veto) -> RED. Everything else (⊙ neutral, ⊖ challenge,
 *  ⊚ abstain-without-incident) reads as YELLOW: a real vote was cast, but it is not an unqualified
 *  green light. A ⊚ packet accompanied by a SecurityIncident is handled separately as adapterFailure,
 *  never counted as a stance-based verdict at all (see packetsToAdvisoryResults). */
function stanceToVerdict(stance: GlyphPacket['stance']): 'GREEN' | 'YELLOW' | 'RED' {
  if (stance === '⊕') return 'GREEN';
  if (stance === '⊘') return 'RED';
  return 'YELLOW';
}

/** Adapts AukoraFuEngine's real per-model GlyphPacket output into the shared AdvisoryResult[] shape
 *  evaluateFusionQuorum/buildFusionRunArtifact already expect and are already tested against — no
 *  change needed to either of those shared, tested functions. A packet with an accompanying
 *  SecurityIncident (malformed_glyph / dist_sum_mismatch / model_timeout) is a real adapter failure
 *  (non-vote), exactly like the prior performExternalReview-based path treated a per-model failure —
 *  never fabricated as a RED vote. */
export function packetsToAdvisoryResults(packets: GlyphPacket[], incidents: SecurityIncident[]): AdvisoryResult[] {
  return packets.map((p) => {
    const incident = incidents.find((i) => i.modelId === p.modelId);
    const adapterFailure = !!incident;
    return {
      model: p.modelId,
      label: `${p.modelId}:aukora_fu_review`,
      durationMs: 0,
      adapterFailure,
      failureReason: incident?.type,
      provider_contacted: !adapterFailure,
      verdict: stanceToVerdict(p.stance),
      findings: p.hypothesis,
      risks: p.framework ? `framework: ${p.framework}` : '',
      missing_tests: '',
      recommended_next_commit: '',
      confidence: confidenceToNumber(p.confidence),
    };
  });
}

export interface SelfEditReviewSummary {
  schema: 'self-edit-review-v2';
  goal: string;
  councilModels: string[];
  results: AdvisoryResult[];
  quorum: QuorumEvaluation;
  overallVerdict: 'GREEN' | 'YELLOW' | 'RED' | 'NO_QUORUM';
  recommendations: string[];
  // aukora-fu v8.0.0 signals — real KL-divergence/shear consensus, not a categorical vote alone.
  gateAction: 'proceed' | 'proceed_with_caution' | 'retry' | 'quarantine' | 'self_patch';
  insight: string;
  contradictions: Contradiction[];
  strongestContradiction: Contradiction | null;
  phaseLocked: boolean;
  incidents: SecurityIncident[];
  patchesApplied: number;
  skippedReason: string | null; // set (and results empty) when the secret-content scan refused to send this out
  fusionRunArtifact: FusionRunArtifactV1 | null;
  fusionRunValid: boolean;
  fusionSelfReview: FusionSelfReviewV1 | null;
  fusionSelfReviewValid: boolean;
  kiraRecall: RecallResult | null; // advisory-only prior context, cited; null if no brain state exists yet
  advisoryOnly: true;
  grantsAuthority: false;
  createdAt: string;
}

function overallVerdictFrom(quorum: QuorumEvaluation): SelfEditReviewSummary['overallVerdict'] {
  if (quorum.status === 'NO_QUORUM') return 'NO_QUORUM';
  if (quorum.redVotes > 0) return 'RED';
  if (quorum.yellowVotes > 0) return 'YELLOW';
  return 'GREEN';
}

function emptyQuorum(reason: string): QuorumEvaluation {
  return { status: 'NO_QUORUM', completedCount: 0, failureCount: 0, totalCount: 0, adapterFailuresArePoisoning: false, reason, completedVotes: 0, nonVotes: 0, redVotes: 0, greenVotes: 0, yellowVotes: 0 };
}

export interface ReviewSelfEditProposalInput {
  goal: string;
  files: ProposalFile[];
  testResult: { passed: boolean; ran: string[]; detail: string };
  council?: CouncilMember[]; // TEST-ONLY override — defaults to resolveFusionCouncil(defaultCouncil()), honoring AUKORA_FUSION_MODELS (issue #34)
  apiKey?: string; // TEST-ONLY override — defaults to resolveApiKey() (real key resolution + compromised-key check)
  kiraStatePath?: string; // TEST-ONLY override — defaults to ${AUKORA_KIRA_STATE} / state/kira/brain.json
}

/** Runs the real aukora-fu council over ONE proposal. Never throws (a per-model failure is a captured
 *  non_vote via AukoraFuEngine's own fail-closed emitGlyph handling); never authorizes/signs/applies
 *  anything. */
export async function reviewSelfEditProposal(input: ReviewSelfEditProposalInput, now = new Date().toISOString()): Promise<SelfEditReviewSummary> {
  const kiraRecall = tryKiraRecall(input.goal, input.files, input.kiraStatePath ?? defaultKiraStatePath());

  // Secret-content guard — the FIRST time proposal content (chat-composed, not fixed vetted source) is
  // sent to a third-party API via this path. Refuse outright rather than silently redact.
  const risk = classifyRisk(
    input.files.map((f) => ({ path: f.relPath, status: 'added' as const })),
    input.files.map((f) => f.content.split('\n').map((l) => '+' + l).join('\n')).join('\n'),
  );
  if (risk.risk === 'high') {
    return {
      schema: 'self-edit-review-v2', goal: input.goal, councilModels: [], results: [],
      quorum: emptyQuorum('skipped — secret-shaped content'),
      overallVerdict: 'NO_QUORUM',
      recommendations: [],
      gateAction: 'quarantine', insight: 'SKIPPED — secret-shaped content',
      contradictions: [], strongestContradiction: null, phaseLocked: false, incidents: [], patchesApplied: 0,
      skippedReason: `refused to send to external review — secret-shaped content detected: ${risk.reasons[0] ?? 'unspecified'}`,
      fusionRunArtifact: null, fusionRunValid: false, fusionSelfReview: null, fusionSelfReviewValid: false,
      kiraRecall,
      advisoryOnly: true, grantsAuthority: false, createdAt: now,
    };
  }

  // Missing-key fail-fast (issue #21): without this, apiKey below silently becomes '' and the engine
  // still fires one real HTTP request per council model, each doomed to fail on an empty Bearer header
  // — wasted calls that look like a real (failed) review instead of "we never even tried."
  const apiKey = input.apiKey ?? resolveApiKey()?.key ?? '';
  if (!apiKey) {
    return {
      schema: 'self-edit-review-v2', goal: input.goal, councilModels: [], results: [],
      quorum: emptyQuorum('skipped — no OpenRouter API key resolved'),
      overallVerdict: 'NO_QUORUM',
      recommendations: [],
      gateAction: 'quarantine', insight: 'SKIPPED — missing_key',
      contradictions: [], strongestContradiction: null, phaseLocked: false, incidents: [], patchesApplied: 0,
      skippedReason: 'missing_key: no OpenRouter API key resolved — never contacted any council model',
      fusionRunArtifact: null, fusionRunValid: false, fusionSelfReview: null, fusionSelfReviewValid: false,
      kiraRecall,
      advisoryOnly: true, grantsAuthority: false, createdAt: now,
    };
  }

  const evidencePack = buildEvidencePack(input.goal, input.files, input.testResult);
  // Precedence matches resolveAgentModel()'s own established pattern (issue #24): an explicit
  // input.council (test-only override) wins over AUKORA_FUSION_MODELS, which wins over the full
  // default roster.
  // #34: resolve the council roster, failing CLOSED (never the full default council) on an all-unknown
  // AUKORA_FUSION_MODELS override, and never letting an empty roster reach the engine / quorum math.
  // skip() builds the shared advisory-refusal shape (same shape as the missing-key / secret-content paths).
  const skip = (insight: string, skippedReason: string, quorumMsg: string): SelfEditReviewSummary => ({
    schema: 'self-edit-review-v2', goal: input.goal, councilModels: [], results: [],
    quorum: emptyQuorum(quorumMsg), overallVerdict: 'NO_QUORUM', recommendations: [],
    gateAction: 'quarantine', insight,
    contradictions: [], strongestContradiction: null, phaseLocked: false, incidents: [], patchesApplied: 0,
    skippedReason,
    fusionRunArtifact: null, fusionRunValid: false, fusionSelfReview: null, fusionSelfReviewValid: false,
    kiraRecall, advisoryOnly: true, grantsAuthority: false, createdAt: now,
  });
  let council: CouncilMember[];
  if (input.council) {
    council = input.council; // TEST-ONLY explicit override wins (issue #24 precedence pattern)
  } else {
    const resolved = resolveFusionCouncil(defaultCouncil(), knownCouncil());
    if (!resolved.ok) return skip('SKIPPED — bad_roster', `bad_roster: ${resolved.reason}`, `skipped — ${resolved.reason}`);
    council = resolved.council;
  }
  if (council.length === 0) return skip('SKIPPED — empty_council', 'empty_council: resolved roster had no members', 'skipped — empty council roster');
  const engine = new AukoraFuEngine({ apiKey, council });
  const decision = await engine.reason(input.goal, evidencePack);
  const packets = Array.from(engine.getChannel().latest().values());
  const results = packetsToAdvisoryResults(packets, decision.incidents ?? []);

  const quorum = evaluateFusionQuorum(results);
  const recommendations = [...new Set(
    results.filter((r) => !r.adapterFailure && r.recommended_next_commit).map((r) => r.recommended_next_commit),
  )];

  // Real fusion-run-v1 (validated fail-closed) — buildFusionRunArtifact's `results` field is typed
  // AdvisoryResult[], NOT the shard-restricted ShardReviewResult[], so this "just works" with the
  // adapted results above; no change to the shared 5-shard type was needed.
  const runId = `self-edit-${sha256(input.goal + now).slice(0, 16)}`;
  const runArtifact = buildFusionRunArtifact({
    runId, createdAt: now, target: `self-edit proposal review: ${input.goal}`,
    council: packets.map((p) => p.modelId), results, quorum,
    governanceLines: [`Self-edit proposal review (aukora-fu v8.0.0) — ${packets.length} model(s), gate=${decision.action}, quorum ${quorum.status}.`],
  });
  const runCheck = validateFusionRunArtifact(runArtifact);

  let selfReview: FusionSelfReviewV1 | null = null;
  let selfReviewValid = false;
  if (runCheck.valid) {
    const built = buildFusionSelfReview({ createdAt: now, run: runArtifact });
    if (built) {
      const check = validateFusionSelfReview(built);
      if (check.valid) { selfReview = built; selfReviewValid = true; }
    }
  }

  return {
    schema: 'self-edit-review-v2',
    goal: input.goal,
    councilModels: packets.map((p) => p.modelId),
    results,
    quorum,
    overallVerdict: overallVerdictFrom(quorum),
    recommendations,
    gateAction: decision.action,
    insight: decision.insight,
    contradictions: decision.contradictions ?? [],
    strongestContradiction: engine.getChannel().strongestContradiction() ?? null,
    phaseLocked: decision.phaseLocked ?? false,
    incidents: decision.incidents ?? [],
    patchesApplied: decision.patchesApplied ?? 0,
    skippedReason: null,
    fusionRunArtifact: runCheck.valid ? runArtifact : null,
    fusionRunValid: runCheck.valid,
    fusionSelfReview: selfReview,
    fusionSelfReviewValid: selfReviewValid,
    kiraRecall,
    advisoryOnly: true,
    grantsAuthority: false,
    createdAt: now,
  };
}

/** A self-edit review NEVER grants authority — it is Fusion (and Kira) as reviewer, never as a hand. */
export function selfEditReviewGrantsAuthority(_s: SelfEditReviewSummary): false { return false; }

/** Compact, human-readable rendering for the workbench chat transcript. */
export function formatSelfEditReviewSummary(s: SelfEditReviewSummary): string {
  if (s.skippedReason) return `Fusion review SKIPPED: ${s.skippedReason}`;
  const lines = [
    `aukora-fu review — gate: ${s.gateAction.toUpperCase()} (verdict: ${s.overallVerdict}, ${s.quorum.reason})`,
    ...s.results.map((r) => `  - ${r.model}: ${r.adapterFailure ? `non_vote (${r.failureReason})` : r.verdict} — ${r.findings.slice(0, 200)}`),
    `fusion-run-v1: ${s.fusionRunValid ? 'validated' : 'not written (validation failed)'} · fusion-self-review-v1: ${s.fusionSelfReviewValid ? 'validated' : 'not written'}`,
  ];
  if (s.phaseLocked) lines.push('⚠ PHASE-LOCK: the council agreed suspiciously closely — treat consensus with extra caution.');
  if (s.strongestContradiction) {
    const c = s.strongestContradiction;
    lines.push(`Strongest contradiction: ${c.modelA} ~ ${c.modelB} (shear ${c.shearMagnitude.toFixed(2)})`);
  }
  if (s.incidents.length) lines.push(`Incidents this round: ${s.incidents.map((i) => `${i.type}(${i.modelId})`).join(', ')}`);
  if (s.patchesApplied) lines.push(`Self-patches applied: ${s.patchesApplied} (in-memory run-parameter tuning, not code changes)`);
  if (s.recommendations.length) lines.push(`Recommendations: ${s.recommendations.join(' | ')}`);
  if (s.insight) lines.push(`Insight: ${s.insight}`);
  if (s.fusionSelfReview) lines.push(`Fusion self-review suggests: ${s.fusionSelfReview.recommendedNextChange}`);
  if (s.kiraRecall && s.kiraRecall.hits.length) {
    lines.push(`Kira recall (advisory, cited): ${s.kiraRecall.hits.slice(0, 3).map((h) => h.citation).join(', ')}`);
  } else if (s.kiraRecall) {
    lines.push('Kira recall: no related prior memory found.');
  } else {
    lines.push('Kira recall: no brain state present yet.');
  }
  lines.push('Fusion and Kira review; neither authorizes, signs, applies, or mutates.');
  return lines.join('\n');
}
