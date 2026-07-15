// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// LEGACY RECEIPT RECOVERY (#345): the receiptless-legacy shape found live on Peter's node — coherent
// key + manifest + fingerprint, but no binding-receipt.json and no marker. This suite builds that
// EXACT shape on fixtures and pins the recovery ceremony: owner proof under the rotation lockout law
// writes ONLY an honest advisory recovery receipt; key/pub/manifest/fingerprint stay byte-identical;
// the genesis base is unchanged; wrong phrase refuses + advances lockout with zero identity change;
// every off-shape (mismatch, tamper, receipt already present) refuses; re-running is idempotent.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash, randomBytes } from 'crypto';

// fs fault-injection seam (#346 adversarial): the whole 'fs' module is wrapped once, with a
// pass-through hook the race test uses to plant a competing receipt mid-recovery. Inert by default.
const fsCtl = vi.hoisted(() => ({
  onOpen: null as null | ((p: string) => void),
  onLink: null as null | ((from: string, to: string) => void), // fires just BEFORE the real linkSync
}));
vi.mock('fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('fs')>();
  const wrapped = {
    ...real,
    openSync: ((p: unknown, flags: unknown, mode?: unknown) => {
      fsCtl.onOpen?.(String(p));
      return real.openSync(p as never, flags as never, mode as never);
    }) as typeof real.openSync,
    linkSync: ((a: unknown, b: unknown) => {
      fsCtl.onLink?.(String(a), String(b));
      return real.linkSync(a as never, b as never);
    }) as typeof real.linkSync,
  };
  return { ...wrapped, default: wrapped };
});
import {
  freshBindStore, bindPosture, classifyBindBundle, legacyRecoveryRequired, recoverLegacyReceipt,
  beginPhraseRotation, completeCeremony, readCeremonyEvidence, ROTATE_VERIFY_MAX_ATTEMPTS,
  type BindStore,
} from '../src/aumlokBindCeremony';
import { generateKeypair, derivePublicKeyHex } from '../src/aumlokSigner';
import { pinAuthorityRoot, serializeRootManifest } from '../src/aumlokAuthorityRoot';
import { resolveGenesisBindingFacts } from '../src/aumlokGenesisBridge';

const T0 = Date.parse('2026-07-11T12:00:00.000Z');
const AUM = (h: string) => path.join(h, 'aumlok');
const STANDING = ['authority-ed25519.key', 'authority-ed25519.pub', 'authority-root.json', 'phrase-fingerprint.json'] as const;

let home: string;
let store: BindStore;
beforeEach(() => {
  fsCtl.onOpen = null; fsCtl.onLink = null;
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'aumlok-recovery-'));
  store = freshBindStore();
});
afterEach(() => { fsCtl.onOpen = null; fsCtl.onLink = null; });

const PHRASE = 'harbor-hazel-amber-raven-birch-ochre'; // a legacy six-word standing phrase

/** Build the EXACT live shape: coherent key+pub+manifest+v2 fingerprint, NO receipt, NO marker. */
function writeReceiptlessLegacy(phrase = PHRASE): { pub: string; createdAt: string } {
  fs.mkdirSync(AUM(home), { recursive: true, mode: 0o700 });
  const { privateKeyHex, publicKeyHex } = generateKeypair();
  expect(derivePublicKeyHex(privateKeyHex)).toBe(publicKeyHex); // the pair is real
  const createdAt = new Date(T0 - 86_400_000).toISOString(); // "bound yesterday", integrity-protected
  fs.writeFileSync(path.join(AUM(home), 'authority-ed25519.key'), privateKeyHex, { mode: 0o600 });
  fs.writeFileSync(path.join(AUM(home), 'authority-ed25519.pub'), publicKeyHex);
  fs.writeFileSync(path.join(AUM(home), 'authority-root.json'), serializeRootManifest(pinAuthorityRoot(publicKeyHex, { createdAt })));
  // a v2 fingerprint exactly as the kernel writes it (scrypt), so verify works through the real path
  const saltHex = randomBytes(16).toString('hex');
  // recompute via a rotation-free path: import the same scrypt params by writing then proving
  fs.writeFileSync(path.join(AUM(home), 'phrase-fingerprint.json'), fingerprintV2(phrase, saltHex), { mode: 0o600 });
  return { pub: publicKeyHex, createdAt };
}

/** Produce a real v2 fingerprint file for a phrase (mirrors the kernel's PHRASE_KDF_V2). */
function fingerprintV2(phrase: string, saltHex: string): string {
  const { scryptSync } = require('crypto') as typeof import('crypto');
  const N = 1 << 15, r = 8, p = 1;
  const hashHex = scryptSync(phrase.toLowerCase().trim().replace(/[\s_-]+/g, '-'), Buffer.from(saltHex, 'hex'), 32, { N, r, p, maxmem: 128 * 1024 * 1024 }).toString('hex');
  return JSON.stringify({ schema: 'aumlok-phrase-fingerprint-v2', kdf: 'scrypt', N, r, p, saltHex, hashHex, updatedAt: new Date(T0).toISOString(), rotations: 0 }, null, 2) + '\n';
}
const snapshot = () => STANDING.map((f) => fs.readFileSync(path.join(AUM(home), f)));

describe('the shape is recognized, and only this exact shape', () => {
  it('receiptless-legacy is recoveryRequired, partial, and NOT sovereign', () => {
    writeReceiptlessLegacy();
    expect(legacyRecoveryRequired(home)).toBe(true);
    expect(classifyBindBundle(home).state).toBe('partial');
    expect(bindPosture(home)).toBe('unbound');
  });

  it('a receipt already present, a marker present, a key/pub mismatch, or a tampered manifest are NOT recoverable', () => {
    writeReceiptlessLegacy();
    // receipt present
    fs.writeFileSync(path.join(AUM(home), 'binding-receipt.json'), '{}');
    expect(legacyRecoveryRequired(home)).toBe(false);
    fs.rmSync(path.join(AUM(home), 'binding-receipt.json'));
    expect(legacyRecoveryRequired(home)).toBe(true);
    // marker present
    fs.writeFileSync(path.join(AUM(home), 'bind-complete.json'), '{}');
    expect(legacyRecoveryRequired(home)).toBe(false);
    fs.rmSync(path.join(AUM(home), 'bind-complete.json'));
    // key/pub mismatch
    const goodPriv = fs.readFileSync(path.join(AUM(home), 'authority-ed25519.key'), 'utf-8');
    fs.writeFileSync(path.join(AUM(home), 'authority-ed25519.key'), randomBytes(32).toString('hex'), { mode: 0o600 });
    expect(legacyRecoveryRequired(home)).toBe(false);
    fs.writeFileSync(path.join(AUM(home), 'authority-ed25519.key'), goodPriv, { mode: 0o600 });
    // tampered manifest
    const m = JSON.parse(fs.readFileSync(path.join(AUM(home), 'authority-root.json'), 'utf-8'));
    m.createdAt = '2099-01-01T00:00:00.000Z'; // breaks the integrity hash
    fs.writeFileSync(path.join(AUM(home), 'authority-root.json'), JSON.stringify(m));
    expect(legacyRecoveryRequired(home)).toBe(false);
  });
});

describe('recovery under owner proof — restore lineage, touch nothing standing', () => {
  it('correct phrase → advisory receipt written, key/fingerprint byte-identical, posture complete-legacy sovereign', () => {
    const { pub, createdAt } = writeReceiptlessLegacy();
    const before = snapshot();
    const genesisBefore = resolveGenesisBindingFacts(home); // source 'root' (no receipt yet)
    const v = recoverLegacyReceipt(store, home, PHRASE, T0);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.keyId).toBe(pub.slice(0, 12));
    // the four standing artifacts are byte-for-byte unchanged
    STANDING.forEach((f, i) => expect(fs.readFileSync(path.join(AUM(home), f)).equals(before[i])).toBe(true));
    // exactly ONE new file, honest and advisory
    const r = JSON.parse(fs.readFileSync(path.join(AUM(home), 'binding-receipt.json'), 'utf-8'));
    expect(r.schema).toBe('aumlok-binding-receipt-v1');
    expect(r.publicKeyHex).toBe(pub);
    expect(r.recovery).toMatchObject({ schema: 'aumlok-legacy-recovery-v1', originalBindEvidence: 'unavailable', forgedOriginalTimestamp: false, atomicMarkerWritten: false });
    expect(r.recovery.recoveredAt).toBe(new Date(T0).toISOString());
    // PROVENANCE (#346 review): recovery NEVER claims an observed original bind time
    expect(r.recovery.originalBoundAt).toBeNull();
    expect(r.recovery.boundAtSource).toBe('authority_root_created_at_fallback');
    // boundAt carries the root createdAt ONLY for AURA continuity — and is explicitly sourced as such
    expect(r.boundAt).toBe(createdAt);
    expect(r.boundAt).not.toBe(r.recovery.recoveredAt); // the receipt does not pass recovery time off as a bind time
    expect(r.grantsAuthority).toBe(false);
    expect(fs.existsSync(path.join(AUM(home), 'bind-complete.json'))).toBe(false); // NO marker forged
    // the bundle is now whole and honestly complete-legacy; posture is sovereign
    expect(classifyBindBundle(home).state).toBe('complete-legacy');
    expect(bindPosture(home)).toBe('sovereign');
    expect(legacyRecoveryRequired(home)).toBe(false); // no longer applicable
    // the genesis base is byte-identical: boundAt = the manifest createdAt the root fallback already used
    const genesisAfter = resolveGenesisBindingFacts(home);
    expect(genesisAfter.present && genesisBefore.present).toBe(true);
    if (genesisAfter.present && genesisBefore.present) {
      expect(genesisAfter.boundAt).toBe(genesisBefore.boundAt);
      expect(genesisAfter.boundAt).toBe(createdAt);
      expect(genesisAfter.rootId).toBe(genesisBefore.rootId);
    }
    expect(readCeremonyEvidence(home, 5).some((e) => e.event === 'legacy_recovery_ok')).toBe(true);
  });

  it('the recovered node then rotates normally: current phrase proves, old refuses', () => {
    writeReceiptlessLegacy();
    expect(recoverLegacyReceipt(store, home, PHRASE, T0).ok).toBe(true);
    const begin = beginPhraseRotation(store, home, PHRASE, T0 + 10_000);
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    expect(completeCeremony(store, home, begin.phrase, begin.nonce, T0 + 20_000).ok).toBe(true);
    expect(beginPhraseRotation(store, home, PHRASE, T0 + 30_000).ok).toBe(false); // old refuses
    expect(bindPosture(home)).toBe('sovereign');
  });
});

describe('refusals — loud, byte-safe, idempotent', () => {
  it('wrong phrase refuses, advances the lockout, and changes ZERO identity bytes', () => {
    writeReceiptlessLegacy();
    const before = snapshot();
    const v = recoverLegacyReceipt(store, home, 'wrong-words-entirely-typed-right-here', T0);
    expect(v.ok).toBe(false);
    expect(store.rotateAttemptsLeft).toBe(ROTATE_VERIFY_MAX_ATTEMPTS - 1); // the shared lockout advanced
    STANDING.forEach((f, i) => expect(fs.readFileSync(path.join(AUM(home), f)).equals(before[i])).toBe(true));
    expect(fs.existsSync(path.join(AUM(home), 'binding-receipt.json'))).toBe(false); // nothing written
    expect(readCeremonyEvidence(home, 5).some((e) => e.event === 'legacy_recovery_refused_old_phrase')).toBe(true);
  });

  it('re-running recovery once a receipt exists is idempotently refused', () => {
    writeReceiptlessLegacy();
    expect(recoverLegacyReceipt(store, home, PHRASE, T0).ok).toBe(true);
    const receiptBytes = fs.readFileSync(path.join(AUM(home), 'binding-receipt.json'));
    const again = recoverLegacyReceipt(freshBindStore(), home, PHRASE, T0 + 5000);
    expect(again.ok).toBe(false);
    expect(fs.readFileSync(path.join(AUM(home), 'binding-receipt.json')).equals(receiptBytes)).toBe(true); // untouched
    expect(readCeremonyEvidence(home, 5).some((e) => e.event === 'legacy_recovery_refused_receipt_present')).toBe(true);
  });

  it('recovery over a NON-recoverable shape (no key at all) refuses and writes nothing', () => {
    fs.mkdirSync(AUM(home), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(AUM(home), 'authority-root.json'), '{}');
    const v = recoverLegacyReceipt(store, home, PHRASE, T0);
    expect(v.ok).toBe(false);
    expect(fs.existsSync(path.join(AUM(home), 'binding-receipt.json'))).toBe(false);
    expect(readCeremonyEvidence(home, 5).some((e) => e.event === 'legacy_recovery_refused_shape')).toBe(true);
  });

  it('a fresh unbound home is NOT recoveryRequired (never offer recovery where there is no key)', () => {
    expect(legacyRecoveryRequired(home)).toBe(false); // empty home
    fs.mkdirSync(AUM(home), { recursive: true });
    expect(legacyRecoveryRequired(home)).toBe(false);
  });
});

describe('adversarial publication (#346 review): symlink-safe, no-clobber', () => {
  it('a pre-existing symlink at the final receipt path is treated as a standing receipt — recovery refuses, the target is untouched, we write nothing through it', () => {
    const { pub } = writeReceiptlessLegacy();
    const victim = path.join(home, 'VICTIM.json');
    fs.writeFileSync(victim, '{"do":"not touch"}');
    const victimBytes = fs.readFileSync(victim);
    // an attacker plants a symlink where the receipt would land, pointing at a victim file
    fs.symlinkSync(victim, path.join(AUM(home), 'binding-receipt.json'));
    const v = recoverLegacyReceipt(store, home, PHRASE, T0);
    expect(v.ok).toBe(false); // statSync follows the link → looks like a standing receipt → refuse
    expect(fs.readFileSync(victim).equals(victimBytes)).toBe(true); // never written through
    // the symlink itself is untouched (we refused before any publish) and still points at the victim
    expect(fs.readlinkSync(path.join(AUM(home), 'binding-receipt.json'))).toBe(victim);
    // and no stray recovery-staging directory was left behind
    expect(fs.readdirSync(AUM(home)).some((d) => d.startsWith('.recover-stage-'))).toBe(false);
    void pub;
  });

  it('a final receipt appearing BETWEEN eligibility and publication is never overwritten; recovery refuses and preserves its bytes', () => {
    writeReceiptlessLegacy();
    const competitor = JSON.stringify({ schema: 'aumlok-binding-receipt-v1', winner: 'the-other-writer' }, null, 2) + '\n';
    let planted = false;
    // the moment recovery opens its STAGED receipt (wx, inside .recover-stage), a competing writer
    // lands the real receipt — the pre-publish revalidation must catch it and refuse.
    fsCtl.onOpen = (p) => {
      if (!planted && p.includes('.recover-stage-') && p.endsWith('binding-receipt.json')) {
        planted = true;
        fs.writeFileSync(path.join(AUM(home), 'binding-receipt.json'), competitor, { mode: 0o600 });
      }
    };
    const v = recoverLegacyReceipt(store, home, PHRASE, T0);
    fsCtl.onOpen = null;
    expect(planted).toBe(true); // the race actually fired
    expect(v.ok).toBe(false); // no-clobber: refuse rather than overwrite
    expect(fs.readFileSync(path.join(AUM(home), 'binding-receipt.json'), 'utf-8')).toBe(competitor); // bytes preserved
    expect(fs.readdirSync(AUM(home)).some((d) => d.startsWith('.recover-stage-'))).toBe(false); // staging cleaned
  });

  it('the PUBLICATION SYSCALL is no-clobber: a receipt landing between revalidation and the link is never replaced', () => {
    writeReceiptlessLegacy();
    const competitor = JSON.stringify({ schema: 'aumlok-binding-receipt-v1', winner: 'the-publish-instant-writer' }, null, 2) + '\n';
    let raced = false;
    // fire at the exact publication boundary: AFTER the last revalidation, the instant before the
    // real linkSync runs — the sharpest possible race. renameSync would clobber here; linkSync EEXISTs.
    fsCtl.onLink = (_from, to) => {
      if (!raced && to.endsWith('binding-receipt.json')) {
        raced = true;
        fs.writeFileSync(to, competitor, { mode: 0o600 });
      }
    };
    const v = recoverLegacyReceipt(store, home, PHRASE, T0);
    fsCtl.onLink = null;
    expect(raced).toBe(true); // the race actually fired at the syscall boundary
    expect(v.ok).toBe(false); // EEXIST → loud refusal, never a clobber
    expect(fs.readFileSync(path.join(AUM(home), 'binding-receipt.json'), 'utf-8')).toBe(competitor); // the competitor's bytes survive
    expect(fs.readdirSync(AUM(home)).some((d) => d.startsWith('.recover-stage-'))).toBe(false); // staging cleaned
    expect(readCeremonyEvidence(home, 5).some((e) => e.event === 'legacy_recovery_refused_receipt_present')).toBe(true);
  });

  it('no fixed predictable temp name is used, and the receipt is published no-clobber (link, not replacing rename)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'aumlokBindCeremony.ts'), 'utf-8');
    const fn = src.slice(src.indexOf('export function recoverLegacyReceipt'), src.indexOf('// ── completion'));
    expect(fn).not.toContain(".recover-tmp'"); // the fixed predictable temp name is gone
    expect(fn).toContain("openSync(stagedReceipt, 'wx'"); // exclusive create — never follows a symlink
    expect(fn).toContain('mkdirSync(pubStage, { recursive: false'); // exclusive staging dir
    expect(fn).toContain('legacyRecoveryRequired(homeDir))'); // revalidated right before publish
    expect(fn).toContain('fs.linkSync(stagedReceipt, bindingReceiptPath(homeDir))'); // no-clobber publish syscall
    expect(fn).toContain("code === 'EEXIST'"); // a competitor at the publish instant is a loud refusal
    expect(fn).not.toContain('renameSync(stagedReceipt'); // the replacing rename is gone
  });
});

describe('the door surface — structural pins', () => {
  const door = fs.readFileSync(path.join(__dirname, '..', '..', 'spatial', 'aumlok-bind-serve.ts'), 'utf-8');
  it('status exposes recoveryRequired; a gated recover route calls the kernel; boot lands on s-recover, never a fresh bind over a key', () => {
    expect(door).toContain('recoveryRequired: legacyRecoveryRequired(SYMBIOTE_HOME)');
    const route = door.slice(door.indexOf("p === '/api/bind/recover'"), door.indexOf("p === '/api/bind/rotate'"));
    expect(route).toContain('gate(req)');
    expect(route).toContain('recoverLegacyReceipt(store, SYMBIOTE_HOME, current, Date.now())');
    // the boot branch: recoveryRequired lands on s-recover BEFORE the fresh-bind arrive
    expect(door).toContain('else if(st.recoveryRequired){ mode="recover"; show("#s-recover")');
    expect(door).toContain('id="s-recover"');
    expect(door).toContain('api("/api/bind/recover",{currentPhrase:recRail.value()})');
  });
});
