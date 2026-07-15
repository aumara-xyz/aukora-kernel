// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// AUMLOK owner-authority v2 — Brick 1 verifier + envelopes (#361 P0). The suite is the mandatory hybrid
// `aumlok-ed25519-ml-dsa-65-v1`: EVERY authorization carries Ed25519 AND ML-DSA-65 over the same canonical
// payload and BOTH must verify. This suite pins the release-blocking negatives: a valid Ed25519 alone can
// NEVER authorize; a valid ML-DSA under the wrong domain can NEVER lift; unknown/downgraded suites, malformed
// or wrong-case artifacts, tampered payloads, and single-signed migrations all fail closed.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { pqcSignWithDomain, PQC_DOMAINS } from '../src/crypto';
import {
  AUMLOK_SUITE_V2, AUMLOK_MODE_V2,
  pinAuthorityRootV2, revokeAuthorityRootV2, isValidAuthorityRootV2, rootIdV2, displayFingerprintV2,
  canonicalPromotionV2,
  verifyPromotionV2, verifyLifecycleV2, verifyMigrationV1,
  type PromotionAuthorizationV2, type KeyLifecycleEventV2,
} from '../src/aumlokAuthorityV2';
import {
  deriveHybridPublicKeys, rootIdForSeeds,
  signPromotionV2, signLifecycleV2, signMigrationV1,
} from '../src/aumlokSignerV2';
import { pinAuthorityRoot as pinV1 } from '../src/aumlokAuthorityRoot';

// ── fixed test seeds (32-byte lowercase hex) — deterministic, reproducible ──────────────────────────────
const OWNER_ED = 'a'.repeat(64);
const OWNER_ML = 'b'.repeat(64);
const NEW_ED = 'c'.repeat(64);
const NEW_ML = 'd'.repeat(64);
const T0 = '2026-07-12T12:00:00.000Z';
const FUTURE = '2999-01-01T00:00:00.000Z';
const PAST = '2000-01-01T00:00:00.000Z';

const pub = deriveHybridPublicKeys(OWNER_ED, OWNER_ML);
const root = pinAuthorityRootV2(pub, { createdAt: T0, expiresAt: null });

function auth(over: Partial<PromotionAuthorizationV2> = {}): PromotionAuthorizationV2 {
  return { rootId: root.rootId, proposalHash: 'p'.repeat(64), draftHash: 'q'.repeat(64), nonce: 'n1', issuedAt: T0, expiresAt: FUTURE, ...over };
}
const flip = (h: string) => (h[0] === '0' ? '1' : '0') + h.slice(1); // corrupt one hex nibble → forged
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe('the hybrid suite pins its constants and full-id discipline', () => {
  it('the suite + mode are the exact ratified strings; the root id is a FULL 64-hex, fingerprints are display-only', () => {
    expect(AUMLOK_SUITE_V2).toBe('aumlok-ed25519-ml-dsa-65-v1');
    expect(AUMLOK_MODE_V2).toBe('software_hybrid');
    expect(root.rootId).toHaveLength(64);
    expect(root.rootId).toBe(rootIdForSeeds(OWNER_ED, OWNER_ML));
    expect(isValidAuthorityRootV2(root)).toBe(true);
    expect(displayFingerprintV2(root.rootId)).toBe(root.rootId.slice(0, 12));
    expect(displayFingerprintV2(root.rootId)).toHaveLength(12);
  });
  it('a tampered pinned root (swapped public key) fails its integrity/id check', () => {
    const bad = clone(root); bad.publicKeys.ed25519 = deriveHybridPublicKeys(NEW_ED, OWNER_ML).ed25519;
    expect(isValidAuthorityRootV2(bad)).toBe(false);
  });
});

describe('promotion — the mandatory dual signature', () => {
  it('a correctly dual-signed promotion verifies', () => {
    const r = signPromotionV2(OWNER_ED, OWNER_ML, auth());
    expect(r.suite).toBe(AUMLOK_SUITE_V2);
    expect(verifyPromotionV2(r, root, T0)).toEqual({ valid: true });
  });

  it('RELEASE-BLOCKER: a valid Ed25519 with the ML-DSA signature removed/blanked REFUSES', () => {
    const r = signPromotionV2(OWNER_ED, OWNER_ML, auth());
    const noMl = clone(r); noMl.signatures.mlDsa65 = ''; // missing
    expect(verifyPromotionV2(noMl, root).valid).toBe(false);
  });
  it('a valid ML-DSA with the Ed25519 signature removed/blanked REFUSES', () => {
    const r = signPromotionV2(OWNER_ED, OWNER_ML, auth());
    const noEd = clone(r); noEd.signatures.ed25519 = '';
    expect(verifyPromotionV2(noEd, root).valid).toBe(false);
  });
  it('a FORGED ML-DSA signature (one nibble flipped) REFUSES, Ed25519 still valid', () => {
    const r = signPromotionV2(OWNER_ED, OWNER_ML, auth());
    const bad = clone(r); bad.signatures.mlDsa65 = flip(bad.signatures.mlDsa65);
    expect(verifyPromotionV2(bad, root)).toEqual({ valid: false, reason: 'ml-dsa-65 signature invalid' });
  });
  it('a FORGED Ed25519 signature REFUSES, ML-DSA still valid', () => {
    const r = signPromotionV2(OWNER_ED, OWNER_ML, auth());
    const bad = clone(r); bad.signatures.ed25519 = flip(bad.signatures.ed25519);
    expect(verifyPromotionV2(bad, root)).toEqual({ valid: false, reason: 'ed25519 signature invalid' });
  });
  it('one valid + one invalid signature REFUSES in both orders', () => {
    const r = signPromotionV2(OWNER_ED, OWNER_ML, auth());
    const other = signPromotionV2(NEW_ED, NEW_ML, auth()); // signatures for the SAME payload but wrong keys
    const edGood_mlWrong = clone(r); edGood_mlWrong.signatures.mlDsa65 = other.signatures.mlDsa65;
    const edWrong_mlGood = clone(r); edWrong_mlGood.signatures.ed25519 = other.signatures.ed25519;
    expect(verifyPromotionV2(edGood_mlWrong, root).valid).toBe(false);
    expect(verifyPromotionV2(edWrong_mlGood, root).valid).toBe(false);
  });
});

describe('promotion — malformed / wrong-case / closed-envelope gates', () => {
  it('truncated signatures REFUSE (Ed and ML)', () => {
    const r = signPromotionV2(OWNER_ED, OWNER_ML, auth());
    const tEd = clone(r); tEd.signatures.ed25519 = tEd.signatures.ed25519.slice(0, -2);
    const tMl = clone(r); tMl.signatures.mlDsa65 = tMl.signatures.mlDsa65.slice(0, -2);
    expect(verifyPromotionV2(tEd, root).reason).toMatch(/malformed signatures/);
    expect(verifyPromotionV2(tMl, root).reason).toMatch(/malformed signatures/);
  });
  it('WRONG-CASE (uppercased) signatures REFUSE — canonical wire is lowercase only', () => {
    const r = signPromotionV2(OWNER_ED, OWNER_ML, auth());
    const up = clone(r); up.signatures.mlDsa65 = up.signatures.mlDsa65.toUpperCase();
    expect(verifyPromotionV2(up, root).valid).toBe(false);
  });
  it('a DUPLICATED signature (same string in both slots) REFUSES', () => {
    const r = signPromotionV2(OWNER_ED, OWNER_ML, auth());
    const dup = clone(r); dup.signatures.mlDsa65 = dup.signatures.ed25519; // same value both slots
    expect(verifyPromotionV2(dup, root).reason).toMatch(/malformed signatures/);
  });
  it('an UNKNOWN extra field (receipt, signatures, or authorization) REFUSES', () => {
    const r = signPromotionV2(OWNER_ED, OWNER_ML, auth());
    const eReceipt = clone(r) as any; eReceipt.shadow = 'x';
    const eSig = clone(r) as any; eSig.signatures.extra = 'x';
    const eAuth = clone(r) as any; eAuth.authorization.extra = 'x';
    expect(verifyPromotionV2(eReceipt, root).reason).toMatch(/unknown field/);
    expect(verifyPromotionV2(eSig, root).valid).toBe(false);
    expect(verifyPromotionV2(eAuth, root).valid).toBe(false);
  });
});

describe('promotion — suite / domain / binding gates', () => {
  it('an UNKNOWN suite REFUSES', () => {
    const r = signPromotionV2(OWNER_ED, OWNER_ML, auth()) as any; r.suite = 'totally-unknown-suite-v9';
    expect(verifyPromotionV2(r, root).reason).toMatch(/unknown or downgraded suite/);
  });
  it('a DOWNGRADED suite (ed25519-only) REFUSES', () => {
    const r = signPromotionV2(OWNER_ED, OWNER_ML, auth()) as any; r.suite = 'aumlok-ed25519-v1';
    expect(verifyPromotionV2(r, root).reason).toMatch(/unknown or downgraded suite/);
  });
  it('a REORDERED suite label REFUSES (exact match only)', () => {
    const r = signPromotionV2(OWNER_ED, OWNER_ML, auth()) as any; r.suite = 'aumlok-ml-dsa-65-ed25519-v1';
    expect(verifyPromotionV2(r, root).valid).toBe(false);
  });
  it('DOMAIN NON-LIFTING: a valid ML-DSA signature made under the LIFECYCLE domain does not verify as a promotion', () => {
    const a = auth();
    const msg = new TextEncoder().encode(canonicalPromotionV2(a));
    const wrongDomainMl = pqcSignWithDomain(OWNER_ML, msg, 'aumlokLifecycle'); // right payload, WRONG domain
    const edGood = bytesToHex(ed25519.sign(msg, hexToBytes(OWNER_ED)));
    const forged = { schema: 'aumlok-signed-promotion-v2', suite: AUMLOK_SUITE_V2, authorization: a, mode: AUMLOK_MODE_V2, signatures: { ed25519: edGood, mlDsa65: wrongDomainMl } };
    expect(verifyPromotionV2(forged, root)).toEqual({ valid: false, reason: 'ml-dsa-65 signature invalid' });
  });
  it('a rootId mismatch REFUSES', () => {
    const r = signPromotionV2(OWNER_ED, OWNER_ML, auth({ rootId: rootIdForSeeds(NEW_ED, NEW_ML) }));
    expect(verifyPromotionV2(r, root).reason).toMatch(/rootId mismatch/);
  });
  it('a TAMPERED authorization (payload changed after signing) REFUSES', () => {
    const r = signPromotionV2(OWNER_ED, OWNER_ML, auth());
    const bad = clone(r); bad.authorization.proposalHash = 'z'.repeat(64);
    expect(verifyPromotionV2(bad, root).valid).toBe(false);
  });
  it('an EXPIRED authorization or an EXPIRED root REFUSES; a REVOKED root REFUSES', () => {
    const rExp = signPromotionV2(OWNER_ED, OWNER_ML, auth({ expiresAt: PAST }));
    expect(verifyPromotionV2(rExp, root, T0).reason).toMatch(/authorization expired/);
    const expiredRoot = pinAuthorityRootV2(pub, { createdAt: T0, expiresAt: PAST });
    const r2 = signPromotionV2(OWNER_ED, OWNER_ML, auth());
    expect(verifyPromotionV2(r2, expiredRoot, T0).reason).toMatch(/root expired/);
    const revoked = revokeAuthorityRootV2(root); // re-sealed integrity, revoked:true
    expect(verifyPromotionV2(signPromotionV2(OWNER_ED, OWNER_ML, auth()), revoked).reason).toMatch(/revoked/);
  });
});

describe('lifecycle — rotate/revoke, dual-signed', () => {
  const rotateEvent: KeyLifecycleEventV2 = { action: 'rotate', rootId: root.rootId, newPublicKeys: deriveHybridPublicKeys(NEW_ED, NEW_ML), reason: 'scheduled rotation', issuedAt: T0 };
  const revokeEvent: KeyLifecycleEventV2 = { action: 'revoke', rootId: root.rootId, newPublicKeys: null, reason: 'compromise drill', issuedAt: T0 };
  it('a dual-signed rotate and a dual-signed revoke both verify', () => {
    expect(verifyLifecycleV2(signLifecycleV2(OWNER_ED, OWNER_ML, rotateEvent), root)).toEqual({ valid: true });
    expect(verifyLifecycleV2(signLifecycleV2(OWNER_ED, OWNER_ML, revokeEvent), root)).toEqual({ valid: true });
  });
  it('REGRESSION (Codex #362): a validly-signed lifecycle event from a REVOKED root REFUSES', () => {
    const revokedRoot = revokeAuthorityRootV2(root); // re-sealed integrity, revoked:true
    const r = signLifecycleV2(OWNER_ED, OWNER_ML, revokeEvent); // event.rootId still matches; signatures valid
    expect(verifyLifecycleV2(r, revokedRoot, T0)).toEqual({ valid: false, reason: 'authority root revoked' });
  });
  it('REGRESSION (Codex #362): a validly-signed lifecycle event against an EXPIRED root REFUSES', () => {
    const expiredRoot = pinAuthorityRootV2(pub, { createdAt: T0, expiresAt: PAST });
    const r = signLifecycleV2(OWNER_ED, OWNER_ML, rotateEvent);
    expect(verifyLifecycleV2(r, expiredRoot, T0).reason).toMatch(/root expired/);
  });
  it('a rotate with a missing ML-DSA signature REFUSES', () => {
    const r = clone(signLifecycleV2(OWNER_ED, OWNER_ML, rotateEvent)); r.signatures.mlDsa65 = '';
    expect(verifyLifecycleV2(r, root).valid).toBe(false);
  });
  it('a revoke that illegally carries a new key pair REFUSES', () => {
    const bad = { action: 'revoke', rootId: root.rootId, newPublicKeys: deriveHybridPublicKeys(NEW_ED, NEW_ML), reason: 'x', issuedAt: T0 } as any;
    expect(verifyLifecycleV2(signLifecycleV2(OWNER_ED, OWNER_ML, bad), root).valid).toBe(false);
  });
  it('DOMAIN NON-LIFTING: a promotion ML-DSA signature cannot authorize a lifecycle event', () => {
    // craft a lifecycle receipt whose ML-DSA half was signed under the PROMOTION domain
    const msg = new TextEncoder().encode(JSON.stringify({ _: 'aumlok-key-lifecycle-v2', suite: AUMLOK_SUITE_V2, action: revokeEvent.action, rootId: revokeEvent.rootId, newPublicKeys: null, reason: revokeEvent.reason, issuedAt: revokeEvent.issuedAt }));
    const wrong = pqcSignWithDomain(OWNER_ML, msg, 'aumlokPromotion');
    const ed = bytesToHex(ed25519.sign(msg, hexToBytes(OWNER_ED)));
    const forged = { schema: 'aumlok-key-lifecycle-v2', suite: AUMLOK_SUITE_V2, event: revokeEvent, mode: AUMLOK_MODE_V2, signatures: { ed25519: ed, mlDsa65: wrong } };
    expect(verifyLifecycleV2(forged, root)).toEqual({ valid: false, reason: 'ml-dsa-65 signature invalid' });
  });
});

describe('migration — authorized FROM a TRUSTED pinned legacy root, not the envelope', () => {
  // the outgoing legacy (v1 Ed25519-only) owner: its public key is what the verifier trusts
  const oldEdPub = bytesToHex(ed25519.getPublicKey(hexToBytes(OWNER_ED)));
  const trustedOldRoot = pinV1(oldEdPub, { createdAt: T0, expiresAt: null });
  function mig(over: Partial<Parameters<typeof signMigrationV1>[0]> = {}) {
    return signMigrationV1({ oldEdSeedHex: OWNER_ED, newEdSeedHex: NEW_ED, newMlSeedHex: NEW_ML, nonce: 'm1', issuedAt: T0, expiresAt: FUTURE, ...over });
  }
  it('a properly counter-signed migration against the trusted legacy root verifies', () => {
    expect(verifyMigrationV1(mig(), trustedOldRoot, T0)).toEqual({ valid: true });
  });
  it('RELEASE-BLOCKER (Codex #362): a fresh Ed key signing its OWN migration cannot pass against a DIFFERENT trusted root', () => {
    // attacker generates a brand-new old key, self-signs a coherent migration (its oldRootId is the derived
    // label of ITS key), but the pinned legacy root the organism trusts is the REAL owner's — bind refuses
    const attacker = signMigrationV1({ oldEdSeedHex: 'e'.repeat(64), newEdSeedHex: NEW_ED, newMlSeedHex: NEW_ML, nonce: 'x', issuedAt: T0, expiresAt: FUTURE });
    expect(verifyMigrationV1(attacker, trustedOldRoot, T0).reason).toMatch(/does not match the pinned legacy root/);
  });
  it('a fabricated oldRootId label (envelope-supplied) REFUSES — the id is derived from the trusted key', () => {
    const m = clone(mig()); m.oldRootId = 'f'.repeat(64);
    expect(verifyMigrationV1(m, trustedOldRoot, T0).reason).toMatch(/old root id does not match/);
  });
  it('a swapped envelope oldPublicKey REFUSES even if otherwise coherent', () => {
    const m = clone(mig()); m.oldPublicKey = bytesToHex(ed25519.getPublicKey(hexToBytes('e'.repeat(64))));
    expect(verifyMigrationV1(m, trustedOldRoot, T0).reason).toMatch(/old public key does not match/);
  });
  it('a REVOKED or EXPIRED trusted legacy root authorizes NO migration', () => {
    expect(verifyMigrationV1(mig(), { ...trustedOldRoot, revoked: true }, T0).reason).toMatch(/legacy root revoked/);
    expect(verifyMigrationV1(mig(), { ...trustedOldRoot, expiresAt: PAST }, T0).reason).toMatch(/legacy root expired/);
  });
  it('a migration signed ONLY by the old Ed (ML PoP blanked) REFUSES', () => {
    const m = clone(mig()); m.newSignature = '';
    expect(verifyMigrationV1(m, trustedOldRoot, T0).valid).toBe(false);
  });
  it('a migration signed ONLY by the new ML (old Ed consent blanked) REFUSES', () => {
    const m = clone(mig()); m.oldSignature = '';
    expect(verifyMigrationV1(m, trustedOldRoot, T0).valid).toBe(false);
  });
  it('a CHANGED new public key (after signing) REFUSES — payload no longer matches', () => {
    const m = clone(mig()); m.newPublicKeys.mlDsa65 = deriveHybridPublicKeys(NEW_ED, OWNER_ML).mlDsa65; m.newRootId = rootIdV2(m.newPublicKeys);
    expect(verifyMigrationV1(m, trustedOldRoot, T0).valid).toBe(false);
  });
  it('a new rootId that does not match the new material REFUSES', () => {
    const m = clone(mig()); m.newRootId = 'f'.repeat(64);
    expect(verifyMigrationV1(m, trustedOldRoot, T0).reason).toMatch(/new rootId does not match/);
  });
  it('an EXPIRED migration REFUSES — expiry BOUNDS the window only; durable nonce-replay prevention is a later brick (NOT claimed here)', () => {
    expect(verifyMigrationV1(mig({ expiresAt: PAST }), trustedOldRoot, T0).reason).toMatch(/migration expired/);
  });
});

describe('Brick-1 discipline: chokepoint isolation, registered domains, v1 preserved, no apply wiring', () => {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', 'src', p), 'utf-8');
  const verifier = read('aumlokAuthorityV2.ts');
  const signer = read('aumlokSignerV2.ts');

  it('the new AUMLOK modules NEVER import the PQC core directly — ML-DSA goes ONLY through the chokepoints', () => {
    for (const src of [verifier, signer]) {
      expect(src).not.toContain('ml_dsa65');
      expect(src).not.toContain('@noble/post-quantum');
    }
    expect(verifier).toContain('pqcVerifyWithDomain');
    expect(signer).toContain('pqcSignWithDomain');
  });
  it('the three purpose-separated AUMLOK domains are registered in the frozen PQC registry', () => {
    expect(PQC_DOMAINS.aumlokPromotion).toBe('aumlok-promotion-v2');
    expect(PQC_DOMAINS.aumlokLifecycle).toBe('aumlok-lifecycle-v2');
    expect(PQC_DOMAINS.aumlokMigration).toBe('aumlok-migration-v1');
  });
  it('Brick 1 wires NO bind/apply path — the verifier/signer never reference native apply', () => {
    for (const src of [verifier, signer]) {
      expect(src).not.toContain('nativeLiveApply');
    }
  });
});

describe('v1 historical Ed25519 verification is PRESERVED (untouched by the v2 addition)', () => {
  it('an old v1 promotion receipt still verifies against a v1 root', async () => {
    const v1 = await import('../src/aumlokAuthorityRoot');
    const signer = await import('../src/aumlokSigner');
    const priv = 'a'.repeat(64);
    const pubHex = bytesToHex(ed25519.getPublicKey(hexToBytes(priv)));
    const r = v1.pinAuthorityRoot(pubHex, { createdAt: T0, expiresAt: null });
    const receipt = signer.signPromotionAuthorization(priv, { keyId: r.keyId, proposalHash: 'p'.repeat(64), draftHash: 'q'.repeat(64), nonce: 'n', issuedAt: T0, expiresAt: FUTURE });
    expect(v1.verifyPromotionReceipt(receipt, r, T0)).toEqual({ valid: true });
  });
});
