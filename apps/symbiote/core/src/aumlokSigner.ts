// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * AUMLOK human-side SIGNER (Ed25519 "dev-real"). This is the ONLY module that touches a private key, and the
 * organism NEVER imports it — it belongs to the human's terminal tool / tests. The private key is always a
 * caller-provided argument; it is never stored, returned, or logged. Kept separate from the organism's
 * verifier surface (`aumlokAuthorityRoot.ts`) so the organism structurally cannot sign.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { randomBytes } from 'crypto';
import {
  isHexOfBytes, canonicalAuthorization, canonicalLifecycle,
  type PromotionAuthorization, type SignedPromotionReceipt,
  type KeyLifecycleEvent, type SignedKeyLifecycleReceipt,
} from './aumlokAuthorityRoot';

function requirePrivateKey(hex: string): void {
  if (!isHexOfBytes(hex, 32)) throw new Error('private key must be a 32-byte (64 hex) Ed25519 seed');
}

/** Re-derive the public half from a private seed — bundle-coherence checks only (#340 review).
 *  The private key is a caller-provided argument, never stored or logged; only the PUBLIC half
 *  is returned. */
export function derivePublicKeyHex(privateKeyHex: string): string {
  requirePrivateKey(privateKeyHex);
  return bytesToHex(ed25519.getPublicKey(hexToBytes(privateKeyHex)));
}

/** Generate a fresh Ed25519 keypair — the human runs this; the private key is theirs to custody. */
export function generateKeypair(): { privateKeyHex: string; publicKeyHex: string } {
  const priv = new Uint8Array(randomBytes(32)); // an Ed25519 private key is 32 random bytes
  return { privateKeyHex: bytesToHex(priv), publicKeyHex: bytesToHex(ed25519.getPublicKey(priv)) };
}

export function signPromotionAuthorization(privateKeyHex: string, auth: PromotionAuthorization): SignedPromotionReceipt {
  requirePrivateKey(privateKeyHex);
  const sig = ed25519.sign(new TextEncoder().encode(canonicalAuthorization(auth)), hexToBytes(privateKeyHex));
  return { schema: 'aumlok-signed-promotion-v1', authorization: auth, algorithm: 'ed25519', signature: bytesToHex(sig), mode: 'dev_real', humanSignedAuthorization: true, promotionExecuted: false };
}

export function signKeyLifecycleEvent(privateKeyHex: string, event: KeyLifecycleEvent): SignedKeyLifecycleReceipt {
  requirePrivateKey(privateKeyHex);
  const sig = ed25519.sign(new TextEncoder().encode(canonicalLifecycle(event)), hexToBytes(privateKeyHex));
  return { schema: 'aumlok-key-lifecycle-v1', event, algorithm: 'ed25519', signature: bytesToHex(sig), mode: 'dev_real' };
}
