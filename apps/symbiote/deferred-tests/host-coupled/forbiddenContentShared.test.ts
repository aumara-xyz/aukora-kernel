import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { scanForbiddenKeys, scanForbiddenValues, scanForbiddenClaims } from '../src/forbiddenContent';

// 24Z.22 — the ONE shared forbidden-content scanner + a cross-package DRIFT guard (the recurring bug class
// was the telemetry scanner and the validator scanner drifting apart).

const EDGE = path.resolve(__dirname, '..', 'src', 'forbiddenContent.ts');
const TAURI = path.resolve(__dirname, '..', '..', 'tauri-womb', 'src', 'lib', 'forbiddenContent.ts');

function driftBlock(file: string): string {
  const src = fs.readFileSync(file, 'utf-8');
  const a = src.indexOf('DRIFT-SYNC BLOCK START');
  const b = src.indexOf('DRIFT-SYNC BLOCK END');
  expect(a, `${file} missing DRIFT-SYNC BLOCK START`).toBeGreaterThan(-1);
  expect(b, `${file} missing DRIFT-SYNC BLOCK END`).toBeGreaterThan(a);
  return src.slice(a, b);
}

describe('24Z.22: forbidden-content is shared (no drift between edge + tauri)', () => {
  it('the DRIFT-SYNC pattern block is byte-identical in both packages', () => {
    expect(driftBlock(EDGE)).toBe(driftBlock(TAURI));
  });
  it('(Fusion Opus) the WHOLE module is byte-identical — function bodies cannot drift either', () => {
    // the mirror is a verbatim copy; assert full-file equality so scanner LOGIC can't diverge while only
    // the pattern block stays in sync (Opus: pattern-block-only check would miss a function-body divergence).
    expect(fs.readFileSync(EDGE, 'utf-8')).toBe(fs.readFileSync(TAURI, 'utf-8'));
  });
});

describe('24Z.22: shared scanner catches keys / values / claims at depth', () => {
  it('catches forbidden KEYS nested at any depth (set OR normalized regex)', () => {
    expect(scanForbiddenKeys({ a: { b: { privateKey: 1 } } }).length).toBe(1);
    expect(scanForbiddenKeys({ list: [{ ok: 1 }, { authorityToken: 'x' }] }).length).toBe(1);
    expect(scanForbiddenKeys({ deep: { chainOfThought: 'r' } }).length).toBe(1);
    expect(scanForbiddenKeys({ ok: 1, nested: { fine: 2 } }).length).toBe(0);
  });
  it('catches forbidden VALUES nested at any depth (PEM / sk- / prod domain / hex / CoT)', () => {
    expect(scanForbiddenValues({ a: '-----BEGIN PRIVATE KEY-----xx' }).length).toBe(1);
    expect(scanForbiddenValues({ a: { b: 'sk-AbCdEf012345xyz789' } }).length).toBe(1);
    expect(scanForbiddenValues({ a: 'see https://x.convex.cloud now' }).length).toBe(1);
    // 24Z.28 red-team (LOW): a 64+ hex secret must be caught even when prefixed by a non-hex word char (the old
    // \b boundary failed for 'k'+hex since hex are word chars). Lookarounds fix it.
    const h64 = 'a'.repeat(64);
    expect(scanForbiddenValues({ a: h64 }).length).toBe(1);              // bare 64-hex digest
    expect(scanForbiddenValues({ a: `k${h64}` }).length).toBe(1);        // prefixed (the bypass) — now caught
    expect(scanForbiddenValues({ a: `${h64}z` }).length).toBe(1);        // suffixed — caught
    expect(scanForbiddenValues({ a: 'a'.repeat(40) }).length).toBe(0);   // a 40-hex git sha is NOT a secret
    expect(scanForbiddenValues({ a: 'all clear', b: 'green' }).length).toBe(0);
  });
  it('catches OVERCLAIM + MYTHOLOGY claims; skips the legitimately-negative arrays', () => {
    expect(scanForbiddenClaims({ s: 'production AUMLOK signer is active' }).length).toBe(1);
    expect(scanForbiddenClaims({ s: 'this PROVES the GHP theory' }).length).toBe(1);
    expect(scanForbiddenClaims({ s: 'live apply is signed' }).length).toBe(1);
    // skip path: a forbiddenClaims array legitimately names these
    expect(scanForbiddenClaims({ forbiddenClaims: ['production signer is active'] }, '', new Set(['forbiddenClaims'])).length).toBe(0);
  });
  it('does NOT false-positive honest NEGATED wording', () => {
    for (const honest of [
      'LIVE apply lane: NOT built; production signer: NOT built; Ring-0 NEVER applyable.',
      'cannot write memory; workflows are not runnable; OpenCode parked.',
      'Telemetry makes no scientific/capability claim; it cannot authorize anything.',
      'REAL ML-DSA-signed permit (lab key) verified before apply; live repo untouched.',
    ]) {
      expect(scanForbiddenClaims({ s: honest }).length, honest).toBe(0);
      expect(scanForbiddenValues({ s: honest }).length, honest).toBe(0);
    }
  });
});
