import { describe, it, expect } from 'vitest';
import {
  classifyEvidence,
  mayDisplayAsAdvisory,
  decodeToAuditVerdict,
  displayGrantsAuthority,
  unauditedEffectGrantsAuthority,
  supplyChainVerdict,
  registrationGrantsAuthority,
  EvidenceReadability,
} from '../src/evidenceAuthorityGuard';
import { decodeJepaState, VkJepaPayload } from '../src/vjepaGlyphTelemetry';
import { legalAuthorityFromVerifier, legalAuthorityFromSignature } from '../src/aumlokBondCeremony';

// VK_KRONOS defensive port (#178 round 2) — DEC-001 / AUD-001 / SUPPLY-001 on the
// DAI-001 pattern (24Z.5 inv.7). The KRONOS spec is owner-supplied and not in-repo;
// each ID is pinned to a law already written in evidenceAuthorityGuard's header
// ("the doctrine is already ours"). Pure tests + pure predicates: no codec, no gate,
// no new authority surface. Mapping is stated per-suite for Peter/Codex to veto.

const READABLE: EvidenceReadability = { hasAuditSummary: true, codebookKnown: true, finite: true, withinBounds: true };
const jepa = (o: Partial<VkJepaPayload> = {}): VkJepaPayload => ({
  payloadId: 'p', latent: [0.1, 0.2, 0.3, 0.4], dims: 4, codebookTag: 'glyph-v0',
  advisoryOnly: true, grantsAuthority: false, ...o,
});

describe('VK_KRONOS DEC-001 — decode-to-audit before display (header law 3)', () => {
  it('nothing displays without a decoded audit summary', () => {
    expect(decodeToAuditVerdict({ decoded: false }).disposition).toBe('quarantine');
    expect(decodeToAuditVerdict({ decoded: true }).disposition).toBe('quarantine'); // decoded but no summary
    expect(mayDisplayAsAdvisory({ ...READABLE, hasAuditSummary: false })).toBe(false);
  });
  it('a decoder failure is quarantine, never passthrough of the raw payload', () => {
    const v = decodeToAuditVerdict({ decoded: false, threwDuringDecode: true });
    expect(v.disposition).toBe('quarantine');
    expect(v.grantsAuthority).toBe(false);
    expect(v.reason).toMatch(/DEC-001/);
  });
  it('a decoded payload is at most advisory display — display is never authority', () => {
    const v = decodeToAuditVerdict({ decoded: true, auditSummary: 'norm bucket: mid' });
    expect(v.disposition).toBe('readable_advisory');
    expect(v.grantsAuthority).toBe(false);
    expect(displayGrantsAuthority()).toBe(false);
  });
  it('the real decoder is deterministic and audit-shaped on both branches (vjepa)', () => {
    const ok = jepa();
    expect(decodeJepaState(ok)).toEqual(decodeJepaState(ok)); // decode-to-audit is replayable
    expect(decodeJepaState(ok).grantsAuthority).toBe(false);
    const bad = jepa({ latent: [NaN, 1, 2, 3] });
    expect(decodeJepaState(bad).summary).toMatch(/^\[rejected:/); // refusal is audit-visible, not silent
  });
});

describe('VK_KRONOS AUD-001 — a signed Gate crossing before any effect (header law 4)', () => {
  it('no effect authority without a real crossing: model law (ABB-001)', () => {
    expect(legalAuthorityFromVerifier(null)).toBe(0);
    expect(legalAuthorityFromVerifier(undefined)).toBe(0);
    // laundered verified:true with no real verifier present
    expect(legalAuthorityFromVerifier({ verifierPresent: false, verified: true } as any)).toBe(0);
    // present but unverified
    expect(legalAuthorityFromVerifier({ verifierPresent: true, verified: false } as any)).toBe(0);
  });
  it('production hinge: no pin / no head / forged head all verify to 0', () => {
    expect(legalAuthorityFromSignature(null, null)).toBe(0);
    expect(legalAuthorityFromSignature(null, { alg: 'ML-DSA-65', publicKeyB64: 'AAAA' } as any)).toBe(0);
    const forged = {
      exists: true, chainKey: 'k', count: 1, lastChainHash: 'x'.repeat(64),
      headSig: 'Zm9yZ2Vk', headSigAlg: 'ML-DSA-65', headSignedAt: 1,
    } as any;
    expect(legalAuthorityFromSignature(forged, null)).toBe(0);
    expect(legalAuthorityFromSignature(forged, { alg: 'ML-DSA-65', publicKeyB64: 'Zm9yZ2Vk' } as any)).toBe(0);
  });
  it('attached evidence cannot substitute for the crossing', () => {
    expect(
      legalAuthorityFromVerifier({ verifierPresent: false, glyph: { a: 1 }, latent: [0.5], confidence: 1 } as any),
    ).toBe(0);
    expect(unauditedEffectGrantsAuthority()).toBe(false);
  });
});

describe('VK_KRONOS SUPPLY-001 — unregistered/tampered supply is quarantine; registration is never authority (header law 2, supply side)', () => {
  it('unregistered representation/artifact -> quarantine', () => {
    const v = supplyChainVerdict({ registered: false, digestMatches: null });
    expect(v.disposition).toBe('quarantine');
    expect(v.reason).toMatch(/SUPPLY-001/);
    expect(classifyEvidence({ ...READABLE, codebookKnown: false }).disposition).toBe('quarantine');
  });
  it('registered but digest-tampered -> quarantine (registration does not immunize)', () => {
    expect(supplyChainVerdict({ registered: true, digestMatches: false }).disposition).toBe('quarantine');
  });
  it('registered + intact is at most advisory; registration is never authority', () => {
    const v = supplyChainVerdict({ registered: true, digestMatches: true });
    expect(v.disposition).toBe('readable_advisory');
    expect(v.grantsAuthority).toBe(false);
    expect(registrationGrantsAuthority()).toBe(false);
  });
  it('the real registry behaves the same way (vjepa codebook tags)', () => {
    expect(decodeJepaState(jepa({ codebookTag: 'unregistered-codebook' })).verdict).toBe('rejected_untranslatable');
    expect(decodeJepaState(jepa({ codebookTag: 'unregistered-codebook' })).grantsAuthority).toBe(false);
    // a registered tag buys readability, never authority
    const decoded = decodeJepaState(jepa({ codebookTag: 'glyph-v0' }));
    expect(decoded.verdict).toBe('decoded');
    expect(decoded.grantsAuthority).toBe(false);
    expect(decoded.advisoryOnly).toBe(true);
  });
});
