// Governed adaptive retry — proof it makes Fusion more RELIABLE without making it more eager, expensive, or
// authoritative. Retries only transient failed pairs, budget-bounded, one per pair; never fabricates a vote;
// a non_vote stays a non_vote unless a REAL valid retry response arrives; final quorum via classifyVote.
import { describe, it, expect } from 'vitest';
import {
  isRetryable, planRetry, applyRetryResults, buildFusionRetryArtifact, validateFusionRetryArtifact,
  RETRYABLE_REASONS, FUSION_RETRY_SCHEMA,
} from '../src/fusionRetry';

const vote = (model: string, label: string, verdict: 'GREEN' | 'YELLOW' | 'RED') =>
  ({ model, label, lens: 'security', durationMs: 1, adapterFailure: false, provider_contacted: true, verdict });
const fail = (model: string, label: string, reason: string, contacted = true) =>
  ({ model, label, lens: 'security', durationMs: 1, adapterFailure: true, failureReason: reason, provider_contacted: contacted, verdict: 'RED' as const });

describe('fusion retry — isRetryable (only transient, contacted, failed pairs)', () => {
  it('retryable: contacted + a transient reason', () => {
    for (const r of ['empty_response', 'invalid_json', 'schema_mismatch', 'rate_limited']) {
      expect(RETRYABLE_REASONS.has(r)).toBe(true);
      expect(isRetryable(fail('m', 's', r, true))).toBe(true);
    }
  });
  it('NOT retryable: permanent reasons (unknown slug / auth / endpoint), not-contacted, or a healthy vote', () => {
    for (const r of ['http_4xx', 'missing_key', 'bad_endpoint', 'rate_cap', 'adapter_failure', 'network_timeout', 'http_5xx']) {
      expect(isRetryable(fail('m', 's', r, true))).toBe(false);
    }
    expect(isRetryable(fail('m', 's', 'empty_response', false))).toBe(false); // provider not contacted
    expect(isRetryable(vote('m', 's', 'GREEN') as any)).toBe(false);          // healthy vote is never retried
  });
});

describe('fusion retry — planRetry (#1 only failed pairs, #2 no fake retries, #3 budget cap)', () => {
  it('#1 the plan references ONLY failed pairs — healthy votes never appear', () => {
    const plan = planRetry([vote('m1', 's1', 'GREEN'), fail('m2', 's1', 'empty_response'), vote('m3', 's1', 'RED')], 5);
    const all = [...plan.retry, ...plan.skip];
    expect(all).toHaveLength(1);                       // only the one failure
    expect(all[0].model).toBe('m2');
    expect(plan.retry).toHaveLength(1);
  });
  it('#2 unknown/unreachable slugs (http_4xx) + not-contacted are SKIPPED, never retried', () => {
    const plan = planRetry([fail('gpt-x', 's1', 'http_4xx'), fail('m2', 's1', 'missing_key', false)], 5);
    expect(plan.retry).toHaveLength(0);               // neither is retried
    expect(plan.skip).toHaveLength(2);
    expect(plan.skip.every(s => /permanent|non-transient/.test(s.skipReason!))).toBe(true);
  });
  it('#3 the retry budget caps total attempts; the overflow is skipped as budget-exhausted', () => {
    const results = Array.from({ length: 5 }, (_, i) => fail(`m${i}`, 's1', 'invalid_json'));
    const plan = planRetry(results, 2);
    expect(plan.retry).toHaveLength(2);
    expect(plan.skip).toHaveLength(3);
    expect(plan.skip.every(s => s.skipReason === 'retry budget exhausted')).toBe(true);
    expect(planRetry(results, 0).retry).toHaveLength(0); // budget 0 → nothing retried
  });
});

describe('fusion retry — applyRetryResults (#4 supersede only match, #5 still-failed stays non_vote)', () => {
  it('#4 a valid retry supersedes ONLY its matching (model, shard) pair', () => {
    const original = [fail('m1', 's1', 'empty_response'), fail('m2', 's1', 'empty_response')];
    const { merged, superseded } = applyRetryResults(original as any, [vote('m1', 's1', 'GREEN')] as any);
    expect(merged.find(r => r.model === 'm1')!.adapterFailure).toBe(false); // m1 recovered
    expect(merged.find(r => r.model === 'm1')!.verdict).toBe('GREEN');
    expect(merged.find(r => r.model === 'm2')!.adapterFailure).toBe(true);  // m2 untouched
    expect(superseded).toEqual([{ model: 'm1', shard: 's1', toVote: 'GREEN' }]);
  });
  it('#5 a retry that ALSO fails changes nothing — the pair stays a non_vote', () => {
    const original = [fail('m1', 's1', 'empty_response')];
    const { merged, superseded } = applyRetryResults(original as any, [fail('m1', 's1', 'empty_response')] as any);
    expect(merged[0].adapterFailure).toBe(true);
    expect(superseded).toHaveLength(0);
  });
  it('a retry that returns a non_vote-classified result cannot fabricate a vote', () => {
    // an adapterFailure with a RED verdict is a non_vote — it must NOT supersede
    const original = [fail('m1', 's1', 'schema_mismatch')];
    const { merged, superseded } = applyRetryResults(original as any, [{ ...fail('m1', 's1', 'schema_mismatch'), verdict: 'RED' }] as any);
    expect(merged[0].adapterFailure).toBe(true);
    expect(superseded).toHaveLength(0);
  });
  it('a healthy vote is never touched by retry merging', () => {
    const original = [vote('m1', 's1', 'YELLOW'), fail('m2', 's1', 'empty_response')];
    const { merged } = applyRetryResults(original as any, [vote('m2', 's1', 'GREEN')] as any);
    expect(merged.find(r => r.model === 'm1')!.verdict).toBe('YELLOW'); // untouched
  });
});

describe('fusion retry — #6 final quorum uses classifyVote (not raw verdict strings)', () => {
  it('a recovered non_vote raises completedVotes; an all-failure before is NO_QUORUM not RED', () => {
    const before = [vote('m1', 's1', 'GREEN'), vote('m2', 's1', 'GREEN'), fail('m3', 's1', 'empty_response')];
    const { merged, superseded } = applyRetryResults(before as any, [vote('m3', 's1', 'GREEN')] as any);
    const art = buildFusionRetryArtifact({ createdAt: '2026-07-01T00:00:00.000Z', councilBudget: 10, retryBudget: 3, plan: planRetry(before as any, 3), before: before as any, after: merged, superseded });
    expect(art.quorumBefore.completedVotes).toBe(2);
    expect(art.quorumAfter.completedVotes).toBe(3);         // retry recovered one real vote
    expect(art.totalCallCap).toBe(13);                      // councilBudget + retryBudget, the hard ceiling
    expect(art.supersededPairs).toHaveLength(1);
    // an all-adapter-failure set is NO_QUORUM, never RED_QUORUM (classifyVote treats them as non_votes)
    const allFail = buildFusionRetryArtifact({ createdAt: '2026-07-01T00:00:00.000Z', councilBudget: 5, retryBudget: 2, plan: planRetry([fail('a', 's', 'empty_response'), fail('b', 's', 'empty_response')] as any, 2), before: [fail('a', 's', 'empty_response'), fail('b', 's', 'empty_response')] as any, after: [fail('a', 's', 'empty_response'), fail('b', 's', 'empty_response')] as any, superseded: [] });
    expect(allFail.quorumBefore.status).toBe('NO_QUORUM');
  });
});

describe('fusion retry — #7 artifact fails CLOSED on authority/secret-shaped fields', () => {
  const sample = () => buildFusionRetryArtifact({ createdAt: '2026-07-01T00:00:00.000Z', councilBudget: 10, retryBudget: 3, plan: planRetry([fail('m1', 's1', 'empty_response')] as any, 3), before: [fail('m1', 's1', 'empty_response')] as any, after: [fail('m1', 's1', 'empty_response')] as any, superseded: [] });
  it('a clean retry artifact validates; advisory posture pinned', () => {
    const a = sample();
    expect(a.schema).toBe(FUSION_RETRY_SCHEMA);
    expect(validateFusionRetryArtifact(a).valid).toBe(true);
  });
  it('rejects wrong schema / grantsAuthority:true / advisoryOnly:false / non-object', () => {
    expect(validateFusionRetryArtifact({ ...sample(), schema: 'fusion-retry-v0' }).valid).toBe(false);
    expect(validateFusionRetryArtifact({ ...sample(), grantsAuthority: true }).valid).toBe(false);
    expect(validateFusionRetryArtifact({ ...sample(), advisoryOnly: false }).valid).toBe(false);
    expect(validateFusionRetryArtifact(null).valid).toBe(false);
  });
  it('rejects an injected authority-shaped key or a secret-shaped value at any depth', () => {
    const a1: any = sample(); a1.supersededPairs = [{ model: 'm', shard: 's', toVote: 'GREEN', gateUnlocked: true }];
    expect(validateFusionRetryArtifact(a1).valid).toBe(false);
    const a2: any = sample(); a2.createdAt = '-----BEGIN PRIVATE KEY-----MIIBVQ';
    expect(validateFusionRetryArtifact(a2).valid).toBe(false);
  });
});

describe('fusion retry — #8 positive top-level allow-list (no unknown/shadow fields)', () => {
  const sample = () => buildFusionRetryArtifact({ createdAt: '2026-07-01T00:00:00.000Z', councilBudget: 10, retryBudget: 3, plan: planRetry([fail('m1', 's1', 'empty_response')] as any, 3), before: [fail('m1', 's1', 'empty_response')] as any, after: [fail('m1', 's1', 'empty_response')] as any, superseded: [] });
  it('a valid artifact still passes (no change to existing valid-artifact behavior)', () => {
    expect(validateFusionRetryArtifact(sample()).valid).toBe(true);
  });
  it('an artifact with an inert unknown top-level field fails closed', () => {
    const bad: any = { ...sample(), extraSneakyField: 'harmless-looking' };
    const v = validateFusionRetryArtifact(bad);
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/unknown top-level key 'extraSneakyField'/);
  });
  it('an authority-shaped EXTRA top-level field fails closed', () => {
    const bad: any = { ...sample(), gateUnlocked: true };
    expect(validateFusionRetryArtifact(bad).valid).toBe(false);
  });
  it('a secret-shaped EXTRA top-level field fails closed', () => {
    const bad: any = { ...sample(), signingSeed: 'x'.repeat(64) };
    expect(validateFusionRetryArtifact(bad).valid).toBe(false);
  });
});
