import { describe, expect, it } from 'vitest';
import {
  prefixResultIds,
  prefixSurvivalProbabilities,
  schedulePrefix,
  verifySequentialPrefix,
  verifySpeculativePrefix,
  type PrefixVerifier,
  type SpeculativeCandidate,
} from '../src/speculativePrefix';

interface Intent {
  action: string;
  resource: string;
}

interface VkLikeEvidence {
  glyphHash: string;
  advisoryOnly: true;
  grantsAuthority: false;
}

function candidate(
  id: string,
  action: string,
  confidence?: number,
  evidence?: VkLikeEvidence
): SpeculativeCandidate<Intent, VkLikeEvidence> {
  return { id, confidence, evidence, intent: { action, resource: `/tmp/${id}` } };
}

const verifier: PrefixVerifier<Intent, VkLikeEvidence> = (item) => {
  if (item.intent.action === 'allow') return { decision: 'allow', reason: 'allowed by kernel fixture' };
  if (item.intent.action === 'pause') return { decision: 'pause', reason: 'human gate required' };
  return { decision: 'deny', reason: 'denied by kernel fixture' };
};

describe('24Z.95: speculative prefix verification', () => {
  it('admits only the longest verified prefix and discards the unverified suffix', () => {
    const block = [
      candidate('a', 'allow'),
      candidate('b', 'allow'),
      candidate('c', 'deny'),
      candidate('d', 'allow'),
    ];

    const result = verifySpeculativePrefix(block, verifier);

    expect(prefixResultIds(result)).toEqual(['a', 'b']);
    expect(result.stoppedBy?.candidate.id).toBe('c');
    expect(result.discarded.map((item) => item.id)).toEqual(['d']);
    expect(result.grantsAuthority).toBe(false);
    expect(result.law).toBe('proposal_only_prefix_verified');
  });

  it('is receipt-equivalent to ordinary sequential mediation when no scheduler truncates', () => {
    const block = [
      candidate('a', 'allow'),
      candidate('b', 'allow'),
      candidate('c', 'pause'),
      candidate('d', 'allow'),
    ];

    const speculative = verifySpeculativePrefix(block, verifier);
    const sequential = verifySequentialPrefix(block, verifier);

    expect(prefixResultIds(speculative)).toEqual(prefixResultIds(sequential));
    expect(speculative.stoppedBy?.candidate.id).toBe(sequential.stoppedBy?.candidate.id);
    expect(speculative.checked.map((item) => item.candidate.id)).toEqual(
      sequential.checked.map((item) => item.candidate.id)
    );
  });

  it('does not check suffix candidates after the first pause or deny', () => {
    const calls: string[] = [];
    const block = [
      candidate('a', 'allow'),
      candidate('b', 'deny'),
      candidate('c', 'allow'),
      candidate('d', 'allow'),
    ];

    const result = verifySpeculativePrefix(block, (item, context) => {
      calls.push(`${context.index}:${item.id}`);
      return verifier(item, context);
    });

    expect(calls).toEqual(['0:a', '1:b']);
    expect(result.discarded.map((item) => item.id)).toEqual(['c', 'd']);
  });

  it('uses confidence only to schedule verifier work, never to override denial', () => {
    const block = [
      candidate('a', 'allow', 0.99),
      candidate('b', 'deny', 0.99),
      candidate('c', 'allow', 0.99),
    ];
    const schedule = schedulePrefix(block, { minMarginalSurvival: 0.5 });

    const result = verifySpeculativePrefix(block, verifier, schedule);

    expect(schedule.maxPrefixLength).toBe(3);
    expect(schedule.grantsAuthority).toBe(false);
    expect(prefixResultIds(result)).toEqual(['a']);
    expect(result.stoppedBy?.candidate.id).toBe('b');
    expect(result.stoppedBy?.verdict.decision).toBe('deny');
  });

  it('can stop scheduling before a low-confidence suffix without authorizing anything', () => {
    const block = [
      candidate('a', 'allow', 0.9),
      candidate('b', 'allow', 0.8),
      candidate('c', 'allow', 0.2),
      candidate('d', 'allow', 0.9),
    ];
    const schedule = schedulePrefix(block, { minMarginalSurvival: 0.5 });
    const result = verifySpeculativePrefix(block, verifier, schedule);

    expect(schedule.maxPrefixLength).toBe(2);
    expect(prefixResultIds(result)).toEqual(['a', 'b']);
    expect(result.stoppedBy).toBeNull();
    expect(result.discarded.map((item) => item.id)).toEqual(['c', 'd']);
  });

  it('computes DSpark-style cumulative prefix survival probabilities', () => {
    const survival = prefixSurvivalProbabilities([
      candidate('a', 'allow', 0.9),
      candidate('b', 'allow', 0.8),
      candidate('c', 'allow', 0.5),
    ]);

    expect(survival).toEqual([0.9, 0.7200000000000001, 0.36000000000000004]);
  });

  it('treats VK-like glyph evidence as advisory only', () => {
    const evidence: VkLikeEvidence = {
      glyphHash: 'vk_demo_hash',
      advisoryOnly: true,
      grantsAuthority: false,
    };
    const block = [
      candidate('glyph-a', 'allow', 0.95, evidence),
      candidate('glyph-b', 'deny', 0.95, evidence),
    ];

    const result = verifySpeculativePrefix(block, (item) => {
      expect(item.evidence?.grantsAuthority).toBe(false);
      return item.intent.action === 'allow'
        ? { decision: 'allow', reason: 'intent allowed; glyph is evidence only' }
        : { decision: 'deny', reason: 'glyph cannot authorize denied intent' };
    });

    expect(prefixResultIds(result)).toEqual(['glyph-a']);
    expect(result.stoppedBy?.candidate.id).toBe('glyph-b');
    expect(result.grantsAuthority).toBe(false);
  });
});

