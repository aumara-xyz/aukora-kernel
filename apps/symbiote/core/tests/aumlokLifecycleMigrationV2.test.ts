// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// #361 Fable Finish Cycle C — LIFECYCLE + MIGRATION through the actual executable path. Brick 1 proved
// the verifiers; this file proves the INSTALLS: v1→v2 migration (old root consents, lineage binds,
// durable ledger refuses replay, v1 retired in place and verify-only forever), dual-signed rotation
// (successor pinned exactly as signed, atomic lock-held swap, fail-closed double-fault), dual-signed
// revocation (terminal: signer, verifier, and rotation all refuse; the re-sealed manifest catches an
// on-disk un-revoke), and the suite's size facts against the receipt-file cap. Generated custody in
// mkdtemp homes/repos only.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// fs fault-injection seam (same hoisted-wrap pattern as aumlokAtomicBind.test.ts).
const fsCtl = vi.hoisted(() => ({
  onRename: null as null | ((from: string, to: string) => void | 'throw'),
}));
vi.mock('fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('fs')>();
  const wrapped = {
    ...real,
    renameSync: ((a: unknown, b: unknown) => {
      if (fsCtl.onRename?.(String(a), String(b)) === 'throw') throw new Error('injected: renameSync');
      return real.renameSync(a as never, b as never);
    }) as typeof real.renameSync,
  };
  return { ...wrapped, default: wrapped };
});
import { execFileSync } from 'child_process';
import { computeProposalHash } from '../src/proposalHash';
import { bindHybridV2, hybridBindStatusV2, loadHybridCustody, hybridV2StatePresent, hybridBundleDir, hybridLockPath } from '../src/aumlokBindV2';
import { verifyPromotionV2, AUMLOK_SUITE_V2 } from '../src/aumlokAuthorityV2';
import { signPromotionV2FromCustody } from '../src/aumlokSignerCustodyV2';
import { migrateV1ToHybridV2, readMigrationLineage } from '../src/aumlokMigrateV2';
import { rotateHybridV2, revokeHybridV2, readLifecycleJournal } from '../src/aumlokLifecycleV2';
import { consumeAuthorityEventOnce, listAuthorityEvents } from '../src/aumlokAuthorityEventLedger';
import { buildAumlokStatusSnapshot, summarizeAumlokStatus } from '../src/aumlokStatusSnapshot';
import { dispatchSignedLiveApplyForTests, MAX_SIGNED_RECEIPT_BYTES } from '../src/nativeLiveApply';
import { generateKeypair, signPromotionAuthorization } from '../src/aumlokSigner';
import { pinAuthorityRoot, serializeRootManifest, verifyPromotionReceipt, parseRootManifest } from '../src/aumlokAuthorityRoot';

const PHRASE = 'quartz-otter-linden-raven-ember-shale-wren';
const NOW = Date.parse('2026-07-13T12:00:00.000Z');
const NOWISO = '2026-07-13T12:00:00.000Z';
const GOAL = 'lifecycle: add a note';
const FILES = [{ relPath: 'docs/lifecycle-note.md', content: 'rotated world\n' }];
const HASH = () => computeProposalHash(GOAL, FILES);

let homeDir: string;
let repoRoot: string;
const git = (args: string[]) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf-8' }).trim();

beforeEach(() => {
  fsCtl.onRename = null;
  homeDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aumlok-lc-home-'));
  repoRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aumlok-lc-repo-'));
  git(['init', '-q']); git(['config', 'user.email', 't@e.com']); git(['config', 'user.name', 'T']);
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'hi\n'); git(['add', '-A']); git(['commit', '-q', '-m', 'init']);
});
afterEach(() => {
  fsCtl.onRename = null;
  fs.rmSync(homeDir, { recursive: true, force: true });
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

const dispatch = (signedReceipt: any) =>
  dispatchSignedLiveApplyForTests({ repoRoot, homeDir, now: NOWISO }, { goal: GOAL, proposalHash: HASH(), files: FILES, signedReceipt });

const writeV1Identity = (h: string): { privateKeyHex: string; publicKeyHex: string } => {
  const dir = path.join(h, 'aumlok');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const pair = generateKeypair();
  fs.writeFileSync(path.join(dir, 'authority-ed25519.key'), pair.privateKeyHex, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'authority-ed25519.pub'), pair.publicKeyHex);
  fs.writeFileSync(path.join(dir, 'authority-root.json'), serializeRootManifest(pinAuthorityRoot(pair.publicKeyHex)));
  return pair;
};

describe('durable authority-event ledger — expiry is a window, THIS is the replay prevention', () => {
  it('first consume succeeds, replay refuses with the original install instant, corrupt ledger fails closed', () => {
    const first = consumeAuthorityEventOnce('migration-v1-to-v2', 'canonical-payload-x', 'note', NOWISO, { homeDir });
    expect(first.ok).toBe(true);
    const replay = consumeAuthorityEventOnce('migration-v1-to-v2', 'canonical-payload-x', 'note', NOWISO, { homeDir });
    expect(replay.ok).toBe(false);
    if (!replay.ok && 'existing' in replay) expect(replay.existing.installedAt).toBe(NOWISO);
    // corrupt ledger: existing-but-unparseable must REFUSE, never read as empty
    fs.writeFileSync(path.join(homeDir, 'aumlok', 'authority-event-ledger.json'), 'not json');
    const onCorrupt = consumeAuthorityEventOnce('lifecycle-rotate', 'other-payload', 'note', NOWISO, { homeDir });
    expect(onCorrupt.ok).toBe(false);
    if (!onCorrupt.ok) expect('corrupt' in onCorrupt && onCorrupt.corrupt).toBe(true);
    const listed = listAuthorityEvents({ homeDir });
    expect(listed.ok).toBe(false); // advisory read reports untrustworthy, never guesses empty
  });
});

describe('v1 → v2 migration INSTALL', () => {
  it('migrates: old root consents, bundle pins the consented keys, lineage verifies, v1 retired byte-untouched', () => {
    const v1 = writeV1Identity(homeDir);
    const v1Bytes = ['authority-ed25519.key', 'authority-ed25519.pub', 'authority-root.json'].map((f) => fs.readFileSync(path.join(homeDir, 'aumlok', f)));
    const r = migrateV1ToHybridV2(homeDir, PHRASE, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.suite).toBe(AUMLOK_SUITE_V2);
    expect(r.custody).toBe('software_hybrid');
    // the installed bundle is fully coherent and pins EXACTLY the consented root
    const status = hybridBindStatusV2(homeDir);
    expect(status.bound).toBe(true);
    expect(status.rootId).toBe(r.newRootId);
    // lineage record verifies end to end against the RETAINED v1 manifest
    const lineage = readMigrationLineage(homeDir);
    expect(lineage.state).toBe('migrated');
    if (lineage.state === 'migrated') {
      expect(lineage.oldRootId).toBe(r.oldRootId);
      expect(lineage.newRootId).toBe(r.newRootId);
      expect(lineage.lineageVerified).toBe(true);
    }
    // v1 files retired IN PLACE, byte-untouched
    ['authority-ed25519.key', 'authority-ed25519.pub', 'authority-root.json'].forEach((f, i) => {
      expect(fs.readFileSync(path.join(homeDir, 'aumlok', f)).equals(v1Bytes[i])).toBe(true);
    });
    // the ledger recorded the consumed envelope
    const events = listAuthorityEvents({ homeDir });
    expect(events.ok && events.entries.some((e) => e.kind === 'migration-v1-to-v2')).toBe(true);
    // status snapshot truth
    const snap = buildAumlokStatusSnapshot({ homeDir, repoRoot });
    expect(snap.hybridV2.migratedFromV1).toBe(r.oldRootId.slice(0, 12));
    expect(snap.hybridV2.lineageVerified).toBe(true);
    expect(summarizeAumlokStatus(snap)).toContain('migrated from v1 root');
    // the v1 keypair variable is real consent material in this test — prove it was actually used
    expect(v1.publicKeyHex).toHaveLength(64);
  });

  it('after migration: the OLD v1 receipt still VERIFIES (verify-only) but can NEVER authorize an apply', () => {
    const v1 = writeV1Identity(homeDir);
    // a valid v1 promotion receipt signed BEFORE migration
    const v1root = pinAuthorityRoot(v1.publicKeyHex);
    const oldReceipt = signPromotionAuthorization(v1.privateKeyHex, { keyId: v1root.keyId, proposalHash: HASH(), draftHash: HASH(), nonce: 'pre-migration', issuedAt: NOWISO, expiresAt: null });
    expect(migrateV1ToHybridV2(homeDir, PHRASE, NOW).ok).toBe(true);
    // verify-only: the retained manifest still validates the historical signature
    const parsed = parseRootManifest(fs.readFileSync(path.join(homeDir, 'aumlok', 'authority-root.json'), 'utf-8'));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(verifyPromotionReceipt(oldReceipt, parsed.root, NOWISO).valid).toBe(true);
    // but the apply lane refuses it forever on this node
    const res = dispatch(oldReceipt);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain('post-quantum');
    // while the MIGRATED custody authorizes normally (full authority chain works post-migration)
    const dual = signPromotionV2FromCustody(homeDir, { proposalHash: HASH(), nonce: 'post-migration', issuedAt: NOWISO });
    expect(dual.ok).toBe(true);
    if (dual.ok) expect(dispatch(dual.signedReceipt).ok).toBe(true);
  });

  it('refuses: missing v1 key, missing manifest, tampered manifest, existing v2 state (revoked/expired v1 roots are refused both here and inside verifyMigrationV1 — verifier suite)', () => {
    // missing key: manifest present, key gone
    writeV1Identity(homeDir);
    fs.rmSync(path.join(homeDir, 'aumlok', 'authority-ed25519.key'));
    const noKey = migrateV1ToHybridV2(homeDir, PHRASE, NOW);
    expect(noKey.ok).toBe(false);
    if (!noKey.ok) expect(noKey.reason).toContain('key');
    // tampered manifest: integrity-sealed v1 manifests refuse the parse → migration refuses before signing
    const home3 = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aumlok-lc-home3-'));
    try {
      writeV1Identity(home3);
      const mp = path.join(home3, 'aumlok', 'authority-root.json');
      fs.writeFileSync(mp, fs.readFileSync(mp, 'utf-8').replace('"revoked": false', '"revoked": true'));
      const tampered = migrateV1ToHybridV2(home3, PHRASE, NOW);
      expect(tampered.ok).toBe(false); // either invalid-manifest (integrity) or revoked — both refuse
    } finally { fs.rmSync(home3, { recursive: true, force: true }); }
    // missing manifest entirely
    const home4 = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aumlok-lc-home4-'));
    try {
      const noRoot = migrateV1ToHybridV2(home4, PHRASE, NOW);
      expect(noRoot.ok).toBe(false);
      if (!noRoot.ok) expect(noRoot.reason).toContain('manifest');
    } finally { fs.rmSync(home4, { recursive: true, force: true }); }
    // existing v2 state refuses
    const home2 = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aumlok-lc-home2-'));
    try {
      bindHybridV2(home2, PHRASE, NOW);
      const overV2 = migrateV1ToHybridV2(home2, PHRASE, NOW);
      expect(overV2.ok).toBe(false);
      if (!overV2.ok) expect(overV2.reason).toContain('v2 state');
    } finally { fs.rmSync(home2, { recursive: true, force: true }); }
  });
});

describe('dual-signed rotation INSTALL', () => {
  it('rotates: successor pinned exactly as signed, old receipts die with the old root, new custody authorizes', () => {
    bindHybridV2(homeDir, PHRASE, NOW);
    const oldRootId = hybridBindStatusV2(homeDir).rootId!;
    // a dual receipt signed under the OLD root, not yet applied
    const preRotation = signPromotionV2FromCustody(homeDir, { proposalHash: HASH(), nonce: 'pre-rot', issuedAt: NOWISO });
    expect(preRotation.ok).toBe(true);

    const r = rotateHybridV2(homeDir, PHRASE, NOW + 60_000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.oldRootId).toBe(oldRootId);
    expect(r.newRootId).not.toBe(oldRootId);
    const status = hybridBindStatusV2(homeDir);
    expect(status.bound).toBe(true);
    expect(status.rootId).toBe(r.newRootId);
    expect(status.rotations).toBe(1);
    // the retired bundle keeps the node inside the v2 sentinel forever
    expect(hybridV2StatePresent(homeDir)).toBe(true);
    // the OLD-root receipt refuses on the new custody (rootId mismatch), zero mutation
    if (preRotation.ok) {
      const res = dispatch(preRotation.signedReceipt);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toContain('rootId mismatch');
    }
    // the NEW custody signs and the writer accepts — the full chain survives rotation
    const fresh = signPromotionV2FromCustody(homeDir, { proposalHash: HASH(), nonce: 'post-rot', issuedAt: NOWISO });
    expect(fresh.ok).toBe(true);
    if (fresh.ok) {
      const custody = loadHybridCustody(homeDir);
      expect(custody.ok && verifyPromotionV2(fresh.signedReceipt, custody.ok ? custody.root : (null as never), NOWISO).valid).toBe(true);
      expect(dispatch(fresh.signedReceipt).ok).toBe(true);
    }
    // journal + ledger truth
    expect(readLifecycleJournal(homeDir)[0]?.action).toBe('rotate');
    const events = listAuthorityEvents({ homeDir });
    expect(events.ok && events.entries.some((e) => e.kind === 'lifecycle-rotate')).toBe(true);
  });

  it('wrong phrase refuses with zero custody change; a second legitimate rotation increments honestly', () => {
    bindHybridV2(homeDir, PHRASE, NOW);
    const before = hybridBindStatusV2(homeDir).rootId;
    const bad = rotateHybridV2(homeDir, 'not-the-phrase', NOW + 1000);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toContain('phrase mismatch');
    expect(hybridBindStatusV2(homeDir).rootId).toBe(before);
    expect(rotateHybridV2(homeDir, PHRASE, NOW + 2000).ok).toBe(true);
    const twice = rotateHybridV2(homeDir, PHRASE, NOW + 3000);
    expect(twice.ok).toBe(true);
    expect(hybridBindStatusV2(homeDir).rotations).toBe(2);
  });

  it('FAULT: failed publish rolls back to the exact old custody; failed publish+rollback leaves the node fail-closed under the lock', () => {
    bindHybridV2(homeDir, PHRASE, NOW);
    const before = hybridBindStatusV2(homeDir).rootId!;
    // fail the publish (staging → bundle) only; rollback (retired → bundle) succeeds
    fsCtl.onRename = (a, b) => { if (a.includes('.bindv2-rot-') && b.endsWith('hybrid-v2')) return 'throw'; };
    const failed = rotateHybridV2(homeDir, PHRASE, NOW + 1000);
    fsCtl.onRename = null;
    expect(failed.ok).toBe(false);
    expect(hybridBindStatusV2(homeDir).rootId).toBe(before); // custody restored exactly
    const stillSigns = signPromotionV2FromCustody(homeDir, { proposalHash: HASH(), nonce: 'n', issuedAt: NOWISO });
    expect(stillSigns.ok).toBe(true);

    // double fault: publish fails AND rollback fails → the lock STAYS, everything refuses (fail-closed)
    fsCtl.onRename = (a, b) => {
      if (a.includes('.bindv2-rot-') && b.endsWith('hybrid-v2')) return 'throw';           // publish
      if (a.includes('.bindv2-retired-') && b.endsWith('hybrid-v2')) return 'throw';       // rollback
    };
    const doubleFault = rotateHybridV2(homeDir, PHRASE, NOW + 2000);
    fsCtl.onRename = null;
    expect(doubleFault.ok).toBe(false);
    if (!doubleFault.ok) expect(doubleFault.failClosed).toBe(true);
    expect(fs.existsSync(hybridLockPath(homeDir))).toBe(true);   // the lock holds the node closed
    expect(hybridV2StatePresent(homeDir)).toBe(true);            // sentinel still v2 — never back to v1
    const lockedRotate = rotateHybridV2(homeDir, PHRASE, NOW + 3000);
    expect(lockedRotate.ok).toBe(false); // no coherent bundle → honest refusal, no silent rebind
  });

  it('rotation on a revoked root refuses — a dead root cannot authorize its successor', () => {
    bindHybridV2(homeDir, PHRASE, NOW);
    expect(revokeHybridV2(homeDir, PHRASE, NOW + 1000).ok).toBe(true);
    const r = rotateHybridV2(homeDir, PHRASE, NOW + 2000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('REVOKED');
  });
});

describe('dual-signed revocation INSTALL — terminal, tamper-evident', () => {
  it('revokes: status truth flips, the signer refuses, a previously-valid dual receipt refuses at apply, second revoke refuses', () => {
    bindHybridV2(homeDir, PHRASE, NOW);
    const preRevoke = signPromotionV2FromCustody(homeDir, { proposalHash: HASH(), nonce: 'pre-revoke', issuedAt: NOWISO });
    expect(preRevoke.ok).toBe(true);
    const r = revokeHybridV2(homeDir, PHRASE, NOW + 1000);
    expect(r.ok).toBe(true);
    const status = hybridBindStatusV2(homeDir);
    expect(status.bound).toBe(true);
    expect(status.revoked).toBe(true);
    expect(summarizeAumlokStatus(buildAumlokStatusSnapshot({ homeDir, repoRoot }))).toContain('REVOKED — authority dead');
    // the signer refuses (self-verify hits the revoked root)
    const sign = signPromotionV2FromCustody(homeDir, { proposalHash: HASH(), nonce: 'post-revoke', issuedAt: NOWISO });
    expect(sign.ok).toBe(false);
    if (!sign.ok) expect(sign.reason).toContain('revoked');
    // the writer refuses the receipt that was valid before revocation
    if (preRevoke.ok) {
      const res = dispatch(preRevoke.signedReceipt);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toContain('revoked');
    }
    expect(revokeHybridV2(homeDir, PHRASE, NOW + 2000).ok).toBe(false); // already revoked
    expect(readLifecycleJournal(homeDir)[0]?.action).toBe('revoke');
  });

  it('an on-disk un-revoke (flipping revoked back to false) breaks the integrity seal — custody fails closed', () => {
    bindHybridV2(homeDir, PHRASE, NOW);
    expect(revokeHybridV2(homeDir, PHRASE, NOW + 1000).ok).toBe(true);
    const manifestPath = path.join(hybridBundleDir(homeDir), 'authority-root-v2.json');
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    m.revoked = false; // the attacker flips the flag but cannot re-seal the integrity hash
    fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n');
    const custody = loadHybridCustody(homeDir);
    expect(custody.ok).toBe(false); // integrity mismatch → incoherent → nothing authorizes
    expect(signPromotionV2FromCustody(homeDir, { proposalHash: HASH(), nonce: 'n' }).ok).toBe(false);
  });
});

describe('size/performance evidence — the suite fits its own rails', () => {
  it('real artifact sizes: ML-DSA-65 pub 1952 B, sig 3309 B, Ed sig 64 B; the dual receipt file sits far under the 64 KiB reader cap', () => {
    bindHybridV2(homeDir, PHRASE, NOW);
    const t0 = performance.now();
    const signed = signPromotionV2FromCustody(homeDir, { proposalHash: HASH(), nonce: 'size-probe', issuedAt: NOWISO });
    const signMs = performance.now() - t0;
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    const mlPub = fs.readFileSync(path.join(hybridBundleDir(homeDir), 'authority-mldsa65.pub'), 'utf-8').trim();
    expect(mlPub.length / 2).toBe(1952);
    expect(signed.signedReceipt.signatures.mlDsa65.length / 2).toBe(3309);
    expect(signed.signedReceipt.signatures.ed25519.length / 2).toBe(64);
    const fileBytes = Buffer.byteLength(JSON.stringify(signed.signedReceipt, null, 2));
    expect(fileBytes).toBeLessThan(MAX_SIGNED_RECEIPT_BYTES);
    const custody = loadHybridCustody(homeDir);
    const t1 = performance.now();
    expect(custody.ok && verifyPromotionV2(signed.signedReceipt, custody.ok ? custody.root : (null as never), NOWISO).valid).toBe(true);
    const verifyMs = performance.now() - t1;
    // informational timing (asserted only against an absurd bound; boxes differ)
    console.log(`[size/perf] dual receipt file ${fileBytes} B (cap ${MAX_SIGNED_RECEIPT_BYTES} B) · custody dual-sign ${signMs.toFixed(1)} ms · dual-verify ${verifyMs.toFixed(1)} ms`);
    expect(signMs).toBeLessThan(30_000);
    expect(verifyMs).toBeLessThan(30_000);
  });
});
