// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * AUMLOK fresh atomic HYBRID bind (#361 P0, Brick 2). Generates a brand-new post-quantum owner identity:
 * two INDEPENDENT private seeds (Ed25519 + ML-DSA-65) from the OS CSPRNG, assembles the COMPLETE bundle
 * (both public keys, closed v2 root manifest, scrypt phrase fingerprint, genesis receipt, AND the completion
 * marker) inside one private same-filesystem staging directory, VERIFIES it from staged bytes, then PUBLISHES
 * it with ONE atomic directory rename into a previously-absent final bundle path — guarded by an exclusive
 * bind lock. The whole identity therefore appears all-at-once or not at all; a crash before publish leaves the
 * prior/unbound state exactly intact, and there is no partial destination to clean up (Codex #366 review).
 *
 * Hard rules: the phrase derives NEITHER seed; dual-mandatory (both keys in the published bundle or nothing —
 * NO silent Ed25519-only fallback); refuses over any existing v1/v2 or partial state; exactly one concurrent
 * bind wins; publish/marker failure is NEVER swallowed as success; seeds/phrase never leave this process;
 * custody is `software_hybrid` (never hardware/production). No native-apply (Brick 3) or migration (Brick 4).
 * ML-DSA public keys come only from the `crypto` chokepoint — no raw post-quantum core import here.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { pqcPublicKeyFromSeed } from './crypto';
import {
  AUMLOK_SUITE_V2, AUMLOK_MODE_V2, pinAuthorityRootV2, isValidAuthorityRootV2, rootIdV2, preRevocationIntegrityV2,
  type HybridPublicKeys, type AuthorityRootV2,
} from './aumlokAuthorityV2';

const PHRASE_KDF = { N: 1 << 15, r: 8, p: 1, keyLen: 32, maxmem: 128 * 1024 * 1024 } as const; // == v1 PHRASE_KDF_V2

// ── on-disk layout ─────────────────────────────────────────────────────────────────────────────────────
const F_ED_KEY = 'authority-ed25519.key';
const F_ML_KEY = 'authority-mldsa65.key';
const F_ED_PUB = 'authority-ed25519.pub';
const F_ML_PUB = 'authority-mldsa65.pub';
const F_ROOT = 'authority-root-v2.json';
const F_FP = 'phrase-fingerprint.json';
const F_RECEIPT = 'binding-receipt-v2.json';
const F_MARKER = 'bind-commit-v2.json';
// the COMPLETE published bundle — every file that must exist for a node to be considered bound
const BUNDLE_FILES = [F_ED_KEY, F_ML_KEY, F_ED_PUB, F_ML_PUB, F_ROOT, F_FP, F_RECEIPT, F_MARKER] as const;
const KEY_FILES = [F_ED_KEY, F_ML_KEY] as const;
// a v1 identity (or its remnants) living directly in aumlok/ also blocks a fresh v2 bind
const V1_ENTRIES = ['authority-ed25519.key', 'authority-root.json', 'binding-receipt.json', 'phrase-fingerprint.json'];

function keyDir(homeDir: string): string { return path.join(homeDir, 'aumlok'); }
function bundleDir(homeDir: string): string { return path.join(keyDir(homeDir), 'hybrid-v2'); } // the atomic publish target
function lockPath(homeDir: string): string { return path.join(keyDir(homeDir), '.hybrid-v2.lock'); }

/** The published hybrid bundle path — exported for the HUMAN-SIDE custody signer (aumlokSignerCustodyV2.ts)
 *  and the ceremony surfaces, so no second module hardcodes (and drifts) this layout. Path derivation only —
 *  existence/coherence remain the callers' gates. */
export function hybridBundleDir(homeDir: string): string { return bundleDir(homeDir); }
/** Bundle-internal seed filenames — exported ONLY for the human-side custody signer's strict reads. */
export const HYBRID_SEED_FILES = { ed25519: F_ED_KEY, mlDsa65: F_ML_KEY } as const;

/** Test-only fault injection points. Never set in production callers. */
export type BindFault = 'corruptEdSeed' | 'corruptMlSeed' | 'corruptManifest' | 'deleteMlKey' | 'throwBeforePublish';
export interface BindHybridOpts { faults?: ReadonlySet<BindFault> }

export type BindHybridVerdict =
  | { ok: true; rootId: string; publicKeys: HybridPublicKeys; suite: typeof AUMLOK_SUITE_V2; custody: typeof AUMLOK_MODE_V2 }
  | { ok: false; reason: string };

export interface HybridBindStatus {
  bound: boolean;
  suite?: typeof AUMLOK_SUITE_V2;
  custody?: typeof AUMLOK_MODE_V2;
  rootId?: string;          // full 64-hex, public
  /** #361 Cycle C: the pinned root has been REVOKED by a dual-signed lifecycle event — material present,
   *  authority dead. Surfaces must show it; the signer and verifier both refuse independently. */
  revoked?: boolean;
  /** rotations recorded in the bundle's phrase fingerprint (0 on a genesis bundle). Display truth only. */
  rotations?: number;
}

const scryptHex = (phrase: string, saltHex: string): string =>
  scryptSync(phrase, saltHex, PHRASE_KDF.keyLen, { N: PHRASE_KDF.N, r: PHRASE_KDF.r, p: PHRASE_KDF.p, maxmem: PHRASE_KDF.maxmem }).toString('hex');
function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try { return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')); } catch { return false; }
}
function fsyncDir(dir: string): void {
  try { const fd = fs.openSync(dir, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } } catch { /* best-effort */ }
}
function writeDurable(p: string, data: string, mode: number): void {
  const fd = fs.openSync(p, 'wx', mode); // wx: exclusive create — never follows a symlink, never clobbers
  try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function modeOf(p: string): number | null { try { return fs.statSync(p).mode & 0o777; } catch { return null; } }

/**
 * The ONE shared complete-bundle COHERENCE verifier — used by status AND by future custody loading before
 * any apply (Codex #366 review). It requires every bundle file + strict key modes, reads BOTH private seeds
 * INTERNALLY (never returned or logged), validates their shape, RE-DERIVES both public keys through the
 * approved chokepoints, and cross-checks them against the .pub files, the manifest (publicKeys + rootId), the
 * marker, and the receipt. A node whose stored seeds cannot reproduce its pinned public root is NOT bound.
 * Returns PUBLIC fields only.
 */
export function verifyBundleCoherence(dir: string): { ok: true; rootId: string; publicKeys: HybridPublicKeys } | { ok: false; reason: string } {
  try {
    for (const f of BUNDLE_FILES) { if (!fs.existsSync(path.join(dir, f))) return { ok: false, reason: `incomplete bundle: missing ${f}` }; }
    for (const k of KEY_FILES) { if (modeOf(path.join(dir, k)) !== 0o600) return { ok: false, reason: `key ${k} not at strict 0600` }; }
    const rd = (f: string) => fs.readFileSync(path.join(dir, f), 'utf-8');
    // read the private seeds ONLY to re-derive; they are never returned or logged
    const edSeedHex = rd(F_ED_KEY).trim();
    const mlSeedHex = rd(F_ML_KEY).trim();
    if (!/^[0-9a-f]{64}$/.test(edSeedHex) || !/^[0-9a-f]{64}$/.test(mlSeedHex)) return { ok: false, reason: 'stored seed malformed' };
    const reEd = bytesToHex(ed25519.getPublicKey(Buffer.from(edSeedHex, 'hex')));
    const reMl = pqcPublicKeyFromSeed(mlSeedHex);
    if (rd(F_ED_PUB).trim() !== reEd) return { ok: false, reason: 'stored ed25519 seed does not derive the committed public key' };
    if (rd(F_ML_PUB).trim() !== reMl) return { ok: false, reason: 'stored ml-dsa-65 seed does not derive the committed public key' };
    const manifest = JSON.parse(rd(F_ROOT));
    if (!isValidAuthorityRootV2(manifest)) return { ok: false, reason: 'manifest failed integrity/shape' };
    if (manifest.publicKeys.ed25519 !== reEd || manifest.publicKeys.mlDsa65 !== reMl) return { ok: false, reason: 'manifest keys do not match the stored seeds' };
    if (manifest.rootId !== rootIdV2({ ed25519: reEd, mlDsa65: reMl })) return { ok: false, reason: 'rootId does not match the stored material' };
    const marker = JSON.parse(rd(F_MARKER));
    if (marker?.schema !== 'aumlok-bind-commit-v2' || marker.rootId !== manifest.rootId) return { ok: false, reason: 'marker missing or not bound to the manifest' };
    // ── binding-receipt: CLOSED structural shape + binding (Brick 3 precondition). A REVOKED manifest
    // was re-sealed AFTER genesis (#361 Cycle C) — the genesis receipt honestly binds the UNREVOKED
    // integrity, so that is what a revoked bundle compares against; unrevoked bundles compare exact. ──
    const receipt = JSON.parse(rd(F_RECEIPT));
    const boundIntegrity = manifest.revoked === true ? preRevocationIntegrityV2(manifest) : manifest.integrity;
    const rV = validateBindingReceiptShape(receipt, manifest.rootId, boundIntegrity);
    if (!rV.ok) return rV;
    // ── phrase-fingerprint: STRUCTURAL shape only — the plaintext stays dark (no phrase compare here) ──
    const fpV = validatePhraseFingerprintShape(JSON.parse(rd(F_FP)));
    if (!fpV.ok) return fpV;
    return { ok: true, rootId: manifest.rootId, publicKeys: { ed25519: reEd, mlDsa65: reMl } };
  } catch (e) { return { ok: false, reason: `bundle unreadable/incoherent (${(e as Error)?.message ?? 'error'})` }; }
}

const isIso = (s: unknown): s is string => typeof s === 'string' && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString() === s;
function onlyKeys(o: any, allowed: readonly string[]): boolean { return !!o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).every((k) => allowed.includes(k)); }
const RECEIPT_KEYS = ['schema', 'suite', 'custody', 'rootId', 'manifestIntegrity', 'boundAt', 'drandAnchor'] as const;
const FINGERPRINT_KEYS = ['schema', 'kdf', 'N', 'r', 'p', 'saltHex', 'hashHex', 'updatedAt', 'rotations'] as const;

/** The binding receipt is a CLOSED shape bound to the manifest (rootId + integrity), software custody, a real
 *  instant, and (for now) no drand anchor. Any unknown field or wrong value refuses. */
export function validateBindingReceiptShape(r: any, rootId: string, manifestIntegrity: string): { ok: true } | { ok: false; reason: string } {
  if (!onlyKeys(r, RECEIPT_KEYS)) return { ok: false, reason: 'receipt has unknown/missing field(s)' };
  if (r.schema !== 'aumlok-binding-receipt-v2') return { ok: false, reason: 'receipt wrong schema' };
  if (r.suite !== AUMLOK_SUITE_V2) return { ok: false, reason: 'receipt wrong suite' };
  if (r.custody !== AUMLOK_MODE_V2) return { ok: false, reason: 'receipt wrong custody' };
  if (r.rootId !== rootId || r.manifestIntegrity !== manifestIntegrity) return { ok: false, reason: 'receipt not bound to the manifest' };
  if (!isIso(r.boundAt)) return { ok: false, reason: 'receipt boundAt not a valid instant' };
  if (r.drandAnchor !== null) return { ok: false, reason: 'receipt drandAnchor must be null (no anchor this brick)' };
  return { ok: true };
}

/** The phrase fingerprint's STRUCTURE is validated (schema, KDF params, salt/hash hex, rotations) — never its
 *  plaintext. The actual scrypt re-verify happens ONLY where the typed phrase exists (the pre-publish gate). */
export function validatePhraseFingerprintShape(fp: any): { ok: true } | { ok: false; reason: string } {
  if (!onlyKeys(fp, FINGERPRINT_KEYS)) return { ok: false, reason: 'fingerprint has unknown/missing field(s)' };
  if (fp.schema !== 'aumlok-phrase-fingerprint-v2') return { ok: false, reason: 'fingerprint wrong schema' };
  if (fp.kdf !== 'scrypt') return { ok: false, reason: 'fingerprint wrong kdf' };
  if (fp.N !== PHRASE_KDF.N || fp.r !== PHRASE_KDF.r || fp.p !== PHRASE_KDF.p) return { ok: false, reason: 'fingerprint KDF params off' };
  // EXACT sizes the generator writes: 16-byte salt (32 hex), 32-byte scrypt hash (64 hex), lowercase only
  if (typeof fp.saltHex !== 'string' || !/^[0-9a-f]{32}$/.test(fp.saltHex)) return { ok: false, reason: 'fingerprint salt not exactly 16 bytes (32 lowercase hex)' };
  if (typeof fp.hashHex !== 'string' || !/^[0-9a-f]{64}$/.test(fp.hashHex)) return { ok: false, reason: 'fingerprint hash not exactly 32 bytes (64 lowercase hex)' };
  if (!isIso(fp.updatedAt)) return { ok: false, reason: 'fingerprint updatedAt not a valid instant' };
  if (!Number.isInteger(fp.rotations) || fp.rotations < 0) return { ok: false, reason: 'fingerprint rotations invalid' };
  return { ok: true };
}

/** Read-only public status — bound ONLY when the complete bundle passes full custody coherence (the stored
 *  seeds actually re-derive the pinned public root). Never reports bound from the manifest alone.
 *  #361 Cycle C: also surfaces `revoked` (a revoked root still has coherent material — authority dead) and
 *  the fingerprint's rotation count, so truth surfaces never have to re-open the bundle themselves. */
export function hybridBindStatusV2(homeDir: string): HybridBindStatus {
  const dir = bundleDir(homeDir);
  const c = verifyBundleCoherence(dir);
  if (!c.ok) return { bound: false };
  let revoked = false; let rotations = 0;
  try { revoked = JSON.parse(fs.readFileSync(path.join(dir, F_ROOT), 'utf-8')).revoked === true; } catch { /* coherence just proved it readable */ }
  try { rotations = JSON.parse(fs.readFileSync(path.join(dir, F_FP), 'utf-8')).rotations ?? 0; } catch { /* ditto */ }
  return { bound: true, suite: AUMLOK_SUITE_V2, custody: AUMLOK_MODE_V2, rootId: c.rootId, revoked, rotations };
}

/** ANY v2 state on this node: the published bundle, an interrupted staging dir (`.bindv2-*`), or a held
 *  bind lock. Native apply uses this ONE sentinel to decide "this node is v2 — require coherent dual custody
 *  and NEVER fall back to v1"; a leftover staging/lock with no coherent bundle therefore fails closed rather
 *  than silently authorizing via the legacy v1 root. Legacy v1 applies only when NO v2 state exists. */
export function hybridV2StatePresent(homeDir: string): boolean {
  if (fs.existsSync(bundleDir(homeDir)) || fs.existsSync(lockPath(homeDir))) return true;
  try { for (const e of fs.readdirSync(keyDir(homeDir))) { if (e.startsWith('.bindv2-')) return true; } } catch { /* no aumlok dir = no v2 state */ }
  return false;
}

/** The v2 custody LOADER (Brick 3 step 2): returns the pinned hybrid root ONLY when the complete bundle is
 *  custody-coherent (stored seeds re-derive the pinned public keys; receipt + fingerprint structurally
 *  valid). Native apply loads authority through THIS gate — no coherent custody, no root, no authorization. */
export function loadHybridCustody(homeDir: string): { ok: true; root: AuthorityRootV2 } | { ok: false; reason: string } {
  const dir = bundleDir(homeDir);
  const c = verifyBundleCoherence(dir);
  if (!c.ok) return { ok: false, reason: c.reason };
  try {
    const root = JSON.parse(fs.readFileSync(path.join(dir, F_ROOT), 'utf-8')) as AuthorityRootV2;
    if (!isValidAuthorityRootV2(root) || root.rootId !== c.rootId) return { ok: false, reason: 'manifest incoherent after coherence check' };
    return { ok: true, root };
  } catch (e) { return { ok: false, reason: `custody load failed (${(e as Error)?.message ?? 'error'})` }; }
}

function existingStateBlocks(homeDir: string): boolean {
  if (fs.existsSync(bundleDir(homeDir))) return true;                                  // a v2 identity already exists
  const dir = keyDir(homeDir);
  for (const f of V1_ENTRIES) { if (fs.existsSync(path.join(dir, f))) return true; }   // a v1 identity/remnant exists
  try { for (const e of fs.readdirSync(dir)) { if (e.startsWith('.bindv2-')) return true; } } catch { /* dir absent = clean */ }
  return false;
}

/**
 * Generate + atomically publish a fresh hybrid identity. Fail-closed on existing state, tamper, fault, or a
 * concurrent bind. Returns PUBLIC material only — never a seed or the phrase.
 */
export function bindHybridV2(homeDir: string, phrase: string, nowMs: number, opts?: BindHybridOpts): BindHybridVerdict {
  if (typeof phrase !== 'string' || phrase.trim().length === 0) return { ok: false, reason: 'a phrase is required' };
  const dir = keyDir(homeDir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (existingStateBlocks(homeDir)) return { ok: false, reason: 'a v1/v2 identity or partial bundle already exists here — refusing to overwrite (never a silent fallback)' };

  // ── exclusive bind lock: exactly one bind proceeds; a second one refuses rather than interleave ──
  let lockFd: number;
  try { lockFd = fs.openSync(lockPath(homeDir), 'wx', 0o600); }
  catch { return { ok: false, reason: 'another bind is in progress on this node' }; }

  const faults = opts?.faults ?? new Set<BindFault>();
  const staging = fs.mkdtempSync(path.join(dir, '.bindv2-'));
  let edSeed: Buffer | null = null;
  let mlSeed: Buffer | null = null;
  try {
    if (existingStateBlocks(homeDir) && fs.existsSync(bundleDir(homeDir))) return { ok: false, reason: 'already bound (raced)' }; // re-check under lock

    // ── independent seeds from the OS CSPRNG (the phrase derives neither) ──
    edSeed = randomBytes(32); mlSeed = randomBytes(32);
    const { root, publicKeys } = stageHybridBundleFiles(staging, phrase, nowMs, edSeed.toString('hex'), mlSeed.toString('hex'), 0);

    // ── FAULT INJECTION (test-only) ──
    if (faults.has('corruptEdSeed')) fs.writeFileSync(path.join(staging, F_ED_KEY), 'deadbeef');
    if (faults.has('corruptMlSeed')) fs.writeFileSync(path.join(staging, F_ML_KEY), 'ff'.repeat(32));
    if (faults.has('corruptManifest')) fs.writeFileSync(path.join(staging, F_ROOT), fs.readFileSync(path.join(staging, F_ROOT), 'utf-8').replace(/"integrity": "[0-9a-f]/, (m) => m.endsWith('0') ? '"integrity": "1' : '"integrity": "0'));
    if (faults.has('deleteMlKey')) fs.rmSync(path.join(staging, F_ML_KEY), { force: true });

    // ── VERIFY the complete bundle strictly from STAGED BYTES ──
    const v = verifyStagedBundle(staging, phrase);
    if (!v.ok) { cleanStaging(staging); return { ok: false, reason: v.reason }; }

    // a fault before the single publish boundary must leave NO destination bundle (unbound intact)
    if (faults.has('throwBeforePublish')) throw new Error('fault:throwBeforePublish');

    // ── PUBLISH: ONE same-filesystem atomic directory rename into the previously-absent bundle path ──
    try {
      fs.renameSync(staging, bundleDir(homeDir));
    } catch (e) {
      cleanStaging(staging);
      return { ok: false, reason: `publish failed — nothing committed (${(e as Error)?.message ?? 'error'})` }; // never swallowed as success
    }
    fsyncDir(dir); // the directory entry for the new bundle is durable

    return { ok: true, rootId: root.rootId, publicKeys, suite: AUMLOK_SUITE_V2, custody: AUMLOK_MODE_V2 };
  } catch (e) {
    cleanStaging(staging); // ANY fault before publish → unbound state EXACTLY intact, no destination partial
    return { ok: false, reason: `bind aborted before publish — unbound state intact (${(e as Error)?.message ?? 'error'})` };
  } finally {
    edSeed?.fill(0); mlSeed?.fill(0);
    try { fs.closeSync(lockFd); } catch { /* already closed */ }
    try { fs.rmSync(lockPath(homeDir), { force: true }); } catch { /* lock cleanup is best-effort */ }
  }
}

function cleanStaging(staging: string): void { try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* cosmetic */ } }

/**
 * The ONE writer of the bundle file shape (#361 Cycle C refactor): fresh bind AND key rotation both stage
 * through here, so the bundle layout can never drift between them. Writes all eight files durably into
 * `staging` from the given seed hexes and returns the PUBLIC root. `rotations` carries the fingerprint's
 * rotation count (0 on genesis; rotation bundles carry the incremented count). Seeds are the CALLER's to
 * zero; this function never logs or returns them.
 */
export function stageHybridBundleFiles(
  staging: string, phrase: string, nowMs: number, edSeedHex: string, mlSeedHex: string, rotations: number,
): { root: AuthorityRootV2; publicKeys: HybridPublicKeys } {
  const publicKeys: HybridPublicKeys = { ed25519: bytesToHex(ed25519.getPublicKey(Buffer.from(edSeedHex, 'hex'))), mlDsa65: pqcPublicKeyFromSeed(mlSeedHex) };
  const root: AuthorityRootV2 = pinAuthorityRootV2(publicKeys, { createdAt: new Date(nowMs).toISOString(), expiresAt: null });
  const manifestJson = JSON.stringify(root, null, 2) + '\n';
  const saltHex = randomBytes(16).toString('hex');
  const fingerprintJson = JSON.stringify({
    schema: 'aumlok-phrase-fingerprint-v2', kdf: 'scrypt', N: PHRASE_KDF.N, r: PHRASE_KDF.r, p: PHRASE_KDF.p,
    saltHex, hashHex: scryptHex(phrase, saltHex), updatedAt: new Date(nowMs).toISOString(), rotations,
  }, null, 2) + '\n';
  const receiptJson = JSON.stringify({
    schema: 'aumlok-binding-receipt-v2', suite: AUMLOK_SUITE_V2, custody: AUMLOK_MODE_V2,
    rootId: root.rootId, manifestIntegrity: root.integrity, boundAt: new Date(nowMs).toISOString(), drandAnchor: null,
  }, null, 2) + '\n';
  // the completion marker is part of the COMPLETE bundle, written into staging BEFORE publish (never after)
  const markerJson = JSON.stringify({ schema: 'aumlok-bind-commit-v2', rootId: root.rootId, committedAt: new Date(nowMs).toISOString(), grantsAuthority: false }, null, 2) + '\n';
  const staged: Array<[string, string, number]> = [
    [F_ED_KEY, edSeedHex, 0o600], [F_ML_KEY, mlSeedHex, 0o600],
    [F_ED_PUB, publicKeys.ed25519, 0o644], [F_ML_PUB, publicKeys.mlDsa65, 0o644],
    [F_ROOT, manifestJson, 0o644], [F_FP, fingerprintJson, 0o600], [F_RECEIPT, receiptJson, 0o644], [F_MARKER, markerJson, 0o600],
  ];
  for (const [name, data, mode] of staged) writeDurable(path.join(staging, name), data, mode);
  fsyncDir(staging);
  return { root, publicKeys };
}

/** The pre-publish gate, exported for the rotation installer (#361 Cycle C) — one gate, never a second
 *  drifting copy: full bundle coherence PLUS the typed phrase re-verifying against the staged fingerprint. */
export function verifyStagedHybridBundle(staging: string, phrase: string): { ok: true } | { ok: false; reason: string } {
  return verifyStagedBundle(staging, phrase);
}

/** The exclusive bind/rotation lock path — exported ONLY for the lifecycle installer, which must hold the
 *  same lock the binder holds so a bind and a rotation can never interleave. */
export function hybridLockPath(homeDir: string): string { return lockPath(homeDir); }

/** Constant-time compare of the typed phrase against the PUBLISHED bundle's scrypt fingerprint — the v2
 *  gesture gate for rotation/revocation ceremonies (#361 Cycle C). Verifies only; never writes. */
export function verifyPhraseAgainstBundleV2(homeDir: string, typedPhrase: string): boolean {
  try {
    const fp = JSON.parse(fs.readFileSync(path.join(bundleDir(homeDir), F_FP), 'utf-8'));
    if (fp?.schema !== 'aumlok-phrase-fingerprint-v2' || fp.kdf !== 'scrypt') return false;
    if (fp.N !== PHRASE_KDF.N || fp.r !== PHRASE_KDF.r || fp.p !== PHRASE_KDF.p) return false; // exact allowlist
    return safeEqualHex(scryptHex(typedPhrase, fp.saltHex), fp.hashHex);
  } catch { return false; }
}

/** The pre-publish gate: the SAME shared bundle coherence (seeds re-derive the pinned public root, marker
 *  + receipt bound) PLUS the typed phrase re-verifying against the staged scrypt fingerprint. Fail-closed. */
function verifyStagedBundle(staging: string, phrase: string): { ok: true } | { ok: false; reason: string } {
  const c = verifyBundleCoherence(staging);
  if (!c.ok) return { ok: false, reason: c.reason };
  try {
    const receipt = JSON.parse(fs.readFileSync(path.join(staging, F_RECEIPT), 'utf-8'));
    if (receipt?.suite !== AUMLOK_SUITE_V2 || receipt.custody !== AUMLOK_MODE_V2) return { ok: false, reason: 'staged genesis receipt suite/custody malformed' };
    const fp = JSON.parse(fs.readFileSync(path.join(staging, F_FP), 'utf-8'));
    if (fp?.schema !== 'aumlok-phrase-fingerprint-v2' || !safeEqualHex(scryptHex(phrase, fp.saltHex), fp.hashHex)) return { ok: false, reason: 'staged phrase fingerprint did not re-verify' };
    return { ok: true };
  } catch (e) { return { ok: false, reason: `staged phrase/receipt unreadable (${(e as Error)?.message ?? 'error'})` }; }
}
