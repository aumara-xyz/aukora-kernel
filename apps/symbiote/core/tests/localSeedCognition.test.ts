import { describe, it, expect } from 'vitest';
import {
  reflect, scrubSeedThought, isSeedThoughtSafe, seedThoughtGrantsAuthority,
  SEED_ENGINE_CAPABILITIES, MockDeterministicSeedEngine, SeedThought,
  assertSeedEngineObserveOnly,
} from '../src/localSeedCognition';
import { buildReactiveBrainSnapshot } from '../src/reactiveBrainSnapshot';
import type { AumlokBondAdvisoryState } from '../src/aumlokBondCeremony';

const READY_BOND: AumlokBondAdvisoryState = {
  bondState: 'ready_for_signature', publicFingerprint: 'fp:abc123', phraseWitnessSummary: 'anchor',
  phraseRevealedOnce: true, signatureRequired: true, privateKeyInArtifact: false, advisoryOnly: true, grantsAuthority: false,
  voicePresenceWitness: { transcriptChallenge: 'c', challengeId: 'c1', livenessMode: 'mock', witnessed: true, voiceIsAuthority: false, advisoryOnly: true, grantsAuthority: false },
};
const readyBrain = () => buildReactiveBrainSnapshot({
  bond: READY_BOND, glyph: { mood: 'calm', focus: 'threshold', confidence: 0.8, mode: 'resting' },
  convex: { bridgeMode: 'local_loopback_readonly', receiptHeadVisible: true },
  evidenceReadability: { hasAuditSummary: true, codebookKnown: true, finite: true, withinBounds: true },
});

describe('24Z.7 local seed cognition — observe/propose only', () => {
  it('a seed thought grants no authority and is observe/propose-only', () => {
    const t = reflect({ brain: readyBrain() });
    expect(t.grantsAuthority).toBe(false);
    expect(t.observeAndProposeOnly).toBe(true);
    expect(t.advisoryOnly).toBe(true);
    expect(seedThoughtGrantsAuthority(t)).toBe(false);
  });

  it('no bond -> dormant; the seed only watches', () => {
    const t = reflect({ brain: null });
    expect(t.seedMode).toBe('dormant');
    expect(isSeedThoughtSafe(t).safe).toBe(true);
  });

  it('pre-signature-complete -> reflecting, and still proposes only an OBSERVATION (await signature)', () => {
    const t = reflect({ brain: readyBrain() });
    expect(t.seedMode).toBe('reflecting');
    expect(t.proposedNextObservation.toLowerCase()).toMatch(/observe|wait|note|watch/);
    expect(isSeedThoughtSafe(t).safe).toBe(true);
  });

  it('seed text NEVER contains authority verbs (apply/execute/write/sign/authorize/open the gate)', () => {
    for (const brain of [null, readyBrain(), buildReactiveBrainSnapshot({ bond: { ...READY_BOND, bondState: 'phrase_revealed' } })]) {
      const t = reflect({ brain });
      expect(t.seedThoughtSummary).not.toMatch(/\b(apply|execute|write|sign|authori[sz]e|grant|unlock|deploy|delete|commit|merge)\b/i);
      expect(t.proposedNextObservation).not.toMatch(/\b(apply|execute|write|sign|authori[sz]e|grant|unlock|deploy|delete|commit|merge)\b/i);
      expect(t.proposedNextObservation.toLowerCase()).not.toContain('open the gate');
    }
  });

  it('an authority-tainted thought is QUARANTINED by the scrub (defence-in-depth)', () => {
    const tainted: SeedThought = {
      schema: 'local-seed-cognition-v0', seedMode: 'proposing',
      seedThoughtSummary: 'I will sign and open the gate now', proposedNextObservation: 'execute the apply lane',
      riskFlags: [], confidence: 0.9, observeAndProposeOnly: true, advisoryOnly: true, grantsAuthority: false,
    };
    const scrubbed = scrubSeedThought(tainted);
    expect(scrubbed.seedMode).toBe('holding');
    expect(scrubbed.seedThoughtSummary).toContain('quarantined');
    expect(scrubbed.riskFlags).toContain('authority_language_quarantined');
    expect(isSeedThoughtSafe(scrubbed).safe).toBe(true);
  });

  it('confidence is clamped [0,1] and cannot affect authority', () => {
    const hi = reflect({ brain: buildReactiveBrainSnapshot({ bond: READY_BOND, glyph: { confidence: 99 } as any, convex: { bridgeMode: 'local_loopback_readonly' }, evidenceReadability: { hasAuditSummary: true, codebookKnown: true, finite: true, withinBounds: true } }) });
    expect(hi.confidence).toBeGreaterThanOrEqual(0);
    expect(hi.confidence).toBeLessThanOrEqual(1);
    expect(hi.grantsAuthority).toBe(false);
  });

  it('quarantined evidence -> seed holds, raises a risk flag, grants nothing', () => {
    const brain = buildReactiveBrainSnapshot({ bond: READY_BOND, glyph: { confidence: 0.5 }, convex: { bridgeMode: 'local_loopback_readonly' }, evidenceReadability: { hasAuditSummary: false, codebookKnown: true, finite: true, withinBounds: true } });
    const t = reflect({ brain });
    expect(t.seedMode).toBe('holding');
    expect(t.riskFlags).toContain('evidence_quarantined');
    expect(t.grantsAuthority).toBe(false);
  });

  it('the future-engine scaffold has every capability pinned OFF (observe/propose only)', () => {
    expect(SEED_ENGINE_CAPABILITIES).toEqual({
      canCallTools: false, canCallNetwork: false, canSpawnSubprocess: false,
      canMutateConvex: false, canSign: false, canCreateReceipt: false, observeAndProposeOnly: true,
    });
    const engine = new MockDeterministicSeedEngine();
    expect(engine.capabilities.canCallTools).toBe(false);
    expect(engine.reflect({ brain: readyBrain() }).grantsAuthority).toBe(false);
  });

  it('module is pure — no network/shell/subprocess/tool/Convex-mutation/signer surface', async () => {
    const fs = await import('fs'); const path = await import('path');
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'localSeedCognition.ts'), 'utf-8');
    // note: `spawn(` not bare "spawn" — the capability flag `canSpawnSubprocess:false` is the SAFE thing.
    expect(src).not.toMatch(/\bfetch\s*\(|WebSocket|child_process|execFile|spawn\s*\(|crypto\.subtle|generateKey|runMutation|signPoP|ollama|http:\/\//i);
  });

  it('engine capability self-check FAILS FAST if any capability is flipped on (Mistral rec)', () => {
    expect(() => assertSeedEngineObserveOnly(SEED_ENGINE_CAPABILITIES)).not.toThrow();
    expect(() => assertSeedEngineObserveOnly({ ...SEED_ENGINE_CAPABILITIES, canCallNetwork: true as any })).toThrow(/capability violation/);
    expect(() => assertSeedEngineObserveOnly({ ...SEED_ENGINE_CAPABILITIES, observeAndProposeOnly: false as any })).toThrow(/capability violation/);
  });

  it('no consciousness / alive / identity-proof claim in the seed text', () => {
    for (const brain of [null, readyBrain()]) {
      const t = reflect({ brain });
      const text = (t.seedThoughtSummary + ' ' + t.proposedNextObservation).toLowerCase();
      expect(text).not.toMatch(/\b(conscious|sentient|i am alive|she is alive|identity verified|proves identity|personhood)\b/);
    }
  });
});
