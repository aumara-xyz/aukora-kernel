// THE LIVE TAPE — the Wolf's only networked module (spatial/app/wolf/
// wolf-live.js). Pins: the network fence holds (fetch exists in NO wolf
// module but wolf-live.js, and the pure engines gained no new imports),
// fetchers parse the real response shapes and fail closed on anything else,
// the second witness reports divergence honestly (never averages), polling
// has a hard gentleness floor, and a live quote settles through the SAME
// receipted paper ledger with its real source named on the fill.
// Every test injects its fetch — ZERO network in CI.
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  fetchKrakenTicker, fetchKrakenHistory, fetchCoinbaseSpot, secondWitness, makeLiveQuote,
  LIVE_PRODUCT, LIVE_SOURCES, MIN_POLL_MS, WITNESS_AGREE_PCT,
} from '../../spatial/app/wolf/wolf-live.js';
import { createLedger } from '../../spatial/app/wolf/wolf-ledger.js';

const ROOT = path.resolve(__dirname, '..', '..');
const WOLF_DIR = path.join(ROOT, 'spatial', 'app', 'wolf');

const fakeFetch = (payload: unknown) => (async () => ({ json: async () => payload })) as unknown as typeof fetch;
const throwingFetch = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;

describe('the network fence — one door, and only one', () => {
  it('fetch appears in wolf-live.js and NO other wolf module', () => {
    const files = fs.readdirSync(WOLF_DIR).filter((f) => f.endsWith('.js'));
    expect(files.length).toBeGreaterThanOrEqual(7);
    for (const f of files) {
      const src = fs.readFileSync(path.join(WOLF_DIR, f), 'utf8');
      const usesFetch = /\bfetch(Impl)?\s*\(/.test(src) && /globalThis\.fetch|fetchImpl/.test(src);
      if (f === 'wolf-live.js') expect(usesFetch).toBe(true);
      else expect(/globalThis\.fetch|\bwindow\.fetch|[^a-zA-Z]fetch\s*\(\s*['"`]http/.test(src)).toBe(false);
    }
  });

  it('the pure engines did not gain a network import', () => {
    for (const f of ['wolf-market.js', 'wolf-ledger.js', 'wolf-lab.js', 'wolf-mind-env.js']) {
      const src = fs.readFileSync(path.join(WOLF_DIR, f), 'utf8');
      expect(src.includes('wolf-live')).toBe(false);
    }
  });

  it('polling gentleness is a constant, floored at 5 seconds', () => {
    expect(MIN_POLL_MS).toBeGreaterThanOrEqual(5000);
  });
});

describe('fetchers — parse the real shapes, fail closed on everything else', () => {
  it('kraken ticker: happy path carries price + named, timestamped provenance', async () => {
    const r = await fetchKrakenTicker(fakeFetch({ error: [], result: { XXBTZUSD: { c: ['67123.40', '0.01'] } } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.price).toBe(67123.4);
    expect(r.provenance.source).toBe(LIVE_SOURCES.kraken.name);
    expect(r.provenance.source).toContain('read-only');
    expect(r.provenance.product).toBe(LIVE_PRODUCT);
    expect(new Date(r.provenance.fetchedAt).getTime()).toBeGreaterThan(0);
  });

  it('kraken error array, garbage payloads, and thrown fetches all fail closed', async () => {
    expect((await fetchKrakenTicker(fakeFetch({ error: ['EGeneral:Invalid arguments'] }))).ok).toBe(false);
    expect((await fetchKrakenTicker(fakeFetch({ result: { XXBTZUSD: { c: ['-1', ''] } } }))).ok).toBe(false);
    expect((await fetchKrakenTicker(fakeFetch(null))).ok).toBe(false);
    expect((await fetchKrakenTicker(throwingFetch)).ok).toBe(false);
  });

  it('kraken OHLC: closes extracted, non-numeric rows dropped, capped', async () => {
    const rows = Array.from({ length: 800 }, (_, i) => [1720000000 + i * 60, '1', '2', '0.5', String(100 + i), '1', '1', 3]);
    rows.push([0, '1', '2', '0.5', 'not-a-number', '1', '1', 0]);
    const r = await fetchKrakenHistory(fakeFetch({ error: [], result: { XXBTZUSD: rows, last: 1 } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.closes.length).toBeLessThanOrEqual(720);
    expect(r.closes.every((v: number) => Number.isFinite(v) && v > 0)).toBe(true);
    expect(r.provenance.granularity).toBe('1m');
  });

  it('coinbase spot: happy path + fail-closed', async () => {
    const r = await fetchCoinbaseSpot(fakeFetch({ data: { amount: '67100.11', base: 'BTC', currency: 'USD' } }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.price).toBe(67100.11);
    expect((await fetchCoinbaseSpot(fakeFetch({ data: { amount: 'zero' } }))).ok).toBe(false);
    expect((await fetchCoinbaseSpot(throwingFetch)).ok).toBe(false);
  });
});

describe('the second witness — divergence shown, never averaged', () => {
  it('agreement within the threshold, disagreement beyond it', () => {
    const close = secondWitness(67000, 67000 * (1 + (WITNESS_AGREE_PCT - 0.1) / 100));
    expect(close.ok).toBe(true);
    if (close.ok) { expect(close.agree).toBe(true); expect(close.line).toContain('agree'); }
    const far = secondWitness(67000, 67000 * 1.02);
    expect(far.ok).toBe(true);
    if (far.ok) {
      expect(far.agree).toBe(false);
      expect(far.line).toContain('DISAGREE');
      expect(far.divergencePct).toBeCloseTo(2, 5);
    }
  });

  it('never invents a blended price — the result carries no price field', () => {
    const w = secondWitness(100, 101);
    expect('price' in w).toBe(false);
    expect('average' in w).toBe(false);
  });

  it('fails closed on unusable inputs', () => {
    expect(secondWitness(0, 100).ok).toBe(false);
    expect(secondWitness(100, NaN).ok).toBe(false);
  });
});

describe('live quotes settle in the same receipted paper ledger', () => {
  it('a live fill carries the real source on its receipt, and the book audits clean', () => {
    const ledger = createLedger();
    const prov = { source: LIVE_SOURCES.kraken.name, product: LIVE_PRODUCT, fetchedAt: '2026-07-10T20:00:00.000Z' };
    const q = makeLiveQuote(67000, 66900, [66900, 67000], prov);
    expect(q.symbol).toBe(LIVE_PRODUCT);
    const b = ledger.buy(q, 1000);
    expect(b.ok).toBe(true);
    const receipt = ledger.timeline.find((t: { kind: string }) => t.kind === 'buy');
    expect(receipt.provenance.source).toContain('Kraken');
    expect(receipt.provenance.source).toContain('read-only');
    expect(receipt.provenance.tick).toBeUndefined(); // live, not SIM — and the UI renders it as LIVE
    const s = ledger.sell(makeLiveQuote(67500, 67000, [67000, 67500], prov), 1);
    expect(s.ok).toBe(true);
    const audit = ledger.audit();
    expect(audit.ok).toBe(true);
  });

  it('history is capped and a missing prev falls back to price', () => {
    const q = makeLiveQuote(100, NaN, Array.from({ length: 1000 }, (_, i) => i + 1), { source: 's', product: 'p', fetchedAt: 'now' });
    expect(q.history.length).toBe(720);
    expect(q.prev).toBe(100);
  });
});
