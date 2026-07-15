// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
//
// THE DEN — the Wolf's research lab. PAPER ONLY, forever (issue #270).
//
// This is where "it keeps evolving" begins, the covenant way: OFFLINE,
// inspectable backtesting over the SIM market's own generated history.
// The wolf tries simple, readable rules — no black boxes, every rule is a
// sentence a human can check — scores them on the FIRST part of history,
// then validates on a hold-out window it never trained on (walk-forward:
// the one honesty trick that separates research from self-deception).
// The result is a per-instrument STUDY: which habit worked on this tape,
// with train AND test numbers shown side by side, receipts throughout.
//
// A study is meta-awareness in the smallest honest form: the wolf keeping
// notes about specific instruments. It is research, labeled research, and
// it can never place an order or recommend one — there is no code path
// from a study to a trade, and the fence pin keeps this module networkless.
//
// Pure module: no DOM, no fetch, no timers.

import { createMarket } from './wolf-market.js';
import { createLedger, STARTING_CASH } from './wolf-ledger.js';

export const STUDY_DISCLAIMER =
  'a study of the past on a toy tape — research only; never an order, never advice; past ≠ future';

export const LAB_TAPE_TICKS = 2000;   // the longer tape the lab generates
export const TRAIN_SPLIT = 0.7;       // first 70% teaches, last 30% judges

// ---------------------------------------------------------------------------
// Signals — each one is a sentence. decide(series, i, p) → 1 (hold) | 0 (out).
// ---------------------------------------------------------------------------

function sma(series, i, n) {
  if (i + 1 < n) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += series[k];
  return s / n;
}

export const SIGNALS = Object.freeze({
  'sma-cross': {
    grid: [
      { fast: 5, slow: 30 }, { fast: 10, slow: 60 }, { fast: 20, slow: 120 },
      { fast: 5, slow: 60 }, { fast: 10, slow: 120 },
    ],
    describe: (p) => `hold while the ${p.fast}-tick average sits above the ${p.slow}-tick average`,
    decide: (series, i, p) => {
      const f = sma(series, i, p.fast), s = sma(series, i, p.slow);
      if (f == null || s == null) return 0;
      return f > s ? 1 : 0;
    },
  },
  momentum: {
    grid: [{ k: 10 }, { k: 30 }, { k: 60 }],
    describe: (p) => `hold while the price is higher than it was ${p.k} ticks ago`,
    decide: (series, i, p) => (i >= p.k && series[i] > series[i - p.k] ? 1 : 0),
  },
  'mean-revert': {
    grid: [{ win: 30, z: 1 }, { win: 60, z: 1 }, { win: 30, z: 2 }, { win: 60, z: 2 }],
    describe: (p) => `buy when the price falls ${p.z} deviation${p.z === 1 ? '' : 's'} below its ${p.win}-tick mean, step out at the mean`,
    decide: (series, i, p) => {
      const m = sma(series, i, p.win);
      if (m == null) return 0;
      let v = 0;
      for (let k = i - p.win + 1; k <= i; k++) v += (series[k] - m) ** 2;
      const sd = Math.sqrt(v / p.win) || 1e-9;
      const z = (series[i] - m) / sd;
      if (z < -p.z) return 1;
      if (z >= 0) return 0;
      return -1; // keep whatever we held (hysteresis)
    },
  },
});

// ---------------------------------------------------------------------------
// The weather — regime awareness. A tape is not one market: it trends, it
// chops, it storms. The classifier is arithmetic (no oracle): a window is a
// STORM when volatility jumps versus the window before it, TRENDING when the
// move outruns the noise, CHOPPY otherwise, YOUNG before there is enough
// history to say. Habits can learn to stay in the den during storms.
// ---------------------------------------------------------------------------

const REGIME_WIN = 60;

export function precomputeRegimes(series, win = REGIME_WIN) {
  const n = series.length;
  const rets = new Array(n).fill(0);
  for (let i = 1; i < n; i++) rets[i] = series[i] / series[i - 1] - 1;
  const out = new Array(n).fill('young');
  // rolling sums for O(1) window stdev
  let sum = 0, sumSq = 0;
  const std = (from, to) => { // stdev of rets[from..to] inclusive, recomputed cheaply
    let s = 0, q = 0;
    for (let k = from; k <= to; k++) { s += rets[k]; q += rets[k] * rets[k]; }
    const m = s / (to - from + 1);
    return Math.sqrt(Math.max(0, q / (to - from + 1) - m * m));
  };
  // calm-weather baseline with hysteresis: it learns what calm volatility
  // looks like and FREEZES during storms — so a storm stays a storm until
  // the weather actually clears, not merely until it becomes familiar.
  let calmVol = null;
  for (let i = 2 * win; i < n; i++) {
    const volNow = std(i - win + 1, i);
    if (calmVol == null) calmVol = volNow;
    const move = Math.abs(series[i] / series[i - win] - 1);
    if (volNow > 1.6 * (calmVol || 1e-12)) {
      out[i] = 'storm'; // baseline frozen — familiarity is not calm
    } else {
      calmVol = calmVol * 0.9 + volNow * 0.1;
      out[i] = move > 2 * volNow * Math.sqrt(win) ? 'trending' : 'choppy';
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The backtester — the SAME ledger rules the app trades under. No debt, no
// shorts, all-in/all-out, every fill receipted with lab provenance.
// ---------------------------------------------------------------------------

export const SIZE_GRID = Object.freeze([0.33, 0.66, 1]); // how much of the wallet each entry risks

export function backtest(series, symbol, signalKey, params, range, feeBps = 10, sizeFrac = 1, regimes = null) {
  const sig = SIGNALS[signalKey];
  const [from, to] = range;
  const regs = regimes ?? precomputeRegimes(series);
  const ledger = createLedger(undefined, { feeBps, slipBps: 0 });
  const equity = [];
  const regimePnl = { trending: 0, choppy: 0, storm: 0, young: 0 };
  let eqPrev = STARTING_CASH;
  let holding = false;
  let peak = STARTING_CASH, maxDD = 0, wins = 0, losses = 0;

  const quoteAt = (i) => ({
    symbol, name: symbol, hue: '0,0,0', price: series[i], prev: series[i],
    history: [], provenance: { source: 'SIM · lab replay', seed: 0, tick: i, at: 'lab' },
  });

  for (let i = from; i < to; i++) {
    const raw = sig.decide(series, i, params);
    let target = raw === -1 ? (holding ? 1 : 0) : raw;
    // the learned shelter: some habits stay in the den during storms
    if (params.calmOnly === 1 && regs[i] === 'storm') target = 0;
    if (target === 1 && !holding) {
      const r = ledger.buy(quoteAt(i), ledger.cash * sizeFrac, `lab-t${i}`);
      if (r.ok) holding = true;
    } else if (target === 0 && holding) {
      const r = ledger.sell(quoteAt(i), 1, `lab-t${i}`);
      if (r.ok) { holding = false; if (r.realized > 0) wins++; else losses++; }
    }
    const eq = ledger.equity({ [symbol]: series[i] });
    equity.push(eq);
    regimePnl[regs[i]] += eq - eqPrev;
    eqPrev = eq;
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  // close the book at the window's end so return is realized and auditable
  if (holding) {
    const r = ledger.sell(quoteAt(to - 1), 1, 'lab-close');
    if (r.ok && r.realized > 0) wins++; else if (r.ok) losses++;
  }
  const audit = ledger.audit();
  return {
    totalReturn: ledger.cash / STARTING_CASH - 1,
    maxDrawdown: maxDD,
    trades: wins + losses,
    winRate: wins + losses ? wins / (wins + losses) : 0,
    equity,
    regimePnl,
    auditOk: audit.ok === true,
  };
}

// score: return, tempered by drawdown — a habit that wins by cliff-diving loses
function score(stats) {
  return stats.totalReturn - 0.5 * stats.maxDrawdown;
}

// ---------------------------------------------------------------------------
// The study — walk-forward per instrument: sweep on train, judge on test.
// ---------------------------------------------------------------------------

export function runStudy(seed, opts = {}) {
  const ticks = opts.ticks ?? LAB_TAPE_TICKS;
  const feeBps = Number.isFinite(opts.feeBps) ? opts.feeBps : 10;
  const split = Math.floor(ticks * (opts.trainSplit ?? TRAIN_SPLIT));
  const tape = regenerateSeries(seed, ticks); // one long tape, generated once

  const studies = [];
  for (const symbol of Object.keys(tape)) {
    const full = tape[symbol];
    const regimes = precomputeRegimes(full);
    let best = null;
    for (const [key, sig] of Object.entries(SIGNALS)) {
      for (const baseParams of sig.grid) {
        for (const calmOnly of [0, 1]) {
          const params = { ...baseParams, calmOnly };
          for (const sizeFrac of SIZE_GRID) {
            const train = backtest(full, symbol, key, params, [0, split], feeBps, sizeFrac, regimes);
            if (!best || score(train) > score(best.train)) {
              best = {
                signal: key, params, sizeFrac,
                describe: `${sig.describe(baseParams)}, risking ${Math.round(sizeFrac * 100)}% of the wallet per entry${calmOnly ? ', staying in the den during storms' : ''}`,
                train,
              };
            }
          }
        }
      }
    }
    const test = backtest(full, symbol, best.signal, best.params, [split, ticks], feeBps, best.sizeFrac, regimes);
    // the same habit with zero friction — so the card can say what costs ATE
    const gross = backtest(full, symbol, best.signal, best.params, [split, ticks], 0, best.sizeFrac, regimes);
    const buyHold = full[ticks - 1] / full[split] - 1; // the honest benchmark on the test window
    studies.push({
      symbol,
      signal: best.signal,
      params: best.params,
      habit: best.describe,
      train: { return: best.train.totalReturn, maxDrawdown: best.train.maxDrawdown, trades: best.train.trades, winRate: best.train.winRate },
      test: { return: test.totalReturn, grossReturn: gross.totalReturn, maxDrawdown: test.maxDrawdown, trades: test.trades, winRate: test.winRate, equity: test.equity, regimePnl: test.regimePnl, auditOk: test.auditOk },
      buyHoldTest: buyHold,
      window: { ticks, trainTo: split },
      feeBps,
      sizeFrac: best.sizeFrac,
      seed,
      disclaimer: STUDY_DISCLAIMER,
      at: new Date().toISOString(),
    });
  }
  return studies;
}

function regenerateSeries(seed, ticks) {
  const m = createMarket({ seed });
  const out = {};
  for (const ins of m.instruments) out[ins.symbol] = [ins.start];
  for (let i = 0; i < ticks; i++) {
    m.step('lab');
    for (const q of m.quotes('lab')) out[q.symbol].push(q.price);
  }
  return out;
}

// ---------------------------------------------------------------------------
// PACK NOTES — the first honest step toward the wolf pack (human-carried).
//
// A pack note is one study, sealed with everything another node needs to
// RE-DERIVE it from scratch: seed, window, signal, params, claimed numbers.
// The receiving wolf does not trust the sender — it replays the study on its
// own metal and compares. Agreement is earned arithmetic, not reputation.
// The human rides along: an owner's note (their read, their words) travels
// with the AI's habit, so shared awareness is always a braid of both.
//
// Transport is the humans, for now: copy, carry, paste — the same way this
// whole repo moves between lanes. Node-to-node wire transport is a later,
// governed round. Export is a human button-press, one note at a time.
// ---------------------------------------------------------------------------

export const PACK_NOTE_SCHEMA = 'wolf-pack-note-v1';
const NOTE_MAX_HUMAN = 500;
const NOTE_MAX_NODE = 60;

export function buildPackNote(study, opts = {}) {
  return {
    schema: PACK_NOTE_SCHEMA,
    symbol: study.symbol,
    seed: study.seed,
    window: { ticks: study.window.ticks, trainTo: study.window.trainTo },
    feeBps: study.feeBps ?? 10,
    sizeFrac: study.sizeFrac ?? 1,
    signal: study.signal,
    params: study.params,
    habit: study.habit,
    claimed: {
      trainReturn: study.train.return,
      testReturn: study.test.return,
      testMaxDrawdown: study.test.maxDrawdown,
      testTrades: study.test.trades,
      buyHoldTest: study.buyHoldTest,
    },
    humanNote: String(opts.humanNote ?? '').slice(0, NOTE_MAX_HUMAN),
    node: String(opts.node ?? 'unnamed-node').slice(0, NOTE_MAX_NODE),
    at: study.at,
    paperOnly: true,
    disclaimer: STUDY_DISCLAIMER,
  };
}

function noteShapeReason(n) {
  if (!n || typeof n !== 'object' || Array.isArray(n)) return 'not an object';
  if (n.schema !== PACK_NOTE_SCHEMA) return 'wrong schema';
  if (n.paperOnly !== true) return 'paperOnly must be true — the pack has no other kind';
  if (typeof n.symbol !== 'string' || !/^[A-Z]{2,6}$/.test(n.symbol)) return 'symbol invalid';
  if (typeof n.seed !== 'number' || !Number.isFinite(n.seed)) return 'seed invalid';
  if (!n.window || typeof n.window.ticks !== 'number' || typeof n.window.trainTo !== 'number') return 'window invalid';
  if (n.window.ticks < 100 || n.window.ticks > 20000) return 'window.ticks out of the sane range (100..20000)';
  if (n.window.trainTo <= 0 || n.window.trainTo >= n.window.ticks) return 'window.trainTo must split the tape';
  if (typeof n.feeBps !== 'number' || !Number.isFinite(n.feeBps) || n.feeBps < 0 || n.feeBps > 500) return 'feeBps missing or unsane — a note must declare its friction';
  if (typeof n.sizeFrac !== 'number' || !(n.sizeFrac > 0.05) || !(n.sizeFrac <= 1)) return 'sizeFrac missing or unsane — a note must declare how much it risked';
  if (typeof n.signal !== 'string' || !(n.signal in SIGNALS)) return `unknown signal '${String(n.signal).slice(0, 30)}'`;
  if (!n.params || typeof n.params !== 'object' || Array.isArray(n.params)) return 'params invalid';
  const pk = Object.keys(n.params);
  if (pk.length > 6 || pk.some((k) => typeof n.params[k] !== 'number' || !Number.isFinite(n.params[k]))) return 'params must be a few finite numbers';
  if (!n.claimed || typeof n.claimed !== 'object') return 'claimed stats missing';
  for (const k of ['trainReturn', 'testReturn', 'testMaxDrawdown', 'testTrades', 'buyHoldTest']) {
    if (typeof n.claimed[k] !== 'number' || !Number.isFinite(n.claimed[k])) return `claimed.${k} invalid`;
  }
  if (typeof n.humanNote !== 'string' || n.humanNote.length > NOTE_MAX_HUMAN) return 'humanNote invalid or too long';
  if (typeof n.node !== 'string' || !n.node || n.node.length > NOTE_MAX_NODE) return 'node name invalid';
  return null;
}

/**
 * Verify a pack note by RE-DERIVING the whole study on this node and
 * comparing every claimed number. The math is deterministic, so agreement is
 * exact; any lie — a flattered return, a hidden drawdown — is caught cold.
 */
export function verifyPackNote(note) {
  const shape = noteShapeReason(note);
  if (shape) return { ok: false, reason: shape };
  const tape = regenerateSeries(note.seed, note.window.ticks);
  const series = tape[note.symbol];
  if (!series) return { ok: false, reason: `no instrument '${note.symbol}' grows from seed ${note.seed} — wrong universe` };
  const train = backtest(series, note.symbol, note.signal, note.params, [0, note.window.trainTo], note.feeBps, note.sizeFrac);
  const test = backtest(series, note.symbol, note.signal, note.params, [note.window.trainTo, note.window.ticks], note.feeBps, note.sizeFrac);
  const buyHold = series[note.window.ticks - 1] / series[note.window.trainTo] - 1;
  const close = (a, b) => Math.abs(a - b) < 1e-9;
  if (!close(train.totalReturn, note.claimed.trainReturn)) return { ok: false, reason: 'train return does not re-derive — the note flatters its training' };
  if (!close(test.totalReturn, note.claimed.testReturn)) return { ok: false, reason: 'test return does not re-derive — the note lies about its hold-out' };
  if (!close(test.maxDrawdown, note.claimed.testMaxDrawdown)) return { ok: false, reason: 'drawdown does not re-derive — the note hides its worst day' };
  if (test.trades !== note.claimed.testTrades) return { ok: false, reason: 'trade count does not re-derive' };
  if (!close(buyHold, note.claimed.buyHoldTest)) return { ok: false, reason: 'buy-and-hold benchmark does not re-derive' };
  return { ok: true, rederived: { testReturn: test.totalReturn, testMaxDrawdown: test.maxDrawdown, trades: test.trades } };
}

/** Where a foreign note and a local study read the same symbol differently —
 *  the pack disagreeing is information, never a problem to average away. */
export function packDisagreement(localStudies, note) {
  const mine = localStudies.find((s) => s.symbol === note.symbol);
  if (!mine || !note.signal) return null;
  if (mine.signal === note.signal) return null;
  return {
    symbol: note.symbol,
    mine: { signal: mine.signal, habit: mine.habit, testReturn: mine.test.return },
    theirs: { signal: note.signal, habit: note.habit, testReturn: note.claimed.testReturn, node: note.node },
  };
}

// ---------------------------------------------------------------------------
// THE DOSSIER — a research brief with receipts (the Dexter-shaped deliverable,
// built the Aukora way). Dexter (MIT) showed the right deliverable: a
// structured, self-checked brief per instrument. Ours is composed ENTIRELY
// from things this node can re-derive: tape facts from the seed, habits from
// the walk-forward study, costs from the friction model, voices from the
// verified pack, the owner's own read. Zero narrative guesses, zero model
// calls — when a research agent joins a later, governed round, THIS is the
// socket it plugs into, and its words will sit beside these numbers, never
// instead of them.
// ---------------------------------------------------------------------------

export function tapeFacts(seed, symbol, ticks = LAB_TAPE_TICKS) {
  const series = regenerateSeries(seed, ticks)[symbol];
  if (!series) return null;
  const first = series[0], last = series[series.length - 1];
  let peak = first, maxDD = 0, best = 0, worst = 0;
  for (let i = 1; i < series.length; i++) {
    const r = series[i] / series[i - 1] - 1;
    if (r > best) best = r;
    if (r < worst) worst = r;
    if (series[i] > peak) peak = series[i];
    const dd = (peak - series[i]) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  // realized volatility per tick (stdev of returns)
  let mean = 0;
  const rets = [];
  for (let i = 1; i < series.length; i++) { const r = series[i] / series[i - 1] - 1; rets.push(r); mean += r; }
  mean /= rets.length;
  let v = 0;
  for (const r of rets) v += (r - mean) ** 2;
  const vol = Math.sqrt(v / rets.length);
  return {
    ticks, drift: last / first - 1, maxDrawdown: maxDD,
    bestTick: best, worstTick: worst, volPerTick: vol,
  };
}

export function composeDossier(seed, study, opts = {}) {
  const facts = tapeFacts(seed, study.symbol, study.window.ticks);
  const pct = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`;
  const lines = [];
  lines.push(`THE WOLF · DOSSIER — ${study.symbol} (fictional instrument, paper world)`);
  lines.push(`seed ${seed} · tape ${study.window.ticks} ticks · composed ${new Date().toISOString()}`);
  lines.push('');
  lines.push('THE TAPE, AS RECEIPTED');
  lines.push(`  drifted ${pct(facts.drift)} over the window; worst peak-to-trough ${(facts.maxDrawdown * 100).toFixed(1)}%`);
  lines.push(`  per-tick volatility ${(facts.volPerTick * 100).toFixed(2)}%; best single tick ${pct(facts.bestTick)}, worst ${pct(facts.worstTick)}`);
  lines.push('');
  lines.push('THE HABIT THE DEN KEPT (walk-forward, friction-honest)');
  lines.push(`  ${study.habit}`);
  lines.push(`  trained on ticks 0–${study.window.trainTo}: ${pct(study.train.return)} · judged on the unseen ${study.window.ticks - study.window.trainTo}: ${pct(study.test.return)}`);
  lines.push(`  before costs ${pct(study.test.grossReturn)} — friction (${study.feeBps} bps/fill) ate ${((study.test.grossReturn - study.test.return) * 100).toFixed(2)}%`);
  lines.push(`  ${study.test.trades} trades · win rate ${(study.test.winRate * 100).toFixed(0)}% · worst drawdown ${(study.test.maxDrawdown * 100).toFixed(1)}% · vs buy-and-hold ${pct(study.buyHoldTest)}`);
  lines.push('');
  if (opts.humanNote) {
    lines.push('THE HUMAN READ');
    lines.push(`  "${String(opts.humanNote).slice(0, 500)}"`);
    lines.push('');
  }
  const voices = (opts.packNotes ?? []).filter((n) => n.symbol === study.symbol);
  if (voices.length) {
    lines.push('THE PACK\u2019S VOICES (each one re-derived on this node before belief)');
    for (const n of voices.slice(0, 4)) {
      lines.push(`  ${n.node}: "${n.habit}" — test ${pct(n.claimed.testReturn)}${n.humanNote ? ` · their read: "${n.humanNote}"` : ''}`);
    }
    lines.push('');
  }
  lines.push('WHAT THE RECEIPTS DO NOT SAY');
  lines.push('  whether any of this survives a different tape. This dossier states derived');
  lines.push('  facts only; it recommends nothing, predicts nothing, and places nothing.');
  lines.push(`  ${STUDY_DISCLAIMER}`);
  return { symbol: study.symbol, seed, text: lines.join('\n'), facts, at: new Date().toISOString() };
}
