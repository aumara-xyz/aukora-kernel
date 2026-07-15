// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// The canonical-ceremony round (#242): ONE bind/rotation ceremony, versioned memory-hard fingerprints,
// explicit legacy posture, durable evidence, and the retirement of the approve door's free phrase
// writer. Every case the directive named is pinned here; the pre-existing bind suite
// (aumlokBindCeremony.test.ts) continues to pin the base ceremony laws. Hermetic (temp homeDirs).
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash, randomBytes } from 'crypto';
import {
  freshBindStore, mintBindCandidate, beginPhraseRotation, completeCeremony, bindPosture,
  readCeremonyEvidence, ceremonyJournalPath, rotateGuardPath, loadRotateGuardIntoStore,
  ROTATE_VERIFY_MAX_ATTEMPTS, ROTATE_LOCK_MS, PHRASE_KDF_V2, normalizePhrase,
  bindStatusCorsHeaders, BIND_STATUS_CORS_ORIGINS, BIND_PHRASE_WORDS,
  type BindStore,
} from '../src/aumlokBindCeremony';
import { generateAcrosticPhrase } from '../src/aumlokPhrase';
import { hybridBundleDir } from '../src/aumlokBindV2';
import { generateKeypair } from '../src/aumlokSigner';
import { pinAuthorityRoot, serializeRootManifest } from '../src/aumlokAuthorityRoot';
import { scryptSync } from 'crypto';

const T0 = Date.parse('2026-07-10T12:00:00.000Z');
let home: string;
let store: BindStore;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'aumlok-canonical-'));
  store = freshBindStore();
});

function fpPath(): string { return path.join(home, 'aumlok', 'phrase-fingerprint.json'); }
function readFp(): Record<string, unknown> { return JSON.parse(fs.readFileSync(fpPath(), 'utf-8')); }

function bind(): { phrase: string } {
  const m = mintBindCandidate(store, home, T0);
  if (!m.ok) throw new Error('mint failed');
  const done = completeCeremony(store, home, m.phrase, m.nonce, T0 + 1000);
  if (!done.ok) throw new Error('bind failed');
  return { phrase: m.phrase };
}

/** A LEGACY v1 sovereign node with a KNOWN phrase (scrypt-v2 fingerprint at the v1 path, exactly as
 *  the pre-#361 ceremony wrote it). Since Cycle A a fresh ceremony bind is hybrid v2 and phrase
 *  ROTATION runs only on these existing v1 nodes — every rotation law below is pinned against this
 *  manufactured shape so the machinery guarding real legacy owners never silently rots. */
function bindLegacy(phrase = 'harbor-hazel-amber-raven-birch-ochre-quill'): { phrase: string } {
  const dir = path.join(home, 'aumlok');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const { privateKeyHex, publicKeyHex } = generateKeypair();
  fs.writeFileSync(path.join(dir, 'authority-ed25519.key'), privateKeyHex, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'authority-ed25519.pub'), publicKeyHex);
  fs.writeFileSync(path.join(dir, 'authority-root.json'), serializeRootManifest(pinAuthorityRoot(publicKeyHex)));
  const saltHex = randomBytes(16).toString('hex');
  const hashHex = scryptSync(normalizePhrase(phrase), Buffer.from(saltHex, 'hex'), PHRASE_KDF_V2.keyLen, { N: PHRASE_KDF_V2.N, r: PHRASE_KDF_V2.r, p: PHRASE_KDF_V2.p, maxmem: PHRASE_KDF_V2.maxmem }).toString('hex');
  fs.writeFileSync(fpPath(), JSON.stringify({ schema: 'aumlok-phrase-fingerprint-v2', kdf: 'scrypt', N: PHRASE_KDF_V2.N, r: PHRASE_KDF_V2.r, p: PHRASE_KDF_V2.p, saltHex, hashHex, updatedAt: new Date(T0).toISOString(), rotations: 0 }, null, 2) + '\n', { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'binding-receipt.json'), JSON.stringify({ schema: 'aumlok-binding-receipt-v1', keyId: publicKeyHex.slice(0, 12), publicKeyHex, phraseFingerprintSha256: hashHex, boundAt: new Date(T0).toISOString(), advisoryOnly: true, grantsAuthority: false, note: 'legacy', drandAnchor: null, rotations: [] }, null, 2) + '\n', { mode: 0o600 });
  return { phrase };
}

/** Write a LEGACY v1 fingerprint exactly as the old writers did (salted sha256 over the normalized phrase). */
function writeLegacyV1(phrase: string): void {
  const saltHex = randomBytes(16).toString('hex');
  const sha256Hex = createHash('sha256').update(saltHex + '|' + phrase, 'utf-8').digest('hex');
  fs.mkdirSync(path.join(home, 'aumlok'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(fpPath(), JSON.stringify({ schema: 'aumlok-phrase-fingerprint-v1', saltHex, sha256Hex, updatedAt: new Date(T0).toISOString(), rotations: 0 }, null, 2) + '\n', { mode: 0o600 });
}

describe('the acrostic (core-owned, the owner\'s ROOT·UNITE·RISE design)', () => {
  it('SEVEN words: a six-letter anchor as word zero, then six whose initials spell it; phrase is all seven', () => {
    for (let i = 0; i < 20; i++) {
      const a = generateAcrosticPhrase();
      expect(a.anchor).toHaveLength(6);
      expect(a.words).toHaveLength(6);
      expect(a.words.map((w) => w[0]).join('')).toBe(a.anchor); // the six spell the anchor
      expect(a.tokens).toEqual([a.anchor, ...a.words]);          // word zero is the anchor
      expect(a.tokens).toHaveLength(7);
      expect(a.phrase).toBe([a.anchor, ...a.words].join('-'));   // canonical phrase = seven tokens
      expect(new Set(a.words).size).toBe(6); // no repeated themed words
    }
  });
});

describe('fresh bind — versioned memory-hard fingerprint', () => {
  it('writes a v2 scrypt fingerprint with recorded params INSIDE the hybrid bundle, and evidence says bind_ok_v2', () => {
    bind();
    const fp = JSON.parse(fs.readFileSync(path.join(hybridBundleDir(home), 'phrase-fingerprint.json'), 'utf-8'));
    expect(fp.schema).toBe('aumlok-phrase-fingerprint-v2');
    expect(fp.kdf).toBe('scrypt');
    expect(fp.N).toBe(1 << 15);
    expect(typeof fp.hashHex).toBe('string');
    expect('sha256Hex' in fp).toBe(false);
    expect(readCeremonyEvidence(home).map((e) => e.event)).toContain('bind_ok_v2');
  });

  it('same node cannot free-remint: a sovereign node refuses the bind mint', () => {
    bind();
    const again = mintBindCandidate(store, home, T0 + 5000);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toContain('already bound');
  });
});

describe('rotation — old-phrase proof, lockout, evidence', () => {
  it('correct old phrase rotates (legacy v1 node): fresh v2 fingerprint, rotate_ok evidence, old phrase dead', () => {
    const { phrase } = bindLegacy();
    const before = readFp();
    const begin = beginPhraseRotation(store, home, phrase, T0 + 10_000);
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    const done = completeCeremony(store, home, begin.phrase, begin.nonce, T0 + 11_000);
    expect(done.ok).toBe(true);
    const after = readFp();
    expect(after.hashHex).not.toBe(before.hashHex);
    expect(readCeremonyEvidence(home).map((e) => e.event)).toContain('rotate_ok');
    expect(beginPhraseRotation(store, home, phrase, T0 + 12_000).ok).toBe(false); // the retired phrase proves nothing
  });

  it('wrong old phrase refuses with durable rotate_refused_old_phrase evidence (legacy v1 node)', () => {
    bindLegacy();
    expect(beginPhraseRotation(store, home, 'wrong-words-entirely-here-now-six', T0 + 10_000).ok).toBe(false);
    expect(readCeremonyEvidence(home).map((e) => e.event)).toContain('rotate_refused_old_phrase');
  });

  it('lockout after repeated mismatches, with rotate_locked evidence; the window actually locks (legacy v1 node)', () => {
    const { phrase } = bindLegacy();
    for (let k = 0; k < ROTATE_VERIFY_MAX_ATTEMPTS; k++) {
      expect(beginPhraseRotation(store, home, 'not-it', T0 + 10_000 + k).ok).toBe(false);
    }
    expect(readCeremonyEvidence(home).map((e) => e.event)).toContain('rotate_locked');
    // even the CORRECT phrase refuses inside the lock window
    expect(beginPhraseRotation(store, home, phrase, T0 + 10_010).ok).toBe(false);
    // and works again after the window
    expect(beginPhraseRotation(store, home, phrase, T0 + 10_010 + ROTATE_LOCK_MS + 1).ok).toBe(true);
  });
});

describe('legacy v1 posture — prove-then-upgrade, never a silent reset', () => {
  it('a correct old phrase against a LEGACY v1 file rotates and MIGRATES the fingerprint to v2', () => {
    bindLegacy();
    const legacyPhrase = 'amber-bond-cedar-dance-elm-faith';
    writeLegacyV1(legacyPhrase);
    const begin = beginPhraseRotation(store, home, legacyPhrase, T0 + 10_000);
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    const done = completeCeremony(store, home, begin.phrase, begin.nonce, T0 + 11_000);
    expect(done.ok).toBe(true);
    const fp = readFp();
    expect(fp.schema).toBe('aumlok-phrase-fingerprint-v2');
    const events = readCeremonyEvidence(home).map((e) => e.event);
    expect(events).toContain('fingerprint_migrated_v1_to_v2');
    expect(events).toContain('rotate_ok');
  });

  it('a wrong phrase against a legacy v1 file refuses — the legacy file is verified, not bypassed', () => {
    bindLegacy();
    writeLegacyV1('amber-bond-cedar-dance-elm-faith');
    expect(beginPhraseRotation(store, home, 'totally-wrong-words-here-now-six', T0 + 10_000).ok).toBe(false);
    expect(readFp().schema).toBe('aumlok-phrase-fingerprint-v1'); // untouched — refusal never rewrites
  });

  it('an UNRECOGNIZED fingerprint format refuses loudly and never resets the file', () => {
    bindLegacy();
    fs.writeFileSync(fpPath(), JSON.stringify({ schema: 'something-else-v9', blob: 'x' }) + '\n');
    const v = beginPhraseRotation(store, home, 'any-words-at-all-right-now-six', T0 + 10_000);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain('no silent reset');
    expect(readFp().schema).toBe('something-else-v9'); // byte-for-byte posture: refused, not replaced
    expect(readCeremonyEvidence(home).map((e) => e.event)).toContain('rotate_refused_unrecognized_fingerprint');
  });
});

describe('no plaintext phrase anywhere; approval unaffected; the weak writer is gone', () => {
  it('the phrase appears in NO file under aumlok/ — fingerprint, receipt, and journal are all clean', () => {
    const { phrase } = bind();
    const dir = path.join(home, 'aumlok');
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (!fs.statSync(p).isFile()) continue;
      const body = fs.readFileSync(p, 'utf-8');
      expect(body.includes(phrase), `${f} must not contain the phrase`).toBe(false);
      for (const w of phrase.split('-')) expect(body.includes(`"${w}"`), `${f} must not contain phrase word ${w}`).toBe(false);
    }
    expect(fs.existsSync(ceremonyJournalPath(home))).toBe(true);
  });

  it('STRUCTURAL: the approve door no longer mints, confirms, or writes the phrase fingerprint', () => {
    const door = fs.readFileSync(path.join(__dirname, '..', '..', 'spatial', 'aumlok-approve-serve.ts'), 'utf-8');
    expect(door).not.toContain('writePhraseFingerprint');
    expect(door).not.toContain('generateAcrostic()');
    expect(door).not.toContain('WORDS_THEMED');
    expect(door).toContain('410'); // the tombstone for the retired writers
    // the proposal-approval factor is untouched: bound challenge + local key ceremony still present
    expect(door).toContain('verifyAndConsumeChallenge');
    expect(door).toContain('approveAndApplyProposal');
  });

  it('STRUCTURAL: rotation no longer requires an environment variable; the acrostic lives in core', () => {
    const bindDoor = fs.readFileSync(path.join(__dirname, '..', '..', 'spatial', 'aumlok-bind-serve.ts'), 'utf-8');
    expect(bindDoor).not.toContain('AUKORA_AUMLOK_REBIND');
    const kernel = fs.readFileSync(path.join(__dirname, '..', '..', 'core', 'src', 'aumlokBindCeremony.ts'), 'utf-8');
    expect(kernel).toContain("from './aumlokPhrase'");
    const startNode = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'start-node.ts'), 'utf-8');
    expect(startNode).not.toContain('AUKORA_AUMLOK_REBIND');
    expect(startNode).toContain('HYBRID_STARTUP_FILES');
    for (const required of ['authority-ed25519.key', 'authority-mldsa65.key', 'authority-root-v2.json', 'binding-receipt-v2.json', 'bind-commit-v2.json']) {
      expect(startNode).toContain(required);
    }
    expect(startNode).toContain('const URL = NODE_IS_UNBOUND ? BIND_URL : SPATIAL_URL');
  });
});

describe('REVIEW FIX 1 — the rotation lockout survives a door restart (durable guard)', () => {
  it('wrong-guess attempts persist across fresh stores: a restart cannot mint fresh guesses (legacy v1 node)', () => {
    const { phrase } = bindLegacy();
    // burn all-but-one attempt in store A
    for (let k = 0; k < ROTATE_VERIFY_MAX_ATTEMPTS - 1; k++) {
      expect(beginPhraseRotation(store, home, 'not-it', T0 + 10_000 + k).ok).toBe(false);
    }
    // RESTART: brand-new store (what a killed+relaunched door gets)
    const restarted = freshBindStore();
    const last = beginPhraseRotation(restarted, home, 'still-not-it', T0 + 10_100);
    expect(last.ok).toBe(false);
    if (!last.ok) expect(last.reason).toContain('locked'); // the ONE remaining attempt locked it — nothing reset
    expect(readCeremonyEvidence(home).map((e) => e.event)).toContain('rotate_locked');
    // a THIRD fresh store inside the window: even the CORRECT phrase refuses
    expect(beginPhraseRotation(freshBindStore(), home, phrase, T0 + 10_200).ok).toBe(false);
    // and after the window, a fresh store rotates normally
    expect(beginPhraseRotation(freshBindStore(), home, phrase, T0 + 10_200 + ROTATE_LOCK_MS + 1).ok).toBe(true);
  });

  it('the guard file is content-free (no phrase, no hashes) and loadRotateGuardIntoStore merges most-restrictive', () => {
    const { phrase } = bindLegacy();
    expect(beginPhraseRotation(store, home, 'wrong-guess-one', T0 + 10_000).ok).toBe(false);
    const guardRaw = fs.readFileSync(rotateGuardPath(home), 'utf-8');
    const guard = JSON.parse(guardRaw);
    expect(guard.schema).toBe('aumlok-rotate-guard-v1');
    expect(Object.keys(guard).sort()).toEqual(['advisoryOnly', 'attemptsLeft', 'grantsAuthority', 'lockedUntil', 'schema', 'updatedAt']);
    for (const w of phrase.split('-')) expect(guardRaw.includes(w)).toBe(false);
    const fresh = freshBindStore();
    loadRotateGuardIntoStore(fresh, home);
    expect(fresh.rotateAttemptsLeft).toBe(ROTATE_VERIFY_MAX_ATTEMPTS - 1); // the burned attempt survived
  });
});

describe('REVIEW FIX 2 — v2 KDF parameters are an exact allowlist, never attacker-chosen', () => {
  it.each([
    ['weakened N', { N: 2 }],
    ['memory-bomb N', { N: 1 << 25 }],
    ['tampered r', { r: 99 }],
    ['tampered p', { p: 16 }],
  ])('a v2 file with %s refuses (unrecognized), file byte-for-byte untouched, scrypt never runs on it', (_name, patch) => {
    const { phrase } = bindLegacy();
    const tampered = { ...JSON.parse(fs.readFileSync(fpPath(), 'utf-8')), ...patch };
    const bytes = JSON.stringify(tampered) + '\n';
    fs.writeFileSync(fpPath(), bytes);
    const v = beginPhraseRotation(freshBindStore(), home, phrase, T0 + 10_000);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain('no silent reset');
    expect(fs.readFileSync(fpPath(), 'utf-8')).toBe(bytes); // untouched
    expect(readCeremonyEvidence(home).map((e) => e.event)).toContain('rotate_refused_unrecognized_fingerprint');
  });
});

describe('REVIEW FIX 3 — the bound-node shell phrase panel targets :7095, never the retired :7094/phrase', () => {
  const shell = fs.readFileSync(path.join(__dirname, '..', '..', 'spatial', 'app', 'aumlok.js'), 'utf-8');
  // isolate the phrase-panel function body so approval-panel :7094 usage never masks a regression here
  const panelStart = shell.indexOf('async function mountPhrasePanel');
  const panelEnd = shell.indexOf('async function mountGatePanel');
  const panel = shell.slice(panelStart, panelEnd);

  it('splits the two door constants', () => {
    expect(shell).toContain("const GATE_URL = 'http://127.0.0.1:7094'");
    expect(shell).toContain("const BIND_URL = 'http://127.0.0.1:7095'");
  });

  it('NO phrase action anywhere targets the retired :7094/phrase route', () => {
    expect(shell).not.toContain("GATE_URL + '/phrase'");
    expect(shell).not.toContain("7094/phrase'");
    expect(shell).not.toContain('7094/phrase"');
  });

  it('the phrase panel probes status, reachability, and the iframe at :7095 (BIND_URL) only — no GATE_URL', () => {
    expect(panel).toContain("BIND_URL + '/api/bind/status'");
    expect(panel).toContain('BIND_URL');
    expect(panel).not.toContain('GATE_URL'); // the whole phrase panel is off :7094 now
    expect(panel).not.toContain('/api/phrase/status'); // the retired crest endpoint is not used here
  });

  it('posture drives Create vs Rotate labels', () => {
    expect(panel).toContain('Create my phrase');
    expect(panel).toContain('Rotate my phrase');
    expect(panel).toContain("st.posture === 'sovereign'");
  });

  it('proposal approval is untouched: the gate panel still embeds :7094', () => {
    const gatePanel = shell.slice(shell.indexOf('async function mountGatePanel'));
    expect(gatePanel).toContain('GATE_URL');
  });
});

describe('REVIEW FIX (owner) — the canonical phrase is SEVEN typed words (anchor + six)', () => {
  it('a fresh bind mints seven tokens, word zero is the anchor, and the full seven type-back binds', () => {
    const m = mintBindCandidate(store, home, T0);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(BIND_PHRASE_WORDS).toBe(7);
    expect(m.tokens).toHaveLength(7);
    expect(m.tokens[0]).toBe(m.anchor);
    expect(m.phrase.split('-')).toHaveLength(7);
    const done = completeCeremony(store, home, m.tokens.join(' '), m.nonce, T0 + 1000);
    expect(done.ok).toBe(true);
    expect(bindPosture(home)).toBe('sovereign');
  });

  it('the six-word tail alone (no anchor) is REFUSED — the anchor is part of the phrase', () => {
    const m = mintBindCandidate(store, home, T0);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    const tailOnly = m.words.join(' '); // the six themed words WITHOUT the anchor
    const done = completeCeremony(store, home, tailOnly, m.nonce, T0 + 1000);
    expect(done.ok).toBe(false);
    expect(bindPosture(home)).toBe('unbound');
  });

  it('a legacy SHORTER phrase still VERIFIES for the old-phrase proof, and the rotation writes seven-word v2', () => {
    // simulate a node bound under the previous six-word form: a v1 fingerprint over six words.
    bindLegacy(); // legacy key material, then overwrite the fingerprint with the six-word v1 shape
    const legacySix = 'harbor-hazel-amber-raven-birch-ochre';
    const saltHex = randomBytes(16).toString('hex');
    const sha256Hex = createHash('sha256').update(saltHex + '|' + legacySix, 'utf-8').digest('hex');
    fs.writeFileSync(fpPath(), JSON.stringify({ schema: 'aumlok-phrase-fingerprint-v1', saltHex, sha256Hex, updatedAt: new Date(T0).toISOString(), rotations: 0 }, null, 2) + '\n');
    // the OLD six-word phrase proves; the NEW candidate is seven-word; completing writes seven-word v2
    const begin = beginPhraseRotation(store, home, legacySix, T0 + 10_000);
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    expect(begin.tokens).toHaveLength(7);
    const done = completeCeremony(store, home, begin.tokens.join(' '), begin.nonce, T0 + 11_000);
    expect(done.ok).toBe(true);
    expect(readFp().schema).toBe('aumlok-phrase-fingerprint-v2'); // migrated to seven-word v2
    expect(readCeremonyEvidence(home).map((e) => e.event)).toContain('fingerprint_migrated_v1_to_v2');
  });

  it('no plaintext phrase leaks into any aumlok/ file after a seven-word bind', () => {
    const m = mintBindCandidate(store, home, T0);
    if (!m.ok) throw new Error('mint');
    completeCeremony(store, home, m.tokens.join(' '), m.nonce, T0 + 1000);
    for (const f of fs.readdirSync(path.join(home, 'aumlok'))) {
      const p = path.join(home, 'aumlok', f);
      if (!fs.statSync(p).isFile()) continue;
      const body = fs.readFileSync(p, 'utf-8');
      for (const tok of m.tokens) expect(body.includes('"' + tok + '"')).toBe(false);
      expect(body.includes(m.phrase)).toBe(false);
    }
  });
});

describe('REVIEW FIX (CORS) — GET /api/bind/status permits exactly the shell origins, never a wildcard', () => {
  it('echoes an ALLOWED shell origin and always sets Vary: Origin', () => {
    for (const origin of BIND_STATUS_CORS_ORIGINS) {
      const h = bindStatusCorsHeaders(origin);
      expect(h['access-control-allow-origin']).toBe(origin);
      expect(h['vary']).toBe('Origin');
    }
    expect(BIND_STATUS_CORS_ORIGINS).toEqual(['http://127.0.0.1:7090', 'http://localhost:7090']);
  });

  it('a DISALLOWED origin (or none) gets NO Access-Control-Allow-Origin, still Vary: Origin, never a wildcard', () => {
    for (const origin of ['https://evil.example', 'http://127.0.0.1:9999', null, undefined, '']) {
      const h = bindStatusCorsHeaders(origin as never);
      expect('access-control-allow-origin' in h).toBe(false);
      expect(h['vary']).toBe('Origin');
      expect(Object.values(h)).not.toContain('*');
    }
  });

  it('accepts an explicit configured shell-origin set without widening the default allowlist', () => {
    const configured = ['http://127.0.0.1:17990', 'http://localhost:17990'] as const;
    expect(bindStatusCorsHeaders(configured[0], configured)['access-control-allow-origin']).toBe(configured[0]);
    expect(bindStatusCorsHeaders(configured[0])['access-control-allow-origin']).toBeUndefined();
  });

  it('STRUCTURAL: only the status route wires CORS; mutation routes and the bind status fetch are shell-origin-ready', () => {
    const door = fs.readFileSync(path.join(__dirname, '..', '..', 'spatial', 'aumlok-bind-serve.ts'), 'utf-8');
    expect(door).toContain("bindStatusCorsHeaders(req.headers.get('origin'), SPATIAL_ORIGINS)");
    // the mutation routes (mint/rotate/complete) must NOT attach CORS headers
    const rotateRoute = door.slice(door.indexOf("'/api/bind/rotate'"), door.indexOf("'/api/bind/complete'"));
    expect(rotateRoute).not.toContain('bindStatusCorsHeaders');
  });
});
