// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * run-council.ts — fire the REAL multi-model Fusion Council (advisory only, grants NO authority).
 *
 * Extracts live shard evidence across the 5 safety scopes, runs the swarm over OpenRouter (key auto-resolved
 * by externalReview from env / core/.env / opencode auth.json), prints the governance report + quorum, and
 * writes the advisory womb artifact. By construction advisory_only=true, authority_granted=false — the
 * council REVIEWS; it never promotes, signs, or mutates the live repo.
 *
 *   cd core && bun run run-council.ts            # full force
 *   COUNCIL_BUDGET=8 bun run run-council.ts      # cap call budget
 *   COUNCIL_MODELS=a,b,c bun run run-council.ts  # explicit roster for smoke/repair runs
 */
import { buildLiveShardEvidence } from "./src/fractalFusionEvidence";
import { runFractalFusionReview, buildFractalArtifact, retryFusionPairs, SHARD_NAMES, type FractalFusionConfig } from "./src/fractalFusion";
import { performExternalReview, setCallBudget, HARD_MAX_CALLS_PER_RUN } from "./src/externalReview";
import { evaluateFusionQuorum, buildFusionGovernanceReport, formatFusionGovernanceReport } from "./src/fusionConfig";
import { buildAttentionItems, buildRetryPack, terminalFusionReview } from "./src/fusionSelfOpt";
import { buildFusionAdvisoryArtifact, validateFusionAdvisoryArtifact } from "./src/fusionAdvisoryArtifact";
import { buildFusionRunArtifact, validateFusionRunArtifact } from "./src/fusionRunArtifact";
import { planRetry, applyRetryResults, buildFusionRetryArtifact, validateFusionRetryArtifact } from "./src/fusionRetry";
import { buildFusionSelfReview, validateFusionSelfReview } from "./src/fusionSelfReview";
import * as path from "path";
import * as fs from "fs";

// buildLiveShardEvidence reads `root + "src/<file>.ts"`. The seed flattened the kernel into core/src/, so
// the evidence root is core/ (= __dirname here), NOT the repo root — passing the repo root feeds the council
// EMPTY evidence (the first run's RED_QUORUM was exactly that: "supply the actual sources").
const CORE = __dirname;
const BUDGET = Number(process.env.COUNCIL_BUDGET || 25);
setCallBudget(BUDGET);

// The council roster (governed, explicit). Unknown/unreachable slugs resolve to an honest non_vote — never
// a fabricated vote — and the budget cap always wins over roster size (both tested in
// core/tests/fusionRosterConcurrency.test.ts). gpt-5.5 + mistral-large were observed reachable in a live run.
const DEFAULT_MODELS = [
  "anthropic/claude-opus-4.8",
  "openai/gpt-5.5",
  "z-ai/glm-5.2",
  "moonshotai/kimi-k2.7-code",
  "deepseek/deepseek-v4-pro",
  "qwen/qwen3.7-max",
  "mistralai/mistral-large-2512",
];
const MODELS = (process.env.COUNCIL_MODELS ?? "")
  .split(",")
  .map(model => model.trim())
  .filter(Boolean);
if (MODELS.length === 0) MODELS.push(...DEFAULT_MODELS);

// Concurrency is a wall-clock lever, but bounded + configurable — never a blind 8. Clamp to [1, 8]; the
// budget cap (maxScheduled) still caps total calls. Max in-flight ≤ this bound is tested (runWithConcurrency).
const CONCURRENCY = Math.min(Math.max(1, Math.floor(Number(process.env.COUNCIL_CONCURRENCY || 3))), 8);

async function main() {
  console.error("[council] extracting live shard evidence from", CORE);
  const evidence = buildLiveShardEvidence(CORE);

  const config: FractalFusionConfig = { models: MODELS, concurrency: CONCURRENCY, reviewFn: performExternalReview, maxScheduled: BUDGET };

  console.error(`[council] firing across ${MODELS.length} models, budget=${BUDGET} ...`);
  const result = await runFractalFusionReview(evidence, config);

  // ── Governed adaptive retry lane: re-run ONLY transient failed pairs (budget-bounded) to recover real
  //    votes. Total calls stay ≤ COUNCIL_BUDGET + COUNCIL_RETRY_BUDGET; one retry per pair; never fabricates.
  const RETRY_BUDGET = Math.min(Math.max(0, Math.floor(Number(process.env.COUNCIL_RETRY_BUDGET || 5))), HARD_MAX_CALLS_PER_RUN);
  const beforeResults = result.shardResults as any[];
  const retryPlan = planRetry(beforeResults, RETRY_BUDGET);
  let superseded: Array<{ model: string; shard: string; toVote: string }> = [];
  if (retryPlan.retry.length > 0) {
    console.error(`[council] retry lane: re-running ${retryPlan.retry.length} transient failed pair(s) (retry budget ${RETRY_BUDGET}) ...`);
    // Raise the per-run call ceiling to COUNCIL_BUDGET + COUNCIL_RETRY_BUDGET so the retry calls have headroom
    // (the main run already consumed up to BUDGET). The ledger's callCountThisRun stays monotonic, so total
    // real calls are still HARD-capped at this sum — never more. Without this, retries starve at rate_cap.
    setCallBudget(BUDGET + RETRY_BUDGET);
    const toRetry = beforeResults.filter(r => retryPlan.retry.some(p => p.model === r.model && p.shard === r.label));
    const retryResults = await retryFusionPairs(evidence, toRetry as any, performExternalReview, CONCURRENCY);
    const applied = applyRetryResults(beforeResults, retryResults as any);
    (result as any).shardResults = applied.merged; // downstream quorum + artifacts reflect post-retry
    superseded = applied.superseded;
  }

  const quorum = evaluateFusionQuorum(result.shardResults as any);
  const gov = buildFusionGovernanceReport(
    MODELS,
    result.shardResults as any,
    quorum,
    "Live repository audit — M4 sandbox heartbeat, proprioception, vision contract, private GitHub savepoint scrub.",
  );

  console.log("\n=== FUSION COUNCIL — GOVERNANCE SUMMARY ===");
  console.log(formatFusionGovernanceReport(gov).join("\n"));
  console.log(`\nOVERALL CONSENSUS: ${result.overallConsensus}   (advisory_only=${result.advisory_only}, authority_granted=${result.authority_granted})`);
  console.log("\n=== PER-SHARD QUORUM ===");
  console.log(JSON.stringify(quorum, null, 2));

  const outDir = path.join(CORE, "evidence");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "opencode-womb-advisory.json"), JSON.stringify(buildFractalArtifact(result), null, 2));
  console.log("\n[council] advisory artifact written: core/evidence/opencode-womb-advisory.json (advisory_only, grants no authority)");

  // ── fusion-run-v1: the OBSERVER artifact the dashboard renders (advisory-only, grants no authority).
  //    Written to dashboard/fu/runs/ so the observer picks up the LATEST real run + a timestamped history.
  const runsDir = path.join(CORE, "..", "dashboard", "fu", "runs");
  fs.mkdirSync(runsDir, { recursive: true });
  const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runArt = buildFusionRunArtifact({
    runId,
    createdAt: new Date().toISOString(),
    target: "Aukora Symbiote seed — core/src (Fusion Council self-review)",
    council: MODELS,
    results: result.shardResults as any,
    quorum,
    governanceLines: formatFusionGovernanceReport(gov),
  });
  const runCheck = validateFusionRunArtifact(runArt);
  if (!runCheck.valid) {
    console.error("[council] fusion-run-v1 FAILED fail-closed validation — NOT writing:", runCheck.reason);
  } else {
    fs.writeFileSync(path.join(runsDir, `${runId}.json`), JSON.stringify(runArt, null, 2));
    fs.writeFileSync(path.join(runsDir, "latest.json"), JSON.stringify(runArt, null, 2));
    console.log(`[council] fusion-run-v1 written: dashboard/fu/runs/${runId}.json (+ latest.json) — observer artifact, advisory only`);
  }

  // ── fusion-retry-v1: the governed retry lane's advisory evidence (before/after quorum). Fail-closed before
  //    write; written to the gitignored core/evidence/ (not the observer's runs list). Advisory only.
  const retryArt = buildFusionRetryArtifact({ createdAt: new Date().toISOString(), councilBudget: BUDGET, retryBudget: RETRY_BUDGET, plan: retryPlan, before: beforeResults, after: result.shardResults as any, superseded });
  const retryCheck = validateFusionRetryArtifact(retryArt);
  if (!retryCheck.valid) {
    console.error("[council] fusion-retry-v1 FAILED fail-closed validation — NOT writing:", retryCheck.reason);
  } else {
    fs.writeFileSync(path.join(outDir, "fusion-retry-v1.json"), JSON.stringify(retryArt, null, 2));
    console.log(`[council] fusion-retry-v1: ${superseded.length} non-vote(s) recovered via retry (${retryArt.quorumBefore.completedVotes}->${retryArt.quorumAfter.completedVotes} completed, cap ${retryArt.totalCallCap}); core/evidence/fusion-retry-v1.json (advisory only)`);
  }

  // ── fusion-advisory-v1: the self-optimization surfaces (schedule / attention / retry / terminal), emitted
  // as a VERSIONED artifact and VALIDATED fail-closed before write. Budget scheduling already capped the live
  // calls; this surfaces the rest honestly. Advisory only — if the validator ever fails closed, we refuse to write.
  const planned = MODELS.length * SHARD_NAMES.length;
  const scheduledCount = result.shardResults.length;
  const unscheduled = Math.max(0, planned - scheduledCount);
  const scheduleArr = { planned, budget: BUDGET, scheduled: new Array(scheduledCount), unscheduled: new Array(unscheduled) };
  const retry = buildRetryPack(result.shardResults as any);
  const completedVotes = (quorum as any).completedVotes ?? (quorum as any).completedCount ?? 0;
  const attentionItems = buildAttentionItems({ results: result.shardResults as any, schedule: scheduleArr, quorumStatus: quorum.status, retryPairCount: retry.pairs.length });
  const terminal = terminalFusionReview({ results: result.shardResults as any, schedule: scheduleArr, quorumStatus: quorum.status, completedVotes, retryPairCount: retry.pairs.length });
  const v1 = buildFusionAdvisoryArtifact({
    createdAt: new Date().toISOString(),
    scheduleSummary: { planned, scheduled: scheduledCount, unscheduled, budget: BUDGET },
    quorum: {
      status: quorum.status,
      completedVotes,
      nonVotes: (quorum as any).nonVotes ?? (quorum as any).failureCount ?? 0,
      redVotes: (quorum as any).redVotes ?? 0,
      greenVotes: (quorum as any).greenVotes ?? 0,
      yellowVotes: (quorum as any).yellowVotes ?? 0,
    },
    providerContactedCount: (result.shardResults as any).filter((r: any) => r.provider_contacted).length,
    attentionItems,
    retry,
    terminalReview: terminal,
  });
  const v1check = validateFusionAdvisoryArtifact(v1);
  if (!v1check.valid) {
    console.error("[council] fusion-advisory-v1 FAILED fail-closed validation — NOT writing:", v1check.reason);
  } else {
    fs.writeFileSync(path.join(outDir, "fusion-advisory-v1.json"), JSON.stringify(v1, null, 2));
    console.log(`[council] fusion-advisory-v1 written: core/evidence/fusion-advisory-v1.json (validated · advisory_only · grants no authority · ${attentionItems.length} attention item(s) · ${retry.pairs.length} retry pair(s) · safeAsEvidence=${terminal.safeAsEvidence})`);
  }

  // ── fusion-self-review-v1: Fusion reviews its OWN run/retry/advisory artifacts and ranks the next SAFE
  //    change for the next round. A MIRROR, not a hand — advisory only, fail-closed, gitignored. Fusion
  //    points; Aukora decides; AUMLOK authorizes.
  const selfReview = buildFusionSelfReview({ createdAt: new Date().toISOString(), run: runArt, retry: retryArt, advisory: v1 });
  if (!selfReview) {
    console.error("[council] fusion-self-review-v1: no valid run artifact to review — skipped");
  } else if (!validateFusionSelfReview(selfReview).valid) {
    console.error("[council] fusion-self-review-v1 FAILED fail-closed validation — NOT writing:", validateFusionSelfReview(selfReview).reason);
  } else {
    fs.writeFileSync(path.join(outDir, "fusion-self-review-v1.json"), JSON.stringify(selfReview, null, 2));
    console.log(`[council] fusion-self-review-v1: recommended next change -> ${selfReview.recommendedNextChange} (advisory only); core/evidence/fusion-self-review-v1.json`);
  }
}

main().catch((e) => { console.error("[council] run failed:", e); process.exit(1); });
