import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  resolveCanonicalPin,
  verifyCanonicalReceiptHead,
  SIGNED_HEAD_V4_ALG,
  type CanonicalPin,
} from '../src/convexCanonicalPin';
import type { ReceiptChainHeadPublic } from '../src/convexBrainReadonly';

// GOLD vector produced by the KERNEL's own signer (node-template/convex/aukoraSignedHead.ts).
// If edge-node's independent verifier accepts it, the ported V4 preimage + FIPS-204 context are
// byte-exact. The test seed is a throwaway ('11'*32) — not a real key.
const VEC = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'canonical-head-vector.json'), 'utf-8'),
) as {
  seed: string; head: { chainKey: string; timestamp: number; chainLength: number; chainHeadHash: string };
  merkleRoot: string; headSigAlg: string; publicKey: string; sig: string;
};

function goldHead(overrides: Partial<ReceiptChainHeadPublic> = {}): ReceiptChainHeadPublic {
  return {
    exists: true,
    chainKey: VEC.head.chainKey,
    count: VEC.head.chainLength,
    lastChainHash: VEC.head.chainHeadHash,
    headSig: VEC.sig,
    headSigAlg: VEC.headSigAlg,
    headSignedAt: VEC.head.timestamp,
    receiptLogRoot: VEC.merkleRoot,
    updatedAt: VEC.head.timestamp,
    ...overrides,
  };
}

function goldPin(overrides: Partial<CanonicalPin> = {}): CanonicalPin {
  return { publicKeyHex: VEC.publicKey, expectedAlg: SIGNED_HEAD_V4_ALG, allowedChainKeys: null, source: 'explicit_config', ...overrides };
}

describe('24Y.7: gold vector — REAL cross-implementation verification (not faked)', () => {
  it('fixture is the kernel-signed V4 head (3904-hex pub, 6618-hex sig, v4 alg)', () => {
    expect(VEC.publicKey.length).toBe(3904);
    expect(VEC.sig.length).toBe(6618);
    expect(VEC.headSigAlg).toBe('ml-dsa-65-chainhead-v4');
  });

  it('edge-node verifier ACCEPTS a head signed by the kernel (byte-exact preimage + context)', () => {
    const r = verifyCanonicalReceiptHead(goldHead(), goldPin());
    expect(r.verified).toBe(true);
    expect(r.proof).toBe('cryptographic_pin');
    expect(r.spoofable).toBe(false);
    expect(r.halt).toBe(false);
  });
});

describe('24Y.7: verifyCanonicalReceiptHead — fail-closed matrix', () => {
  it('missing pin → name_marker_only, spoofable, NOT canonical', () => {
    const r = verifyCanonicalReceiptHead(goldHead(), null);
    expect(r.verified).toBe(false);
    expect(r.proof).toBe('name_marker_only');
    expect(r.spoofable).toBe(true);
    expect(r.halt).toBe(false);
  });

  it('WRONG pinned public key → HALT (signature invalid), not canonical', () => {
    // flip the last hex nibble of the pinned key
    const wrong = VEC.publicKey.slice(0, -1) + (VEC.publicKey.endsWith('0') ? '1' : '0');
    const r = verifyCanonicalReceiptHead(goldHead(), goldPin({ publicKeyHex: wrong }));
    expect(r.verified).toBe(false);
    expect(r.proof).toBe('none');
    expect(r.halt).toBe(true);
  });

  it('TAMPERED head field (count) → signature invalid → HALT', () => {
    const r = verifyCanonicalReceiptHead(goldHead({ count: VEC.head.chainLength + 1 }), goldPin());
    expect(r.verified).toBe(false);
    expect(r.reason).toBe('signature_invalid');
    expect(r.halt).toBe(true);
  });

  it('TAMPERED chainHeadHash → signature invalid → HALT', () => {
    const bad = 'c'.repeat(64);
    const r = verifyCanonicalReceiptHead(goldHead({ lastChainHash: bad }), goldPin());
    expect(r.verified).toBe(false);
    expect(r.halt).toBe(true);
  });

  it('TAMPERED receiptLogRoot → signature invalid → HALT', () => {
    const r = verifyCanonicalReceiptHead(goldHead({ receiptLogRoot: 'd'.repeat(64) }), goldPin());
    expect(r.verified).toBe(false);
    expect(r.halt).toBe(true);
  });

  it('wrong algorithm tag → HALT (downgrade/unsupported)', () => {
    const r = verifyCanonicalReceiptHead(goldHead({ headSigAlg: 'ml-dsa-65-chainhead-v3' }), goldPin());
    expect(r.verified).toBe(false);
    expect(r.reason).toContain('alg_mismatch');
    expect(r.halt).toBe(true);
  });

  it('malformed signature (wrong length) → HALT', () => {
    const r = verifyCanonicalReceiptHead(goldHead({ headSig: 'abcd' }), goldPin());
    expect(r.verified).toBe(false);
    expect(r.reason).toBe('malformed_signature');
    expect(r.halt).toBe(true);
  });

  it('missing signature → HALT', () => {
    const r = verifyCanonicalReceiptHead(goldHead({ headSig: null }), goldPin());
    expect(r.verified).toBe(false);
    expect(r.halt).toBe(true);
  });

  it('chainKey not in pin allowlist → HALT', () => {
    const r = verifyCanonicalReceiptHead(goldHead(), goldPin({ allowedChainKeys: ['some-other-chain'] }));
    expect(r.verified).toBe(false);
    expect(r.reason).toContain('chainkey_not_pinned');
    expect(r.halt).toBe(true);
  });

  it('chainKey IN pin allowlist → still verifies', () => {
    const r = verifyCanonicalReceiptHead(goldHead(), goldPin({ allowedChainKeys: ['organism'] }));
    expect(r.verified).toBe(true);
    expect(r.proof).toBe('cryptographic_pin');
  });

  it('non-existent / empty head → not canonical, not halt', () => {
    const r = verifyCanonicalReceiptHead(goldHead({ exists: false }), goldPin());
    expect(r.verified).toBe(false);
    expect(r.proof).toBe('none');
    expect(r.halt).toBe(false);
  });

  it('THE 24Y.6 SPOOF: donor returns a type-valid but UNSIGNED-by-pinned-key head → NOT canonical', () => {
    // A donor forges a perfectly shaped head with a plausible alg + a random sig. Against the pin it fails.
    const forgedSig = 'a'.repeat(6618);
    const r = verifyCanonicalReceiptHead(goldHead({ headSig: forgedSig }), goldPin());
    expect(r.verified).toBe(false);
    expect(r.halt).toBe(true);
  });
});

describe('24Y.7: resolveCanonicalPin — explicit, out-of-band, no TOFU', () => {
  it('unset → null (no crypto canonicality)', () => {
    expect(resolveCanonicalPin({})).toBeNull();
  });

  it('valid 3904-hex pin → resolved', () => {
    const pin = resolveCanonicalPin({ AUKORA_CANONICAL_PIN_PUBLIC_KEY: VEC.publicKey });
    expect(pin).not.toBeNull();
    expect(pin!.publicKeyHex).toBe(VEC.publicKey.toLowerCase());
    expect(pin!.source).toBe('explicit_config');
  });

  it('malformed pin → FAIL CLOSED (throws), never silently disables verification', () => {
    expect(() => resolveCanonicalPin({ AUKORA_CANONICAL_PIN_PUBLIC_KEY: 'deadbeef' })).toThrow('aukora_canonical_pin_public_key_invalid');
  });

  it('chainKey allowlist parsed from config', () => {
    const pin = resolveCanonicalPin({
      AUKORA_CANONICAL_PIN_PUBLIC_KEY: VEC.publicKey,
      AUKORA_CANONICAL_PIN_CHAINKEYS: 'organism, kernel',
    });
    expect(pin!.allowedChainKeys).toEqual(['organism', 'kernel']);
  });

  it('pin never derives from a backend response (source is explicit_config only)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'convexCanonicalPin.ts'), 'utf-8');
    expect(src).toContain("source: 'explicit_config'");
    // the pin's only input is env/config — resolveCanonicalPin reads process.env, never a response object
    expect(src).toContain('env.AUKORA_CANONICAL_PIN_PUBLIC_KEY');
    expect(src).not.toMatch(/resolveCanonicalPin[\s\S]{0,400}response/);
  });
});

describe('24Y.7: headSig is public material, no secret leakage', () => {
  it('module imports no secrets and reads only a pinned PUBLIC key', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'convexCanonicalPin.ts'), 'utf-8');
    expect(src).not.toMatch(/secretKey|signingSeed|privateKey|\.sign\(/);
    expect(src).not.toMatch(/sk-[a-zA-Z0-9]/);
    // verification only — uses ml_dsa65.verify, never .sign / .keygen
    expect(src).toContain('ml_dsa65.verify');
    expect(src).not.toContain('ml_dsa65.keygen');
    expect(src).not.toContain('ml_dsa65.sign');
  });

  it('getReceiptChainHeadPublic returns headSig but never seed/privateKey/token', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'node-template', 'convex', 'aukoraReceipts.ts'), 'utf-8');
    const fn = src.slice(src.indexOf('export const getReceiptChainHeadPublic'));
    const body = fn.slice(0, fn.indexOf('});') + 3);
    expect(body).toContain('headSig: head.headSig');
    expect(body).not.toContain('seed');
    expect(body).not.toContain('secretKey');
    expect(body).not.toContain('privateKey');
    expect(body).not.toContain('token');
  });
});
