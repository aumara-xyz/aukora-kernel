// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * AUMLOK owner-authority v2 — ORGANISM-SIDE VERIFIER for the post-quantum hybrid suite (#361 P0, Brick 1).
 *
 * The Great Merge left two unconverged authority systems: the ML-DSA-65 kernel identity/receipt spine and a
 * separate Ed25519 shell/native-apply owner authority. This module is the first brick of convergence: the
 * crypto-agile VERIFIER and its closed envelopes. It pins PUBLIC key material and verifies human
 * authorizations; it holds NO private key and exposes NO signing function (signing lives in the SEPARATE
 * human-side `aumlokSignerV2.ts`, which the organism never imports).
 *
 * Ratified suite: `aumlok-ed25519-ml-dsa-65-v1`. Every v2 authorization carries TWO signatures over the
 * exact same canonical payload — Ed25519 AND ML-DSA-65 — and BOTH must verify. A missing, forged, malformed,
 * wrong-case, wrong-domain, duplicated, unknown-suite, or downgraded signature fails CLOSED. This is a
 * transition hybrid; it is NOT permission to call Ed25519 post-quantum.
 *
 * Chokepoint discipline (Brick-1 rule): ML-DSA is verified ONLY through `pqcVerifyWithDomain` — this module
 * imports NO post-quantum core and never touches the raw ML-DSA primitive directly. The classical half uses `@noble/curves`
 * Ed25519 (verify only). Brick 1 changes NO bind/apply behavior and makes NO post-quantum claim about native
 * apply; it only defines the verifier the later bricks will require.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { hexToBytes } from '@noble/hashes/utils.js';
import { createHash } from 'crypto';
import { pqcVerifyWithDomain, isPqcPublicKeyHex, type PqcDomain } from './crypto';
import { isValidPublicKey as isValidEd25519Pub, type AuthorityRoot as LegacyRootV1 } from './aumlokAuthorityRoot';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const enc = (s: string) => new TextEncoder().encode(s);

/** The ONE ratified hybrid suite. An exact string match is required everywhere — any other value (an
 *  Ed25519-only downgrade, a reordered label, an unknown suite) fails closed. */
export const AUMLOK_SUITE_V2 = 'aumlok-ed25519-ml-dsa-65-v1' as const;
export type AumlokSuiteV2 = typeof AUMLOK_SUITE_V2;

/** The custody tier this software suite is honestly allowed to claim. NEVER "hardware"/"production". */
export const AUMLOK_MODE_V2 = 'software_hybrid' as const;
export type AumlokModeV2 = typeof AUMLOK_MODE_V2;

// The purpose-separated ML-DSA domains this suite signs under (must exist in crypto.ts PQC_DOMAINS).
const DOMAIN_PROMOTION: PqcDomain = 'aumlokPromotion';
const DOMAIN_LIFECYCLE: PqcDomain = 'aumlokLifecycle';
const DOMAIN_MIGRATION: PqcDomain = 'aumlokMigration';

// ── wire-hex discipline — canonical LOWERCASE only, exact byte lengths. Wrong case / wrong length refuses. ──
const _lc = /^[0-9a-f]+$/;
const isHexLenLower = (s: unknown, hexLen: number): s is string => typeof s === 'string' && s.length === hexLen && _lc.test(s);
export const isEd25519PubHex = (s: unknown): s is string => isHexLenLower(s, 64);    // 32 bytes
export const isEd25519SigHex = (s: unknown): s is string => isHexLenLower(s, 128);   // 64 bytes
export const isMlDsa65SigHex = (s: unknown): s is string => isHexLenLower(s, 3309 * 2); // 3309 bytes
export const isMlDsa65PubHex = (s: unknown): s is string => isPqcPublicKeyHex(s);    // 1952 bytes (lowercase)
const isStr = (x: unknown): x is string => typeof x === 'string';
const isFullRootId = (s: unknown): s is string => isHexLenLower(s, 64); // sha256 hex — the FULL id, never truncated

// ── closed-envelope discipline — an UNKNOWN top-level or nested key is rejected outright (never trust an
// unsigned shadow field that some future consumer might read). Mirrors aumlokAuthorityRoot.ts (v1). ──
function hasOnlyKeys(obj: any, allowed: ReadonlySet<string>): boolean {
  return !!obj && typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj).every((k) => allowed.has(k));
}
const PUBLICKEYS_KEYS: ReadonlySet<string> = new Set(['ed25519', 'mlDsa65']);
const SIGNATURES_KEYS: ReadonlySet<string> = new Set(['ed25519', 'mlDsa65']);
const ROOT_V2_KEYS: ReadonlySet<string> = new Set(['schema', 'suite', 'rootId', 'publicKeys', 'mode', 'createdAt', 'expiresAt', 'revoked', 'integrity']);
const PROMOTION_AUTH_V2_KEYS: ReadonlySet<string> = new Set(['rootId', 'proposalHash', 'draftHash', 'nonce', 'issuedAt', 'expiresAt']);
// exported (Brick 3 step 2 round 3) so the owner-command file reader enforces the SAME closed top-level
// allow-list the crypto envelope does — one list, reused, never a drifting second copy.
export const SIGNED_PROMOTION_V2_KEYS: ReadonlySet<string> = new Set(['schema', 'suite', 'authorization', 'signatures', 'mode']);
const LIFECYCLE_EVENT_V2_KEYS: ReadonlySet<string> = new Set(['action', 'rootId', 'newPublicKeys', 'reason', 'issuedAt']);
const SIGNED_LIFECYCLE_V2_KEYS: ReadonlySet<string> = new Set(['schema', 'suite', 'event', 'signatures', 'mode']);
const MIGRATION_V1_KEYS: ReadonlySet<string> = new Set(['schema', 'oldRootId', 'newRootId', 'oldPublicKey', 'newPublicKeys', 'nonce', 'issuedAt', 'expiresAt', 'oldSignature', 'newSignature']);

// ── public-key pair + closed shape guards ────────────────────────────────────────────────────────────────
export interface HybridPublicKeys { ed25519: string; mlDsa65: string }
export interface HybridSignatures { ed25519: string; mlDsa65: string }

function isValidPublicKeys(p: any): p is HybridPublicKeys {
  return hasOnlyKeys(p, PUBLICKEYS_KEYS) && isEd25519PubHex(p.ed25519) && isMlDsa65PubHex(p.mlDsa65);
}
function isValidSignatures(s: any): s is HybridSignatures {
  // closed shape + exact lengths/case + NOT the same string twice (a duplicated signature is never a real
  // dual signature — the two algorithms produce different-length artifacts)
  return hasOnlyKeys(s, SIGNATURES_KEYS) && isEd25519SigHex(s.ed25519) && isMlDsa65SigHex(s.mlDsa65) && s.ed25519 !== s.mlDsa65;
}

/** The FULL root id is sha256 over the exact public material (suite + both public keys). Truncated
 *  fingerprints are display only and must NEVER select or authorize a root. */
export function rootIdV2(pub: HybridPublicKeys): string {
  return sha256(JSON.stringify({ suite: AUMLOK_SUITE_V2, ed25519: pub.ed25519, mlDsa65: pub.mlDsa65 }));
}

/** The canonical FULL 64-hex id of a LEGACY (v1 Ed25519-only) authority root, derived from its public key.
 *  A migration's `oldRootId` MUST equal this over the TRUSTED pinned key — never a label carried inside the
 *  (untrusted) migration envelope. This is the one binding that stops a fresh Ed key from claiming to be an
 *  existing root. */
export function legacyRootIdV1(ed25519PublicKeyHex: string): string {
  return sha256('aumlok-legacy-root-v1:' + ed25519PublicKeyHex);
}

/** The trusted pinned legacy root a migration authorizes FROM — the v1 Ed25519 authority root (from a
 *  verified on-disk manifest), NOT anything inside the migration envelope. */
export type TrustedLegacyRoot = LegacyRootV1;

// ── canonical serializers — deterministic, ONLY known fields, schema-prefixed so even the classical
// (context-less) Ed25519 signature is bound to this exact purpose/shape by content. ──
export function canonicalPromotionV2(auth: PromotionAuthorizationV2): string {
  return JSON.stringify({
    _: 'aumlok-signed-promotion-v2', suite: AUMLOK_SUITE_V2,
    rootId: auth.rootId, proposalHash: auth.proposalHash, draftHash: auth.draftHash,
    nonce: auth.nonce, issuedAt: auth.issuedAt, expiresAt: auth.expiresAt,
  });
}
export function canonicalLifecycleV2(event: KeyLifecycleEventV2): string {
  return JSON.stringify({
    _: 'aumlok-key-lifecycle-v2', suite: AUMLOK_SUITE_V2,
    action: event.action, rootId: event.rootId,
    newPublicKeys: event.newPublicKeys ? { ed25519: event.newPublicKeys.ed25519, mlDsa65: event.newPublicKeys.mlDsa65 } : null,
    reason: event.reason, issuedAt: event.issuedAt,
  });
}
export function canonicalMigrationV1(m: Omit<AuthorityMigrationV1, 'oldSignature' | 'newSignature'>): string {
  return JSON.stringify({
    _: 'aumlok-authority-migration-v1',
    oldRootId: m.oldRootId, newRootId: m.newRootId, oldPublicKey: m.oldPublicKey,
    newPublicKeys: { ed25519: m.newPublicKeys.ed25519, mlDsa65: m.newPublicKeys.mlDsa65 },
    nonce: m.nonce, issuedAt: m.issuedAt, expiresAt: m.expiresAt,
  });
}
function rootIntegrityV2(r: Omit<AuthorityRootV2, 'integrity'>): string {
  return sha256(JSON.stringify({
    schema: r.schema, suite: r.suite, rootId: r.rootId,
    publicKeys: { ed25519: r.publicKeys.ed25519, mlDsa65: r.publicKeys.mlDsa65 },
    mode: r.mode, createdAt: r.createdAt, expiresAt: r.expiresAt, revoked: r.revoked,
  }));
}

// ── envelope types ───────────────────────────────────────────────────────────────────────────────────────
export interface AuthorityRootV2 {
  schema: 'aumlok-authority-root-v2';
  suite: AumlokSuiteV2;
  rootId: string;            // FULL 64-hex
  publicKeys: HybridPublicKeys;
  mode: AumlokModeV2;
  createdAt: string;
  expiresAt: string | null;
  revoked: boolean;
  integrity: string;         // sha256 over the canonical fields
}
export interface PromotionAuthorizationV2 {
  rootId: string; proposalHash: string; draftHash: string; nonce: string; issuedAt: string; expiresAt: string | null;
}
export interface SignedPromotionV2 {
  schema: 'aumlok-signed-promotion-v2';
  suite: AumlokSuiteV2;
  authorization: PromotionAuthorizationV2;
  signatures: HybridSignatures;
  mode: AumlokModeV2;
}
export interface KeyLifecycleEventV2 {
  action: 'revoke' | 'rotate';
  rootId: string;
  newPublicKeys: HybridPublicKeys | null; // rotate: the replacement pair; revoke: null
  reason: string;
  issuedAt: string;
}
export interface SignedLifecycleV2 {
  schema: 'aumlok-key-lifecycle-v2';
  suite: AumlokSuiteV2;
  event: KeyLifecycleEventV2;
  signatures: HybridSignatures;
  mode: AumlokModeV2;
}
export interface AuthorityMigrationV1 {
  schema: 'aumlok-authority-migration-v1';
  oldRootId: string;                 // FULL 64-hex of the outgoing Ed25519-only (v1) root
  newRootId: string;                 // FULL 64-hex of the incoming hybrid (v2) root
  oldPublicKey: string;              // outgoing Ed25519 public key (authorizes the migration)
  newPublicKeys: HybridPublicKeys;   // incoming hybrid pair
  nonce: string;
  issuedAt: string;
  expiresAt: string | null;
  oldSignature: string;              // Ed25519 over the migration payload (old root consents)
  newSignature: string;              // ML-DSA-65 PoP over the SAME payload (new key proves possession)
}

export type Verdict = { valid: true; reason?: undefined } | { valid: false; reason: string };

function isValidPromotionAuthorization(a: any): a is PromotionAuthorizationV2 {
  return hasOnlyKeys(a, PROMOTION_AUTH_V2_KEYS)
    && isFullRootId(a.rootId) && isStr(a.proposalHash) && isStr(a.draftHash) && isStr(a.nonce) && isStr(a.issuedAt)
    && (a.expiresAt === null || isStr(a.expiresAt));
}
function isValidLifecycleEvent(e: any): e is KeyLifecycleEventV2 {
  if (!hasOnlyKeys(e, LIFECYCLE_EVENT_V2_KEYS)) return false;
  if (e.action !== 'revoke' && e.action !== 'rotate') return false;
  if (!isFullRootId(e.rootId) || !isStr(e.reason) || !isStr(e.issuedAt)) return false;
  if (e.action === 'rotate') return isValidPublicKeys(e.newPublicKeys);
  return e.newPublicKeys === null; // revoke carries no replacement pair
}

function edVerify(sigHex: string, msg: Uint8Array, pubHex: string): boolean {
  try { return ed25519.verify(hexToBytes(sigHex), msg, hexToBytes(pubHex)); } catch { return false; }
}

/** The mandatory dual check: BOTH Ed25519 AND ML-DSA-65 must verify over the SAME message bytes, with
 *  ML-DSA routed through the domain-separated PQC chokepoint. Any single failure fails closed. Shapes are
 *  assumed pre-validated by the callers below; this is the crypto core of the suite. */
function verifyDual(msg: Uint8Array, sigs: HybridSignatures, pubs: HybridPublicKeys, domain: PqcDomain): Verdict {
  if (!edVerify(sigs.ed25519, msg, pubs.ed25519)) return { valid: false, reason: 'ed25519 signature invalid' };
  if (!pqcVerifyWithDomain(pubs.mlDsa65, msg, sigs.mlDsa65, domain)) return { valid: false, reason: 'ml-dsa-65 signature invalid' };
  return { valid: true };
}

/** Pin a hybrid authority root from PUBLIC material. Throws on malformed keys (fail-closed — no half root). */
export function pinAuthorityRootV2(publicKeys: HybridPublicKeys, opts?: { createdAt?: string; expiresAt?: string | null }): AuthorityRootV2 {
  if (!isValidPublicKeys(publicKeys)) throw new Error('pinAuthorityRootV2: malformed hybrid public keys');
  const base: Omit<AuthorityRootV2, 'integrity'> = {
    schema: 'aumlok-authority-root-v2', suite: AUMLOK_SUITE_V2, rootId: rootIdV2(publicKeys),
    publicKeys: { ed25519: publicKeys.ed25519, mlDsa65: publicKeys.mlDsa65 },
    mode: AUMLOK_MODE_V2, createdAt: opts?.createdAt ?? new Date().toISOString(), expiresAt: opts?.expiresAt ?? null, revoked: false,
  };
  return { ...base, integrity: rootIntegrityV2(base) };
}

/** Mark a pinned root revoked and RE-SEAL its integrity hash. Because `revoked` participates in the
 *  integrity hash, a revoke is a state change that must re-seal — so a persisted root always stays
 *  integrity-coherent, and an attacker flipping `revoked` true->false on disk is caught by the hash. */
export function revokeAuthorityRootV2(root: AuthorityRootV2): AuthorityRootV2 {
  const { integrity: _drop, ...rest } = root;
  const base: Omit<AuthorityRootV2, 'integrity'> = { ...rest, revoked: true };
  return { ...base, integrity: rootIntegrityV2(base) };
}

/** The integrity this manifest carried BEFORE revocation (#361 Cycle C). The genesis binding receipt
 *  binds the UNREVOKED manifest; after a dual-signed revoke re-seals the manifest, bundle coherence
 *  compares the receipt against THIS value — the revocation itself is recorded by the re-sealed
 *  manifest, the lifecycle journal, and the authority-event ledger, never by rewriting genesis history. */
export function preRevocationIntegrityV2(root: AuthorityRootV2): string {
  const { integrity: _drop, ...rest } = root;
  return rootIntegrityV2({ ...rest, revoked: false });
}

/** Structural guard for a pinned root (closed shape, exact suite/mode, coherent id + integrity). */
export function isValidAuthorityRootV2(r: any): r is AuthorityRootV2 {
  if (r?.schema !== 'aumlok-authority-root-v2') return false;
  if (!hasOnlyKeys(r, ROOT_V2_KEYS)) return false;
  if (r.suite !== AUMLOK_SUITE_V2) return false;              // unknown / downgraded suite refuses
  if (r.mode !== AUMLOK_MODE_V2) return false;
  if (!isValidPublicKeys(r.publicKeys)) return false;
  if (!isFullRootId(r.rootId) || r.rootId !== rootIdV2(r.publicKeys)) return false; // full id must match material
  if (typeof r.revoked !== 'boolean') return false;
  if (!isStr(r.createdAt) || (r.expiresAt !== null && !isStr(r.expiresAt))) return false;
  const { integrity, ...rest } = r as AuthorityRootV2;
  return isStr(integrity) && integrity === rootIntegrityV2(rest);
}

/** Verify a v2 dual-signed promotion authorization against a pinned hybrid root. Fail-closed on every
 *  shape, suite, expiry, binding, and signature fault. Mandatory ML-DSA: a valid Ed25519 alone REFUSES. */
export function verifyPromotionV2(receipt: any, root: AuthorityRootV2, now = new Date().toISOString()): Verdict {
  if (receipt?.schema !== 'aumlok-signed-promotion-v2') return { valid: false, reason: 'wrong schema' };
  if (!hasOnlyKeys(receipt, SIGNED_PROMOTION_V2_KEYS)) return { valid: false, reason: 'unknown field(s) in receipt' };
  if (receipt.suite !== AUMLOK_SUITE_V2) return { valid: false, reason: 'unknown or downgraded suite' };
  if (receipt.mode !== AUMLOK_MODE_V2) return { valid: false, reason: 'wrong mode' };
  if (!isValidAuthorityRootV2(root)) return { valid: false, reason: 'malformed authority root' };
  if (root.revoked) return { valid: false, reason: 'authority root revoked' };
  if (!isValidPromotionAuthorization(receipt.authorization)) return { valid: false, reason: 'malformed authorization' };
  if (!isValidSignatures(receipt.signatures)) return { valid: false, reason: 'malformed signatures' };
  if (receipt.authorization.rootId !== root.rootId) return { valid: false, reason: 'rootId mismatch' };
  if (root.expiresAt && now > root.expiresAt) return { valid: false, reason: 'authority root expired' };
  if (receipt.authorization.expiresAt && now > receipt.authorization.expiresAt) return { valid: false, reason: 'authorization expired' };
  return verifyDual(enc(canonicalPromotionV2(receipt.authorization)), receipt.signatures, root.publicKeys, DOMAIN_PROMOTION);
}

/** Verify a v2 dual-signed key-lifecycle (rotate/revoke) authorization against a pinned hybrid root. A
 *  REVOKED or EXPIRED root can authorize nothing — matching the promotion gate (Codex review, #362). */
export function verifyLifecycleV2(receipt: any, root: AuthorityRootV2, now = new Date().toISOString()): Verdict {
  if (receipt?.schema !== 'aumlok-key-lifecycle-v2') return { valid: false, reason: 'wrong schema' };
  if (!hasOnlyKeys(receipt, SIGNED_LIFECYCLE_V2_KEYS)) return { valid: false, reason: 'unknown field(s) in receipt' };
  if (receipt.suite !== AUMLOK_SUITE_V2) return { valid: false, reason: 'unknown or downgraded suite' };
  if (receipt.mode !== AUMLOK_MODE_V2) return { valid: false, reason: 'wrong mode' };
  if (!isValidAuthorityRootV2(root)) return { valid: false, reason: 'malformed authority root' };
  if (root.revoked) return { valid: false, reason: 'authority root revoked' };
  if (root.expiresAt && now > root.expiresAt) return { valid: false, reason: 'authority root expired' };
  if (!isValidLifecycleEvent(receipt.event)) return { valid: false, reason: 'malformed event' };
  if (!isValidSignatures(receipt.signatures)) return { valid: false, reason: 'malformed signatures' };
  if (receipt.event.rootId !== root.rootId) return { valid: false, reason: 'rootId mismatch' };
  return verifyDual(enc(canonicalLifecycleV2(receipt.event)), receipt.signatures, root.publicKeys, DOMAIN_LIFECYCLE);
}

/** Verify an Ed25519(v1)->hybrid(v2) migration. The consent is authorized FROM the caller's TRUSTED pinned
 *  v1 root — NOT from anything inside the migration envelope (Codex review, #362). The verifier binds the
 *  envelope's `oldPublicKey` and `oldRootId` to that trusted key, so a freshly generated Ed key can never
 *  claim to be an existing root. The OLD Ed key consents (oldSignature) and the NEW ML-DSA key proves
 *  possession (newSignature), BOTH over the same payload. Missing/mismatched either refuses. This authorizes
 *  the LINEAGE only; it installs nothing (atomic install is Brick 4). */
export function verifyMigrationV1(m: any, trustedOldRoot: TrustedLegacyRoot, now = new Date().toISOString()): Verdict {
  if (m?.schema !== 'aumlok-authority-migration-v1') return { valid: false, reason: 'wrong schema' };
  if (!hasOnlyKeys(m, MIGRATION_V1_KEYS)) return { valid: false, reason: 'unknown field(s) in migration' };
  // ── the TRUSTED old root is the sole authority source; validate its state before anything it authorizes ──
  if (!trustedOldRoot || trustedOldRoot.algorithm !== 'ed25519' || !isValidEd25519Pub(trustedOldRoot.publicKey)) return { valid: false, reason: 'untrusted or malformed legacy root' };
  if (trustedOldRoot.revoked) return { valid: false, reason: 'legacy root revoked' };
  if (trustedOldRoot.expiresAt && now > trustedOldRoot.expiresAt) return { valid: false, reason: 'legacy root expired' };
  // ── bind the envelope's old material to the TRUSTED key (never trust the envelope's own claim) ──
  if (m.oldPublicKey !== trustedOldRoot.publicKey) return { valid: false, reason: 'old public key does not match the pinned legacy root' };
  if (m.oldRootId !== legacyRootIdV1(trustedOldRoot.publicKey)) return { valid: false, reason: 'old root id does not match the pinned legacy root' };
  // ── new (incoming hybrid) material ──
  if (!isFullRootId(m.newRootId)) return { valid: false, reason: 'malformed new root id' };
  if (m.oldRootId === m.newRootId) return { valid: false, reason: 'old and new root id must differ' };
  if (!isEd25519PubHex(m.oldPublicKey)) return { valid: false, reason: 'malformed old public key' };
  if (!isValidPublicKeys(m.newPublicKeys)) return { valid: false, reason: 'malformed new public keys' };
  if (m.newRootId !== rootIdV2(m.newPublicKeys)) return { valid: false, reason: 'new rootId does not match new material' };
  if (!isStr(m.nonce) || !isStr(m.issuedAt) || (m.expiresAt !== null && !isStr(m.expiresAt))) return { valid: false, reason: 'malformed nonce/time' };
  // expiry BOUNDS the authorization window only; it is NOT durable replay prevention (a nonce ledger that
  // rejects a re-presented valid migration is a later brick — never claim replay protection from expiry).
  if (m.expiresAt && now > m.expiresAt) return { valid: false, reason: 'migration expired' };
  if (!isEd25519SigHex(m.oldSignature)) return { valid: false, reason: 'malformed old signature' };
  if (!isMlDsa65SigHex(m.newSignature)) return { valid: false, reason: 'malformed new signature' };
  // signatures verify against the TRUSTED key (old) and the bound new material (ML-DSA proof-of-possession)
  const msg = enc(canonicalMigrationV1(m));
  if (!edVerify(m.oldSignature, msg, trustedOldRoot.publicKey)) return { valid: false, reason: 'old ed25519 consent invalid' };
  if (!pqcVerifyWithDomain(m.newPublicKeys.mlDsa65, msg, m.newSignature, DOMAIN_MIGRATION)) return { valid: false, reason: 'new ml-dsa-65 proof-of-possession invalid' };
  return { valid: true };
}

/** Display-only short fingerprint of a FULL root id (first 12 hex). NEVER used to select or authorize. */
export function displayFingerprintV2(fullRootId: string): string {
  return isFullRootId(fullRootId) ? fullRootId.slice(0, 12) : '';
}
