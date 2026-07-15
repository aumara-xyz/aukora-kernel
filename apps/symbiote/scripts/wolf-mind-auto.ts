#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
//
// wolf-mind-auto — the Wolf's automated reasoning-loop driver. EXPERIMENTAL.
// The port of scripts/fable-arc3-auto.ts to markets, per
// docs/arc3/REASONING_ENGINE_EXPORT.md. PAPER MONEY ONLY, replayed SIM tape.
//
// One engine, any world: opens a replayed session (spatial/app/wolf/
// wolf-mind-env.js), then loops { render frame -> build governed prompt ->
// call a reasoning model -> parse ONE action -> execute } until STOPPED_OUT /
// SESSION_END / budget. The harness is dumb plumbing — ALL market judgment
// lives in the model call (spatial/app/arc3/mind.js holds the window +
// parser + validator UNCHANGED; wolf-mind-env.js holds the governor prompt,
// renderer, expectation checker; this file holds the I/O).
//
// ZERO trading logic here by design: no signals, no thresholds, no targets.
// Risk caps live in the ENV (loss cap, cash-only sizing, action availability)
// — the mind proposes, plumbing polices. Receipts: JSONL per run under
// $AUKORA_SYMBIOTE_HOME/wolf/mind-runs/, episodic memory per instrument under
// wolf/memory/. Every line is labeled backtest-replay; never claim more.
//
//   bun scripts/wolf-mind-auto.ts run --symbol RUT --seed 7 --ticks 80
//   bun scripts/wolf-mind-auto.ts run --symbol LUM --mind fs          (Fable-in-the-loop, zero spend)
//   flags: --model <openrouter-slug> --mind openrouter|fs --ticks N --warmup N
//          --seed N --window N --max-tokens N --max-resets N --loss-cap-pct N
//          --base-url <openai-compatible> --echo-frames
//
// HONEST NOTE: this drives a SEEDED SIMULATED walk over FICTIONAL instruments.
// No live market data, no brokerage, nothing here can place a real order.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TurnWindow, buildTurnMessage, parseMindReply, validateAction } from '../spatial/app/arc3/mind.js';
import {
  WOLF_MIND_SYSTEM_PROMPT, WOLF_MODE_LABEL, createWolfMindEnv, renderWolfFrame, checkWolfExpectation,
} from '../spatial/app/wolf/wolf-mind-env.js';
import { resolveApiKey } from '../core/src/fusionConfig';

function arg(name: string, fb: string | null = null): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fb;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : 'true';
}
function flag(name: string): boolean { return process.argv.includes(`--${name}`); }

// ---------------------------------------------------------------------------
// Minds — same sockets as the reference driver. The driver never decides.
// ---------------------------------------------------------------------------
interface MindReply { text: string; usage?: { prompt_tokens?: number; completion_tokens?: number } }
interface Mind {
  call(messages: Array<{ role: string; content: unknown }>): Promise<MindReply>;
  describe(): string;
}

function makeOpenRouterMind(model: string, maxTokens: number, think: boolean, baseUrl?: string): Mind {
  const url = (baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '') + '/chat/completions';
  const isLocal = /127\.0\.0\.1|localhost/.test(url);
  const kr = resolveApiKey() ?? (isLocal ? { key: 'local', source: 'local (keyless)' } : null);
  if (!kr) throw new Error('No OpenRouter key resolved by core/src/fusionConfig.ts');
  return {
    async call(messages) {
      let lastErr: unknown = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), 120_000);
          const res = await fetch(url, {
            method: 'POST',
            signal: ctl.signal,
            headers: { authorization: `Bearer ${kr.key}`, 'content-type': 'application/json', 'x-title': 'aukora-wolf-mind' },
            body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: maxTokens, ...(think ? {} : { reasoning: { enabled: false } }) }),
          });
          clearTimeout(timer);
          const j: any = await res.json();
          if (j?.error) throw new Error(`OpenRouter error ${j.error.code ?? res.status}: ${String(j.error.message).slice(0, 200)}`);
          const msg = j?.choices?.[0]?.message;
          let text = msg?.content;
          if (typeof text !== 'string' || !text.trim().length) {
            const alt = msg?.reasoning ?? msg?.reasoning_content;
            if (typeof alt === 'string' && alt.includes('{')) text = alt;
          }
          if (typeof text !== 'string' || !text.trim().length) {
            throw new Error(`empty completion (finish_reason=${j?.choices?.[0]?.finish_reason ?? '?'}, provider=${j?.provider ?? '?'})`);
          }
          return { text, usage: j.usage };
        } catch (e) {
          lastErr = e;
          await new Promise((r) => setTimeout(r, 2000 * attempt));
        }
      }
      throw new Error(`OpenRouter call failed x3: ${String(lastErr).slice(0, 300)}`);
    },
    describe() { return `${baseUrl ? 'endpoint:' + baseUrl + ' model:' : 'openrouter:'}${model} (key source: ${kr.source}, max_tokens ${maxTokens})`; },
  };
}

// fs mind: prompt written to disk, reply read back — a human-level reasoner
// (Fable in a Claude Code session) can BE the mind with zero API spend.
function makeFsMind(dir: string): Mind {
  fs.mkdirSync(dir, { recursive: true });
  let turn = 0;
  return {
    async call(messages) {
      turn++;
      const promptPath = path.join(dir, `turn-${String(turn).padStart(4, '0')}.prompt.md`);
      const replyPath = path.join(dir, `turn-${String(turn).padStart(4, '0')}.reply.md`);
      const rendered = messages.map((m) => `### ${m.role}\n\n${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n\n');
      fs.writeFileSync(promptPath, rendered);
      console.log(`  [fs-mind] awaiting reply: ${replyPath}`);
      const deadline = Date.now() + 30 * 60_000;
      while (Date.now() < deadline) {
        if (fs.existsSync(replyPath)) {
          const text = fs.readFileSync(replyPath, 'utf8').trim();
          if (text.length) return { text };
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      throw new Error(`fs mind timed out waiting for ${replyPath}`);
    },
    describe() { return `fs handshake at ${dir} (human-level reasoner in the loop)`; },
  };
}

// ---------------------------------------------------------------------------
// Episodic memory (robotmem pattern, per INSTRUMENT): one JSON per symbol
// holding the distilled memo + honest stats of every prior session. Loaded as
// a strong-but-verify prior at run start; this run's final memo appended at
// the end. Losses distill into lessons — the stop-out IS the teacher.
// ---------------------------------------------------------------------------
interface EpisodicEntry {
  at: string; runId: string; seed: number; ticks: number; state: string;
  pnlPct: number; maxDrawdownPct: number; trades: number; memo: string; mode: string;
}
function episodicPath(baseDir: string, symbol: string): string {
  return path.join(baseDir, 'memory', `${symbol}.json`);
}
function loadEpisodic(baseDir: string, symbol: string): EpisodicEntry[] {
  try { return JSON.parse(fs.readFileSync(episodicPath(baseDir, symbol), 'utf8')).entries ?? []; } catch { return []; }
}
function saveEpisodic(baseDir: string, symbol: string, entry: EpisodicEntry): void {
  const p = episodicPath(baseDir, symbol);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const entries = loadEpisodic(baseDir, symbol);
  entries.push(entry);
  fs.writeFileSync(p, JSON.stringify({ symbol, entries: entries.slice(-8) }, null, 1));
}

// ---------------------------------------------------------------------------
// The loop — dumb plumbing around the mind. Everything it "knows" is
// observational: snapshots, state strings, the oracle numbers.
// ---------------------------------------------------------------------------
async function run(): Promise<void> {
  const symbol = (arg('symbol', 'RUT') || 'RUT').toUpperCase();
  const model = arg('model', 'z-ai/glm-5.2')!;
  const mindKind = arg('mind', 'openrouter')!;
  const seed = Number(arg('seed', '7'));
  const ticks = Number(arg('ticks', '80'));
  const warmup = Number(arg('warmup', '120'));
  const windowPairs = Number(arg('window', '5'));
  const maxTokens = Number(arg('max-tokens', '4000'));
  const maxResets = Number(arg('max-resets', '1'));
  const lossCapPct = Number(arg('loss-cap-pct', '5'));
  const echoFrames = flag('echo-frames');

  const runId = `${symbol}-s${seed}-${Date.now().toString(36)}`;
  const home = process.env.AUKORA_SYMBIOTE_HOME ?? path.join(os.homedir(), '.aukora-symbiote');
  const baseDir = path.join(home, 'wolf');
  const runDir = path.join(baseDir, 'mind-runs', runId);
  fs.mkdirSync(runDir, { recursive: true });
  const logPath = path.join(runDir, 'run.jsonl');
  const logLine = (o: unknown) => fs.appendFileSync(logPath, JSON.stringify(o) + '\n');

  const env = createWolfMindEnv({ seed, symbol, ticks, warmup, maxDailyLossPct: lossCapPct });
  const mind: Mind = mindKind === 'fs' ? makeFsMind(path.join(runDir, 'fs-mind')) : makeOpenRouterMind(model, maxTokens, flag('think'), arg('base-url') ?? undefined);

  console.log(`\nWOLF MIND AUTO — ${env.describe()}`);
  console.log(`  mind: ${mind.describe()}`);
  console.log(`  budget: ${ticks} ticks, ${maxResets} retries · window ${windowPairs} pairs · receipts ${runDir}`);
  console.log(`  ${WOLF_MODE_LABEL}\n`);

  let snap = env.reset();
  let prevSnap: ReturnType<typeof env.snapshot> | null = null;
  const window = new TurnWindow(windowPairs);
  let memo = '';
  let lastPrediction = '';
  let noopFlag: string | null = null;
  let noopStreak: string[] = [];
  let notices: string[] = [`Session opened: ${symbol}, ${ticks} ticks of replayed tape. The instrument's character is UNKNOWN — observe before committing. ${WOLF_MODE_LABEL}.`];
  let moves = 0, resets = 0, mindFailures = 0, planMoves = 0;
  const maxMoves = ticks + 8; // an action per tick plus reject slack

  const episodic = loadEpisodic(baseDir, symbol);
  if (episodic.length) {
    const recent = episodic.slice(-3).map((e) => `[${e.at.slice(0, 10)} ${e.state} ${e.pnlPct.toFixed(2)}% in ${e.ticks}t, dd ${e.maxDrawdownPct.toFixed(1)}%, ${e.trades} trades] ${e.memo}`).join('\n');
    notices.push(`EPISODIC MEMORY (${episodic.length} prior session(s) of ${symbol} — verify cheaply, then exploit):\n${recent}`);
    console.log(`  episodic memory: ${episodic.length} prior session(s) loaded`);
  }
  let promptTokens = 0, completionTokens = 0;
  const t0 = Date.now();

  logLine({ kind: 'start', runId, mode: WOLF_MODE_LABEL, symbol, seed, ticks, warmup, lossCapPct, mind: mind.describe(), windowPairs });

  while (moves < maxMoves && snap.state === 'RUNNING') {
    const rendered = renderWolfFrame(snap, prevSnap);
    if (echoFrames) console.log(rendered.text);

    const userText = buildTurnMessage({
      moveNo: moves + 1,
      movesLeft: snap.ticksLeft,
      frameText: rendered.text,
      noopAction: noopFlag,
      noopStreakActions: noopStreak,
      memo,
      lastPrediction,
      notices,
    });
    notices = [];

    const messages = [{ role: 'system', content: WOLF_MIND_SYSTEM_PROMPT }, ...window.messages(userText)];

    // Two failure budgets, kept separate exactly like the reference driver:
    // provider errors get patient cumulative retries; malformed/illegal
    // replies get 3 corrective tries.
    let parsed: ReturnType<typeof parseMindReply> | null = null;
    let rawText = '';
    let latencyMs = 0;
    let qualityRejects = 0;
    while (parsed === null) {
      const tCall = Date.now();
      let reply: MindReply;
      try {
        reply = await mind.call(messages as Array<{ role: string; content: unknown }>);
      } catch (e) {
        mindFailures++;
        logLine({ kind: 'mind_error', move: moves + 1, error: String(e).slice(0, 400) });
        if (mindFailures > 12) throw new Error(`mind provider unavailable (${mindFailures} cumulative failures): ${String(e).slice(0, 200)}`);
        console.log(`  [mind] provider failure ${mindFailures}/12 — backing off`);
        await new Promise((r) => setTimeout(r, Math.min(60_000, 8000 * mindFailures)));
        continue;
      }
      latencyMs = Date.now() - tCall;
      rawText = reply.text;
      promptTokens += reply.usage?.prompt_tokens ?? 0;
      completionTokens += reply.usage?.completion_tokens ?? 0;
      const p = parseMindReply(rawText);
      if (!p.ok) {
        qualityRejects++;
        if (qualityRejects >= 3) throw new Error(`mind could not produce a parseable reply in 3 tries: ${p.error}`);
        messages.push({ role: 'assistant', content: rawText });
        messages.push({ role: 'user', content: `Your reply was rejected: ${p.error}. Reply again with EXACTLY one JSON object in the specified format.` });
        logLine({ kind: 'parse_reject', move: moves + 1, error: p.error, raw: rawText.slice(0, 500) });
        continue;
      }
      const v = validateAction(p.action, snap.availableActions);
      if (!v.ok) {
        qualityRejects++;
        if (qualityRejects >= 3) throw new Error(`mind could not produce a legal action in 3 tries: ${v.error}`);
        messages.push({ role: 'assistant', content: rawText });
        messages.push({ role: 'user', content: `Your action was rejected: ${v.error}. The harness risk caps decide availability. Choose an AVAILABLE action and reply again with one JSON object.` });
        logLine({ kind: 'action_reject', move: moves + 1, error: v.error });
        continue;
      }
      parsed = p;
    }

    const a = parsed.action;
    const label = a.name;
    prevSnap = snap;
    snap = env.act(a.name);
    moves++;

    // True no-op is nearly impossible on a moving tape, but the engine's
    // no-op honesty stays wired: byte-identical frame => flag it.
    const noop = rendered.changedCount === 0;
    if (noop) { noopFlag = label; noopStreak.push(label); } else { noopFlag = null; noopStreak = []; }

    memo = parsed.memo || memo;
    lastPrediction = parsed.prediction;
    window.push(userText, JSON.stringify({
      whatISee: parsed.whatISee, delta: parsed.delta, hypothesis: parsed.hypothesis,
      action: a, reason: parsed.reason, prediction: parsed.prediction, memo: parsed.memo,
    }));

    console.log(`  #${String(moves).padStart(3)} t${String(snap.sessionTick).padStart(3)} ${label.padEnd(8)} px ${snap.close.toFixed(2)} eq ${snap.equity.toFixed(2)} (${snap.pnlPct >= 0 ? '+' : ''}${snap.pnlPct.toFixed(2)}%) ${snap.state.padEnd(11)} ${(latencyMs / 1000).toFixed(1)}s  ${parsed.reason.slice(0, 80)}`);
    logLine({
      kind: 'move', move: moves, mode: WOLF_MODE_LABEL, tick: snap.sessionTick, action: label, state: snap.state,
      close: snap.close, cash: snap.cash, equity: snap.equity, pnlPct: snap.pnlPct,
      drawdownPct: snap.drawdownPct, exposurePct: snap.exposurePct, fill: snap.lastFill, latencyMs,
      whatISee: parsed.whatISee, delta: parsed.delta, hypothesis: parsed.hypothesis,
      reason: parsed.reason, prediction: parsed.prediction, memo: parsed.memo,
      plan: parsed.plan && parsed.plan.length ? parsed.plan : undefined,
      promptText: userText,
    });

    // ---- plan execution: the mind's pre-verified quiet stretch, no calls ----
    if (parsed.plan && parsed.plan.length && snap.state === 'RUNNING') {
      for (const step of parsed.plan) {
        if (moves >= maxMoves) break;
        const sv = validateAction(step.action, snap.availableActions);
        if (!sv.ok) { notices.push(`PLAN STOPPED before step: ${sv.error}.`); break; }
        prevSnap = snap;
        snap = env.act(step.action.name);
        moves++;
        planMoves++;
        const check = checkWolfExpectation(step.expect, prevSnap, snap);
        console.log(`  #${String(moves).padStart(3)} t${String(snap.sessionTick).padStart(3)} ${step.action.name.padEnd(8)} PLAN px ${snap.close.toFixed(2)} eq ${snap.equity.toFixed(2)} expect ${step.expect}: ${check.ok ? 'ok' : 'MISMATCH'}`);
        logLine({ kind: 'plan_move', move: moves, tick: snap.sessionTick, action: step.action.name, expect: step.expect, ok: check.ok, note: check.note, close: snap.close, equity: snap.equity, state: snap.state });
        if (snap.state !== 'RUNNING') { notices.push(`PLAN STOPPED: state became ${snap.state}.`); break; }
        if (!check.ok) { notices.push(`PLAN STOPPED at ${step.action.name}: expected "${step.expect}" but saw ${check.note}. Re-observe before continuing.`); break; }
      }
    }

    if (snap.state === 'STOPPED_OUT') {
      const post = env.close();
      logLine({ kind: 'stopped_out', afterMove: moves, summary: post });
      if (resets >= maxResets) { console.log('  STOPPED_OUT and retry budget exhausted.'); break; }
      resets++;
      notices.push(`STOPPED OUT: equity touched the loss cap (−${lossCapPct}%) and the harness ENDED the session — that is the drawdown hazard from rule 6, realized. The SAME tape has been reset for retry ${resets}/${maxResets} (deterministic replay — the price path will repeat). Mark what preceded the stop-out as a death zone in your memo and trade the replay differently.`);
      snap = env.reset();
      prevSnap = null;
      noopFlag = null; noopStreak = [];
      logLine({ kind: 'reset', afterMove: moves, resets });
    }
  }

  const summaryEnv = env.close();
  const wallSec = Math.round((Date.now() - t0) / 1000);
  if (memo) {
    saveEpisodic(baseDir, symbol, {
      at: new Date().toISOString(), runId, seed, ticks, state: snap.state,
      pnlPct: summaryEnv.pnlPct, maxDrawdownPct: summaryEnv.maxDrawdownPct,
      trades: summaryEnv.trades, memo, mode: WOLF_MODE_LABEL,
    });
  }
  const summary = {
    kind: 'summary', runId, mode: WOLF_MODE_LABEL, symbol, seed, state: snap.state,
    sessionTicks: snap.sessionTick, moves, resets, planMoves, mindFailures,
    finalEquity: summaryEnv.finalEquity, pnlPct: summaryEnv.pnlPct,
    maxDrawdownPct: summaryEnv.maxDrawdownPct, trades: summaryEnv.trades,
    feesPaid: summaryEnv.feesPaid, buyHoldPct: summaryEnv.buyHoldPct,
    promptTokens, completionTokens, wallSec, receipts: logPath,
  };
  logLine(summary);
  fs.writeFileSync(path.join(runDir, 'final.json'), JSON.stringify(summary, null, 2));
  console.log(`\n${snap.state} — ${symbol}: P&L ${summary.pnlPct >= 0 ? '+' : ''}${summary.pnlPct.toFixed(2)}% vs buy-hold ${summary.buyHoldPct >= 0 ? '+' : ''}${summary.buyHoldPct.toFixed(2)}% · max dd ${summary.maxDrawdownPct.toFixed(2)}% · ${summary.trades} trades, fees $${summary.feesPaid.toFixed(2)} · ${moves} moves (${planMoves} by plan), ${wallSec}s, tokens ${promptTokens}+${completionTokens}`);
  console.log(`${WOLF_MODE_LABEL}`);
  console.log(`receipts: ${logPath}`);
  process.exit(0);
}

if (import.meta.main) {
  const cmd = process.argv[2];
  if (cmd === 'run') {
    run().catch((e) => { console.error(`FATAL: ${e?.message ?? e}`); process.exit(3); });
  } else {
    console.error('usage: bun scripts/wolf-mind-auto.ts run [--symbol RUT] [--seed N] [--ticks N] [--warmup N] [--model slug] [--mind openrouter|fs] [--window N] [--max-tokens N] [--max-resets N] [--loss-cap-pct N] [--base-url url] [--echo-frames]');
    process.exit(1);
  }
}
