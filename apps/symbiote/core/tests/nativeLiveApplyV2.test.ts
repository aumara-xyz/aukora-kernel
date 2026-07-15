// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// #361 Brick 3 step 2 — END-TO-END through the real dispatcher (dispatchSignedLiveApplyForTests). On a
// v2-bound node the live writer REQUIRES a dual Ed25519+ML-DSA-65 authorization: a valid dual reaches the
// normal guarded apply once; a missing/corrupt/wrong-domain ML-DSA (Ed valid), an Ed-only v1 receipt, or an
// incoherent custody bundle REFUSE and leave the target bytes + git HEAD unchanged. No Ed-only path on v2.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { pqcSignWithDomain } from '../src/crypto';
import { dispatchSignedLiveApplyForTests, readSignedPromotionReceiptFromFile } from '../src/nativeLiveApply';
import { isProposalAlreadyApplied } from '../src/appliedProposalLedger';
import { computeProposalHash } from '../src/proposalHash';
import { bindHybridV2 } from '../src/aumlokBindV2';
import { canonicalPromotionV2, type PromotionAuthorizationV2 } from '../src/aumlokAuthorityV2';
import { signPromotionV2 } from '../src/aumlokSignerV2';
import { generateKeypair, signPromotionAuthorization } from '../src/aumlokSigner';
import { pinAuthorityRoot } from '../src/aumlokAuthorityRoot';

const PHRASE = 'frosty fjord river offer shelter totem yonder';
const GOAL = 'apply a v2 note';
const FILES = [{ relPath: 'docs/note-v2.md', content: 'post-quantum content\n' }];
const FUTURE = '2999-01-01T00:00:00.000Z';
let repoRoot: string, homeDir: string, rootId: string, edSeed: string, mlSeed: string;
const git = (args: string[]) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf-8' }).trim();
const head = () => git(['rev-parse', 'HEAD']);
const seedOf = (f: string) => fs.readFileSync(path.join(homeDir, 'aumlok', 'hybrid-v2', f), 'utf-8').trim();
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const flip = (h: string) => (h[0] === '0' ? '1' : '0') + h.slice(1);

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-lav2-repo-'));
  git(['init', '-q']); git(['config', 'user.email', 't@e.com']); git(['config', 'user.name', 'T']);
  fs.mkdirSync(path.join(repoRoot, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'hi\n'); git(['add', '-A']); git(['commit', '-q', '-m', 'init']);
  homeDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-lav2-home-'));
  const v = bindHybridV2(homeDir, PHRASE, Date.parse('2026-07-13T12:00:00.000Z'));
  if (!v.ok) throw new Error('v2 bind failed');
  rootId = v.rootId; edSeed = seedOf('authority-ed25519.key'); mlSeed = seedOf('authority-mldsa65.key');
});
afterEach(() => { fs.rmSync(repoRoot, { recursive: true, force: true }); fs.rmSync(homeDir, { recursive: true, force: true }); });

function auth(over: Partial<PromotionAuthorizationV2> = {}): PromotionAuthorizationV2 {
  const h = computeProposalHash(GOAL, FILES); // the ONE live content hash — both fields bind to it
  return { rootId, proposalHash: h, draftHash: h, nonce: 'n1', issuedAt: '2026-07-13T12:00:00.000Z', expiresAt: FUTURE, ...over };
}
const dispatch = (signedReceipt: any) => dispatchSignedLiveApplyForTests({ repoRoot, homeDir, now: '2026-07-13T12:00:00.000Z' } as any, { goal: GOAL, proposalHash: computeProposalHash(GOAL, FILES), files: FILES, signedReceipt });
const targetExists = () => fs.existsSync(path.join(repoRoot, 'docs/note-v2.md'));

describe('v2-bound native apply — dual signature is MANDATORY end-to-end', () => {
  it('a valid Ed25519 + ML-DSA-65 receipt reaches the guarded apply once (file written, HEAD advances)', () => {
    const h0 = head();
    const res = dispatch(signPromotionV2(edSeed, mlSeed, auth()));
    expect(res.ok).toBe(true);
    expect(targetExists()).toBe(true);
    expect(head()).not.toBe(h0);
  });

  it('RELEASE BLOCKER: ML-DSA removed (Ed valid) → REFUSE; target bytes + HEAD unchanged', () => {
    const h0 = head();
    const r = clone(signPromotionV2(edSeed, mlSeed, auth())); r.signatures.mlDsa65 = '';
    expect(dispatch(r).ok).toBe(false);
    expect(targetExists()).toBe(false);
    expect(head()).toBe(h0);
  });

  it('RELEASE BLOCKER: an Ed25519-only v1 receipt on a v2 node → REFUSE (no Ed-only path)', () => {
    const kp = generateKeypair();
    const h = computeProposalHash(GOAL, FILES);
    const v1 = signPromotionAuthorization(kp.privateKeyHex, { keyId: pinAuthorityRoot(kp.publicKeyHex).keyId, proposalHash: h, draftHash: h, nonce: 'n', issuedAt: '2026-07-13T12:00:00.000Z', expiresAt: null });
    const h0 = head();
    expect(dispatch(v1).ok).toBe(false);
    expect(targetExists()).toBe(false); expect(head()).toBe(h0);
  });

  it('a corrupted ML-DSA signature → REFUSE; unchanged', () => {
    const r = clone(signPromotionV2(edSeed, mlSeed, auth())); r.signatures.mlDsa65 = flip(r.signatures.mlDsa65);
    const h0 = head();
    expect(dispatch(r).ok).toBe(false); expect(targetExists()).toBe(false); expect(head()).toBe(h0);
  });

  it('an ML-DSA signature under the WRONG DOMAIN → REFUSE; unchanged', () => {
    const a = auth();
    const msg = new TextEncoder().encode(canonicalPromotionV2(a));
    const wrong = pqcSignWithDomain(mlSeed, msg, 'aumlokLifecycle');
    const ed = bytesToHex(ed25519.sign(msg, hexToBytes(edSeed)));
    const forged = { schema: 'aumlok-signed-promotion-v2', suite: 'aumlok-ed25519-ml-dsa-65-v1', authorization: a, mode: 'software_hybrid', signatures: { ed25519: ed, mlDsa65: wrong } };
    const h0 = head();
    expect(dispatch(forged).ok).toBe(false); expect(targetExists()).toBe(false); expect(head()).toBe(h0);
  });

  it('an INCOHERENT v2 custody bundle (swapped ML seed) → REFUSE, fail closed (no v1 fallback)', () => {
    fs.writeFileSync(path.join(homeDir, 'aumlok', 'hybrid-v2', 'authority-mldsa65.key'), 'ab'.repeat(32), { mode: 0o600 });
    const h0 = head();
    const res = dispatch(signPromotionV2(edSeed, mlSeed, auth()));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/custody/);
    expect(targetExists()).toBe(false); expect(head()).toBe(h0);
    expect(isProposalAlreadyApplied(computeProposalHash(GOAL, FILES), { homeDir })).toBeFalsy(); // ledger unchanged
  });
});

describe('round 3/3 — the REAL owner ingress: read a v2 receipt file → dispatch; sentinel fails closed', () => {
  const writeReceipt = (obj: any) => { const d = path.join(homeDir, 'aumlok', 'receipts'); fs.mkdirSync(d, { recursive: true }); const p = path.join(d, 'r.json'); fs.writeFileSync(p, JSON.stringify(obj)); return p; };

  it('a v2 receipt READ through readSignedPromotionReceiptFromFile applies once (v2 no longer fails as v1-only)', () => {
    const p = writeReceipt(signPromotionV2(edSeed, mlSeed, auth()));
    const read = readSignedPromotionReceiptFromFile(p, { homeDir });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const h0 = head();
    const res = dispatch(read.signedReceipt);
    expect(res.ok).toBe(true); expect(targetExists()).toBe(true); expect(head()).not.toBe(h0);
  });

  it('the reader refuses an unknown schema, unknown field, wrong suite, and wrong mode before dispatch', () => {
    const good = signPromotionV2(edSeed, mlSeed, auth());
    expect(readSignedPromotionReceiptFromFile(writeReceipt({ ...good, schema: 'aumlok-signed-promotion-v9' }), { homeDir }).ok).toBe(false);
    expect(readSignedPromotionReceiptFromFile(writeReceipt({ ...good, shadow: 'x' }), { homeDir }).ok).toBe(false);
    expect(readSignedPromotionReceiptFromFile(writeReceipt({ ...good, suite: 'aumlok-ed25519-v1' }), { homeDir }).ok).toBe(false);
    expect(readSignedPromotionReceiptFromFile(writeReceipt({ ...good, mode: 'hardware' }), { homeDir }).ok).toBe(false);
  });

  it('v2-STATE SENTINEL: leftover interrupted staging (no coherent bundle) + a legacy v1 root → REFUSE, never v1 fallback', () => {
    // fresh home: a valid legacy v1 authority-root.json AND a leftover .bindv2-* staging dir, but NO bundle
    const home2 = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-lav2-coexist-'));
    fs.mkdirSync(path.join(home2, 'aumlok'), { recursive: true });
    fs.writeFileSync(path.join(home2, 'aumlok', 'authority-root.json'), '{"schema":"aumlok-authority-root-v1"}');
    fs.mkdirSync(path.join(home2, 'aumlok', '.bindv2-interrupted'), { recursive: true });
    const res = dispatchSignedLiveApplyForTests({ repoRoot, homeDir: home2, now: '2026-07-13T12:00:00.000Z' } as any, { goal: GOAL, proposalHash: computeProposalHash(GOAL, FILES), files: FILES, signedReceipt: signPromotionV2(edSeed, mlSeed, auth()) });
    expect(res.ok).toBe(false); // any v2 state ⇒ require coherent v2 or refuse; never the legacy v1 path
    expect(targetExists()).toBe(false);
    fs.rmSync(home2, { recursive: true, force: true });
  });
});
