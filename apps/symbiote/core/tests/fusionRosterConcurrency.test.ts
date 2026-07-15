// Governed roster + concurrency guards. A bigger/faster council is only safe if: unknown slugs become
// honest non_votes (never fabricated), the budget cap always wins over roster size, and max in-flight calls
// can never exceed the configured bound. These are the tests that must exist BEFORE adopting a 7-model
// roster or a higher concurrency — no blind tuning.
import { describe, it, expect } from 'vitest';
import { runWithConcurrency } from '../src/fractalFusion';
import { resolveBudgetSchedule } from '../src/fusionSelfOpt';
import { setCallBudget, HARD_MAX_CALLS_PER_RUN, coerceReview } from '../src/externalReview';
import { getModelProfile, classifyVote } from '../src/fusionConfig';

describe('roster/concurrency guard #1 — max in-flight can never exceed the configured bound', () => {
  it('runWithConcurrency caps simultaneous tasks at the bound (and is genuinely concurrent)', async () => {
    let inFlight = 0, maxInFlight = 0;
    const tasks = Array.from({ length: 60 }, () => async () => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(r => setTimeout(r, 4));
      inFlight--; return 1;
    });
    const bound = 6;
    const out = await runWithConcurrency(tasks, bound);
    expect(out).toHaveLength(60);
    expect(maxInFlight).toBeLessThanOrEqual(bound);
    expect(maxInFlight).toBeGreaterThan(1); // it IS concurrent, not accidentally serial
  });
  it('concurrency 1 is strictly serial (max in-flight == 1)', async () => {
    let inFlight = 0, maxInFlight = 0;
    const tasks = Array.from({ length: 10 }, () => async () => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(r => setTimeout(r, 2));
      inFlight--; return 1;
    });
    await runWithConcurrency(tasks, 1);
    expect(maxInFlight).toBe(1);
  });
});

describe('roster/concurrency guard #2 — the budget cap always wins over roster size', () => {
  it('a 7-model × 5-shard plan (35 calls) with budget 5 schedules exactly 5', () => {
    const plan: { shard: string; model: string }[] = [];
    for (const m of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) for (const s of ['s1', 's2', 's3', 's4', 's5']) plan.push({ shard: s, model: m });
    expect(plan.length).toBe(35);
    const sch = resolveBudgetSchedule(plan, 5);
    expect(sch.scheduled.length).toBe(5);     // budget wins over the 35-call roster
    expect(sch.unscheduled.length).toBe(30);
  });
  it('setCallBudget clamps to [1, HARD_MAX] — a huge requested budget cannot exceed the hard cap', () => {
    expect(setCallBudget(99999).effective).toBe(HARD_MAX_CALLS_PER_RUN);
    expect(setCallBudget(0).effective).toBe(1);
    expect(setCallBudget(5).effective).toBe(5);
  });
});

describe('roster/concurrency guard #3 — unknown/unreachable slugs become honest non_votes, never fabricated', () => {
  it('getModelProfile resolves an unknown slug to a safe default profile (no throw, no fabrication)', () => {
    const prof = getModelProfile('vendor/model-that-does-not-exist-9.9');
    expect(prof.slug).toBe('vendor/model-that-does-not-exist-9.9');
    expect(typeof prof.maxOutputTokens).toBe('number'); // usable default, not garbage
  });
  it('an unreachable model produces no parseable review => coerces to null => classifies as non_vote', () => {
    expect(coerceReview(null)).toBeNull();                                   // nothing to vote with
    expect(coerceReview({ notes: 'no verdict' })).toBeNull();               // no verdict → not a vote
    // an adapter failure (unreachable slug) is a non_vote regardless of any verdict field it carries
    expect(classifyVote({ adapterFailure: true, verdict: 'RED', model: 'x', label: 'l', durationMs: 0 } as any)).toBe('non_vote');
  });
});
