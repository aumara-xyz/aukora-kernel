// AUMLOK Ed25519 dev-real authority root (Step-4). The human holds the private key and signs; the organism
// holds only the pinned PUBLIC key and verifies. Covers: round-trip, tamper, forgery, revocation, expiry,
// key custody (no private key in the organism), key rotation/rollback, and PROMOTION-STAYS-LOCKED.
import { describe, it, expect } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import {
  pinAuthorityRoot, revokeAuthorityRoot, verifyPromotionReceipt,
  isLivePromotionUnlocked, type PromotionAuthorization,
} from '../src/aumlokAuthorityRoot';
import { signPromotionAuthorization } from '../src/aumlokSigner';

const HUMAN_PRIV = '11'.repeat(32);                                   // the human's private key (test stand-in)
const HUMAN_PUB = bytesToHex(ed25519.getPublicKey(hexToBytes(HUMAN_PRIV)));
const ATTACKER_PRIV = '22'.repeat(32);
const ROOT = pinAuthorityRoot(HUMAN_PUB, { createdAt: '2026-06-30T00:00:00.000Z' });
const NOON = '2026-06-30T12:00:00.000Z';

function auth(over: Partial<PromotionAuthorization> = {}): PromotionAuthorization {
  return { keyId: ROOT.keyId, proposalHash: 'phash', draftHash: 'dhash', nonce: 'n1', issuedAt: '2026-06-30T00:00:00.000Z', expiresAt: null, ...over };
}

describe('AUMLOK Ed25519 dev-real authority root', () => {
  it('round-trip: a human signature verifies against the pinned public key', () => {
    const receipt = signPromotionAuthorization(HUMAN_PRIV, auth());
    expect(verifyPromotionReceipt(receipt, ROOT).valid).toBe(true);
    expect(receipt.mode).toBe('dev_real');
    expect(receipt.algorithm).toBe('ed25519');
  });

  it('tampering the authorization breaks verification', () => {
    const receipt = signPromotionAuthorization(HUMAN_PRIV, auth());
    const tampered = { ...receipt, authorization: { ...receipt.authorization, draftHash: 'EVIL' } };
    expect(verifyPromotionReceipt(tampered, ROOT).valid).toBe(false);
  });

  it('a signature from a DIFFERENT key (forgery) is rejected by the pinned root', () => {
    const forged = signPromotionAuthorization(ATTACKER_PRIV, auth());
    const v = verifyPromotionReceipt(forged, ROOT);
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/signature invalid/);
  });

  it('WRONG KEYID: a promotion authorization carrying a different root\'s keyId is rejected', () => {
    const otherRoot = pinAuthorityRoot(bytesToHex(ed25519.getPublicKey(hexToBytes(ATTACKER_PRIV))));
    const receipt = signPromotionAuthorization(ATTACKER_PRIV, auth({ keyId: otherRoot.keyId }));
    const v = verifyPromotionReceipt(receipt, ROOT);
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/keyId mismatch/);
  });

  it('REVOCATION: a revoked root rejects an otherwise-valid receipt', () => {
    const receipt = signPromotionAuthorization(HUMAN_PRIV, auth());
    const v = verifyPromotionReceipt(receipt, revokeAuthorityRoot(ROOT));
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/revoked/);
  });

  it('EXPIRY: an expired root and an expired authorization both fail; a future expiry verifies', () => {
    const expiredRoot = pinAuthorityRoot(HUMAN_PUB, { expiresAt: '2026-06-29T00:00:00.000Z' });
    const r1 = signPromotionAuthorization(HUMAN_PRIV, auth({ keyId: expiredRoot.keyId }));
    expect(verifyPromotionReceipt(r1, expiredRoot, NOON).valid).toBe(false);

    const r2 = signPromotionAuthorization(HUMAN_PRIV, auth({ expiresAt: '2026-06-29T00:00:00.000Z' }));
    expect(verifyPromotionReceipt(r2, ROOT, NOON).valid).toBe(false);

    const r3 = signPromotionAuthorization(HUMAN_PRIV, auth({ expiresAt: '2027-01-01T00:00:00.000Z' }));
    expect(verifyPromotionReceipt(r3, ROOT, NOON).valid).toBe(true);
  });

  it('KEY CUSTODY: the organism holds only the public key — no private key in the root or the receipt', () => {
    const receipt = signPromotionAuthorization(HUMAN_PRIV, auth());
    expect((ROOT as any).privateKey).toBeUndefined();
    expect((ROOT as any).secretKey).toBeUndefined();
    expect(JSON.stringify(ROOT)).not.toContain(HUMAN_PRIV);
    expect(JSON.stringify(receipt)).not.toContain(HUMAN_PRIV); // receipt carries a signature, not the key
    expect(verifyPromotionReceipt(receipt, ROOT).valid).toBe(true); // verify needs ONLY the public-key root
  });

  it('ROLLBACK / key rotation: revoke old, pin new — old receipt fails on the new root, new receipt verifies', () => {
    const oldReceipt = signPromotionAuthorization(HUMAN_PRIV, auth());
    const NEW_PRIV = '33'.repeat(32);
    const NEW_PUB = bytesToHex(ed25519.getPublicKey(hexToBytes(NEW_PRIV)));
    const newRoot = pinAuthorityRoot(NEW_PUB);
    expect(verifyPromotionReceipt(oldReceipt, newRoot).valid).toBe(false);
    const newReceipt = signPromotionAuthorization(NEW_PRIV, auth({ keyId: newRoot.keyId }));
    expect(verifyPromotionReceipt(newReceipt, newRoot).valid).toBe(true);
  });

  it('PROMOTION STILL LOCKED: a valid signed receipt does NOT unlock live promotion', () => {
    const receipt = signPromotionAuthorization(HUMAN_PRIV, auth());
    expect(verifyPromotionReceipt(receipt, ROOT).valid).toBe(true); // human authorized + verified...
    expect(receipt.promotionExecuted).toBe(false);                  // ...but not executed...
    expect(isLivePromotionUnlocked()).toBe(false);                  // ...and the live gate stays LOCKED.
  });
});
