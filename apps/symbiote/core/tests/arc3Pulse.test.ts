// MK·PULSE — "find the silent door" (spatial/arc3-pulse.ts).
//
// Her first architecture-as-game contact must be provable OFFLINE: the prober
// is injected, so CI exercises the whole world — shuffle, probe, bands, mark,
// win, budget death, interference — without one real network call. The same
// blind engine that beats the arcade must beat this world end-to-end, slow
// decoys and all.
import { describe, expect, it } from 'vitest';
import { createPulseSession, NODE_SURFACES } from '../../spatial/arc3-pulse';
import type { PulseSurface } from '../../spatial/arc3-pulse';
import { Reasoner, normalizeObs } from '../../spatial/app/arc3/engine.js';

const SURFACES: PulseSurface[] = [
  { name: 'a', url: 'up://a' }, { name: 'b', url: 'up://b' },
  { name: 'c', url: 'up://c' }, { name: 'd', url: 'up://d' },
  { name: 'silent', url: 'down://x' },
];

// url schemes drive the fake: up:// answers fast, slow:// answers slowly,
// down:// never answers. Overrides win over schemes.
function fakeProber(overrides: Record<string, { up: boolean; ms: number }> = {}) {
  const calls: string[] = [];
  const probe = async (url: string) => {
    calls.push(url);
    if (url in overrides) return overrides[url];
    if (url.startsWith('slow://')) return { up: true, ms: 400 };
    return { up: url.startsWith('up://'), ms: 5 };
  };
  return { probe, calls };
}

// find the tile anchors on a frame (top-left corners of 8x8 islands)
function anchors(frame: number[][]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let y = 0; y < 64; y += 2) for (let x = 0; x < 64; x += 2) {
    if (frame[y][x] !== 0 && y < 60 && !out.some(([ax, ay]) => Math.abs(ax - x) < 8 && Math.abs(ay - y) < 8)) out.push([x, y]);
  }
  return out;
}

describe('MK·PULSE — the world itself', () => {
  it('probes are click-driven only: zero network until she acts (read-only law)', async () => {
    const { probe, calls } = fakeProber();
    const s = createPulseSession({ seed: 5, prober: probe, surfaces: SURFACES });
    s.reset();
    expect(calls.length).toBe(0);            // rendering costs nothing
    const fr = await s.act('ACTION6', 1, 1); // background click — no tile there
    expect(calls.length).toBe(0);            // still nothing: no tile, no probe
    expect(fr.state).toBe('NOT_FINISHED');
  });

  it('shuffles tiles per seed (blind law) and renders probe results as deltas', async () => {
    const a = createPulseSession({ seed: 1, prober: fakeProber().probe, surfaces: SURFACES });
    const b = createPulseSession({ seed: 2, prober: fakeProber().probe, surfaces: SURFACES });
    expect(JSON.stringify(a.reset().frame)).not.toBe(JSON.stringify(b.reset().frame));
    const { probe } = fakeProber();
    const s = createPulseSession({ seed: 7, prober: probe, surfaces: SURFACES });
    const f0 = s.reset();
    const [tx, ty] = anchors(f0.frame[0])[0];
    const f1 = await s.act('ACTION6', tx, ty);
    expect(JSON.stringify(f1.frame)).not.toBe(JSON.stringify(f0.frame)); // the tile answered visibly
  });

  it('the mark wins on the SILENT door — and a slow decoy does NOT win', async () => {
    const surfaces: PulseSurface[] = [
      { name: 'a', url: 'up://a' }, { name: 'lag', url: 'slow://lag' },
      { name: 'b', url: 'up://b' }, { name: 'c', url: 'up://c' },
      { name: 'silent', url: 'down://x' },
    ];
    const { probe } = fakeProber();
    const s = createPulseSession({ seed: 3, prober: probe, surfaces });
    let fr = s.reset();
    const tiles = anchors(fr.frame[0]);
    expect(tiles.length).toBe(5);
    let silent: [number, number] | null = null;
    let slow: [number, number] | null = null;
    for (const [x, y] of tiles) {
      fr = await s.act('ACTION6', x, y);
      if (fr.frame[0][y][x] === 9) silent = [x, y];
      if (fr.frame[0][y][x] === 4) slow = [x, y];
    }
    expect(silent).not.toBeNull();
    expect(slow).not.toBeNull();
    // marking the SLOW door: an answer, a spent action, no level
    fr = await s.act('ACTION6', slow![0], slow![1]);
    expect(fr.levels_completed).toBe(0);
    // marking the SILENT door: the level falls
    fr = await s.act('ACTION6', silent![0], silent![1]);
    expect(fr.levels_completed).toBe(1);
  });

  it('bands wear speed strips, and a degrading door drains its strip', async () => {
    let ms = 5;
    const prober = async (url: string) => (url === 'var://v' ? { up: true, ms } : { up: url.startsWith('up://'), ms: 5 });
    const surfaces: PulseSurface[] = [
      { name: 'v', url: 'var://v' }, { name: 'a', url: 'up://a' },
      { name: 'b', url: 'up://b' }, { name: 'c', url: 'up://c' }, { name: 'd', url: 'up://d' },
    ];
    const s = createPulseSession({ seed: 13, prober, surfaces, slowMs: 250 });
    let fr = s.reset();
    const tiles = anchors(fr.frame[0]);
    // probe everything once (v reads fast: full strip somewhere)
    for (const [x, y] of tiles) fr = await s.act('ACTION6', x, y);
    const stripCells = (f: number[][]) => f.flat().filter((c) => c === 12).length;
    const fullStrips = stripCells(fr.frame[0]);
    ms = 400; // v degrades
    for (const [x, y] of tiles) fr = await s.act('ACTION6', x, y);
    const afterStrips = stripCells(fr.frame[0]);
    expect(afterStrips).toBeLessThan(fullStrips); // the strip drained: degraded, not dead
    // and no contradiction was minted for a mere band shift
    expect(fr.pulse_contradictions.length).toBe(0);
  });

  it('a flaky door produces a REAL aukora-fu contradiction, φ-decaying, never averaged away', async () => {
    let up = true;
    const prober = async (url: string) => (url === 'flip://f' ? { up, ms: 5 } : { up: true, ms: 5 });
    const surfaces: PulseSurface[] = [
      { name: 'f', url: 'flip://f' }, { name: 'a', url: 'up://a' },
      { name: 'b', url: 'up://b' }, { name: 'c', url: 'up://c' }, { name: 'd', url: 'up://d' },
    ];
    const s = createPulseSession({ seed: 9, prober, surfaces });
    let fr = s.reset();
    const tiles = anchors(fr.frame[0]);
    for (const [x, y] of tiles) fr = await s.act('ACTION6', x, y);
    up = false; // f goes silent — negation, not degradation
    for (const [x, y] of tiles) fr = await s.act('ACTION6', x, y);
    expect(fr.pulse_contradictions.length).toBeGreaterThanOrEqual(1);
    const c = fr.pulse_contradictions[0];
    expect(c.shearNow).toBeGreaterThan(0);
    expect(c.status).toBe('open');
  });

  it('the action cap ends a life honestly; reset replays the same board', async () => {
    const { probe } = fakeProber();
    const s = createPulseSession({ seed: 11, prober: probe, surfaces: SURFACES });
    const f0 = s.reset();
    let fr = f0;
    for (let i = 0; i < 30 && fr.state === 'NOT_FINISHED'; i++) fr = await s.act('ACTION6', 0, 0);
    expect(fr.state).toBe('GAME_OVER');
    const f1 = s.reset();
    expect(f1.state).toBe('NOT_FINISHED');
    expect(JSON.stringify(f1.frame)).toBe(JSON.stringify(f0.frame)); // same life, same board
  });

  it('the probe budget is drawn as a draining bar — one column per action', async () => {
    const { probe } = fakeProber();
    const s = createPulseSession({ seed: 15, prober: probe, surfaces: SURFACES });
    const f0 = s.reset();
    const bar = (f: number[][]) => f[61].filter((c) => c === 13).length;
    expect(bar(f0.frame[0])).toBe(24);
    const f1 = await s.act('ACTION6', 0, 0);
    expect(bar(f1.frame[0])).toBe(23);
    const f2 = await s.act('ACTION6', 0, 0);
    expect(bar(f2.frame[0])).toBe(22);
  });
});

describe('MK·PULSE — the blind engine plays her own body', () => {
  async function driveEngine(surfaces: PulseSurface[], prober: (u: string) => Promise<{ up: boolean; ms: number }>, seed: number) {
    const s = createPulseSession({ seed, prober, surfaces });
    const r = new Reasoner({ seed });
    let obs = normalizeObs(s.reset());
    r.begin(obs);
    let steps = 0, lives = 1;
    while (obs.state !== 'WIN' && steps < 400) {
      if (obs.state === 'GAME_OVER') {
        if (lives >= 10) break;
        lives++;
        obs = normalizeObs(s.reset());
        r.rebirth(obs);
        continue;
      }
      const d = r.decide(obs);
      const prev = obs;
      const fr = d.kind === 'click' ? await s.act('ACTION6', d.x, d.y) : await s.act(`ACTION${d.actionId}`);
      obs = normalizeObs(fr);
      r.observe(prev, d, obs);
      steps++;
    }
    return { obs, r, steps, lives };
  }

  it('finds and names the silent door end-to-end — with a slow decoy on the board', async () => {
    const surfaces: PulseSurface[] = [
      { name: 'a', url: 'up://a' }, { name: 'lag', url: 'slow://lag' },
      { name: 'b', url: 'up://b' }, { name: 'c', url: 'up://c' },
      { name: 'silent', url: 'down://x' },
    ];
    const { probe } = fakeProber();
    const res = await driveEngine(surfaces, probe, 7);
    expect(res.obs.state).toBe('WIN');
    expect(res.obs.levelsCompleted).toBe(2);
  }, 30000);

  it('her own probe budget registers on the drain-watch and the death-ledger', async () => {
    const { probe } = fakeProber();
    // a board with NO silent door: she cannot win, only learn the economy
    const surfaces: PulseSurface[] = [
      { name: 'a', url: 'up://a' }, { name: 'b', url: 'up://b' },
      { name: 'c', url: 'up://c' }, { name: 'd', url: 'up://d' }, { name: 'e', url: 'up://e' },
    ];
    const res = await driveEngine(surfaces, probe, 11);
    expect(res.obs.state).toBe('GAME_OVER');
    // the budget bar was caught as a gauge (drain-watch, intu)…
    expect(res.r.fuelColor).toBe(13);
    // …and a watched death fixed moves-per-life exactly (death-ledger, di)
    expect(res.r.movesPerLife).toBeGreaterThanOrEqual(20);
    expect(res.r.movesPerLife).toBeLessThanOrEqual(30);
  }, 30000);
});

describe('MK·PULSE — the real surface table', () => {
  it('probes only loopback addresses (the read-only law is structural)', () => {
    for (const sfc of NODE_SURFACES) expect(sfc.url.startsWith('http://127.0.0.1:')).toBe(true);
  });
});
