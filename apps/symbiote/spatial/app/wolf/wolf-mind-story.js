// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
//
// wolf-mind-story.js — turn a mind run's JSONL receipts into a readable
// session story. Pure (no fs / fetch / DOM): the driver writes receipts to
// disk, a human carries them here (paste — the same consent-by-copy transport
// as pack notes), and this module re-reads them into narrative beats.
//
// HONESTY CONTRACT:
// - Receipts must declare themselves PAPER + BACKTEST in their mode label or
//   they are REFUSED — this renderer will not tell a live-trading story.
// - The story separates two voices and says so: harness numbers (fills,
//   equity, guard checks — exact accounting) vs the mind's own words
//   (hypothesis, reason, prediction — what it THOUGHT, not what was true).
// - A run without its summary line did not finish; refused, not prettified.

export const STORY_SCHEMA = 'wolf-mind-story-v1';
const MAX_LINES = 20000;
const MAX_LINE_CHARS = 40000;
const TEXT = (v, cap = 2000) => (typeof v === 'string' ? v.slice(0, cap) : '');

export function parseMindReceipts(text) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, reason: 'nothing to read — paste the whole run.jsonl' };
  const rawLines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (rawLines.length > MAX_LINES) return { ok: false, reason: `too many lines (${rawLines.length} > ${MAX_LINES})` };

  const lines = [];
  for (const l of rawLines) {
    if (l.length > MAX_LINE_CHARS) return { ok: false, reason: 'a receipt line is implausibly long — refused' };
    try { lines.push(JSON.parse(l)); } catch { return { ok: false, reason: 'not JSONL — every line must be one JSON object (paste run.jsonl verbatim)' }; }
  }

  const start = lines.find((l) => l.kind === 'start');
  if (!start) return { ok: false, reason: 'no start line — these are not mind-run receipts' };
  const mode = TEXT(start.mode, 200);
  if (!/PAPER MONEY/.test(mode) || !/BACKTEST/.test(mode)) {
    return { ok: false, reason: 'REFUSED: receipts do not declare PAPER + BACKTEST in their mode label — this panel only tells paper stories' };
  }
  const summary = lines.find((l) => l.kind === 'summary');
  if (!summary) return { ok: false, reason: 'no summary line — the run did not finish; only finished sessions become stories' };

  const moves = lines.filter((l) => l.kind === 'move');
  if (!moves.length) return { ok: false, reason: 'no moves in these receipts' };

  // Narrative beats, in receipt order: model turns as-is; consecutive
  // plan_moves folded into one "ride"; resets and stop-outs as markers.
  const beats = [];
  const equitySeries = [];
  let ride = null;
  const closeRide = () => { if (ride) { beats.push(ride); ride = null; } };
  for (const l of lines) {
    if (l.kind === 'move') {
      closeRide();
      equitySeries.push({ tick: Number(l.tick) || 0, equity: Number(l.equity) || 0 });
      beats.push({
        kind: 'turn', move: Number(l.move) || 0, tick: Number(l.tick) || 0,
        action: TEXT(l.action, 20), close: Number(l.close) || 0,
        equity: Number(l.equity) || 0, pnlPct: Number(l.pnlPct) || 0,
        fill: l.fill && typeof l.fill === 'object' ? {
          kind: TEXT(l.fill.kind, 8), qty: Number(l.fill.qty) || 0, fee: Number(l.fill.fee) || 0,
          execPx: Number(l.fill.execPx) || 0,
          realized: l.fill.realized == null ? null : Number(l.fill.realized),
        } : null,
        whatISee: TEXT(l.whatISee), delta: TEXT(l.delta), hypothesis: TEXT(l.hypothesis),
        reason: TEXT(l.reason), prediction: TEXT(l.prediction), memo: TEXT(l.memo, 700),
        planned: Array.isArray(l.plan) ? l.plan.length : 0,
      });
    } else if (l.kind === 'plan_move') {
      equitySeries.push({ tick: Number(l.tick) || 0, equity: Number(l.equity) || 0 });
      if (!ride) ride = { kind: 'ride', steps: 0, fromTick: Number(l.tick) || 0, toTick: 0, expects: [], broken: null, equityTo: 0 };
      ride.steps++;
      ride.toTick = Number(l.tick) || 0;
      ride.equityTo = Number(l.equity) || 0;
      const ex = TEXT(l.expect, 40);
      if (!ride.expects.includes(ex)) ride.expects.push(ex);
      if (l.ok === false) ride.broken = { expect: ex, note: TEXT(l.note, 120), close: Number(l.close) || 0 };
    } else if (l.kind === 'reset') {
      closeRide();
      beats.push({ kind: 'reset', resets: Number(l.resets) || 0 });
    } else if (l.kind === 'stopped_out') {
      closeRide();
      beats.push({ kind: 'stopped_out' });
    }
    // unknown kinds: skipped on purpose (forward compatibility)
  }
  closeRide();

  return {
    ok: true,
    story: {
      schema: STORY_SCHEMA,
      runId: TEXT(summary.runId, 80),
      mode,
      mind: TEXT(start.mind, 160),
      symbol: TEXT(summary.symbol, 12),
      seed: Number(summary.seed) || 0,
      state: TEXT(summary.state, 20),
      sessionTicks: Number(summary.sessionTicks) || 0,
      moves: Number(summary.moves) || 0,
      planMoves: Number(summary.planMoves) || 0,
      modelTurns: moves.length,
      resets: Number(summary.resets) || 0,
      finalEquity: Number(summary.finalEquity) || 0,
      pnlPct: Number(summary.pnlPct) || 0,
      maxDrawdownPct: Number(summary.maxDrawdownPct) || 0,
      trades: Number(summary.trades) || 0,
      feesPaid: Number(summary.feesPaid) || 0,
      buyHoldPct: Number(summary.buyHoldPct) || 0,
      promptTokens: Number(summary.promptTokens) || 0,
      completionTokens: Number(summary.completionTokens) || 0,
      equitySeries,
      beats,
    },
  };
}

// One-line verdict for the header — always names the benchmark, never brags.
export function storyVerdict(story) {
  const pnl = `${story.pnlPct >= 0 ? '+' : ''}${story.pnlPct.toFixed(2)}%`;
  const bh = `${story.buyHoldPct >= 0 ? '+' : ''}${story.buyHoldPct.toFixed(2)}%`;
  const vs = story.pnlPct >= story.buyHoldPct ? 'ahead of' : 'behind';
  return `${story.state} · mind ${pnl} — ${vs} buy-and-hold (${bh}) on the same tape · max drawdown ${story.maxDrawdownPct.toFixed(2)}% · ${story.trades} trades, fees $${story.feesPaid.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// The learning curve — an episodic memory file (wolf/memory/<SYM>.json)
// retold as session-over-session results. The one honesty distinction that
// matters here is made LOUD: a repeat of the SAME seed is the same tape, so
// improvement on it is MEMORIZATION; only a fresh seed tests whether a
// lesson GENERALIZES. The two must never be presented as the same claim.
// ---------------------------------------------------------------------------
export function parseEpisodicMemory(text) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, reason: 'nothing to read' };
  let obj;
  try { obj = JSON.parse(text); } catch { return { ok: false, reason: 'not an episodic memory file — paste the whole wolf/memory/<SYMBOL>.json' }; }
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.entries)) return { ok: false, reason: 'no entries — this is not an episodic memory file' };
  if (obj.entries.length > 64) return { ok: false, reason: 'implausibly many entries — refused' };
  const sessions = [];
  const seenSeeds = new Set();
  for (const e of obj.entries) {
    if (!e || typeof e !== 'object') continue;
    const mode = TEXT(e.mode, 200);
    if (!/PAPER MONEY/.test(mode) || !/BACKTEST/.test(mode)) {
      return { ok: false, reason: 'REFUSED: an entry does not declare PAPER + BACKTEST — this panel only tells paper stories' };
    }
    const seed = Number(e.seed) || 0;
    sessions.push({
      at: TEXT(e.at, 30),
      runId: TEXT(e.runId, 80),
      seed,
      ticks: Number(e.ticks) || 0,
      state: TEXT(e.state, 20),
      pnlPct: Number(e.pnlPct) || 0,
      maxDrawdownPct: Number(e.maxDrawdownPct) || 0,
      trades: Number(e.trades) || 0,
      memo: TEXT(e.memo, 700),
      // truth flag: a seed seen before means the mind replayed a tape it had
      // already lived — gains there are memorization, not generalization
      sameTape: seenSeeds.has(seed),
    });
    seenSeeds.add(seed);
  }
  if (!sessions.length) return { ok: false, reason: 'no readable sessions in this file' };
  return { ok: true, curve: { symbol: TEXT(obj.symbol, 12), sessions } };
}
