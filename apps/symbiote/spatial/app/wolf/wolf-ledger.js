// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
//
// The Wolf — the paper ledger. PAPER ONLY, forever (issue #270).
//
// Simulated cash in, simulated positions out. Long-only, no fees, no
// leverage, no shorting — the simplest honest book. Every fill and every
// timeline entry carries the price's provenance verbatim, because even fake
// money deserves real receipts. Nothing here can reach a broker, a wallet,
// or a network: it is arithmetic over a plain object, serializable to the
// node's own localStorage and nowhere else.
//
// Pure module: no DOM, no fetch, no timers, no globals.

export const STARTING_CASH = 10_000;
export const LEDGER_SCHEMA = 'wolf-paper-ledger-v1';
const TIMELINE_CAP = 1000; // receipts ARE the book — keep enough to audit

// Friction, on by default. Every real fill costs something; a simulator that
// pretends otherwise is training you to lose. Fees in basis points of the
// traded dollars; slippage in basis points of price, always against you.
export const DEFAULT_FEE_BPS = 10;   // 0.10% per fill
export const DEFAULT_SLIP_BPS = 5;   // 0.05% worse than the screen price

export function createLedger(data, opts = {}) {
  const feeBps = Number.isFinite(opts.feeBps) ? opts.feeBps : DEFAULT_FEE_BPS;
  const slipBps = Number.isFinite(opts.slipBps) ? opts.slipBps : DEFAULT_SLIP_BPS;
  const state = isValidLedger(data) ? structuredClone(data) : freshState();

  function freshState(now = new Date().toISOString()) {
    return {
      schema: LEDGER_SCHEMA,
      paperOnly: true,
      cash: STARTING_CASH,
      positions: {},        // symbol → { qty, costBasis }  (avg-cost book)
      realizedPnl: 0,
      timeline: [{ kind: 'genesis', note: `paper wallet opened with $${STARTING_CASH.toLocaleString()} of simulated money`, at: now }],
      openedAt: now,
    };
  }

  function push(entry) {
    state.timeline.unshift(entry);
    if (state.timeline.length > TIMELINE_CAP) {
      state.timeline.pop();
      state.trimmed = true; // an honest audit needs the WHOLE stream — remember the loss
    }
  }

  return {
    get state() { return state; },
    get cash() { return state.cash; },
    get realizedPnl() { return state.realizedPnl; },
    get positions() { return state.positions; },
    get timeline() { return state.timeline; },

    /** Market value of everything at the given quotes (symbol → price). */
    equity(priceBySymbol) {
      let held = 0;
      for (const [sym, p] of Object.entries(state.positions)) {
        const px = priceBySymbol[sym];
        if (typeof px === 'number') held += p.qty * px;
      }
      return state.cash + held;
    },

    unrealizedPnl(priceBySymbol) {
      let u = 0;
      for (const [sym, p] of Object.entries(state.positions)) {
        const px = priceBySymbol[sym];
        if (typeof px === 'number') u += p.qty * (px - p.costBasis);
      }
      return u;
    },

    /** Buy with simulated dollars at the quoted price — MINUS honest friction:
     *  a fee comes off the top and the fill lands slipBps worse than the
     *  screen. Cost basis includes every cent paid, fees and all. */
    buy(quote, dollars, now = new Date().toISOString()) {
      const amt = Number(dollars);
      if (!Number.isFinite(amt) || amt <= 0) return { ok: false, reason: 'enter a positive amount of paper dollars' };
      if (amt > state.cash + 1e-9) return { ok: false, reason: `only $${state.cash.toFixed(2)} of paper cash left — this wallet never borrows` };
      const execPx = quote.price * (1 + slipBps / 10000);
      const fee = amt * (feeBps / 10000);
      const qty = (amt - fee) / execPx;
      const pos = state.positions[quote.symbol] ?? { qty: 0, costBasis: 0 };
      const newQty = pos.qty + qty;
      pos.costBasis = (pos.costBasis * pos.qty + amt) / newQty; // dollars-true: fees live in the basis
      pos.qty = newQty;
      state.positions[quote.symbol] = pos;
      state.cash -= amt;
      push({ kind: 'buy', symbol: quote.symbol, qty, price: execPx, dollars: amt, fee, at: now, provenance: quote.provenance });
      return { ok: true, qty, fee, execPx };
    },

    /** Sell a fraction (0..1] of the held position at the quoted price. */
    sell(quote, fraction, now = new Date().toISOString()) {
      const pos = state.positions[quote.symbol];
      if (!pos || pos.qty <= 0) return { ok: false, reason: `no ${quote.symbol} held — this book never shorts` };
      const f = Number(fraction);
      if (!Number.isFinite(f) || f <= 0 || f > 1) return { ok: false, reason: 'sell fraction must be within (0, 1]' };
      const qty = pos.qty * f;
      const execPx = quote.price * (1 - slipBps / 10000);
      const gross = qty * execPx;
      const fee = gross * (feeBps / 10000);
      const proceeds = gross - fee;
      const realized = proceeds - qty * pos.costBasis; // net of every cost, both ways
      pos.qty -= qty;
      state.cash += proceeds;
      state.realizedPnl += realized;
      if (pos.qty <= 1e-12) delete state.positions[quote.symbol];
      push({ kind: 'sell', symbol: quote.symbol, qty, price: execPx, dollars: proceeds, fee, realized, at: now, provenance: quote.provenance });
      return { ok: true, qty, proceeds, realized, fee, execPx };
    },

    /**
     * Audit the book: re-derive cash, positions and realized P&L from the
     * receipt stream alone and compare against the live state. This is the
     * institutional trick, native: the receipts ARE the book, and anyone can
     * replay them. Returns an honest tri-state — reconciles, does not
     * reconcile, or cannot be audited because receipts were trimmed.
     */
    audit() {
      if (state.trimmed) {
        return { ok: false, unavailable: true, reason: 'receipts were trimmed beyond the keep-window — full reconstruction unavailable (reset for a fresh auditable book)' };
      }
      const replay = { cash: 0, positions: {}, realized: 0 };
      let sawGenesis = false;
      const chron = [...state.timeline].reverse();
      for (const t of chron) {
        if (t.kind === 'genesis' || t.kind === 'reset') {
          replay.cash = STARTING_CASH; replay.positions = {}; replay.realized = 0; sawGenesis = true;
          continue;
        }
        if (t.kind === 'buy') {
          replay.cash -= t.dollars;
          const pos = replay.positions[t.symbol] ?? { qty: 0, costBasis: 0 };
          const newQty = pos.qty + t.qty;
          pos.costBasis = (pos.costBasis * pos.qty + t.dollars) / newQty; // dollars-true, fee-aware
          pos.qty = newQty;
          replay.positions[t.symbol] = pos;
        } else if (t.kind === 'sell') {
          replay.cash += t.dollars;
          replay.realized += t.realized;
          const pos = replay.positions[t.symbol];
          if (!pos) return { ok: false, reason: `receipt stream sells ${t.symbol} that the replayed book never bought — the stream is incomplete or reordered` };
          pos.qty -= t.qty;
          if (pos.qty <= 1e-9) delete replay.positions[t.symbol];
        }
      }
      if (!sawGenesis) return { ok: false, reason: 'no genesis receipt — the stream does not begin at the beginning' };
      const close = (a, b) => Math.abs(a - b) < 1e-6;
      if (!close(replay.cash, state.cash)) return { ok: false, reason: `cash does not reconcile: receipts say ${replay.cash.toFixed(2)}, the book says ${state.cash.toFixed(2)}` };
      if (!close(replay.realized, state.realizedPnl)) return { ok: false, reason: `realized P&L does not reconcile: receipts say ${replay.realized.toFixed(2)}, the book says ${state.realizedPnl.toFixed(2)}` };
      const symbols = new Set([...Object.keys(replay.positions), ...Object.keys(state.positions)]);
      for (const sym of symbols) {
        const r = replay.positions[sym], l = state.positions[sym];
        if (!r || !l) return { ok: false, reason: `position ${sym} exists on one side only — receipts and book disagree` };
        if (!close(r.qty, l.qty) || !close(r.costBasis, l.costBasis)) {
          return { ok: false, reason: `position ${sym} does not reconcile (qty/cost differ between receipts and book)` };
        }
      }
      const checked = chron.filter((t) => t.kind === 'buy' || t.kind === 'sell').length;
      return { ok: true, checked };
    },

    /** Burn it down and start again — the whole point of paper. */
    reset(now = new Date().toISOString()) {
      const before = state.timeline.length;
      const fresh = freshState(now);
      for (const k of Object.keys(state)) delete state[k];
      Object.assign(state, fresh);
      push({ kind: 'reset', note: `wallet reset — ${before} old entries let go`, at: now });
      return { ok: true };
    },

    toJSON() { return structuredClone(state); },
  };
}

export function isValidLedger(d) {
  return !!d && typeof d === 'object' && d.schema === LEDGER_SCHEMA && d.paperOnly === true
    && typeof d.cash === 'number' && Number.isFinite(d.cash)
    && typeof d.realizedPnl === 'number'
    && !!d.positions && typeof d.positions === 'object'
    && Array.isArray(d.timeline);
}
