// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * AUMLOK hybrid-v2 KEY LIFECYCLE INSTALL — KEY rotation and revocation through the actual executable path
 * (#361 Fable Finish Cycle C; amended per Codex review B1/B2/B3). Brick 1 shipped the VERIFIER
 * (`verifyLifecycleV2`); this module makes the owner able to actually rotate/revoke, with the same law
 * everywhere: dual signature is the authority, the typed phrase gates the gesture, expiry bounds windows, and
 * the durable cross-process authority-event transaction is the replay prevention.
 *
 * WORDING (B3): `rotateHybridV2` is **KEY rotation**. It proves the CURRENT seven-word phrase and RE-PROVES
 * that SAME phrase into the successor bundle (fresh salt, retained phrase) — it does NOT change the phrase.
 * The separate ceremony that proves the current seven-word phrase then has the owner CHOOSE + CONFIRM a
 * DIFFERENT successor phrase (a "phrase refresh") does not exist yet and is an OWNER DECISION — never
 * conflated with key rotation, never invented here. Revoked-root recovery is likewise an owner decision.
 *
 * KEY ROTATE — executable order, every step fail-closed (amended: reserve → evidence-with-authority → commit):
 *   1. gesture gate: the typed phrase verifies against the CURRENT bundle's scrypt fingerprint;
 *   2. two fresh CSPRNG seeds → the successor's public pair;
 *   3. a `KeyLifecycleEventV2{action:'rotate', rootId:CURRENT, newPublicKeys}` is dual-signed by the CURRENT
 *      custody (signLifecycleV2FromCustody: coherence-gated, self-verified; a revoked/expired root refuses);
 *   4. RESERVE the canonical event (cross-process, replay-refusing). Any failure BEFORE the swap → ABORT;
 *   5. the successor staging bundle EMBEDS the signed event as `lifecycle-event-v2.json`, so the ONE atomic
 *      swap publishes the new custody AND its authorizing signed event together — a rotated bundle can never
 *      exist without the signed event that authorized it. Swap: current → `.bindv2-retired-<ts>` (a name the
 *      v2 sentinel matches forever, so no crash re-exposes a legacy root) → staging → bundle; a failed second
 *      rename ROLLS BACK; a failed rollback LEAVES THE LOCK (fail-closed);
 *   6. COMMIT the reservation; append the journal (best-effort history — the embedded event is the durable
 *      evidence). A crash between swap and commit leaves the install real and the row reserved;
 *      `reconcileLifecycleLedger` commits it deterministically from the embedded event.
 *
 * REVOKE — gesture gate + dual-signed `{action:'revoke', newPublicKeys:null}` + RESERVE, then EVIDENCE-FIRST
 * under the bundle lock: the signed revoke event is written durably (fsync) as `revoke-event-v2.json` BEFORE
 * the manifest is RE-SEALED `revoked:true` (revokeAuthorityRootV2 — `revoked` participates in the integrity
 * hash, so flipping it back on disk is caught). TERMINAL: signer refuses, verifier refuses, rotation refuses.
 * Revoked-root recovery is an OWNER-RULING path, never invented here.
 *
 * Human-side module (generates/touches seeds); not importable from any tool-call surface. Seeds are zeroed
 * after use, never returned, logged, or embedded in errors.
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import {
  verifyLifecycleV2, revokeAuthorityRootV2, displayFingerprintV2, canonicalLifecycleV2, rootIdV2,
  AUMLOK_SUITE_V2, AUMLOK_MODE_V2, type KeyLifecycleEventV2, type SignedLifecycleV2, type AuthorityRootV2,
} from './aumlokAuthorityV2';
import {
  hybridBundleDir, hybridLockPath, loadHybridCustody, verifyPhraseAgainstBundleV2, hybridBindStatusV2,
  stageHybridBundleFiles, verifyStagedHybridBundle,
} from './aumlokBindV2';
import { pqcPublicKeyFromSeed } from './crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { signLifecycleV2FromCustody } from './aumlokSignerCustodyV2';
import { reserveAuthorityEvent, commitAuthorityEvent, abortAuthorityEvent } from './aumlokAuthorityEventLedger';

const F_ROTATE_EVENT = 'lifecycle-event-v2.json';   // the signed event that authorized THIS (rotated) bundle
const F_REVOKE_EVENT = 'revoke-event-v2.json';      // the signed revoke event applied to THIS bundle

export type RotateVerdict =
  | { ok: true; oldRootId: string; newRootId: string; rotations: number; ledgerReconcilePending?: true }
  | { ok: false; reason: string; failClosed?: true };

export type RevokeVerdict =
  | { ok: true; rootId: string; ledgerReconcilePending?: true }
  | { ok: false; reason: string };

export function lifecycleJournalPath(homeDir: string): string {
  return path.join(homeDir, 'aumlok', 'lifecycle-journal.jsonl');
}

function writeDurable(p: string, data: string, mode: number): void {
  const fd = fs.openSync(p, 'w', mode);
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

/** Best-effort append of the signed event to the append-only journal (history). The embedded bundle event
 *  (rotate) / revoke-event file is the DURABLE authoritative evidence; this is convenience history only. */
function appendLifecycleJournal(homeDir: string, installedAt: string, signedEvent: SignedLifecycleV2, note: string): void {
  try {
    fs.appendFileSync(
      lifecycleJournalPath(homeDir),
      JSON.stringify({ schema: 'aumlok-lifecycle-journal-v1', installedAt, note, signedEvent }) + '\n',
      { mode: 0o600 },
    );
  } catch { /* the embedded/durable signed event is the authoritative evidence; history is best-effort */ }
}

/** Bounded newest-first read of the lifecycle journal — truth surfaces only, grants nothing. */
export function readLifecycleJournal(homeDir: string, limit = 20): Array<{ installedAt: string; note: string; action: string }> {
  try {
    return fs.readFileSync(lifecycleJournalPath(homeDir), 'utf-8').trim().split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((r): r is { installedAt: string; note: string; signedEvent: { event?: { action?: string } } } => !!r && typeof r.installedAt === 'string')
      .map((r) => ({ installedAt: r.installedAt, note: String(r.note ?? ''), action: String(r.signedEvent?.event?.action ?? 'unknown') }))
      .slice(-Math.max(1, Math.min(100, limit))).reverse();
  } catch { return []; }
}

function readEmbeddedSignedEvent(homeDir: string, fileName: string): SignedLifecycleV2 | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(hybridBundleDir(homeDir), fileName), 'utf-8'));
    return raw?.schema === 'aumlok-key-lifecycle-v2' && raw.event ? (raw as SignedLifecycleV2) : null;
  } catch { return null; }
}

/**
 * Deterministic recovery (B2): if a crash landed BETWEEN the authority swap/seal and the ledger commit, the
 * install is durable (bundle + embedded signed event) but its ledger row is still `reserved`. This recomputes
 * the canonical event hash from the DURABLE embedded evidence and commits the reservation. Commits ONLY when
 * the evidence provably matches the installed authority state; never re-applies a committed row, never mutates
 * a bundle. Called at each rotate/revoke entry and by status.
 */
export function reconcileLifecycleLedger(homeDir: string): void {
  try {
    const status = hybridBindStatusV2(homeDir);
    if (!status.bound || !status.rootId) return;
    // revoke recovery: a durable revoke event for THIS root + a sealed-revoked manifest → commit its reservation.
    if (status.revoked) {
      const rev = readEmbeddedSignedEvent(homeDir, F_REVOKE_EVENT);
      if (rev && rev.event.action === 'revoke' && rev.event.rootId === status.rootId) {
        commitAuthorityEvent(canonicalLifecycleV2(rev.event), status.rootId, { homeDir }); // idempotent; installedAt best-effort
      }
      return;
    }
    // rotate recovery: this bundle IS a rotation's successor (embedded event's newPublicKeys derive this root).
    const rot = readEmbeddedSignedEvent(homeDir, F_ROTATE_EVENT);
    if (rot && rot.event.action === 'rotate' && rot.event.newPublicKeys && rootIdV2(rot.event.newPublicKeys) === status.rootId) {
      commitAuthorityEvent(canonicalLifecycleV2(rot.event), status.rootId, { homeDir }); // idempotent
    }
  } catch { /* recovery is best-effort; enforcement paths remain fail-closed regardless */ }
}

/**
 * KEY-rotate this node's hybrid root to a freshly generated successor pair (B3: the phrase is RE-PROVEN and
 * RETAINED, not changed). The CURRENT root authorizes by dual signature; the typed phrase gates the gesture
 * and is re-fingerprinted (fresh salt, same phrase, rotations+1) into the successor bundle.
 */
export function rotateHybridV2(homeDir: string, typedPhrase: string, nowMs: number, reason = 'owner-initiated key rotation'): RotateVerdict {
  const now = new Date(nowMs).toISOString();
  reconcileLifecycleLedger(homeDir);
  const status = hybridBindStatusV2(homeDir);
  if (!status.bound) return { ok: false, reason: 'no coherent hybrid custody on this node — nothing to rotate' };
  if (status.revoked) return { ok: false, reason: 'this root is REVOKED — a dead root cannot authorize its successor; recovery of a revoked node is an owner-ruling path' };
  if (!verifyPhraseAgainstBundleV2(homeDir, typedPhrase)) return { ok: false, reason: 'phrase mismatch — key rotation refused (nothing changed)' };
  const custody = loadHybridCustody(homeDir);
  if (!custody.ok) return { ok: false, reason: `hybrid custody unavailable: ${custody.reason}` };
  const currentRoot: AuthorityRootV2 = custody.root;

  const edSeed = randomBytes(32); const mlSeed = randomBytes(32);
  try {
    const edSeedHex = edSeed.toString('hex');
    const mlSeedHex = mlSeed.toString('hex');
    const newPublicKeys = { ed25519: bytesToHex(ed25519.getPublicKey(edSeed)), mlDsa65: pqcPublicKeyFromSeed(mlSeedHex) };

    // dual-signed rotate event under the CURRENT root (self-verified; revoked/expired refuse inside).
    const event: KeyLifecycleEventV2 = { action: 'rotate', rootId: currentRoot.rootId, newPublicKeys, reason, issuedAt: now };
    const signed = signLifecycleV2FromCustody(homeDir, event);
    if (!signed.ok) return { ok: false, reason: signed.reason };
    const canonical = canonicalLifecycleV2(event);

    // RESERVE (cross-process, replay-refusing). Any failure before the swap → ABORT this reservation.
    const reserved = reserveAuthorityEvent('lifecycle-rotate', canonical, `key-rotate ${displayFingerprintV2(currentRoot.rootId)}… -> ${displayFingerprintV2(signed.rootId)}…`, now, { homeDir });
    if (!reserved.ok) return { ok: false, reason: `refusing to rotate — ${reserved.reason}` };

    const aum = path.join(homeDir, 'aumlok');
    let lockFd: number;
    try { lockFd = fs.openSync(hybridLockPath(homeDir), 'wx', 0o600); }
    catch { abortAuthorityEvent(canonical, 'bind/rotation lock busy', now, { homeDir }); return { ok: false, reason: 'another bind/rotation is in progress on this node' }; }
    const staging = fs.mkdtempSync(path.join(aum, '.bindv2-rot-'));
    const retired = path.join(aum, `.bindv2-retired-${new Date(nowMs).toISOString().replace(/[:.]/g, '')}-${randomBytes(4).toString('hex')}`);
    const priorRotations = status.rotations ?? 0;
    let published = false;
    let lockStays = false;
    try {
      const { root: newRoot } = stageHybridBundleFiles(staging, typedPhrase, nowMs, edSeedHex, mlSeedHex, priorRotations + 1);
      const gate = verifyStagedHybridBundle(staging, typedPhrase);
      if (!gate.ok) return { ok: false, reason: gate.reason };
      if (newRoot.publicKeys.ed25519 !== newPublicKeys.ed25519 || newRoot.publicKeys.mlDsa65 !== newPublicKeys.mlDsa65) {
        return { ok: false, reason: 'staged successor does not pin the signed newPublicKeys — refusing' };
      }
      // EMBED the signed event in the staging bundle so the swap publishes custody + evidence atomically.
      writeDurable(path.join(staging, F_ROTATE_EVENT), JSON.stringify(signed.signedEvent, null, 2) + '\n', 0o600);
      try { fs.renameSync(hybridBundleDir(homeDir), retired); }
      catch (e) { return { ok: false, reason: `could not retire the current bundle — nothing changed (${(e as Error)?.message ?? 'error'})` }; }
      try { fs.renameSync(staging, hybridBundleDir(homeDir)); }
      catch (e) {
        try { fs.renameSync(retired, hybridBundleDir(homeDir)); }
        catch {
          lockStays = true; // rollback ALSO failed — leave the lock; the sentinel fails the node closed
          abortAuthorityEvent(canonical, 'publish and rollback both failed (fail-closed)', now, { homeDir });
          return { ok: false, failClosed: true, reason: `key rotation publish AND rollback failed — the node is held FAIL-CLOSED by the bind lock; recover .bindv2-retired-* manually (${(e as Error)?.message ?? 'error'})` };
        }
        return { ok: false, reason: `key rotation publish failed — current custody restored, nothing changed (${(e as Error)?.message ?? 'error'})` };
      }
      published = true;
      // COMMIT the reservation now that the successor bundle (with embedded event) is durable.
      const committed = commitAuthorityEvent(canonical, now, { homeDir });
      appendLifecycleJournal(homeDir, now, signed.signedEvent, `key-rotated to ${displayFingerprintV2(newRoot.rootId)}…`);
      return committed.ok
        ? { ok: true, oldRootId: currentRoot.rootId, newRootId: newRoot.rootId, rotations: priorRotations + 1 }
        : { ok: true, oldRootId: currentRoot.rootId, newRootId: newRoot.rootId, rotations: priorRotations + 1, ledgerReconcilePending: true };
    } catch (e) {
      return { ok: false, reason: `key rotation aborted before publish — current custody intact (${(e as Error)?.message ?? 'error'})` };
    } finally {
      if (!published) { try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* disposable */ }
        if (!lockStays) abortAuthorityEvent(canonical, 'rotation did not publish', now, { homeDir }); }
      try { fs.closeSync(lockFd); } catch { /* already closed */ }
      if (!lockStays) { try { fs.rmSync(hybridLockPath(homeDir), { force: true }); } catch { /* best-effort */ } }
    }
  } finally {
    edSeed.fill(0); mlSeed.fill(0);
  }
}

/**
 * Revoke this node's hybrid root. Terminal for the root: after the manifest is re-sealed `revoked:true`, the
 * signer refuses to sign, the verifier refuses every receipt, and rotation refuses. The signed revoke event is
 * durable (fsync) BEFORE the seal, so the revocation can never take effect without its signed evidence.
 */
export function revokeHybridV2(homeDir: string, typedPhrase: string, nowMs: number, reason = 'owner-initiated revocation'): RevokeVerdict {
  const now = new Date(nowMs).toISOString();
  reconcileLifecycleLedger(homeDir);
  const status = hybridBindStatusV2(homeDir);
  if (!status.bound) return { ok: false, reason: 'no coherent hybrid custody on this node — nothing to revoke' };
  if (status.revoked) return { ok: false, reason: 'this root is already revoked' };
  if (!verifyPhraseAgainstBundleV2(homeDir, typedPhrase)) return { ok: false, reason: 'phrase mismatch — revocation refused (nothing changed)' };
  const custody = loadHybridCustody(homeDir);
  if (!custody.ok) return { ok: false, reason: `hybrid custody unavailable: ${custody.reason}` };
  const root = custody.root;

  const event: KeyLifecycleEventV2 = { action: 'revoke', rootId: root.rootId, newPublicKeys: null, reason, issuedAt: now };
  const signed = signLifecycleV2FromCustody(homeDir, event);
  if (!signed.ok) return { ok: false, reason: signed.reason };
  const verified = verifyLifecycleV2(signed.signedEvent, root, now); // belt on braces
  if (!verified.valid) return { ok: false, reason: `revocation event failed verification: ${verified.reason}` };
  const canonical = canonicalLifecycleV2(event);

  const reserved = reserveAuthorityEvent('lifecycle-revoke', canonical, `revoke ${displayFingerprintV2(root.rootId)}…`, now, { homeDir });
  if (!reserved.ok) return { ok: false, reason: `refusing to revoke — ${reserved.reason}` };

  let lockFd: number;
  try { lockFd = fs.openSync(hybridLockPath(homeDir), 'wx', 0o600); }
  catch { abortAuthorityEvent(canonical, 'bind/rotation lock busy', now, { homeDir }); return { ok: false, reason: 'another bind/rotation is in progress on this node' }; }
  const eventPath = path.join(hybridBundleDir(homeDir), F_REVOKE_EVENT);
  const manifestPath = path.join(hybridBundleDir(homeDir), 'authority-root-v2.json');
  let sealed = false;
  try {
    // EVIDENCE-FIRST: the signed revoke event is durable BEFORE the manifest is re-sealed.
    writeDurable(eventPath, JSON.stringify(signed.signedEvent, null, 2) + '\n', 0o600);
    const resealed = revokeAuthorityRootV2(root);
    const tmp = path.join(hybridBundleDir(homeDir), `.authority-root-v2.tmp-${process.pid}-${randomBytes(4).toString('hex')}`);
    writeDurable(tmp, JSON.stringify(resealed, null, 2) + '\n', 0o644);
    fs.renameSync(tmp, manifestPath); // atomic authority mutation — evidence already durable above
    sealed = true;
    const committed = commitAuthorityEvent(canonical, now, { homeDir });
    appendLifecycleJournal(homeDir, now, signed.signedEvent, `revoked ${displayFingerprintV2(root.rootId)}…`);
    return committed.ok ? { ok: true, rootId: root.rootId } : { ok: true, rootId: root.rootId, ledgerReconcilePending: true };
  } catch (e) {
    // reseal never happened → node NOT revoked (safe). Remove the orphan revoke event, abort the reservation.
    try { if (!sealed) fs.rmSync(eventPath, { force: true }); } catch { /* best-effort */ }
    abortAuthorityEvent(canonical, 'revocation seal failed', now, { homeDir });
    return { ok: false, reason: `revocation seal could not be written — manifest unchanged (${(e as Error)?.message ?? 'error'}); nothing was revoked` };
  } finally {
    try { fs.closeSync(lockFd); } catch { /* already closed */ }
    try { fs.rmSync(hybridLockPath(homeDir), { force: true }); } catch { /* best-effort */ }
  }
}
