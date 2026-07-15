import { describe, it, expect } from 'vitest';
import {
  FULL_FORCE_COUNCIL, OPTIONAL_COUNCIL, FULL_FORCE_COUNCIL_WITH_OPTIONAL,
  classifyVote, evaluateFusionQuorum, AdvisoryResult,
} from '../src/fusionConfig';

// 24Z.8 — central council membership. Fixes the drift where expanded runners hardcoded a stale list that
// dropped Kimi + Opus. Runners must import FULL_FORCE_COUNCIL; these tests pin the membership + slugs.

describe('24Z.8: full-force Fusion council membership', () => {
  it('includes Kimi (the dropped model) with the exact slug', () => {
    expect(FULL_FORCE_COUNCIL).toContain('moonshotai/kimi-k2.7-code');
  });

  it('includes every top configured model with exact slugs', () => {
    for (const slug of [
      'openai/gpt-4o', 'anthropic/claude-opus-4.8', 'z-ai/glm-5.2', 'moonshotai/kimi-k2.7-code',
      'deepseek/deepseek-v4-pro', 'qwen/qwen3.7-max', 'mistralai/mistral-large-2512', 'x-ai/grok-4.3',
    ]) {
      expect(FULL_FORCE_COUNCIL).toContain(slug);
    }
    expect(FULL_FORCE_COUNCIL.length).toBe(8);
  });

  it('Gemini is OPTIONAL (not assumed configured) — resolves to non_vote if unreachable', () => {
    expect(OPTIONAL_COUNCIL).toContain('google/gemini-3.1-pro-preview');
    expect(FULL_FORCE_COUNCIL).not.toContain('google/gemini-3.1-pro-preview' as never);
    expect(FULL_FORCE_COUNCIL_WITH_OPTIONAL).toContain('google/gemini-3.1-pro-preview');
  });

  it('an unreachable / adapter-failed council member is a non_vote, never RED', () => {
    const failed: AdvisoryResult = {
      model: 'google/gemini-3.1-pro-preview', lens: 'security', label: 'gemini:security', durationMs: 0,
      adapterFailure: true, failureReason: 'unavailable', verdict: 'RED', findings: '', risks: '',
      missing_tests: '', recommended_next_commit: '', confidence: 0,
    };
    expect(classifyVote(failed)).toBe('non_vote');
  });

  it('a full council run with some adapter failures still reaches a real quorum (failures excluded)', () => {
    const ok = (model: string): AdvisoryResult => ({
      model, lens: 'security', label: `${model}:security`, durationMs: 10, adapterFailure: false,
      verdict: 'GREEN', findings: 'ok', risks: '', missing_tests: '', recommended_next_commit: '', confidence: 8,
    });
    const fail = (model: string): AdvisoryResult => ({ ...ok(model), adapterFailure: true, failureReason: 'unavailable', verdict: 'RED' });
    const results = [
      ok('anthropic/claude-opus-4.8'), ok('z-ai/glm-5.2'), ok('moonshotai/kimi-k2.7-code'),
      ok('deepseek/deepseek-v4-pro'), fail('x-ai/grok-4.3'), fail('google/gemini-3.1-pro-preview'),
    ];
    const q = evaluateFusionQuorum(results);
    expect(q.status).toBe('GREEN_QUORUM');
    expect(q.redVotes).toBe(0);
    expect(q.nonVotes).toBe(2);
    expect(q.completedVotes).toBe(4);
  });
});
