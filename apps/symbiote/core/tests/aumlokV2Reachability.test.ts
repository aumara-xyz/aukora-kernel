// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// #361 Fable Finish Cycle A — SEAM REACHABILITY. Brick 1-3 proved the v2 verifier/bind/writer; this file
// proves the OWNER can actually reach them: fresh ceremony bind is hybrid-by-default, the door and the
// custody signer produce dual receipts the writer accepts, status surfaces tell the truth, and every
// refusal path fails closed (incoherent custody, symlinked seed, v1-beside-v2, rotate-on-v2). All runs use
// generated test custody in mkdtemp homes/repos — no live node, no real phrase, no real key is touched.
// The door's production apply entrypoint still targets the real repo and stays untestable by design
// (aumlokApproveCeremony.test.ts documents that posture); the extracted signing seam is proven here and
// its output is driven through the REAL confined reader + the test dispatcher end to end.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { computeProposalHash } from '../src/proposalHash';
import { bindHybridV2, hybridBindStatusV2, loadHybridCustody, hybridV2StatePresent, hybridBundleDir } from '../src/aumlokBindV2';
import { verifyPromotionV2, AUMLOK_SUITE_V2, AUMLOK_MODE_V2 } from '../src/aumlokAuthorityV2';
import { signPromotionV2FromCustody } from '../src/aumlokSignerCustodyV2';
import { signProposalHashForApproval, aumlokKeyStatus } from '../src/aumlokApproveCeremony';
import { freshBindStore, mintBindCandidate, completeCeremony, beginPhraseRotation, classifyBindBundle, bindPosture } from '../src/aumlokBindCeremony';
import { buildAumlokStatusSnapshot, summarizeAumlokStatus } from '../src/aumlokStatusSnapshot';
import { dispatchSignedLiveApplyForTests, readSignedPromotionReceiptFromFile } from '../src/nativeLiveApply';
import { generateKeypair } from '../src/aumlokSigner';
import { pinAuthorityRoot, serializeRootManifest } from '../src/aumlokAuthorityRoot';

const PHRASE = 'harbor otter maple river bison ember rowan';
const NOW = Date.parse('2026-07-13T12:00:00.000Z');
const GOAL = 'apply a reachability note';
const FILES = [{ relPath: 'docs/reach-v2.md', content: 'seam-proof content\n' }];
const HASH = () => computeProposalHash(GOAL, FILES);

let homeDir: string;
let repoRoot: string;
const git = (args: string[]) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf-8' }).trim();
const head = () => git(['rev-parse', 'HEAD']);

beforeEach(() => {
  homeDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-reach-home-'));
  repoRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-reach-repo-'));
  git(['init', '-q']); git(['config', 'user.email', 't@e.com']); git(['config', 'user.name', 'T']);
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'hi\n'); git(['add', '-A']); git(['commit', '-q', '-m', 'init']);
});
afterEach(() => {
  fs.rmSync(homeDir, { recursive: true, force: true });
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

const dispatch = (signedReceipt: any) =>
  dispatchSignedLiveApplyForTests({ repoRoot, homeDir, now: '2026-07-13T12:00:00.000Z' }, { goal: GOAL, proposalHash: HASH(), files: FILES, signedReceipt });

const writeV1Identity = (h: string) => {
  const dir = path.join(h, 'aumlok');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const { privateKeyHex, publicKeyHex } = generateKeypair();
  fs.writeFileSync(path.join(dir, 'authority-ed25519.key'), privateKeyHex, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'authority-ed25519.pub'), publicKeyHex);
  fs.writeFileSync(path.join(dir, 'authority-root.json'), serializeRootManifest(pinAuthorityRoot(publicKeyHex)));
};

describe('seam 1 — fresh bind through the CEREMONY is hybrid v2 by default and atomic', () => {
  it('mint → type-back → coherent v2 bundle; NO v1 key material is created', () => {
    const store = freshBindStore();
    const mint = mintBindCandidate(store, homeDir, NOW);
    expect(mint.ok).toBe(true);
    if (!mint.ok) return;
    const done = completeCeremony(store, homeDir, mint.phrase, mint.nonce, NOW);
    expect(done.ok).toBe(true);
    if (!done.ok || done.mode !== 'bind') return;
    // the published bundle passes FULL custody coherence (seeds re-derive the pinned root)
    const status = hybridBindStatusV2(homeDir);
    expect(status.bound).toBe(true);
    expect(status.suite).toBe(AUMLOK_SUITE_V2);
    expect(status.custody).toBe(AUMLOK_MODE_V2);
    // display fields: 12-hex fingerprint of the FULL root id + the classical public half
    expect(done.keyId).toBe(status.rootId!.slice(0, 12));
    expect(done.publicKeyHex).toBe(fs.readFileSync(path.join(hybridBundleDir(homeDir), 'authority-ed25519.pub'), 'utf-8').trim());
    // the v1 Ed-only identity files were NEVER created — no classical fallback exists on this node
    expect(fs.existsSync(path.join(homeDir, 'aumlok', 'authority-ed25519.key'))).toBe(false);
    expect(fs.existsSync(path.join(homeDir, 'aumlok', 'authority-root.json'))).toBe(false);
  });

  it('the ceremony classifier + posture read the v2 bundle as complete/sovereign; a second bind refuses', () => {
    const store = freshBindStore();
    const mint = mintBindCandidate(store, homeDir, NOW);
    if (!mint.ok) throw new Error('mint failed');
    expect(completeCeremony(store, homeDir, mint.phrase, mint.nonce, NOW).ok).toBe(true);
    expect(classifyBindBundle(homeDir).state).toBe('complete');
    expect(bindPosture(homeDir)).toBe('sovereign');
    const again = mintBindCandidate(freshBindStore(), homeDir, NOW);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toContain('already bound');
  });

  it('a wrong typed-back phrase never binds; nothing is committed', () => {
    const store = freshBindStore();
    const mint = mintBindCandidate(store, homeDir, NOW);
    if (!mint.ok) throw new Error('mint failed');
    const bad = completeCeremony(store, homeDir, 'wrong words entirely here now seven eight', mint.nonce, NOW);
    expect(bad.ok).toBe(false);
    expect(hybridV2StatePresent(homeDir)).toBe(false);
    expect(hybridBindStatusV2(homeDir).bound).toBe(false);
  });

  it('phrase rotation on a v2 node refuses honestly (lifecycle brick, not yet built) — both at mint and at type-back', () => {
    bindHybridV2(homeDir, PHRASE, NOW);
    const r = beginPhraseRotation(freshBindStore(), homeDir, PHRASE, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('lifecycle brick');
    // defense in depth: even a stale in-memory rotate candidate cannot write v1-shaped state beside v2
    const store = freshBindStore();
    store.candidate = { mode: 'rotate', phrase: 'x', anchor: '', words: [], tokens: [], nonce: 'n', issuedAt: NOW, expiresAt: NOW + 60_000, attemptsLeft: 3 };
    const done = completeCeremony(store, homeDir, 'x', 'n', NOW);
    expect(done.ok).toBe(false);
    expect(fs.existsSync(path.join(homeDir, 'aumlok', 'phrase-fingerprint.json'))).toBe(false);
  });
});

describe('seam 2 — the custody-backed dual signer', () => {
  it('produces a closed dual receipt the organism verifier accepts (exact suite/mode, nonce bound)', () => {
    bindHybridV2(homeDir, PHRASE, NOW);
    const signed = signPromotionV2FromCustody(homeDir, { proposalHash: HASH(), nonce: 'gesture-1', issuedAt: '2026-07-13T12:00:00.000Z' });
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    expect(signed.signedReceipt.schema).toBe('aumlok-signed-promotion-v2');
    expect(signed.signedReceipt.suite).toBe(AUMLOK_SUITE_V2);
    expect(signed.signedReceipt.mode).toBe(AUMLOK_MODE_V2);
    expect(signed.signedReceipt.authorization.nonce).toBe('gesture-1');
    const custody = loadHybridCustody(homeDir);
    if (!custody.ok) throw new Error('custody load failed');
    expect(verifyPromotionV2(signed.signedReceipt, custody.root, '2026-07-13T12:00:00.000Z').valid).toBe(true);
  });

  it('refuses on incoherent custody (seed swapped after publish) BEFORE any signature is produced', () => {
    bindHybridV2(homeDir, PHRASE, NOW);
    const mlKey = path.join(hybridBundleDir(homeDir), 'authority-mldsa65.key');
    fs.chmodSync(mlKey, 0o600); // keep custody mode right — the SWAP is what must be caught
    fs.writeFileSync(mlKey, 'ab'.repeat(32)); // valid shape, wrong material
    const signed = signPromotionV2FromCustody(homeDir, { proposalHash: HASH(), nonce: 'n' });
    expect(signed.ok).toBe(false);
    if (!signed.ok) expect(signed.reason).toContain('custody incoherent');
  });

  it('refuses a symlinked seed even when the bundle still reads coherent through the link', () => {
    bindHybridV2(homeDir, PHRASE, NOW);
    const edKey = path.join(hybridBundleDir(homeDir), 'authority-ed25519.key');
    const aside = path.join(homeDir, 'seed-copy');
    fs.copyFileSync(edKey, aside); fs.chmodSync(aside, 0o600);
    fs.rmSync(edKey); fs.symlinkSync(aside, edKey);
    const signed = signPromotionV2FromCustody(homeDir, { proposalHash: HASH(), nonce: 'n' });
    expect(signed.ok).toBe(false);
    if (!signed.ok) expect(signed.reason).toContain('symlink');
  });

  it('refuses a malformed proposal hash and a missing nonce', () => {
    bindHybridV2(homeDir, PHRASE, NOW);
    expect(signPromotionV2FromCustody(homeDir, { proposalHash: 'nope', nonce: 'n' }).ok).toBe(false);
    expect(signPromotionV2FromCustody(homeDir, { proposalHash: HASH(), nonce: '' }).ok).toBe(false);
  });
});

describe('seam 3 — full chain: ceremony bind → custody sign → receipt FILE → confined reader → native apply → replay ledger', () => {
  it('applies exactly once end to end, then the replay refuses with zero mutation', () => {
    // fresh node binds through the CEREMONY (not the raw brick) — the same path a real owner walks
    const store = freshBindStore();
    const mint = mintBindCandidate(store, homeDir, NOW);
    if (!mint.ok) throw new Error('mint failed');
    if (!completeCeremony(store, homeDir, mint.phrase, mint.nonce, NOW).ok) throw new Error('bind failed');
    // owner signs; the receipt travels as a FILE exactly like the sign→apply flow instructs
    const signed = signPromotionV2FromCustody(homeDir, { proposalHash: HASH(), nonce: 'cli-1', issuedAt: '2026-07-13T12:00:00.000Z' });
    if (!signed.ok) throw new Error('sign failed');
    const receiptPath = path.join(fs.realpathSync(os.tmpdir()), `signed-${HASH().slice(0, 12)}.json`);
    fs.writeFileSync(receiptPath, JSON.stringify(signed.signedReceipt, null, 2));
    try {
      const read = readSignedPromotionReceiptFromFile(receiptPath, { homeDir });
      expect(read.ok).toBe(true);
      if (!read.ok) return;
      const first = dispatch(read.signedReceipt);
      expect(first.ok).toBe(true);
      expect(fs.readFileSync(path.join(repoRoot, FILES[0].relPath), 'utf-8')).toBe(FILES[0].content);
      const h1 = head();
      // REPLAY the same receipt: refuse, zero mutation
      const replay = dispatch(read.signedReceipt);
      expect(replay.ok).toBe(false);
      if (!replay.ok) expect(replay.reason).toContain('already applied');
      expect(head()).toBe(h1);
    } finally { fs.rmSync(receiptPath, { force: true }); }
  });
});

describe('seam 4 — the approve DOOR signing decision (challenge nonce → dual receipt)', () => {
  it('on a v2 node the door signs the mandatory dual receipt; the writer accepts it; the challenge nonce is inside the signed authorization', () => {
    bindHybridV2(homeDir, PHRASE, NOW);
    const signed = signProposalHashForApproval(homeDir, HASH(), 'challenge-nonce-abc');
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    const r = signed.signedReceipt as any;
    expect(r.schema).toBe('aumlok-signed-promotion-v2');
    expect(r.authorization.nonce).toBe('challenge-nonce-abc');
    expect(dispatch(r).ok).toBe(true);
  });

  it('on a v2 node with INCOHERENT custody the door refuses — it never falls back to a v1 key even when one exists beside the v2 state', () => {
    // coexistence: bind v2 first, then drop a valid v1 key BESIDE it, then corrupt the v2 custody. The
    // only honest outcome is a refusal — the door must not quietly sign with the available v1 key.
    bindHybridV2(homeDir, PHRASE, NOW);
    writeV1Identity(homeDir);
    const mlKey = path.join(hybridBundleDir(homeDir), 'authority-mldsa65.key');
    fs.chmodSync(mlKey, 0o600);
    fs.writeFileSync(mlKey, 'cd'.repeat(32));
    const signed = signProposalHashForApproval(homeDir, HASH(), 'n');
    expect(signed.ok).toBe(false);
    if (!signed.ok) {
      expect(signed.reason).toContain('custody incoherent');
      expect(signed.reason).not.toContain('ed25519 v1'); // the refusal is a refusal — never a downgraded signature
    }
  });

  it('on a pure v1 node (no v2 state anywhere) the legacy path still signs a v1 receipt', () => {
    writeV1Identity(homeDir);
    const signed = signProposalHashForApproval(homeDir, HASH(), 'n1');
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    expect((signed.signedReceipt as any).schema).toBe('aumlok-signed-promotion-v1');
  });
});

describe('seam 5 — status surfaces tell the exact truth', () => {
  it('key status: v2-bound reports the exact suite + software_hybrid; incoherent v2 reports v2 with keyPresent=false (never offered v1)', () => {
    bindHybridV2(homeDir, PHRASE, NOW);
    let s = aumlokKeyStatus(homeDir);
    expect(s).toEqual({ keyPresent: true, publicKeyPresent: true, suite: AUMLOK_SUITE_V2, custody: AUMLOK_MODE_V2 });
    const mlKey = path.join(hybridBundleDir(homeDir), 'authority-mldsa65.key');
    fs.chmodSync(mlKey, 0o600);
    fs.writeFileSync(mlKey, 'ef'.repeat(32));
    s = aumlokKeyStatus(homeDir);
    expect(s.keyPresent).toBe(false);
    expect(s.suite).toBe(AUMLOK_SUITE_V2); // the node IS v2 — it is just not coherent; never reported as v1
  });

  it('status snapshot: hybridV2 block is exact when bound, honest when incoherent, silent when absent', () => {
    let snap = buildAumlokStatusSnapshot({ homeDir, repoRoot });
    expect(snap.hybridV2).toEqual({ statePresent: false, bound: false, suite: null, custody: null, rootFingerprint: null, revoked: false, rotations: 0, migratedFromV1: null, lineageVerified: null });
    const v = bindHybridV2(homeDir, PHRASE, NOW);
    if (!v.ok) throw new Error('bind failed');
    snap = buildAumlokStatusSnapshot({ homeDir, repoRoot });
    expect(snap.hybridV2.statePresent).toBe(true);
    expect(snap.hybridV2.bound).toBe(true);
    expect(snap.hybridV2.suite).toBe(AUMLOK_SUITE_V2);
    expect(snap.hybridV2.custody).toBe(AUMLOK_MODE_V2);
    expect(snap.hybridV2.rootFingerprint).toBe(v.rootId.slice(0, 12));
    expect(summarizeAumlokStatus(snap)).toContain('BOUND (aumlok-ed25519-ml-dsa-65-v1, software_hybrid');
    const mlKey = path.join(hybridBundleDir(homeDir), 'authority-mldsa65.key');
    fs.chmodSync(mlKey, 0o600);
    fs.writeFileSync(mlKey, '12'.repeat(32));
    snap = buildAumlokStatusSnapshot({ homeDir, repoRoot });
    expect(snap.hybridV2.statePresent).toBe(true);
    expect(snap.hybridV2.bound).toBe(false);
    expect(summarizeAumlokStatus(snap)).toContain('fails closed');
  });
});
