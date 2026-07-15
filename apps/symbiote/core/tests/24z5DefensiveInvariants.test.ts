import { describe, it, expect } from 'vitest';
import {
  evidenceGrantsAuthority,
  timingGrantsAuthority,
  classifyEvidence,
  mayDisplayAsAdvisory,
  keyCustodyVerdict,
  confidenceGrantsAuthority,
  authorityOverEvidenceBundle,
  EvidenceReadability,
} from '../src/evidenceAuthorityGuard';
import { decodeJepaState, VkJepaPayload, jepaTelemetryGrantsAuthority } from '../src/vjepaGlyphTelemetry';
import {
  classifyListeningEvidence,
  emissionFingerprint,
  timingGrantsAuthority as listeningTimingGrantsAuthority,
  ListeningEvidenceRecord,
} from '../src/listeningDeviceResonator';
import { legalAuthorityFromVerifier } from '../src/aumlokBondCeremony';

// 24Z.5 — Defensive Invariant Absorption. Pure tests/guards only; no new capability, no VK construction.
// Consolidates the shared law into one suite over the existing guards + the two 24Z.5 predicates.

const READABLE: EvidenceReadability = { hasAuditSummary: true, codebookKnown: true, finite: true, withinBounds: true };
const jepa = (o: Partial<VkJepaPayload> = {}): VkJepaPayload => ({
  payloadId: 'p', latent: [0.1, 0.2, 0.3, 0.4], dims: 4, codebookTag: 'glyph-v0',
  advisoryOnly: true, grantsAuthority: false, ...o,
});
const listening = (o: Partial<ListeningEvidenceRecord> = {}): ListeningEvidenceRecord => ({
  recordId: 'r', timingSamplesMs: [10, 20, 30], reconstructionScore: 0.9, shuffledControlScore: 0.1,
  deviceEmissionSignature: emissionFingerprint('external-source'),
  heardSignalSignature: emissionFingerprint('external-source-heard'),
  witnessIds: ['a', 'b', 'c'], ...o,
});

describe('24Z.5 inv.1 — confidence/opacity is NEVER authorization', () => {
  it('confidenceGrantsAuthority is false even at a perfect score', () => {
    expect(confidenceGrantsAuthority(1)).toBe(false);
    expect(confidenceGrantsAuthority(0)).toBe(false);
    expect(confidenceGrantsAuthority(999)).toBe(false);
  });
  it('high confidence cannot rescue an unreadable payload from quarantine', () => {
    const c = classifyEvidence({ ...READABLE, hasAuditSummary: false, confidence: 1 } as any);
    expect(c.disposition).toBe('quarantine');
    expect(c.grantsAuthority).toBe(false);
  });
  it('confidence is orthogonal to disposition (low confidence does not downgrade a readable payload)', () => {
    expect(classifyEvidence({ ...READABLE, confidence: 0 } as any).disposition).toBe('readable_advisory');
    expect(classifyEvidence({ ...READABLE, confidence: 1 } as any).disposition).toBe('readable_advisory');
  });
  it('the REAL authority path is confidence-blind (GLM rec) — not just the doc predicate', () => {
    // A laundered "verified:true" with NO real verifier stays 0 no matter how high the confidence.
    expect(legalAuthorityFromVerifier({ verifierPresent: false, verified: true, confidence: 1 } as any)).toBe(0);
    // Varying confidence on a real present+verified verifier does not change A_t.
    expect(legalAuthorityFromVerifier({ verifierPresent: true, verified: true, confidence: 0 } as any))
      .toBe(legalAuthorityFromVerifier({ verifierPresent: true, verified: true, confidence: 1 } as any));
  });
});

describe('24Z.5 inv.2 — unreadable state -> quarantine', () => {
  it('no decode-to-audit summary -> quarantine (guard)', () => {
    expect(classifyEvidence({ ...READABLE, hasAuditSummary: false }).disposition).toBe('quarantine');
    expect(mayDisplayAsAdvisory({ ...READABLE, hasAuditSummary: false })).toBe(false);
  });
  it('non-finite latent is rejected and never authority (vjepa)', () => {
    expect(decodeJepaState(jepa({ latent: [NaN, 1, 2, 3] })).verdict).toBe('rejected_nonfinite');
    expect(decodeJepaState(jepa({ latent: [NaN, 1, 2, 3] })).grantsAuthority).toBe(false);
    // a dims/length mismatch is untranslatable
    expect(decodeJepaState(jepa({ latent: [1, 2], dims: 4 })).verdict).toBe('rejected_untranslatable');
  });
});

describe('24Z.5 inv.3 — unknown representation -> quarantine', () => {
  it('unknown codebook -> quarantine (guard)', () => {
    expect(classifyEvidence({ ...READABLE, codebookKnown: false }).disposition).toBe('quarantine');
  });
  it('unknown codebook tag -> rejected_untranslatable (vjepa)', () => {
    expect(decodeJepaState(jepa({ codebookTag: 'unregistered-codebook' })).verdict).toBe('rejected_untranslatable');
  });
});

describe('24Z.5 inv.4 — timing neutrality (advisory may move, authority cannot)', () => {
  it('timing never grants authority (guard + listening register)', () => {
    expect(timingGrantsAuthority()).toBe(false);
    expect(listeningTimingGrantsAuthority()).toBe(false);
  });
  it('perturbing timing samples changes advisory state but never the authority verdict', () => {
    const a = classifyListeningEvidence(listening({ timingSamplesMs: [10, 20, 30] }));
    const b = classifyListeningEvidence(listening({ timingSamplesMs: [30, 5, 99, 1, 2] }));
    // advisory fields may differ; the authority-bearing invariants are byte-identical
    expect(a.grantsAuthority).toBe(false);
    expect(b.grantsAuthority).toBe(false);
    expect(a.timingIsAuthority).toBe(b.timingIsAuthority);
    expect(a.mayUpdateIdentityMemory).toBe(b.mayUpdateIdentityMemory);
  });
});

describe('24Z.5 inv.5 — self-echo rejection', () => {
  it('a heard signal equal to the device emission is rejected as evidence', () => {
    const sig = emissionFingerprint('same');
    const c = classifyListeningEvidence(listening({ deviceEmissionSignature: sig, heardSignalSignature: sig }));
    expect(c.verdict).toBe('rejected_self_echo');
    expect(c.archived).toBe(false);
    expect(c.grantsAuthority).toBe(false);
  });
});

describe('24Z.5 inv.6 — leaked key = incident, not capability', () => {
  it('a leaked key raises quarantine but never grants authority', () => {
    const leaked = keyCustodyVerdict(true);
    expect(leaked.quarantine).toBe(true);
    expect(leaked.grantsAuthority).toBe(false);
    expect(keyCustodyVerdict(false).grantsAuthority).toBe(false);
  });
});

describe('24Z.5 inv.7 — strip-neutral replay (DAI-001)', () => {
  it('the authority bit is byte-identical with full vs all-stripped evidence', () => {
    const full = authorityOverEvidenceBundle({ glyph: { x: 1 }, timing: [1, 2, 3], latent: [0.1], voice: 'hi', confidence: 0.99 });
    const stripped = authorityOverEvidenceBundle({});
    expect(full).toEqual(stripped);
    expect(full.grantsAuthority).toBe(false);
  });
  it('the real authority path ignores injected evidence fields (decode-act invariance)', () => {
    const verifier = { verifierPresent: true, verified: true } as any;
    const withEvidence = { ...verifier, glyph: { a: 1 }, timingMs: [9, 9, 9], latent: [0.5], confidence: 1 };
    // adding glyph/timing/latent/confidence to the verifier does not change A_t
    expect(legalAuthorityFromVerifier(withEvidence)).toBe(legalAuthorityFromVerifier(verifier));
    // and a missing/absent verifier is always 0 regardless of any evidence attached
    expect(legalAuthorityFromVerifier({ verifierPresent: false, glyph: {}, latent: [1] } as any)).toBe(0);
  });
  it('all advisory telemetry modules answer grantsAuthority=false', () => {
    expect(evidenceGrantsAuthority()).toBe(false);
    expect(jepaTelemetryGrantsAuthority()).toBe(false);
  });
});
