// fusion-advisory-v1 — the versioned, schema-validated Fusion artifact Aukora may consume as EVIDENCE ONLY.
import { describe, it, expect } from 'vitest';
import { buildFusionAdvisoryArtifact, validateFusionAdvisoryArtifact, fusionArtifactGrantsAuthority, FUSION_ADVISORY_SCHEMA } from '../src/fusionAdvisoryArtifact';

const sample = () => buildFusionAdvisoryArtifact({
  createdAt: '2026-06-30T00:00:00.000Z',
  scheduleSummary: { planned: 25, scheduled: 5, unscheduled: 20, budget: 5 },
  quorum: { status: 'YELLOW_QUORUM', completedVotes: 2, nonVotes: 3, redVotes: 0, greenVotes: 1, yellowVotes: 1 },
  providerContactedCount: 2,
  attentionItems: [{ kind: 'budget_exhausted', detail: '20 of 25 not scheduled', count: 20, advisoryOnly: true, grantsAuthority: false }],
  retry: { pairs: [{ shard: 's1', model: 'm', reason: 'rate_limited' }], supersede: [], advisoryOnly: true, grantsAuthority: false },
  terminalReview: { quorumStatus: 'YELLOW_QUORUM', realCompletedVotes: 2, nonVotesByReason: {}, providerContactedCount: 2, schedule: { planned: 25, scheduled: 5, unscheduled: 20, budget: 5 }, retryRecommended: true, safeAsEvidence: true, summary: 'ok', advisoryOnly: true, grantsAuthority: false },
});

describe('fusion-advisory-v1 artifact + fail-closed validator', () => {
  it('a valid v1 artifact validates and is advisory', () => {
    const a = sample();
    expect(a.schema).toBe(FUSION_ADVISORY_SCHEMA);
    expect(validateFusionAdvisoryArtifact(a).valid).toBe(true);
    expect(a.advisoryOnly).toBe(true);
    expect(a.grantsAuthority).toBe(false);
    expect(fusionArtifactGrantsAuthority(a)).toBe(false);
  });
  it('unknown / legacy / missing schema fails CLOSED', () => {
    expect(validateFusionAdvisoryArtifact({ ...sample(), schema: 'fusion-advisory-v0' }).valid).toBe(false);
    expect(validateFusionAdvisoryArtifact({ ...sample(), schema: undefined }).valid).toBe(false);
    expect(validateFusionAdvisoryArtifact(null).valid).toBe(false);
    expect(validateFusionAdvisoryArtifact('nope').valid).toBe(false);
  });
  it('an artifact cannot grant authority (any authority flag fails closed)', () => {
    expect(validateFusionAdvisoryArtifact({ ...sample(), grantsAuthority: true }).valid).toBe(false);
    expect(validateFusionAdvisoryArtifact({ ...sample(), authority_granted: true }).valid).toBe(false);
    expect(validateFusionAdvisoryArtifact({ ...sample(), gate_changed: true }).valid).toBe(false);
  });
  it('no secrets / raw prompts / model payloads / signedHead / PoP leak into the artifact', () => {
    const blob = JSON.stringify(sample()).toLowerCase();
    for (const banned of ['prompt', 'signedhead', 'signature', '"pop"', 'privatekey', 'secretkey', 'nonce', 'findings', 'risks']) {
      expect(blob).not.toContain(banned);
    }
  });
});
