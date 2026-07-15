// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// The candidate LIFECYCLE brick (2026-07-11): after a successful current-phrase proof mints a
// rotation candidate, the owner has an explicit revoke, and an abandoned candidate has a bounded
// life — while the standing phrase, fingerprint, key, lockout state, and receipts stay untouched.
// These are LIVE kernel tests (real store, real files in a tmp home), plus structural pins on the
// door route and page wiring. No reset path exists; nothing here rotates.
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  freshBindStore, beginPhraseRotation, completeCeremony, bindPosture, normalizePhrase,
  revokeBindCandidate, candidateAlive, BIND_CANDIDATE_TTL_MS, ROTATE_VERIFY_MAX_ATTEMPTS, PHRASE_KDF_V2,
  type BindStore,
} from '../src/aumlokBindCeremony';
import { generateKeypair } from '../src/aumlokSigner';
import { pinAuthorityRoot, serializeRootManifest } from '../src/aumlokAuthorityRoot';
import { randomBytes, scryptSync } from 'crypto';

const door = fs.readFileSync(path.join(__dirname, '..', '..', 'spatial', 'aumlok-bind-serve.ts'), 'utf-8');

const T0 = Date.parse('2026-07-11T12:00:00.000Z');
let home: string;
let store: BindStore;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'aumlok-lifecycle-'));
  store = freshBindStore();
});

// Rotation candidates exist only on LEGACY v1 nodes since #361 Cycle A (fresh ceremony binds are
// hybrid v2, whose phrase rotation arrives with the lifecycle brick) — so the standing node these
// lifecycle laws run against is a manufactured legacy bundle with a KNOWN phrase.
function bindFresh(): string {
  const phrase = 'harbor-hazel-amber-raven-birch-ochre-quill';
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
  return phrase;
}
const fpBytes = () => fs.readFileSync(path.join(home, 'aumlok', 'phrase-fingerprint.json'), 'utf-8');
const receiptBytes = () => fs.readFileSync(path.join(home, 'aumlok', 'binding-receipt.json'), 'utf-8');

describe('proof → candidate alive → owner cancel → false, with the standing phrase intact', () => {
  it('the full ordered sequence, live against the real kernel and real files', () => {
    const standing = bindFresh();
    const fpBefore = fpBytes();
    const receiptBefore = receiptBytes();
    const attemptsBefore = store.rotateAttemptsLeft;

    // successful current-phrase proof mints a rotation candidate
    const begin = beginPhraseRotation(store, home, standing, T0 + 60_000);
    expect(begin.ok).toBe(true);
    expect(candidateAlive(store, T0 + 61_000)).toBe(true);

    // the owner cancels — the candidate dies in the process, nothing durable moves
    const r = revokeBindCandidate(store);
    expect(r.revoked).toBe(true);
    expect(candidateAlive(store, T0 + 62_000)).toBe(false);
    expect(store.candidate).toBeNull(); // the in-memory phrase is gone, not just hidden
    expect(fpBytes()).toBe(fpBefore); // fingerprint file byte-identical
    expect(receiptBytes()).toBe(receiptBefore); // receipt byte-identical — no rotation happened
    expect(store.rotateAttemptsLeft).toBe(attemptsBefore); // cancel never spends a lockout attempt
    expect(bindPosture(home)).toBe('sovereign');

    // the revoked candidate cannot complete — and the refusal is the standing ceremony-dead law
    if (!begin.ok) return;
    const ghost = completeCeremony(store, home, begin.phrase, begin.nonce, T0 + 63_000);
    expect(ghost.ok).toBe(false);

    // the OLD phrase remains fully valid: it proves again, immediately
    const again = beginPhraseRotation(store, home, standing, T0 + 64_000);
    expect(again.ok).toBe(true);
    expect(candidateAlive(store, T0 + 65_000)).toBe(true);
    revokeBindCandidate(store); // leave the tmp home standing, nothing consumed
  });

  it('revoke is idempotent and content-free', () => {
    expect(revokeBindCandidate(store)).toEqual({ revoked: false });
    expect(revokeBindCandidate(store)).toEqual({ revoked: false });
  });
});

describe('bounded expiry — an abandoned candidate cannot live for the life of the process', () => {
  it('past its TTL the candidate reads dead AND its in-memory phrase is reaped on the spot', () => {
    const standing = bindFresh();
    const begin = beginPhraseRotation(store, home, standing, T0 + 60_000);
    expect(begin.ok).toBe(true);
    const justBefore = T0 + 60_000 + BIND_CANDIDATE_TTL_MS - 1;
    expect(candidateAlive(store, justBefore)).toBe(true); // alive to the last permitted instant
    const justAfter = T0 + 60_000 + BIND_CANDIDATE_TTL_MS + 1;
    expect(candidateAlive(store, justAfter)).toBe(false);
    expect(store.candidate).toBeNull(); // reaped — the phrase does not linger in memory
    // and the standing phrase still proves afterward
    expect(beginPhraseRotation(store, home, standing, justAfter + 1000).ok).toBe(true);
    revokeBindCandidate(store);
  });

  it('expiry consumes no lockout attempts and grants nothing', () => {
    const standing = bindFresh();
    beginPhraseRotation(store, home, standing, T0 + 60_000);
    const attempts = store.rotateAttemptsLeft;
    candidateAlive(store, T0 + 60_000 + BIND_CANDIDATE_TTL_MS + 1);
    expect(store.rotateAttemptsLeft).toBe(attempts);
    expect(store.rotateAttemptsLeft).toBeLessThanOrEqual(ROTATE_VERIFY_MAX_ATTEMPTS);
  });
});

describe('the door wiring — structural pins (no reset path, gated cancel, view-first preserved)', () => {
  it('POST /api/bind/cancel exists, is gated, revokes, and reports candidateAlive:false', () => {
    const route = door.slice(door.indexOf("p === '/api/bind/cancel'"), door.indexOf("p === '/api/bind/rotate'"));
    expect(route).toContain('gate(req)');
    expect(route).toContain('revokeBindCandidate(store)');
    expect(route).toContain('candidateAlive: false');
  });

  it('status liveness runs through the lazy reaper, and a background reaper bounds the no-request case', () => {
    expect(door).toContain('candidateAlive: candidateAlive(store, Date.now())');
    expect(door).toContain('setInterval(() => candidateAlive(store, Date.now())');
  });

  it('the reveal step offers the owner cancel in rotate mode only, wired to the revoke route', () => {
    expect(door).toContain('id="revcancel"');
    expect(door).toContain('$("#revcancel").style.display=(mode==="rotate")?"":"none"');
    const handler = door.slice(door.indexOf('$("#revcancel").onclick'), door.indexOf('boot();'));
    expect(handler).toContain('api("/api/bind/cancel",{})');
    expect(handler).toContain('show("#s-view")');
  });

  it('post-proof cancel FAILS CLOSED (Codex review): the view is reachable only through a proven revocation', () => {
    const handler = door.slice(door.indexOf('$("#revcancel").onclick'), door.indexOf('boot();'));
    // the ONLY exit to the view demands the door's explicit proof — ok:true AND candidateAlive:false
    expect(handler).toContain('v.ok!==true || v.candidateAlive!==false');
    // every failure class (transport/gate/parse/semantic) stays on the reveal with a retry message…
    expect(handler).toContain('the cancel did not go through');
    const failureBranch = handler.slice(handler.indexOf('if(!v'), handler.indexOf('msg("#revmsg","");'));
    expect(failureBranch).toContain('return;'); // …and returns BEFORE the view transition
    expect(failureBranch).not.toContain('show("#s-view")'); // failure can never imply revocation
    // transport failure resolves to null, which the strict check refuses — no optimistic catch
    expect(handler).toContain('catch(e){ v=null; }');
    expect(handler).not.toContain('the candidate dies with the door'); // the optimistic comment is gone with the behavior
  });

  it('no key-RESET path exists (recovery of missing lineage is a separate #345 route, never a reset)', () => {
    // the lifecycle brick added no reset/regenerate path; #345 later added /api/bind/recover, which
    // restores ADVISORY lineage under owner proof and never touches key/authority — that is not a reset.
    for (const banned of ['/api/bind/reset', 'resetPhrase', 'recoverPhrase', 'regenerateKey']) {
      expect(door).not.toContain(banned);
    }
  });
});
