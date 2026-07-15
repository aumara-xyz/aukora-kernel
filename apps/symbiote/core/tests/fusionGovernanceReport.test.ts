import { describe, it, expect } from 'vitest';
import { evaluateFusionQuorum, buildFusionGovernanceReport, formatFusionGovernanceReport, type AdvisoryResult } from '../src/fusionConfig';

// Peter's standing rule: every Fusion round reports the exact council, the verdict counts, the non-votes WITH a
// typed reason + provider_contacted, and what changed because of Fusion.

const r = (over: Partial<AdvisoryResult>): AdvisoryResult => ({
  model: 'x', label: 'x', durationMs: 1, adapterFailure: false, verdict: 'GREEN',
  findings: '', risks: '', missing_tests: '', recommended_next_commit: '', confidence: 1, ...over,
});

const COUNCIL = ['anthropic/claude-opus-4.8', 'z-ai/glm-5.2', 'moonshotai/kimi-k2.6'];

describe('Fusion governance report (council / verdicts / typed non-votes+provider_contacted / what changed)', () => {
  const results: AdvisoryResult[] = [
    r({ model: 'anthropic/claude-opus-4.8', verdict: 'YELLOW' }),
    r({ model: 'z-ai/glm-5.2', verdict: 'GREEN' }),
    // a non-vote: adapter failed AFTER a real call (provider_contacted true) with a typed reason
    r({ model: 'moonshotai/kimi-k2.6', adapterFailure: true, failureReason: 'empty_response', provider_contacted: true, verdict: 'RED' }),
  ];

  it('reports the exact council, verdict counts, and the quorum', () => {
    const rep = buildFusionGovernanceReport(COUNCIL, results, evaluateFusionQuorum(results), 'folded a hardening');
    expect(rep.councilModels).toEqual(COUNCIL);
    expect(rep.verdicts).toEqual({ green: 1, yellow: 1, red: 0, nonVotes: 1 }); // adapter-failure RED is a non-vote, never RED
    expect(rep.quorum).toBe('YELLOW_QUORUM'); // 2 real votes
  });

  it('lists each non-vote with a TYPED reason + provider_contacted (a failed call is not a skip)', () => {
    const rep = buildFusionGovernanceReport(COUNCIL, results, evaluateFusionQuorum(results));
    expect(rep.nonVotes).toEqual([{ model: 'moonshotai/kimi-k2.6', reason: 'empty_response', provider_contacted: true }]);
  });

  it('records what changed because of Fusion (defaults to the advisory-only disclaimer)', () => {
    expect(buildFusionGovernanceReport(COUNCIL, results, evaluateFusionQuorum(results), 'folded X').changedBecauseOfFusion).toBe('folded X');
    expect(buildFusionGovernanceReport(COUNCIL, results, evaluateFusionQuorum(results)).changedBecauseOfFusion).toMatch(/advisory only/);
  });

  it('formats all four required items as printable lines', () => {
    const lines = formatFusionGovernanceReport(buildFusionGovernanceReport(COUNCIL, results, evaluateFusionQuorum(results), 'folded a hardening'));
    expect(lines.join('\n')).toContain('council (3):');
    expect(lines.join('\n')).toMatch(/verdict: YELLOW_QUORUM/);
    expect(lines.join('\n')).toContain('provider_contacted=true');
    expect(lines.join('\n')).toContain('changed because of Fusion: folded a hardening');
  });

  it('an all-green council shows non-votes: none', () => {
    const allGreen = [r({ model: 'a' }), r({ model: 'b' })];
    const lines = formatFusionGovernanceReport(buildFusionGovernanceReport(['a', 'b'], allGreen, evaluateFusionQuorum(allGreen)));
    expect(lines.join('\n')).toContain('non-votes: none');
  });
});
