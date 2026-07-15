import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { runSwarmReview, SwarmConfig } from '../src/fusionSwarm';
import { AdvisoryReview } from '../src/externalReview';
import { AUDIT_LENS_PROMPTS, getModelProfile } from '../src/fusionConfig';

function mockReviewFn(overrides: Partial<AdvisoryReview> = {}): (ep: string, s?: string[], o?: any) => Promise<AdvisoryReview> {
  return vi.fn(async () => ({
    verdict: 'YELLOW' as const,
    findings: 'mock finding',
    risks: 'mock risk',
    missing_tests: 'none',
    recommended_next_commit: 'next',
    confidence: 7,
    ...overrides,
  }));
}

function mockFailureFn(): (ep: string, s?: string[], o?: any) => Promise<AdvisoryReview> {
  return vi.fn(async () => ({
    verdict: 'RED' as const,
    findings: 'adapter timeout',
    risks: 'Review adapter failure/closed state.',
    missing_tests: 'N/A',
    recommended_next_commit: 'none',
    confidence: 0,
    failureReason: 'network_timeout' as const,
  }));
}

describe('21G: Swarm Orchestration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.OPENROUTER_API_KEY = 'test-swarm-key-value';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('expands plan to N instances per model', async () => {
    const reviewFn = mockReviewFn();
    const result = await runSwarmReview('evidence', {
      models: ['z-ai/glm-5.2', 'moonshotai/kimi-k2.6'],
      instancesPerModel: 3,
      reviewFn,
    });
    expect(result.plan).toHaveLength(6);
    expect(result.results).toHaveLength(6);
    expect(reviewFn).toHaveBeenCalledTimes(6);
  });

  it('each instance gets distinct lens prompt prepended', async () => {
    const calls: string[] = [];
    const reviewFn = vi.fn(async (ep: string) => {
      calls.push(ep);
      return {
        verdict: 'GREEN' as const,
        findings: 'ok', risks: 'none', missing_tests: 'none',
        recommended_next_commit: 'next', confidence: 9,
      };
    });

    await runSwarmReview('BASE_EVIDENCE', {
      models: ['z-ai/glm-5.2'],
      instancesPerModel: 5,
      reviewFn,
    });

    expect(calls).toHaveLength(5);
    const lenses = ['security', 'architecture', 'falsifiability', 'cohesion', 'cost_ops'] as const;
    for (let i = 0; i < 5; i++) {
      expect(calls[i]).toContain(`--- AUDIT LENS: ${lenses[i]} ---`);
      expect(calls[i]).toContain(AUDIT_LENS_PROMPTS[lenses[i]]);
      expect(calls[i]).toContain('BASE_EVIDENCE');
    }
  });

  it('passes correct modelSlug to each review call', async () => {
    const reviewFn = vi.fn(async () => ({
      verdict: 'GREEN' as const,
      findings: 'ok', risks: 'none', missing_tests: 'none',
      recommended_next_commit: 'next', confidence: 9,
    }));

    await runSwarmReview('evidence', {
      models: ['anthropic/claude-opus-4.8', 'z-ai/glm-5.2'],
      instancesPerModel: 1,
      reviewFn,
    });

    expect(reviewFn).toHaveBeenCalledTimes(2);
    expect(reviewFn).toHaveBeenNthCalledWith(1, expect.any(String), [], { modelSlug: 'anthropic/claude-opus-4.8' });
    expect(reviewFn).toHaveBeenNthCalledWith(2, expect.any(String), [], { modelSlug: 'z-ai/glm-5.2' });
  });

  it('dry-run makes zero review calls and returns empty results', async () => {
    const reviewFn = mockReviewFn();
    const result = await runSwarmReview('evidence', {
      models: ['z-ai/glm-5.2', 'moonshotai/kimi-k2.6'],
      instancesPerModel: 3,
      dryRun: true,
      reviewFn,
    });

    expect(reviewFn).not.toHaveBeenCalled();
    expect(result.results).toHaveLength(0);
    expect(result.plan).toHaveLength(6);
    expect(result.synthesis.consensus).toBe('NO_QUORUM');
    expect(result.advisory_only).toBe(true);
  });

  it('maxTotalCalls prevents runaway spend', async () => {
    const reviewFn = mockReviewFn();
    const result = await runSwarmReview('evidence', {
      models: ['z-ai/glm-5.2'],
      instancesPerModel: 10,
      maxTotalCalls: 3,
      reviewFn,
    });

    expect(reviewFn).toHaveBeenCalledTimes(3);
    expect(result.results).toHaveLength(3);
    expect(result.plan).toHaveLength(10);
  });

  it('adapter failures are excluded from verdict consensus', async () => {
    let callIdx = 0;
    const reviewFn = vi.fn(async (): Promise<AdvisoryReview> => {
      callIdx++;
      if (callIdx === 2) {
        return {
          verdict: 'RED',
          findings: 'adapter timeout',
          risks: 'failure',
          missing_tests: 'N/A',
          recommended_next_commit: 'none',
          confidence: 0,
          failureReason: 'network_timeout',
        };
      }
      return {
        verdict: 'GREEN',
        findings: 'ok', risks: 'none', missing_tests: 'none',
        recommended_next_commit: 'next', confidence: 8,
      };
    });

    const result = await runSwarmReview('evidence', {
      models: ['z-ai/glm-5.2'],
      instancesPerModel: 3,
      reviewFn,
    });

    expect(result.synthesis.completed_count).toBe(2);
    expect(result.synthesis.failure_count).toBe(1);
    expect(result.synthesis.red_count).toBe(0);
    expect(result.synthesis.consensus).toBe('GREEN');
  });

  it('all adapter failures produce NO_QUORUM', async () => {
    const reviewFn = mockFailureFn();
    const result = await runSwarmReview('evidence', {
      models: ['z-ai/glm-5.2'],
      instancesPerModel: 3,
      reviewFn,
    });

    expect(result.synthesis.consensus).toBe('NO_QUORUM');
    expect(result.synthesis.completed_count).toBe(0);
    expect(result.synthesis.failure_count).toBe(3);
  });

  it('result always has advisory_only flags set correctly', async () => {
    const reviewFn = mockReviewFn();
    const result = await runSwarmReview('evidence', {
      models: ['z-ai/glm-5.2'],
      instancesPerModel: 1,
      reviewFn,
    });

    expect(result.advisory_only).toBe(true);
    expect(result.authority_granted).toBe(false);
    expect(result.memory_updated).toBe(false);
    expect(result.gate_changed).toBe(false);
  });

  it('results include lens and label per instance', async () => {
    const reviewFn = mockReviewFn();
    const result = await runSwarmReview('evidence', {
      models: ['z-ai/glm-5.2'],
      instancesPerModel: 2,
      reviewFn,
    });

    expect(result.results[0].lens).toBe('security');
    expect(result.results[0].label).toBe('glm-5.2:security');
    expect(result.results[1].lens).toBe('architecture');
    expect(result.results[1].label).toBe('glm-5.2:architecture');
  });

  it('dry-run reports key source without key value', async () => {
    const reviewFn = mockReviewFn();
    const result = await runSwarmReview('evidence', {
      models: ['z-ai/glm-5.2'],
      instancesPerModel: 1,
      dryRun: true,
      reviewFn,
    });

    expect(result.key_source).toBe('process.env');
    expect(JSON.stringify(result)).not.toContain('test-swarm-key-value');
  });
});

describe('21G: Swarm Source Safety', () => {
  it('fusionSwarm.ts has no forbidden authority imports', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/fusionSwarm.ts'), 'utf-8');
    const forbidden = [
      'evaluateIntent', 'executeDecision', 'signPoP',
      'PrincipalRegistry', 'NonceLedger', 'child_process',
      'getAndCheckEdgeNodeSeed', 'EDGE_NODE_PUBLIC_KEY',
    ];
    for (const term of forbidden) {
      expect(source).not.toContain(term);
    }
  });

  it('run-opus-retry.ts has no forbidden authority imports', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../evidence/run-opus-retry.ts'), 'utf-8');
    const forbidden = [
      'evaluateIntent', 'executeDecision', 'signPoP',
      'PrincipalRegistry', 'NonceLedger',
      'getAndCheckEdgeNodeSeed', 'EDGE_NODE_PUBLIC_KEY',
    ];
    for (const term of forbidden) {
      expect(source).not.toContain(term);
    }
  });

  it('run-opus-retry.ts never logs the key value', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../evidence/run-opus-retry.ts'), 'utf-8');
    expect(source).not.toMatch(/console\.log.*keyResult\.key/);
    expect(source).not.toMatch(/console\.log.*apiKey/);
    expect(source).toContain('keyResult.source');
  });

  it('no key-shaped literals in fusionSwarm.ts', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/fusionSwarm.ts'), 'utf-8');
    expect(source).not.toMatch(/sk-or-[a-zA-Z0-9]{16,}/);
    expect(source).not.toMatch(/\b[a-fA-F0-9]{64}\b/);
  });

  it('run-opus-retry.ts uses resolveApiKey and Opus profile', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../evidence/run-opus-retry.ts'), 'utf-8');
    expect(source).toContain('resolveApiKey');
    expect(source).toContain('getModelProfile');
    expect(source).toContain('anthropic/claude-opus-4.8');
    expect(source).toContain('FUSION_DRY_RUN');
  });
});

describe('21G: Chronos Guardrails', () => {
  it('CHRONOS_GUARDRAILS.md exists and contains core constraints', () => {
    const guardrailsPath = path.resolve(__dirname, '../../chronos-lab/CHRONOS_GUARDRAILS.md');
    const content = fs.readFileSync(guardrailsPath, 'utf-8');

    expect(content).toContain('evidence only');
    expect(content).toContain('bounded');
    expect(content).not.toContain('infinite bandwidth');
    expect(content).toContain('cannot authorize');
    expect(content).toContain('jitter');
    expect(content).toContain('side-lab');
    expect(content).toContain('predictive lift');
  });
});
