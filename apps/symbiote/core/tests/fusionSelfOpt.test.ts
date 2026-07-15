// Fusion self-optimization v0 — budget-aware scheduling, typed attention, retry packs, terminal review.
// Advisory only; Fusion reviews, never authorizes. Quorum classification is REUSED from fusionConfig.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { resolveBudgetSchedule, buildAttentionItems, buildRetryPack, terminalFusionReview, type ReviewResultLike } from '../src/fusionSelfOpt';
import { evaluateFusionQuorum } from '../src/fusionConfig';

const plan25 = () => {
  const p: { shard: string; model: string }[] = [];
  for (const s of ['s1', 's2', 's3', 's4', 's5']) for (const m of ['m1', 'm2', 'm3', 'm4', 'm5']) p.push({ shard: s, model: m });
  return p;
};

describe('Fusion self-opt #1 — budget-aware scheduling', () => {
  it('budget 5 over a 25-call plan schedules EXACTLY 5 (spread across shards), 20 unscheduled', () => {
    const sch = resolveBudgetSchedule(plan25(), 5);
    expect(sch.scheduled.length).toBe(5);
    expect(sch.unscheduled.length).toBe(20);
    expect(sch.planned).toBe(25);
    expect(new Set(sch.scheduled.map(i => i.shard)).size).toBe(5); // one per shard — breadth before depth
  });
  it('budget 0 schedules nothing; budget >= plan schedules everything', () => {
    expect(resolveBudgetSchedule(plan25(), 0).scheduled.length).toBe(0);
    expect(resolveBudgetSchedule(plan25(), 100).scheduled.length).toBe(25);
    expect(resolveBudgetSchedule(plan25(), 100).unscheduled.length).toBe(0);
  });
});

describe('Fusion self-opt #2 — typed attention items (advisory, no secrets)', () => {
  const results: ReviewResultLike[] = [
    { shard: 's1', model: 'a', failureReason: 'empty_response', adapterFailure: true },
    { shard: 's1', model: 'b', failureReason: 'schema_mismatch', adapterFailure: true },
    { shard: 's2', model: 'c', failureReason: 'rate_limited', adapterFailure: true },
    { shard: 's3', model: 'd', verdict: 'GREEN' },
    { shard: 's3', model: 'e', verdict: 'RED' },
  ];
  it('produces typed items + advisoryOnly/grantsAuthority + bounded detail', () => {
    const items = buildAttentionItems({ results, schedule: { planned: 25, budget: 5, scheduled: new Array(5), unscheduled: new Array(20) }, quorumStatus: 'RED_QUORUM', retryPairCount: 3 });
    const kinds = items.map(i => i.kind);
    for (const k of ['model_empty_response', 'schema_failure', 'provider_rate_limited', 'budget_exhausted', 'red_quorum', 'retry_pack_ready', 'shard_conflict']) {
      expect(kinds).toContain(k);
    }
    for (const i of items) { expect(i.advisoryOnly).toBe(true); expect(i.grantsAuthority).toBe(false); }
    expect(JSON.stringify(items).toLowerCase()).not.toMatch(/prompt|signature|signedhead|"pop"|privatekey/);
  });
  it('surfaces a catch-all other_adapter_failure for failure reasons not given a specific kind', () => {
    const withOther: ReviewResultLike[] = [
      { shard: 's1', model: 'a', failureReason: 'missing_key', adapterFailure: true },
      { shard: 's2', model: 'b', failureReason: 'http_5xx', adapterFailure: true },
      { shard: 's3', model: 'c', failureReason: 'network_timeout', adapterFailure: true },
    ];
    const items = buildAttentionItems({ results: withOther });
    const other = items.find(i => i.kind === 'other_adapter_failure');
    expect(other).toBeDefined();
    expect(other!.count).toBe(3); // none of these reasons has a dedicated kind — no failure stays invisible
  });
});

describe('Fusion self-opt #3 — retry pack (ONLY failed pairs) + quorum reuse', () => {
  it('retry pack contains ONLY failed pairs; repeated model failures get a supersede suggestion', () => {
    const results: ReviewResultLike[] = [
      { shard: 's1', model: 'a', failureReason: 'empty_response', adapterFailure: true },
      { shard: 's2', model: 'a', failureReason: 'rate_limited', adapterFailure: true },
      { shard: 's3', model: 'b', verdict: 'GREEN' },
    ];
    const pack = buildRetryPack(results);
    expect(pack.pairs.length).toBe(2);              // the completed GREEN is excluded
    expect(pack.supersede.length).toBe(1);          // model 'a' failed 2x
    expect(pack.grantsAuthority).toBe(false);
  });
  it('adapter failures are non_votes: all-adapter -> NO_QUORUM (never RED); a completed RED -> RED_QUORUM', () => {
    const adv = (over: any) => ({ model: 'm', label: 'l', durationMs: 1, adapterFailure: false, verdict: 'GREEN', ...over });
    const allAdapter = [adv({ adapterFailure: true, verdict: 'RED', failureReason: 'schema_mismatch' }), adv({ adapterFailure: true, verdict: 'RED', failureReason: 'empty_response' })];
    expect(evaluateFusionQuorum(allAdapter as any).status).toBe('NO_QUORUM'); // RED verdict but adapter -> non_vote
    const completedRed = [adv({ verdict: 'RED' }), adv({ verdict: 'GREEN' }), adv({ verdict: 'GREEN' })];
    expect(evaluateFusionQuorum(completedRed as any).status).toBe('RED_QUORUM');
  });
});

describe('Fusion self-opt #4 — terminal review (safe-as-evidence gate)', () => {
  const sched = { planned: 25, budget: 5, scheduled: new Array(2), unscheduled: new Array(23) };
  it('NO_QUORUM / <2 completed -> NOT safe as evidence; >=2 completed + quorum -> safe', () => {
    const weak = terminalFusionReview({ results: [{ shard: 's', model: 'a', failureReason: 'rate_limited', adapterFailure: true }], schedule: sched, quorumStatus: 'NO_QUORUM', completedVotes: 0, retryPairCount: 1 });
    expect(weak.safeAsEvidence).toBe(false);
    expect(weak.retryRecommended).toBe(true);
    const strong = terminalFusionReview({ results: [{ shard: 's', model: 'a', verdict: 'GREEN', provider_contacted: true }, { shard: 's', model: 'b', verdict: 'GREEN', provider_contacted: true }], schedule: sched, quorumStatus: 'GREEN_QUORUM', completedVotes: 2, retryPairCount: 0 });
    expect(strong.safeAsEvidence).toBe(true);
    expect(strong.providerContactedCount).toBe(2);
    expect(strong.grantsAuthority).toBe(false);
  });
});

describe('Fusion self-opt — runner wires budget-aware scheduling', () => {
  it('fractalFusion uses resolveBudgetSchedule with config.maxScheduled (no full 25-call plan when capped)', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'fractalFusion.ts'), 'utf-8');
    expect(src).toContain('resolveBudgetSchedule');
    expect(src).toContain('config.maxScheduled');
  });

  it('run-council passes COUNCIL_BUDGET into maxScheduled, not just the adapter call budget', () => {
    const src = readFileSync(join(__dirname, '..', 'run-council.ts'), 'utf-8');
    expect(src).toContain('maxScheduled: BUDGET');
    expect(src).toContain('setCallBudget(BUDGET)');
  });

  it('run-council emits the self-opt surfaces into a validated fusion-advisory-v1 artifact (no longer dark)', () => {
    const src = readFileSync(join(__dirname, '..', 'run-council.ts'), 'utf-8');
    for (const sym of ['buildAttentionItems', 'buildRetryPack', 'terminalFusionReview', 'buildFusionAdvisoryArtifact', 'validateFusionAdvisoryArtifact', 'fusion-advisory-v1.json']) {
      expect(src).toContain(sym);
    }
  });
});
