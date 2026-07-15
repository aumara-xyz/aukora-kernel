// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * The AUMLOK BINDING CEREMONY kernel — the native (no-terminal) first-binding of a node to its owner,
 * per docs/SPEC_sovereign_ceremony.md + docs/AUMLOK_APP_CEREMONY_SPEC.md (owner-approved 2026-07-08:
 * "no terminal step" supersedes the spec's manual-start posture; the bind door runs only while UNBOUND).
 *
 * What the ceremony IS (the ratified shape):
 *   - The PHRASE is the human face of the key — it gates the owner's gesture. It is NEVER the key,
 *     never authenticates on its own, and only its SALTED FINGERPRINT is ever persisted.
 *   - The owner may RESHUFFLE the candidate phrase freely until it feels right (nothing is written
 *     until they type it back), then confirms by TYPING IT BACK — the deliberate act.
 *   - Completion generates the Ed25519 keypair via the SAME code the terminal ceremony uses
 *     (aumlokSigner.generateKeypair), writes it under the SAME custody (0700 dir, 0600 key,
 *     ~/.aukora-symbiote/aumlok/), pins the SAME root manifest, and writes a genesis binding receipt.
 *   - The private key is NEVER returned, serialized, or logged by any function here.
 *
 * Custody posture: like aumlokApproveCeremony.ts, this module touches key material server-side in a
 * HUMAN-SIDE door process only. The organism's lanes never import it (cohesion: same law as the signer).
 * PURE-ish: all paths flow from the injected homeDir; time is injected; the candidate store is caller-owned —
 * fully hermetic under test.
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { derivePublicKeyHex } from './aumlokSigner';
import { parseRootManifest } from './aumlokAuthorityRoot';
import { generateAcrosticPhrase } from './aumlokPhrase';
// #361 Fable Finish Cycle A: a FRESH node now binds the post-quantum HYBRID identity by default. The
// atomic dual-seed bind transaction is bindHybridV2 (Brick 2) — one proven implementation, reused, not
// copied. The ceremony keeps owning the human half (acrostic phrase, type-back, attempts, evidence).
import { bindHybridV2, hybridV2StatePresent, hybridBindStatusV2, hybridBundleDir } from './aumlokBindV2';
import { displayFingerprintV2 } from './aumlokAuthorityV2';

// Canonical-ceremony round (#242) + owner correction (#284 follow-up): the phrase is the owner's TRUE
// ACROSTIC (core/src/aumlokPhrase.ts) — a 6-letter anchor as WORD ZERO, then six themed words whose
// initials spell the anchor. All SEVEN words are shown, typed, and fingerprinted. Legacy shorter phrases
// still verify for the old-phrase proof during a first rotation; every NEW bind/rotate writes seven.
export const BIND_PHRASE_WORDS = 7;
export const BIND_CANDIDATE_TTL_MS = 10 * 60_000; // contemplative: time to write the phrase down in the physical world
export const BIND_MAX_ATTEMPTS = 3;               // typos happen; brute force does not get a fourth guess
export const ROTATE_VERIFY_MAX_ATTEMPTS = 5;      // guessing the standing phrase is lock-out territory
export const ROTATE_LOCK_MS = 15 * 60_000;

export type BindMode = 'bind' | 'rotate';
export interface BindCandidate {
  mode: BindMode;
  phrase: string;      // authoritative copy (normalized SEVEN words), in-memory only, dies with the door process
  anchor: string;      // word zero — the 6-letter anchor; shown AND typed AND fingerprinted
  words: string[];     // the six themed words (initials spell the anchor)
  tokens: string[];    // all SEVEN tokens for display: [anchor, ...words]
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  attemptsLeft: number;
}
/** One ceremony at a time — a loopback door serves one human. Caller (the door) owns the lifetime. */
export interface BindStore {
  candidate: BindCandidate | null;
  rotateAttemptsLeft: number;
  rotateLockedUntil: number;
}
export function freshBindStore(): BindStore {
  return { candidate: null, rotateAttemptsLeft: ROTATE_VERIFY_MAX_ATTEMPTS, rotateLockedUntil: 0 };
}

/** Owner cancel (candidate-lifecycle brick, 2026-07-11): revoke the in-memory candidate outright.
 *  A candidate is a PRE-commitment — revoking it changes nothing durable: fingerprint, key,
 *  lockout state, genesis base, and receipts are untouched, and the standing phrase keeps gating.
 *  Idempotent; the result is content-free. */
export function revokeBindCandidate(store: BindStore): { revoked: boolean } {
  const had = !!store.candidate;
  store.candidate = null; // the in-memory phrase dies here, not at process end
  return { revoked: had };
}

/** Liveness WITH the lazy reaper: an expired candidate is dead even if nobody ever tries to type
 *  it back — its in-memory phrase is cleared the moment anything looks. The complete path keeps
 *  its own expiry refusal; this makes expiry observable (and the memory clean) without waiting
 *  for a /complete attempt. */
export function candidateAlive(store: BindStore, nowMs: number): boolean {
  const c = store.candidate;
  if (c && nowMs > c.expiresAt) store.candidate = null;
  return !!store.candidate;
}

// ── paths (single source: mirror scripts/aumlok-authority.sh + aumlokApproveCeremony.aumlokKeyDir) ──
function keyDir(homeDir: string): string { return path.join(homeDir, 'aumlok'); }
function privPath(homeDir: string): string { return path.join(keyDir(homeDir), 'authority-ed25519.key'); }
function pubPath(homeDir: string): string { return path.join(keyDir(homeDir), 'authority-ed25519.pub'); }
function manifestPath(homeDir: string): string { return path.join(keyDir(homeDir), 'authority-root.json'); }
function fingerprintPath(homeDir: string): string { return path.join(keyDir(homeDir), 'phrase-fingerprint.json'); }
function bindingReceiptPath(homeDir: string): string { return path.join(keyDir(homeDir), 'binding-receipt.json'); }

export type BindPosture = 'unbound' | 'sovereign';

// ── the ATOMIC first-bind bundle (hardening brick, 2026-07-11) ───────────────────────────────────
// FIRST binding is one identity TRANSACTION: every artifact is staged in a private same-filesystem
// directory, validated by readback, then committed by renames with the PRIVATE KEY LAST and an
// explicit completion marker after everything. Posture is a claim about the WHOLE bundle — a
// private-key file alone is not an identity, and is never reported sovereign.
const BUNDLE_FILES = ['authority-ed25519.key', 'authority-ed25519.pub', 'authority-root.json', 'phrase-fingerprint.json', 'binding-receipt.json'] as const;
function stagingDir(homeDir: string): string { return path.join(keyDir(homeDir), '.bind-staging'); }
function markerPath(homeDir: string): string { return path.join(keyDir(homeDir), 'bind-complete.json'); }

/** Durable write: data reaches the disk, not just the page cache, before we move on. */
function writeDurable(filePath: string, data: string, mode: number): void {
  const fd = fs.openSync(filePath, 'w', mode);
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

/** Directory durability barrier (#340 review): the CREATE/RENAME metadata itself reaches disk.
 *  Filesystems that refuse directory fsync degrade gracefully — on those platforms this barrier
 *  is best-effort and the atomicity claim narrows to write-then-rename ordering. */
function fsyncDir(dirPath: string): void {
  try {
    const fd = fs.openSync(dirPath, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  } catch { /* graceful: ordering still holds; durability claim narrowed on this fs */ }
}

export type BindBundleState = 'absent' | 'complete' | 'complete-legacy' | 'partial';
export interface BindBundleClassification {
  state: BindBundleState;
  /** artifact FILENAMES only — content-free by construction */
  present: string[];
  missing: string[];
  /** a disposable, never-committed staging directory exists (safe to clean automatically) */
  staging: boolean;
  /** the completion marker exists (new-era binds; absent on healthy pre-marker bundles) */
  marker: boolean;
}

/** Classify the identity bundle — the ONE reader posture stands on. Coherence is checked cheaply
 *  and content-free: files exist, parse, and agree on the key identity. Anything less than the
 *  full agreeing set is PARTIAL — loud, preserved, and never sovereign. */
export function classifyBindBundle(homeDir: string): BindBundleClassification {
  // #361 Cycle A: ANY v2 hybrid state classifies on the v2 bundle FIRST. A coherent published bundle
  // (stored seeds re-derive the pinned root — verifyBundleCoherence via hybridBindStatusV2, never
  // manifest-alone) is COMPLETE/sovereign; any other v2 state (interrupted staging, held lock,
  // incoherent bundle) is PARTIAL — loud, preserved, and never auto-quarantined (the never-overwrite
  // gate below treats all v2 state as key material). Filenames only — content-free by construction.
  if (hybridV2StatePresent(homeDir)) {
    let v2present: string[] = [];
    try { v2present = fs.readdirSync(hybridBundleDir(homeDir)).sort().map((f) => `hybrid-v2/${f}`); } catch { /* staging/lock only */ }
    let v2staging = false;
    try { v2staging = fs.readdirSync(keyDir(homeDir)).some((e) => e.startsWith('.bindv2-')); } catch { /* none */ }
    const bound = hybridBindStatusV2(homeDir).bound;
    return { state: bound ? 'complete' : 'partial', present: v2present, missing: [], staging: v2staging, marker: bound };
  }
  const present: string[] = [];
  const missing: string[] = [];
  for (const f of BUNDLE_FILES) {
    try { if (fs.statSync(path.join(keyDir(homeDir), f)).isFile()) { present.push(f); continue; } } catch { /* absent */ }
    missing.push(f);
  }
  let staging = false;
  try { staging = fs.statSync(stagingDir(homeDir)).isDirectory(); } catch { /* none */ }
  let marker = false;
  try { marker = fs.statSync(markerPath(homeDir)).isFile(); } catch { /* none */ }
  if (present.length === 0) return { state: 'absent', present, missing, staging, marker };
  if (missing.length > 0) return { state: 'partial', present, missing, staging, marker };
  // all five exist — now they must PROVE one identity, not merely coexist (#340 review):
  // the private key must DERIVE the public key; the manifest must verify CANONICALLY
  // (integrity hash + key-id law, via its own parser) and pin that exact public key; the
  // fingerprint file's working hash must be NAMED by the receipt — as the genesis fingerprint
  // or as a recorded rotation (a rotated node's current hash lives in receipt.rotations[]).
  let coherentKeyId: string | null = null;
  try {
    const priv = fs.readFileSync(privPath(homeDir), 'utf-8').trim();
    const pub = fs.readFileSync(pubPath(homeDir), 'utf-8').trim();
    const manifest = parseRootManifest(fs.readFileSync(manifestPath(homeDir), 'utf-8'));
    const receipt = JSON.parse(fs.readFileSync(bindingReceiptPath(homeDir), 'utf-8'));
    const fp = readFingerprintAny(homeDir);
    let derivedPub = '';
    try { derivedPub = derivePublicKeyHex(priv); } catch { /* malformed key material → incoherent */ }
    const fpHash = fp.state === 'v2' ? fp.file.hashHex : fp.state === 'v1' ? fp.file.sha256Hex : null;
    const namedHashes: string[] = receipt?.schema === 'aumlok-binding-receipt-v1'
      ? [receipt.phraseFingerprintSha256, ...(Array.isArray(receipt.rotations) ? receipt.rotations.map((r: { phraseFingerprintSha256?: unknown }) => r?.phraseFingerprintSha256) : [])].filter((h): h is string => typeof h === 'string')
      : [];
    const coherent = /^[0-9a-f]{64}$/.test(pub)
      && derivedPub === pub
      && manifest.ok && manifest.root.publicKey === pub
      && receipt?.keyId === pub.slice(0, 12) && receipt?.publicKeyHex === pub
      && fpHash !== null && namedHashes.includes(fpHash);
    if (!coherent) return { state: 'partial', present, missing, staging, marker };
    coherentKeyId = receipt.keyId;
  } catch { return { state: 'partial', present, missing, staging, marker }; }
  // the marker must itself VALIDATE — a malformed marker is a missing marker, never a proof
  let markerValid = false;
  if (marker) {
    try {
      const m = JSON.parse(fs.readFileSync(markerPath(homeDir), 'utf-8'));
      markerValid = m?.schema === 'aumlok-bind-commit-v1'
        && m?.keyId === coherentKeyId
        && Number.isFinite(Date.parse(m?.committedAt));
    } catch { markerValid = false; }
  }
  return { state: markerValid ? 'complete' : 'complete-legacy', present, missing, staging, marker: markerValid };
}

/** Sovereign means a COMPLETE COMMITTED bundle — never merely that a private-key file exists.
 *  Healthy pre-marker bundles (every node bound before this brick) remain sovereign untouched. */
export function bindPosture(homeDir: string): BindPosture {
  const c = classifyBindBundle(homeDir);
  return c.state === 'complete' || c.state === 'complete-legacy' ? 'sovereign' : 'unbound';
}

/** The CEREMONY GATES' question is narrower than posture: does key material exist on disk?
 *  Rotation must stay reachable on a wounded-but-keyed bundle (so its precise refusals — tampered
 *  fingerprint, lockout — keep speaking), and bind must refuse whenever a key exists at all
 *  (the never-overwrite law). Posture stays the honest OBSERVER surface; these gates preserve
 *  behavior exactly. */
function keyMaterialPresent(homeDir: string): boolean {
  // #361 Cycle A, fail-closed: ANY v2 hybrid state (published bundle, interrupted staging, held lock)
  // may hold seed material — the never-overwrite law refuses over it and nothing auto-cleans it.
  if (hybridV2StatePresent(homeDir)) return true;
  try { return fs.statSync(privPath(homeDir)).isFile(); } catch { return false; }
}

/** Startup detection (atomic-bind brick): classify the bundle, clean ONLY disposable staging, and
 *  journal a LOUD content-free record when an interrupted/partial bundle is found. Never touches
 *  standing or partial identity artifacts — detection is not repair. */
export function classifyBindStartup(homeDir: string, nowMs: number): BindBundleClassification {
  const c = classifyBindBundle(homeDir);
  if (c.staging) cleanBindStaging(homeDir, nowMs);
  if (c.state === 'partial') appendCeremonyEvidence(homeDir, nowMs, 'bind_partial_detected');
  return c;
}

/** Clean ONLY the disposable staging directory (never-committed by definition). Returns whether
 *  anything was cleaned. Standing identity artifacts are never touched here. */
export function cleanBindStaging(homeDir: string, nowMs: number): boolean {
  try {
    if (!fs.statSync(stagingDir(homeDir)).isDirectory()) return false;
  } catch { return false; }
  fs.rmSync(stagingDir(homeDir), { recursive: true, force: true });
  appendCeremonyEvidence(homeDir, nowMs, 'bind_staging_cleaned');
  return true;
}

/** lowercase, trim, any run of spaces/underscores/dashes → one dash — so "Amber Otter" matches "amber-otter". */
export function normalizePhrase(s: string): string {
  return String(s ?? '').toLowerCase().trim().replace(/[\s_-]+/g, '-');
}

function saltedFingerprint(saltHex: string, phrase: string): string {
  return createHash('sha256').update(saltHex + '|' + normalizePhrase(phrase), 'utf-8').digest('hex');
}
function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf-8'); const bb = Buffer.from(b, 'utf-8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ── read-only status CORS (#284 follow-up) ───────────────────────────────────────────────────────
// The bound-node shell (:7090) reads GET /api/bind/status cross-origin to render Create/Rotate. Without
// an Access-Control-Allow-Origin the browser throws and the button reads "door isn't up". This permits
// EXACTLY the two shell origins, echoed only when they ARE the request Origin — no wildcard, no
// credentials, and `Vary: Origin` so a cache never leaks one origin's header to another. It is scoped to
// the STATUS read alone; the mint/rotate/complete mutation routes get NO CORS (same-origin iframe only).
export const BIND_STATUS_CORS_ORIGINS: readonly string[] = ['http://127.0.0.1:7090', 'http://localhost:7090'];
export function bindStatusCorsHeaders(
  origin: string | null | undefined,
  allowedOrigins: readonly string[] = BIND_STATUS_CORS_ORIGINS,
): Record<string, string> {
  const headers: Record<string, string> = { vary: 'Origin' };
  if (typeof origin === 'string' && allowedOrigins.includes(origin)) {
    headers['access-control-allow-origin'] = origin;
  }
  return headers;
}

// ── minting / reshuffling ────────────────────────────────────────────────────────────────────────
export type MintVerdict =
  | { ok: true; phrase: string; anchor: string; words: string[]; tokens: string[]; nonce: string; expiresAt: number }
  | { ok: false; reason: string };

/** Mint (or RESHUFFLE — same call, old candidate dies) the bind-ceremony phrase. Refuses on a bound node. */
export function mintBindCandidate(store: BindStore, homeDir: string, nowMs: number): MintVerdict {
  // never-overwrite law (unchanged in substance): ANY key material on disk refuses minting — with
  // the honest reason for a healthy bundle vs a wounded one.
  if (keyMaterialPresent(homeDir)) {
    if (bindPosture(homeDir) === 'sovereign') return { ok: false, reason: 'node already bound — rotation requires the current phrase' };
    appendCeremonyEvidence(homeDir, nowMs, 'bind_partial_refused_key_present');
    return { ok: false, reason: 'an interrupted binding with key material was found — refusing to touch it; the owner must resolve it deliberately' };
  }
  // Retry-convergence law (atomic-bind brick): an interrupted FRESH bind must converge to exactly
  // one valid identity. Disposable staging is cleaned automatically. A KEY-LESS partial (the only
  // partial the new commit order can leave) is QUARANTINED — moved, never deleted — loudly, then
  // the fresh bind proceeds. A partial that DOES hold key material is never touched automatically:
  // minting refuses loudly and the owner decides. Nothing here can ever replace standing identity.
  const c = classifyBindBundle(homeDir);
  if (c.staging) cleanBindStaging(homeDir, nowMs);
  if (c.state === 'partial') {
    // FAIL-CLOSED quarantine (#340 review): a collision-safe private directory; EVERY move must
    // succeed; the live bundle must reclassify ABSENT before a fresh bind may begin. A fresh
    // exclusive directory means no surviving artifact can ever be overwritten.
    const qDir = path.join(keyDir(homeDir), `quarantine-bind-${new Date(nowMs).toISOString().replace(/[:.]/g, '')}-${randomBytes(4).toString('hex')}`);
    try {
      fs.mkdirSync(qDir, { recursive: false, mode: 0o700 });
      const strays: string[] = [...c.present];
      try { if (fs.statSync(markerPath(homeDir)).isFile()) strays.push('bind-complete.json'); } catch { /* none */ }
      for (const f of strays) fs.renameSync(path.join(keyDir(homeDir), f), path.join(qDir, f)); // throws = refuse
    } catch {
      appendCeremonyEvidence(homeDir, nowMs, 'bind_partial_quarantine_failed');
      return { ok: false, reason: 'could not quarantine the interrupted binding — nothing was touched further; resolve it deliberately' };
    }
    if (classifyBindBundle(homeDir).state !== 'absent') {
      appendCeremonyEvidence(homeDir, nowMs, 'bind_partial_quarantine_failed');
      return { ok: false, reason: 'the interrupted binding did not clear — refusing to mint over it' };
    }
    appendCeremonyEvidence(homeDir, nowMs, 'bind_partial_quarantined');
  }
  return mint(store, 'bind', nowMs);
}

// ── durable rotation guard (Codex review fix, #284): the lockout must survive a door restart ─────
// Content-free by construction — attempt count + lock timestamp only; no phrase, no hashes, no key
// material. Strict custody (0600, 0700 dir). The kernel re-reads it on EVERY rotation attempt and
// merges the MOST RESTRICTIVE state with the in-memory store, so neither a process restart nor a
// stale store can hand out fresh guesses. Missing file = normal first run; a malformed file is
// ignored for state (the store still enforces) but every mutation rewrites it well-formed.
export function rotateGuardPath(homeDir: string): string { return path.join(keyDir(homeDir), 'rotate-guard.json'); }
function readRotateGuard(homeDir: string): { attemptsLeft: number; lockedUntil: number } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(rotateGuardPath(homeDir), 'utf-8'));
    if (raw?.schema !== 'aumlok-rotate-guard-v1') return null;
    if (!Number.isSafeInteger(raw.attemptsLeft) || raw.attemptsLeft < 1 || raw.attemptsLeft > ROTATE_VERIFY_MAX_ATTEMPTS) return null;
    if (!Number.isSafeInteger(raw.lockedUntil) || raw.lockedUntil < 0) return null;
    return { attemptsLeft: raw.attemptsLeft, lockedUntil: raw.lockedUntil };
  } catch { return null; }
}
function persistRotateGuard(homeDir: string, store: BindStore, nowMs: number): void {
  try {
    fs.mkdirSync(keyDir(homeDir), { recursive: true, mode: 0o700 });
    fs.writeFileSync(rotateGuardPath(homeDir), JSON.stringify({
      schema: 'aumlok-rotate-guard-v1',
      attemptsLeft: store.rotateAttemptsLeft,
      lockedUntil: store.rotateLockedUntil,
      updatedAt: new Date(nowMs).toISOString(),
      advisoryOnly: true, grantsAuthority: false,
    }, null, 2) + '\n', { mode: 0o600 });
  } catch { /* the in-memory store still enforces this process's lockout; the next mutation retries */ }
}
/** Merge the durable guard into a (possibly fresh) store — MOST RESTRICTIVE wins. The door calls this
 *  at boot; beginPhraseRotation also calls it per attempt, so restarts can never mint fresh guesses. */
export function loadRotateGuardIntoStore(store: BindStore, homeDir: string): void {
  const g = readRotateGuard(homeDir);
  if (!g) return;
  store.rotateLockedUntil = Math.max(store.rotateLockedUntil, g.lockedUntil);
  store.rotateAttemptsLeft = Math.min(store.rotateAttemptsLeft, g.attemptsLeft);
}

/** Begin a PHRASE ROTATION (owner feels the phrase is compromised): verify the CURRENT phrase first, then
 *  mint a fresh candidate. The key does not change — only the phrase that gates the owner's gesture. */
export function beginPhraseRotation(store: BindStore, homeDir: string, typedCurrentPhrase: string, nowMs: number): MintVerdict {
  // #361 Cycle A: v2 phrase rotation (rewriting the fingerprint INSIDE the published hybrid bundle) is
  // the lifecycle brick's design work — refuse honestly rather than write v1-shaped state beside a v2
  // identity. Nothing is changed by this refusal.
  if (hybridV2StatePresent(homeDir)) return { ok: false, reason: 'this node holds a post-quantum hybrid (v2) identity — phrase rotation for v2 arrives with the lifecycle brick; nothing was changed' };
  if (!keyMaterialPresent(homeDir)) return { ok: false, reason: 'node is unbound — nothing to rotate' };
  loadRotateGuardIntoStore(store, homeDir); // restart-proof: the durable guard is consulted EVERY attempt
  if (nowMs < store.rotateLockedUntil) return { ok: false, reason: 'rotation locked after repeated mismatches — try again later' };
  const read = readFingerprintAny(homeDir);
  if (read.state === 'absent') return { ok: false, reason: 'no phrase fingerprint on this node — rebind deliberately instead' };
  if (read.state === 'unrecognized') {
    // NEVER a silent reset: an unknown/corrupt fingerprint refuses loudly and the file is left untouched.
    appendCeremonyEvidence(homeDir, nowMs, 'rotate_refused_unrecognized_fingerprint');
    return { ok: false, reason: 'phrase fingerprint format is unrecognized — refusing to rotate (no silent reset); restore the file or rebind via the terminal ceremony' };
  }
  if (!verifyPhraseAgainstFingerprint(read, typedCurrentPhrase)) {
    store.rotateAttemptsLeft -= 1;
    if (store.rotateAttemptsLeft <= 0) {
      store.rotateLockedUntil = nowMs + ROTATE_LOCK_MS;
      store.rotateAttemptsLeft = ROTATE_VERIFY_MAX_ATTEMPTS;
      persistRotateGuard(homeDir, store, nowMs);
      appendCeremonyEvidence(homeDir, nowMs, 'rotate_locked');
      return { ok: false, reason: 'current phrase mismatch — rotation locked for a while' };
    }
    persistRotateGuard(homeDir, store, nowMs);
    appendCeremonyEvidence(homeDir, nowMs, 'rotate_refused_old_phrase');
    return { ok: false, reason: `current phrase mismatch (${store.rotateAttemptsLeft} tries left)` };
  }
  store.rotateAttemptsLeft = ROTATE_VERIFY_MAX_ATTEMPTS;
  persistRotateGuard(homeDir, store, nowMs);
  return mint(store, 'rotate', nowMs);
}

function mint(store: BindStore, mode: BindMode, nowMs: number): MintVerdict {
  const a = generateAcrosticPhrase();
  const c: BindCandidate = {
    mode,
    phrase: normalizePhrase(a.phrase), // canonical typed-back form: the SEVEN words (anchor + six)
    anchor: a.anchor,
    words: a.words,
    tokens: a.tokens,
    nonce: randomBytes(16).toString('hex'),
    issuedAt: nowMs,
    expiresAt: nowMs + BIND_CANDIDATE_TTL_MS,
    attemptsLeft: BIND_MAX_ATTEMPTS,
  };
  store.candidate = c; // reshuffle = replace: an abandoned phrase on a stale screen is already dead
  return { ok: true, phrase: c.phrase, anchor: c.anchor, words: c.words, tokens: c.tokens, nonce: c.nonce, expiresAt: c.expiresAt };
}

// ── legacy receipt recovery (#345) ───────────────────────────────────────────────────────────────
// The live finding: real nodes bound before the receipt era carry a coherent key + manifest +
// fingerprint but NO binding-receipt.json (and no marker). #340's honest classifier correctly
// calls that partial/unbound; fresh mint fails closed because key material exists. This ONE narrow
// ceremony restores the missing ADVISORY lineage — never key, never authority, never a forged
// history. The recovered bundle stays honestly `complete-legacy`.
function fileExists(p: string): boolean { try { return fs.statSync(p).isFile(); } catch { return false; } }

/** The exact recoverable shape (#345): coherent key+manifest+fingerprint, receipt AND marker
 *  absent, and NOTHING else off. Any deviation (receipt present, marker present, key/pub mismatch,
 *  tampered manifest, malformed fingerprint) → not recoverable. */
export function legacyRecoveryRequired(homeDir: string): boolean {
  if (!(fileExists(privPath(homeDir)) && fileExists(pubPath(homeDir)) && fileExists(manifestPath(homeDir)) && fileExists(fingerprintPath(homeDir)))) return false;
  if (fileExists(bindingReceiptPath(homeDir))) return false; // a receipt means it is NOT this shape
  if (fileExists(markerPath(homeDir))) return false;
  try {
    const priv = fs.readFileSync(privPath(homeDir), 'utf-8').trim();
    const pub = fs.readFileSync(pubPath(homeDir), 'utf-8').trim();
    if (!/^[0-9a-f]{64}$/.test(pub)) return false;
    let derived = ''; try { derived = derivePublicKeyHex(priv); } catch { return false; }
    if (derived !== pub) return false;
    const manifest = parseRootManifest(fs.readFileSync(manifestPath(homeDir), 'utf-8'));
    if (!manifest.ok || manifest.root.publicKey !== pub) return false;
    const fp = readFingerprintAny(homeDir);
    return fp.state === 'v1' || fp.state === 'v2';
  } catch { return false; }
}

export type RecoveryVerdict = { ok: true; keyId: string } | { ok: false; reason: string };

/** Restore the missing lineage receipt for the exact receiptless-legacy shape, under owner proof.
 *  Verifies key/manifest coherence and the current phrase (SAME lockout law as rotation), then
 *  writes ONLY an honest advisory recovery receipt atomically. Touches no key, pub, manifest,
 *  fingerprint, ledger, or disposition. Never forges an original timestamp or a bind marker;
 *  boundAt is the manifest's own integrity-protected createdAt (the instant the genesis base
 *  already derives from), so the standing Aura base stays byte-identical. Idempotent-refused once
 *  a receipt exists. */
export function recoverLegacyReceipt(store: BindStore, homeDir: string, typedCurrentPhrase: string, nowMs: number): RecoveryVerdict {
  if (fileExists(bindingReceiptPath(homeDir))) {
    appendCeremonyEvidence(homeDir, nowMs, 'legacy_recovery_refused_receipt_present');
    return { ok: false, reason: 'a binding receipt already stands on this node — recovery is not needed' };
  }
  if (!legacyRecoveryRequired(homeDir)) {
    appendCeremonyEvidence(homeDir, nowMs, 'legacy_recovery_refused_shape');
    return { ok: false, reason: 'this node is not a recoverable legacy identity — refusing to touch it' };
  }
  loadRotateGuardIntoStore(store, homeDir); // restart-proof durable guard, consulted every attempt
  if (nowMs < store.rotateLockedUntil) return { ok: false, reason: 'locked after repeated mismatches — try again later' };
  const read = readFingerprintAny(homeDir);
  if (read.state !== 'v1' && read.state !== 'v2') {
    appendCeremonyEvidence(homeDir, nowMs, 'legacy_recovery_refused_shape');
    return { ok: false, reason: 'phrase fingerprint unreadable — refusing to recover' };
  }
  if (!verifyPhraseAgainstFingerprint(read, typedCurrentPhrase)) {
    store.rotateAttemptsLeft -= 1;
    if (store.rotateAttemptsLeft <= 0) {
      store.rotateLockedUntil = nowMs + ROTATE_LOCK_MS;
      store.rotateAttemptsLeft = ROTATE_VERIFY_MAX_ATTEMPTS;
      persistRotateGuard(homeDir, store, nowMs);
      appendCeremonyEvidence(homeDir, nowMs, 'legacy_recovery_locked');
      return { ok: false, reason: 'current phrase mismatch — recovery locked for a while' };
    }
    persistRotateGuard(homeDir, store, nowMs);
    appendCeremonyEvidence(homeDir, nowMs, 'legacy_recovery_refused_old_phrase');
    return { ok: false, reason: `current phrase mismatch (${store.rotateAttemptsLeft} tries left)` };
  }
  store.rotateAttemptsLeft = ROTATE_VERIFY_MAX_ATTEMPTS;
  persistRotateGuard(homeDir, store, nowMs);

  const pub = fs.readFileSync(pubPath(homeDir), 'utf-8').trim();
  const manifest = parseRootManifest(fs.readFileSync(manifestPath(homeDir), 'utf-8'));
  if (!manifest.ok) return { ok: false, reason: 'authority manifest failed validation — refusing to recover' };
  const fpHash = read.state === 'v2' ? read.file.hashHex : read.file.sha256Hex;
  const receipt = {
    schema: 'aumlok-binding-receipt-v1',
    keyId: pub.slice(0, 12),
    publicKeyHex: pub,
    phraseFingerprintSha256: fpHash,
    // PROVENANCE (Codex review, #346): when original bind EVIDENCE is unavailable we do NOT claim an
    // observed original bind instant. `boundAt` carries the authority-root's createdAt SOLELY to keep
    // the pre-recovery AURA genesis fallback byte-identical — its source is named, and the true
    // original bind time is honestly null.
    boundAt: manifest.root.createdAt,
    advisoryOnly: true,
    grantsAuthority: false,
    note: 'lineage recovery — original bind evidence was unavailable; the owner proved the current phrase',
    recovery: {
      schema: 'aumlok-legacy-recovery-v1',
      originalBindEvidence: 'unavailable' as const,
      originalBoundAt: null,
      boundAtSource: 'authority_root_created_at_fallback' as const,
      recoveredAt: new Date(nowMs).toISOString(),
      forgedOriginalTimestamp: false as const,
      atomicMarkerWritten: false as const,
    },
    drandAnchor: null,
    rotations: [] as Array<{ at: string; phraseFingerprintSha256: string; drandAnchor?: unknown }>,
  };

  // SYMLINK-SAFE, NO-CLOBBER PUBLICATION (Codex review, #346): stage in an EXCLUSIVELY-created
  // private dir (mkdir fails if anything is already there — a pre-existing symlink can never be
  // followed), write with wx (exclusive create, never opening an existing target), then REVALIDATE
  // the exact eligible posture immediately before publish and refuse to clobber a receipt that
  // appeared meanwhile — its bytes are preserved untouched.
  const pubStage = path.join(keyDir(homeDir), `.recover-stage-${new Date(nowMs).toISOString().replace(/[:.]/g, '')}-${randomBytes(6).toString('hex')}`);
  try {
    fs.mkdirSync(pubStage, { recursive: false, mode: 0o700 }); // exclusive: throws on any pre-existing entry
    const stagedReceipt = path.join(pubStage, 'binding-receipt.json');
    const fd = fs.openSync(stagedReceipt, 'wx', 0o600); // wx: exclusive create — never follows a symlink
    try { fs.writeSync(fd, JSON.stringify(receipt, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fsyncDir(pubStage);
    // revalidate at the last instant: still the eligible shape, and no receipt has appeared
    if (fileExists(bindingReceiptPath(homeDir)) || !legacyRecoveryRequired(homeDir)) {
      fs.rmSync(pubStage, { recursive: true, force: true });
      appendCeremonyEvidence(homeDir, nowMs, 'legacy_recovery_refused_receipt_present');
      return { ok: false, reason: 'a receipt appeared or the node changed shape mid-recovery — refusing to overwrite; nothing was published' };
    }
    // PUBLISH is the SYSCALL ITSELF, no-clobber (Codex review, #346): hard-link the staged receipt
    // to the absent final path. linkSync fails EEXIST if ANYTHING is already there — so a competitor
    // that lands after the revalidation above (the last remaining race) can never be replaced, where
    // renameSync would have silently clobbered it. The link commits the ONE inode; staging is then
    // unlinked in the finally.
    try {
      fs.linkSync(stagedReceipt, bindingReceiptPath(homeDir));
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === 'EEXIST') {
        appendCeremonyEvidence(homeDir, nowMs, 'legacy_recovery_refused_receipt_present');
        return { ok: false, reason: 'a receipt appeared at the publish instant — refusing to overwrite; nothing was published' };
      }
      throw e;
    }
    fsyncDir(keyDir(homeDir));
  } finally {
    try { fs.rmSync(pubStage, { recursive: true, force: true }); } catch { /* recovery-owned staging only */ }
  }
  appendCeremonyEvidence(homeDir, nowMs, 'legacy_recovery_ok');
  return { ok: true, keyId: pub.slice(0, 12) };
}

// ── completion (the type-back) ───────────────────────────────────────────────────────────────────
export type CompleteVerdict =
  | { ok: true; mode: 'bind'; keyId: string; publicKeyHex: string; markerRepairNeeded?: true }
  | { ok: true; mode: 'rotate' }
  | { ok: false; reason: string; ceremonyDead: boolean };

/** The deliberate act: the owner types the phrase back. On success: bind → keygen under full custody +
 *  fingerprint + genesis receipt; rotate → new fingerprint + rotation entry. NEVER returns key material.
 *  `drandAnchor` (optional, advisory): a verified drand round record (core/src/drandAnchor.ts) folded
 *  into the receipt — external proof the binding existed no earlier than that round. Its absence is
 *  honest (unarmed/offline nodes); it never gates the ceremony. */
export function completeCeremony(store: BindStore, homeDir: string, typedPhrase: string, nonce: string, nowMs: number, drandAnchor?: unknown): CompleteVerdict {
  const c = store.candidate;
  if (!c) return { ok: false, reason: 'no live phrase — shuffle one first', ceremonyDead: true };
  if (nonce !== c.nonce) return { ok: false, reason: 'stale ceremony screen — shuffle a fresh phrase', ceremonyDead: true };
  if (nowMs > c.expiresAt) { store.candidate = null; return { ok: false, reason: 'the phrase expired — shuffle a fresh one', ceremonyDead: true }; }
  if (normalizePhrase(typedPhrase) !== c.phrase) {
    c.attemptsLeft -= 1;
    if (c.attemptsLeft <= 0) { store.candidate = null; return { ok: false, reason: 'three mismatches — the phrase died; shuffle a fresh one', ceremonyDead: true }; }
    return { ok: false, reason: `that is not the phrase (${c.attemptsLeft} tries left)`, ceremonyDead: false };
  }
  store.candidate = null; // single-use: consumed by the one correct type-back

  if (c.mode === 'rotate') {
    // Defense in depth (#361 Cycle A): beginPhraseRotation already refuses to MINT a rotate candidate on
    // a v2 node; this re-refusal guarantees no path ever writes a v1-shaped fingerprint beside v2 state.
    if (hybridV2StatePresent(homeDir)) return { ok: false, reason: 'this node holds a post-quantum hybrid (v2) identity — phrase rotation for v2 arrives with the lifecycle brick; nothing was changed', ceremonyDead: true };
    if (!keyMaterialPresent(homeDir)) return { ok: false, reason: 'node is unbound — nothing to rotate', ceremonyDead: true };
    writeFingerprintFile(homeDir, c.phrase, nowMs, /* rotation */ true, drandAnchor);
    appendCeremonyEvidence(homeDir, nowMs, 'rotate_ok');
    return { ok: true, mode: 'rotate' };
  }

  // mode 'bind' — #361 Fable Finish Cycle A: a FRESH node binds the post-quantum HYBRID identity by
  // default. The whole atomic transaction (two independent CSPRNG seeds, complete bundle staged →
  // verified-from-bytes → ONE atomic rename into a previously-absent path, exclusive lock, scrypt
  // phrase fingerprint, genesis receipt, completion marker) is bindHybridV2 (aumlokBindV2.ts, Brick 2)
  // — one proven implementation, reused, never a second copy here. The typed-back phrase gates this
  // gesture and is fingerprinted INSIDE the bundle; it still derives no key material. The v1
  // Ed25519-only bind path is gone from this ceremony: a fresh bind is hybrid or it is nothing —
  // never a silent classical fallback. Refuse-to-overwrite law unchanged (v1 AND v2 state both block).
  if (keyMaterialPresent(homeDir)) return { ok: false, reason: 'a key already exists on this node — refusing to overwrite', ceremonyDead: true };
  fs.mkdirSync(keyDir(homeDir), { recursive: true, mode: 0o700 });
  cleanBindStaging(homeDir, nowMs); // a dead earlier v1-era ceremony staging dir is disposable by definition

  const bound = bindHybridV2(homeDir, c.phrase, nowMs);
  if (!bound.ok) {
    appendCeremonyEvidence(homeDir, nowMs, 'bind_v2_refused');
    return { ok: false, reason: `hybrid bind refused — nothing was committed: ${bound.reason}`, ceremonyDead: true };
  }
  // drand anchor: JOURNAL-ONLY this cycle. The v2 genesis receipt is a CLOSED shape that pins
  // drandAnchor to null (aumlokBindV2.validateBindingReceiptShape); folding a verified round into it
  // is a deliberate closed-shape extension for a later brick, not a ceremony-side patch. The witnessed
  // round is preserved as content-free ceremony evidence so the proof-of-time is not silently dropped.
  if (drandAnchor) appendCeremonyEvidence(homeDir, nowMs, 'bind_drand_anchor_witnessed_v2');
  appendCeremonyEvidence(homeDir, nowMs, 'bind_ok_v2');
  // keyId is DISPLAY-ONLY (12-hex fingerprint of the FULL v2 root id — never selects or authorizes);
  // publicKeyHex carries the classical half for the door's existing display shape.
  return { ok: true, mode: 'bind', keyId: displayFingerprintV2(bound.rootId), publicKeyHex: bound.publicKeys.ed25519 };
}

// ── fingerprint file (salted hash only, 0600) — VERSIONED since the canonical-ceremony round ─────
// v1 (legacy): salted SHA-256. Still VERIFIES (a bound owner must never be locked out by an upgrade),
// but every write is v2. The migration is prove-then-upgrade: the first successful rotation proven
// against a v1 file persists v2. Unknown schemas refuse loudly — never a silent reset.
// v2: scrypt (memory-hard; node:crypto, no new deps). Params are recorded in the file so future
// changes stay verifiable against old files.
export const PHRASE_KDF_V2 = { N: 1 << 15, r: 8, p: 1, keyLen: 32, maxmem: 128 * 1024 * 1024 } as const;

interface FingerprintV1 { schema: 'aumlok-phrase-fingerprint-v1'; saltHex: string; sha256Hex: string; updatedAt: string; rotations: number }
interface FingerprintV2 { schema: 'aumlok-phrase-fingerprint-v2'; kdf: 'scrypt'; N: number; r: number; p: number; saltHex: string; hashHex: string; updatedAt: string; rotations: number }
type FingerprintRead =
  | { state: 'absent' }
  | { state: 'unrecognized' }
  | { state: 'v1'; file: FingerprintV1 }
  | { state: 'v2'; file: FingerprintV2 };

function readFingerprintAny(homeDir: string): FingerprintRead {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(fingerprintPath(homeDir), 'utf-8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return { state: 'absent' };
    return { state: 'unrecognized' }; // unreadable/corrupt is NOT absent — absence resets nothing either way
  }
  if (raw?.schema === 'aumlok-phrase-fingerprint-v1' && typeof raw.saltHex === 'string' && typeof raw.sha256Hex === 'string') {
    return { state: 'v1', file: raw as unknown as FingerprintV1 };
  }
  // Codex review fix (#284): v2 KDF parameters are an EXACT allowlist, never free-form integers —
  // a tampered file must not be able to weaken verification (tiny N) or memory-bomb it (huge N).
  // A future parameter change is a NEW schema version with its own explicit migration, not a loosening here.
  if (raw?.schema === 'aumlok-phrase-fingerprint-v2' && raw.kdf === 'scrypt'
      && typeof raw.saltHex === 'string' && typeof raw.hashHex === 'string'
      && raw.N === PHRASE_KDF_V2.N && raw.r === PHRASE_KDF_V2.r && raw.p === PHRASE_KDF_V2.p) {
    return { state: 'v2', file: raw as unknown as FingerprintV2 };
  }
  return { state: 'unrecognized' };
}

function scryptHex(phrase: string, saltHex: string, N: number, r: number, p: number): string {
  return scryptSync(normalizePhrase(phrase), Buffer.from(saltHex, 'hex'), PHRASE_KDF_V2.keyLen, { N, r, p, maxmem: PHRASE_KDF_V2.maxmem }).toString('hex');
}

function verifyPhraseAgainstFingerprint(read: FingerprintRead, typedPhrase: string): boolean {
  if (read.state === 'v1') return safeEqualHex(saltedFingerprint(read.file.saltHex, typedPhrase), read.file.sha256Hex);
  if (read.state === 'v2') return safeEqualHex(scryptHex(typedPhrase, read.file.saltHex, read.file.N, read.file.r, read.file.p), read.file.hashHex);
  return false;
}

function writeFingerprintFile(homeDir: string, phrase: string, nowMs: number, isRotation: boolean, drandAnchor?: unknown): string {
  const prior = readFingerprintAny(homeDir);
  const priorRotations = prior.state === 'v1' || prior.state === 'v2' ? prior.file.rotations ?? 0 : 0;
  const saltHex = randomBytes(16).toString('hex'); // fresh salt every write — old fingerprints tell nothing about the new phrase
  const hashHex = scryptHex(phrase, saltHex, PHRASE_KDF_V2.N, PHRASE_KDF_V2.r, PHRASE_KDF_V2.p);
  const file: FingerprintV2 = {
    schema: 'aumlok-phrase-fingerprint-v2',
    kdf: 'scrypt', N: PHRASE_KDF_V2.N, r: PHRASE_KDF_V2.r, p: PHRASE_KDF_V2.p,
    saltHex, hashHex,
    updatedAt: new Date(nowMs).toISOString(),
    rotations: priorRotations + (isRotation ? 1 : 0),
  };
  fs.mkdirSync(keyDir(homeDir), { recursive: true, mode: 0o700 });
  fs.writeFileSync(fingerprintPath(homeDir), JSON.stringify(file, null, 2) + '\n', { mode: 0o600 });
  if (prior.state === 'v1') appendCeremonyEvidence(homeDir, nowMs, 'fingerprint_migrated_v1_to_v2');
  if (isRotation) appendRotationToReceipt(homeDir, nowMs, hashHex, drandAnchor);
  return hashHex;
}

// ── durable ceremony evidence (append-only JSONL under aumlok/, 0600) ─────────────────────────────
// One line per ceremony event: bind/rotate success, old-phrase refusal, lockout, migration, and the
// unrecognized-format refusal. CONTENT-FREE by construction — no phrase, no fingerprint bytes, no
// key material — and advisory: evidence records what happened; it never authorizes anything.
export type CeremonyEvent =
  | 'bind_ok' | 'rotate_ok' | 'rotate_refused_old_phrase' | 'rotate_locked'
  | 'rotate_refused_unrecognized_fingerprint' | 'fingerprint_migrated_v1_to_v2'
  // atomic-bind brick: interrupted-state lifecycle — loud, content-free, advisory
  | 'bind_staging_cleaned' | 'bind_partial_detected' | 'bind_partial_quarantined' | 'bind_partial_refused_key_present'
  | 'bind_partial_quarantine_failed' | 'bind_marker_missing'
  // legacy-recovery brick (#345): lineage restoration — loud, content-free, advisory
  | 'legacy_recovery_ok' | 'legacy_recovery_refused_receipt_present' | 'legacy_recovery_refused_shape'
  | 'legacy_recovery_refused_old_phrase' | 'legacy_recovery_locked'
  // #361 Fable Finish Cycle A: hybrid-v2 bind lifecycle — loud, content-free, advisory
  | 'bind_ok_v2' | 'bind_v2_refused' | 'bind_drand_anchor_witnessed_v2';
export function ceremonyJournalPath(homeDir: string): string { return path.join(keyDir(homeDir), 'ceremony-journal.jsonl'); }
function appendCeremonyEvidence(homeDir: string, nowMs: number, event: CeremonyEvent): void {
  try {
    fs.mkdirSync(keyDir(homeDir), { recursive: true, mode: 0o700 });
    fs.appendFileSync(
      ceremonyJournalPath(homeDir),
      JSON.stringify({ schema: 'aumlok-ceremony-evidence-v1', at: new Date(nowMs).toISOString(), event, advisoryOnly: true, grantsAuthority: false }) + '\n',
      { mode: 0o600 },
    );
  } catch { /* evidence is best-effort; the ceremony verdict itself is never blocked by a journal write */ }
}
/** Bounded newest-first read of the ceremony journal (door status surfaces; tests). Read-only. */
export function readCeremonyEvidence(homeDir: string, limit = 20): Array<{ at: string; event: string }> {
  try {
    return fs.readFileSync(ceremonyJournalPath(homeDir), 'utf-8').trim().split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((r): r is { at: string; event: string } => !!r && typeof r.at === 'string' && typeof r.event === 'string')
      .slice(-Math.max(1, Math.min(100, limit))).reverse();
  } catch { return []; }
}
function appendRotationToReceipt(homeDir: string, nowMs: number, newFingerprint: string, drandAnchor?: unknown): void {
  try {
    const r = JSON.parse(fs.readFileSync(bindingReceiptPath(homeDir), 'utf-8'));
    if (!Array.isArray(r.rotations)) r.rotations = [];
    r.rotations.push({ at: new Date(nowMs).toISOString(), phraseFingerprintSha256: newFingerprint, ...(drandAnchor ? { drandAnchor } : {}) });
    fs.writeFileSync(bindingReceiptPath(homeDir), JSON.stringify(r, null, 2) + '\n', { mode: 0o600 });
  } catch { /* receipt append is best-effort; the fingerprint file is the working record */ }
}
