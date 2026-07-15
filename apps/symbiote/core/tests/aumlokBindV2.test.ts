// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// AUMLOK Brick 2 — fresh atomic HYBRID bind (#361). Proves: independent Ed25519 + ML-DSA-65 seeds (phrase
// derives neither); the COMPLETE bundle (both keys + manifest + fingerprint + receipt + marker) is verified
// from staged bytes then PUBLISHED with ONE atomic directory rename into a previously-absent path; any
// existing/partial state, tamper, missing-ML, or pre-publish fault fails CLOSED with NO destination partial;
// an exclusive lock yields exactly one concurrent winner; status is bound ONLY on the complete validated
// bundle (never the manifest alone) and never swallows a missing marker; no seed/phrase leaves the process;
// software custody only. (Codex #366 review: sequential renames were not atomic — now one dir rename.)
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { bindHybridV2, hybridBindStatusV2, verifyBundleCoherence, validateBindingReceiptShape, validatePhraseFingerprintShape, type BindFault } from '../src/aumlokBindV2';
import { isValidAuthorityRootV2 } from '../src/aumlokAuthorityV2';

const T0 = Date.parse('2026-07-12T12:00:00.000Z');
const PHRASE = 'frosty fjord river offer shelter totem yonder';
let home: string;
const aum = () => path.join(home, 'aumlok');
const bundle = () => path.join(aum(), 'hybrid-v2');
const inBundle = (f: string) => fs.existsSync(path.join(bundle(), f));
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'aumlok-bindv2-')); });

const KEY_FILES = ['authority-ed25519.key', 'authority-mldsa65.key'];
const PUB_FILES = ['authority-ed25519.pub', 'authority-mldsa65.pub', 'authority-root-v2.json', 'binding-receipt-v2.json'];
const ALL_BUNDLE = [...KEY_FILES, ...PUB_FILES, 'phrase-fingerprint.json', 'bind-commit-v2.json'];
function faults(...f: BindFault[]): { faults: Set<BindFault> } { return { faults: new Set(f) }; }

describe('happy path — a complete hybrid bundle is generated and published atomically', () => {
  it('binds; the published bundle contains ALL files; status reports exact suite + software custody + full rootId', () => {
    const v = bindHybridV2(home, PHRASE, T0);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.suite).toBe('aumlok-ed25519-ml-dsa-65-v1');
    expect(v.custody).toBe('software_hybrid');
    expect(v.rootId).toHaveLength(64);
    expect(v.publicKeys.ed25519).toHaveLength(64);
    expect(v.publicKeys.mlDsa65).toHaveLength(1952 * 2);
    for (const f of ALL_BUNDLE) expect(inBundle(f)).toBe(true); // the WHOLE bundle, incl. marker, published together
    const st = hybridBindStatusV2(home);
    expect(st).toMatchObject({ bound: true, suite: 'aumlok-ed25519-ml-dsa-65-v1', custody: 'software_hybrid', rootId: v.rootId });
    expect(isValidAuthorityRootV2(JSON.parse(fs.readFileSync(path.join(bundle(), 'authority-root-v2.json'), 'utf-8')))).toBe(true);
  });

  it('the two seeds are INDEPENDENT, neither derived from the phrase; keys are 0600; nothing secret leaks', () => {
    const v = bindHybridV2(home, PHRASE, T0);
    expect(v.ok).toBe(true);
    const edSeed = fs.readFileSync(path.join(bundle(), 'authority-ed25519.key'), 'utf-8').trim();
    const mlSeed = fs.readFileSync(path.join(bundle(), 'authority-mldsa65.key'), 'utf-8').trim();
    expect(edSeed).toMatch(/^[0-9a-f]{64}$/); expect(mlSeed).toMatch(/^[0-9a-f]{64}$/);
    expect(edSeed).not.toBe(mlSeed);
    expect(edSeed).not.toContain(Buffer.from(PHRASE).toString('hex'));
    for (const k of KEY_FILES) expect(fs.statSync(path.join(bundle(), k)).mode & 0o777).toBe(0o600);
    const verdictStr = JSON.stringify(v);
    expect(verdictStr).not.toContain(edSeed); expect(verdictStr).not.toContain(mlSeed); expect(verdictStr).not.toContain(PHRASE);
    for (const f of PUB_FILES) {
      const body = fs.readFileSync(path.join(bundle(), f), 'utf-8');
      expect(body).not.toContain(edSeed); expect(body).not.toContain(mlSeed); expect(body).not.toContain(PHRASE);
    }
  });
});

describe('refuse over any existing/partial state; exactly one concurrent winner', () => {
  it('a second bind on an already-bound home REFUSES (no replacement)', () => {
    const rootId = (bindHybridV2(home, PHRASE, T0) as any).rootId;
    const again = bindHybridV2(home, 'different phrase entirely here now', T0 + 1000);
    expect(again.ok).toBe(false);
    expect(hybridBindStatusV2(home).rootId).toBe(rootId); // original identity untouched
  });
  it('a pre-existing v1 identity (authority-root.json) REFUSES a fresh v2 bind', () => {
    fs.mkdirSync(aum(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(aum(), 'authority-root.json'), '{}', { mode: 0o644 });
    expect(bindHybridV2(home, PHRASE, T0).ok).toBe(false);
  });
  it('a leftover staging directory REFUSES a fresh bind', () => {
    fs.mkdirSync(path.join(aum(), '.bindv2-leftover'), { recursive: true, mode: 0o700 });
    expect(bindHybridV2(home, PHRASE, T0).ok).toBe(false);
  });
  it('a HELD bind lock makes a concurrent bind REFUSE (exactly one winner, no interleaving)', () => {
    fs.mkdirSync(aum(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(aum(), '.hybrid-v2.lock'), '', { flag: 'wx', mode: 0o600 }); // a bind already holds it
    const v = bindHybridV2(home, PHRASE, T0);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/another bind is in progress/);
    expect(hybridBindStatusV2(home).bound).toBe(false);
  });
  it('a successful bind releases its lock', () => {
    expect(bindHybridV2(home, PHRASE, T0).ok).toBe(true);
    expect(fs.existsSync(path.join(aum(), '.hybrid-v2.lock'))).toBe(false);
  });
});

describe('status validates the COMPLETE bundle — never the manifest alone (Codex #366)', () => {
  it('a bundle dir with ONLY a valid manifest reports UNBOUND', () => {
    // bind, then strip everything except the manifest — status must NOT trust the manifest by itself
    bindHybridV2(home, PHRASE, T0);
    for (const f of ALL_BUNDLE) { if (f !== 'authority-root-v2.json') fs.rmSync(path.join(bundle(), f), { force: true }); }
    expect(hybridBindStatusV2(home).bound).toBe(false);
  });
  it('a bundle missing its marker reports UNBOUND', () => {
    bindHybridV2(home, PHRASE, T0);
    fs.rmSync(path.join(bundle(), 'bind-commit-v2.json'), { force: true });
    expect(hybridBindStatusV2(home).bound).toBe(false);
  });
  it('a bundle whose key mode is loosened reports UNBOUND', () => {
    bindHybridV2(home, PHRASE, T0);
    fs.chmodSync(path.join(bundle(), 'authority-ed25519.key'), 0o644);
    expect(hybridBindStatusV2(home).bound).toBe(false);
  });
});

describe('fault injection — any tamper/fault BEFORE the single publish leaves the node UNBOUND and clean', () => {
  const unboundAndClean = () => {
    expect(hybridBindStatusV2(home).bound).toBe(false);
    expect(fs.existsSync(bundle())).toBe(false);              // no destination bundle at all
    const stray = (() => { try { return fs.readdirSync(aum()).some((e) => e.startsWith('.bindv2-')); } catch { return false; } })();
    expect(stray).toBe(false);                                // staging cleaned
    expect(fs.existsSync(path.join(aum(), '.hybrid-v2.lock'))).toBe(false); // lock released
  };
  it('a malformed staged Ed seed REFUSES; unbound', () => { expect(bindHybridV2(home, PHRASE, T0, faults('corruptEdSeed')).ok).toBe(false); unboundAndClean(); });
  it('a wrong staged ML seed (pubkey mismatch) REFUSES; unbound', () => { expect(bindHybridV2(home, PHRASE, T0, faults('corruptMlSeed')).ok).toBe(false); unboundAndClean(); });
  it('a tampered staged manifest REFUSES; unbound', () => { expect(bindHybridV2(home, PHRASE, T0, faults('corruptManifest')).ok).toBe(false); unboundAndClean(); });
  it('MISSING ML material REFUSES — NO Ed25519-only fallback; unbound', () => {
    expect(bindHybridV2(home, PHRASE, T0, faults('deleteMlKey')).ok).toBe(false);
    unboundAndClean();
    expect(inBundle('authority-ed25519.key')).toBe(false); // did NOT publish an Ed-only identity
  });
  it('a fault BEFORE the publish boundary REFUSES with unbound state intact', () => {
    const v = bindHybridV2(home, PHRASE, T0, faults('throwBeforePublish'));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/unbound state intact/);
    unboundAndClean();
  });
});

describe('custody coherence — a node that cannot sign for its pinned root is NOT bound (Codex #366 amend2)', () => {
  const PHRASE2 = PHRASE;
  it('POST-PUBLISH: swapping the committed ML-DSA seed for a DIFFERENT valid 32-byte seed → status UNBOUND', () => {
    bindHybridV2(home, PHRASE2, T0);
    expect(hybridBindStatusV2(home).bound).toBe(true);
    fs.writeFileSync(path.join(bundle(), 'authority-mldsa65.key'), 'ab'.repeat(32), { mode: 0o600 }); // valid shape, wrong seed
    expect(hybridBindStatusV2(home).bound).toBe(false); // the stored seed no longer derives the pinned pub
  });
  it('POST-PUBLISH: swapping the committed Ed25519 seed for a DIFFERENT valid 32-byte seed → status UNBOUND', () => {
    bindHybridV2(home, PHRASE2, T0);
    fs.writeFileSync(path.join(bundle(), 'authority-ed25519.key'), 'cd'.repeat(32), { mode: 0o600 });
    expect(hybridBindStatusV2(home).bound).toBe(false);
  });
  it('POST-PUBLISH: a truncated committed key → status UNBOUND', () => {
    bindHybridV2(home, PHRASE2, T0);
    fs.writeFileSync(path.join(bundle(), 'authority-mldsa65.key'), 'ab'.repeat(16), { mode: 0o600 });
    expect(hybridBindStatusV2(home).bound).toBe(false);
  });
  it('the shared coherence verifier returns PUBLIC fields only — no seed, no phrase', () => {
    bindHybridV2(home, PHRASE2, T0);
    const c = verifyBundleCoherence(bundle());
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const edSeed = fs.readFileSync(path.join(bundle(), 'authority-ed25519.key'), 'utf-8').trim();
    const mlSeed = fs.readFileSync(path.join(bundle(), 'authority-mldsa65.key'), 'utf-8').trim();
    const s = JSON.stringify(c);
    expect(s).not.toContain(edSeed);
    expect(s).not.toContain(mlSeed);
    expect(s).not.toContain(PHRASE2);
    expect(Object.keys(c).sort()).toEqual(['ok', 'publicKeys', 'rootId']); // exactly the public surface
  });
});

describe('structural precondition — receipt + fingerprint shape validated; plaintext stays dark (Brick 3 step 1)', () => {
  const bind = () => bindHybridV2(home, PHRASE, T0);
  const writeReceipt = (o: any) => fs.writeFileSync(path.join(bundle(), 'binding-receipt-v2.json'), JSON.stringify(o), { mode: 0o644 });
  const writeFp = (o: any) => fs.writeFileSync(path.join(bundle(), 'phrase-fingerprint.json'), JSON.stringify(o), { mode: 0o600 });
  const readJson = (f: string) => JSON.parse(fs.readFileSync(path.join(bundle(), f), 'utf-8'));

  it('a receipt with an unknown field, wrong suite/custody, bad boundAt, or non-null drand → status UNBOUND', () => {
    for (const mut of [
      (r: any) => ({ ...r, shadow: 'x' }),
      (r: any) => ({ ...r, suite: 'aumlok-ed25519-v1' }),
      (r: any) => ({ ...r, custody: 'hardware' }),
      (r: any) => ({ ...r, boundAt: 'not-a-time' }),
      (r: any) => ({ ...r, drandAnchor: { round: 1 } }),
    ]) {
      bind(); writeReceipt(mut(readJson('binding-receipt-v2.json')));
      expect(hybridBindStatusV2(home).bound).toBe(false);
      fs.rmSync(bundle(), { recursive: true, force: true }); fs.rmSync(path.join(aum(), '.hybrid-v2.lock'), { force: true });
    }
  });
  it('a fingerprint with a wrong KDF param, non-hex salt/hash, bad rotations, or unknown field → status UNBOUND', () => {
    for (const mut of [
      (f: any) => ({ ...f, N: 1024 }),
      (f: any) => ({ ...f, saltHex: 'nothex!!' }),
      (f: any) => ({ ...f, hashHex: 'zz' }),
      (f: any) => ({ ...f, rotations: -1 }),
      (f: any) => ({ ...f, shadow: 'x' }),
    ]) {
      bind(); writeFp(mut(readJson('phrase-fingerprint.json')));
      expect(hybridBindStatusV2(home).bound).toBe(false);
      fs.rmSync(bundle(), { recursive: true, force: true }); fs.rmSync(path.join(aum(), '.hybrid-v2.lock'), { force: true });
    }
  });
  it('status NEVER reads the phrase plaintext — validation is structural only', () => {
    bind();
    // corrupt the fingerprint HASH to a valid-hex but wrong value: structure still passes, status still bound
    // (status must NOT attempt a phrase comparison — the plaintext is unavailable and stays dark)
    const fp = readJson('phrase-fingerprint.json'); writeFp({ ...fp, hashHex: 'ab'.repeat(32) });
    expect(hybridBindStatusV2(home).bound).toBe(true);
  });
  it('fingerprint salt/hash must be EXACT sizes: 16-byte salt (32 hex), 32-byte hash (64 hex)', () => {
    // positive: the GENERATED fingerprint has a 32-hex salt and 64-hex hash
    bind();
    const gen = readJson('phrase-fingerprint.json');
    expect(gen.saltHex).toMatch(/^[0-9a-f]{32}$/);
    expect(gen.hashHex).toMatch(/^[0-9a-f]{64}$/);
    expect(hybridBindStatusV2(home).bound).toBe(true);
    // negatives on salt and hash length/shape → status UNBOUND
    const base = readJson('phrase-fingerprint.json');
    const bad = [
      { ...base, saltHex: 'ab'.repeat(8) },   // undersized salt (8 bytes)
      { ...base, saltHex: 'ab'.repeat(32) },  // oversized salt (32 bytes)
      { ...base, saltHex: base.saltHex.slice(0, 31) }, // odd length
      { ...base, saltHex: base.saltHex.toUpperCase() }, // uppercase
      { ...base, hashHex: 'cd'.repeat(16) },  // undersized hash (16 bytes)
      { ...base, hashHex: 'cd'.repeat(48) },  // oversized hash (48 bytes)
      { ...base, hashHex: base.hashHex.slice(0, 63) }, // odd length
      { ...base, hashHex: base.hashHex.toUpperCase() }, // uppercase
    ];
    for (const f of bad) { writeFp(f); expect(hybridBindStatusV2(home).bound).toBe(false); }
  });
  it('the exported validator enforces exact salt/hash byte lengths directly', () => {
    const good = { schema: 'aumlok-phrase-fingerprint-v2', kdf: 'scrypt', N: 1 << 15, r: 8, p: 1, saltHex: 'a'.repeat(32), hashHex: 'b'.repeat(64), updatedAt: '2026-07-12T12:00:00.000Z', rotations: 0 };
    expect(validatePhraseFingerprintShape(good).ok).toBe(true);
    expect(validatePhraseFingerprintShape({ ...good, saltHex: 'a'.repeat(30) }).ok).toBe(false); // 15 bytes
    expect(validatePhraseFingerprintShape({ ...good, saltHex: 'a'.repeat(34) }).ok).toBe(false); // 17 bytes
    expect(validatePhraseFingerprintShape({ ...good, hashHex: 'b'.repeat(62) }).ok).toBe(false); // 31 bytes
    expect(validatePhraseFingerprintShape({ ...good, hashHex: 'b'.repeat(66) }).ok).toBe(false); // 33 bytes
    expect(validatePhraseFingerprintShape({ ...good, hashHex: 'B'.repeat(64) }).ok).toBe(false); // uppercase
  });
  it('the exported shape validators reject and accept precisely', () => {
    const goodR = { schema: 'aumlok-binding-receipt-v2', suite: 'aumlok-ed25519-ml-dsa-65-v1', custody: 'software_hybrid', rootId: 'a'.repeat(64), manifestIntegrity: 'b'.repeat(64), boundAt: '2026-07-12T12:00:00.000Z', drandAnchor: null };
    expect(validateBindingReceiptShape(goodR, 'a'.repeat(64), 'b'.repeat(64)).ok).toBe(true);
    expect(validateBindingReceiptShape({ ...goodR, extra: 1 }, 'a'.repeat(64), 'b'.repeat(64)).ok).toBe(false);
    const goodF = { schema: 'aumlok-phrase-fingerprint-v2', kdf: 'scrypt', N: 1 << 15, r: 8, p: 1, saltHex: 'a'.repeat(32), hashHex: 'b'.repeat(64), updatedAt: '2026-07-12T12:00:00.000Z', rotations: 0 };
    expect(validatePhraseFingerprintShape(goodF).ok).toBe(true);
    expect(validatePhraseFingerprintShape({ ...goodF, kdf: 'pbkdf2' }).ok).toBe(false);
  });
});

describe('custody honesty', () => {
  it('never claims hardware/production custody anywhere it commits or reports', () => {
    bindHybridV2(home, PHRASE, T0);
    const st = JSON.stringify(hybridBindStatusV2(home));
    const receipt = fs.readFileSync(path.join(bundle(), 'binding-receipt-v2.json'), 'utf-8');
    for (const banned of ['hardware', 'production', 'hsm', 'dev_real']) {
      expect(st.toLowerCase()).not.toContain(banned);
      expect(receipt.toLowerCase()).not.toContain(banned);
    }
    expect(receipt).toContain('software_hybrid');
  });
});
