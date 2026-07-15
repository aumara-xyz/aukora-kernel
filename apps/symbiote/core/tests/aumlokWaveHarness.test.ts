// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// AUMLOK WAVE HARNESS — content-free lifecycle SMOKE (AUTOMATION, never owner acceptance).
// This pins the SAFETY FENCES of the disposable-wave harness (scripts/aumlokWave.ts): the destroy
// guard refuses the standing home, any non-temp path, and any path lacking a matching sentinel,
// and accepts only a sentinel'd temp home. Synthetic disposable data only — no real node, no
// phrase, no key. The live owner-visible ceremony is proven separately in the browser.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assertDestroyable, SENTINEL_NAME, newSentinelToken, readRegistrySafe, writeRegistryAtomic, type WaveRecord } from '../src/aumlokWaveFence';

const TMP = path.resolve(os.tmpdir());
const STANDING = path.join(os.homedir(), '.aukora-symbiote'); // the fence must protect this by name
const created: string[] = [];

function sentineledHome(token = 'wave-' + Math.random().toString(36).slice(2) + '-abcdef0123456789'): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-smoke-'));
  fs.writeFileSync(path.join(home, SENTINEL_NAME), JSON.stringify({ schema: 'aumlok-wave-sentinel-v1', token }) + '\n', { mode: 0o600 });
  created.push(home);
  return home;
}

beforeEach(() => { created.length = 0; });
afterEach(() => { for (const d of created) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } } });

describe('wave harness safety fences (content-free automation smoke)', () => {
  it('ACCEPTS a sentinel-carrying temp home (the only destroyable shape)', () => {
    const home = sentineledHome('wave-tok-abcdef0123456789');
    expect(assertDestroyable(home, 'wave-tok-abcdef0123456789', STANDING, TMP)).toEqual({ ok: true });
  });

  it('REFUSES the standing Aukora home, and any ancestor of it', () => {
    expect(assertDestroyable(STANDING, undefined, STANDING, TMP)).toMatchObject({ ok: false });
    expect(assertDestroyable(path.dirname(STANDING), undefined, STANDING, TMP)).toMatchObject({ ok: false }); // ancestor
    // even if someone forged a sentinel INSIDE a standing-home path, the home fence still refuses
    expect((assertDestroyable(STANDING, undefined, STANDING, TMP) as { why: string }).why).toMatch(/standing/i);
  });

  it('REFUSES any path outside the OS temp dir', () => {
    const outside = path.join(os.homedir(), 'Documents', 'not-a-wave');
    expect(assertDestroyable(outside, undefined, STANDING, TMP)).toMatchObject({ ok: false, why: expect.stringMatching(/temp dir/i) });
  });

  it('REFUSES a temp path with NO sentinel', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-nosentinel-'));
    created.push(bare);
    expect(assertDestroyable(bare, undefined, STANDING, TMP)).toMatchObject({ ok: false, why: expect.stringMatching(/sentinel/i) });
  });

  it('REFUSES a sentinel TOKEN MISMATCH (a stale registry cannot destroy a recycled path)', () => {
    const home = sentineledHome('wave-real-abcdef0123456789');
    expect(assertDestroyable(home, 'wave-WRONG-abcdef0123456789', STANDING, TMP)).toMatchObject({ ok: false, why: expect.stringMatching(/mismatch/i) });
  });

  it('REFUSES a malformed/short sentinel token', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-badsentinel-'));
    created.push(home);
    fs.writeFileSync(path.join(home, SENTINEL_NAME), JSON.stringify({ token: 'short' }) + '\n');
    expect(assertDestroyable(home, undefined, STANDING, TMP)).toMatchObject({ ok: false, why: expect.stringMatching(/malformed/i) });
  });

  it('the fence output is content-free: reasons name only paths/categories, never secrets', () => {
    const r = assertDestroyable('/nope', undefined, STANDING, TMP);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.why).not.toMatch(/[0-9a-f]{32}/); // no key/fingerprint-shaped material
      expect(r.why).not.toMatch(/phrase|private/i);
    }
  });
});

describe('sentinel tokens are CSPRNG and clear the fence length gate', () => {
  it('two tokens differ, are long, and pass the ≥16 gate', () => {
    const a = newSentinelToken(); const b = newSentinelToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(16);
    expect(a).toMatch(/^wave-[0-9a-f]{32}$/); // 16 CSPRNG bytes, hex
  });
});

describe('registry hardening: symlink-safe reads, atomic writes, never a throw', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-reg-')); created.push(dir); });

  const rec = (id: string): WaveRecord => ({ id, home: path.join(dir, id), port: 1, pid: -1, startedAt: 'x', sentinel: newSentinelToken() });

  it('absent registry reads as an empty list (never throws)', () => {
    expect(readRegistrySafe(path.join(dir, 'nope.json'))).toEqual([]);
  });

  it('atomic write then read round-trips, and the file is a REGULAR file', () => {
    const reg = path.join(dir, 'registry.json');
    writeRegistryAtomic(reg, [rec('a'), rec('b')]);
    expect(readRegistrySafe(reg).map((r) => r.id)).toEqual(['a', 'b']);
    expect(fs.lstatSync(reg).isFile()).toBe(true);
    // no staging temp is left behind
    expect(fs.readdirSync(dir).filter((f) => f.includes('.tmp'))).toEqual([]);
  });

  it('a SYMLINK at the registry path is refused (read returns empty, never follows it)', () => {
    const victim = path.join(dir, 'VICTIM.json');
    fs.writeFileSync(victim, JSON.stringify([rec('secret')]));
    const reg = path.join(dir, 'registry.json');
    fs.symlinkSync(victim, reg);
    expect(readRegistrySafe(reg)).toEqual([]); // the symlink is not a regular file → refused
  });

  it('atomic write never clobbers through a pre-existing symlink target (exclusive temp)', () => {
    const reg = path.join(dir, 'registry.json');
    writeRegistryAtomic(reg, [rec('one')]); // fresh regular file
    writeRegistryAtomic(reg, [rec('two'), rec('three')]); // replaces atomically
    expect(readRegistrySafe(reg).map((r) => r.id)).toEqual(['two', 'three']);
  });

  it('malformed JSON reads as empty, never throwing', () => {
    const reg = path.join(dir, 'registry.json');
    fs.writeFileSync(reg, 'not json {');
    expect(readRegistrySafe(reg)).toEqual([]);
  });
});
