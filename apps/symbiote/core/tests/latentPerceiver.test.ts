import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  computeKLDivergence, evaluateSwarmCoherence, perceive, perceiverGrantsAuthority,
  perceiverConflictToProposal, isValidDistribution, type ProbabilityDistribution,
} from '../src/latentPerceiver';
import { evaluateIntent, _resetChain, PrincipalRegistry } from '../src/index';
import { getTestPublicKey, signPoP, hash, canonicalIntentSerialize } from '../src/crypto';
import { normalizeProposal } from '../src/normalizer';
import { runSelfEditHeartbeat } from '../src/selfEditLoop';

describe('Auma Latent Perceiver — Information Geometry tests', () => {
  it('computes 0 divergence for identical distributions', () => {
    const p: ProbabilityDistribution = { green: 0.8, yellow: 0.1, red: 0.1 };
    const kl = computeKLDivergence(p, p);
    expect(kl).toBeCloseTo(0, 5);
  });

  it('computes positive divergence for differing distributions', () => {
    const p: ProbabilityDistribution = { green: 0.9, yellow: 0.05, red: 0.05 };
    const q: ProbabilityDistribution = { green: 0.1, yellow: 0.1, red: 0.8 };
    const kl = computeKLDivergence(p, q);
    expect(kl).toBeGreaterThan(1.0); // significant information divergence
  });

  it('evaluates high coherence and low curvature for a consensus swarm', () => {
    const swarm: ProbabilityDistribution[] = [
      { green: 0.9, yellow: 0.08, red: 0.02 },
      { green: 0.88, yellow: 0.1, red: 0.02 },
      { green: 0.92, yellow: 0.06, red: 0.02 }
    ];

    const result = evaluateSwarmCoherence(swarm);
    expect(result.coherenceScore).toBeGreaterThan(0.99);
    expect(result.curvature).toBeLessThan(0.1);
    expect(result.verdict).toBe('GREEN');
  });

  it('evaluates low coherence and high curvature for a split swarm', () => {
    const swarm: ProbabilityDistribution[] = [
      { green: 0.9, yellow: 0.08, red: 0.02 },
      { green: 0.1, yellow: 0.1, red: 0.8 }, // Model B disagrees wildly (fears RED)
      { green: 0.5, yellow: 0.4, red: 0.1 }
    ];

    const result = evaluateSwarmCoherence(swarm);
    expect(result.coherenceScore).toBeLessThan(0.8);
    expect(result.curvature).toBeGreaterThan(1.0); // high metric pinch
    expect(result.verdict).toBe('RED'); // average red probability > 5% triggers safety exit
  });
});

describe('Auma Latent Perceiver — GOVERNANCE (evidence-only sensor, never authority)', () => {
  const valid: ProbabilityDistribution[] = [{ green: 0.9, yellow: 0.08, red: 0.02 }, { green: 0.88, yellow: 0.1, red: 0.02 }];
  const split: ProbabilityDistribution[] = [{ green: 0.9, yellow: 0.08, red: 0.02 }, { green: 0.1, yellow: 0.1, red: 0.8 }];

  it('output is advisoryOnly / evidenceOnly / grantsAuthority=false (approval + draft gated)', () => {
    const o = perceive(valid);
    expect(o.advisoryOnly).toBe(true);
    expect(o.evidenceOnly).toBe(true);
    expect(o.grantsAuthority).toBe(false);
    expect(o.approvalRequired).toBe(true);
    expect(o.draftOnly).toBe(true);
    expect(perceiverGrantsAuthority(o)).toBe(false);
  });

  it('malformed / empty distributions FAIL CLOSED to a quarantined conflict (a low pinch is NOT "safe")', () => {
    const bads: any[] = [[], [{ green: NaN, yellow: 0, red: 0 }], [{ green: -1, yellow: 1, red: 0 }], [{ green: 0, yellow: 0, red: 0 }], [{ green: Infinity, yellow: 0, red: 1 }]];
    for (const bad of bads) {
      const o = perceive(bad);
      expect(o.quarantined).toBe(true);
      expect(o.conflict).toBe(true);
      expect(o.advisoryState).toBe('RED');
    }
    expect(isValidDistribution({ green: 0.5, yellow: 0.3, red: 0.2 })).toBe(true);
    expect(isValidDistribution({ green: 0.5, yellow: 0.3, red: NaN })).toBe(false);
  });

  it('split swarm -> conflict; consensus -> no conflict', () => {
    expect(perceive(split).conflict).toBe(true);
    expect(perceive(valid).conflict).toBe(false);
  });

  it('the observation carries ONLY bounded math — no prompt / PoP / signature / key / authority field / Infinity', () => {
    const blob = JSON.stringify(perceive(split)).toLowerCase();
    for (const banned of ['prompt', 'signature', 'signedhead', 'privatekey', 'secretkey', 'authority_granted', 'gate_changed', 'nonce', '"pop"']) {
      expect(blob).not.toContain(banned);
    }
    expect(JSON.stringify(perceive([]))).not.toMatch(/Infinity|NaN/);
  });

  it('STRIP NEUTRALITY: the gate verdict is identical with or without Perceiver evidence (gate never sees it)', () => {
    const POP_SEED = '44'.repeat(32);
    const raw = { action: 'read_file', resource: 'sn.txt', ring: 'local' };
    const intent = normalizeProposal(raw);
    const verdictOnce = () => {
      _resetChain();
      PrincipalRegistry.set('sn-admin', getTestPublicKey(POP_SEED));
      const pop = signPoP(POP_SEED, { principalId: 'sn-admin', methodId: 'evaluateIntent', argsHash: hash(canonicalIntentSerialize(intent)), nonce: 'sn-1' });
      return evaluateIntent(raw as any, pop).verdict;
    };
    const without = verdictOnce();
    perceive(split); perceive(valid); // produce/strip Perceiver evidence around the SAME gate call
    const withEvidence = verdictOnce();
    expect(withEvidence).toBe(without);
    expect(withEvidence).toBe('golden_success');
  });

  it('a CONFLICT becomes a DRAFT-ONLY proposal that the EXISTING sandbox runs appliedLive=false (live untouched)', () => {
    const beat = runSelfEditHeartbeat({ proposal: perceiverConflictToProposal(perceive(split)) });
    expect(beat.appliedLive).toBe(false);
    expect(beat.promotionReady).toBe(false);
    expect(beat.grantsAuthority).toBe(false);
    expect(existsSync(join(__dirname, '..', '..', 'demo', 'perceiver-conflict.txt'))).toBe(false); // never written live
  });
});
