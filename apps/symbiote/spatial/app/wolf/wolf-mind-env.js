// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
//
// wolf-mind-env.js — the Wolf's implementation of the reasoning-engine port
// surface (docs/arc3/REASONING_ENGINE_EXPORT.md). The five ports, for markets:
//
//   1. Env       — createWolfMindEnv(): reset/act/close over a REPLAYED
//                  deterministic SIM tape. Replay IS backtesting.
//   2. Renderer  — renderWolfFrame(): one legible text frame with a DELTA
//                  section (the diff is the perception primitive).
//   3. Actions   — a fixed 5-verb vocabulary mapped onto the engine's
//                  ACTION1..ACTION5 names so mind.js's parser and validator
//                  port with ZERO changes. Legality per tick IS the risk
//                  surface: the harness offers only what the caps allow.
//   4. Oracle    — cash / equity / P&L / drawdown / exposure fed into every
//                  frame as truth anchors (the "off-board UI" slot).
//   5. Terminals — STOPPED_OUT (loss cap, the harness's kill) and
//                  SESSION_END map onto GAME_OVER / WIN semantics.
//
// PAPER MONEY ONLY. The tape is the Wolf's seeded SIM walk over fictional
// instruments — no live market, no brokerage, no orders that can touch the
// world. Risk caps (loss cap, cash-only sizing, no shorts, no leverage) live
// HERE in the harness, never in the mind: the mind proposes, plumbing polices.
//
// Pure by design (no fs / fetch / timers / Date.now in the replay path):
// drivers (scripts/wolf-mind-auto.ts) and tests import it unchanged.

import { createMarket, SIM_SOURCE } from './wolf-market.js';
import { createLedger, STARTING_CASH, DEFAULT_FEE_BPS, DEFAULT_SLIP_BPS } from './wolf-ledger.js';

export const WOLF_MODE_LABEL = 'BACKTEST REPLAY · SIM seeded walk · PAPER MONEY (no real market, no real dollars)';

// The action vocabulary. Names reuse the engine's ACTION1..5 so parseMindReply
// and validateAction from spatial/app/arc3/mind.js work unchanged; the
// MEANINGS are declared to the mind every turn and in the governor prompt.
export const WOLF_ACTION_MEANING = Object.freeze({
  1: 'HOLD — do nothing, let one tick pass',
  2: 'BUY SMALL — spend 25% of remaining cash',
  3: 'BUY BIG — spend 75% of remaining cash',
  4: 'SELL HALF — sell half of the held position',
  5: 'CLOSE — sell the entire position',
});
export const BUY_SMALL_FRAC = 0.25;
export const BUY_BIG_FRAC = 0.75;
export const MIN_ORDER_DOLLARS = 50; // below this, buys are not offered (fees would dominate)

// ---------------------------------------------------------------------------
// The governor, adapted for markets. Every rule from the ARC governor keeps
// its job under a market name — see-first, enumerate, bounded hypotheses,
// hazards, truth anchors, efficiency. The reply schema is IDENTICAL to the
// game engine's: whatISee / delta / hypothesis / action / reason / prediction
// / memo / plan. Only the domain examples and the plan-expect vocabulary
// changed.
// ---------------------------------------------------------------------------
export const WOLF_MIND_SYSTEM_PROMPT = `You are the mind of a general market-reasoning engine, driving one PAPER-MONEY session on a REPLAYED simulated price tape (a backtest). No real market, no real dollars, no advice to anyone — this is research. Each turn you receive ONE frame: session state, an ORACLE block (exact cash, equity, P&L, drawdown, exposure), your position, the recent tape, and a DELTA vs the previous tick. You know NOTHING about this instrument's character in advance — it may trend, mean-revert, chop, or crash. You DISCOVER its character by observing. You never assume it.

RULES OF SEEING AND ACTING
1. SEE FIRST. Ground every decision in what is actually in THIS frame. Observation overrides any plan, habit, or momentum.
2. THE TAPE MOVES WITHOUT YOU. Unlike a puzzle, the world ticks every turn even when you HOLD. Separate "what I did" (fills, cash changes) from "what the market did" (price moves) every single turn — the DELTA section splits them for you. A price move is never feedback about your action's correctness on its own.
3. ENUMERATE, DON'T ASSUME. Each turn ask: which actions are available, and what do I expect EACH to do to my equity here? Early observation is cheap; a wrong position held stubbornly is expensive.
4. CALIBRATE COSTS. Every fill pays a fee and slips against you (the fill line in DELTA shows the exact toll). A buy-then-sell round trip loses money when the price goes nowhere. Verify the observed cost from your first fills, record it in your memo, and demand that any trade idea clears it.
5. STRUCTURE OVER STORIES. A streak is not a trend and a bounce is not support. Being "near" a recent high or low means nothing by itself — only repeated, verified behavior counts. Trace what the tape actually did, not what a narrative says it should do.
6. DRAWDOWN IS THE HAZARD. The harness STOPS the session (STOPPED_OUT) if equity falls below the loss cap shown in the oracle. Distance-to-stop is your death zone map: size positions so one adverse streak cannot end the session. If a past session here ended STOPPED_OUT, treat whatever preceded it as a death zone and route around it.
7. THE ORACLE IS A TRUTH ANCHOR. Cash, equity, P&L, drawdown, exposure are exact accounting, not estimates. If your mental model of your position disagrees with the oracle, the oracle is right and your model just taught you something.
8. BOUNDED HYPOTHESES. Hold at most 3 competing models of "what is this tape doing" (e.g. drifting up, mean-reverting around a level, regime-shifted after a crash), each scored 1-5 with a kill-test. Confirmed twice = ground truth until the tape breaks it. Failed kill-test = drop it. Carry them in your memo.
9. FRICTION IS SURVIVAL. Every trade costs; overtrading bleeds equity even when half your calls are right. Observe deliberately, then act decisively once a hypothesis is confirmed — and HOLD when nothing is confirmed. A flat session beats a churned one.
10. SESSIONS ADD TWISTS. Each session replays a different tape (different seed or instrument). At session start the harness may hand you [EPISODIC MEMORY] distilled from previous sessions of THIS instrument: cost calibrations usually persist; tape character may differ. Re-verify cheaply, then exploit it hard.

ACTIONS — fixed vocabulary; ONLY the actions listed as available this turn are legal (the harness enforces the risk caps by controlling that list; you propose, the plumbing polices):
ACTION1 = HOLD (always available while running)
ACTION2 = BUY SMALL: spend 25% of remaining cash (offered only when cash allows)
ACTION3 = BUY BIG: spend 75% of remaining cash (offered only when cash allows)
ACTION4 = SELL HALF of the held position (offered only when holding)
ACTION5 = CLOSE the entire position (offered only when holding)
This book never shorts, never borrows, never uses leverage. Risk caps (loss cap, sizing bounds) live in the harness — you cannot raise them, only respect the distance to them.

REPLY FORMAT — exactly ONE JSON object, no markdown fences, no text outside it:
{"whatISee": "the frame NOW: price, oracle numbers that matter, anything new",
 "delta": "what changed since last tick — split market move vs your own fills; did it match your prediction? if not, what does that teach you",
 "hypothesis": "current best model of the tape + confidence, e.g. 'mean-reverting around 102, kill-test: two closes beyond 104 (3/5)'",
 "action": "ACTION1"|"ACTION2"|"ACTION3"|"ACTION4"|"ACTION5",
 "reason": "one line: why THIS action NOW",
 "prediction": "what the next frame should show if your hypothesis is right",
 "memo": "max 600 chars of carried state: observed friction cost, hypotheses+scores, death zones, position intent, plan",
 "plan": OPTIONAL — up to 8 FURTHER steps to run after "action" WITHOUT consulting you, ONLY when your hypothesis is confirmed and the intent is mechanical (e.g. hold through quiet ticks): [{"action": "ACTION1", "expect": "any"|"up"|"down"|"flat"|"price>N"|"price<N"|"equity>N"|"equity<N"}, ...]}

The memo is your only long-term memory — older turns fall out of the window, so keep it complete and current.
PLAN DISCIPLINE: each plan step executes only while reality matches its "expect" check (verified harness-side against the tape). On the first mismatch or terminal state the harness STOPS and returns control to you with the frames. Plans save calls on confirmed quiet stretches — never plan through an unconfirmed thesis or within one adverse tick of the loss cap.
HONESTY DISCIPLINE: never claim results the receipts do not show. This is a backtest on simulated data — any conclusion you write into your memo must say so. Backtest results do not promise live results, ever.
EPISODIC MEMORY: at session start the harness may hand you distilled knowledge from previous sessions of THIS instrument ([EPISODIC MEMORY]). Strong-but-verify priors: friction calibrations usually persist; tape character may differ. Re-verify cheaply, then exploit.`;

// ---------------------------------------------------------------------------
// Env — port 1. A replayed session over one instrument of the seeded SIM
// walk. Deterministic: same {seed, symbol, ticks, warmup, friction, cap} =>
// byte-identical snapshot stream for the same action sequence.
// ---------------------------------------------------------------------------

// Deterministic clock for replay provenance: tick n → a fixed ISO instant.
// (Receipts stay reproducible; nothing in the replay path reads real time.)
const REPLAY_EPOCH_MS = Date.UTC(2026, 0, 1);
export function replayAt(n) { return new Date(REPLAY_EPOCH_MS + n * 1000).toISOString(); }

export function createWolfMindEnv(opts = {}) {
  const seed = (opts.seed ?? 7) >>> 0;
  const symbol = opts.symbol ?? 'RUT';
  const ticks = Math.max(4, Math.min(5000, opts.ticks ?? 80));      // session length
  const warmup = Math.max(8, Math.min(600, opts.warmup ?? 120));    // pre-session tape context
  const feeBps = opts.feeBps ?? DEFAULT_FEE_BPS;
  const slipBps = opts.slipBps ?? DEFAULT_SLIP_BPS;
  const maxDailyLossPct = opts.maxDailyLossPct ?? 5;                // the harness's kill, not the mind's

  let market, ledger, sessionTick, peakEquity, lastFill, state, trades, feesPaid;

  function boot() {
    market = createMarket({ seed });
    ledger = createLedger(null, { feeBps, slipBps });
    for (let i = 0; i < warmup; i++) market.step(replayAt(i));
    sessionTick = 0;
    peakEquity = STARTING_CASH;
    lastFill = null;
    state = 'RUNNING';
    trades = 0;
    feesPaid = 0;
  }

  function quote() {
    const q = market.quotes(replayAt(warmup + sessionTick)).find((v) => v.symbol === symbol);
    if (!q) throw new Error(`unknown symbol ${symbol}`);
    return q;
  }

  function availableActions() {
    if (state !== 'RUNNING') return [];
    const q = quote();
    const pos = ledger.positions[symbol];
    const out = [1];
    if (ledger.cash >= MIN_ORDER_DOLLARS) out.push(2, 3);
    if (pos && pos.qty * q.price >= 1) out.push(4, 5);
    return out;
  }

  function snapshot() {
    const q = quote();
    const pos = ledger.positions[symbol] ?? null;
    const equity = ledger.equity({ [symbol]: q.price });
    const posValue = pos ? pos.qty * q.price : 0;
    const hist = q.history;
    return {
      mode: WOLF_MODE_LABEL,
      symbol,
      seed,
      state,
      sessionTick,
      ticksLeft: ticks - sessionTick,
      ticksTotal: ticks,
      close: q.price,
      prevClose: q.prev,
      tape: hist.slice(-48),
      cash: ledger.cash,
      equity,
      startEquity: STARTING_CASH,
      pnl: equity - STARTING_CASH,
      pnlPct: ((equity / STARTING_CASH) - 1) * 100,
      peakEquity,
      drawdownPct: peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0,
      exposurePct: equity > 0 ? (posValue / equity) * 100 : 0,
      lossCapPct: maxDailyLossPct,
      stopEquity: STARTING_CASH * (1 - maxDailyLossPct / 100),
      position: pos ? { qty: pos.qty, costBasis: pos.costBasis, value: posValue, unrealized: pos.qty * (q.price - pos.costBasis) } : null,
      lastFill,
      trades,
      feesPaid,
      availableActions: availableActions(),
      provenance: q.provenance,
    };
  }

  function applyAction(n) {
    const q = quote();
    lastFill = null;
    if (n === 1) return { ok: true };
    if (n === 2 || n === 3) {
      const dollars = ledger.cash * (n === 2 ? BUY_SMALL_FRAC : BUY_BIG_FRAC);
      if (dollars < MIN_ORDER_DOLLARS) return { ok: false, reason: 'order below minimum — not offered' };
      const r = ledger.buy(q, dollars, replayAt(warmup + sessionTick));
      if (r.ok) { lastFill = { kind: 'buy', dollars, qty: r.qty, execPx: r.execPx, fee: r.fee }; trades++; feesPaid += r.fee; }
      return r;
    }
    if (n === 4 || n === 5) {
      const r = ledger.sell(q, n === 4 ? 0.5 : 1, replayAt(warmup + sessionTick));
      if (r.ok) { lastFill = { kind: 'sell', qty: r.qty, proceeds: r.proceeds, realized: r.realized, execPx: r.execPx, fee: r.fee }; trades++; feesPaid += r.fee; }
      return r;
    }
    return { ok: false, reason: `unknown action ${n}` };
  }

  boot();

  return {
    symbol,
    seed,
    get state() { return state; },
    describe() { return `WOLF ${symbol} seed ${seed} · ${ticks} ticks (+${warmup} warmup) · fee ${feeBps}bps slip ${slipBps}bps · loss cap ${maxDailyLossPct}% · ${WOLF_MODE_LABEL}`; },
    availableActions,

    /** Fresh replay of the SAME tape. Deterministic — retrying a stopped-out
     *  session with a smarter memo is the learning loop. */
    reset() { boot(); return snapshot(); },

    /** One action, then the tape advances ONE tick (the tick clock: the world
     *  moves exactly once per act — HOLD included). Terminal checks are the
     *  harness's, after the move. Rejects actions the caps did not offer. */
    act(actionName) {
      if (state !== 'RUNNING') throw new Error(`act() after terminal state ${state}`);
      const n = Number(String(actionName).replace(/^ACTION/i, ''));
      if (!availableActions().includes(n)) throw new Error(`ACTION${n} is not available this tick (harness risk caps decide the list)`);
      const applied = applyAction(n);
      if (!applied.ok) throw new Error(`harness rejected ACTION${n}: ${applied.reason}`);
      market.step(replayAt(warmup + sessionTick + 1));
      sessionTick++;
      const q = quote();
      const equity = ledger.equity({ [symbol]: q.price });
      if (equity > peakEquity) peakEquity = equity;
      if (equity <= STARTING_CASH * (1 - maxDailyLossPct / 100)) state = 'STOPPED_OUT';
      else if (sessionTick >= ticks) state = 'SESSION_END';
      return snapshot();
    },

    /** Session summary — the numbers that go to receipts and episodic memory.
     *  buyHoldPct is the honest benchmark: the same session window, one
     *  all-in buy at the first tick, fees and slip included. */
    close() {
      const q = quote();
      const equity = ledger.equity({ [symbol]: q.price });
      const first = q.history[Math.max(0, q.history.length - 1 - sessionTick)];
      const bhExec = first * (1 + slipBps / 10000);
      const bhFee = 1 - feeBps / 10000;
      const bhQty = (STARTING_CASH * bhFee) / bhExec;
      const bhExit = bhQty * q.price * (1 - slipBps / 10000) * bhFee;
      return {
        mode: WOLF_MODE_LABEL,
        symbol, seed, state, sessionTicks: sessionTick,
        finalEquity: equity,
        pnlPct: ((equity / STARTING_CASH) - 1) * 100,
        maxDrawdownPct: peakEquity > 0 ? ((peakEquity - Math.min(equity, peakEquity)) / peakEquity) * 100 : 0,
        trades, feesPaid,
        buyHoldPct: ((bhExit / STARTING_CASH) - 1) * 100,
      };
    },
    snapshot,
  };
}

// ---------------------------------------------------------------------------
// Renderer — port 2. One legible frame; the DELTA section is the perception
// primitive, split into "what the market did" vs "what your action did".
// changedCount mirrors the grid diff contract: 0 => true no-op (possible only
// if the price is byte-identical AND nothing filled — vanishingly rare here,
// but the engine's no-op machinery stays honest).
// ---------------------------------------------------------------------------
const SPARK = '▁▂▃▄▅▆▇█';
export function sparkline(values) {
  if (!values.length) return '';
  const lo = Math.min(...values), hi = Math.max(...values);
  const span = hi - lo || 1;
  return values.map((v) => SPARK[Math.min(7, Math.floor(((v - lo) / span) * 8))]).join('');
}

const money = (v) => `$${v.toFixed(2)}`;
const pct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

export function renderWolfFrame(snap, prevSnap) {
  const out = [];
  out.push(`state ${snap.state} · tick ${snap.sessionTick}/${snap.ticksTotal} · ${snap.symbol} · ${snap.mode}`);
  out.push(`actions available this turn: ${snap.availableActions.join(', ')}${snap.availableActions.length ? '   (' + snap.availableActions.map((n) => `${n}=${WOLF_ACTION_MEANING[n].split(' — ')[0].split(':')[0]}`).join(' ') + ')' : ''}`);
  out.push('');

  let changedCount = 0;
  if (!prevSnap) {
    out.push('DELTA: (first frame — no prior tick to diff)');
  } else {
    const move = snap.close - prevSnap.close;
    const movePct = prevSnap.close ? (move / prevSnap.close) * 100 : 0;
    const lines = [];
    if (move !== 0) { lines.push(`market: ${snap.symbol} ${move > 0 ? 'UP' : 'DOWN'} ${money(Math.abs(move))} (${pct(movePct)}) to ${money(snap.close)}`); changedCount++; }
    else lines.push(`market: ${snap.symbol} unchanged at ${money(snap.close)}`);
    if (snap.lastFill) {
      const f = snap.lastFill;
      lines.push(f.kind === 'buy'
        ? `you: BOUGHT ${f.qty.toFixed(4)} ${snap.symbol} for ${money(f.dollars)} at ${money(f.execPx)} (fee ${money(f.fee)}, slip included)`
        : `you: SOLD ${f.qty.toFixed(4)} ${snap.symbol} for ${money(f.proceeds)} at ${money(f.execPx)} (fee ${money(f.fee)}, realized ${money(f.realized)})`);
      changedCount++;
    } else {
      lines.push('you: no fill (held)');
    }
    const dEq = snap.equity - prevSnap.equity;
    if (Math.abs(dEq) > 0.005) { lines.push(`equity: ${dEq > 0 ? 'UP' : 'DOWN'} ${money(Math.abs(dEq))} to ${money(snap.equity)}`); changedCount++; }
    out.push(`DELTA: ${changedCount === 0 ? 'nothing changed (NO-OP).' : ''}`);
    for (const l of lines) out.push(`  ${l}`);
  }
  out.push('');

  out.push('ORACLE (exact accounting — truth anchors):');
  out.push(`  cash ${money(snap.cash)} · position value ${money(snap.position ? snap.position.value : 0)} · equity ${money(snap.equity)}`);
  out.push(`  session P&L ${money(snap.pnl)} (${pct(snap.pnlPct)}) · drawdown from peak ${snap.drawdownPct.toFixed(2)}% · exposure ${snap.exposurePct.toFixed(1)}%`);
  out.push(`  LOSS CAP: session STOPS if equity touches ${money(snap.stopEquity)} (−${snap.lossCapPct}%) — distance ${money(snap.equity - snap.stopEquity)}`);
  out.push(`  trades so far ${snap.trades} · fees paid ${money(snap.feesPaid)}`);
  out.push('');

  out.push(snap.position
    ? `POSITION: ${snap.position.qty.toFixed(4)} ${snap.symbol} · cost basis ${money(snap.position.costBasis)} · unrealized ${money(snap.position.unrealized)}`
    : 'POSITION: flat (no holdings)');
  out.push('');

  const tail = snap.tape.slice(-12).map((v) => v.toFixed(2)).join('  ');
  out.push(`TAPE (last ${Math.min(48, snap.tape.length)} closes, newest right):`);
  out.push(`  ${sparkline(snap.tape)}`);
  out.push(`  last 12: ${tail}`);
  out.push(`  provenance: ${snap.provenance.source} · seed ${snap.provenance.seed} · tick ${snap.provenance.tick}`);

  return { text: out.join('\n'), changedCount: prevSnap ? changedCount : -1 };
}

// ---------------------------------------------------------------------------
// Plan-step verification — port of checkPlanExpectation to tape semantics.
// The cheap harness-side reality check that makes mind-authored plans safe
// to run without a model call per tick. Pure: prev/next snapshots in,
// {ok, note} out.
//   "any"        -> always passes
//   "up"/"down"  -> close moved that way this tick
//   "flat"       -> |move| < 0.15% this tick
//   "price>N"    -> next close above N   (likewise "price<N")
//   "equity>N"   -> equity above N       (likewise "equity<N")
// ---------------------------------------------------------------------------
export function checkWolfExpectation(expect, prevSnap, nextSnap) {
  if (expect === 'any') return { ok: true, note: 'any' };
  if (!prevSnap || !nextSnap) return { ok: false, note: 'no snapshots to compare' };
  const move = nextSnap.close - prevSnap.close;
  const movePct = prevSnap.close ? (move / prevSnap.close) * 100 : 0;
  if (expect === 'up') return move > 0 ? { ok: true, note: pct(movePct) } : { ok: false, note: `wanted up, saw ${pct(movePct)}` };
  if (expect === 'down') return move < 0 ? { ok: true, note: pct(movePct) } : { ok: false, note: `wanted down, saw ${pct(movePct)}` };
  if (expect === 'flat') return Math.abs(movePct) < 0.15 ? { ok: true, note: pct(movePct) } : { ok: false, note: `wanted flat, saw ${pct(movePct)}` };
  let m = expect.match(/^price([<>])(\d+(?:\.\d+)?)$/);
  if (m) {
    const hit = m[1] === '>' ? nextSnap.close > Number(m[2]) : nextSnap.close < Number(m[2]);
    return hit ? { ok: true, note: `close ${nextSnap.close.toFixed(2)}` } : { ok: false, note: `wanted ${expect}, close ${nextSnap.close.toFixed(2)}` };
  }
  m = expect.match(/^equity([<>])(\d+(?:\.\d+)?)$/);
  if (m) {
    const hit = m[1] === '>' ? nextSnap.equity > Number(m[2]) : nextSnap.equity < Number(m[2]);
    return hit ? { ok: true, note: `equity ${nextSnap.equity.toFixed(2)}` } : { ok: false, note: `wanted ${expect}, equity ${nextSnap.equity.toFixed(2)}` };
  }
  return { ok: false, note: `unknown expectation "${expect}"` };
}
