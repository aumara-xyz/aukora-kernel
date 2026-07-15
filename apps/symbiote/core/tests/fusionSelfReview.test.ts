// Fusion self-review v1 — Fusion inspects its OWN artifacts and recommends the next safe change. A MIRROR,
// not a hand: pure, advisory, fail-closed. It computes reliability/retry/non-vote/model-health honestly,
// never fabricates a vote, never claims authority/promotion, and imports no signer/gate/AUMLOK/fs/network.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildFusionSelfReview, validateFusionSelfReview, FUSION_SELF_REVIEW_SCHEMA } from '../src/fusionSelfReview';

const runArt = (over: Record<string, unknown> = {}) => ({
  schema: 'fusion-run-v1', advisoryOnly: true, grantsAuthority: false,
  council: ['m1', 'm2', 'm3'], shards: ['s1', 's2'],
  cells: [
    { model: 'm1', shard: 's1', vote: 'GREEN', findingSummary: 'ok' },
    { model: 'm1', shard: 's2', vote: 'YELLOW', findingSummary: 'ok' },
    { model: 'm2', shard: 's1', vote: 'non_vote', findingSummary: 'non-vote (empty_response, provider contacted)', provider_contacted: true },
    { model: 'm2', shard: 's2', vote: 'non_vote', findingSummary: 'non-vote (invalid_json)', provider_contacted: true },
    { model: 'm3', shard: 's1', vote: 'RED', findingSummary: 'risk' },
    { model: 'm3', shard: 's2', vote: 'GREEN', findingSummary: 'ok' },
  ],
  models: [
    { model: 'm1', overallVote: 'YELLOW', respondedShards: 2, nonVoteShards: 0 },
    { model: 'm2', overallVote: 'non_vote', respondedShards: 0, nonVoteShards: 2 },
    { model: 'm3', overallVote: 'RED', respondedShards: 2, nonVoteShards: 0 },
  ],
  quorum: { status: 'YELLOW_QUORUM', completedVotes: 4, nonVotes: 2, greenVotes: 2, yellowVotes: 1, redVotes: 1 },
  ...over,
});
const retryArt = (over: Record<string, unknown> = {}) => ({
  schema: 'fusion-retry-v1', advisoryOnly: true, grantsAuthority: false,
  retryAttemptedPairs: [{ model: 'm2', shard: 's1', reason: 'empty_response' }, { model: 'm2', shard: 's2', reason: 'invalid_json' }],
  supersededPairs: [{ model: 'm2', shard: 's1', toVote: 'GREEN' }],
  stillFailedPairs: [{ model: 'm2', shard: 's2', reason: 'invalid_json' }],
  quorumBefore: { status: 'YELLOW_QUORUM', completedVotes: 4, nonVotes: 2 },
  quorumAfter: { status: 'YELLOW_QUORUM', completedVotes: 5, nonVotes: 1 },
  ...over,
});
const advisoryArt = () => ({ schema: 'fusion-advisory-v1', advisoryOnly: true, grantsAuthority: false, scheduleSummary: { planned: 6, scheduled: 6, unscheduled: 0, budget: 6 } });

describe('fusion self-review — valid artifacts produce a valid, advisory review', () => {
  it('a full set of artifacts produces a valid fusion-self-review-v1', () => {
    const r = buildFusionSelfReview({ createdAt: '2026-07-01T00:00:00.000Z', run: runArt(), retry: retryArt(), advisory: advisoryArt() });
    expect(r).not.toBeNull();
    expect(r!.schema).toBe(FUSION_SELF_REVIEW_SCHEMA);
    expect(r!.advisoryOnly).toBe(true);
    expect(r!.grantsAuthority).toBe(false);
    expect(validateFusionSelfReview(r).valid).toBe(true);
  });
});

describe('fusion self-review — fail closed on missing/malformed input', () => {
  it('a missing or malformed RUN artifact returns null (nothing to review)', () => {
    expect(buildFusionSelfReview({ createdAt: 'x' })).toBeNull();
    expect(buildFusionSelfReview({ createdAt: 'x', run: null })).toBeNull();
    expect(buildFusionSelfReview({ createdAt: 'x', run: { schema: 'wrong' } })).toBeNull();
    expect(buildFusionSelfReview({ createdAt: 'x', run: runArt({ cells: 'not-array' }) })).toBeNull();
  });
  it('retry + advisory are OPTIONAL — a run-only review still works with retry effectiveness zeroed', () => {
    const r = buildFusionSelfReview({ createdAt: 'x', run: runArt() })!;
    expect(r.retryEffectiveness.attempted).toBe(0);
    expect(r.sources.retry).toBeNull();
    expect(r.sources.advisory).toBeNull();
  });
});

describe('fusion self-review — honest computation', () => {
  it('retry effectiveness is computed honestly from the retry artifact', () => {
    const r = buildFusionSelfReview({ createdAt: 'x', run: runArt(), retry: retryArt() })!;
    expect(r.retryEffectiveness).toMatchObject({ attempted: 2, recovered: 1, stillFailed: 1, recoveryRate: 0.5, completedBefore: 4, completedAfter: 5 });
  });
  it('non-vote patterns are COUNTS only — never a fabricated vote', () => {
    const r = buildFusionSelfReview({ createdAt: 'x', run: runArt() })!;
    expect(r.reliability.nonVotes).toBe(2);
    expect(r.nonVotePatterns.find(p => p.model === 'm2')!.count).toBe(2);
    const m2 = r.modelHealth.find(m => m.model === 'm2')!;
    expect(m2.overallVote).toBe('non_vote');   // still a non_vote, never upgraded
    expect(m2.flag).toBe('high_non_vote');
    // the review never claims a non-voting model produced a GREEN/YELLOW/RED it didn't earn
    expect(JSON.stringify(r.nonVotePatterns)).not.toMatch(/"vote"\s*:\s*"(GREEN|YELLOW|RED)"/);
  });
});

describe('fusion self-review — advisory only, never claims authority/promotion', () => {
  it('carries an explicit does-not-authorize statement and no promotion/authority claim', () => {
    const r = buildFusionSelfReview({ createdAt: 'x', run: runArt(), retry: retryArt() })!;
    expect(r.doesNotAuthorize).toMatch(/advisory only/i);
    expect(r.doesNotAuthorize).toMatch(/does not authorize/i);
    expect(r.grantsAuthority).toBe(false);
    const blob = JSON.stringify(r).toLowerCase();
    expect(blob).not.toContain('promotion_ready');
    expect(blob).not.toContain('promotionready');
    expect(blob).not.toMatch(/"grantsauthority"\s*:\s*true/);
    expect(typeof r.recommendedNextChange).toBe('string'); // a recommendation, not an action
  });
});

describe('fusion self-review — validator fails closed on authority/secret-shaped fields', () => {
  const r = () => buildFusionSelfReview({ createdAt: 'x', run: runArt() })!;
  it('rejects grantsAuthority:true / wrong schema / non-object', () => {
    expect(validateFusionSelfReview({ ...r(), grantsAuthority: true }).valid).toBe(false);
    expect(validateFusionSelfReview({ ...r(), schema: 'fusion-self-review-v0' }).valid).toBe(false);
    expect(validateFusionSelfReview(null).valid).toBe(false);
  });
  it('rejects an injected authority-shaped key and a secret-shaped value at any depth', () => {
    const a1: any = JSON.parse(JSON.stringify(r())); a1.gateUnlocked = true;
    expect(validateFusionSelfReview(a1).valid).toBe(false);
    const a2: any = JSON.parse(JSON.stringify(r())); a2.recommendedNextChange = '-----BEGIN PRIVATE KEY-----MIIBVQ';
    expect(validateFusionSelfReview(a2).valid).toBe(false);
  });
});

describe('fusion self-review — positive top-level allow-list (no unknown/shadow fields)', () => {
  const r = () => buildFusionSelfReview({ createdAt: 'x', run: runArt() })!;
  it('a valid review still passes (no change to existing valid-artifact behavior)', () => {
    expect(validateFusionSelfReview(r()).valid).toBe(true);
  });
  it('an artifact with an inert unknown top-level field fails closed', () => {
    const bad: any = { ...r(), extraSneakyField: 'harmless-looking' };
    const v = validateFusionSelfReview(bad);
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/unknown top-level key 'extraSneakyField'/);
  });
  it('an authority-shaped EXTRA top-level field fails closed', () => {
    expect(validateFusionSelfReview({ ...r(), gateUnlocked: true } as any).valid).toBe(false);
  });
  it('a secret-shaped EXTRA top-level field fails closed', () => {
    expect(validateFusionSelfReview({ ...r(), signingSeed: 'x'.repeat(64) } as any).valid).toBe(false);
  });
});

describe('fusion self-review — it is a mirror, not a hand (no forbidden imports/side-effects)', () => {
  it('imports NO signer / gate / AUMLOK / model-runner / fs / network', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'fusionSelfReview.ts'), 'utf-8');
    const imports = src.split('\n').filter(l => /^\s*import\b/.test(l)).join('\n');
    expect(imports).not.toMatch(/aumlok|signer|signPoP|signHead|externalReview|fractalFusion|run-council|from ['"]fs['"]|from ['"]node:fs['"]|from ['"]crypto|from ['"]node:crypto|child_process|from ['"]http/i);
    expect(imports).not.toMatch(/\.\/index/); // no gate/kernel entrypoint
  });
  it('performs no fs / network / spawn / server side-effect anywhere', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'fusionSelfReview.ts'), 'utf-8');
    expect(src).not.toMatch(/writeFileSync|readFileSync|appendFileSync|fetch\s*\(|createServer|Bun\.serve|Bun\.spawn|\bspawn\s*\(|execSync|\bexec\s*\(/);
  });
});
