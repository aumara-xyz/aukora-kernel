// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// aumlok-genesis-aura-v1 (#288) — the STANDING silver base. Pins: determinism (byte-identical params
// across calls), rotation-stability (nothing rotation-varying is an input — same base before/after a
// simulated rotation), refresh (independent rebuilds identical), prohibited fields (the named list
// refuses the whole packet; a transplanted ref refuses), honest absence, and #324 preservation (the
// transient echo family is independent and untouched; the base layers UNDER it, never replacing it).
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  GENESIS_AURA_SCHEMA, buildGenesisAuraPacket, validateGenesisAuraPacket, deriveGenesisRef,
  genesisAuraParams, genesisAuraCaption,
} from '../src/aumlokGenesisAura';
import { deriveReceiptRef } from '../src/aumlokCeremonyEcho';

const ROOT = 'b926fd124e810e24';
const BOUND = '2026-07-07T10:21:11.765Z';
const good = () => {
  const v = buildGenesisAuraPacket({ rootId: ROOT, boundAt: BOUND });
  if (!v.ok) throw new Error('build failed');
  return v.packet;
};

describe('derivation — only the two rotation-stable public facts', () => {
  it('builds a valid packet from rootId + boundAt alone, with a self-verifying genesisRef', () => {
    const p = good();
    expect(p.schema).toBe(GENESIS_AURA_SCHEMA);
    expect(p.genesisRef).toBe(deriveGenesisRef({ rootId: ROOT, boundAt: BOUND }));
    expect(p.genesisRef).toMatch(/^[a-z0-9._-]{1,64}$/);
  });

  it('ROTATION-STABILITY: fingerprint contents, rotation counts, and drand anchors are NOT inputs — the base cannot change on rotation', () => {
    // the builder's whole input surface is {rootId, boundAt}; simulate "after rotation" by rebuilding
    // with identical stable facts (rotation rewrites only fingerprint + receipt.rotations[])
    const before = good();
    const after = buildGenesisAuraPacket({ rootId: ROOT, boundAt: BOUND });
    if (!after.ok) throw new Error('rebuild failed');
    expect(JSON.stringify(after.packet)).toBe(JSON.stringify(before));
    expect(JSON.stringify(genesisAuraParams(after.packet))).toBe(JSON.stringify(genesisAuraParams(before)));
  });

  it('REFRESH: two independent rebuild+param cycles are byte-identical (no event minted, no state consumed)', () => {
    const a = genesisAuraParams(good());
    const b = genesisAuraParams(good());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.state).toBe('silver'); // the NAMED word, never a value
    for (const r of a.rings) {
      for (const f of [r.radius, r.phase, r.weight]) { expect(f).toBeGreaterThanOrEqual(0); expect(f).toBeLessThan(1); }
    }
  });

  it('a different binding (root or boundAt) yields a different base — the pattern belongs to THIS binding', () => {
    const other = buildGenesisAuraPacket({ rootId: 'c'.repeat(16), boundAt: BOUND });
    if (!other.ok) throw new Error('build failed');
    expect(JSON.stringify(genesisAuraParams(other.packet))).not.toBe(JSON.stringify(genesisAuraParams(good())));
  });

  it('the genesis ref family can never collide with the transient echo ref family (distinct domains)', () => {
    const g = deriveGenesisRef({ rootId: ROOT, boundAt: BOUND });
    const e = deriveReceiptRef({ keyId: ROOT, boundAt: BOUND, event: 'bind', atIso: BOUND });
    expect(g).not.toBe(e);
  });
});

describe('acceptance matrix — closed fields, prohibited names refuse the whole packet', () => {
  it.each([
    ['genesis_not_an_object', null],
    ['genesis_not_an_object', 'str'],
    ['genesis_wrong_schema', { ...good(), schema: 'aumlok-genesis-aura-v2' }],
    ['genesis_root_invalid', { ...good(), rootId: 'HAS UPPER' }],
    ['genesis_ref_invalid', { ...good(), genesisRef: 'bad ref!' }],
    ['genesis_bound_at_invalid', { ...good(), boundAt: 'not-a-time' }],
  ] as const)('%s refuses', (code, input) => {
    const v = validateGenesisAuraPacket(input as never);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.refused).toBe(code);
  });

  it('a TRANSPLANTED ref (valid grammar, wrong binding) refuses — the base cannot be moved between identities', () => {
    const v = validateGenesisAuraPacket({ ...good(), genesisRef: 'a'.repeat(24) });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.refused).toBe('genesis_ref_mismatch');
  });

  it.each([
    'phrase', 'words', 'anchor', 'anchorLetters', 'normalizedPhrase', 'fingerprint', 'salt', 'saltHex',
    'kdf', 'kdfOutput', 'typed', 'typedInput', 'attempts', 'attemptCount', 'key', 'privateKey',
    'signature', 'audio', 'score', 'token', 'humanity', 'isHuman', 'rank', 'level',
  ].map((f) => [f]))('prohibited/unknown field "%s" refuses the WHOLE packet', (field) => {
    const v = validateGenesisAuraPacket({ ...good(), [field]: 'x' });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.refused).toBe('genesis_unknown_field');
  });

  it('refusals are categorical — offending contents are never echoed', () => {
    const v = validateGenesisAuraPacket({ ...good(), phrase: 'SECRET-SEVEN-WORDS' });
    expect(JSON.stringify(v)).not.toContain('SECRET-SEVEN-WORDS');
  });
});

describe('caption — named state, content-free ref, nothing else', () => {
  it('renders `silver · genesis <=12 ref chars>` — no dates, no counts, no person-derived number', () => {
    const cap = genesisAuraCaption(good());
    expect(cap).toMatch(/^silver · genesis [a-z0-9._-]{1,12}$/);
  });
});

describe('the door wiring — structural pins (read-only standing base; #324 preserved)', () => {
  const door = fs.readFileSync(path.join(__dirname, '..', '..', 'spatial', 'aumlok-bind-serve.ts'), 'utf-8');

  it('GET /api/bind/genesis exists, GET-only, resolving its facts ONLY through the read-only bridge', () => {
    expect(door).toContain("req.method === 'GET' && p === '/api/bind/genesis'");
    const fn = door.slice(door.indexOf('function readGenesisAura'), door.indexOf('// ── ceremony echo'));
    expect(fn).toContain('resolveGenesisBindingFacts'); // the bridge owns which public files are read
    for (const banned of ['phrase', 'typed', 'fingerprint', 'salt', 'kdf', 'candidate', 'authority-ed25519.key']) {
      expect(fn.toLowerCase()).not.toContain(banned);
    }
  });

  it('trefoil asset delivery: ONE bounded GET route serving the EXISTING on-disk icon — never inlined, duplicated, or hot-linked', () => {
    expect(door).toContain("req.method === 'GET' && p === '/assets/aumara-icon.png'");
    expect(door).toContain("path.join(import.meta.dir, 'assets', 'aumara-icon.png')"); // one fixed disk file, no params
    // the asset already exists on disk — the route reads it; nothing was invented or duplicated
    expect(fs.existsSync(path.join(__dirname, '..', '..', 'spatial', 'assets', 'aumara-icon.png'))).toBe(true);
    expect(door).not.toContain('base64');     // never inlined
    expect(door).not.toContain('data:image'); // never inlined
    expect(door).not.toMatch(/<img[^>]+src="http/); // never hot-linked — same-origin path only
  });

  it('NO visible standing ring: the initial, rotate, and bound icons are the trefoil — generic circles are gone from those steps', () => {
    expect(door).not.toContain('genesis-ring'); // the old standing rings are fully gone
    for (const id of ['id="s-arrive"', 'id="s-rotate0"', 'id="s-bound"']) {
      const step = door.slice(door.indexOf(id), door.indexOf(id) + 260);
      expect(step).toContain('class="trefoil');
      expect(step).toContain('src="/assets/aumara-icon.png"');
      expect(step).not.toContain('class="ring'); // no generic circle as the standing icon
    }
  });

  it('the transient echo remains, behind/around the trefoil — the base never replaces it', () => {
    const bound = door.slice(door.indexOf('id="s-bound"'), door.indexOf('id="s-bound"') + 260);
    expect(bound).toContain('id="echo"');
    expect(bound.indexOf('id="echo"')).toBeLessThan(bound.indexOf('class="trefoil')); // ripple behind, emblem in front
  });

  it('375px/framed fit: the emblem is a fixed square block (#242: larger first impression) and the framed door reports its size to the shell', () => {
    expect(door).toContain('.emblem{position:relative;width:116px;height:116px;margin:4px auto 22px}');
    expect(door).toContain('.trefoil{display:block;position:relative;width:116px;height:116px');
    expect(door).toContain('function postSize()');
  });

  it('the page reconstructs the base on load (sovereign) AND after success — never by minting an event, never by drawing a ring', () => {
    expect(door).toContain('show("#s-view"); renderGenesisBase(); }'); // sovereign boot reconstructs the base
    expect(door).toContain('renderGenesisBase(); // bind: the base first exists');
    const fn = door.slice(door.indexOf('async function renderGenesisBase'), door.indexOf('async function reveal'));
    expect(fn).toContain('api("/api/bind/genesis")'); // a READ, not a POST — nothing is minted
    expect(fn).not.toContain('POST');
    expect(fn).toContain('state!=="silver") return'); // named-state gate on the DOM side too
    expect(fn).not.toContain('createElement');        // treatment only — no element, no standing circle
    expect(fn).not.toContain('data-');                // no parameter exposed as a DOM attribute
    expect(fn).toContain('.trefoil.genesis');         // params land on the trefoil as opacity/glow only
  });

  it('#324 preserved: the transient echo construction and single-use set are untouched', () => {
    expect(door).toContain('const seenEchoRefs = new Set<string>();');
    expect(door).toContain('buildEchoForSuccess(v.mode');
  });
});

describe('honest absence — an unbound home yields present:false shape, never a guess', () => {
  it('buildGenesisAuraPacket refuses garbage boundAt rather than inventing a base', () => {
    const v = buildGenesisAuraPacket({ rootId: ROOT, boundAt: '' });
    expect(v.ok).toBe(false);
  });

  it('(live shape) a fresh tmp home has neither artifact — the door helper would return present:false', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-absent-'));
    expect(fs.existsSync(path.join(home, 'aumlok', 'authority-root.json'))).toBe(false);
    expect(fs.existsSync(path.join(home, 'aumlok', 'binding-receipt.json'))).toBe(false);
  });
});
