// AGI · ARC 3 — the reasoner must beat the onboard arcade BLIND.
// (spatial/app/arc3/engine.js + mock-arcade.js)
//
// These worlds scramble their control mappings per seed, so nothing here can
// be memorized: every win requires live calibration (which action moves what),
// self-discovery (which color answers to me), and receipt-honest exploration.
// Honesty pins ride along: noop receipts must be true noops, novelty must
// track the state graph, and no hypothesis may claim 'di' without a delta.
import { describe, expect, it } from 'vitest';
import {
  Reasoner, MetaMind, normalizeObs, inferMechanic,
  frameHash, diffFrames, segment, lastGrid, mulberry32,
} from '../../spatial/app/arc3/engine.js';
import { createMockArcade } from '../../spatial/app/arc3/mock-arcade.js';

function drive(arcade: ReturnType<typeof createMockArcade>, gameId: string, opts: { seed?: number; maxSteps: number }) {
  const r = new Reasoner({ seed: opts.seed ?? 7 });
  let fr = arcade.reset(gameId);
  let obs = normalizeObs(fr);
  r.begin(obs);
  const receipts: unknown[] = [];
  let steps = 0;
  while (obs.state !== 'WIN' && steps < opts.maxSteps) {
    const d = r.decide(obs);
    const prev = obs;
    fr = d.kind === 'click'
      ? arcade.act(gameId, obs.guid, 'ACTION6', d.x, d.y)
      : arcade.act(gameId, obs.guid, `ACTION${d.actionId}`);
    obs = normalizeObs(fr);
    receipts.push(r.observe(prev, d, obs));
    steps++;
  }
  return { won: obs.state === 'WIN', steps, levels: obs.levelsCompleted, reasoner: r, receipts };
}

describe('frame primitives', () => {
  it('hashes identical grids identically and different grids differently', () => {
    const a = [[1, 2], [3, 4]], b = [[1, 2], [3, 4]], c = [[1, 2], [3, 5]];
    expect(frameHash(a)).toBe(frameHash(b));
    expect(frameHash(a)).not.toBe(frameHash(c));
  });

  it('diffFrames reports exact changed cells with a bounding box', () => {
    const a = [[0, 0, 0], [0, 0, 0]];
    const b = [[0, 7, 0], [0, 0, 7]];
    const d = diffFrames(a, b);
    expect(d.changed).toBe(2);
    expect(d.box).toEqual({ x0: 1, y0: 0, x1: 2, y1: 1 });
  });

  it('segment finds regions against the majority-color background', () => {
    const g = Array.from({ length: 8 }, () => new Array(8).fill(5));
    g[1][1] = 9; g[1][2] = 9; g[2][1] = 9;           // an L of color 9
    g[6][6] = 14;                                      // a lone goal cell
    const s = segment(g);
    expect(s.background).toBe(5);
    expect(s.regions.length).toBe(2);
    expect(s.regions[0]).toMatchObject({ color: 9, size: 3 });
    expect(s.regions[1]).toMatchObject({ color: 14, size: 1 });
  });

  it('lastGrid takes the settled (final) animation frame', () => {
    const g1 = [[1]], g2 = [[2]];
    expect(lastGrid([g1, g2])).toBe(g2);
    expect(lastGrid([])).toBeNull();
  });
});

describe('blind wins on the onboard arcade (scrambled controls)', () => {
  const gameId = (prefix: string) =>
    createMockArcade(42).listGames().map((g: { game_id: string }) => g.game_id)
      .find((id: string) => id.startsWith(prefix))!;

  it('beats MK·MAZE — all 3 levels, no prior knowledge', () => {
    const arcade = createMockArcade(42);
    const res = drive(arcade, gameId('mk-maze'), { maxSteps: 900 });
    expect(res.won).toBe(true);
    expect(res.levels).toBe(3);
    // she must have EARNED a direction map, not assumed one
    expect(res.reasoner.dirMap.size).toBeGreaterThanOrEqual(2);
    expect(res.reasoner.selfColor).toBe(9);
    // and no world without a budget may grow one — budgets come from deaths only
    expect(res.reasoner.movesPerLife).toBeNull();
    expect(res.reasoner.fuelColor).toBeNull();
  }, 30000);

  it('beats MK·GLYPHS — the click-toggle world', () => {
    const arcade = createMockArcade(42);
    const res = drive(arcade, gameId('mk-glyphs'), { maxSteps: 2500, seed: 11 });
    expect(res.won).toBe(true);
    expect(res.levels).toBe(2);
    expect(inferMechanic(res.reasoner)).toBe('click-pattern');
  }, 30000);

  it('beats MK·FORGE — hybrid walk + click, door must be discovered', () => {
    const arcade = createMockArcade(42);
    const res = drive(arcade, gameId('mk-forge'), { maxSteps: 2000, seed: 3 });
    expect(res.won).toBe(true);
    expect(res.levels).toBe(2);
    expect(inferMechanic(res.reasoner)).toBe('hybrid-walk-click');
  }, 30000);

  it('wins survive a different control scramble (a different seed)', () => {
    const arcade = createMockArcade(1337);
    const gid = arcade.listGames()[0].game_id;
    const res = drive(arcade, gid, { maxSteps: 900, seed: 23 });
    expect(res.won).toBe(true);
  }, 30000);
});

// Drives like the organ does on the live arena: a GAME_OVER costs a life and
// resets the SAME board; the reasoner is told about each rebirth.
function driveWithLives(arcade: ReturnType<typeof createMockArcade>, gameId: string,
  opts: { seed?: number; maxSteps: number; maxLives: number }) {
  const r = new Reasoner({ seed: opts.seed ?? 7 });
  let fr = arcade.reset(gameId);
  let obs = normalizeObs(fr);
  r.begin(obs);
  const receipts: unknown[] = [];
  let steps = 0, lives = 1;
  while (obs.state !== 'WIN' && steps < opts.maxSteps) {
    if (obs.state === 'GAME_OVER') {
      if (lives >= opts.maxLives) break;
      lives++;
      fr = arcade.reset(gameId, obs.guid);
      obs = normalizeObs(fr);
      r.rebirth(obs);
      continue;
    }
    const d = r.decide(obs);
    const prev = obs;
    fr = d.kind === 'click'
      ? arcade.act(gameId, obs.guid, 'ACTION6', d.x, d.y)
      : arcade.act(gameId, obs.guid, `ACTION${d.actionId}`);
    obs = normalizeObs(fr);
    receipts.push(r.observe(prev, d, obs));
    steps++;
  }
  return { won: obs.state === 'WIN', steps, lives, levels: obs.levelsCompleted, reasoner: r, receipts };
}

describe('budget sense — the ls20 lesson (worlds that sell moves)', () => {
  const emberId = () =>
    createMockArcade(42).listGames().map((g: { game_id: string }) => g.game_id)
      .find((id: string) => id.startsWith('mk-ember'))!;

  it('beats MK·EMBER on the first tank — the gauge is dashboard, never a destination', () => {
    const arcade = createMockArcade(42);
    const res = driveWithLives(arcade, emberId(), { maxSteps: 700, maxLives: 8, seed: 7 });
    expect(res.won).toBe(true);
    expect(res.levels).toBe(2);
    // she caught the gauge…
    expect(res.reasoner.fuelColor).toBe(13);
    // …never chased it as a goal, and never even needed to die for the win
    expect(res.lives).toBe(1);
    expect(res.steps).toBeLessThanOrEqual(120);
    // no death, no budget — budgets are never invented
    expect(res.reasoner.movesPerLife).toBeNull();
  }, 30000);

  it('death-ledger: a watched GAME_OVER fixes moves-per-life exactly, grade di', () => {
    const r = new Reasoner({ seed: 1 });
    const mk = (fill: number, state: 'NOT_FINISHED' | 'NOT_STARTED' | 'WIN' | 'GAME_OVER') => normalizeObs({
      game_id: 'ledger-test', guid: 'g', frame: [Array.from({ length: 64 }, () => new Array(64).fill(fill))],
      state, levels_completed: 0, win_levels: 1, action_input: { id: 0 }, available_actions: [1, 2],
    });
    let prev = mk(5, 'NOT_FINISHED');
    r.begin(prev);
    for (let i = 0; i < 20; i++) {
      const next = mk(5 + (i % 2 === 0 ? 1 : -1) * 0, i === 19 ? 'GAME_OVER' : 'NOT_FINISHED');
      r.observe(prev, { kind: 'simple', actionId: 1, reason: 'probe step', tag: 'test' }, next);
      prev = next;
    }
    expect(r.movesPerLife).toBe(20);
    const budgetHypo = r.hypotheses.find((h: { id: string }) => h.id === 'budget');
    expect(budgetHypo).toBeDefined();
    expect(budgetHypo!.grade).toBe('di');
    // and after rebirth the whole (small) life is commit-first
    r.rebirth(mk(5, 'NOT_FINISHED'));
    expect(r.budgetRemaining()).toBe(20);
  });

  it('gauge honesty: a delta that is ONLY the gauge draining is a true noop', () => {
    const r = new Reasoner({ seed: 1 });
    const frame = (fuel: number) => {
      const g = Array.from({ length: 64 }, () => new Array(64).fill(5));
      for (let i = 0; i < fuel; i++) g[1][2 + i] = 13; // a draining bar
      g[30][30] = 9; // a world object that never moves
      return g;
    };
    const mk = (fuel: number) => normalizeObs({
      game_id: 'gauge-test', guid: 'g', frame: [frame(fuel)], state: 'NOT_FINISHED',
      levels_completed: 0, win_levels: 1, action_input: { id: 0 }, available_actions: [1, 2],
    });
    let prev = mk(30);
    r.begin(prev);
    let last: { noop: boolean; changed: number; changedRaw: number; hashBefore: string; hashAfter: string } | null = null;
    for (let fuel = 29; fuel >= 18; fuel--) {
      const next = mk(fuel);
      last = r.observe(prev, { kind: 'simple', actionId: 1, reason: 'probe step', tag: 'test' }, next);
      prev = next;
    }
    expect(r.fuelColor).toBe(13);                 // the drain-watch caught it
    expect(last!.changedRaw).toBeGreaterThan(0);  // the bar really drained…
    expect(last!.changed).toBe(0);                // …but the world did not move
    expect(last!.noop).toBe(true);
    expect(last!.hashBefore).toBe(last!.hashAfter);
  });

  it('never invents a budget: no death, no movesPerLife (pinned above on MK·MAZE)', () => {
    const r = new Reasoner({ seed: 1 });
    expect(r.budgetRemaining()).toBeNull();
    expect(r.movesPerLife).toBeNull();
  });
});

describe('odd-one-out — one of these things is not like the others', () => {
  const oddId = () =>
    createMockArcade(42).listGames().map((g: { game_id: string }) => g.game_id)
      .find((id: string) => id.startsWith('mk-oddball'))!;

  it('beats MK·ODDBALL fast — the deviant tile is the mechanism', () => {
    const arcade = createMockArcade(42);
    const res = drive(arcade, oddId(), { maxSteps: 60, seed: 7 });
    expect(res.won).toBe(true);
    expect(res.levels).toBe(2);
    // and she SAID it was the odd one out, in the receipt, before it worked
    const oddReason = (res.receipts as Array<{ reason: string }>).find((r) => r.reason.includes('odd one out'));
    expect(oddReason).toBeDefined();
  }, 30000);

  it('the prior survives a different seed and deviant position', () => {
    const arcade = createMockArcade(1337);
    const gid = arcade.listGames().map((g: { game_id: string }) => g.game_id)
      .find((id: string) => id.startsWith('mk-oddball'))!;
    const res = drive(arcade, gid, { maxSteps: 60, seed: 23 });
    expect(res.won).toBe(true);
  }, 30000);
});

describe('reference matching — make the framed block agree with its family', () => {
  const gid = (seed: number, prefix: string) =>
    createMockArcade(seed).listGames().map((g: { game_id: string }) => g.game_id)
      .find((id: string) => id.startsWith(prefix))!;

  it('beats MK·MIRROR — clicks exactly where the framed block disagrees', () => {
    const arcade = createMockArcade(42);
    const res = drive(arcade, gid(42, 'mk-mirror'), { maxSteps: 80, seed: 7 });
    expect(res.won).toBe(true);
    expect(res.levels).toBe(2);
    const harmReason = (res.receipts as Array<{ reason: string }>).find((r) => r.reason.includes('framed block agree'));
    expect(harmReason).toBeDefined();
  }, 30000);

  it('holds under a different seed / different disagreement cells', () => {
    const arcade = createMockArcade(1337);
    const res = drive(arcade, gid(1337, 'mk-mirror'), { maxSteps: 80, seed: 23 });
    expect(res.won).toBe(true);
  }, 30000);
});

describe('courier — what she carries names where she goes', () => {
  const gid = (seed: number) =>
    createMockArcade(seed).listGames().map((g: { game_id: string }) => g.game_id)
      .find((id: string) => id.startsWith('mk-courier'))!;

  it('beats MK·COURIER — picks up the parcel, delivers to its color-twin', () => {
    const arcade = createMockArcade(42);
    const res = drive(arcade, gid(42), { maxSteps: 1500, seed: 7 });
    expect(res.won).toBe(true);
    expect(res.levels).toBe(2);
    // she NOTICED the attachment and said so before the delivery paid off
    const carrying = res.reasoner.hypotheses.find((h: { id: string }) => h.id === 'carrying');
    expect(carrying).toBeDefined();
  }, 30000);

  it('holds under a different scramble', () => {
    const arcade = createMockArcade(1337);
    const res = drive(arcade, gid(1337), { maxSteps: 1500, seed: 23 });
    expect(res.won).toBe(true);
  }, 30000);
});

describe('turn-then-step + path-locked movement (the rail regime)', () => {
  it('beats MK·RAIL — recalibrates with double presses, follows the rail', () => {
    const arcade = createMockArcade(42);
    const gid = arcade.listGames().map((g: { game_id: string }) => g.game_id)
      .find((id: string) => id.startsWith('mk-rail'))!;
    const res = drive(arcade, gid, { maxSteps: 1200, seed: 7 });
    expect(res.won).toBe(true);
    // she noticed the dead-looking controls and re-probed with double presses
    const recal = res.reasoner.hypotheses.find((h: { id: string }) => h.id === 'recal');
    expect(recal).toBeDefined();
    // and direction knowledge was EARNED from lived displacement, not the prior
    expect(res.reasoner.dirMap.size).toBeGreaterThanOrEqual(2);
  }, 30000);
});

describe('receipt honesty — the canonical-extraction law', () => {
  it('noop receipts are true noops (hash unchanged), deltas are never noops', () => {
    const arcade = createMockArcade(42);
    const gid = arcade.listGames()[0].game_id;
    const res = drive(arcade, gid, { maxSteps: 400 });
    for (const rec of res.receipts as Array<{ noop: boolean; hashBefore: string; hashAfter: string }>) {
      if (rec.noop) expect(rec.hashBefore).toBe(rec.hashAfter);
      if (rec.hashBefore !== rec.hashAfter) expect(rec.noop).toBe(false);
    }
  }, 30000);

  it('every receipt carries a human-readable reason', () => {
    const arcade = createMockArcade(42);
    const gid = arcade.listGames()[1].game_id;
    const res = drive(arcade, gid, { maxSteps: 200, seed: 5 });
    for (const rec of res.receipts as Array<{ reason: string }>) {
      expect(typeof rec.reason).toBe('string');
      expect(rec.reason.length).toBeGreaterThan(8);
    }
  }, 30000);
});

describe('meta-mind — lessons and priors, never hardcoded solutions', () => {
  it('learns from a won run and offers an advisory prior for the same action menu', () => {
    const meta = new MetaMind(undefined);
    expect(meta.prior([1, 2, 3, 4])).toBeNull();
    meta.learn({ gameId: 'mk-maze-2a', availableActions: [1, 2, 3, 4], mechanic: 'maze-walk', won: true, levels: 3, steps: 120 });
    meta.learn({ gameId: 'mk-maze-2b', availableActions: [1, 2, 3, 4], mechanic: 'maze-walk', won: true, levels: 3, steps: 90 });
    const p = meta.prior([1, 2, 3, 4]);
    expect(p).not.toBeNull();
    expect(p!.mechanic).toBe('maze-walk');
    expect(p!.support).toBe(2);
    expect(p!.confidence).toBeLessThanOrEqual(0.8);
    // a different menu is a different world — no borrowed certainty
    expect(meta.prior([6])).toBeNull();
  });

  it('round-trips through JSON (localStorage / Convex shape)', () => {
    const meta = new MetaMind(undefined);
    meta.learn({ gameId: 'g', availableActions: [6], mechanic: 'click-pattern', won: true, levels: 1, steps: 40 });
    const revived = new MetaMind(JSON.parse(JSON.stringify(meta.toJSON())));
    expect(revived.prior([6])!.mechanic).toBe('click-pattern');
  });

  it('forget() wipes one game family only — or everything with no id', () => {
    const meta = new MetaMind(undefined);
    meta.learn({ gameId: 'mk-maze-2a', availableActions: [1, 2, 3, 4], mechanic: 'maze-walk', won: true, levels: 3, steps: 100 });
    meta.learn({ gameId: 'mk-maze-9f', availableActions: [1, 2, 3, 4], mechanic: 'maze-walk', won: true, levels: 3, steps: 90 });
    meta.learn({ gameId: 'ft09-0d8bbf25', availableActions: [6], mechanic: 'click-pattern', won: true, levels: 1, steps: 142 });
    expect(meta.forget('mk-maze-77')).toBe(2);        // family match, any suffix
    expect(meta.prior([1, 2, 3, 4])).toBeNull();      // truly blind again
    expect(meta.prior([6])).not.toBeNull();           // other worlds untouched
    expect(meta.forget(null)).toBe(1);
    expect(meta.lessons.length).toBe(0);
  });
});

describe('chrome mask — the HUD must not poison the world model', () => {
  it('names relentless flicker cells as chrome; a HUD tick alone becomes an effective noop', () => {
    const r = new Reasoner({ seed: 1 });
    const base = () => Array.from({ length: 64 }, () => new Array(64).fill(5));
    let counter = 0;
    const frame = () => {
      const g = base();
      g[0][0] = counter % 16;           // a step counter that ALWAYS changes
      g[0][1] = (counter * 7) % 16;     // and its neighbour digit
      return g;
    };
    const mkObs = (grid: number[][]) => normalizeObs({
      game_id: 'hud-test', guid: 'g', frame: [grid], state: 'NOT_FINISHED',
      levels_completed: 0, win_levels: 1, action_input: { id: 0 }, available_actions: [1, 2, 3, 4],
    });
    let prev = mkObs(frame());
    r.begin(prev);
    let lastReceipt: { noop: boolean; hashBefore: string; hashAfter: string } | null = null;
    for (let i = 0; i < 30; i++) {
      counter++;
      const next = mkObs(frame());
      lastReceipt = r.observe(prev, { kind: 'simple', actionId: 1, reason: 'probe', tag: 'test' }, next);
      prev = next;
    }
    expect(r.chromeCells).toBeGreaterThanOrEqual(2);
    expect(lastReceipt!.noop).toBe(true);                       // only the HUD moved
    expect(lastReceipt!.hashBefore).toBe(lastReceipt!.hashAfter); // world identity is stable
  });
});

describe('determinism', () => {
  it('same seeds → identical run trace', () => {
    const a = drive(createMockArcade(42), createMockArcade(42).listGames()[0].game_id, { maxSteps: 300, seed: 9 });
    const b = drive(createMockArcade(42), createMockArcade(42).listGames()[0].game_id, { maxSteps: 300, seed: 9 });
    expect(a.steps).toBe(b.steps);
    expect(a.won).toBe(b.won);
    expect(JSON.stringify(a.receipts)).toBe(JSON.stringify(b.receipts));
  }, 30000);

  it('mulberry32 is a stable PRNG', () => {
    const r1 = mulberry32(1), r2 = mulberry32(1);
    for (let i = 0; i < 5; i++) expect(r1()).toBe(r2());
  });
});
