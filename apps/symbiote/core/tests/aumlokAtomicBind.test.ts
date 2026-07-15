// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// ATOMIC FIRST BIND. Since #361 Fable Finish Cycle A the fresh ceremony bind is the HYBRID v2
// transaction (bindHybridV2): complete bundle staged, verified from bytes, published by ONE atomic
// rename — so a fault at ANY boundary leaves the node honestly unbound with NO partial destination,
// and retry converges to exactly ONE coherent identity. These tests inject fs faults at every v2
// write/rename boundary and prove those laws at the CEREMONY level. The v1 staged-commit machinery
// no longer runs for fresh binds, but its READ side (classification, quarantine, posture, rotation)
// still guards every EXISTING v1 node — those laws are pinned here against manufactured legacy
// bundles, byte-for-byte as the old writer left them. Real kernel, real files in tmp homes.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// fs fault-injection seam: ESM namespaces cannot be spied, so the WHOLE 'fs' module is wrapped
// once (hoisted) with two pass-through hooks the tests drive. Hooks default to inert.
const fsCtl = vi.hoisted(() => ({
  onOpen: null as null | ((p: string) => void | 'throw'),
  onRename: null as null | ((from: string, to: string) => void | 'throw'),
}));
vi.mock('fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('fs')>();
  const wrapped = {
    ...real,
    openSync: ((p: unknown, flags: unknown, mode?: unknown) => {
      if (fsCtl.onOpen?.(String(p)) === 'throw') throw new Error('injected: openSync');
      return real.openSync(p as never, flags as never, mode as never);
    }) as typeof real.openSync,
    renameSync: ((a: unknown, b: unknown) => {
      if (fsCtl.onRename?.(String(a), String(b)) === 'throw') throw new Error('injected: renameSync');
      return real.renameSync(a as never, b as never);
    }) as typeof real.renameSync,
  };
  return { ...wrapped, default: wrapped };
});
import { createHash, randomBytes } from 'crypto';
import {
  freshBindStore, mintBindCandidate, completeCeremony, beginPhraseRotation, bindPosture,
  classifyBindBundle, classifyBindStartup, readCeremonyEvidence,
  type BindStore,
} from '../src/aumlokBindCeremony';
import { hybridBindStatusV2, hybridBundleDir, hybridV2StatePresent } from '../src/aumlokBindV2';
import { generateKeypair } from '../src/aumlokSigner';
import { pinAuthorityRoot, serializeRootManifest, keyIdFor } from '../src/aumlokAuthorityRoot';

const T0 = Date.parse('2026-07-11T12:00:00.000Z');
const AUM = (h: string) => path.join(h, 'aumlok');
const V1_FILES = ['authority-ed25519.key', 'authority-ed25519.pub', 'authority-root.json', 'phrase-fingerprint.json', 'binding-receipt.json'] as const;
const V2_BUNDLE_FILES = ['authority-ed25519.key', 'authority-mldsa65.key', 'authority-ed25519.pub', 'authority-mldsa65.pub', 'authority-root-v2.json', 'phrase-fingerprint.json', 'binding-receipt-v2.json', 'bind-commit-v2.json'] as const;

let home: string;
let store: BindStore;
beforeEach(() => {
  fsCtl.onOpen = null; fsCtl.onRename = null;
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'aumlok-atomic-'));
  store = freshBindStore();
});
afterEach(() => { fsCtl.onOpen = null; fsCtl.onRename = null; });

function tryBind(): { ok: boolean; phrase?: string } {
  const m = mintBindCandidate(store, home, T0);
  if (!m.ok) return { ok: false };
  try {
    const done = completeCeremony(store, home, m.phrase, m.nonce, T0 + 1000);
    return { ok: done.ok, phrase: m.phrase };
  } catch { return { ok: false, phrase: m.phrase }; }
}

/** The convergence oath, v2 edition: after ANY recovery, exactly one coherent HYBRID identity stands —
 *  full custody coherence (seeds re-derive the pinned root), never a manifest-alone claim — and no v1
 *  key material exists anywhere beside it. */
function assertOneCoherentIdentityV2(): void {
  expect(bindPosture(home)).toBe('sovereign');
  expect(classifyBindBundle(home).state).toBe('complete');
  const v2 = hybridBindStatusV2(home);
  expect(v2.bound).toBe(true);
  for (const f of V2_BUNDLE_FILES) expect(fs.existsSync(path.join(hybridBundleDir(home), f))).toBe(true);
  expect(fs.existsSync(path.join(AUM(home), 'authority-ed25519.key'))).toBe(false); // no classical sibling
}

/** A pre-brick v1 node exactly as the old writer left it: five files, no marker, v1 fingerprint. The
 *  ceremony can no longer CREATE this shape — but it must keep READING it correctly forever. */
function writeLegacySovereign(phrase: string): { publicKeyHex: string } {
  fs.mkdirSync(AUM(home), { recursive: true, mode: 0o700 });
  const { privateKeyHex, publicKeyHex } = generateKeypair(); // a REAL pair — coherence derives pub from priv
  const keyId = publicKeyHex.slice(0, 12);
  fs.writeFileSync(path.join(AUM(home), 'authority-ed25519.key'), privateKeyHex, { mode: 0o600 });
  fs.writeFileSync(path.join(AUM(home), 'authority-ed25519.pub'), publicKeyHex);
  fs.writeFileSync(path.join(AUM(home), 'authority-root.json'), serializeRootManifest(pinAuthorityRoot(publicKeyHex)));
  const saltHex = randomBytes(16).toString('hex');
  const sha256Hex = createHash('sha256').update(saltHex + '|' + phrase, 'utf-8').digest('hex');
  fs.writeFileSync(path.join(AUM(home), 'phrase-fingerprint.json'), JSON.stringify({ schema: 'aumlok-phrase-fingerprint-v1', saltHex, sha256Hex, updatedAt: new Date(T0).toISOString(), rotations: 0 }, null, 2) + '\n', { mode: 0o600 });
  fs.writeFileSync(path.join(AUM(home), 'binding-receipt.json'), JSON.stringify({ schema: 'aumlok-binding-receipt-v1', keyId, publicKeyHex, phraseFingerprintSha256: sha256Hex, boundAt: new Date(T0).toISOString(), advisoryOnly: true, grantsAuthority: false, note: 'legacy', drandAnchor: null, rotations: [] }, null, 2) + '\n', { mode: 0o600 });
  return { publicKeyHex };
}

describe('fault injection at every v2 write boundary — nothing partial ever reads sovereign', () => {
  it('a failing staged write (each of the eight bundle files) leaves the node honestly unbound, and retry converges', () => {
    for (let failAt = 1; failAt <= 8; failAt++) {
      home = fs.mkdtempSync(path.join(os.tmpdir(), 'aumlok-atomic-w-'));
      store = freshBindStore();
      let n = 0;
      fsCtl.onOpen = (p) => {
        if (p.includes('.bindv2-') && V2_BUNDLE_FILES.some((f) => p.endsWith(f))) { n += 1; if (n === failAt) return 'throw'; }
      };

      const first = tryBind();
      expect(first.ok).toBe(false);
      fsCtl.onOpen = null;
      expect(bindPosture(home)).toBe('unbound');                          // never sovereign from a wounded stage
      expect(fs.existsSync(hybridBundleDir(home))).toBe(false);           // NO partial destination — ever
      expect(hybridV2StatePresent(home)).toBe(false);                     // staging + lock fully cleaned

      const retry = tryBind();
      expect(retry.ok).toBe(true);
      assertOneCoherentIdentityV2();
    }
  });

  it('a failing PUBLISH rename leaves no destination at all, and retry converges to ONE identity with no quarantine debris', () => {
    fsCtl.onRename = (_a, b) => { if (b.endsWith(path.sep + 'hybrid-v2') || b.endsWith('/hybrid-v2')) return 'throw'; };
    const first = tryBind();
    expect(first.ok).toBe(false);
    fsCtl.onRename = null;
    expect(fs.existsSync(hybridBundleDir(home))).toBe(false); // the ONE atomic boundary refused → nothing committed
    expect(bindPosture(home)).toBe('unbound');
    expect(hybridV2StatePresent(home)).toBe(false);

    const retry = tryBind();
    expect(retry.ok).toBe(true);
    assertOneCoherentIdentityV2();
    // the v2 transaction leaves nothing to quarantine — that is the improvement over the v1 rename train
    expect(fs.readdirSync(AUM(home)).filter((d) => d.startsWith('quarantine-bind-'))).toHaveLength(0);
  });

  it('a failing completion-marker write inside staging refuses the WHOLE bind — the marker is part of the atomic bundle, not a post-publish afterthought', () => {
    fsCtl.onOpen = (p) => { if (p.includes('.bindv2-') && p.endsWith('bind-commit-v2.json')) return 'throw'; };
    const first = tryBind();
    expect(first.ok).toBe(false);
    fsCtl.onOpen = null;
    // v1 had a "success with marker-repair note" seam; v2 cannot: no marker, no bundle, no success claim
    expect(fs.existsSync(hybridBundleDir(home))).toBe(false);
    expect(bindPosture(home)).toBe('unbound');
    const retry = tryBind();
    expect(retry.ok).toBe(true);
    assertOneCoherentIdentityV2();
    expect(readCeremonyEvidence(home, 10).some((e) => e.event === 'bind_ok_v2')).toBe(true);
  });

  it('coherence is PROVEN, not presumed: a stranger seed in the published bundle (all files present) classifies partial', () => {
    expect(tryBind().ok).toBe(true);
    fs.writeFileSync(path.join(hybridBundleDir(home), 'authority-ed25519.key'), randomBytes(32).toString('hex'), { mode: 0o600 });
    expect(classifyBindBundle(home).state).toBe('partial'); // seed no longer DERIVES the pinned pub
    expect(bindPosture(home)).toBe('unbound');
  });

  it('a structurally malformed bundle fingerprint classifies partial (v2 validates the closed shape; the hash plaintext stays dark)', () => {
    expect(tryBind().ok).toBe(true);
    const fpPath = path.join(hybridBundleDir(home), 'phrase-fingerprint.json');
    const fp = JSON.parse(fs.readFileSync(fpPath, 'utf-8'));
    fp.saltHex = 'abcd'; // not the exact 16-byte salt the closed shape requires
    fs.writeFileSync(fpPath, JSON.stringify(fp, null, 2) + '\n', { mode: 0o600 });
    expect(classifyBindBundle(home).state).toBe('partial');
    expect(bindPosture(home)).toBe('unbound');
  });

  it('a tampered v2 marker (wrong rootId) breaks bundle coherence — never accepted as this identity commit', () => {
    expect(tryBind().ok).toBe(true);
    const markerPath = path.join(hybridBundleDir(home), 'bind-commit-v2.json');
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
    marker.rootId = 'a'.repeat(64);
    fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2) + '\n', { mode: 0o600 });
    expect(classifyBindBundle(home).state).toBe('partial');
    expect(bindPosture(home)).toBe('unbound');
  });

  it('the publish is ONE rename: every staged bundle write precedes it, and nothing ever writes into the published path', () => {
    const ops: string[] = [];
    fsCtl.onOpen = (p) => {
      if (p.includes('.bindv2-') && V2_BUNDLE_FILES.some((f) => p.endsWith(f))) ops.push('stage:' + path.basename(p));
      if (p.includes(path.sep + 'hybrid-v2' + path.sep)) ops.push('published-write:' + path.basename(p));
    };
    fsCtl.onRename = (_a, b) => { if (b.endsWith('hybrid-v2')) ops.push('publish'); };
    expect(tryBind().ok).toBe(true);
    const publishAt = ops.indexOf('publish');
    expect(publishAt).toBeGreaterThan(0);
    expect(ops.filter((o) => o === 'publish')).toHaveLength(1);                       // exactly ONE commit boundary
    expect(ops.filter((o) => o.startsWith('stage:')).length).toBeGreaterThanOrEqual(8); // all eight staged first
    for (let i = 0; i < ops.length; i++) if (ops[i].startsWith('stage:')) expect(i).toBeLessThan(publishAt);
    expect(ops.some((o) => o.startsWith('published-write:'))).toBe(false);            // the bundle is never written in place
  });

  it('quarantine FAILS CLOSED: a refused move means no mint, and every surviving artifact stays put', () => {
    // a key-less v1 partial: pub + manifest only
    fs.mkdirSync(AUM(home), { recursive: true, mode: 0o700 });
    const { publicKeyHex } = generateKeypair();
    fs.writeFileSync(path.join(AUM(home), 'authority-ed25519.pub'), publicKeyHex);
    fs.writeFileSync(path.join(AUM(home), 'authority-root.json'), serializeRootManifest(pinAuthorityRoot(publicKeyHex)));
    fsCtl.onRename = () => 'throw'; // every quarantine move refuses
    const m = mintBindCandidate(store, home, T0);
    expect(m.ok).toBe(false);
    fsCtl.onRename = null;
    expect(fs.existsSync(path.join(AUM(home), 'authority-ed25519.pub'))).toBe(true); // survivors untouched
    expect(fs.existsSync(path.join(AUM(home), 'authority-root.json'))).toBe(true);
    expect(readCeremonyEvidence(home, 5).some((e) => e.event === 'bind_partial_quarantine_failed')).toBe(true);
    // hooks off → the same mint now quarantines cleanly and binds fresh (hybrid v2)
    expect(tryBind().ok).toBe(true);
    assertOneCoherentIdentityV2();
    // the refused attempt leaves its empty exclusive dir behind (collision-safe by design); exactly ONE
    // quarantine actually holds the preserved v1 partial — nothing was deleted
    const quarantines = fs.readdirSync(AUM(home)).filter((d) => d.startsWith('quarantine-bind-'));
    const nonEmpty = quarantines.filter((d) => fs.readdirSync(path.join(AUM(home), d)).length > 0);
    expect(nonEmpty).toHaveLength(1);
    expect(fs.readdirSync(path.join(AUM(home), nonEmpty[0])).sort()).toEqual(['authority-ed25519.pub', 'authority-root.json']);
  });
});

describe('posture is a bundle claim, never a key-file claim', () => {
  it('a lone private-key file (the pre-brick ghost) reads UNBOUND, is classified partial and loud, and mint refuses to touch it', () => {
    fs.mkdirSync(AUM(home), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(AUM(home), 'authority-ed25519.key'), 'deadbeef'.repeat(8), { mode: 0o600 });
    expect(bindPosture(home)).toBe('unbound'); // THE fix: key-file-exists is not sovereign
    const c = classifyBindStartup(home, T0);
    expect(c.state).toBe('partial');
    expect(readCeremonyEvidence(home, 5).some((e) => e.event === 'bind_partial_detected')).toBe(true);
    const m = mintBindCandidate(store, home, T0);
    expect(m.ok).toBe(false); // key material present: the owner decides, never the machine
    expect(fs.existsSync(path.join(AUM(home), 'authority-ed25519.key'))).toBe(true); // untouched
    expect(readCeremonyEvidence(home, 5).some((e) => e.event === 'bind_partial_refused_key_present')).toBe(true);
  });

  it('five v1 files that DISAGREE (receipt from a stranger key) classify partial, never sovereign', () => {
    writeLegacySovereign('harbor-hazel-amber-raven-birch-ochre');
    const receiptPath = path.join(AUM(home), 'binding-receipt.json');
    const r = JSON.parse(fs.readFileSync(receiptPath, 'utf-8'));
    r.keyId = 'aaaaaaaaaaaa'; // a stranger's identity
    fs.writeFileSync(receiptPath, JSON.stringify(r, null, 2) + '\n', { mode: 0o600 });
    expect(classifyBindBundle(home).state).toBe('partial');
    expect(bindPosture(home)).toBe('unbound');
  });

  it('leftover v1 staging on a legacy node is disposable: startup cleans it, journals it, and touches nothing standing', () => {
    writeLegacySovereign('harbor-hazel-amber-raven-birch-ochre');
    const bytesBefore = V1_FILES.map((f) => fs.readFileSync(path.join(AUM(home), f)));
    fs.mkdirSync(path.join(AUM(home), '.bind-staging'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(AUM(home), '.bind-staging', 'junk'), 'x');
    const c = classifyBindStartup(home, T0 + 5000);
    expect(c.state).toBe('complete-legacy');
    expect(fs.existsSync(path.join(AUM(home), '.bind-staging'))).toBe(false);
    expect(readCeremonyEvidence(home, 5).some((e) => e.event === 'bind_staging_cleaned')).toBe(true);
    V1_FILES.forEach((f, i) => expect(fs.readFileSync(path.join(AUM(home), f)).equals(bytesBefore[i])).toBe(true));
  });
});

describe('existing sovereign v1 nodes: byte-untouched, rotation behaviorally identical', () => {
  it('a healthy pre-marker bundle is sovereign, classified complete-legacy, and startup changes zero bytes', () => {
    writeLegacySovereign('harbor-hazel-amber-raven-birch-ochre');
    const bytesBefore = V1_FILES.map((f) => fs.readFileSync(path.join(AUM(home), f)));
    expect(bindPosture(home)).toBe('sovereign');
    const c = classifyBindStartup(home, T0 + 1000);
    expect(c.state).toBe('complete-legacy');
    expect(c.marker).toBe(false);
    V1_FILES.forEach((f, i) => expect(fs.readFileSync(path.join(AUM(home), f)).equals(bytesBefore[i])).toBe(true));
    expect(fs.existsSync(path.join(AUM(home), 'bind-complete.json'))).toBe(false); // no silent additions
  });

  it('a MALFORMED marker on a legacy bundle is a missing marker — never a proof: bundle stays honestly complete-legacy', () => {
    writeLegacySovereign('harbor-hazel-amber-raven-birch-ochre');
    fs.writeFileSync(path.join(AUM(home), 'bind-complete.json'), 'not json at all', { mode: 0o600 });
    const c = classifyBindBundle(home);
    expect(c.state).toBe('complete-legacy');
    expect(c.marker).toBe(false);
    expect(bindPosture(home)).toBe('sovereign');
  });

  it('rotation on the legacy bundle is behaviorally identical: words prove, v1→v2 migrates, posture holds, classification stays whole', () => {
    const legacy = 'harbor-hazel-amber-raven-birch-ochre';
    const { publicKeyHex } = writeLegacySovereign(legacy);
    const begin = beginPhraseRotation(store, home, legacy, T0 + 10_000);
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    const done = completeCeremony(store, home, begin.phrase, begin.nonce, T0 + 20_000);
    expect(done.ok).toBe(true);
    expect(bindPosture(home)).toBe('sovereign');
    expect(['complete', 'complete-legacy']).toContain(classifyBindBundle(home).state);
    const fp = JSON.parse(fs.readFileSync(path.join(AUM(home), 'phrase-fingerprint.json'), 'utf-8'));
    expect(fp.schema).toBe('aumlok-phrase-fingerprint-v2');
    expect(readCeremonyEvidence(home, 10).some((e) => e.event === 'fingerprint_migrated_v1_to_v2')).toBe(true);
    // the receipt names the rotated fingerprint; the key is untouched
    const receipt = JSON.parse(fs.readFileSync(path.join(AUM(home), 'binding-receipt.json'), 'utf-8'));
    expect(receipt.rotations).toHaveLength(1);
    expect(receipt.rotations[0].phraseFingerprintSha256).toBe(fp.hashHex);
    expect(fs.readFileSync(path.join(AUM(home), 'authority-ed25519.pub'), 'utf-8')).toBe(publicKeyHex);
    // the manifest's own hash-derived convention still holds
    const manifest = JSON.parse(fs.readFileSync(path.join(AUM(home), 'authority-root.json'), 'utf-8'));
    expect(manifest.keyId).toBe(keyIdFor(publicKeyHex));
    // the OLD phrase no longer begins a rotation
    expect(beginPhraseRotation(store, home, legacy, T0 + 30_000).ok).toBe(false);
  });

  it('rotation on a NEW (hybrid v2) bind refuses honestly — v2 phrase rotation arrives with the lifecycle brick', () => {
    expect(tryBind().ok).toBe(true);
    const r = beginPhraseRotation(store, home, 'whatever-words-these-are-now-here-seven', T0 + 10_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('lifecycle brick');
    assertOneCoherentIdentityV2(); // and the refusal changed nothing
  });
});
