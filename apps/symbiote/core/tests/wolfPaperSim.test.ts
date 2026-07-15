// THE WOLF — paper-only market simulator (spatial/app/wolf/, issue #270).
// These pins hold the lane's fence in code: the market is deterministic and
// networkless, every price carries provenance, the ledger refuses debt and
// shorts, every fill's receipt repeats its price's provenance, and reset
// really resets. Fake money, real receipts.
import { describe, expect, it } from 'vitest';
import { createMarket, INSTRUMENTS, SIM_SOURCE } from '../../spatial/app/wolf/wolf-market.js';
import { createLedger, isValidLedger, STARTING_CASH } from '../../spatial/app/wolf/wolf-ledger.js';

describe('the SIM market — deterministic, provenanced, fictional', () => {
  it('same seed → the exact same series, forever', () => {
    const a = createMarket({ seed: 7 });
    const b = createMarket({ seed: 7 });
    for (let i = 0; i < 50; i++) { a.step('t'); b.step('t'); }
    expect(JSON.stringify(a.quotes('t').map((q: { price: number }) => q.price)))
      .toBe(JSON.stringify(b.quotes('t').map((q: { price: number }) => q.price)));
  });

  it('different seeds → different walks', () => {
    const a = createMarket({ seed: 1 });
    const b = createMarket({ seed: 2 });
    for (let i = 0; i < 20; i++) { a.step('t'); b.step('t'); }
    expect(JSON.stringify(a.quotes('t').map((q: { price: number }) => q.price)))
      .not.toBe(JSON.stringify(b.quotes('t').map((q: { price: number }) => q.price)));
  });

  it('every quote carries full provenance: source, seed, tick, timestamp', () => {
    const m = createMarket({ seed: 5 });
    m.step('2026-07-10T12:00:00Z');
    for (const q of m.quotes('2026-07-10T12:00:01Z')) {
      expect(q.provenance.source).toBe(SIM_SOURCE);
      expect(q.provenance.seed).toBe(5);
      expect(q.provenance.tick).toBe(1);
      expect(q.provenance.at).toBe('2026-07-10T12:00:01Z');
    }
  });

  it('prices stay positive through long walks', () => {
    const m = createMarket({ seed: 99 });
    for (let i = 0; i < 2000; i++) m.step('t');
    for (const q of m.quotes('t')) expect(q.price).toBeGreaterThan(0);
  });

  it('the instruments are fictional Aukora lore, not real tickers', () => {
    const symbols = INSTRUMENTS.map((i: { symbol: string }) => i.symbol);
    expect(symbols).toEqual(['RUT', 'LUM', 'KNV', 'GRT', 'PLS']);
  });
});

function quoteFor(price: number, tick = 1) {
  return { symbol: 'RUT', name: 'Root Commons', hue: '1,2,3', price, prev: price, history: [price], provenance: { source: SIM_SOURCE, seed: 7, tick, at: 't' } };
}

const NOFRICTION = { feeBps: 0, slipBps: 0 };

describe('the paper ledger — fake money, real receipts (frictionless mode for exact math)', () => {
  it('opens with the starting cash and a genesis entry', () => {
    const l = createLedger();
    expect(l.cash).toBe(STARTING_CASH);
    expect(l.timeline[0].kind).toBe('genesis');
    expect(l.state.paperOnly).toBe(true);
  });

  it('buys move cash into a position at average cost; every fill carries provenance', () => {
    const l = createLedger(undefined, NOFRICTION);
    expect(l.buy(quoteFor(100), 1000, 't').ok).toBe(true);
    expect(l.buy(quoteFor(200, 2), 1000, 't').ok).toBe(true);
    expect(l.cash).toBeCloseTo(STARTING_CASH - 2000, 6);
    const pos = l.positions.RUT;
    expect(pos.qty).toBeCloseTo(15, 6);                 // 10 + 5 units
    expect(pos.costBasis).toBeCloseTo(2000 / 15, 6);    // avg cost
    const fills = l.timeline.filter((t: { kind: string }) => t.kind === 'buy');
    expect(fills.length).toBe(2);
    for (const f of fills) { expect(f.provenance.source).toBe(SIM_SOURCE); expect(typeof f.provenance.tick).toBe('number'); }
  });

  it('never borrows: an over-cash buy is refused honestly', () => {
    const l = createLedger();
    const r = l.buy(quoteFor(10), STARTING_CASH + 1, 't');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('never borrows');
    expect(l.cash).toBe(STARTING_CASH);
  });

  it('never shorts: selling what is not held is refused honestly', () => {
    const l = createLedger();
    const r = l.sell(quoteFor(10), 1, 't');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('never shorts');
  });

  it('sells realize P&L against average cost and close cleanly at fraction 1', () => {
    const l = createLedger(undefined, NOFRICTION);
    l.buy(quoteFor(100), 1000, 't');          // 10 units @ 100
    const r = l.sell(quoteFor(150, 3), 1, 't');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.proceeds).toBeCloseTo(1500, 6);
    expect(r.realized).toBeCloseTo(500, 6);
    expect(l.realizedPnl).toBeCloseTo(500, 6);
    expect(l.positions.RUT).toBeUndefined();  // fully closed
    expect(l.cash).toBeCloseTo(STARTING_CASH + 500, 6);
  });

  it('equity and unrealized P&L mark to the given quotes', () => {
    const l = createLedger(undefined, NOFRICTION);
    l.buy(quoteFor(100), 1000, 't');
    expect(l.equity({ RUT: 120 })).toBeCloseTo(STARTING_CASH - 1000 + 10 * 120, 6);
    expect(l.unrealizedPnl({ RUT: 120 })).toBeCloseTo(200, 6);
  });

  it('reset burns it all down and says so on the timeline', () => {
    const l = createLedger();
    l.buy(quoteFor(100), 5000, 't');
    l.reset('t2');
    expect(l.cash).toBe(STARTING_CASH);
    expect(Object.keys(l.positions).length).toBe(0);
    expect(l.realizedPnl).toBe(0);
    expect(l.timeline[0].kind).toBe('reset');
  });

  it('round-trips through JSON (localStorage shape) and rejects garbage', () => {
    const l = createLedger(undefined, NOFRICTION);
    l.buy(quoteFor(100), 1000, 't');
    const revived = createLedger(JSON.parse(JSON.stringify(l.toJSON())));
    expect(revived.cash).toBeCloseTo(l.cash, 9);
    expect(revived.positions.RUT.qty).toBeCloseTo(10, 6);
    expect(isValidLedger({ schema: 'wolf-paper-ledger-v1', paperOnly: false })).toBe(false); // paper flag is load-bearing
    expect(isValidLedger(null)).toBe(false);
    const fresh = createLedger({ nonsense: true });
    expect(fresh.cash).toBe(STARTING_CASH); // garbage in → honest fresh wallet
  });
});

describe('friction — the sim that refuses to flatter you', () => {
  it('a buy pays its fee and slips against you; the receipt says so', () => {
    const l = createLedger(undefined, { feeBps: 100, slipBps: 100 }); // loud numbers: 1% + 1%
    const r = l.buy(quoteFor(100), 1000, 't');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fee).toBeCloseTo(10, 6);                    // 1% of $1000
    expect(r.execPx).toBeCloseTo(101, 6);                // 1% worse than screen
    expect(l.positions.RUT.qty).toBeCloseTo(990 / 101, 6);
    expect(l.positions.RUT.costBasis).toBeCloseTo(1000 / (990 / 101), 6); // fees live in the basis
    const fill = l.timeline.find((t: { kind: string }) => t.kind === 'buy');
    expect(fill.fee).toBeCloseTo(10, 6);
  });

  it('a round trip at flat price LOSES money — friction is real', () => {
    const l = createLedger(undefined, { feeBps: 50, slipBps: 25 });
    l.buy(quoteFor(100), 1000, 't');
    const r = l.sell(quoteFor(100, 2), 1, 't');
    expect(r.ok).toBe(true);
    expect(l.cash).toBeLessThan(STARTING_CASH);          // the truth costs ~1.5%
    expect(l.realizedPnl).toBeLessThan(0);
  });

  it('a frictioned book still audits clean — receipts carry the fees', () => {
    const l = createLedger(); // DEFAULT friction on
    l.buy(quoteFor(100), 1000, 't');
    l.buy(quoteFor(110, 2), 500, 't');
    l.sell(quoteFor(120, 3), 0.7, 't');
    const a = l.audit();
    expect(a.ok).toBe(true);
  });
});

describe('the audit — the receipts ARE the book', () => {
  it('a busy book reconciles from receipts alone', () => {
    const l = createLedger();
    l.buy(quoteFor(100), 1000, 't1');
    l.buy(quoteFor(120, 2), 500, 't2');
    l.sell(quoteFor(150, 3), 0.5, 't3');
    l.buy(quoteFor(90, 4), 250, 't4');
    l.sell(quoteFor(200, 5), 1, 't5');
    const a = l.audit();
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.checked).toBe(5);
  });

  it('a tampered book FAILS its audit — the receipts win', () => {
    const l = createLedger();
    l.buy(quoteFor(100), 1000, 't1');
    (l.state as { cash: number }).cash += 500; // cook the book
    const a = l.audit();
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.reason).toContain('cash does not reconcile');
  });

  it('a reset book audits clean from the reset receipt onward', () => {
    const l = createLedger();
    l.buy(quoteFor(100), 4000, 't1');
    l.reset('t2');
    l.buy(quoteFor(50), 300, 't3');
    const a = l.audit();
    expect(a.ok).toBe(true);
  });

  it('trimmed receipts refuse the audit honestly instead of pretending', () => {
    const l = createLedger();
    for (let i = 0; i < 520; i++) {  // 1040 fills — beyond the keep-window
      l.buy(quoteFor(10, i), 10, 't');
      l.sell(quoteFor(10, i), 1, 't');
    }
    const a = l.audit();
    expect(a.ok).toBe(false);
    if (!a.ok) expect((a as { unavailable?: boolean }).unavailable).toBe(true);
  });
});

describe('the fence, in code', () => {
  it('neither wolf module imports anything that can reach a network or sign', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const repoRoot = path.resolve(__dirname, '..', '..');
    for (const f of ['spatial/app/wolf/wolf-market.js', 'spatial/app/wolf/wolf-ledger.js']) {
      const src = fs.readFileSync(path.join(repoRoot, f), 'utf-8');
      expect(src.includes('fetch(')).toBe(false);
      expect(src.includes("from '")).toBe(false); // zero imports at all — pure arithmetic
      expect(/websocket|XMLHttpRequest|child_process/i.test(src)).toBe(false);
    }
  });
});
