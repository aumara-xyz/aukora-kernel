// Wave 1 — domain-separated ML-DSA-65 signer discipline (ported pure into the crypto chokepoint).
// Proves: domain NON-LIFTING (a sig under one domain fails under every other), seeded-keygen fail-closed,
// unknown-domain refusal, deterministic signing, fail-closed verify, and consistency with the existing
// receipt-chain signer (one chokepoint).
import { describe, it, expect } from 'vitest';
import {
  PQC_DOMAINS, pqcSignWithDomain, pqcVerifyWithDomain, pqcPublicKeyFromSeed, isPqcPublicKeyHex,
  serializeSignedHead, verifySignedHead,
} from '../src/crypto';

const SEED = '11'.repeat(32);          // a 32-byte seed (64 hex)
const PUB = pqcPublicKeyFromSeed(SEED);
const MSG = new TextEncoder().encode('promote draft #42');

describe('Wave 1 — domain-separated ML-DSA-65 signer', () => {
  it('round-trip: a domain signature verifies under the SAME domain', () => {
    const sig = pqcSignWithDomain(SEED, MSG, 'cap');
    expect(pqcVerifyWithDomain(PUB, MSG, sig, 'cap')).toBe(true);
  });

  it('DOMAIN NON-LIFTING: a signature valid under one domain FAILS under every other', () => {
    const sig = pqcSignWithDomain(SEED, MSG, 'cap');
    for (const d of Object.keys(PQC_DOMAINS) as (keyof typeof PQC_DOMAINS)[]) {
      expect(pqcVerifyWithDomain(PUB, MSG, sig, d)).toBe(d === 'cap'); // ONLY 'cap' verifies
    }
  });

  it('deterministic: two signs of identical inputs are byte-identical', () => {
    expect(pqcSignWithDomain(SEED, MSG, 'manifest')).toBe(pqcSignWithDomain(SEED, MSG, 'manifest'));
  });

  it('seeded keygen is FAIL-CLOSED: a non-64-hex seed throws (no platform-randomness path)', () => {
    expect(() => pqcSignWithDomain('short', MSG, 'cap')).toThrow(/seed_invalid/);
    expect(() => pqcPublicKeyFromSeed('zz'.repeat(32))).toThrow(/seed_invalid/);
  });

  it('UNKNOWN domain refuses: sign throws, verify returns false (prototype keys too)', () => {
    expect(() => pqcSignWithDomain(SEED, MSG, 'toString' as any)).toThrow(/unregistered/);
    expect(() => pqcSignWithDomain(SEED, MSG, '__proto__' as any)).toThrow(/unregistered/);
    expect(pqcVerifyWithDomain(PUB, MSG, '00'.repeat(3309), 'nope' as any)).toBe(false);
  });

  it('verify fails closed on malformed inputs (never throws)', () => {
    const sig = pqcSignWithDomain(SEED, MSG, 'cap');
    expect(pqcVerifyWithDomain(PUB, MSG, sig.toUpperCase(), 'cap')).toBe(false);                       // non-canonical case
    expect(pqcVerifyWithDomain(PUB, MSG, 'beef', 'cap')).toBe(false);                                  // wrong length
    expect(pqcVerifyWithDomain('zz'.repeat(1952), MSG, sig, 'cap')).toBe(false);                       // bad public key
    expect(pqcVerifyWithDomain(PUB, new TextEncoder().encode('different'), sig, 'cap')).toBe(false);   // wrong message
  });

  it('isPqcPublicKeyHex enforces the ML-DSA-65 public-key shape (lowercase, exact length)', () => {
    expect(isPqcPublicKeyHex(PUB)).toBe(true);
    expect(isPqcPublicKeyHex(PUB.toUpperCase())).toBe(false);
    expect(isPqcPublicKeyHex('11'.repeat(100))).toBe(false);
  });

  it('one chokepoint: a chainHead signature from the domain signer verifies via the existing chain verifier', () => {
    const root = 'ab'.repeat(32); // 32-byte merkle root hex
    const sig = pqcSignWithDomain(SEED, serializeSignedHead(root), 'chainHead');
    expect(verifySignedHead(PUB, root, sig)).toBe(true);
  });
});
