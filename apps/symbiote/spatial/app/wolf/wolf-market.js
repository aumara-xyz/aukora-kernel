// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
//
// The Wolf — the SIM market. PAPER ONLY, forever (issue #270).
//
// A deterministic, seeded local market: five FICTIONAL Aukora-lore
// instruments walking a geometric random walk. Nothing here talks to any
// network; nothing here is a real asset; nothing here is advice. Every price
// carries provenance — source name, seed, tick, timestamp — because a price
// without provenance is a rumor, and this house doesn't trade on rumors,
// even fake ones.
//
// Pure module: no DOM, no fetch, no timers. The UI owns pacing; tests own
// determinism (same seed → same series, forever).

export const SIM_SOURCE = 'SIM · seeded local walk (fictional instruments)';

export const INSTRUMENTS = Object.freeze([
  Object.freeze({ symbol: 'RUT', name: 'Root Commons', hue: '129,212,180', start: 89.0, drift: 0.00005, vol: 0.011 }),
  Object.freeze({ symbol: 'LUM', name: 'Luminara Light', hue: '240,195,110', start: 34.5, drift: 0.00011, vol: 0.019 }),
  Object.freeze({ symbol: 'KNV', name: 'Knvs Surface', hue: '150,180,255', start: 12.2, drift: -0.00003, vol: 0.027 }),
  Object.freeze({ symbol: 'GRT', name: 'Graticube Grid', hue: '196,170,255', start: 156.4, drift: 0.00007, vol: 0.008 }),
  Object.freeze({ symbol: 'PLS', name: 'Pulse Signal', hue: '255,140,140', start: 4.87, drift: 0.00002, vol: 0.041 }),
]);

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box–Muller from two uniforms — a normal-ish step for the walk.
function gauss(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * createMarket({ seed }) → a deterministic market.
 *   tick(now?) advances every instrument one step and returns quotes.
 *   quotes()   returns current quotes without advancing.
 * A quote: { symbol, price, prev, tick, provenance } where provenance is
 * { source, seed, tick, at } — stamped on EVERY price, no exceptions.
 */
export function createMarket(opts = {}) {
  const seed = (opts.seed ?? 1) >>> 0;
  const instruments = opts.instruments ?? INSTRUMENTS;
  const rngs = instruments.map((ins, i) => mulberry32(seed + i * 7919 + 17));
  const prices = instruments.map((ins) => ins.start);
  const history = instruments.map((ins) => [ins.start]);
  let tickN = 0;

  const HISTORY_CAP = 720; // ~12 minutes at 1 tick/s — plenty for sparklines

  function provenance(at) {
    return { source: SIM_SOURCE, seed, tick: tickN, at };
  }

  function quoteOf(i, at) {
    return {
      symbol: instruments[i].symbol,
      name: instruments[i].name,
      hue: instruments[i].hue,
      price: prices[i],
      prev: history[i].length > 1 ? history[i][history[i].length - 2] : prices[i],
      history: history[i],
      provenance: provenance(at),
    };
  }

  return {
    seed,
    get tick() { return tickN; },
    instruments,
    step(now = new Date().toISOString()) {
      tickN++;
      for (let i = 0; i < instruments.length; i++) {
        const ins = instruments[i];
        // geometric step: price *= exp(drift + vol * N(0,1)) — never ≤ 0
        const stepv = Math.exp(ins.drift + ins.vol * gauss(rngs[i]));
        prices[i] = Math.max(0.01, prices[i] * stepv);
        history[i].push(prices[i]);
        if (history[i].length > HISTORY_CAP) history[i].shift();
      }
      return this.quotes(now);
    },
    quotes(now = new Date().toISOString()) {
      return instruments.map((_, i) => quoteOf(i, now));
    },
  };
}
