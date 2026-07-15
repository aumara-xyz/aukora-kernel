import { describe, it, expect } from 'vitest';
import {
  readDrainBudgetState, consumeDrainBudget, effectiveDrainMax, utcDayOf,
  DEFAULT_DRAIN_BUDGET_PER_DAY, type DrainBudgetStateV1,
} from '../src/drainBudget';

const NOW = '2026-07-08T21:00:00.000Z';
const TOMORROW = '2026-07-09T00:00:01.000Z';

describe('drain budget (wishlist Brick 3.3) — the auto-drain day cap', () => {
  it('default is 12 per day, and nonsense maxes fall back to it — never to unlimited', () => {
    expect(DEFAULT_DRAIN_BUDGET_PER_DAY).toBe(12);
    expect(effectiveDrainMax(undefined)).toBe(12);
    expect(effectiveDrainMax(Number.NaN)).toBe(12);
    expect(effectiveDrainMax(0)).toBe(12);
    expect(effectiveDrainMax(-5)).toBe(12);
    expect(effectiveDrainMax(3)).toBe(3);
  });

  it('a fresh day spends up to the cap, then refuses with a plain reason', () => {
    let state = readDrainBudgetState(null, NOW);
    for (let i = 0; i < 3; i++) {
      const r = consumeDrainBudget(state, NOW, 3);
      expect(r.ok).toBe(true);
      if (r.ok) state = r.next;
    }
    const refused = consumeDrainBudget(state, NOW, 3);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toContain('exhausted');
  });

  it('midnight rolls the budget over — yesterday’s spend never blocks today', () => {
    const spent: DrainBudgetStateV1 = { schema: 'aukora-drain-budget-v1', day: utcDayOf(NOW), used: 12 };
    const r = consumeDrainBudget(spent, TOMORROW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.next).toEqual({ schema: 'aukora-drain-budget-v1', day: '2026-07-09', used: 1 });
  });

  it('garbage on disk resets to a fresh day instead of throwing (the off-switch is the owner’s, not a parse error’s)', () => {
    for (const junk of [null, 42, [], 'x', { schema: 'wrong' }, { schema: 'aukora-drain-budget-v1', day: 'not-a-day', used: 9 }, { schema: 'aukora-drain-budget-v1', day: utcDayOf(NOW), used: Number.NaN }]) {
      const s = readDrainBudgetState(junk, NOW);
      expect(s.day).toBe('2026-07-08');
      expect(s.used === 0 || Number.isInteger(s.used)).toBe(true);
    }
  });

  it('a refused consume changes nothing — exhausted state is not mutated', () => {
    const spent: DrainBudgetStateV1 = { schema: 'aukora-drain-budget-v1', day: utcDayOf(NOW), used: 12 };
    const r = consumeDrainBudget(spent, NOW);
    expect(r.ok).toBe(false);
    expect(spent.used).toBe(12);
  });
});
