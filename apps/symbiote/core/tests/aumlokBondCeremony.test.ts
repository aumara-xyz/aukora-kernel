import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  createUnboundBond, revealPhrase, pinPublicFingerprint, witnessVoicePresence,
  markReadyForSignature, generateVoiceChallenge, generateMockCeremonyPhrase,
  validateBond, sanitizeBondForArtifact, bondGrantsAuthority, isBondApplyEligible, isPublicFingerprint,
  deriveCeremonyProjection, advisoryBondStateFromProjection, legalAuthorityFromVerifier, rejectForbiddenProjection,
  type AumlokBond, type VoicePresenceWitness,
} from '../src/aumlokBondCeremony';

const NOW = '2026-06-19T00:00:00.000Z';
const FP = 'a1b2c3d4e5f60718'; // 16 hex — a valid public fingerprint

function freshBond(): AumlokBond {
  return createUnboundBond(NOW);
}

describe('24Z: ceremony state machine', () => {
  it('starts unbound, no authority', () => {
    const b = freshBond();
    expect(b.bondState).toBe('unbound');
    expect(b.grantsAuthority).toBe(false);
    expect(b.signatureRequired).toBe(true);
    expect(b.publicFingerprint).toBe('');
  });

  it('reveal → pin → witness → ready, monotonic', () => {
    let b = revealPhrase(freshBond(), NOW);
    expect(b.bondState).toBe('phrase_revealed');
    expect(b.phraseRevealedOnce).toBe(true);
    b = pinPublicFingerprint(b, FP, NOW);
    expect(b.bondState).toBe('public_fingerprint_pinned');
    expect(b.publicFingerprint).toBe(FP);
    b = witnessVoicePresence(b, generateVoiceChallenge('c1', '4827', 3), NOW);
    expect(b.bondState).toBe('presence_witnessed');
    b = markReadyForSignature(b, NOW);
    expect(b.bondState).toBe('ready_for_signature');
  });

  it('one-time reveal never re-exposes; summary is non-revealing', () => {
    const b1 = revealPhrase(freshBond(), NOW);
    const b2 = revealPhrase(b1, NOW);
    expect(b2.phraseRevealedOnce).toBe(true);
    expect(b1.phraseWitnessSummary).not.toMatch(/salama|sunrise|amber/); // no raw phrase words
    expect(b1.phraseWitnessSummary).toContain('not stored');
  });

  it('ready_for_signature REQUIRES a pinned public fingerprint', () => {
    expect(() => markReadyForSignature(revealPhrase(freshBond(), NOW), NOW)).toThrow('not_ready');
  });
});

describe('24Z: phrase / voice / fingerprint NEVER grant authority', () => {
  it('phrase reveal does not grant authority', () => {
    const b = revealPhrase(freshBond(), NOW);
    expect(b.grantsAuthority).toBe(false);
    expect(bondGrantsAuthority(b)).toBe(false);
  });

  it('voice witness does not grant authority (voiceIsAuthority false)', () => {
    const b = witnessVoicePresence(pinPublicFingerprint(freshBond(), FP, NOW), generateVoiceChallenge('c', '11', 2), NOW);
    expect(b.grantsAuthority).toBe(false);
    expect(b.voicePresenceWitness!.voiceIsAuthority).toBe(false);
    expect(b.voicePresenceWitness!.grantsAuthority).toBe(false);
  });

  it('a witness claiming voiceIsAuthority=true is REFUSED', () => {
    const bad = { ...generateVoiceChallenge('c', '1', 1), voiceIsAuthority: true } as unknown as VoicePresenceWitness;
    expect(() => witnessVoicePresence(pinPublicFingerprint(freshBond(), FP, NOW), bad, NOW)).toThrow('voice_is_authority_must_be_false');
  });

  it('even at ready_for_signature, the bond grants nothing and is not apply-eligible', () => {
    let b = pinPublicFingerprint(freshBond(), FP, NOW);
    b = markReadyForSignature(b, NOW);
    expect(b.grantsAuthority).toBe(false);
    const elig = isBondApplyEligible(b);
    expect(elig.eligible).toBe(false);
    expect(elig.reasons.join(' ')).toContain('signature is the only crossing');
  });
});

describe('24Z: public fingerprint vs key material', () => {
  it('accepts short public hex', () => {
    expect(isPublicFingerprint(FP)).toBe(true);
    expect(isPublicFingerprint('a'.repeat(64))).toBe(true);
  });
  it('rejects long blobs / non-hex / key material', () => {
    expect(isPublicFingerprint('a'.repeat(160))).toBe(false); // looks like key material
    expect(isPublicFingerprint('not-hex-phrase')).toBe(false);
    expect(isPublicFingerprint('')).toBe(false);
    expect(isPublicFingerprint('-----BEGIN')).toBe(false);
  });
  it('pinPublicFingerprint throws on non-public-fingerprint input', () => {
    expect(() => pinPublicFingerprint(freshBond(), 'a'.repeat(200), NOW)).toThrow('public_fingerprint_invalid');
  });
});

describe('24Z: voice challenge anti-replay (no raw audio/biometric)', () => {
  it('binds challengeId + nonce into the hash (fresh challenge ≠ stale)', () => {
    const a = generateVoiceChallenge('c1', '1111', 3);
    const b = generateVoiceChallenge('c2', '2222', 3);
    expect(a.spokenChallengeHash).not.toBe(b.spokenChallengeHash);
    expect(a.voiceIsAuthority).toBe(false);
    expect(a.livenessMode).toBe('mock');
  });
  it('positions clamp to 1..6 (never position 0)', () => {
    expect(generateVoiceChallenge('c', '1', 0).transcriptChallenge).toContain('#1');
    expect(generateVoiceChallenge('c', '1', 9).transcriptChallenge).toContain('#6');
  });
  it('challenge carries no raw audio / voiceprint fields', () => {
    const v = generateVoiceChallenge('c', '1', 1);
    const json = JSON.stringify(v);
    expect(json).not.toMatch(/rawAudio|voiceEmbedding|biometric/i);
  });
});

describe('24Z: mock ceremony phrase is display-only, never persisted', () => {
  it('has donor shape (6-letter anchor, 6 key words) + mock/doNotPersist flags', () => {
    const p = generateMockCeremonyPhrase();
    expect(p.anchor.length).toBe(6);
    expect(p.keyWords.length).toBe(6);
    expect(p.mock).toBe(true);
    expect(p.doNotPersist).toBe(true);
  });
  it('the bond does NOT carry the raw phrase words (only a summary)', () => {
    const b = revealPhrase(freshBond(), NOW);
    const json = JSON.stringify(b);
    expect(json).not.toMatch(/sunrise|amber|lumen|meadow/); // mock key words never enter the bond
  });
});

describe('24Z: validateBond — forbidden material rejected, invariants enforced', () => {
  it('clean bond passes', () => {
    let b = pinPublicFingerprint(revealPhrase(freshBond(), NOW), FP, NOW);
    b = markReadyForSignature(b, NOW);
    expect(validateBond(b).valid).toBe(true);
  });

  it('rejects privateKey / seed / rawJwk / mnemonic', () => {
    for (const k of ['privateKey', 'seed', 'signingSeed', 'rawJwk', 'mnemonicSecret']) {
      const b = { ...freshBond(), [k]: 'x' } as unknown as AumlokBond;
      const r = validateBond(b);
      expect(r.valid).toBe(false);
      expect(r.violations.join(' ')).toContain(k);
    }
  });

  it('rejects rawAudio / voiceEmbedding / biometricTemplate', () => {
    for (const k of ['rawAudio', 'voiceEmbedding', 'biometricTemplate']) {
      const b = { ...freshBond(), [k]: 'x' } as unknown as AumlokBond;
      expect(validateBond(b).valid).toBe(false);
    }
  });

  it('rejects bearer/apiKey/OPENROUTER/PEM patterns', () => {
    expect(validateBond({ ...freshBond(), apiKey: 'sk-or-abcdefghijklmnop' } as any).valid).toBe(false);
    expect(validateBond({ ...freshBond(), note: 'OPENROUTER_API_KEY' } as any).valid).toBe(false);
    expect(validateBond({ ...freshBond(), blob: '-----BEGIN PRIVATE KEY-----' } as any).valid).toBe(false);
  });

  it('rejects grantsAuthority=true / advisoryOnly=false / signatureRequired=false', () => {
    expect(validateBond({ ...freshBond(), grantsAuthority: true } as any).valid).toBe(false);
    expect(validateBond({ ...freshBond(), advisoryOnly: false } as any).valid).toBe(false);
    expect(validateBond({ ...freshBond(), signatureRequired: false } as any).valid).toBe(false);
  });
});

describe('24Z: sanitizeBondForArtifact — public fields only', () => {
  it('public fingerprint CAN enter the artifact; voice keeps only public challenge (no hash)', () => {
    let b = pinPublicFingerprint(revealPhrase(freshBond(), NOW), FP, NOW);
    b = witnessVoicePresence(b, generateVoiceChallenge('cid', '4827', 3), NOW);
    const a = sanitizeBondForArtifact(b);
    expect(a.publicFingerprint).toBe(FP);
    expect(a.grantsAuthority).toBe(false);
    expect(a.advisoryOnly).toBe(true);
    expect(a.privateKeyInArtifact).toBe(false);
    expect(a.voicePresenceWitness!.voiceIsAuthority).toBe(false);
    // the spokenChallengeHash is NOT carried into the artifact state
    expect((a.voicePresenceWitness as any).spokenChallengeHash).toBeUndefined();
    expect(validateBond(b).valid).toBe(true);
  });
});

describe('24Z: Fusion hardening — sanitize allowlist + all-states no-authority', () => {
  const BOND_ALLOWED = new Set([
    'bondState', 'publicFingerprint', 'phraseWitnessSummary', 'phraseRevealedOnce',
    'voicePresenceWitness', 'signatureRequired', 'privateKeyInArtifact', 'advisoryOnly', 'grantsAuthority',
  ]);
  const VOICE_ALLOWED = new Set([
    'transcriptChallenge', 'challengeId', 'livenessMode', 'witnessed', 'voiceIsAuthority', 'advisoryOnly', 'grantsAuthority',
  ]);

  it('sanitizeBondForArtifact output keys are a SUBSET of the frozen allowlist (GLM)', () => {
    let b = pinPublicFingerprint(revealPhrase(freshBond(), NOW), FP, NOW);
    b = witnessVoicePresence(b, generateVoiceChallenge('cid', '4827', 3), NOW);
    const a = sanitizeBondForArtifact(b);
    for (const k of Object.keys(a)) expect(BOND_ALLOWED.has(k)).toBe(true);
    for (const k of Object.keys(a.voicePresenceWitness!)) expect(VOICE_ALLOWED.has(k)).toBe(true);
  });

  it('injected forbidden fields on the input bond NEVER survive sanitization', () => {
    let b = pinPublicFingerprint(revealPhrase(freshBond(), NOW), FP, NOW);
    b = witnessVoicePresence(b, generateVoiceChallenge('cid', '1', 1), NOW);
    // smuggle key material + the challenge hash onto the bond + the witness
    const dirty = {
      ...b,
      privateKey: 'LEAK', seed: 'LEAK', rawJwk: 'LEAK',
      voicePresenceWitness: { ...b.voicePresenceWitness!, spokenChallengeHash: 'HASHLEAK', rawAudio: 'AUDIOLEAK' },
    } as any;
    const a = sanitizeBondForArtifact(dirty);
    const json = JSON.stringify(a);
    expect(json).not.toContain('LEAK');
    expect(json).not.toContain('HASHLEAK');
    expect(json).not.toContain('AUDIOLEAK');
    expect((a.voicePresenceWitness as any).spokenChallengeHash).toBeUndefined();
  });

  it('grantsAuthority is false at EVERY bond state (Qwen)', () => {
    let b = freshBond();
    expect(bondGrantsAuthority(b)).toBe(false); expect(b.grantsAuthority).toBe(false);
    b = revealPhrase(b, NOW); expect(b.grantsAuthority).toBe(false);
    b = pinPublicFingerprint(b, FP, NOW); expect(b.grantsAuthority).toBe(false);
    b = witnessVoicePresence(b, generateVoiceChallenge('c', '1', 1), NOW); expect(b.grantsAuthority).toBe(false);
    b = markReadyForSignature(b, NOW); expect(b.grantsAuthority).toBe(false);
    expect(bondGrantsAuthority(b)).toBe(false);
  });

  it('revealPhrase summary is non-invertible (no raw phrase words, GLM)', () => {
    const mock = generateMockCeremonyPhrase();
    const summary = revealPhrase(freshBond(), NOW).phraseWitnessSummary;
    for (const w of [mock.anchor, ...mock.keyWords]) expect(summary).not.toContain(w);
  });
});

describe('24Z.1: ABB-001 projection / authority boundary (GHP absorption)', () => {
  function builtBond(): AumlokBond {
    let b = pinPublicFingerprint(revealPhrase(freshBond(), NOW), FP, NOW);
    b = witnessVoicePresence(b, generateVoiceChallenge('cid', '4827', 3), NOW);
    return markReadyForSignature(b, NOW);
  }

  it('VerifierAbsent -> authority 0', () => {
    expect(legalAuthorityFromVerifier(null)).toBe(0);
    expect(legalAuthorityFromVerifier(undefined)).toBe(0);
    expect(legalAuthorityFromVerifier({ verifierPresent: false, verified: true })).toBe(0); // laundered claim
  });

  it('placeholder signature without a verifier -> no authority', () => {
    // a "signature" string that never reached a verifier yields verifierPresent:false -> 0
    const placeholder = { verifierPresent: false, verified: true };
    expect(legalAuthorityFromVerifier(placeholder)).toBe(0);
  });

  it('authority flips to 1 ONLY when a real verifier returns true', () => {
    expect(legalAuthorityFromVerifier({ verifierPresent: true, verified: false })).toBe(0);
    expect(legalAuthorityFromVerifier({ verifierPresent: true, verified: true })).toBe(1);
  });

  it('same visible projection -> same advisory bond state (N^1=N^2 -> B^1=B^2)', () => {
    const a = builtBond();
    // a second bond with identical VISIBLE fields but a different hidden field (updatedAt)
    const b = { ...builtBond(), updatedAt: '2099-01-01T00:00:00.000Z' } as AumlokBond;
    const pa = deriveCeremonyProjection(a);
    const pb = deriveCeremonyProjection(b);
    expect(pa).toEqual(pb);
    expect(advisoryBondStateFromProjection(pa)).toBe(advisoryBondStateFromProjection(pb));
  });

  it('hidden non-authority perturbation -> no change in B_t or A_t', () => {
    const base = builtBond();
    const perturbed = { ...base, updatedAt: 'changed', someHiddenAdvisory: 'noise' } as unknown as AumlokBond;
    expect(advisoryBondStateFromProjection(deriveCeremonyProjection(perturbed)))
      .toBe(advisoryBondStateFromProjection(deriveCeremonyProjection(base)));
    // A_t is a pure function of the verifier — a hidden bond change cannot move it
    expect(legalAuthorityFromVerifier(null)).toBe(0);
  });

  it('forbidden projection is rejected (private/authority-bearing fields)', () => {
    const p = deriveCeremonyProjection(builtBond());
    expect(rejectForbiddenProjection({ ...p, privateKey: 'x' }).ok).toBe(false);
    expect(rejectForbiddenProjection({ ...p, signature: 'x' }).ok).toBe(false);
    expect(rejectForbiddenProjection({ ...p, spokenChallengeHash: 'x' }).ok).toBe(false);
    expect(rejectForbiddenProjection(p).ok).toBe(true); // clean projection passes
  });

  it('a valid-looking grantsAuthority:true projection is rejected', () => {
    const p = deriveCeremonyProjection(builtBond());
    expect(rejectForbiddenProjection({ ...p, grantsAuthority: true }).ok).toBe(false);
  });

  it('NON-FORGEABLE authority: legalAuthorityFromSignature needs a real ML-DSA signature vs a pinned key', async () => {
    const fsx = await import('fs'); const px = await import('path');
    const { legalAuthorityFromSignature } = await import('../src/aumlokBondCeremony');
    const { SIGNED_HEAD_V4_ALG } = await import('../src/convexCanonicalPin');
    const vec = JSON.parse(fsx.readFileSync(px.join(__dirname, 'fixtures', 'canonical-head-vector.json'), 'utf-8'));
    const head = {
      exists: true, chainKey: vec.head.chainKey, count: vec.head.chainLength,
      lastChainHash: vec.head.chainHeadHash, headSig: vec.sig, headSigAlg: vec.headSigAlg,
      headSignedAt: vec.head.timestamp, receiptLogRoot: vec.merkleRoot, updatedAt: vec.head.timestamp,
    };
    const goodPin = { publicKeyHex: vec.publicKey, expectedAlg: SIGNED_HEAD_V4_ALG, allowedChainKeys: null, source: 'explicit_config' as const };
    // a real, kernel-signed head verified against the pinned key → authority 1
    expect(legalAuthorityFromSignature(head as any, goodPin)).toBe(1);
    // no pin → 0 ; forged signature → 0 ; a duck-typed object cannot fake this (no signing seed)
    expect(legalAuthorityFromSignature(head as any, null)).toBe(0);
    expect(legalAuthorityFromSignature({ ...head, headSig: 'a'.repeat(6618) } as any, goodPin)).toBe(0);
  });

  it('ceremony language ("approved") cannot become authority', () => {
    // even a projection whose summary literally says "approved" yields authority 0 without a verifier
    const lang = { ...deriveCeremonyProjection(builtBond()), phraseWitnessSummary: 'approved by ceremony' };
    expect(rejectForbiddenProjection(lang).ok).toBe(true); // language is allowed in the visible projection
    expect(legalAuthorityFromVerifier(null)).toBe(0);       // but it never crosses into authority
    expect(advisoryBondStateFromProjection(lang)).toBe('ready_for_signature'); // it's only advisory state
  });
});

describe('24Z: source safety', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'aumlokBondCeremony.ts'), 'utf-8');
  it('no runtime import from AUMA-ONE-APP', () => {
    const importLines = src.split('\n').filter((l) => /^\s*(import|require)\s/.test(l));
    for (const l of importLines) expect(l).not.toContain('AUMA-ONE-APP');
  });
  it('donor strings (salama) appear only as mock metadata, never imported', () => {
    // 'salama' may appear as a mock display vocab string; it must not be in an import line
    const importLines = src.split('\n').filter((l) => /^\s*(import|require)\s/.test(l));
    for (const l of importLines) expect(l).not.toMatch(/salama/);
  });
  it('module never generates a real key / captures audio', () => {
    expect(src).not.toContain('generateKeyPair');
    expect(src).not.toContain('getUserMedia');
    expect(src).not.toContain('MediaRecorder');
    expect(src).not.toMatch(/ml_dsa65\.(keygen|sign)/);
  });
});
