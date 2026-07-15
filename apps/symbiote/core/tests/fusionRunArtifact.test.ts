// fusion-run-v1 — the read-only OBSERVER artifact Aukora FU renders. Hardened: advisory in, never authority
// out. Non-votes stay non-votes; derived distributions are bounded + normalized; the JS divergence matrix is
// symmetric with a zero diagonal and no NaN; non-vote rows/cols are N/A (-1); the contrarian is derived from
// divergence only; and no secrets / prompts / authority-shaped keys/values may appear (validator fails closed).
import { describe, it, expect } from 'vitest';
import {
  buildFusionRunArtifact, validateFusionRunArtifact, jsDivergence, deriveDistribution, FUSION_RUN_SCHEMA,
} from '../src/fusionRunArtifact';
import { evaluateFusionQuorum } from '../src/fusionConfig';

const mk = (model: string, label: string, verdict: 'GREEN' | 'YELLOW' | 'RED', over: Record<string, unknown> = {}) => ({
  model, label, lens: 'security', durationMs: 10, adapterFailure: false, provider_contacted: true, verdict, confidence: 0.8, findings: 'ok', risks: 'none', ...over,
});
const nonVote = (model: string, label: string, reason = 'empty_response') => ({
  model, label, lens: 'security', durationMs: 5, adapterFailure: true, failureReason: reason, provider_contacted: true, verdict: 'RED', confidence: 0,
});

const sampleRun = (extra: any[] = []) => {
  const results = [
    mk('m1', 's1', 'GREEN'), mk('m1', 's2', 'GREEN'),
    mk('m2', 's1', 'GREEN'), mk('m2', 's2', 'YELLOW'),
    mk('m3', 's1', 'RED'), mk('m3', 's2', 'RED'),
    nonVote('m4', 's1'), nonVote('m4', 's2'), // m4 never responds
    ...extra,
  ];
  const quorum = evaluateFusionQuorum(results as any);
  return buildFusionRunArtifact({ runId: 'run-x', createdAt: '2026-07-01T00:00:00.000Z', target: 'seed', council: ['m1', 'm2', 'm3', 'm4'], results: results as any, quorum, governanceLines: ['line 1', 'line 2'] });
};

describe('fusion-run-v1 #1 — schema + advisory posture', () => {
  it('schema is exactly fusion-run-v1; advisoryOnly true; grantsAuthority false; validator passes', () => {
    const a = sampleRun();
    expect(a.schema).toBe(FUSION_RUN_SCHEMA);
    expect(a.schema).toBe('fusion-run-v1');
    expect(a.advisoryOnly).toBe(true);
    expect(a.grantsAuthority).toBe(false);
    expect(validateFusionRunArtifact(a).valid).toBe(true);
  });
});

describe('fusion-run-v1 #2 — non-votes remain non-votes (never a fake RED/YELLOW/GREEN)', () => {
  it('m4 (adapter failure) classifies as non_vote in every cell despite a raw verdict of RED', () => {
    const a = sampleRun();
    const m4 = a.cells.filter(c => c.model === 'm4');
    expect(m4).toHaveLength(2);
    expect(m4.every(c => c.vote === 'non_vote')).toBe(true);
    expect(m4.every(c => c.confidence === 0)).toBe(true);
    const m4agg = a.models.find(m => m.model === 'm4')!;
    expect(m4agg.overallVote).toBe('non_vote');
    expect(a.nonVotes.map(n => n.model)).toContain('m4');
  });
});

describe('fusion-run-v1 #3 — derived distributions are bounded + normalized + honest', () => {
  it('every cell distribution is in [0,1] and sums to 1', () => {
    for (const c of sampleRun().cells) {
      for (const v of [c.dist.g, c.dist.y, c.dist.r]) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(1);
      expect(c.dist.g + c.dist.y + c.dist.r).toBeCloseTo(1, 9);
    }
  });
  it('a non_vote derives the maximally-uncertain distribution (never a verdict mass)', () => {
    const d = deriveDistribution('non_vote', 0);
    expect(d).toEqual({ g: 1 / 3, y: 1 / 3, r: 1 / 3 });
  });
});

describe('fusion-run-v1 #4 — JS divergence matrix is symmetric, zero-diagonal, NaN-free; non-votes are N/A', () => {
  it('symmetric with a zero diagonal, all finite, and bounded [0,1] for completed pairs', () => {
    const a = sampleRun();
    const js = a.divergenceMatrix.js;
    for (let i = 0; i < js.length; i++) {
      expect(js[i][i]).toBe(0);
      for (let j = 0; j < js.length; j++) {
        expect(Number.isNaN(js[i][j])).toBe(false);
        expect(js[i][j]).toBe(js[j][i]); // symmetric
        if (js[i][j] >= 0) expect(js[i][j]).toBeLessThanOrEqual(1);
      }
    }
  });
  it('the non-vote model (m4) has N/A (-1) rows and columns except its own diagonal', () => {
    const a = sampleRun();
    const idx = a.divergenceMatrix.models.indexOf('m4');
    for (let j = 0; j < a.divergenceMatrix.js.length; j++) {
      if (j === idx) continue;
      expect(a.divergenceMatrix.js[idx][j]).toBe(-1);
      expect(a.divergenceMatrix.js[j][idx]).toBe(-1);
    }
    expect(a.models.find(m => m.model === 'm4')!.meanDivergence).toBe(-1);
  });
  it('jsDivergence itself is symmetric, 0 for identical, and bounded', () => {
    const p = { g: 0.8, y: 0.1, r: 0.1 }, q = { g: 0.1, y: 0.1, r: 0.8 };
    expect(jsDivergence(p, p)).toBeCloseTo(0, 9);
    expect(jsDivergence(p, q)).toBeCloseTo(jsDivergence(q, p), 9);
    expect(jsDivergence(p, q)).toBeGreaterThan(0);
    expect(jsDivergence(p, q)).toBeLessThanOrEqual(1);
  });
});

describe('fusion-run-v1 #5 — contrarian is derived from divergence only', () => {
  it('the highest mean-divergence completed model is the contrarian (m3, the lone RED voter)', () => {
    const a = sampleRun();
    expect(a.contrarian).not.toBeNull();
    expect(a.contrarian!.model).toBe('m3');
    const flagged = a.models.filter(m => m.isContrarian);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].model).toBe('m3');
    // it is chosen by meanDivergence, not by verdict label
    expect(a.models.find(m => m.model === 'm3')!.meanDivergence).toBeGreaterThan(0);
  });
  it('fewer than two completed models => no contrarian', () => {
    const results = [mk('m1', 's1', 'GREEN'), nonVote('m2', 's1')];
    const q = evaluateFusionQuorum(results as any);
    const a = buildFusionRunArtifact({ runId: 'r', createdAt: '2026-07-01T00:00:00.000Z', target: 't', council: ['m1', 'm2'], results: results as any, quorum: q, governanceLines: [] });
    expect(a.contrarian).toBeNull();
    expect(a.models.some(m => m.isContrarian)).toBe(false);
  });
});

describe('fusion-run-v1 #6 — no secrets / prompts / authority material in the artifact', () => {
  it('a clean run contains no secret/prompt/authority-shaped string', () => {
    const blob = JSON.stringify(sampleRun()).toLowerCase();
    for (const banned of ['signature', '"pop"', '\\bnonce\\b', 'privatekey', 'private_key', 'apikey', 'api_key', 'bearer ', 'secretkey', '-----begin', 'chain-of-thought', 'rawprompt']) {
      expect(new RegExp(banned).test(blob)).toBe(false);
    }
  });
  it('model-derived findings with secret-shaped content are REDACTED on build', () => {
    const a = sampleRun([mk('m1', 's3', 'GREEN', { findings: 'leak sk-abcdefghijklmnop and ' + 'a'.repeat(64), risks: '' })]);
    const cell = a.cells.find(c => c.model === 'm1' && c.shard === 's3')!;
    expect(cell.findingSummary).toBe('[redacted — secret-shaped content]');
    expect(validateFusionRunArtifact(a).valid).toBe(true); // still valid because it was scrubbed
  });
});

describe('fusion-run-v1 #7 — validator fails CLOSED on authority-shaped keys/values at any depth', () => {
  const clone = (a: any) => JSON.parse(JSON.stringify(a));
  it('rejects grantsAuthority:true / advisoryOnly:false / wrong schema / non-object', () => {
    expect(validateFusionRunArtifact({ ...sampleRun(), grantsAuthority: true } as any).valid).toBe(false);
    expect(validateFusionRunArtifact({ ...sampleRun(), advisoryOnly: false } as any).valid).toBe(false);
    expect(validateFusionRunArtifact({ ...sampleRun(), schema: 'fusion-run-v0' } as any).valid).toBe(false);
    expect(validateFusionRunArtifact(null).valid).toBe(false);
    expect(validateFusionRunArtifact([sampleRun()] as any).valid).toBe(false);
  });
  it('rejects an authority-shaped key nested deep in the grid', () => {
    const bad = clone(sampleRun());
    bad.models[0].gateUnlocked = true;
    expect(validateFusionRunArtifact(bad).valid).toBe(false);
    const bad2 = clone(sampleRun());
    bad2.cells[0].promote = true;
    expect(validateFusionRunArtifact(bad2).valid).toBe(false);
  });
  it('rejects a secret/PoP/private-key KEY and a secret-shaped VALUE at any depth', () => {
    const badKey = clone(sampleRun());
    badKey.perShard[0].signingSeed = 'x';
    expect(validateFusionRunArtifact(badKey).valid).toBe(false);
    const badVal = clone(sampleRun());
    badVal.target = '-----BEGIN PRIVATE KEY-----MIIBVQIBADAN';
    expect(validateFusionRunArtifact(badVal).valid).toBe(false);
  });
});

describe('fusion-run-v1 #8 — shard labels are normalized (group by real shard, not per model×shard)', () => {
  const res = (model: string, label: string, verdict: 'GREEN' | 'YELLOW' | 'RED', over: Record<string, unknown> = {}) => ({
    model, label, lens: 'security', durationMs: 1, adapterFailure: false, provider_contacted: true, verdict, confidence: 0.8, findings: '', risks: '', ...over,
  });
  const build = (results: any[], council: string[]) =>
    buildFusionRunArtifact({ runId: 'r', createdAt: '2026-07-01T00:00:00.000Z', target: 't', council, results: results as any, quorum: evaluateFusionQuorum(results as any), governanceLines: [] });

  it('a "model:shard:category" label groups under the real shard, and cells keep the normalized name', () => {
    const a = build([res('m1', 'm1:authority_gate:security', 'GREEN'), res('m2', 'm2:authority_gate:security', 'RED')], ['m1', 'm2']);
    expect(a.shards).toEqual(['authority_gate']);                  // one real shard, not two model-labels
    expect(a.cells.every(c => c.shard === 'authority_gate')).toBe(true);
    expect(a.perShard).toHaveLength(1);                            // ONE per-shard row (not N fake rows)
    expect(a.perShard[0].shard).toBe('authority_gate');
    expect(a.perShard[0].consensusStrength).toBeLessThan(1);       // real consensus (GREEN vs RED), not a fake 100%
  });

  it('per-shard consensus is one row per real shard (3 models × 2 shards => 2 rows, not 6)', () => {
    const results: any[] = [];
    for (const m of ['m1', 'm2', 'm3']) for (const s of ['authority_gate', 'memory_burn']) results.push(res(m, `${m}:${s}:security`, 'GREEN', { confidence: 0.7 }));
    const a = build(results, ['m1', 'm2', 'm3']);
    expect(a.shards.slice().sort()).toEqual(['authority_gate', 'memory_burn']);
    expect(a.perShard).toHaveLength(2);
    expect(a.perShard.map(p => p.shard).slice().sort()).toEqual(['authority_gate', 'memory_burn']);
  });

  it('old / simple labels (no colons) still work unchanged', () => {
    const a = build([res('m1', 'simpleshard', 'GREEN'), res('m2', 'simpleshard', 'YELLOW')], ['m1', 'm2']);
    expect(a.shards).toEqual(['simpleshard']);
    expect(a.cells.every(c => c.shard === 'simpleshard')).toBe(true);
  });

  it('non-votes remain non-votes after normalization', () => {
    const a = build([
      res('m1', 'm1:authority_gate:security', 'GREEN'),
      res('m2', 'm2:authority_gate:security', 'RED', { adapterFailure: true, failureReason: 'empty_response', confidence: 0 }),
    ], ['m1', 'm2']);
    const m2 = a.cells.find(c => c.model === 'm2')!;
    expect(m2.vote).toBe('non_vote');
    expect(m2.shard).toBe('authority_gate');
  });
});

describe('fusion-run-v1 #9 — positive top-level allow-list (no unknown/shadow fields)', () => {
  it('a valid artifact still passes (no change to existing valid-artifact behavior)', () => {
    expect(validateFusionRunArtifact(sampleRun()).valid).toBe(true);
  });
  it('an artifact with an inert unknown top-level field fails closed', () => {
    const bad = { ...sampleRun(), extraSneakyField: 'harmless-looking' } as any;
    const v = validateFusionRunArtifact(bad);
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/unknown top-level key 'extraSneakyField'/);
  });
  it('an authority-shaped EXTRA top-level field fails closed', () => {
    const bad = { ...sampleRun(), gateUnlocked: true } as any;
    expect(validateFusionRunArtifact(bad).valid).toBe(false);
  });
  it('a secret-shaped EXTRA top-level field fails closed', () => {
    const bad = { ...sampleRun(), signingSeed: 'x'.repeat(64) } as any;
    expect(validateFusionRunArtifact(bad).valid).toBe(false);
  });
});
