// Promotion-grade rollback CONTRACT — snapshot is read-only, restore is DRY-RUN only, and neither is proven
// or wired to live apply yet. This muscle must be mechanically proven before live self-mod can ever exist.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { captureSnapshot, planRestore, PROMOTION_ROLLBACK_STATUS } from '../src/promotionRollback';

describe('promotion rollback contract — snapshot is read-only + deterministic', () => {
  it('captureSnapshot hashes content deterministically and mutates nothing', () => {
    const files = [{ path: 'a.ts', content: 'hello' }, { path: 'b.ts', content: 'world' }];
    const s1 = captureSnapshot(files, '2026-07-01T00:00:00.000Z');
    const s2 = captureSnapshot(files, '2026-07-01T00:00:00.000Z');
    expect(s1).toEqual(s2); // deterministic
    expect(s1.schemaVersion).toBe('promotion-snapshot-v1');
    expect(s1.files).toHaveLength(2);
    expect(s1.files[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(s1.grantsAuthority).toBe(false);
  });
});

describe('promotion rollback contract — restore is DRY-RUN only, applies nothing', () => {
  const snap = captureSnapshot([{ path: 'x.ts', content: 'ORIGINAL' }, { path: 'y.ts', content: 'KEEP' }], '2026-07-01T00:00:00.000Z');
  it('classifies unchanged / would_restore correctly and never applies', () => {
    const plan = planRestore(snap, [{ path: 'x.ts', content: 'CHANGED' }, { path: 'y.ts', content: 'KEEP' }]);
    expect(plan.dryRun).toBe(true);
    expect(plan.appliedLive).toBe(false);
    const byPath = Object.fromEntries(plan.entries.map(e => [e.path, e.status]));
    expect(byPath['x.ts']).toBe('would_restore'); // content differs from snapshot
    expect(byPath['y.ts']).toBe('unchanged');
    expect(plan.wouldRestoreCount).toBe(1);
  });
  it('a file in the snapshot but absent now is missing_now (never silently applied)', () => {
    const plan = planRestore(snap, [{ path: 'x.ts', content: 'ORIGINAL' }]);
    expect(plan.entries.find(e => e.path === 'y.ts')!.status).toBe('missing_now');
  });
});

describe('promotion rollback contract — honest status (defined, NOT proven, NOT wired)', () => {
  it('the contract is defined but restore is NOT proven and live apply is NOT wired', () => {
    expect(PROMOTION_ROLLBACK_STATUS.contractDefined).toBe(true);
    expect(PROMOTION_ROLLBACK_STATUS.restoreProven).toBe(false);
    expect(PROMOTION_ROLLBACK_STATUS.liveApplyWired).toBe(false);
  });
  it('the module contains no live-apply / disk-write sink (dry-run contract only)', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'promotionRollback.ts'), 'utf-8');
    expect(src).not.toMatch(/writeFileSync|appendFileSync|rmSync|unlinkSync|createWriteStream|applyLive|promoteLive/);
  });
});
