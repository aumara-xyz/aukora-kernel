// THE DEN — the Wolf's offline research lab (spatial/app/wolf/wolf-lab.js).
// Pins: studies are deterministic and walk-forward honest (train never sees
// the test window, test stats come only from the hold-out), the backtester
// obeys the SAME ledger laws as the app (no debt, no shorts, audit-clean),
// signals mean what their sentences say, and every study carries its
// disclaimer. Research only — there is no code path from a study to a trade.
import { describe, expect, it } from 'vitest';
import { runStudy, backtest, SIGNALS, STUDY_DISCLAIMER, TRAIN_SPLIT, buildPackNote, verifyPackNote, packDisagreement, PACK_NOTE_SCHEMA, composeDossier, tapeFacts, precomputeRegimes } from '../../spatial/app/wolf/wolf-lab.js';

describe('studies — deterministic, walk-forward, labeled', () => {
  it('same seed → the exact same studies', () => {
    const a = runStudy(7, { ticks: 600 });
    const b = runStudy(7, { ticks: 600 });
    const strip = (s: { at: string }[]) => s.map(({ at, ...rest }) => rest);
    expect(JSON.stringify(strip(a))).toBe(JSON.stringify(strip(b)));
  });

  it('one study per instrument, each carrying habit, both windows, and the disclaimer', () => {
    const studies = runStudy(11, { ticks: 600 });
    expect(studies.length).toBe(5);
    for (const s of studies) {
      expect(typeof s.habit).toBe('string');
      expect(s.habit.length).toBeGreaterThan(10);       // a sentence, not a code
      expect(s.disclaimer).toBe(STUDY_DISCLAIMER);
      expect(s.window.trainTo).toBe(Math.floor(600 * TRAIN_SPLIT));
      expect(typeof s.train.return).toBe('number');
      expect(typeof s.test.return).toBe('number');
      expect(typeof s.buyHoldTest).toBe('number');
    }
  });

  it('test stats come ONLY from the hold-out window (equity length proves it)', () => {
    const studies = runStudy(3, { ticks: 500 });
    const split = Math.floor(500 * TRAIN_SPLIT);
    for (const s of studies) {
      expect(s.test.equity.length).toBe(500 - split);   // not one tick more
    }
  });

  it('every lab backtest book is audit-clean — the lab obeys the ledger laws', () => {
    const studies = runStudy(19, { ticks: 400 });
    for (const s of studies) expect(s.test.auditOk).toBe(true);
  });
});

describe('the backtester — ledger laws hold in the lab', () => {
  it('a flat series produces no trades and no return', () => {
    const flat = new Array(200).fill(50);
    const r = backtest(flat, 'X', 'momentum', { k: 10 }, [0, 200]);
    expect(r.trades).toBe(0);
    expect(r.totalReturn).toBeCloseTo(0, 9);
    expect(r.maxDrawdown).toBeCloseTo(0, 9);
  });

  it('momentum rides a pure ramp and banks the ride', () => {
    const ramp = Array.from({ length: 300 }, (_, i) => 100 + i);
    const r = backtest(ramp, 'X', 'momentum', { k: 10 }, [0, 300]);
    expect(r.totalReturn).toBeGreaterThan(0.5);          // rode most of a 3x-ish ramp
    expect(r.maxDrawdown).toBeLessThan(0.01);
  });

  it('sma-cross exits when the trend breaks', () => {
    const up = Array.from({ length: 200 }, (_, i) => 100 + i);
    const down = Array.from({ length: 200 }, (_, i) => 300 - i * 1.4);
    const series = [...up, ...down];
    const r = backtest(series, 'X', 'sma-cross', { fast: 5, slow: 30 }, [0, series.length]);
    expect(r.trades).toBeGreaterThanOrEqual(1);
    // it must NOT ride the whole collapse: drawdown stays far below buy-hold's
    const buyHoldDD = (400 - series[series.length - 1]) / 400;
    expect(r.maxDrawdown).toBeLessThan(buyHoldDD * 0.6);
  });
});

describe('sizing — how much decides who survives', () => {
  it('smaller size, smaller drawdown: the crash tape proves it', () => {
    const up = Array.from({ length: 200 }, (_, i) => 100 + i);
    const crash = Array.from({ length: 60 }, (_, i) => 300 - i * 4);
    const tape = [...up, ...crash];
    const full = backtest(tape, 'X', 'momentum', { k: 10 }, [0, tape.length], 10, 1);
    const third = backtest(tape, 'X', 'momentum', { k: 10 }, [0, tape.length], 10, 0.33);
    expect(third.maxDrawdown).toBeLessThan(full.maxDrawdown * 0.6); // pain scales with size
  });

  it('studies learn a size and say it out loud in the habit sentence', () => {
    const studies = runStudy(7, { ticks: 500 });
    for (const st of studies) {
      expect([0.33, 0.66, 1]).toContain(st.sizeFrac);
      expect(st.habit).toContain('risking');
      expect(st.habit).toContain('% of the wallet per entry');
    }
  });

  it('pack notes declare their size; an undeclared size is refused', () => {
    const st = runStudy(7, { ticks: 500 })[0];
    const note = buildPackNote(st, { node: 'sam-mac' });
    expect(verifyPackNote(JSON.parse(JSON.stringify(note))).ok).toBe(true); // sized note re-derives
    const stripped = JSON.parse(JSON.stringify(note));
    delete stripped.sizeFrac;
    const v = verifyPackNote(stripped);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain('declare how much it risked');
  });
});

describe('the fence, in the lab', () => {
  it('wolf-lab imports only its own pack and cannot reach a network', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'spatial/app/wolf/wolf-lab.js'), 'utf-8');
    expect(src.includes('fetch(')).toBe(false);
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports).toEqual(['./wolf-market.js', './wolf-ledger.js']);
  });
});


describe('pack notes — shared awareness that verifies, never trusts', () => {
  const study = () => runStudy(7, { ticks: 500 })[0];

  it('a truthful note round-trips: build → (carry) → verify by full re-derivation', () => {
    const note = buildPackNote(study(), { node: 'sam-mac', humanNote: 'momentum feels thin here — watch the drawdown' });
    expect(note.schema).toBe(PACK_NOTE_SCHEMA);
    expect(note.paperOnly).toBe(true);
    const v = verifyPackNote(JSON.parse(JSON.stringify(note)));
    expect(v.ok).toBe(true);
  });

  it('a flattered return is CAUGHT COLD — re-derivation beats reputation', () => {
    const note = buildPackNote(study(), { node: 'braggart-node' });
    note.claimed.testReturn += 0.05; // the lie: +5% that never happened
    const v = verifyPackNote(note);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain('lies about its hold-out');
  });

  it('a hidden drawdown is caught the same way', () => {
    const note = buildPackNote(study(), { node: 'smooth-talker' });
    note.claimed.testMaxDrawdown = 0; // 'we never had a bad day'
    const v = verifyPackNote(note);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain('hides its worst day');
  });

  it('malformed and oversized notes are refused at the door', () => {
    expect(verifyPackNote(null as unknown as object).ok).toBe(false);
    expect(verifyPackNote({ schema: 'wolf-pack-note-v1' }).ok).toBe(false);
    const note = buildPackNote(study(), { node: 'x' });
    (note as { window: { ticks: number } }).window.ticks = 999999; // re-derivation DoS attempt
    expect(verifyPackNote(note).ok).toBe(false);
    const long = buildPackNote(study(), { node: 'y', humanNote: 'a'.repeat(2000) });
    expect(long.humanNote.length).toBeLessThanOrEqual(500); // bounded at build too
  });

  it('the human rides along, bounded and verbatim', () => {
    const note = buildPackNote(study(), { node: 'sam-mac', humanNote: 'I would not trust this in a real week.' });
    expect(note.humanNote).toBe('I would not trust this in a real week.');
    expect(verifyPackNote(note).ok).toBe(true); // human words never break the math
  });

  it('disagreement between packs is surfaced, not averaged away', () => {
    const studies = runStudy(7, { ticks: 500 });
    const mine = studies[0];
    const foreign = buildPackNote(mine, { node: 'other-node' });
    (foreign as { signal: string }).signal = mine.signal === 'momentum' ? 'sma-cross' : 'momentum';
    const d = packDisagreement(studies, foreign);
    expect(d).not.toBeNull();
    if (d) { expect(d.symbol).toBe(mine.symbol); expect(d.mine.signal).not.toBe(d.theirs.signal); }
    expect(packDisagreement(studies, buildPackNote(mine, { node: 'twin' }))).toBeNull(); // agreement is quiet
  });
});


describe('the dossier — a research brief with receipts', () => {
  it('composes deterministically from seed + study, facts re-derive', () => {
    const st = runStudy(7, { ticks: 500 })[0];
    const a = composeDossier(7, st, {});
    const b = composeDossier(7, st, {});
    expect(a.text.split('composed')[0]).toBe(b.text.split('composed')[0]); // timestamp aside, identical
    const f = tapeFacts(7, st.symbol, 500);
    expect(a.facts.drift).toBeCloseTo(f!.drift, 12); // the brief's facts ARE the tape's facts
  });

  it('carries the habit, the costs line, the human read, and the pack voices', () => {
    const studies = runStudy(7, { ticks: 500 });
    const st = studies[0];
    const foreign = buildPackNote(studies[0], { node: 'other-wolf', humanNote: 'size half.' });
    const d = composeDossier(7, st, { humanNote: 'my own caution here', packNotes: [foreign] });
    expect(d.text).toContain(st.habit);
    expect(d.text).toContain('friction');
    expect(d.text).toContain('THE HUMAN READ');
    expect(d.text).toContain('my own caution here');
    expect(d.text).toContain('other-wolf');
    expect(d.text).toContain('WHAT THE RECEIPTS DO NOT SAY');
    expect(d.text).toContain('recommends nothing');
  });

  it('stays honest when there is nothing extra to say', () => {
    const st = runStudy(11, { ticks: 500 })[1];
    const d = composeDossier(11, st, {});
    expect(d.text).not.toContain('THE HUMAN READ');
    expect(d.text).not.toContain('VOICES');
    expect(d.text).toContain(STUDY_DISCLAIMER);
  });
});


describe('the weather — regimes read from arithmetic, shelters learned', () => {
  it('a clean ramp reads trending; a volatility explosion reads storm', () => {
    const calm = Array.from({ length: 200 }, (_, i) => 100 + i * 0.5);
    let noisy = 100;
    const wild = calm.concat(Array.from({ length: 100 }, (_, i) => { noisy *= 1 + (i % 2 ? 0.06 : -0.055); return calm[199] + (noisy - 100); }));
    const regs = precomputeRegimes(wild, 30);
    expect(regs[180]).toBe('trending');            // the steady climb
    expect(regs[wild.length - 5]).toBe('storm');   // the explosion
    expect(regs[10]).toBe('young');                // too early to say
  });

  it('regime P&L attribution sums to the equity change', () => {
    const st = runStudy(7, { ticks: 500 })[0];
    const rp = st.test.regimePnl;
    const sum = rp.trending + rp.choppy + rp.storm + rp.young;
    const eq = st.test.equity;
    expect(sum).toBeCloseTo(eq[eq.length - 1] - 10000, 4);
  });

  it('the storm shelter cuts drawdown on a ramp-then-storm tape', () => {
    const up = Array.from({ length: 300 }, (_, i) => 100 + i * 0.4);
    let px = up[299];
    const storm = Array.from({ length: 120 }, (_, i) => { px *= 1 + (i % 2 ? 0.05 : -0.056); return px; });
    const tape = [...up, ...storm];
    const regimes = precomputeRegimes(tape);
    const exposed = backtest(tape, 'X', 'momentum', { k: 10, calmOnly: 0 }, [0, tape.length], 10, 1, regimes);
    const sheltered = backtest(tape, 'X', 'momentum', { k: 10, calmOnly: 1 }, [0, tape.length], 10, 1, regimes);
    expect(sheltered.maxDrawdown).toBeLessThan(exposed.maxDrawdown); // the den is safer than the storm
  });

  it('a sheltering habit says so in its sentence, and its note still verifies', () => {
    const studies = runStudy(7, { ticks: 500 });
    for (const st of studies) {
      if (st.params.calmOnly === 1) expect(st.habit).toContain('staying in the den during storms');
      const v = verifyPackNote(JSON.parse(JSON.stringify(buildPackNote(st, { node: 'x' }))));
      expect(v.ok).toBe(true); // calmOnly rides the params — the schema never moved
    }
  });
});
