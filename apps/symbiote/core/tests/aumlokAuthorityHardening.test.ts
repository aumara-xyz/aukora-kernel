// AUMLOK authority-root boundary hardening: input validation, durable pinned-root manifest, signed
// revoke/rotate lifecycle, and a clean signer/verifier separation (the organism module cannot sign).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import {
  pinAuthorityRoot, verifyPromotionReceipt, keyIdFor, isHexOfBytes, isValidPublicKey,
  serializeRootManifest, parseRootManifest, verifyKeyLifecycleReceipt, applyVerifiedLifecycleToRoot,
  isLivePromotionUnlocked, type KeyLifecycleEvent,
} from '../src/aumlokAuthorityRoot';
import { signPromotionAuthorization, signKeyLifecycleEvent, generateKeypair } from '../src/aumlokSigner';
import * as authMod from '../src/aumlokAuthorityRoot';

const PRIV = '11'.repeat(32);
const PUB = bytesToHex(ed25519.getPublicKey(hexToBytes(PRIV)));
const ROOT = pinAuthorityRoot(PUB, { createdAt: '2026-06-30T00:00:00.000Z' });
const promoAuth = { keyId: ROOT.keyId, proposalHash: 'p', draftHash: 'd', nonce: 'n', issuedAt: 'i', expiresAt: null };

describe('authority-root hardening — input validation (fail-closed on malformed)', () => {
  it('isHexOfBytes / isValidPublicKey enforce exact byte length + hex charset + string type', () => {
    expect(isValidPublicKey(PUB)).toBe(true);
    expect(isValidPublicKey('zz'.repeat(32))).toBe(false); // non-hex
    expect(isValidPublicKey('11'.repeat(31))).toBe(false); // too short
    expect(isValidPublicKey(123 as any)).toBe(false);       // not a string
    expect(isHexOfBytes('aa'.repeat(64), 64)).toBe(true);   // 64-byte signature length
  });
  it('pinAuthorityRoot throws on a malformed public key', () => {
    expect(() => pinAuthorityRoot('deadbeef')).toThrow(/64 hex/);
    expect(() => pinAuthorityRoot('gg'.repeat(32))).toThrow();
  });
  it('signPromotionAuthorization throws on a malformed private key', () => {
    expect(() => signPromotionAuthorization('short', promoAuth)).toThrow(/64 hex/);
  });
  it('verifyPromotionReceipt rejects a malformed signature WITHOUT throwing', () => {
    const r = signPromotionAuthorization(PRIV, promoAuth);
    expect(verifyPromotionReceipt({ ...r, signature: 'XYZ' }, ROOT).reason).toMatch(/malformed signature/);
  });
});

describe('authority-root hardening — durable pinned-root manifest', () => {
  it('serialize -> parse round-trips the pinned public key', () => {
    const parsed = parseRootManifest(serializeRootManifest(ROOT));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.root.publicKey).toBe(PUB);
  });
  it('rejects wrong schema / integrity tamper / bad hex / keyId mismatch', () => {
    expect(parseRootManifest('{"schema":"nope"}').ok).toBe(false);
    const obj = JSON.parse(serializeRootManifest(ROOT));
    expect(parseRootManifest(JSON.stringify({ ...obj, revoked: true })).ok).toBe(false);          // integrity mismatch
    expect(parseRootManifest(JSON.stringify({ ...obj, publicKey: 'zz'.repeat(32) })).ok).toBe(false); // bad hex
    const otherPub = bytesToHex(ed25519.getPublicKey(hexToBytes('22'.repeat(32))));
    expect(parseRootManifest(JSON.stringify({ ...obj, publicKey: otherPub })).ok).toBe(false);     // keyId mismatch
  });
});

describe('authority-root hardening — signed revoke/rotate lifecycle (auditable, not a code flag)', () => {
  const ev = (over: Partial<KeyLifecycleEvent> = {}): KeyLifecycleEvent => ({ action: 'revoke', keyId: ROOT.keyId, newPublicKey: null, reason: 'test', issuedAt: '2026-06-30T01:00:00.000Z', ...over });

  it('a signed REVOKE verifies and applies via the verify-then-apply path (root becomes revoked)', () => {
    const r = applyVerifiedLifecycleToRoot(ROOT, signKeyLifecycleEvent(PRIV, ev()));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.root.revoked).toBe(true);
  });
  it('a signed ROTATE verifies and applies (root re-pins the new key)', () => {
    const NEW = generateKeypair();
    const out = applyVerifiedLifecycleToRoot(ROOT, signKeyLifecycleEvent(PRIV, ev({ action: 'rotate', newPublicKey: NEW.publicKeyHex })), '2026-06-30T02:00:00.000Z');
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.root.publicKey).toBe(NEW.publicKeyHex);
      expect(out.root.keyId).toBe(keyIdFor(NEW.publicKeyHex));
      expect(out.root.revoked).toBe(false);
    }
  });
  it('applyVerifiedLifecycleToRoot REFUSES a forged receipt ({ok:false}) — cannot apply unverified', () => {
    expect(applyVerifiedLifecycleToRoot(ROOT, signKeyLifecycleEvent('22'.repeat(32), ev())).ok).toBe(false);
    expect(verifyKeyLifecycleReceipt(signKeyLifecycleEvent('22'.repeat(32), ev()), ROOT).valid).toBe(false);
  });
  it('malformed lifecycle shapes are rejected', () => {
    expect(verifyKeyLifecycleReceipt(signKeyLifecycleEvent(PRIV, ev({ action: 'rotate', newPublicKey: null })), ROOT).reason).toMatch(/new public key/);
    expect(verifyKeyLifecycleReceipt(signKeyLifecycleEvent(PRIV, ev({ newPublicKey: PUB })), ROOT).reason).toMatch(/must not carry a new key/);
    expect(verifyKeyLifecycleReceipt(signKeyLifecycleEvent(PRIV, ev({ keyId: 'wrong' })), ROOT).reason).toMatch(/keyId mismatch/);
  });
});

describe('authority-root hardening — full envelope validation (no half-valid receipts)', () => {
  const goodPromo = () => signPromotionAuthorization(PRIV, promoAuth);
  const goodLife = () => signKeyLifecycleEvent(PRIV, { action: 'revoke', keyId: ROOT.keyId, newPublicKey: null, reason: 'r', issuedAt: 'i' });

  it('verifyPromotionReceipt rejects tampered envelope flags (schema/mode/flags/algorithm)', () => {
    expect(verifyPromotionReceipt(goodPromo(), ROOT).valid).toBe(true);
    expect(verifyPromotionReceipt({ ...goodPromo(), schema: 'evil' as any }, ROOT).reason).toMatch(/schema/);
    expect(verifyPromotionReceipt({ ...goodPromo(), mode: 'prod' as any }, ROOT).reason).toMatch(/mode/);
    expect(verifyPromotionReceipt({ ...goodPromo(), humanSignedAuthorization: false as any }, ROOT).reason).toMatch(/humanSignedAuthorization/);
    expect(verifyPromotionReceipt({ ...goodPromo(), promotionExecuted: true as any }, ROOT).reason).toMatch(/promotionExecuted/);
    expect(verifyPromotionReceipt({ ...goodPromo(), algorithm: 'ml-dsa-65' }, ROOT).reason).toMatch(/unsupported algorithm/);
  });

  it('verifyKeyLifecycleReceipt rejects tampered envelope (schema/mode/algorithm/action)', () => {
    expect(verifyKeyLifecycleReceipt(goodLife(), ROOT).valid).toBe(true);
    expect(verifyKeyLifecycleReceipt({ ...goodLife(), schema: 'evil' as any }, ROOT).reason).toMatch(/schema/);
    expect(verifyKeyLifecycleReceipt({ ...goodLife(), mode: 'prod' as any }, ROOT).reason).toMatch(/mode/);
    expect(verifyKeyLifecycleReceipt({ ...goodLife(), algorithm: 'ml-dsa-65' }, ROOT).reason).toMatch(/unsupported algorithm/);
    expect(verifyKeyLifecycleReceipt({ ...goodLife(), event: { ...goodLife().event, action: 'nuke' as any } }, ROOT).reason).toMatch(/invalid action/);
  });

  it('parseRootManifest rejects unsupported algorithm / mode (not just schema/key/hash)', () => {
    const obj = JSON.parse(serializeRootManifest(ROOT));
    expect(parseRootManifest(JSON.stringify({ ...obj, algorithm: 'ml-dsa-65' })).ok).toBe(false);
    expect(parseRootManifest(JSON.stringify({ ...obj, mode: 'prod' })).ok).toBe(false);
  });
});

describe('authority-root hardening — fail-closed on malformed shape (NEVER throws)', () => {
  const promo = () => signPromotionAuthorization(PRIV, promoAuth);
  const life = () => signKeyLifecycleEvent(PRIV, { action: 'revoke', keyId: ROOT.keyId, newPublicKey: null, reason: 'r', issuedAt: 'i' });

  it('verifyPromotionReceipt returns {valid:false} (no throw) when authorization is missing/null/malformed', () => {
    expect(() => verifyPromotionReceipt({ ...promo(), authorization: undefined as any }, ROOT)).not.toThrow();
    expect(verifyPromotionReceipt({ ...promo(), authorization: undefined as any }, ROOT).valid).toBe(false);
    expect(verifyPromotionReceipt({ ...promo(), authorization: null as any }, ROOT).valid).toBe(false);
    for (const f of ['keyId', 'proposalHash', 'draftHash', 'nonce', 'issuedAt'] as const) {
      expect(verifyPromotionReceipt({ ...promo(), authorization: { ...promo().authorization, [f]: undefined as any } }, ROOT).valid).toBe(false);
    }
    expect(verifyPromotionReceipt({ ...promo(), authorization: { ...promo().authorization, keyId: 123 as any } }, ROOT).valid).toBe(false); // non-string
    expect(verifyPromotionReceipt({ ...promo(), authorization: { ...promo().authorization, expiresAt: 5 as any } }, ROOT).valid).toBe(false); // bad expiresAt type
  });

  it('verifyKeyLifecycleReceipt returns {valid:false} (no throw) when event is missing/malformed', () => {
    expect(() => verifyKeyLifecycleReceipt({ ...life(), event: undefined as any }, ROOT)).not.toThrow();
    expect(verifyKeyLifecycleReceipt({ ...life(), event: undefined as any }, ROOT).valid).toBe(false);
    expect(verifyKeyLifecycleReceipt({ ...life(), event: { ...life().event, keyId: undefined as any } }, ROOT).valid).toBe(false);
    expect(verifyKeyLifecycleReceipt({ ...life(), event: { ...life().event, reason: 123 as any } }, ROOT).valid).toBe(false);
    expect(verifyKeyLifecycleReceipt({ ...life(), event: { ...life().event, newPublicKey: 5 as any } }, ROOT).valid).toBe(false);
  });
});

describe('authority-root hardening — signer/verifier separation', () => {
  it('the organism authority-root module exposes NO signing function', () => {
    expect((authMod as any).signPromotionAuthorization).toBeUndefined();
    expect((authMod as any).signKeyLifecycleEvent).toBeUndefined();
    expect((authMod as any).generateKeypair).toBeUndefined();
  });
  it('the organism authority-root SOURCE never signs or generates a private key', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'aumlokAuthorityRoot.ts'), 'utf-8');
    expect(src).not.toContain('ed25519.sign');
    expect(src).not.toContain('randomBytes');
    expect(src).not.toMatch(/privateKey/i);
  });
});

describe('authority-root hardening — exact-envelope discipline: unknown fields fail closed on EVERY schema', () => {
  it('a valid signed promotion receipt still verifies (no change to existing valid behavior)', () => {
    expect(verifyPromotionReceipt(signPromotionAuthorization(PRIV, promoAuth), ROOT).valid).toBe(true);
  });
  it('a valid lifecycle receipt still verifies', () => {
    const ev = { action: 'revoke' as const, keyId: ROOT.keyId, newPublicKey: null, reason: 'r', issuedAt: 'i' };
    expect(verifyKeyLifecycleReceipt(signKeyLifecycleEvent(PRIV, ev), ROOT).valid).toBe(true);
  });
  it('a valid root manifest still parses', () => {
    expect(parseRootManifest(serializeRootManifest(ROOT)).ok).toBe(true);
  });

  it('an extraSneakyField on a SIGNED PROMOTION receipt fails closed (no throw)', () => {
    const good: any = signPromotionAuthorization(PRIV, promoAuth);
    const bad = { ...good, extraSneakyField: 'x' };
    expect(() => verifyPromotionReceipt(bad, ROOT)).not.toThrow();
    const v = verifyPromotionReceipt(bad, ROOT);
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/unknown field/);
  });
  it('an extra field INSIDE authorization fails closed (no throw)', () => {
    const good: any = signPromotionAuthorization(PRIV, promoAuth);
    const bad = { ...good, authorization: { ...good.authorization, extraSneakyField: 'x' } };
    expect(() => verifyPromotionReceipt(bad, ROOT)).not.toThrow();
    expect(verifyPromotionReceipt(bad, ROOT).valid).toBe(false);
  });
  it('an extraSneakyField on a SIGNED KEY LIFECYCLE receipt fails closed (no throw)', () => {
    const ev = { action: 'revoke' as const, keyId: ROOT.keyId, newPublicKey: null, reason: 'r', issuedAt: 'i' };
    const good: any = signKeyLifecycleEvent(PRIV, ev);
    const bad = { ...good, extraSneakyField: 'x' };
    expect(() => verifyKeyLifecycleReceipt(bad, ROOT)).not.toThrow();
    const v = verifyKeyLifecycleReceipt(bad, ROOT);
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/unknown field/);
  });
  it('an extra field INSIDE a lifecycle event fails closed (no throw)', () => {
    const ev = { action: 'revoke' as const, keyId: ROOT.keyId, newPublicKey: null, reason: 'r', issuedAt: 'i' };
    const good: any = signKeyLifecycleEvent(PRIV, ev);
    const bad = { ...good, event: { ...good.event, extraSneakyField: 'x' } };
    expect(() => verifyKeyLifecycleReceipt(bad, ROOT)).not.toThrow();
    expect(verifyKeyLifecycleReceipt(bad, ROOT).valid).toBe(false);
  });
  it('an extraSneakyField on the AUTHORITY ROOT MANIFEST fails closed (no throw)', () => {
    const obj = JSON.parse(serializeRootManifest(ROOT));
    const bad = JSON.stringify({ ...obj, extraSneakyField: 'x' });
    expect(() => parseRootManifest(bad)).not.toThrow();
    const v = parseRootManifest(bad);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/unknown field/);
  });

  it('malformed inputs still return { valid:false } / { ok:false } without throwing, on every schema', () => {
    for (const bad of [null, undefined, 5, 'x', [], {}, { schema: 'x' }]) {
      expect(() => verifyPromotionReceipt(bad as any, ROOT)).not.toThrow();
      expect(verifyPromotionReceipt(bad as any, ROOT).valid).toBe(false);
      expect(() => verifyKeyLifecycleReceipt(bad as any, ROOT)).not.toThrow();
      expect(verifyKeyLifecycleReceipt(bad as any, ROOT).valid).toBe(false);
      expect(() => parseRootManifest(typeof bad === 'string' ? bad : JSON.stringify(bad))).not.toThrow();
    }
  });

  it('live promotion remains LOCKED after all of the above', () => {
    expect(isLivePromotionUnlocked()).toBe(false);
  });
});
