// THE WOLF'S MIND PORT — the reasoning-engine port surface for markets
// (spatial/app/wolf/wolf-mind-env.js), per docs/arc3/REASONING_ENGINE_EXPORT.md.
// Pins: the replayed Env is deterministic, risk caps live in the HARNESS
// (action availability + stop-out — never in the mind), fills pay honest
// friction through the real ledger, frames carry the paper/backtest label and
// oracle truth anchors, plan expectations verify against the tape, and the
// vendored engine core (spatial/app/arc3/mind.js) parses and validates wolf
// replies UNCHANGED — the whole point of the port.
import { describe, expect, it } from 'vitest';
import {
  createWolfMindEnv, renderWolfFrame, checkWolfExpectation, sparkline,
  WOLF_MIND_SYSTEM_PROMPT, WOLF_MODE_LABEL, WOLF_ACTION_MEANING, MIN_ORDER_DOLLARS,
} from '../../spatial/app/wolf/wolf-mind-env.js';
import { parseMindReply, validateAction, buildTurnMessage, TurnWindow } from '../../spatial/app/arc3/mind.js';

describe('env — deterministic replay (replay IS backtesting)', () => {
  it('same seed + same actions => byte-identical snapshot stream', () => {
    const play = () => {
      const env = createWolfMindEnv({ seed: 11, symbol: 'LUM', ticks: 20 });
      const snaps = [env.reset()];
      for (const a of ['ACTION1', 'ACTION2', 'ACTION1', 'ACTION4', 'ACTION5', 'ACTION1']) snaps.push(env.act(a));
      return JSON.stringify(snaps);
    };
    expect(play()).toBe(play());
  });

  it('reset() replays the SAME tape — the stop-out retry is a true replay', () => {
    const env = createWolfMindEnv({ seed: 3, symbol: 'RUT', ticks: 12 });
    const first = env.reset();
    env.act('ACTION2');
    env.act('ACTION1');
    const again = env.reset();
    expect(again.close).toBe(first.close);
    expect(again.cash).toBe(first.cash);
    expect(again.tape).toEqual(first.tape);
  });

  it('every act advances the tape exactly one tick — HOLD included', () => {
    const env = createWolfMindEnv({ seed: 5, ticks: 10 });
    const s0 = env.reset();
    const s1 = env.act('ACTION1');
    expect(s1.sessionTick).toBe(s0.sessionTick + 1);
    expect(s1.provenance.tick).toBe(s0.provenance.tick + 1);
  });
});

describe('risk caps — in the harness, never in the mind', () => {
  it('flat book: sells are not offered; broke book: buys are not offered', () => {
    const env = createWolfMindEnv({ seed: 7, ticks: 30 });
    const s0 = env.reset();
    expect(s0.availableActions).toContain(1);
    expect(s0.availableActions).toContain(2);
    expect(s0.availableActions).not.toContain(4);
    expect(s0.availableActions).not.toContain(5);
    let s = env.act('ACTION3'); // 75% in
    s = env.act('ACTION3');     // 75% of the rest
    s = env.act('ACTION3');     // cash now below MIN_ORDER on $10k * 0.25^3 ≈ $156 → still ≥ 50, one more
    while (s.cash >= MIN_ORDER_DOLLARS && s.state === 'RUNNING') s = env.act('ACTION3');
    if (s.state === 'RUNNING') {
      expect(s.availableActions).not.toContain(2);
      expect(s.availableActions).not.toContain(3);
      expect(s.availableActions).toContain(4);
      expect(s.availableActions).toContain(5);
    }
  });

  it('acting outside the offered list throws — the validator IS the fence', () => {
    const env = createWolfMindEnv({ seed: 7, ticks: 10 });
    env.reset();
    expect(() => env.act('ACTION5')).toThrow(/not available/);
  });

  it('the loss cap stops the session from the HARNESS side', () => {
    // A brutal cap (0.2%) plus an all-in position: friction alone (~15bps
    // round-trip) puts equity within one adverse tick of the stop.
    const env = createWolfMindEnv({ seed: 2, symbol: 'KNV', ticks: 400, maxDailyLossPct: 0.2 });
    let s = env.reset();
    s = env.act('ACTION3');
    s = env.act('ACTION3');
    let guard = 0;
    while (s.state === 'RUNNING' && guard++ < 400) s = env.act('ACTION1');
    expect(['STOPPED_OUT', 'SESSION_END']).toContain(s.state);
    if (s.state === 'STOPPED_OUT') {
      expect(s.equity).toBeLessThanOrEqual(s.startEquity * (1 - 0.2 / 100) + 1e-6);
      expect(s.availableActions).toEqual([]);
      expect(() => env.act('ACTION1')).toThrow(/terminal/);
    }
  });

  it('the session ends at the tick budget', () => {
    const env = createWolfMindEnv({ seed: 9, ticks: 5 });
    let s = env.reset();
    for (let i = 0; i < 5; i++) s = env.act('ACTION1');
    expect(s.state).toBe('SESSION_END');
    expect(s.ticksLeft).toBe(0);
  });
});

describe('fills — honest friction through the real ledger', () => {
  it('a buy pays a fee and slips against you; the oracle carries it', () => {
    const env = createWolfMindEnv({ seed: 13, ticks: 10 });
    const s0 = env.reset();
    const s1 = env.act('ACTION2');
    expect(s1.lastFill?.kind).toBe('buy');
    expect(s1.lastFill!.fee).toBeGreaterThan(0);
    expect(s1.lastFill!.execPx).toBeGreaterThan(s0.close); // slip is against you
    expect(s1.feesPaid).toBeCloseTo(s1.lastFill!.fee, 10);
    expect(s1.trades).toBe(1);
    expect(s1.cash).toBeCloseTo(s0.cash * 0.75, 6); // BUY SMALL spends 25%
  });

  it('close() reports an honest, friction-included buy-hold benchmark', () => {
    const env = createWolfMindEnv({ seed: 21, ticks: 8 });
    let s = env.reset();
    for (let i = 0; i < 8; i++) s = env.act('ACTION1');
    const sum = env.close();
    expect(sum.mode).toBe(WOLF_MODE_LABEL);
    expect(sum.state).toBe('SESSION_END');
    expect(sum.trades).toBe(0);
    expect(sum.pnlPct).toBeCloseTo(0, 6); // never traded → flat
    expect(Number.isFinite(sum.buyHoldPct)).toBe(true);
  });
});

describe('renderer — one legible frame, labeled and anchored', () => {
  it('every frame declares PAPER + backtest, oracle truths, and the loss cap', () => {
    const env = createWolfMindEnv({ seed: 7, ticks: 10 });
    const s0 = env.reset();
    const { text, changedCount } = renderWolfFrame(s0, null);
    expect(text).toContain('PAPER MONEY');
    expect(text).toContain('BACKTEST REPLAY');
    expect(text).toContain('ORACLE');
    expect(text).toContain('LOSS CAP');
    expect(text).toContain('actions available this turn');
    expect(text).toContain('provenance');
    expect(changedCount).toBe(-1); // first-frame contract, same as the grid diff
  });

  it('the DELTA splits market move from the mind\'s own fill', () => {
    const env = createWolfMindEnv({ seed: 7, ticks: 10 });
    const s0 = env.reset();
    const s1 = env.act('ACTION2');
    const { text, changedCount } = renderWolfFrame(s1, s0);
    expect(text).toContain('DELTA');
    expect(text).toMatch(/market: /);
    expect(text).toMatch(/you: BOUGHT/);
    expect(changedCount).toBeGreaterThan(0);
  });

  it('sparkline is monotone-safe and length-preserving', () => {
    expect(sparkline([1, 2, 3, 4]).length).toBe(4);
    expect(sparkline([5, 5, 5])).toBe('▁▁▁');
  });
});

describe('plan expectations — harness-verified against the tape', () => {
  const prev = { close: 100, equity: 10000 } as any;
  it('the whole vocabulary behaves', () => {
    expect(checkWolfExpectation('any', null, null).ok).toBe(true);
    expect(checkWolfExpectation('up', prev, { close: 101, equity: 10000 } as any).ok).toBe(true);
    expect(checkWolfExpectation('up', prev, { close: 99, equity: 10000 } as any).ok).toBe(false);
    expect(checkWolfExpectation('down', prev, { close: 99, equity: 10000 } as any).ok).toBe(true);
    expect(checkWolfExpectation('flat', prev, { close: 100.05, equity: 10000 } as any).ok).toBe(true);
    expect(checkWolfExpectation('flat', prev, { close: 103, equity: 10000 } as any).ok).toBe(false);
    expect(checkWolfExpectation('price>100.5', prev, { close: 101, equity: 10000 } as any).ok).toBe(true);
    expect(checkWolfExpectation('price<100.5', prev, { close: 101, equity: 10000 } as any).ok).toBe(false);
    expect(checkWolfExpectation('equity>9000', prev, { close: 100, equity: 9500 } as any).ok).toBe(true);
    expect(checkWolfExpectation('nonsense', prev, { close: 100, equity: 10000 } as any).ok).toBe(false);
  });
});

describe('the port — the vendored engine core works on wolf replies UNCHANGED', () => {
  it('parseMindReply accepts a wolf reply (schema identical to the game engine)', () => {
    const p = parseMindReply(JSON.stringify({
      whatISee: 'RUT at 102.10, flat book, quiet tape',
      delta: 'market drifted +0.1%, no fill; matched my prediction',
      hypothesis: 'mean-reverting around 102 (3/5), kill-test: two closes past 104',
      action: 'ACTION2',
      reason: 'small probe to calibrate friction',
      prediction: 'a fill with ~10bps fee, price within ±0.5%',
      memo: 'friction unverified; hypotheses: MR-102 3/5',
      plan: [{ action: 'ACTION1', expect: 'flat' }, { action: 'ACTION1', expect: 'any' }],
    }));
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.action.name).toBe('ACTION2');
      expect(p.plan.length).toBe(2);
      expect(p.plan[0].expect).toBe('flat');
    }
  });

  it('validateAction enforces the harness availability list on wolf actions', () => {
    const env = createWolfMindEnv({ seed: 7, ticks: 10 });
    const s0 = env.reset();
    expect(validateAction({ name: 'ACTION2' }, s0.availableActions).ok).toBe(true);
    expect(validateAction({ name: 'ACTION5' }, s0.availableActions).ok).toBe(false);
  });

  it('buildTurnMessage + TurnWindow carry memo and prediction across turns', () => {
    const msg = buildTurnMessage({ moveNo: 3, movesLeft: 7, frameText: 'FRAME', memo: 'friction ≈ 15bps round trip', lastPrediction: 'flat tick' });
    expect(msg).toContain('[YOUR MEMO FROM LAST TURN] friction ≈ 15bps round trip');
    expect(msg).toContain('[YOUR LAST PREDICTION] flat tick');
    const w = new TurnWindow(2);
    w.push('u1', 'a1'); w.push('u2', 'a2'); w.push('u3', 'a3');
    const m = w.messages('u4');
    expect(m.length).toBe(5); // 2 pairs + new turn — bounded window held
    expect(m[0].content).toBe('u2');
  });

  it('the governor prompt keeps the port\'s non-negotiables in writing', () => {
    expect(WOLF_MIND_SYSTEM_PROMPT).toContain('PAPER-MONEY');
    expect(WOLF_MIND_SYSTEM_PROMPT).toContain('you propose, the plumbing polices');
    expect(WOLF_MIND_SYSTEM_PROMPT).toContain('HONESTY DISCIPLINE');
    expect(WOLF_MIND_SYSTEM_PROMPT).toContain('never shorts, never borrows');
    expect(WOLF_MIND_SYSTEM_PROMPT).toContain('EPISODIC MEMORY');
    // reply schema identical to the game engine's
    for (const k of ['whatISee', 'delta', 'hypothesis', 'action', 'reason', 'prediction', 'memo', 'plan']) {
      expect(WOLF_MIND_SYSTEM_PROMPT).toContain(`"${k}"`);
    }
    expect(Object.keys(WOLF_ACTION_MEANING).length).toBe(5);
  });
});
