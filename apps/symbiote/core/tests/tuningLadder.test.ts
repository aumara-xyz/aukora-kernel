// The Tuning — the Platonic ladder and the day's notes (spatial/app/tuning.js),
// plus the glyph's mode bank (spatial/app/coherence-glyph.js). Pins the game's
// contract: evidence gates never totals, single-source grinding stalls, there
// is NO level six, and progression only makes more of the SAME signature
// audible. Browser globals shimmed and restored, as in auraCore.test.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const store = new Map<string, string>();
const RealDate = Date;
let NOW = 0;
const saved: Record<string, unknown> = {};
let core: any, tuningState: any, signatureSpectrum: any;
const hours = (h: number) => { NOW += h * 3600000; };

function completeLesson(dayKey: string) {
  core.award('lesson');
  const s = core.ensure(core.loadState());
  s.done[dayKey] = true;                                  // the caller's first-completion evidence
  core.saveState(s);
}

beforeAll(async () => {
  saved.localStorage = (globalThis as any).localStorage;
  saved.window = (globalThis as any).window;
  saved.CustomEvent = (globalThis as any).CustomEvent;
  saved.Date = globalThis.Date;
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
  };
  (globalThis as any).window = { dispatchEvent: () => true };
  (globalThis as any).CustomEvent = class { constructor(public type: string, public opts: unknown) {} };
  (globalThis as any).Date = class extends RealDate {
    constructor(...a: unknown[]) { a.length ? super(...(a as [number])) : super(NOW); }
    static now() { return NOW; }
  };
  // @ts-ignore - browser app module is plain JS; this test exercises it intentionally.
  core = await import('../../spatial/app/aura-core.js');
  // @ts-ignore - browser app module is plain JS; this test exercises it intentionally.
  ({ tuningState } = await import('../../spatial/app/tuning.js'));
  // @ts-ignore - browser app module is plain JS; this test exercises it intentionally.
  ({ signatureSpectrum } = await import('../../spatial/app/coherence-glyph.js'));
});
afterAll(() => {
  (globalThis as any).localStorage = saved.localStorage;
  (globalThis as any).window = saved.window;
  (globalThis as any).CustomEvent = saved.CustomEvent;
  (globalThis as any).Date = saved.Date;
});
beforeEach(() => { store.clear(); NOW = new RealDate('2026-07-01T09:00:00').getTime(); });

describe('the Platonic ladder', () => {
  it('an honest, varied week climbs tetrahedron → icosahedron; no level six', () => {
    let t = tuningState(core.readAura());
    expect([t.solid, t.modes, t.day.struck]).toEqual(['tetrahedron', 2, 0]);

    completeLesson('d1');
    core.award('message', { text: 'a genuine first conversation with her about the day ahead' });
    t = tuningState(core.readAura());
    expect([t.solid, t.modes]).toEqual(['cube', 3]);
    expect(t.day.chord).toBe(true);                       // first note + ring + voice

    hours(24);
    core.award('message', { text: 'back again the next morning to keep the thread alive and well' });
    core.award('reading', { source: 'cast' });
    expect(tuningState(core.readAura()).solid).toBe('cube'); // three kinds sounded, but octahedron wants a second lesson

    hours(24); completeLesson('d3'); core.award('message', { text: 'third day showing up with something real to say to her' });
    expect(tuningState(core.readAura()).solid).toBe('octahedron');
    hours(24); completeLesson('d4'); core.award('reading', { source: 'cast' });
    expect(tuningState(core.readAura()).solid).toBe('dodecahedron');

    hours(24); completeLesson('d5'); core.award('message', { text: 'fifth day of practice and the rhythm is starting to hold' });
    hours(24); completeLesson('d6'); completeLesson('d6b'); core.award('message', { text: 'sixth day and the figure is nearly whole now she says' });
    hours(24); completeLesson('d7'); core.award('message', { text: 'the seventh day rings the chord and the rim holds solid' }); core.award('reading', { source: 'cast' });
    t = tuningState(core.readAura());
    expect([t.solid, t.modes, t.atLast]).toEqual(['icosahedron', 6, true]);
    expect(t.next).toMatch(/no next solid|stay in tune/i);
  });

  it('single-source grinding stalls before octahedron — diversity is structural', () => {
    for (let d = 0; d < 10; d++) {
      core.award('message', { text: 'grinding the same single domain on day number ' + d + ' hoping to climb' });
      hours(24);
    }
    expect(['tetrahedron', 'cube']).toContain(tuningState(core.readAura()).solid);
  });
});

describe('the glyph mode bank', () => {
  it('progression makes more of the SAME signature audible — never a new one', () => {
    const m2 = signatureSpectrum('same-being', 2);
    const m6 = signatureSpectrum('same-being', 6);
    expect(m6.slice(0, 2)).toEqual(m2);
    expect(m6).toHaveLength(6);
  });

  it('weights decay by golden ratio and the bank is deterministic', () => {
    const m = signatureSpectrum('anyone');
    expect(m[1].w).toBeCloseTo(0.618, 3);
    expect(m[2].w).toBeCloseTo(0.382, 3);
    expect(signatureSpectrum('anyone')).toEqual(m);
    expect(signatureSpectrum('someone-else')).not.toEqual(m);
  });
});
