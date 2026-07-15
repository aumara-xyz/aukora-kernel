// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * AUMLOK owner-authority v2 — HUMAN-SIDE dual signer (#361 P0, Brick 1).
 *
 * This is the ONLY module that touches the owner's private seeds for the hybrid suite, and it is deliberately
 * SEPARATE from the organism verifier (`aumlokAuthorityV2.ts`), which never imports it. A human authorizes by
 * producing BOTH signatures over the exact same canonical payload; the organism only verifies.
 *
 * Chokepoint discipline (Brick-1 rule): the ML-DSA-65 half is signed ONLY through `pqcSignWithDomain` — this
 * module imports NO post-quantum core and never touches the raw ML-DSA primitive directly. The classical half uses
 * `@noble/curves` Ed25519. The two private seeds are INDEPENDENT CSPRNG material; neither is derived from the
 * phrase (the phrase gates the human's hand, it is never key material). Brick 1 does not generate/store keys
 * on a live node (that is Brick 2) — these helpers exist so the verifier can be exercised end to end.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';
import { pqcSignWithDomain, pqcPublicKeyFromSeed, type PqcDomain } from './crypto';
import {
  AUMLOK_SUITE_V2, AUMLOK_MODE_V2, rootIdV2, legacyRootIdV1,
  canonicalPromotionV2, canonicalLifecycleV2, canonicalMigrationV1,
  type HybridPublicKeys, type HybridSignatures,
  type PromotionAuthorizationV2, type SignedPromotionV2,
  type KeyLifecycleEventV2, type SignedLifecycleV2, type AuthorityMigrationV1,
} from './aumlokAuthorityV2';

const enc = (s: string) => new TextEncoder().encode(s);
const DOMAIN_PROMOTION: PqcDomain = 'aumlokPromotion';
const DOMAIN_LIFECYCLE: PqcDomain = 'aumlokLifecycle';
const DOMAIN_MIGRATION: PqcDomain = 'aumlokMigration';

const isSeed = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
function requireSeed(seedHex: string, which: string): void {
  if (!isSeed(seedHex)) throw new Error(`aumlok_v2_seed_invalid:${which}`); // 32-byte lowercase hex, fail closed
}

/** Derive the hybrid PUBLIC keys from the two independent private seeds. */
export function deriveHybridPublicKeys(edSeedHex: string, mlSeedHex: string): HybridPublicKeys {
  requireSeed(edSeedHex, 'ed25519'); requireSeed(mlSeedHex, 'ml-dsa-65');
  return { ed25519: bytesToHex(ed25519.getPublicKey(hexToBytes(edSeedHex))), mlDsa65: pqcPublicKeyFromSeed(mlSeedHex) };
}

/** Full 64-hex root id for a pair of seeds — a convenience over deriveHybridPublicKeys + rootIdV2. */
export function rootIdForSeeds(edSeedHex: string, mlSeedHex: string): string {
  return rootIdV2(deriveHybridPublicKeys(edSeedHex, mlSeedHex));
}

/** Produce BOTH signatures over one message: Ed25519 directly, ML-DSA-65 via the domain-separated chokepoint. */
function dualSign(edSeedHex: string, mlSeedHex: string, msg: Uint8Array, domain: PqcDomain): HybridSignatures {
  requireSeed(edSeedHex, 'ed25519'); requireSeed(mlSeedHex, 'ml-dsa-65');
  return {
    ed25519: bytesToHex(ed25519.sign(msg, hexToBytes(edSeedHex))),
    mlDsa65: pqcSignWithDomain(mlSeedHex, msg, domain),
  };
}

export function signPromotionV2(edSeedHex: string, mlSeedHex: string, authorization: PromotionAuthorizationV2): SignedPromotionV2 {
  return {
    schema: 'aumlok-signed-promotion-v2', suite: AUMLOK_SUITE_V2, authorization,
    signatures: dualSign(edSeedHex, mlSeedHex, enc(canonicalPromotionV2(authorization)), DOMAIN_PROMOTION),
    mode: AUMLOK_MODE_V2,
  };
}

export function signLifecycleV2(edSeedHex: string, mlSeedHex: string, event: KeyLifecycleEventV2): SignedLifecycleV2 {
  return {
    schema: 'aumlok-key-lifecycle-v2', suite: AUMLOK_SUITE_V2, event,
    signatures: dualSign(edSeedHex, mlSeedHex, enc(canonicalLifecycleV2(event)), DOMAIN_LIFECYCLE),
    mode: AUMLOK_MODE_V2,
  };
}

/** Build a signed migration: the OLD Ed25519 seed consents; the NEW ML-DSA-65 seed proves possession. Both
 *  sign the exact same payload. (The new Ed25519 seed is NOT required to sign the migration — the ML-DSA PoP
 *  is what proves control of the incoming hybrid identity.) */
export function signMigrationV1(
  args: {
    oldEdSeedHex: string;
    newEdSeedHex: string; newMlSeedHex: string;
    nonce: string; issuedAt: string; expiresAt: string | null;
  },
): AuthorityMigrationV1 {
  requireSeed(args.oldEdSeedHex, 'old-ed25519');
  const newPublicKeys = deriveHybridPublicKeys(args.newEdSeedHex, args.newMlSeedHex);
  const newRootId = rootIdV2(newPublicKeys);
  const oldPublicKey = bytesToHex(ed25519.getPublicKey(hexToBytes(args.oldEdSeedHex)));
  // oldRootId is DERIVED from the old key (never a caller-chosen label) so the verifier can bind it to the
  // trusted pinned legacy root; a fabricated label cannot survive verification.
  const unsigned: Omit<AuthorityMigrationV1, 'oldSignature' | 'newSignature'> = {
    schema: 'aumlok-authority-migration-v1',
    oldRootId: legacyRootIdV1(oldPublicKey), newRootId, oldPublicKey, newPublicKeys,
    nonce: args.nonce, issuedAt: args.issuedAt, expiresAt: args.expiresAt,
  };
  const msg = enc(canonicalMigrationV1(unsigned));
  return {
    ...unsigned,
    oldSignature: bytesToHex(ed25519.sign(msg, hexToBytes(args.oldEdSeedHex))),
    newSignature: pqcSignWithDomain(args.newMlSeedHex, msg, DOMAIN_MIGRATION),
  };
}
