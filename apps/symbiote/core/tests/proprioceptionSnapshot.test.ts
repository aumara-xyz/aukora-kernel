// proprioceptionSnapshot — the seed's read-only body-sense. It reports body state and grants NOTHING:
// advisory, no authority, no mutation, no secrets. A UI may display it; it may never be used as authority.
import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import { buildProprioceptionSnapshot, proprioceptionGrantsAuthority, summarizeProprioception } from '../src/proprioceptionSnapshot';

describe('proprioceptionSnapshot — read-only body-sense, grants nothing', () => {
  const s = buildProprioceptionSnapshot();

  it('reports the seed body, computed from the seed root', () => {
    // Issue #21: detect the seed root by marker files, not a literal checkout-dir-name assumption —
    // `generatedFromRoot` is already correctly self-rooted (path.resolve(__dirname, '..', '..') in the
    // source), this just stops asserting a fragile literal that breaks on any other clone dir name.
    expect(existsSync(join(s.generatedFromRoot, 'core', 'package.json'))).toBe(true);
    expect(existsSync(join(s.generatedFromRoot, 'scripts', 'test.sh'))).toBe(true);
    expect(typeof s.gitHead).toBe('string');
    expect(s.organs).toEqual(expect.arrayContaining(['core', 'authority', 'memory']));
  });

  it('grants NO authority and is advisory', () => {
    expect(s.grantsAuthority).toBe(false);
    expect(s.advisoryOnly).toBe(true);
    expect(proprioceptionGrantsAuthority(s)).toBe(false);
  });

  it('authority: AUMLOK dev-shim (not cryptographic), promotion LOCKED', () => {
    expect(s.authority.aumlokMode).toBe('sha256_dev_shim');
    expect(s.authority.cryptographic).toBe(false);
    expect(s.authority.promotionLocked).toBe(true);
  });

  it('convex read-only; memory advisory; self-edit sandbox-only + not promotion-ready', () => {
    expect(s.convex.readOnly).toBe(true);
    expect(s.convex.mutationExposed).toBe(false);
    expect(s.convex.productionConnection).toBe(false);
    expect(s.memory.advisoryOnly).toBe(true);
    expect(s.memory.convexWrite).toBe('quarantined');
    expect(s.selfEdit.mode).toBe('sandbox_only');
    expect(s.selfEdit.appliedLive).toBe(false);
    expect(s.selfEdit.promotionReady).toBe(false);
  });

  it('no adapter is active; vision is NOT wired (sensor lane only)', () => {
    expect(s.adapters.length).toBeGreaterThan(0);
    expect(s.adapters.filter((a) => a.status === 'active')).toHaveLength(0);
    expect(s.vision.wired).toBe(false);
    expect(s.vision.lane).toBe('sensor_adapter');
  });

  it('the snapshot carries no secret-shaped material', () => {
    const json = JSON.stringify(s);
    expect(json).not.toMatch(/sk-[A-Za-z0-9]{16,}/);
    expect(json).not.toMatch(/-----BEGIN/);
    expect(json).not.toMatch(/AKIA[0-9A-Z]{16}/);
  });

  it('summary is one-screen and ends advisory', () => {
    const t = summarizeProprioception(s);
    expect(t).toMatch(/HEADLESS/);
    expect(t).toMatch(/grants no authority/);
  });
});
