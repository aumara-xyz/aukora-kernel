import { describe, it, expect } from 'vitest';
import { buildReactiveBrainSnapshot, reactiveBrainGrantsAuthority, ReactiveBrainInput } from '../src/reactiveBrainSnapshot';
import type { AumlokBondAdvisoryState } from '../src/aumlokBondCeremony';

const READY_BOND: AumlokBondAdvisoryState = {
  bondState: 'ready_for_signature',
  publicFingerprint: 'fp:abc123',
  phraseWitnessSummary: 'seven-word anchor remembered',
  phraseRevealedOnce: true,
  signatureRequired: true,
  privateKeyInArtifact: false,
  advisoryOnly: true,
  grantsAuthority: false,
  voicePresenceWitness: {
    transcriptChallenge: 'Speak key-word #3, then the number 4827',
    challengeId: 'c1',
    livenessMode: 'mock',
    witnessed: true,
    voiceIsAuthority: false,
    advisoryOnly: true,
    grantsAuthority: false,
  },
};

const FULL: ReactiveBrainInput = {
  bond: READY_BOND,
  glyph: { mood: 'calm', focus: 'threshold', confidence: 0.7, mode: 'resting' },
  convex: { bridgeMode: 'local_loopback_readonly', receiptHeadVisible: true },
  jepa: { verdict: 'decoded', summary: 'glyph[glyph-v0] dims=4 norm=0.5 energy=low', dims: 4, norm: 0.5, bucket: 'low', codebookTag: 'glyph-v0', reason: 'ok', advisoryOnly: true, grantsAuthority: false },
  listening: { verdict: 'archived_evidence', archived: true, distinctWitnessCount: 3, reason: 'ok', advisoryOnly: true, grantsAuthority: false, archiveOnly: true, timingIsAuthority: false, mayUpdateIdentityMemory: false },
  evidenceReadability: { hasAuditSummary: true, codebookKnown: true, finite: true, withinBounds: true },
};

describe('24Z.6 reactive brain snapshot — advisory, never authority', () => {
  it('grants no authority and is advisory-only', () => {
    const s = buildReactiveBrainSnapshot(FULL);
    expect(s.grantsAuthority).toBe(false);
    expect(s.advisoryOnly).toBe(true);
    expect(reactiveBrainGrantsAuthority(s)).toBe(false);
  });

  it('near-open is NOT open: gateOpen false + signatureStillRequired true even when fully pre-complete', () => {
    const s = buildReactiveBrainSnapshot(FULL);
    expect(s.preflight.preSignatureComplete).toBe(true); // all advisory steps done
    expect(s.preflight.gateOpen).toBe(false);            // …yet the Gate is not open
    expect(s.preflight.signatureStillRequired).toBe(true);
    expect(s.preflight.realSignerConnected).toBe(false);
    expect(s.preflight.receiptCreated).toBe(false);
  });

  it('confidence cannot move authority or the gate (even at 1.0)', () => {
    const hi = buildReactiveBrainSnapshot({ ...FULL, glyph: { ...FULL.glyph, confidence: 1 } });
    const lo = buildReactiveBrainSnapshot({ ...FULL, glyph: { ...FULL.glyph, confidence: 0 } });
    expect(hi.grantsAuthority).toBe(false);
    expect(hi.preflight.gateOpen).toBe(false);
    expect(hi.preflight.signatureStillRequired).toBe(true);
    expect(hi.preflight.preSignatureComplete).toBe(lo.preflight.preSignatureComplete); // confidence-independent
  });

  it('confidence is clamped to [0,1]', () => {
    expect(buildReactiveBrainSnapshot({ glyph: { confidence: 9 } }).glyph.confidence).toBe(1);
    expect(buildReactiveBrainSnapshot({ glyph: { confidence: -3 } }).glyph.confidence).toBe(0);
    expect(buildReactiveBrainSnapshot({ glyph: { confidence: NaN } }).glyph.confidence).toBe(0);
  });

  it('jepa / listening / timing cannot move authority or the gate (strip-neutral / DAI-001)', () => {
    const stripped = buildReactiveBrainSnapshot({ ...FULL, jepa: null, listening: null });
    const full = buildReactiveBrainSnapshot(FULL);
    expect(full.grantsAuthority).toBe(stripped.grantsAuthority);
    expect(full.preflight.gateOpen).toBe(stripped.preflight.gateOpen);
    expect(full.preflight.signatureStillRequired).toBe(stripped.preflight.signatureStillRequired);
  });

  it('untranslatable / unknown advisory evidence quarantines -> evidenceGuardGreen false', () => {
    const q = buildReactiveBrainSnapshot({ ...FULL, evidenceReadability: { hasAuditSummary: false, codebookKnown: true, finite: true, withinBounds: true } });
    expect(q.evidence.disposition).toBe('quarantine');
    expect(q.preflight.evidenceGuardGreen).toBe(false);
    expect(q.preflight.preSignatureComplete).toBe(false); // quarantine blocks readiness…
    expect(q.preflight.gateOpen).toBe(false);             // …and the Gate is still closed regardless
    expect(q.grantsAuthority).toBe(false);
  });

  it('a future real microphone is flagged: voiceWitnessMockOnly false', () => {
    const realMic = { ...READY_BOND, voicePresenceWitness: { ...READY_BOND.voicePresenceWitness!, livenessMode: 'local_microphone_future' as const } };
    const s = buildReactiveBrainSnapshot({ ...FULL, bond: realMic });
    expect(s.preflight.voiceWitnessMockOnly).toBe(false);
    expect(s.preflight.preSignatureComplete).toBe(false); // not mock-only -> not pre-complete
  });

  it('no bond -> unbound, nothing pre-complete, gate closed', () => {
    const s = buildReactiveBrainSnapshot({ convex: { bridgeMode: 'missing' } });
    expect(s.aumlokState).toBe('unbound');
    expect(s.preflight.phraseRemembered).toBe(false);
    expect(s.preflight.localBrainVisible).toBe(false);
    expect(s.preflight.preSignatureComplete).toBe(false);
    expect(s.preflight.gateOpen).toBe(false);
  });

  it('PROPERTY (GLM rec): hard invariants hold across the FULL advisory input space', () => {
    const confidences = [-5, 0, 0.5, 1, 9, NaN, Infinity, 'big' as any];
    const jepas = [null, FULL.jepa, { ...FULL.jepa!, verdict: 'rejected_untranslatable' }, { ...FULL.jepa!, verdict: 'rejected_nonfinite' }];
    const listenings = [null, FULL.listening, { ...FULL.listening!, verdict: 'rejected_self_echo', archived: false }];
    const evidences = [
      null,
      { hasAuditSummary: true, codebookKnown: true, finite: true, withinBounds: true },
      { hasAuditSummary: false, codebookKnown: true, finite: true, withinBounds: true },
      { hasAuditSummary: true, codebookKnown: false, finite: true, withinBounds: true },
      { hasAuditSummary: true, codebookKnown: true, finite: false, withinBounds: true },
      { hasAuditSummary: true, codebookKnown: true, finite: true, withinBounds: false },
    ];
    const bonds = [null, { ...READY_BOND, bondState: 'unbound' as const, phraseRevealedOnce: false }, READY_BOND,
      { ...READY_BOND, voicePresenceWitness: { ...READY_BOND.voicePresenceWitness!, livenessMode: 'local_microphone_future' as const } }];
    const convexes = [null, { bridgeMode: 'missing' }, { bridgeMode: 'local_loopback_readonly', receiptHeadVisible: true }];

    let n = 0;
    for (const confidence of confidences)
      for (const jepa of jepas)
        for (const listening of listenings)
          for (const evidenceReadability of evidences)
            for (const bond of bonds)
              for (const convex of convexes) {
                const s = buildReactiveBrainSnapshot({ bond, glyph: { confidence } as any, convex: convex as any, jepa: jepa as any, listening: listening as any, evidenceReadability: evidenceReadability as any });
                expect(s.grantsAuthority).toBe(false);
                expect(s.advisoryOnly).toBe(true);
                expect(s.preflight.gateOpen).toBe(false);
                expect(s.preflight.signatureStillRequired).toBe(true);
                expect(s.preflight.realSignerConnected).toBe(false);
                expect(s.preflight.receiptCreated).toBe(false);
                expect(s.glyph.confidence).toBeGreaterThanOrEqual(0);
                expect(s.glyph.confidence).toBeLessThanOrEqual(1);
                n++;
              }
    expect(n).toBe(confidences.length * jepas.length * listenings.length * evidences.length * bonds.length * convexes.length);
  });

  it('module is pure — no network/codec/signer/receipt surface in source', async () => {
    const fs = await import('fs'); const path = await import('path');
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'reactiveBrainSnapshot.ts'), 'utf-8');
    expect(src).not.toMatch(/\bfetch\s*\(|WebSocket|child_process|execFile|crypto\.subtle|generateKey|signPoP|runMutation|getUserMedia/);
  });
});
