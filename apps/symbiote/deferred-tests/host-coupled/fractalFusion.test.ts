import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  SHARD_NAMES,
  ShardName,
  ShardEvidence,
  buildContextShards,
  buildFractalSwarmPlan,
  DEFAULT_LENS_ASSIGNMENT,
  runFractalFusionReview,
  INTEGRATOR_MANDATORY_QUESTIONS,
  buildFractalArtifact,
  FractalFusionArtifactState,
  FractalFusionConfig,
} from '../src/fractalFusion';
import { AdvisoryReview } from '../src/externalReview';
import { validateArtifact, OpenCodeAdvisoryArtifact } from '../src/opencodeWombArtifact';

const ROOT = path.resolve(__dirname, '..');

function makeEvidence(): ShardEvidence {
  return {
    authority_gate_receipts: 'gate: evaluateIntent, receipts: canonical, no model-owned keys',
    memory_burn_sleep: 'burn dataset v0 complete, sleep skill advisory, structural memory intact',
    opencode_womb_prompt: 'prompt scanner: NFKC + zero-width, response scanner: past-tense, mock Auma v0',
    fusion_ops_reliability: 'quorum: GREEN_QUORUM policy, retry packs, failureReason propagation',
    vk_chronos_parked_safety: 'VK dojo NULL both worlds, Chronos parked, no live probes',
  };
}

function makeMockReviewFn(
  overrides?: Partial<Record<string, Partial<AdvisoryReview>>>,
): (pack: string, secrets?: string[], opts?: { testMode?: boolean; modelSlug?: string }) => Promise<AdvisoryReview> {
  return async (pack, _secrets, opts) => {
    const model = opts?.modelSlug ?? 'unknown';
    const override = overrides?.[model];
    return {
      verdict: override?.verdict ?? 'GREEN',
      findings: override?.findings ?? `findings from ${model}`,
      risks: override?.risks ?? '',
      missing_tests: '',
      recommended_next_commit: override?.recommended_next_commit ?? `improve shard evidence for ${model}`,
      confidence: override?.confidence ?? 8,
      failureReason: override?.failureReason,
    };
  };
}

const PRIME_MODELS = [
  'anthropic/claude-opus-4.8',
  'z-ai/glm-5.2',
  'moonshotai/kimi-k2.6',
  'deepseek/deepseek-v4-pro',
  'qwen/qwen3-coder',
];

// ── 1. Context sharding ──

describe('24S: context sharding', () => {
  it('produces exactly 5 shards', () => {
    const shards = buildContextShards(makeEvidence());
    expect(shards).toHaveLength(5);
  });

  it('each shard has correct name and label', () => {
    const shards = buildContextShards(makeEvidence());
    for (const shard of shards) {
      expect(SHARD_NAMES).toContain(shard.name);
      expect(shard.label).toBe(shard.name.replace(/_/g, ' '));
    }
  });

  it('shard evidence is bounded at maxBytes', () => {
    const evidence = makeEvidence();
    evidence.authority_gate_receipts = 'x'.repeat(50_000);
    const shards = buildContextShards(evidence);
    const gateShard = shards.find(s => s.name === 'authority_gate_receipts')!;
    expect(gateShard.evidencePack.length).toBeLessThanOrEqual(gateShard.maxBytes);
  });

  it('shards are distinct and labeled', () => {
    const shards = buildContextShards(makeEvidence());
    const names = shards.map(s => s.name);
    expect(new Set(names).size).toBe(5);
  });

  it('empty evidence produces empty shard packs', () => {
    const evidence: ShardEvidence = {
      authority_gate_receipts: '',
      memory_burn_sleep: '',
      opencode_womb_prompt: '',
      fusion_ops_reliability: '',
      vk_chronos_parked_safety: '',
    };
    const shards = buildContextShards(evidence);
    for (const s of shards) {
      expect(s.evidencePack).toBe('');
    }
  });
});

// ── 2. Fractal swarm plan ──

describe('24S: fractal swarm plan', () => {
  it('plan has (shards x models) entries', () => {
    const shards = buildContextShards(makeEvidence());
    const plan = buildFractalSwarmPlan(shards, PRIME_MODELS, DEFAULT_LENS_ASSIGNMENT);
    expect(plan).toHaveLength(5 * 5);
  });

  it('each plan entry preserves shard/model/lens identity', () => {
    const shards = buildContextShards(makeEvidence());
    const plan = buildFractalSwarmPlan(shards, PRIME_MODELS, DEFAULT_LENS_ASSIGNMENT);
    for (const entry of plan) {
      expect(SHARD_NAMES).toContain(entry.shard);
      expect(PRIME_MODELS).toContain(entry.model);
      expect(entry.label).toContain(entry.shard);
    }
  });

  it('lens assignment matches shard', () => {
    const shards = buildContextShards(makeEvidence());
    const plan = buildFractalSwarmPlan(shards, PRIME_MODELS, DEFAULT_LENS_ASSIGNMENT);
    for (const entry of plan) {
      expect(entry.lens).toBe(DEFAULT_LENS_ASSIGNMENT[entry.shard]);
    }
  });
});

// ── 3. Parallel runner ──

describe('24S: parallel fractal runner', () => {
  it('runs all shard/model combinations', async () => {
    const config: FractalFusionConfig = {
      models: PRIME_MODELS,
      concurrency: 3,
      reviewFn: makeMockReviewFn(),
    };
    const result = await runFractalFusionReview(makeEvidence(), config);
    expect(result.shardResults).toHaveLength(25);
    expect(result.advisory_only).toBe(true);
    expect(result.authority_granted).toBe(false);
  });

  it('preserves shard/model/lens in each result', async () => {
    const config: FractalFusionConfig = {
      models: PRIME_MODELS,
      concurrency: 5,
      reviewFn: makeMockReviewFn(),
    };
    const result = await runFractalFusionReview(makeEvidence(), config);
    for (const r of result.shardResults) {
      expect(SHARD_NAMES).toContain(r.shard);
      expect(PRIME_MODELS).toContain(r.model);
      expect(r.label).toContain(r.shard);
    }
  });

  it('bounded concurrency: runs with concurrency=1', async () => {
    const callOrder: string[] = [];
    const reviewFn = async (pack: string, _s?: string[], opts?: { modelSlug?: string }) => {
      callOrder.push(opts?.modelSlug ?? 'unknown');
      return {
        verdict: 'GREEN' as const,
        findings: 'ok',
        risks: '',
        missing_tests: '',
        recommended_next_commit: 'next',
        confidence: 8,
      };
    };
    const config: FractalFusionConfig = {
      models: ['model-a', 'model-b'],
      concurrency: 1,
      reviewFn,
    };
    const result = await runFractalFusionReview(makeEvidence(), config);
    expect(result.shardResults).toHaveLength(10);
    expect(callOrder).toHaveLength(10);
  });

  it('adapter failures excluded from verdicts', async () => {
    const config: FractalFusionConfig = {
      models: PRIME_MODELS,
      concurrency: 5,
      reviewFn: makeMockReviewFn({
        'moonshotai/kimi-k2.6': { failureReason: 'schema_mismatch' as any, verdict: 'RED' },
      }),
    };
    const result = await runFractalFusionReview(makeEvidence(), config);
    const kimiResults = result.shardResults.filter(r => r.model === 'moonshotai/kimi-k2.6');
    expect(kimiResults.every(r => r.adapterFailure)).toBe(true);
    expect(result.overallConsensus).toBe('GREEN');
    expect(result.overallQuorum.status).not.toBe('RED_QUORUM');
  });

  it('failed shards create retry packs', async () => {
    const config: FractalFusionConfig = {
      models: PRIME_MODELS,
      concurrency: 5,
      reviewFn: makeMockReviewFn({
        'moonshotai/kimi-k2.6': { failureReason: 'invalid_json' as any, verdict: 'RED' },
      }),
    };
    const result = await runFractalFusionReview(makeEvidence(), config);
    expect(result.retryPacks.length).toBeGreaterThan(0);
    for (const pack of result.retryPacks) {
      expect(pack.failedModels).toContain('moonshotai/kimi-k2.6');
    }
  });

  it('dryRun returns empty results without calling reviewFn', async () => {
    let called = false;
    const config: FractalFusionConfig = {
      models: PRIME_MODELS,
      concurrency: 5,
      dryRun: true,
      reviewFn: async () => { called = true; return {} as any; },
    };
    const result = await runFractalFusionReview(makeEvidence(), config);
    expect(called).toBe(false);
    expect(result.shardResults).toHaveLength(0);
    expect(result.advisory_only).toBe(true);
  });

  it('per-shard synthesis available for each shard', async () => {
    const config: FractalFusionConfig = {
      models: PRIME_MODELS,
      concurrency: 5,
      reviewFn: makeMockReviewFn(),
    };
    const result = await runFractalFusionReview(makeEvidence(), config);
    for (const name of SHARD_NAMES) {
      expect(result.perShardSynthesis[name]).toBeDefined();
      expect(result.perShardSynthesis[name].completed_count).toBe(5);
    }
  });

  it('YELLOW verdict models shift consensus', async () => {
    const config: FractalFusionConfig = {
      models: PRIME_MODELS,
      concurrency: 5,
      reviewFn: makeMockReviewFn({
        'anthropic/claude-opus-4.8': { verdict: 'YELLOW' },
        'z-ai/glm-5.2': { verdict: 'YELLOW' },
        'deepseek/deepseek-v4-pro': { verdict: 'YELLOW' },
      }),
    };
    const result = await runFractalFusionReview(makeEvidence(), config);
    expect(result.overallConsensus).toBe('YELLOW');
  });
});

// ── 4. Integrator ──

describe('24S: integrator pass', () => {
  it('integrator input includes all shard summaries', async () => {
    const config: FractalFusionConfig = {
      models: PRIME_MODELS,
      concurrency: 5,
      reviewFn: makeMockReviewFn(),
    };
    const result = await runFractalFusionReview(makeEvidence(), config);
    const input = result.integratorInput;
    expect(input.shardSummaries).toHaveLength(5);
    for (const name of SHARD_NAMES) {
      expect(input.shardSummaries.some(s => s.shard === name)).toBe(true);
    }
  });

  it('self-improvement question is mandatory', async () => {
    const config: FractalFusionConfig = {
      models: PRIME_MODELS,
      concurrency: 5,
      reviewFn: makeMockReviewFn(),
    };
    const result = await runFractalFusionReview(makeEvidence(), config);
    expect(result.integratorInput.mandatoryQuestions).toEqual(INTEGRATOR_MANDATORY_QUESTIONS);
    expect(result.integratorInput.mandatoryQuestions).toContain('What should Fusion improve about itself?');
  });

  it('self-improvement notes collected from all completed models', async () => {
    const config: FractalFusionConfig = {
      models: PRIME_MODELS,
      concurrency: 5,
      reviewFn: makeMockReviewFn({
        'anthropic/claude-opus-4.8': { recommended_next_commit: 'shard evidence should include test counts' },
      }),
    };
    const result = await runFractalFusionReview(makeEvidence(), config);
    expect(result.integratorInput.selfImprovementNotes.length).toBeGreaterThan(0);
  });

  it('adapter failures listed in integrator input', async () => {
    const config: FractalFusionConfig = {
      models: PRIME_MODELS,
      concurrency: 5,
      reviewFn: makeMockReviewFn({
        'moonshotai/kimi-k2.6': { failureReason: 'schema_mismatch' as any, verdict: 'RED' },
      }),
    };
    const result = await runFractalFusionReview(makeEvidence(), config);
    expect(result.integratorInput.adapterFailures.length).toBeGreaterThan(0);
    expect(result.integratorInput.adapterFailures.every(f => f.model === 'moonshotai/kimi-k2.6')).toBe(true);
  });

  it('disagreement points detected when verdicts differ', async () => {
    const config: FractalFusionConfig = {
      models: ['model-green', 'model-yellow'],
      concurrency: 2,
      reviewFn: makeMockReviewFn({
        'model-green': { verdict: 'GREEN' },
        'model-yellow': { verdict: 'YELLOW' },
      }),
    };
    const result = await runFractalFusionReview(makeEvidence(), config);
    expect(result.integratorInput.disagreementPoints.length).toBeGreaterThan(0);
  });

  it('repeated risks detected across shards', async () => {
    const config: FractalFusionConfig = {
      models: PRIME_MODELS,
      concurrency: 5,
      reviewFn: makeMockReviewFn({
        'anthropic/claude-opus-4.8': { risks: 'mock Auma is still advisory stub' },
        'z-ai/glm-5.2': { risks: 'mock responder in Auma prompt, stub config' },
        'deepseek/deepseek-v4-pro': { risks: 'authority escalation through mock apply' },
      }),
    };
    const result = await runFractalFusionReview(makeEvidence(), config);
    const mockRisk = result.integratorInput.repeatedRisks.find(r => r.includes('"mock"'));
    expect(mockRisk).toBeDefined();
  });
});

// ── 5. Artifact integration ──

describe('24S: fractal artifact integration', () => {
  it('builds artifact from result', async () => {
    const config: FractalFusionConfig = {
      models: PRIME_MODELS,
      concurrency: 5,
      reviewFn: makeMockReviewFn(),
    };
    const result = await runFractalFusionReview(makeEvidence(), config);
    const artifact = buildFractalArtifact(result);
    expect(artifact.advisoryOnly).toBe(true);
    expect(artifact.grantsAuthority).toBe(false);
    expect(artifact.shardSummaries).toHaveLength(5);
  });

  it('artifact validates in OpenCodeAdvisoryArtifact', async () => {
    const config: FractalFusionConfig = {
      models: PRIME_MODELS,
      concurrency: 5,
      reviewFn: makeMockReviewFn(),
    };
    const result = await runFractalFusionReview(makeEvidence(), config);
    const fractalArtifact = buildFractalArtifact(result);

    const artifact: OpenCodeAdvisoryArtifact = {
      consensus: 'GREEN',
      findings_summary: 'test',
      risks_summary: 'test',
      recommended_next: 'test',
      timestamp: new Date().toISOString(),
      advisory_only: true,
      current_fractal_fusion_sweep: fractalArtifact,
    };
    const v = validateArtifact(artifact);
    expect(v.valid).toBe(true);
  });

  it('artifact rejects grantsAuthority: true', () => {
    const artifact: OpenCodeAdvisoryArtifact = {
      consensus: 'GREEN',
      findings_summary: 'test',
      risks_summary: 'test',
      recommended_next: 'test',
      timestamp: new Date().toISOString(),
      advisory_only: true,
      current_fractal_fusion_sweep: {
        quorumStatus: 'GREEN_QUORUM',
        consensus: 'GREEN',
        shardSummaries: [],
        topRisks: [],
        nextRecommendation: '',
        selfImprovementNotes: [],
        adapterFailureCount: 0,
        advisoryOnly: true,
        grantsAuthority: true as any,
      },
    };
    const v = validateArtifact(artifact);
    expect(v.valid).toBe(false);
    expect(v.violations.some(vi => vi.includes('grantsAuthority'))).toBe(true);
  });

  it('artifact includes self-improvement notes', async () => {
    const config: FractalFusionConfig = {
      models: PRIME_MODELS,
      concurrency: 5,
      reviewFn: makeMockReviewFn(),
    };
    const result = await runFractalFusionReview(makeEvidence(), config);
    const artifact = buildFractalArtifact(result);
    expect(artifact.selfImprovementNotes.length).toBeGreaterThan(0);
  });

  it('no secrets in artifact', async () => {
    const config: FractalFusionConfig = {
      models: PRIME_MODELS,
      concurrency: 5,
      reviewFn: makeMockReviewFn(),
    };
    const result = await runFractalFusionReview(makeEvidence(), config);
    const artifact = buildFractalArtifact(result);
    const json = JSON.stringify(artifact);
    expect(json).not.toMatch(/sk-or-/);
    expect(json).not.toMatch(/OPENROUTER_API_KEY/);
    expect(json).not.toMatch(/privateKey/);
    expect(json).not.toMatch(/signedHead/);
  });
});

// ── 6. Structural invariants ──

describe('24S: structural invariants', () => {
  it('fractalFusion.ts does not import authority modules', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'fractalFusion.ts'), 'utf-8');
    expect(src).not.toContain("from './index'");
    expect(src).not.toContain("from './patchApproval'");
    expect(src).not.toContain("from './crypto'");
    expect(src).not.toMatch(/\bfetch\s*\(/);
  });

  it('fractalFusion.ts advisory_only and authority_granted are typed constants', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'fractalFusion.ts'), 'utf-8');
    expect(src).toContain('advisory_only: true');
    expect(src).toContain('authority_granted: false');
  });

  it('no live external calls in fractalFusion', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'fractalFusion.ts'), 'utf-8');
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toContain('openrouter');
    expect(src).not.toContain('OPENROUTER_API_KEY');
  });

  it('integrator mandatory questions include self-improvement', () => {
    expect(INTEGRATOR_MANDATORY_QUESTIONS).toContain('What should Fusion improve about itself?');
    expect(INTEGRATOR_MANDATORY_QUESTIONS).toContain('Is the organism cohesive?');
    expect(INTEGRATOR_MANDATORY_QUESTIONS).toContain('What is embarrassing or unwired?');
    expect(INTEGRATOR_MANDATORY_QUESTIONS).toContain('What is the next smallest safe commit?');
  });

  it('apply lane is still NOT BUILT', () => {
    const pathMd = fs.readFileSync(path.join(ROOT, '..', '..', 'AUKORA_SINGULARITY_PATH.md'), 'utf-8');
    expect(pathMd).toContain('Apply Lane | NOT BUILT');
  });
});
