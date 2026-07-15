// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// aumlok-genesis-bridge (#288 follow-up) — the legacy bound-node migration, pinned as directed:
// legacy fallback success · precedence of the real binding receipt · malformed/missing root honest
// absence · deterministic refresh · rotation stability · prohibited-field nonaccess. The bridge is
// read-only by law: it writes nothing, synthesizes no receipt, and a manifest-ONLY home resolving
// successfully is itself the nonaccess proof (no other artifact exists to be read).
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveGenesisBindingFacts } from '../src/aumlokGenesisBridge';
import { pinAuthorityRoot, serializeRootManifest, keyIdFor } from '../src/aumlokAuthorityRoot';
import { buildGenesisAuraPacket, genesisAuraParams, genesisAuraCaption } from '../src/aumlokGenesisAura';
import { bindHybridV2 } from '../src/aumlokBindV2';

const PUB = 'ab'.repeat(32); // a well-formed 32-byte public key (hex)
const CREATED = '2026-07-05T09:00:00.000Z';
const BOUND = '2026-07-07T10:21:11.765Z';

/** A disposable home. `legacy` = manifest only (the pre-receipt shape); otherwise manifest+receipt. */
function makeHome(opts: { legacy?: boolean; receiptBoundAt?: string; breakRoot?: 'tamper' | 'schema' | 'json' | 'missing'; breakReceipt?: boolean } = {}): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-bridge-'));
  const dir = path.join(home, 'aumlok');
  fs.mkdirSync(dir, { recursive: true });
  if (opts.breakRoot !== 'missing') {
    let manifest = serializeRootManifest(pinAuthorityRoot(PUB, { createdAt: CREATED }));
    if (opts.breakRoot === 'tamper') manifest = manifest.replace(CREATED, '2020-01-01T00:00:00.000Z'); // integrity now lies
    if (opts.breakRoot === 'schema') manifest = manifest.replace('aumlok-authority-root-v1', 'aumlok-authority-root-v9');
    if (opts.breakRoot === 'json') manifest = manifest.slice(0, 40);
    fs.writeFileSync(path.join(dir, 'authority-root.json'), manifest);
  }
  if (!opts.legacy) {
    fs.writeFileSync(path.join(dir, 'binding-receipt.json'), opts.breakReceipt
      ? '{not json'
      : JSON.stringify({ schema: 'aumlok-binding-receipt-v1', boundAt: opts.receiptBoundAt ?? BOUND, phraseFingerprintSha256: 'f'.repeat(64), rotations: [] }, null, 2));
  }
  return home;
}

describe('legacy fallback — a pre-receipt bound node reconstructs its first base', () => {
  it('manifest-only home resolves from the validated root: source root, boundAt = stable createdAt', () => {
    const v = resolveGenesisBindingFacts(makeHome({ legacy: true }));
    expect(v).toEqual({ present: true, rootId: keyIdFor(PUB), boundAt: CREATED, source: 'root' });
  });

  it('the fallback facts build the EXACT same kind of genesis packet (schema, self-verifying ref, silver params, caption)', () => {
    const v = resolveGenesisBindingFacts(makeHome({ legacy: true }));
    if (!v.present) throw new Error('resolve failed');
    const p = buildGenesisAuraPacket({ rootId: v.rootId, boundAt: v.boundAt });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(genesisAuraParams(p.packet).state).toBe('silver');
    expect(genesisAuraCaption(p.packet)).toMatch(/^silver · genesis [a-z0-9._-]{1,12}$/);
  });

  it('resolution is READ-ONLY: no receipt is written or synthesized by resolving, ever', () => {
    const home = makeHome({ legacy: true });
    resolveGenesisBindingFacts(home);
    resolveGenesisBindingFacts(home);
    expect(fs.existsSync(path.join(home, 'aumlok', 'binding-receipt.json'))).toBe(false);
    expect(fs.readdirSync(path.join(home, 'aumlok'))).toEqual(['authority-root.json']); // nothing else appeared
  });
});

describe('hybrid-v2 precedence — one post-quantum identity feeds the same AURA bridge', () => {
  it('a fresh atomic hybrid bind resolves its full root and receipt time into AURA', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-bridge-v2-'));
    const at = Date.parse(BOUND);
    const bound = bindHybridV2(home, 'anchor earth forest people together purpose spirit', at);
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    expect(resolveGenesisBindingFacts(home)).toEqual({ present: true, rootId: bound.rootId, boundAt: BOUND, source: 'hybrid-v2' });
  });

  it('any partial v2 state fails closed and never falls back to a planted legacy root', () => {
    const home = makeHome({ legacy: true });
    fs.mkdirSync(path.join(home, 'aumlok', 'hybrid-v2'), { recursive: true });
    fs.writeFileSync(path.join(home, 'aumlok', 'hybrid-v2', 'authority-root-v2.json'), '{}');
    expect(resolveGenesisBindingFacts(home)).toEqual({ present: false });
  });
});

describe('precedence — the real binding receipt wins whenever it exists', () => {
  it('with a receipt present, boundAt comes from the receipt (source receipt), never the root', () => {
    const v = resolveGenesisBindingFacts(makeHome({ receiptBoundAt: BOUND }));
    expect(v).toEqual({ present: true, rootId: keyIdFor(PUB), boundAt: BOUND, source: 'receipt' });
  });

  it('fresh-node behavior is unchanged: receipt-home facts are exactly what the pre-bridge door read', () => {
    const v = resolveGenesisBindingFacts(makeHome({ receiptBoundAt: BOUND }));
    if (!v.present) throw new Error('resolve failed');
    // the pre-bridge inline logic: manifest.keyId + receipt.boundAt → byte-identical packet
    expect(JSON.stringify(buildGenesisAuraPacket({ rootId: v.rootId, boundAt: v.boundAt })))
      .toBe(JSON.stringify(buildGenesisAuraPacket({ rootId: keyIdFor(PUB), boundAt: BOUND })));
  });

  it('a receipt that EXISTS but is malformed fails closed — it never falls back to the root', () => {
    expect(resolveGenesisBindingFacts(makeHome({ breakReceipt: true }))).toEqual({ present: false });
  });
});

describe('malformed/missing root — honest absence, never a guess', () => {
  it.each([
    ['missing root', 'missing'],
    ['tampered manifest (integrity mismatch)', 'tamper'],
    ['wrong schema', 'schema'],
    ['invalid json', 'json'],
  ] as const)('%s → present:false (legacy shape)', (_name, breakRoot) => {
    expect(resolveGenesisBindingFacts(makeHome({ legacy: true, breakRoot }))).toEqual({ present: false });
  });

  it('a malformed root also refuses on a receipt-home (the root is validated on BOTH paths)', () => {
    expect(resolveGenesisBindingFacts(makeHome({ breakRoot: 'tamper' }))).toEqual({ present: false });
  });

  it('an entirely absent home is honest absence', () => {
    expect(resolveGenesisBindingFacts(fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-bridge-empty-')))).toEqual({ present: false });
  });
});

describe('deterministic refresh + rotation stability on the legacy shape', () => {
  it('REFRESH: independent resolutions and packets are byte-identical', () => {
    const home = makeHome({ legacy: true });
    const a = resolveGenesisBindingFacts(home);
    const b = resolveGenesisBindingFacts(home);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    if (!a.present || !b.present) throw new Error('resolve failed');
    expect(JSON.stringify(buildGenesisAuraPacket({ rootId: a.rootId, boundAt: a.boundAt })))
      .toBe(JSON.stringify(buildGenesisAuraPacket({ rootId: b.rootId, boundAt: b.boundAt })));
  });

  it('ROTATION-STABILITY: rotation-varying artifacts appearing/changing cannot move the legacy facts', () => {
    const home = makeHome({ legacy: true });
    const before = resolveGenesisBindingFacts(home);
    // what a rotation actually touches on disk: the KDF record file — never the manifest
    fs.writeFileSync(path.join(home, 'aumlok', 'phrase-fingerprint.json'),
      JSON.stringify({ schema: 'aumlok-phrase-fingerprint-v2', rotatedAt: new Date().toISOString() }));
    expect(JSON.stringify(resolveGenesisBindingFacts(home))).toBe(JSON.stringify(before));
  });

  it('the kernel cannot CREATE a receipt on rotation (read-modify-write on an existing file only) — the fallback cannot flip', () => {
    const kernel = fs.readFileSync(path.join(__dirname, '..', 'src', 'aumlokBindCeremony.ts'), 'utf-8');
    const fn = kernel.slice(kernel.indexOf('function appendRotationToReceipt'), kernel.indexOf('\n}', kernel.indexOf('function appendRotationToReceipt')));
    expect(fn).toContain('try');
    expect(fn.indexOf('readFileSync')).toBeGreaterThan(0);
    expect(fn.indexOf('readFileSync')).toBeLessThan(fn.indexOf('writeFileSync')); // must read the existing receipt first
  });
});

describe('prohibited-field nonaccess — the bridge can only know the two public facts', () => {
  it('a manifest-ONLY home resolves: no KDF record, key file, or receipt even exists to be read', () => {
    const home = makeHome({ legacy: true });
    expect(fs.readdirSync(path.join(home, 'aumlok'))).toEqual(['authority-root.json']);
    expect(resolveGenesisBindingFacts(home).present).toBe(true);
  });

  it('nothing receipt-internal leaks through the resolution (only boundAt is ever extracted)', () => {
    const v = resolveGenesisBindingFacts(makeHome({}));
    const s = JSON.stringify(v);
    expect(s).not.toContain('f'.repeat(64));               // the planted receipt hash value
    expect(s).not.toContain('phraseFingerprintSha256');    // nor its field name
    expect(s).not.toContain('rotations');
    expect(Object.keys(v).sort()).toEqual(['boundAt', 'present', 'rootId', 'source']); // closed shape
  });

  it('the bridge delegates hybrid coherence to the canonical verifier and never directly names secret material', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'aumlokGenesisBridge.ts'), 'utf-8');
    expect(src).toContain("'authority-root.json'");
    expect(src).toContain("'binding-receipt.json'");
    expect(src).toContain('verifyBundleCoherence');
    expect(src).toContain("'binding-receipt-v2.json'");
    for (const banned of ['phrase-fingerprint.json', 'authority-ed25519.key', 'salt', 'kdfoutput', 'typed', 'candidate']) {
      expect(src.toLowerCase().includes(banned)).toBe(false);
    }
    expect(src).not.toContain('writeFileSync'); // read-only by construction
  });
});
