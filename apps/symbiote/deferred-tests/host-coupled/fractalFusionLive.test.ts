import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildLiveShardEvidence,
  validateShardBounds,
  buildAuthorityGateReceiptsShard,
  buildMemoryBurnSleepShard,
  buildOpenCodeWombPromptShard,
  buildFusionOpsReliabilityShard,
  buildVkChronosParkedSafetyShard,
} from '../src/fractalFusionEvidence';
import {
  runFractalFusionReview,
  buildFractalArtifact,
  SHARD_NAMES,
  FractalFusionConfig,
} from '../src/fractalFusion';
import { AdvisoryReview } from '../src/externalReview';
import { validateArtifact, OpenCodeAdvisoryArtifact } from '../src/opencodeWombArtifact';

const ROOT = path.resolve(__dirname, '..');

function makeMockReviewFn(
  overrides?: Partial<Record<string, Partial<AdvisoryReview>>>,
) {
  const calls: Array<{ pack: string; model: string }> = [];
  const fn = async (
    pack: string,
    _secrets?: string[],
    opts?: { testMode?: boolean; modelSlug?: string },
  ): Promise<AdvisoryReview> => {
    const model = opts?.modelSlug ?? 'unknown';
    calls.push({ pack, model });
    const override = overrides?.[model];
    return {
      verdict: override?.verdict ?? 'GREEN',
      findings: override?.findings ?? `findings from ${model}`,
      risks: override?.risks ?? '',
      missing_tests: '',
      recommended_next_commit: override?.recommended_next_commit ?? `improve ${model}`,
      confidence: override?.confidence ?? 8,
      failureReason: override?.failureReason,
    };
  };
  return { fn, calls };
}

// ── 1. Evidence extractors ──

describe('24S.1: evidence extractors', () => {
  it('builds live shard evidence from real repo', () => {
    const evidence = buildLiveShardEvidence(ROOT);
    for (const name of SHARD_NAMES) {
      expect(evidence[name].length).toBeGreaterThan(0);
    }
  });

  it('each shard stays within budget', () => {
    const evidence = buildLiveShardEvidence(ROOT);
    const v = validateShardBounds(evidence);
    expect(v.valid).toBe(true);
    if (!v.valid) {
      for (const violation of v.violations) console.error(violation);
    }
  });

  it('authority shard references gate and receipts', () => {
    const shard = buildAuthorityGateReceiptsShard(ROOT);
    expect(shard).toContain('evaluateIntent');
    expect(shard).toContain('canonicalIntentSerialize');
  });

  it('memory shard references burn and sleep', () => {
    const shard = buildMemoryBurnSleepShard(ROOT);
    expect(shard).toContain('burn');
    expect(shard).toContain('sleep');
  });

  it('womb shard references prompt and auma', () => {
    const shard = buildOpenCodeWombPromptShard(ROOT);
    expect(shard).toContain('aumaWombPrompt');
    expect(shard).toContain('draft_only');
  });

  it('fusion shard references quorum', () => {
    const shard = buildFusionOpsReliabilityShard(ROOT);
    expect(shard).toContain('AdvisoryResult');
  });

  it('vk shard references chronos', () => {
    const shard = buildVkChronosParkedSafetyShard(ROOT);
    expect(shard).toContain('chronos');
  });

  it('no secrets in any shard', () => {
    const evidence = buildLiveShardEvidence(ROOT);
    for (const name of SHARD_NAMES) {
      expect(evidence[name]).not.toMatch(/sk-or-/);
      expect(evidence[name]).not.toMatch(/OPENROUTER_API_KEY\s*=/);
    }
  });
});

// ── 2. Live runner saves raw output before synthesis ──

describe('24S.1: live runner flow (mocked)', () => {
  it('saves raw per-model/per-shard results', async () => {
    const { fn, calls } = makeMockReviewFn();
    const evidence = buildLiveShardEvidence(ROOT);
    const config: FractalFusionConfig = {
      models: ['model-a', 'model-b'],
      concurrency: 2,
      reviewFn: fn,
    };
    const result = await runFractalFusionReview(evidence, config);
    expect(result.shardResults).toHaveLength(10);
    expect(calls).toHaveLength(10);
    for (const r of result.shardResults) {
      expect(r.shard).toBeDefined();
      expect(r.model).toBeDefined();
      expect(r.lens).toBeDefined();
    }
  });

  it('failureReason propagates into retry pack', async () => {
    const { fn } = makeMockReviewFn({
      'model-fail': { failureReason: 'schema_mismatch' as any, verdict: 'RED' },
    });
    const evidence = buildLiveShardEvidence(ROOT);
    const config: FractalFusionConfig = {
      models: ['model-ok', 'model-fail'],
      concurrency: 2,
      reviewFn: fn,
    };
    const result = await runFractalFusionReview(evidence, config);
    const failed = result.shardResults.filter(r => r.adapterFailure);
    expect(failed.length).toBe(5);
    expect(result.retryPacks.length).toBeGreaterThan(0);
    for (const pack of result.retryPacks) {
      expect(pack.failedModels).toContain('model-fail');
    }
  });

  it('adapter failures excluded from verdicts', async () => {
    const { fn } = makeMockReviewFn({
      'model-fail': { failureReason: 'invalid_json' as any, verdict: 'RED' },
    });
    const evidence = buildLiveShardEvidence(ROOT);
    const config: FractalFusionConfig = {
      models: ['model-ok', 'model-fail'],
      concurrency: 2,
      reviewFn: fn,
    };
    const result = await runFractalFusionReview(evidence, config);
    expect(result.overallConsensus).toBe('GREEN');
    expect(result.overallQuorum.status).not.toBe('RED_QUORUM');
  });
});

// ── 3. Artifact bridge ──

describe('24S.1: artifact bridge', () => {
  it('current_fractal_fusion_sweep validates in artifact', async () => {
    const { fn } = makeMockReviewFn();
    const evidence = buildLiveShardEvidence(ROOT);
    const config: FractalFusionConfig = {
      models: ['model-a', 'model-b', 'model-c'],
      concurrency: 3,
      reviewFn: fn,
    };
    const result = await runFractalFusionReview(evidence, config);
    const fractalArtifact = buildFractalArtifact(result);

    const artifact: OpenCodeAdvisoryArtifact = {
      consensus: 'GREEN',
      findings_summary: 'live fractal sweep',
      risks_summary: 'none',
      recommended_next: 'next commit',
      timestamp: new Date().toISOString(),
      advisory_only: true,
      current_fractal_fusion_sweep: fractalArtifact,
    };
    const v = validateArtifact(artifact);
    expect(v.valid).toBe(true);
  });

  it('no secrets in live result artifact', async () => {
    const { fn } = makeMockReviewFn();
    const evidence = buildLiveShardEvidence(ROOT);
    const config: FractalFusionConfig = {
      models: ['model-a'],
      concurrency: 1,
      reviewFn: fn,
    };
    const result = await runFractalFusionReview(evidence, config);
    const fractalArtifact = buildFractalArtifact(result);
    const json = JSON.stringify(fractalArtifact);
    expect(json).not.toMatch(/sk-or-/);
    expect(json).not.toMatch(/OPENROUTER_API_KEY/);
    expect(json).not.toMatch(/privateKey/);
    expect(json).not.toMatch(/signedHead/);
  });
});

// ── 4. Structural invariants ──

describe('24S.1: structural invariants', () => {
  it('fractalFusionEvidence.ts does not import authority modules', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'fractalFusionEvidence.ts'), 'utf-8');
    expect(src).not.toContain("from './index'");
    expect(src).not.toContain("from './patchApproval'");
    expect(src).not.toContain("from './crypto'");
  });

  it('no AUMA-ONE references in fractal modules', () => {
    const files = ['fractalFusion.ts', 'fractalFusionEvidence.ts'];
    for (const file of files) {
      const src = fs.readFileSync(path.join(ROOT, 'src', file), 'utf-8');
      expect(src).not.toContain('AUMA-ONE');
      expect(src).not.toContain('auma-one-app');
    }
  });

  it('no Nebius calls in fractal modules', () => {
    const files = ['fractalFusion.ts', 'fractalFusionEvidence.ts'];
    for (const file of files) {
      const src = fs.readFileSync(path.join(ROOT, 'src', file), 'utf-8');
      expect(src).not.toMatch(/\bfetch\s*\(/);
      expect(src).not.toContain('nebius');
    }
  });

  it('no authority imports in fractal modules', () => {
    const files = ['fractalFusion.ts', 'fractalFusionEvidence.ts'];
    for (const file of files) {
      const src = fs.readFileSync(path.join(ROOT, 'src', file), 'utf-8');
      const importLines = src.split('\n').filter(l => /^\s*import\s/.test(l));
      for (const line of importLines) {
        expect(line).not.toContain("from './index'");
        expect(line).not.toContain("from './crypto'");
        expect(line).not.toContain("from './patchApproval'");
      }
    }
  });

  it('live runner script exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'evidence', 'run-24s1-live-fractal-fusion.ts'))).toBe(true);
  });

  it('live runner uses performExternalReview as reviewFn', () => {
    const src = fs.readFileSync(path.join(ROOT, 'evidence', 'run-24s1-live-fractal-fusion.ts'), 'utf-8');
    expect(src).toContain('performExternalReview');
    expect(src).toContain('reviewFn: performExternalReview');
  });

  it('live runner saves raw results before artifact update', () => {
    const src = fs.readFileSync(path.join(ROOT, 'evidence', 'run-24s1-live-fractal-fusion.ts'), 'utf-8');
    expect(src).toContain('24s1-fractal-fusion-live-results.json');
    const rawWriteIdx = src.indexOf("writeFileSync(\n    path.join(EVIDENCE, '24s1-fractal-fusion-live-results.json')");
    const artifactWriteIdx = src.indexOf("writeFileSync(artifactPath");
    expect(rawWriteIdx).toBeGreaterThan(-1);
    expect(artifactWriteIdx).toBeGreaterThan(-1);
    expect(rawWriteIdx).toBeLessThan(artifactWriteIdx);
  });

  it('apply lane is still NOT BUILT', () => {
    const pathMd = fs.readFileSync(path.join(ROOT, '..', '..', 'AUKORA_SINGULARITY_PATH.md'), 'utf-8');
    expect(pathMd).toContain('Apply Lane | NOT BUILT');
  });
});
