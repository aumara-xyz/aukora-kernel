// AUMLOK rehearsal receipt (Step-4, terminal-first): verify a signed promotion authorization against the
// pinned root, then wrap the result into a durable, hash-chained record. Covers: valid + failing verification
// paths never throw, promotionExecuted/rehearsalOnly can never be flipped by input, chain linking, and
// tamper-evidence on the stored receipt itself.
import { describe, it, expect } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import {
  pinAuthorityRoot, buildRehearsalReceipt, validateRehearsalReceipt, type PromotionAuthorization,
} from '../src/aumlokAuthorityRoot';
import { signPromotionAuthorization } from '../src/aumlokSigner';

const PRIV = '11'.repeat(32);
const PUB = bytesToHex(ed25519.getPublicKey(hexToBytes(PRIV)));
const ATTACKER_PRIV = '22'.repeat(32);
const ROOT = pinAuthorityRoot(PUB, { createdAt: '2026-06-30T00:00:00.000Z' });

function auth(over: Partial<PromotionAuthorization> = {}): PromotionAuthorization {
  return { keyId: ROOT.keyId, proposalHash: 'p', draftHash: 'd', nonce: 'n', issuedAt: '2026-06-30T00:00:00.000Z', expiresAt: null, ...over };
}

describe('AUMLOK rehearsal receipt — valid path', () => {
  it('a valid signed promotion produces a rehearsal receipt with verifierResult.valid=true', () => {
    const promo = signPromotionAuthorization(PRIV, auth());
    const r = buildRehearsalReceipt(promo, ROOT, { seq: 0, prevReceiptHash: null });
    expect(r.schema).toBe('aumlok-rehearsal-receipt-v1');
    expect(r.verifierResult.valid).toBe(true);
    expect(r.rehearsalOnly).toBe(true);
    expect(r.promotionExecuted).toBe(false);
    expect(r.chain).toEqual({ seq: 0, prevReceiptHash: null });
    expect(r.receiptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(validateRehearsalReceipt(r).valid).toBe(true);
  });

  it('chains: receipt #2 links to receipt #1 via prevReceiptHash and increments seq', () => {
    const promo = signPromotionAuthorization(PRIV, auth());
    const r1 = buildRehearsalReceipt(promo, ROOT, { seq: 0, prevReceiptHash: null });
    const r2 = buildRehearsalReceipt(promo, ROOT, { seq: 1, prevReceiptHash: r1.receiptHash });
    expect(r2.chain.seq).toBe(1);
    expect(r2.chain.prevReceiptHash).toBe(r1.receiptHash);
    expect(r2.receiptHash).not.toBe(r1.receiptHash); // different chain position -> different hash
  });
});

describe('AUMLOK rehearsal receipt — fails closed, never throws, never executes', () => {
  it('a forged signature never throws; the receipt records a FAILED verification, not a crash', () => {
    const forged = signPromotionAuthorization(ATTACKER_PRIV, auth());
    expect(() => buildRehearsalReceipt(forged, ROOT, { seq: 0, prevReceiptHash: null })).not.toThrow();
    const r = buildRehearsalReceipt(forged, ROOT, { seq: 0, prevReceiptHash: null });
    expect(r.verifierResult.valid).toBe(false);
    expect(r.verifierResult.reason).toMatch(/signature invalid/);
    expect(r.promotionExecuted).toBe(false); // still false — a failed verification is not an executed promotion
  });

  it('wrong keyId (promotion signed for a DIFFERENT root) fails closed on the promotion-receipt path', () => {
    const otherRoot = pinAuthorityRoot(bytesToHex(ed25519.getPublicKey(hexToBytes(ATTACKER_PRIV))));
    const promo = signPromotionAuthorization(ATTACKER_PRIV, auth({ keyId: otherRoot.keyId }));
    const r = buildRehearsalReceipt(promo, ROOT, { seq: 0, prevReceiptHash: null });
    expect(r.verifierResult.valid).toBe(false);
    expect(r.verifierResult.reason).toMatch(/keyId mismatch/);
    expect(r.promotionExecuted).toBe(false);
  });

  it('unsupported algorithm fails closed', () => {
    const promo = { ...signPromotionAuthorization(PRIV, auth()), algorithm: 'ml-dsa-65' as any };
    const r = buildRehearsalReceipt(promo, ROOT, { seq: 0, prevReceiptHash: null });
    expect(r.verifierResult.valid).toBe(false);
    expect(r.verifierResult.reason).toMatch(/unsupported algorithm/);
  });

  it('expired authorization fails closed', () => {
    const promo = signPromotionAuthorization(PRIV, auth({ expiresAt: '2026-01-01T00:00:00.000Z' }));
    const r = buildRehearsalReceipt(promo, ROOT, { seq: 0, prevReceiptHash: null }, '2026-06-30T12:00:00.000Z');
    expect(r.verifierResult.valid).toBe(false);
    expect(r.verifierResult.reason).toMatch(/expired/);
  });

  it('malformed/undefined authorization on the input never throws and fails closed', () => {
    const promo = signPromotionAuthorization(PRIV, auth());
    const malformed = { ...promo, authorization: undefined as any };
    expect(() => buildRehearsalReceipt(malformed, ROOT, { seq: 0, prevReceiptHash: null })).not.toThrow();
    expect(buildRehearsalReceipt(malformed, ROOT, { seq: 0, prevReceiptHash: null }).verifierResult.valid).toBe(false);
  });

  it('an attacker-supplied promotionExecuted:true inside the inner receipt cannot escape — outer wrapper stays false and verification itself fails', () => {
    const promo = { ...signPromotionAuthorization(PRIV, auth()), promotionExecuted: true as any };
    const r = buildRehearsalReceipt(promo, ROOT, { seq: 0, prevReceiptHash: null });
    expect(r.promotionExecuted).toBe(false);              // the wrapper's own flag — cannot be set by any input
    expect(r.verifierResult.valid).toBe(false);            // AND the tampered inner receipt is itself rejected
    expect(r.verifierResult.reason).toMatch(/promotionExecuted/);
  });
});

describe('AUMLOK rehearsal receipt — stored-receipt validator is tamper-evident and fail-closed', () => {
  const goodReceipt = () => buildRehearsalReceipt(signPromotionAuthorization(PRIV, auth()), ROOT, { seq: 0, prevReceiptHash: null });

  it('round-trips a good receipt', () => {
    expect(validateRehearsalReceipt(goodReceipt()).valid).toBe(true);
  });

  it('rejects a tampered receiptHash (chain / integrity tamper)', () => {
    const r = { ...goodReceipt(), chain: { seq: 99, prevReceiptHash: null } }; // mutate a field without recomputing the hash
    expect(validateRehearsalReceipt(r).reason).toMatch(/integrity mismatch/);
  });

  it('rejects wrong schema / version', () => {
    expect(validateRehearsalReceipt({ ...goodReceipt(), schema: 'evil' }).reason).toMatch(/wrong schema/);
    expect(validateRehearsalReceipt({ ...goodReceipt(), version: 2 }).reason).toMatch(/unsupported version/);
  });

  it('rejects an injected promotionExecuted:true or rehearsalOnly:false', () => {
    expect(validateRehearsalReceipt({ ...goodReceipt(), promotionExecuted: true }).reason).toMatch(/promotionExecuted/);
    expect(validateRehearsalReceipt({ ...goodReceipt(), rehearsalOnly: false }).reason).toMatch(/rehearsalOnly/);
  });

  it('rejects malformed chain.seq / null / non-object input without throwing', () => {
    expect(() => validateRehearsalReceipt(null)).not.toThrow();
    expect(validateRehearsalReceipt(null).valid).toBe(false);
    expect(validateRehearsalReceipt({ ...goodReceipt(), chain: { seq: -1, prevReceiptHash: null } }).valid).toBe(false);
    expect(validateRehearsalReceipt({ ...goodReceipt(), chain: { seq: 1.5, prevReceiptHash: null } }).valid).toBe(false);
  });
});

describe('AUMLOK rehearsal receipt — positive top-level + nested allow-lists (no unknown/shadow fields)', () => {
  const goodReceipt = () => buildRehearsalReceipt(signPromotionAuthorization(PRIV, auth()), ROOT, { seq: 0, prevReceiptHash: null });

  it('an extraSneakyField on the OUTER receipt fails closed (no throw)', () => {
    const bad: any = { ...goodReceipt(), extraSneakyField: 'x' };
    expect(() => validateRehearsalReceipt(bad)).not.toThrow();
    const v = validateRehearsalReceipt(bad);
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/unknown field/);
  });

  it('an extra field inside nested `verifierResult` fails closed (no throw)', () => {
    const good = goodReceipt();
    const bad: any = { ...good, verifierResult: { ...good.verifierResult, extraSneakyField: 'x' } };
    expect(() => validateRehearsalReceipt(bad)).not.toThrow();
    const v = validateRehearsalReceipt(bad);
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/unknown field.*verifierResult/);
  });

  it('an extra field inside nested `chain` fails closed (no throw)', () => {
    const good = goodReceipt();
    const bad: any = { ...good, chain: { ...good.chain, extraSneakyField: 'x' } };
    expect(() => validateRehearsalReceipt(bad)).not.toThrow();
    const v = validateRehearsalReceipt(bad);
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/unknown field.*chain/);
  });

  it('an extra field inside the embedded `promotion` (and its nested authorization) fails closed', () => {
    const good = goodReceipt();
    const badPromo: any = { ...good, promotion: { ...good.promotion, extraSneakyField: 'x' } };
    expect(() => validateRehearsalReceipt(badPromo)).not.toThrow();
    expect(validateRehearsalReceipt(badPromo).valid).toBe(false);

    const badAuth: any = { ...good, promotion: { ...good.promotion, authorization: { ...good.promotion.authorization, extraSneakyField: 'x' } } };
    expect(() => validateRehearsalReceipt(badAuth)).not.toThrow();
    expect(validateRehearsalReceipt(badAuth).valid).toBe(false);
  });
});
