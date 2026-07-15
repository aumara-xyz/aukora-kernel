// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// The native binding ceremony's laws, each pinned: phrase-is-not-key (only a salted fingerprint is ever
// on disk), reshuffle-until-right, type-back single-use, three-strike candidate death, refuse-overwrite,
// strict custody modes, rotation gated by the current phrase with lockout. Fully hermetic (temp homeDir).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  freshBindStore, mintBindCandidate, beginPhraseRotation, completeCeremony, bindPosture, normalizePhrase,
  BIND_CANDIDATE_TTL_MS, BIND_MAX_ATTEMPTS, ROTATE_VERIFY_MAX_ATTEMPTS, PHRASE_KDF_V2,
  type BindStore,
} from '../src/aumlokBindCeremony';
import { hybridBundleDir } from '../src/aumlokBindV2';
import { generateKeypair } from '../src/aumlokSigner';
import { pinAuthorityRoot, serializeRootManifest } from '../src/aumlokAuthorityRoot';
import { randomBytes, scryptSync } from 'crypto';

let home: string;
let store: BindStore;
const T0 = 1_750_000_000_000;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'aumlok-bind-test-'));
  store = freshBindStore();
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

/** A LEGACY v1 sovereign node with a KNOWN phrase (scrypt-v2 fingerprint, exactly as the old ceremony
 *  wrote it). Fresh ceremony binds are hybrid v2 since #361 Cycle A — phrase ROTATION still runs only
 *  on these existing v1 nodes, so the rotation laws below are pinned against this manufactured shape. */
function writeLegacyV1Node(phrase: string): { publicKeyHex: string } {
  const dir = path.join(home, 'aumlok');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const { privateKeyHex, publicKeyHex } = generateKeypair();
  fs.writeFileSync(path.join(dir, 'authority-ed25519.key'), privateKeyHex, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'authority-ed25519.pub'), publicKeyHex);
  fs.writeFileSync(path.join(dir, 'authority-root.json'), serializeRootManifest(pinAuthorityRoot(publicKeyHex)));
  const saltHex = randomBytes(16).toString('hex');
  const hashHex = scryptSync(normalizePhrase(phrase), Buffer.from(saltHex, 'hex'), PHRASE_KDF_V2.keyLen, { N: PHRASE_KDF_V2.N, r: PHRASE_KDF_V2.r, p: PHRASE_KDF_V2.p, maxmem: PHRASE_KDF_V2.maxmem }).toString('hex');
  fs.writeFileSync(path.join(dir, 'phrase-fingerprint.json'), JSON.stringify({ schema: 'aumlok-phrase-fingerprint-v2', kdf: 'scrypt', N: PHRASE_KDF_V2.N, r: PHRASE_KDF_V2.r, p: PHRASE_KDF_V2.p, saltHex, hashHex, updatedAt: new Date(T0).toISOString(), rotations: 0 }, null, 2) + '\n', { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'binding-receipt.json'), JSON.stringify({ schema: 'aumlok-binding-receipt-v1', keyId: publicKeyHex.slice(0, 12), publicKeyHex, phraseFingerprintSha256: hashHex, boundAt: new Date(T0).toISOString(), advisoryOnly: true, grantsAuthority: false, note: 'legacy', drandAnchor: null, rotations: [] }, null, 2) + '\n', { mode: 0o600 });
  return { publicKeyHex };
}

function bindHappyPath(nowMs = T0): { keyId: string; publicKeyHex: string; phrase: string } {
  const m = mintBindCandidate(store, home, nowMs);
  if (!m.ok) throw new Error('mint failed');
  const done = completeCeremony(store, home, m.phrase, m.nonce, nowMs + 1000);
  if (!done.ok || done.mode !== 'bind') throw new Error('bind failed');
  return { keyId: done.keyId, publicKeyHex: done.publicKeyHex, phrase: m.phrase };
}

describe('aumlokBindCeremony — the native binding', () => {
  it('fresh node is unbound; a completed ceremony makes it sovereign', () => {
    expect(bindPosture(home)).toBe('unbound');
    bindHappyPath();
    expect(bindPosture(home)).toBe('sovereign');
  });

  it('reshuffle replaces the candidate — the old nonce/phrase is dead', () => {
    const a = mintBindCandidate(store, home, T0);
    const b = mintBindCandidate(store, home, T0 + 10);
    if (!a.ok || !b.ok) throw new Error('mint failed');
    expect(a.phrase).not.toBe(b.phrase); // 5 words from 64 — collision would be astonishing
    const stale = completeCeremony(store, home, a.phrase, a.nonce, T0 + 20);
    expect(stale.ok).toBe(false);
    const live = completeCeremony(store, home, b.phrase, b.nonce, T0 + 30);
    expect(live.ok).toBe(true);
  });

  it('the phrase is the SEVEN-word acrostic (anchor + six whose initials spell it) and type-back is forgiving about case/spacing but not words', () => {
    const m = mintBindCandidate(store, home, T0);
    if (!m.ok) throw new Error('mint failed');
    expect(m.phrase.split('-')).toHaveLength(7);           // anchor + six
    expect(m.anchor).toHaveLength(6);
    expect(m.tokens[0]).toBe(m.anchor);                     // word zero is the anchor
    expect(m.words.map((w) => w[0]).join('')).toBe(m.anchor); // the acrostic law — the six spell the spine
    const sloppy = m.phrase.toUpperCase().replace(/-/g, '  ');
    expect(normalizePhrase(sloppy)).toBe(m.phrase);
    const done = completeCeremony(store, home, sloppy, m.nonce, T0 + 1);
    expect(done.ok).toBe(true);
  });

  it('three wrong type-backs kill the candidate; a correct one after fewer misses still binds', () => {
    const m = mintBindCandidate(store, home, T0);
    if (!m.ok) throw new Error('mint failed');
    expect(completeCeremony(store, home, 'wrong-one', m.nonce, T0 + 1).ok).toBe(false);
    const second = completeCeremony(store, home, m.phrase, m.nonce, T0 + 2); // 1 miss, then correct
    expect(second.ok).toBe(true);

    const m2Store = freshBindStore();
    const home2 = fs.mkdtempSync(path.join(os.tmpdir(), 'aumlok-bind-test2-'));
    try {
      const m2 = mintBindCandidate(m2Store, home2, T0);
      if (!m2.ok) throw new Error('mint failed');
      for (let k = 0; k < BIND_MAX_ATTEMPTS; k++) expect(completeCeremony(m2Store, home2, 'nope', m2.nonce, T0 + k).ok).toBe(false);
      const afterDeath = completeCeremony(m2Store, home2, m2.phrase, m2.nonce, T0 + 10);
      expect(afterDeath.ok).toBe(false); // candidate died — even the right phrase is refused now
      expect(bindPosture(home2)).toBe('unbound');
    } finally { fs.rmSync(home2, { recursive: true, force: true }); }
  });

  it('an expired candidate refuses even the correct phrase', () => {
    const m = mintBindCandidate(store, home, T0);
    if (!m.ok) throw new Error('mint failed');
    const late = completeCeremony(store, home, m.phrase, m.nonce, T0 + BIND_CANDIDATE_TTL_MS + 1);
    expect(late.ok).toBe(false);
    expect(bindPosture(home)).toBe('unbound');
  });

  it('binding writes strict custody: 0600 seeds in the hybrid bundle, and NEVER returns or persists the private seeds or phrase', () => {
    const { publicKeyHex, phrase } = bindHappyPath();
    const bundle = hybridBundleDir(home);
    for (const k of ['authority-ed25519.key', 'authority-mldsa65.key']) {
      const st = fs.statSync(path.join(bundle, k));
      expect(st.mode & 0o077).toBe(0); // group/world closed — same law the approve ceremony enforces on read
      const seed = fs.readFileSync(path.join(bundle, k), 'utf-8').trim();
      expect(seed).toMatch(/^[0-9a-f]{64}$/);
      expect(seed).not.toBe(publicKeyHex);
    }
    // the phrase appears in NO file anywhere under the key dir — fingerprint only
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of walk(path.join(home, 'aumlok'))) {
      const body = fs.readFileSync(f, 'utf-8');
      expect(body.includes(phrase), `plaintext phrase leaked into ${f}`).toBe(false);
    }
    const receipt = JSON.parse(fs.readFileSync(path.join(bundle, 'binding-receipt-v2.json'), 'utf-8'));
    expect(receipt.schema).toBe('aumlok-binding-receipt-v2');
    expect(receipt.suite).toBe('aumlok-ed25519-ml-dsa-65-v1');
    expect(receipt.custody).toBe('software_hybrid');
    // and NO legacy v1 key material was created beside the bundle
    expect(fs.existsSync(path.join(home, 'aumlok', 'authority-ed25519.key'))).toBe(false);
  });

  it('a bound node refuses a second bind — both at mint and at complete', () => {
    bindHappyPath();
    expect(mintBindCandidate(store, home, T0 + 5000).ok).toBe(false);
    // even a hand-crafted candidate cannot overwrite: force one in and try
    const forced = freshBindStore();
    const m = mintBindCandidate(forced, fs.mkdtempSync(path.join(os.tmpdir(), 'decoy-')), T0);
    if (!m.ok) throw new Error('mint failed');
    forced.candidate!.mode = 'bind';
    const overwrite = completeCeremony(forced, home, m.phrase, m.nonce, T0 + 6000);
    expect(overwrite.ok).toBe(false);
    expect(String((overwrite as { reason: string }).reason)).toContain('refusing to overwrite');
  });

  it('rotation (legacy v1 node): requires the CURRENT phrase, changes the fingerprint, keeps the key, receipts the event', () => {
    const phrase = 'harbor-hazel-amber-raven-birch-ochre-quill';
    const { publicKeyHex } = writeLegacyV1Node(phrase);
    const fpBefore = JSON.parse(fs.readFileSync(path.join(home, 'aumlok', 'phrase-fingerprint.json'), 'utf-8'));

    expect(beginPhraseRotation(store, home, 'not-the-phrase', T0 + 9000).ok).toBe(false);
    const begin = beginPhraseRotation(store, home, phrase, T0 + 10_000);
    if (!begin.ok) throw new Error('rotation begin failed');
    const done = completeCeremony(store, home, begin.phrase, begin.nonce, T0 + 11_000);
    expect(done.ok).toBe(true);
    expect((done as { mode: string }).mode).toBe('rotate');

    const fpAfter = JSON.parse(fs.readFileSync(path.join(home, 'aumlok', 'phrase-fingerprint.json'), 'utf-8'));
    // v2 files since the canonical-ceremony round: the scrypt hashHex changes with every rotation
    expect(fpAfter.hashHex).not.toBe(fpBefore.hashHex);
    expect(fpAfter.schema).toBe('aumlok-phrase-fingerprint-v2');
    expect(fpAfter.rotations).toBe(1);
    expect(fs.readFileSync(path.join(home, 'aumlok', 'authority-ed25519.pub'), 'utf-8')).toBe(publicKeyHex); // key untouched
    const receipt = JSON.parse(fs.readFileSync(path.join(home, 'aumlok', 'binding-receipt.json'), 'utf-8'));
    expect(receipt.rotations).toHaveLength(1);
    // the OLD phrase no longer begins a rotation
    expect(beginPhraseRotation(store, home, phrase, T0 + 12_000).ok).toBe(false);
  });

  it('rotation lockout (legacy v1 node): repeated wrong current-phrase guesses lock the door for a while', () => {
    writeLegacyV1Node('harbor-hazel-amber-raven-birch-ochre-quill');
    for (let k = 0; k < ROTATE_VERIFY_MAX_ATTEMPTS; k++) {
      expect(beginPhraseRotation(store, home, `guess-${k}`, T0 + 20_000 + k).ok).toBe(false);
    }
    // locked now — even a would-be correct attempt inside the window is refused before comparison
    const locked = beginPhraseRotation(store, home, 'anything', T0 + 20_100);
    expect(locked.ok).toBe(false);
    expect(String((locked as { reason: string }).reason)).toContain('locked');
  });

  it('rotation on an unbound node refuses honestly', () => {
    expect(beginPhraseRotation(store, home, 'whatever', T0).ok).toBe(false);
  });
});
