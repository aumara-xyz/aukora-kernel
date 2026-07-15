// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * AUMLOK v1→v2 MIGRATION INSTALL (#361 Fable Finish Cycle C; amended per Codex review B1/B2). The June
 * kernel's ML-DSA identity and the shell's Ed25519 authority converge here for EXISTING v1 nodes: the OLD
 * Ed25519 root CONSENTS by signature, the NEW ML-DSA-65 key proves possession, and only then is the hybrid
 * bundle installed — atomically, via the exact Brick-2 transaction fresh binds use.
 *
 * Executable order, every step fail-closed (amended: reserve → evidence-first → install → commit):
 *   1. HEALTHY v1 identity (valid manifest, not revoked/expired, strict-custody key) and NO v2 state;
 *   2. two fresh independent CSPRNG seeds (the phrase derives neither);
 *   3. sign the migration envelope (old Ed consent + new ML PoP over ONE canonical payload) and SELF-VERIFY
 *      with `verifyMigrationV1` against the TRUSTED on-disk v1 manifest — never the envelope's own claim;
 *   4. RESERVE the canonical payload in the durable cross-process authority-event ledger (replay refuses a
 *      reserved/committed/aborted row forever). On ANY failure BEFORE the bundle is published, the
 *      reservation is ABORTED so a known-failed attempt is never mistaken for an install;
 *   5. install inside the bundle lock, EVIDENCE-FIRST: the signed migration receipt is written durably
 *      (fsync) immediately BEFORE the single publish rename — so a migrated v2 bundle can never exist without
 *      its durable signed lineage. v1 files stay BYTE-UNTOUCHED, retired in place (the apply lane's v2
 *      sentinel makes them non-authorizing forever; historical v1 receipts remain VERIFY-ONLY);
 *   6. COMMIT the reservation (installedAt) once the bundle is durable. A crash BETWEEN publish and commit
 *      leaves the install real (bundle + receipt durable) and the row `reserved`; `reconcileMigrationLedger`
 *      deterministically commits it from the durable receipt.
 *
 * Human-side module: reads the old private key and generates seeds; not importable from any tool-call surface.
 * Seeds/keys never returned, logged, or embedded in errors. Custody stays `software_hybrid`.
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { parseRootManifest } from './aumlokAuthorityRoot';
import { signMigrationV1 } from './aumlokSignerV2';
import {
  verifyMigrationV1, canonicalMigrationV1, legacyRootIdV1, displayFingerprintV2,
  AUMLOK_SUITE_V2, AUMLOK_MODE_V2, type AuthorityMigrationV1,
} from './aumlokAuthorityV2';
import {
  hybridV2StatePresent, stageHybridBundleFiles, verifyStagedHybridBundle, hybridBundleDir, hybridLockPath,
  hybridBindStatusV2,
} from './aumlokBindV2';
import { reserveAuthorityEvent, commitAuthorityEvent, abortAuthorityEvent } from './aumlokAuthorityEventLedger';

const MIGRATION_WINDOW_MS = 10 * 60_000; // the envelope authorizes THIS install run, not a standing grant

export type MigrateVerdict =
  | { ok: true; oldRootId: string; newRootId: string; suite: typeof AUMLOK_SUITE_V2; custody: typeof AUMLOK_MODE_V2; ledgerReconcilePending?: true }
  | { ok: false; reason: string };

export function migrationReceiptPath(homeDir: string): string {
  return path.join(homeDir, 'aumlok', 'migration-receipt-v1.json');
}

function migrationReceiptJson(envelope: AuthorityMigrationV1, installedAt: string): string {
  return JSON.stringify({ schema: 'aumlok-migration-receipt-v1', installedAt, envelope }, null, 2) + '\n';
}

/** Strict-custody read of the v1 private key (regular file, no symlink, no group/other bits, 64-hex). */
function readV1KeyStrict(homeDir: string): { ok: true; key: string } | { ok: false; reason: string } {
  const p = path.join(homeDir, 'aumlok', 'authority-ed25519.key');
  let st: fs.Stats;
  try { st = fs.lstatSync(p); } catch { return { ok: false, reason: 'no v1 signing key present — nothing to migrate' }; }
  if (st.isSymbolicLink()) return { ok: false, reason: 'v1 signing key is a symlink — refused' };
  if (!st.isFile()) return { ok: false, reason: 'v1 signing key is not a regular file — refused' };
  if ((st.mode & 0o077) !== 0) return { ok: false, reason: `v1 signing key is group/world accessible (mode ${(st.mode & 0o777).toString(8)}) — refused` };
  const raw = fs.readFileSync(p, 'utf-8').trim();
  if (!/^[0-9a-f]{64}$/.test(raw.toLowerCase())) return { ok: false, reason: 'v1 signing key malformed — refused' };
  return { ok: true, key: raw.toLowerCase() };
}

/**
 * Migrate this node's v1 Ed25519 identity to the mandatory hybrid v2 suite. `phrase` becomes the NEW bundle's
 * gesture phrase (fingerprint only — it authorizes nothing; the old key's SIGNATURE is the consent). Returns
 * PUBLIC lineage only.
 */
export function migrateV1ToHybridV2(homeDir: string, phrase: string, nowMs: number): MigrateVerdict {
  if (typeof phrase !== 'string' || phrase.trim().length === 0) return { ok: false, reason: 'a phrase for the new hybrid bundle is required' };
  reconcileMigrationLedger(homeDir); // deterministic recovery of a prior crash-between-publish-and-commit

  // 1. fail-closed preconditions: healthy v1, zero v2 state.
  if (hybridV2StatePresent(homeDir)) return { ok: false, reason: 'this node already has v2 state — migration refuses (never overwrite, never repeat)' };
  let manifestJson: string;
  try { manifestJson = fs.readFileSync(path.join(homeDir, 'aumlok', 'authority-root.json'), 'utf-8'); }
  catch { return { ok: false, reason: 'no pinned v1 authority root manifest — nothing to migrate' }; }
  const parsed = parseRootManifest(manifestJson);
  if (!parsed.ok) return { ok: false, reason: `v1 authority root manifest invalid: ${parsed.reason}` };
  const trustedOldRoot = parsed.root;
  const now = new Date(nowMs).toISOString();
  if (trustedOldRoot.revoked) return { ok: false, reason: 'v1 root is revoked — a dead root cannot consent to migration' };
  if (trustedOldRoot.expiresAt && now > trustedOldRoot.expiresAt) return { ok: false, reason: 'v1 root is expired — a dead root cannot consent to migration' };
  const oldKey = readV1KeyStrict(homeDir);
  if (!oldKey.ok) return { ok: false, reason: oldKey.reason };

  // 2. fresh independent seeds (the phrase derives neither).
  const edSeed = randomBytes(32); const mlSeed = randomBytes(32);
  try {
    const edSeedHex = edSeed.toString('hex');
    const mlSeedHex = mlSeed.toString('hex');

    // 3. build + sign the envelope; SELF-VERIFY against the TRUSTED on-disk v1 root.
    let envelope: AuthorityMigrationV1;
    try {
      envelope = signMigrationV1({
        oldEdSeedHex: oldKey.key, newEdSeedHex: edSeedHex, newMlSeedHex: mlSeedHex,
        nonce: `migrate-${nowMs}-${randomBytes(8).toString('hex')}`,
        issuedAt: now, expiresAt: new Date(nowMs + MIGRATION_WINDOW_MS).toISOString(),
      });
    } catch {
      return { ok: false, reason: 'migration envelope could not be signed (keys never included in this error)' };
    }
    const verified = verifyMigrationV1(envelope, trustedOldRoot, now);
    if (!verified.valid) return { ok: false, reason: `migration self-verification failed: ${verified.reason}` };

    const canonical = canonicalMigrationV1(envelope);
    const note = `oldRoot ${displayFingerprintV2(envelope.oldRootId)}… -> newRoot ${displayFingerprintV2(envelope.newRootId)}…`;

    // 4. RESERVE (cross-process, replay-refusing). ANY failure before publish → ABORT this reservation.
    const reserved = reserveAuthorityEvent('migration-v1-to-v2', canonical, note, now, { homeDir });
    if (!reserved.ok) {
      return { ok: false, reason: reserved.corrupt ? `authority-event ledger cannot be trusted — refusing to install: ${reserved.reason}`
        : reserved.busy ? `refusing to install — ${reserved.reason}`
        : `refusing to install — ${reserved.reason}` };
    }

    // 5. EVIDENCE-FIRST install inside the bundle lock: the signed receipt is durable BEFORE the publish rename.
    const installed = installMigratedBundle(homeDir, phrase, nowMs, edSeedHex, mlSeedHex, envelope, now);
    if (!installed.ok) {
      abortAuthorityEvent(canonical, `install failed: ${installed.reason}`.slice(0, 200), now, { homeDir });
      return { ok: false, reason: installed.reason };
    }

    // 6. COMMIT once the bundle + receipt are durable. A commit failure here leaves the install REAL and the
    //    row reserved; reconcile fixes it. Never abort after a successful publish.
    const committed = commitAuthorityEvent(canonical, now, { homeDir });
    return committed.ok
      ? { ok: true, oldRootId: envelope.oldRootId, newRootId: envelope.newRootId, suite: AUMLOK_SUITE_V2, custody: AUMLOK_MODE_V2 }
      : { ok: true, oldRootId: envelope.oldRootId, newRootId: envelope.newRootId, suite: AUMLOK_SUITE_V2, custody: AUMLOK_MODE_V2, ledgerReconcilePending: true };
  } finally {
    edSeed.fill(0); mlSeed.fill(0);
  }
}

/** Install the hybrid bundle from the EXACT consented seeds, evidence-first, inside the bundle lock:
 *  stage → verify → cross-check the consented rootId → write the signed receipt durably (fsync) → publish
 *  by ONE atomic rename. The receipt lives OUTSIDE the bundle (so it survives later rotations) but is written
 *  strictly before the publish, so a migrated bundle can never exist without its durable lineage. */
function installMigratedBundle(
  homeDir: string, phrase: string, nowMs: number, edSeedHex: string, mlSeedHex: string,
  envelope: AuthorityMigrationV1, installedAt: string,
): { ok: true; rootId: string } | { ok: false; reason: string } {
  const aum = path.join(homeDir, 'aumlok');
  fs.mkdirSync(aum, { recursive: true, mode: 0o700 });
  let lockFd: number;
  try { lockFd = fs.openSync(hybridLockPath(homeDir), 'wx', 0o600); }
  catch { return { ok: false, reason: 'another bind/rotation is in progress on this node' }; }
  const staging = fs.mkdtempSync(path.join(aum, '.bindv2-'));
  let receiptWritten = false;
  try {
    if (fs.existsSync(hybridBundleDir(homeDir))) return { ok: false, reason: 'v2 bundle appeared mid-migration (raced) — refusing' };
    const { root } = stageHybridBundleFiles(staging, phrase, nowMs, edSeedHex, mlSeedHex, 0);
    const gate = verifyStagedHybridBundle(staging, phrase);
    if (!gate.ok) return { ok: false, reason: gate.reason };
    // the installed bundle must pin EXACTLY the keys the old root consented to — check BEFORE any publish.
    if (root.rootId !== envelope.newRootId) return { ok: false, reason: 'staged root does not match the consented newRootId — refusing (nothing published)' };
    // EVIDENCE-FIRST: the signed receipt is durable before the authority state (bundle) is published.
    writeDurable(migrationReceiptPath(homeDir), migrationReceiptJson(envelope, installedAt), 0o600);
    receiptWritten = true;
    try { fs.renameSync(staging, hybridBundleDir(homeDir)); }
    catch (e) { return { ok: false, reason: `publish failed — nothing committed (${(e as Error)?.message ?? 'error'})` }; }
    return { ok: true, rootId: root.rootId };
  } catch (e) {
    return { ok: false, reason: `migration install aborted before publish — v1 identity intact (${(e as Error)?.message ?? 'error'})` };
  } finally {
    // if we wrote the receipt but did NOT publish (bundle absent), remove the orphan so status/retry stay clean.
    try { if (receiptWritten && !fs.existsSync(hybridBundleDir(homeDir))) fs.rmSync(migrationReceiptPath(homeDir), { force: true }); } catch { /* best-effort */ }
    try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* disposable */ }
    try { fs.closeSync(lockFd); } catch { /* already closed */ }
    try { fs.rmSync(hybridLockPath(homeDir), { force: true }); } catch { /* best-effort */ }
  }
}

function writeDurable(p: string, data: string, mode: number): void {
  const fd = fs.openSync(p, 'w', mode);
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

/**
 * Deterministic recovery (B2): if a coherent v2 bundle is installed AND a durable migration receipt names it,
 * but the authority-event row is still `reserved` (a crash between publish and commit), commit the reservation
 * from the durable receipt. Idempotent and safe — commits ONLY a reserved row whose install is provably durable;
 * never re-applies a committed row, never touches a bundle. Called at each migration entry and by status/list.
 */
export function reconcileMigrationLedger(homeDir: string): void {
  try {
    if (!hybridBindStatusV2(homeDir).bound) return;                 // no coherent install → nothing to recover
    const lineage = readMigrationLineageRaw(homeDir);
    if (lineage.state !== 'migrated') return;                        // no durable receipt → nothing to recover
    if (hybridBindStatusV2(homeDir).rootId !== lineage.newRootId) return; // receipt must name the installed root
    commitAuthorityEvent(canonicalMigrationV1(lineage.envelope), lineage.installedAt, { homeDir }); // idempotent
  } catch { /* recovery is best-effort; the enforcement paths remain fail-closed regardless */ }
}

type LineageRaw =
  | { state: 'none' }
  | { state: 'invalid'; reason: string }
  | { state: 'migrated'; envelope: AuthorityMigrationV1; installedAt: string; oldRootId: string; newRootId: string };

function readMigrationLineageRaw(homeDir: string): LineageRaw {
  let raw: any;
  try { raw = JSON.parse(fs.readFileSync(migrationReceiptPath(homeDir), 'utf-8')); }
  catch (e) { return (e as NodeJS.ErrnoException)?.code === 'ENOENT' ? { state: 'none' } : { state: 'invalid', reason: 'migration receipt unreadable' }; }
  if (raw?.schema !== 'aumlok-migration-receipt-v1' || !raw.envelope || typeof raw.installedAt !== 'string') return { state: 'invalid', reason: 'migration receipt malformed' };
  const envelope = raw.envelope as AuthorityMigrationV1;
  return { state: 'migrated', envelope, installedAt: raw.installedAt, oldRootId: String(envelope.oldRootId ?? ''), newRootId: String(envelope.newRootId ?? '') };
}

/** Read + fully re-verify the persisted migration lineage (advisory truth surface). The envelope is
 *  re-verified against the RETAINED v1 manifest with `now` pinned to its own issuedAt — signatures and
 *  bindings are fully checked; only the (long-past) install window is not re-imposed on history. */
export function readMigrationLineage(homeDir: string): { state: 'none' } | { state: 'invalid'; reason: string } | { state: 'migrated'; oldRootId: string; newRootId: string; installedAt: string; lineageVerified: boolean } {
  const raw = readMigrationLineageRaw(homeDir);
  if (raw.state !== 'migrated') return raw;
  const { envelope } = raw;
  let lineageVerified = false;
  try {
    const parsed = parseRootManifest(fs.readFileSync(path.join(homeDir, 'aumlok', 'authority-root.json'), 'utf-8'));
    if (parsed.ok && envelope.oldRootId === legacyRootIdV1(parsed.root.publicKey)) {
      lineageVerified = verifyMigrationV1(envelope, parsed.root, envelope.issuedAt).valid;
    }
  } catch { /* retained v1 manifest unreadable — lineage stays unverified, reported honestly */ }
  return { state: 'migrated', oldRootId: raw.oldRootId, newRootId: raw.newRootId, installedAt: raw.installedAt, lineageVerified };
}
