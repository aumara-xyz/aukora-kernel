// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * AUMLOK production authority root — ORGANISM-SIDE verifier (Ed25519 "dev-real", Step-4).
 *
 * This module is the organism's authority surface: it pins a PUBLIC key and VERIFIES human signatures. It
 * holds NO private key and exposes NO signing function — signing lives in the SEPARATE human-side module
 * `aumlokSigner.ts`, which the organism never imports. A human authorizes by signing; the organism only
 * verifies. "dev_real" = real Ed25519 crypto with DEV key custody; production HSM/hardware custody and the
 * ML-DSA post-quantum upgrade are future. Live promotion stays LOCKED (`isLivePromotionUnlocked()` = false).
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { hexToBytes } from '@noble/hashes/utils.js';
import { createHash } from 'crypto';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export type AuthorityAlgorithm = 'ed25519' | 'ml-dsa-65';

// Only ed25519 is IMPLEMENTED today; ml-dsa-65 is reserved for the post-quantum upgrade and is NOT yet
// verifiable. Receipts/manifests claiming an unsupported algorithm are rejected until that upgrade lands.
export const SUPPORTED_ALGORITHMS: ReadonlySet<AuthorityAlgorithm> = new Set(['ed25519']);

// Ed25519 sizes: public/private key 32 bytes (64 hex), signature 64 bytes (128 hex). Validate everything.
export function isHexOfBytes(s: unknown, byteLen: number): boolean {
  return typeof s === 'string' && new RegExp(`^[0-9a-f]{${byteLen * 2}}$`, 'i').test(s);
}
export const isValidPublicKey = (s: unknown): boolean => isHexOfBytes(s, 32);
export const isValidSignature = (s: unknown): boolean => isHexOfBytes(s, 64);
const isStr = (x: unknown): x is string => typeof x === 'string';

// ── Exact-envelope discipline: every signed/receipted shape below is CLOSED — an unknown top-level or
// nested key is rejected outright, not just missing required fields. Every canonical-hash function
// (canonicalAuthorization / canonicalLifecycle / manifestIntegrity / rehearsalReceiptIntegrity) only ever
// reads KNOWN fields when it signs/commits — so a shape check that merely confirms required fields are
// present would silently let an extra, UNSIGNED "shadow" field ride along on an otherwise-valid receipt for
// some future consumer to accidentally trust. Reject any unknown key before anything else is checked.
function hasOnlyKeys(obj: any, allowed: ReadonlySet<string>): boolean {
  return !!obj && typeof obj === 'object' && Object.keys(obj).every((k) => allowed.has(k));
}

const PROMOTION_AUTH_KEYS: ReadonlySet<string> = new Set(['keyId', 'proposalHash', 'draftHash', 'nonce', 'issuedAt', 'expiresAt']);
// Exported (issue #76) so the file reader can enforce the SAME top-level key allow-list as the crypto
// envelope below — one canonical list, no second copy to drift. Behavior of verifyPromotionReceipt is
// unchanged; this is a visibility change only.
export const SIGNED_PROMOTION_RECEIPT_KEYS: ReadonlySet<string> = new Set(['schema', 'authorization', 'algorithm', 'signature', 'mode', 'humanSignedAuthorization', 'promotionExecuted']);
const KEY_LIFECYCLE_EVENT_KEYS: ReadonlySet<string> = new Set(['action', 'keyId', 'newPublicKey', 'reason', 'issuedAt']);
const SIGNED_KEY_LIFECYCLE_RECEIPT_KEYS: ReadonlySet<string> = new Set(['schema', 'event', 'algorithm', 'signature', 'mode']);
const AUTHORITY_ROOT_MANIFEST_KEYS: ReadonlySet<string> = new Set(['schema', 'keyId', 'algorithm', 'publicKey', 'mode', 'createdAt', 'expiresAt', 'revoked', 'integrity']);
const REHEARSAL_RECEIPT_KEYS: ReadonlySet<string> = new Set(['schema', 'version', 'promotion', 'verifierResult', 'chain', 'createdAt', 'rehearsalOnly', 'promotionExecuted', 'receiptHash']);
const VERIFIER_RESULT_KEYS: ReadonlySet<string> = new Set(['valid', 'reason']);
const CHAIN_KEYS: ReadonlySet<string> = new Set(['seq', 'prevReceiptHash']);

// Runtime SHAPE guards so a malformed-but-plausible receipt can never throw — verifiers must fail CLOSED.
export function isValidPromotionAuthorization(a: any): boolean {
  return !!a && typeof a === 'object' && hasOnlyKeys(a, PROMOTION_AUTH_KEYS)
    && isStr(a.keyId) && isStr(a.proposalHash) && isStr(a.draftHash) && isStr(a.nonce) && isStr(a.issuedAt)
    && (a.expiresAt === null || isStr(a.expiresAt));
}
export function isValidKeyLifecycleEvent(e: any): boolean {
  return !!e && typeof e === 'object' && hasOnlyKeys(e, KEY_LIFECYCLE_EVENT_KEYS)
    && (e.action === 'revoke' || e.action === 'rotate')
    && isStr(e.keyId) && isStr(e.reason) && isStr(e.issuedAt)
    && (e.newPublicKey === null || isStr(e.newPublicKey));
}

export interface AuthorityRoot {
  keyId: string;
  algorithm: AuthorityAlgorithm;
  publicKey: string;
  mode: 'dev_real';
  createdAt: string;
  expiresAt: string | null;
  revoked: boolean;
}

export interface PromotionAuthorization {
  keyId: string;
  proposalHash: string;
  draftHash: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string | null;
}

export interface SignedPromotionReceipt {
  schema: 'aumlok-signed-promotion-v1';
  authorization: PromotionAuthorization;
  algorithm: AuthorityAlgorithm;
  signature: string;
  mode: 'dev_real';
  humanSignedAuthorization: true;
  promotionExecuted: false;
}

export function canonicalAuthorization(a: PromotionAuthorization): string {
  return JSON.stringify({ keyId: a.keyId, proposalHash: a.proposalHash, draftHash: a.draftHash, nonce: a.nonce, issuedAt: a.issuedAt, expiresAt: a.expiresAt });
}

export function keyIdFor(publicKeyHex: string): string {
  return sha256(publicKeyHex).slice(0, 16);
}

function ed25519Verify(sigHex: string, msg: string, pubHex: string): boolean {
  try { return ed25519.verify(hexToBytes(sigHex), new TextEncoder().encode(msg), hexToBytes(pubHex)); } catch { return false; }
}

/** Pin an authority root from a PUBLIC key. Throws on a malformed key (fail-closed — no half-built root). */
export function pinAuthorityRoot(publicKeyHex: string, opts?: { createdAt?: string; expiresAt?: string | null }): AuthorityRoot {
  if (!isValidPublicKey(publicKeyHex)) throw new Error('pinAuthorityRoot: publicKey must be a 32-byte (64 hex) Ed25519 key');
  return { keyId: keyIdFor(publicKeyHex), algorithm: 'ed25519', publicKey: publicKeyHex, mode: 'dev_real', createdAt: opts?.createdAt ?? new Date().toISOString(), expiresAt: opts?.expiresAt ?? null, revoked: false };
}

export function revokeAuthorityRoot(root: AuthorityRoot): AuthorityRoot {
  return { ...root, revoked: true };
}

export function verifyPromotionReceipt(receipt: SignedPromotionReceipt, root: AuthorityRoot, now = new Date().toISOString()): { valid: boolean; reason?: string } {
  // ENVELOPE — validate the whole receipt shape, not just the signed authorization, so future code can't
  // trust a half-valid or forged-flag receipt.
  if (receipt?.schema !== 'aumlok-signed-promotion-v1') return { valid: false, reason: 'wrong schema' };
  if (!hasOnlyKeys(receipt, SIGNED_PROMOTION_RECEIPT_KEYS)) return { valid: false, reason: 'unknown field(s) in receipt' };
  if (receipt.mode !== 'dev_real') return { valid: false, reason: 'wrong mode' };
  if (receipt.humanSignedAuthorization !== true) return { valid: false, reason: 'humanSignedAuthorization must be true' };
  if (receipt.promotionExecuted !== false) return { valid: false, reason: 'promotionExecuted must be false' };
  if (!SUPPORTED_ALGORITHMS.has(receipt.algorithm)) return { valid: false, reason: 'unsupported algorithm' };
  if (!isValidPromotionAuthorization(receipt.authorization)) return { valid: false, reason: 'malformed authorization' };
  if (root.revoked) return { valid: false, reason: 'authority root revoked' };
  if (!isValidPublicKey(root.publicKey)) return { valid: false, reason: 'malformed root public key' };
  if (!isValidSignature(receipt.signature)) return { valid: false, reason: 'malformed signature' };
  if (root.keyId !== receipt.authorization.keyId) return { valid: false, reason: 'keyId mismatch' };
  if (root.algorithm !== receipt.algorithm) return { valid: false, reason: 'algorithm mismatch' };
  if (root.expiresAt && now > root.expiresAt) return { valid: false, reason: 'authority root expired' };
  if (receipt.authorization.expiresAt && now > receipt.authorization.expiresAt) return { valid: false, reason: 'authorization expired' };
  if (!ed25519Verify(receipt.signature, canonicalAuthorization(receipt.authorization), root.publicKey)) return { valid: false, reason: 'signature invalid' };
  return { valid: true };
}

// ── Durable pinned-root manifest. The PUBLIC key is safe to persist; an integrity hash detects tampering. ──
export interface AuthorityRootManifest {
  schema: 'aumlok-authority-root-v1';
  keyId: string;
  algorithm: AuthorityAlgorithm;
  publicKey: string;
  mode: 'dev_real';
  createdAt: string;
  expiresAt: string | null;
  revoked: boolean;
  integrity: string; // sha256 over the canonical fields
}

function manifestIntegrity(r: Omit<AuthorityRootManifest, 'integrity'>): string {
  return sha256(JSON.stringify({ schema: r.schema, keyId: r.keyId, algorithm: r.algorithm, publicKey: r.publicKey, mode: r.mode, createdAt: r.createdAt, expiresAt: r.expiresAt, revoked: r.revoked }));
}

export function serializeRootManifest(root: AuthorityRoot): string {
  const base = { schema: 'aumlok-authority-root-v1' as const, keyId: root.keyId, algorithm: root.algorithm, publicKey: root.publicKey, mode: root.mode, createdAt: root.createdAt, expiresAt: root.expiresAt, revoked: root.revoked };
  return JSON.stringify({ ...base, integrity: manifestIntegrity(base) }, null, 2);
}

export function parseRootManifest(json: string): { ok: true; root: AuthorityRoot } | { ok: false; reason: string } {
  let m: AuthorityRootManifest;
  try { m = JSON.parse(json); } catch { return { ok: false, reason: 'invalid json' }; }
  if (m?.schema !== 'aumlok-authority-root-v1') return { ok: false, reason: 'wrong schema' };
  if (!hasOnlyKeys(m, AUTHORITY_ROOT_MANIFEST_KEYS)) return { ok: false, reason: 'unknown field(s) in manifest' };
  if (!SUPPORTED_ALGORITHMS.has(m.algorithm)) return { ok: false, reason: 'unsupported algorithm' };
  if (m.mode !== 'dev_real') return { ok: false, reason: 'unsupported mode' };
  if (!isValidPublicKey(m.publicKey)) return { ok: false, reason: 'malformed public key' };
  if (m.keyId !== keyIdFor(m.publicKey)) return { ok: false, reason: 'keyId does not match public key' };
  const { integrity, ...rest } = m;
  if (integrity !== manifestIntegrity(rest)) return { ok: false, reason: 'integrity mismatch (manifest tampered)' };
  return { ok: true, root: { keyId: m.keyId, algorithm: m.algorithm, publicKey: m.publicKey, mode: m.mode, createdAt: m.createdAt, expiresAt: m.expiresAt, revoked: m.revoked } };
}

// ── Signed key-lifecycle (revoke / rotate) — an auditable, signed event, not just a code flag ──
export interface KeyLifecycleEvent {
  action: 'revoke' | 'rotate';
  keyId: string;                 // the key being revoked/rotated (must match the signing root)
  newPublicKey: string | null;   // rotate: the replacement public key; revoke: null
  reason: string;
  issuedAt: string;
}

export interface SignedKeyLifecycleReceipt {
  schema: 'aumlok-key-lifecycle-v1';
  event: KeyLifecycleEvent;
  algorithm: AuthorityAlgorithm;
  signature: string;
  mode: 'dev_real';
}

export function canonicalLifecycle(e: KeyLifecycleEvent): string {
  return JSON.stringify({ action: e.action, keyId: e.keyId, newPublicKey: e.newPublicKey, reason: e.reason, issuedAt: e.issuedAt });
}

/** The CURRENT key authorizes its own revocation/rotation; the organism verifies that signature. */
export function verifyKeyLifecycleReceipt(receipt: SignedKeyLifecycleReceipt, root: AuthorityRoot): { valid: boolean; reason?: string } {
  // ENVELOPE — validate schema / mode / algorithm / action before anything else.
  if (receipt?.schema !== 'aumlok-key-lifecycle-v1') return { valid: false, reason: 'wrong schema' };
  if (!hasOnlyKeys(receipt, SIGNED_KEY_LIFECYCLE_RECEIPT_KEYS)) return { valid: false, reason: 'unknown field(s) in receipt' };
  if (receipt.mode !== 'dev_real') return { valid: false, reason: 'wrong mode' };
  if (!SUPPORTED_ALGORITHMS.has(receipt.algorithm)) return { valid: false, reason: 'unsupported algorithm' };
  if (receipt.algorithm !== root.algorithm) return { valid: false, reason: 'algorithm mismatch' };
  if (receipt.event?.action !== 'revoke' && receipt.event?.action !== 'rotate') return { valid: false, reason: 'invalid action' };
  if (!isValidKeyLifecycleEvent(receipt.event)) return { valid: false, reason: 'malformed event' };
  if (!isValidPublicKey(root.publicKey)) return { valid: false, reason: 'malformed root public key' };
  if (!isValidSignature(receipt.signature)) return { valid: false, reason: 'malformed signature' };
  if (receipt.event.keyId !== root.keyId) return { valid: false, reason: 'keyId mismatch' };
  if (receipt.event.action === 'rotate' && !isValidPublicKey(receipt.event.newPublicKey)) return { valid: false, reason: 'rotate requires a valid new public key' };
  if (receipt.event.action === 'revoke' && receipt.event.newPublicKey !== null) return { valid: false, reason: 'revoke must not carry a new key' };
  if (!ed25519Verify(receipt.signature, canonicalLifecycle(receipt.event), root.publicKey)) return { valid: false, reason: 'signature invalid' };
  return { valid: true };
}

// Raw state transition — PRIVATE on purpose. It applies blindly, so it is never exported: callers must go
// through applyVerifiedLifecycleToRoot, which verifies first. (Hard-to-misuse > convenient.)
function applyRawLifecycle(root: AuthorityRoot, receipt: SignedKeyLifecycleReceipt, now: string): AuthorityRoot {
  if (receipt.event.action === 'revoke') return { ...root, revoked: true };
  return { keyId: keyIdFor(receipt.event.newPublicKey!), algorithm: root.algorithm, publicKey: receipt.event.newPublicKey!, mode: 'dev_real', createdAt: now, expiresAt: null, revoked: false };
}

/** VERIFY-then-apply. Verifies the lifecycle receipt internally and refuses ({ok:false}) on any bad receipt,
 *  so a caller cannot forget to verify and apply a forged revoke/rotate. The only public apply path. */
export function applyVerifiedLifecycleToRoot(root: AuthorityRoot, receipt: SignedKeyLifecycleReceipt, now = new Date().toISOString()): { ok: true; root: AuthorityRoot } | { ok: false; reason: string } {
  const v = verifyKeyLifecycleReceipt(receipt, root);
  if (!v.valid) return { ok: false, reason: v.reason ?? 'invalid lifecycle receipt' };
  return { ok: true, root: applyRawLifecycle(root, receipt, now) };
}

/** Live self-edit promotion gate. STILL LOCKED. Built + verifiable; not wired to flip live state. */
export function isLivePromotionUnlocked(): false {
  return false;
}

// ── Rehearsal receipt — the terminal-first "I verified, I recorded, I did not execute" artifact (Step-4). ──
// PURE (no fs/network). `promotionExecuted`/`rehearsalOnly` are literal-typed so no caller input can flip
// them; the chain hash covers everything else so a stored receipt is tamper-evident, not just plausible.
export interface AumlokRehearsalReceiptV1 {
  schema: 'aumlok-rehearsal-receipt-v1';
  version: 1;
  promotion: SignedPromotionReceipt;
  verifierResult: { valid: boolean; reason?: string };
  chain: { seq: number; prevReceiptHash: string | null };
  createdAt: string;
  rehearsalOnly: true;
  promotionExecuted: false;
  receiptHash: string; // sha256 over every field above, computed last
}

function rehearsalReceiptIntegrity(r: Omit<AumlokRehearsalReceiptV1, 'receiptHash'>): string {
  return sha256(JSON.stringify({
    schema: r.schema, version: r.version, promotion: r.promotion, verifierResult: r.verifierResult,
    chain: r.chain, createdAt: r.createdAt, rehearsalOnly: r.rehearsalOnly, promotionExecuted: r.promotionExecuted,
  }));
}

/** Verify a signed promotion receipt against the pinned root, then wrap the result into a durable, hash-chained
 *  rehearsal record. NEVER throws (verifyPromotionReceipt already fails closed) and NEVER emits
 *  promotionExecuted:true — a failed/forged input still produces a valid *record of a failed verification*,
 *  not a crash and not a silent drop. This function does not touch disk; callers persist the result. */
export function buildRehearsalReceipt(
  promotion: SignedPromotionReceipt,
  root: AuthorityRoot,
  chain: { seq: number; prevReceiptHash: string | null },
  now = new Date().toISOString(),
): AumlokRehearsalReceiptV1 {
  const verifierResult = verifyPromotionReceipt(promotion, root, now);
  const base = {
    schema: 'aumlok-rehearsal-receipt-v1' as const,
    version: 1 as const,
    promotion,
    verifierResult,
    chain: { seq: chain.seq, prevReceiptHash: chain.prevReceiptHash },
    createdAt: now,
    rehearsalOnly: true as const,
    promotionExecuted: false as const,
  };
  return { ...base, receiptHash: rehearsalReceiptIntegrity(base) };
}

/** Fail-closed shape + integrity check for a STORED rehearsal receipt (e.g. read back off disk). */
export function validateRehearsalReceipt(a: any): { valid: boolean; reason?: string } {
  if (!a || typeof a !== 'object') return { valid: false, reason: 'not an object' };
  if (a.schema !== 'aumlok-rehearsal-receipt-v1') return { valid: false, reason: 'wrong schema' };
  if (!hasOnlyKeys(a, REHEARSAL_RECEIPT_KEYS)) return { valid: false, reason: 'unknown field(s) in receipt' };
  if (a.version !== 1) return { valid: false, reason: 'unsupported version' };
  if (a.rehearsalOnly !== true) return { valid: false, reason: 'rehearsalOnly must be true' };
  if (a.promotionExecuted !== false) return { valid: false, reason: 'promotionExecuted must be false' };
  if (!a.promotion || typeof a.promotion !== 'object') return { valid: false, reason: 'malformed promotion' };
  if (!hasOnlyKeys(a.promotion, SIGNED_PROMOTION_RECEIPT_KEYS)) return { valid: false, reason: 'unknown field(s) in promotion' };
  if (a.promotion.authorization !== undefined && !hasOnlyKeys(a.promotion.authorization, PROMOTION_AUTH_KEYS)) return { valid: false, reason: 'unknown field(s) in promotion.authorization' };
  if (!a.verifierResult || typeof a.verifierResult.valid !== 'boolean') return { valid: false, reason: 'malformed verifierResult' };
  if (!hasOnlyKeys(a.verifierResult, VERIFIER_RESULT_KEYS)) return { valid: false, reason: 'unknown field(s) in verifierResult' };
  if (!a.chain || typeof a.chain.seq !== 'number' || a.chain.seq < 0 || !Number.isInteger(a.chain.seq)) return { valid: false, reason: 'malformed chain.seq' };
  if (a.chain.prevReceiptHash !== null && typeof a.chain.prevReceiptHash !== 'string') return { valid: false, reason: 'malformed chain.prevReceiptHash' };
  if (!hasOnlyKeys(a.chain, CHAIN_KEYS)) return { valid: false, reason: 'unknown field(s) in chain' };
  if (!isStr(a.createdAt)) return { valid: false, reason: 'malformed createdAt' };
  if (!isStr(a.receiptHash)) return { valid: false, reason: 'malformed receiptHash' };
  const { receiptHash, ...rest } = a;
  if (receiptHash !== rehearsalReceiptIntegrity(rest)) return { valid: false, reason: 'integrity mismatch (receipt tampered)' };
  return { valid: true };
}
