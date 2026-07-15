// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
//
// wolf-live.js — THE LIVE TAPE. The Wolf's ONLY networked module, by law:
// the pure engines (market, ledger, lab, mind-env) stay fenced at zero
// imports and zero network, and a test pins that `fetch` appears in no wolf
// module but this one.
//
// What this is: real public prices, READ-ONLY, from two independent keyless
// sources — Kraken's public market data as the tape, Coinbase's public spot
// price as a second witness. Named, timestamped (their clock and ours),
// optional (off by default in the UI), and gentle (a hard polling floor).
//
// What this is NOT, forever (the fence): no orders, no brokerage, no keys,
// no secrets, no writes of any kind to any exchange. These endpoints cannot
// mutate anything — they are the same URLs a logged-out browser can read.
// Paper trades against live prices settle in the same receipted paper
// ledger as everything else; the provenance on each fill names the source.
//
// Every fetcher takes an injectable fetchImpl so tests run with ZERO network.

export const LIVE_PRODUCT = 'BTC-USD';
export const LIVE_PRODUCT_NAME = 'Bitcoin · real public price';
export const MIN_POLL_MS = 5000;        // gentleness floor — never poll faster
export const WITNESS_AGREE_PCT = 0.5;   // witnesses within this = agreement

export const LIVE_SOURCES = Object.freeze({
  kraken: Object.freeze({ name: 'Kraken public market data (keyless, read-only)', url: 'https://api.kraken.com/0/public' }),
  coinbase: Object.freeze({ name: 'Coinbase public spot price (keyless, read-only)', url: 'https://api.coinbase.com/v2' }),
});

const HISTORY_CAP = 720;

async function getJson(url, fetchImpl) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), 8000) : null;
  try {
    const res = await fetchImpl(url, ctl ? { signal: ctl.signal } : undefined);
    const j = await res.json();
    return { ok: true, j };
  } catch (e) {
    return { ok: false, reason: `fetch failed: ${String(e && e.message || e).slice(0, 120)}` };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Kraken public ticker for XBT/USD. Read-only; a logged-out URL. */
export async function fetchKrakenTicker(fetchImpl = globalThis.fetch) {
  const r = await getJson(`${LIVE_SOURCES.kraken.url}/Ticker?pair=XBTUSD`, fetchImpl);
  if (!r.ok) return r;
  const j = r.j;
  if (Array.isArray(j?.error) && j.error.length) return { ok: false, reason: `kraken error: ${String(j.error[0]).slice(0, 80)}` };
  const key = Object.keys(j?.result ?? {}).find((k) => k !== 'last');
  const price = Number(j?.result?.[key]?.c?.[0]);
  if (!Number.isFinite(price) || price <= 0) return { ok: false, reason: 'kraken ticker: no readable price' };
  return {
    ok: true,
    price,
    provenance: { source: LIVE_SOURCES.kraken.name, product: LIVE_PRODUCT, fetchedAt: new Date().toISOString() },
  };
}

/** Kraken public OHLC (1-minute candles) — history for the sparkline and
 *  for honest "where has it been" context. Closes only, capped. */
export async function fetchKrakenHistory(fetchImpl = globalThis.fetch) {
  const r = await getJson(`${LIVE_SOURCES.kraken.url}/OHLC?pair=XBTUSD&interval=1`, fetchImpl);
  if (!r.ok) return r;
  const j = r.j;
  if (Array.isArray(j?.error) && j.error.length) return { ok: false, reason: `kraken error: ${String(j.error[0]).slice(0, 80)}` };
  const key = Object.keys(j?.result ?? {}).find((k) => k !== 'last');
  const rows = j?.result?.[key];
  if (!Array.isArray(rows) || !rows.length) return { ok: false, reason: 'kraken OHLC: no candles' };
  const closes = rows.map((row) => Number(row?.[4])).filter((v) => Number.isFinite(v) && v > 0).slice(-HISTORY_CAP);
  if (!closes.length) return { ok: false, reason: 'kraken OHLC: no readable closes' };
  return {
    ok: true,
    closes,
    provenance: { source: LIVE_SOURCES.kraken.name, product: LIVE_PRODUCT, granularity: '1m', fetchedAt: new Date().toISOString() },
  };
}

/** Coinbase public spot — the second witness. Never the tape, only a check. */
export async function fetchCoinbaseSpot(fetchImpl = globalThis.fetch) {
  const r = await getJson(`${LIVE_SOURCES.coinbase.url}/prices/${LIVE_PRODUCT}/spot`, fetchImpl);
  if (!r.ok) return r;
  const price = Number(r.j?.data?.amount);
  if (!Number.isFinite(price) || price <= 0) return { ok: false, reason: 'coinbase spot: no readable price' };
  return {
    ok: true,
    price,
    provenance: { source: LIVE_SOURCES.coinbase.name, product: LIVE_PRODUCT, fetchedAt: new Date().toISOString() },
  };
}

/** Two independent sources, one verdict. Divergence is INFORMATION — it is
 *  shown, never averaged away, and beyond the threshold it is a warning. */
export function secondWitness(tapePrice, witnessPrice) {
  if (!Number.isFinite(tapePrice) || !Number.isFinite(witnessPrice) || tapePrice <= 0 || witnessPrice <= 0) {
    return { ok: false, reason: 'need two positive prices' };
  }
  const divergencePct = Math.abs(tapePrice - witnessPrice) / tapePrice * 100;
  const agree = divergencePct <= WITNESS_AGREE_PCT;
  return {
    ok: true,
    divergencePct,
    agree,
    line: agree
      ? `witnesses agree — Coinbase within ${divergencePct.toFixed(3)}% of Kraken`
      : `WITNESSES DISAGREE by ${divergencePct.toFixed(2)}% — treat this price as uncertain until they converge`,
  };
}

/** A ledger-compatible quote from live data: same shape the SIM market
 *  produces, so the SAME receipted paper ledger settles both worlds. The
 *  provenance names the real source instead of a seed. */
export function makeLiveQuote(price, prev, history, provenance) {
  return {
    symbol: LIVE_PRODUCT,
    name: LIVE_PRODUCT_NAME,
    hue: '247,147,26',
    price,
    prev: Number.isFinite(prev) && prev > 0 ? prev : price,
    history: Array.isArray(history) ? history.slice(-HISTORY_CAP) : [price],
    provenance,
  };
}
