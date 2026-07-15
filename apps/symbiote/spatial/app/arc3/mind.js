// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
//
// mind.js — the GAME-AGNOSTIC reasoning-loop core ("ULHF / Observer-First").
//
// This module is the pure heart of the general reasoning engine: a
// model-in-the-loop observe → hypothesize → act → verify cycle for ANY
// observe-act game. It contains ZERO game logic — no BFS, no goal-seeking, no
// assumed mechanic. The model IS the mind; this module only makes one frame
// legible (grid + regions + diff), manages a bounded parity-safe conversation
// window with a carried memo, and parses one structured action per turn.
//
// The governor rules encoded in MIND_SYSTEM_PROMPT follow the ULHF /
// Observer-First method (a human-governed model-in-the-loop approach to
// ARC-AGI-3 relayed to this lane; not independently verified here): SEE
// FIRST, no-op = blocked, enumerate don't assume, topology over proximity,
// hazards are death zones, off-board UI is a truth anchor, bounded competing
// hypotheses, efficiency-weighted scoring.
//
// Pure by design (no fs / fetch / timers): drivers (scripts/fable-arc3-auto.ts)
// and, later, Auma's own organs import it unchanged.

import { segment } from './engine.js';

export const COLOR_NAME = {
  0: 'white', 1: 'silver', 2: 'grey', 3: 'dkgrey', 4: 'charcoal', 5: 'black',
  6: 'magenta', 7: 'pink', 8: 'red', 9: 'blue', 10: 'cyan', 11: 'yellow',
  12: 'orange', 13: 'maroon', 14: 'green', 15: 'purple',
};
const HEX = '0123456789abcdef';

// ---------------------------------------------------------------------------
// The governor. Every rule here earned its place by killing a real failure
// mode (momentum no-op loops, assumed mechanics, proximity chasing, hazard
// re-entry, orientation blindness). Keep it game-agnostic — never name a
// specific game's mechanic as fact.
// ---------------------------------------------------------------------------
export const MIND_SYSTEM_PROMPT = `You are the mind of a general game-playing engine for observe-act games on a 64x64 color grid.
Each turn you receive ONE frame: a cropped ASCII grid (hex digit = color), a region table, and a DIFF vs the previous frame. You know NOTHING about the mechanic in advance — it may be maze movement, tile toggling, click puzzles, carrying, timing/stealth, symmetry matching, or something never seen. You DISCOVER the mechanic by probing. You never assume it.

RULES OF SEEING AND ACTING
1. SEE FIRST. Ground every decision in what is actually in THIS frame. Observation overrides any plan, habit, or momentum.
2. NO-OP = BLOCKED (usually). If the harness flags your last action as a NO-OP (frame byte-identical), treat that action as blocked in this state and choose differently. EXCEPTION — hidden state: if EVERY available action no-ops from this state, the game may hold state the grid does not draw (a mode, an orientation, a charge-up). Then run deliberate experiments, systematically: test EACH action DOUBLED (press it twice in a row — hidden state often consumes the first press) before trying mixed ordered pairs. Log which experiments you have run in your memo so you do not loop.
3. ENUMERATE, DON'T ASSUME. Each turn ask: which actions are available, and what do I expect EACH to do here? Early probes are cheap; late wasted moves are expensive.
4. CALIBRATE CONTROLS. Action numbers are scrambled per game. Weak prior: 1=up 2=down 3=left 4=right, 5=special/toggle (no coords), 6=click at (x,y) with x=column 0-63 y=row 0-63, 7=undo. Trust NOTHING until you see a confirming diff. Record the confirmed mapping in your memo.
5. TOPOLOGY OVER PROXIMITY. Being visually near an apparent goal means nothing unless structure connects you to it. Trace the actual paths, containers, and mechanisms.
6. HAZARDS AND AUTONOMOUS MOTION. If an action caused GAME_OVER or a reset, mark that path a death zone in your memo and route around it. If the DIFF shows cells changing that YOUR action cannot explain, something moves on its own — model its trajectory and time your moves; do not walk into it. Check whether autonomous elements advance in real time or ONLY when you act: if they tick with your moves, their positions are a pure function of your move count — measure each one's cycle, then COMPUTE a schedule that threads them instead of reacting move by move (and remember: on a grid where every move flips your node parity, some squares are only reachable on one parity — plan around it, pacing cannot fix it). A distinctive pixel on a hazard often encodes its heading (movers) or gaze (statics) — read it; a gazing hazard may punish only one approach direction and may be passable, even consumable, from its blind sides. Verify EVERY prediction about a hazard before standing in reach: one unverified assumption about a range or bounce point is how runs die.
7. OFF-BOARD UI IS A TRUTH ANCHOR. Bars, counters, and side panels are the game speaking: a bar that shrinks each move is a budget; a panel may be a reference pattern to match; a dormant element may be a switch that must fire before the goal opens.
8. BOUNDED HYPOTHESES. Hold at most 3 competing models of "what is this game", each scored 1-5 with a kill-test. Confirmed twice = ground truth. Failed kill-test = drop it. Carry them in your memo.
9. EFFICIENCY IS SURVIVAL. Levels are scored on action-efficiency against a human baseline (roughly (baseline/actions)^2, capped at 1); an unfinished level scores 0. Probe deliberately, then act decisively once the mechanic is confirmed. A completed level beats an elegant failure.
10. LEVELS ADD TWISTS. When a level completes, the mechanic often gains a wrinkle. Re-verify your mapping cheaply before committing to long plans.

REPLY FORMAT — exactly ONE JSON object, no markdown fences, no text outside it:
{"whatISee": "the board NOW: key objects, positions, anything new",
 "delta": "what changed since last frame; did it match your prediction? if not, what does that teach you",
 "hypothesis": "current best model of the game + confidence, e.g. 'maze: blue=me, 2=down confirmed (4/5)'",
 "action": "ACTION1"|"ACTION2"|"ACTION3"|"ACTION4"|"ACTION5"|"ACTION7"|{"name":"ACTION6","x":0-63,"y":0-63},
 "reason": "one line: why THIS action NOW",
 "prediction": "what the next frame should show if your hypothesis is right",
 "memo": "max 600 chars of carried state: confirmed controls, hypotheses+scores, death zones, blocked moves, plan",
 "plan": OPTIONAL — up to 8 FURTHER steps to run after "action" WITHOUT consulting you, ONLY when the mechanic is confirmed and the route is fully computed: [{"action": <same format>, "expect": "moved"|"moved:<color>:<up|down|left|right>"|"changed"|"any"}, ...]}

Only actions listed as available this turn are legal. The memo is your only long-term memory — older turns fall out of the window, so keep the memo complete and current.
PLAN DISCIPLINE: each plan step executes only while reality matches its "expect" check (a cheap harness-side verification — movement direction of a colored block, or any-change). On the first mismatch, level change, or danger the harness STOPS and returns control to you with the frames. Plans save your calls on confirmed straightaways — never plan through unverified territory, hazards with unknown behavior, or first-contact interactions.
EPISODIC MEMORY: at session start the harness may hand you distilled knowledge from previous sessions of THIS game ([EPISODIC MEMORY]). Treat it as strong-but-verify priors: control mappings usually persist; level layouts may differ; re-verify cheaply before relying on it, then exploit it hard.`;

// ---------------------------------------------------------------------------
// Rendering — make one frame legible enough to reason over. (The same
// rendering the hand-driven session harnesses used.)
// ---------------------------------------------------------------------------

function boundingBox(grid, bg) {
  let x0 = 64, y0 = 64, x1 = -1, y1 = -1;
  for (let y = 0; y < grid.length; y++) for (let x = 0; x < grid[0].length; x++) {
    if (grid[y][x] !== bg) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return { x0: 0, y0: 0, x1: grid[0].length - 1, y1: grid.length - 1 };
  return { x0: Math.max(0, x0 - 2), y0: Math.max(0, y0 - 2), x1: Math.min(grid[0].length - 1, x1 + 2), y1: Math.min(grid.length - 1, y1 + 2) };
}

export function renderGrid(grid, bg) {
  const bb = boundingBox(grid, bg);
  const lines = [];
  let tens = '     ';
  let units = '     ';
  for (let x = bb.x0; x <= bb.x1; x++) { tens += (x % 10 === 0 ? String(Math.floor(x / 10)) : ' '); units += String(x % 10); }
  lines.push(tens);
  lines.push(units);
  for (let y = bb.y0; y <= bb.y1; y++) {
    let row = String(y).padStart(3, ' ') + '  ';
    for (let x = bb.x0; x <= bb.x1; x++) { const c = grid[y][x]; row += (c === bg ? '.' : HEX[c]); }
    lines.push(row);
  }
  lines.push(`  (crop cols ${bb.x0}..${bb.x1} x rows ${bb.y0}..${bb.y1}; '.' = background color ${bg} ${COLOR_NAME[bg]})`);
  return lines.join('\n');
}

export function renderSegments(seg) {
  const rows = seg.regions.filter((r) => r.color !== seg.background).slice(0, 14);
  const lines = ['regions (non-background), largest first:'];
  for (const r of rows) {
    lines.push(`  color ${String(r.color).padStart(2)} ${(COLOR_NAME[r.color] || '?').padEnd(8)} size ${String(r.size).padStart(5)}  box (${r.box.x0},${r.box.y0})-(${r.box.x1},${r.box.y1})  center (${r.cx.toFixed(0)},${r.cy.toFixed(0)})`);
  }
  return lines.join('\n');
}

// Diff between two grids. Returns { text, changedCount } so callers can detect
// a true no-op (changedCount === 0) without re-diffing.
export function renderDiff(prev, grid) {
  if (!prev) return { text: '(first frame — no prior to diff)', changedCount: -1 };
  const changed = [];
  for (let y = 0; y < grid.length; y++) for (let x = 0; x < grid[0].length; x++) {
    if (prev[y][x] !== grid[y][x]) changed.push({ x, y, from: prev[y][x], to: grid[y][x] });
  }
  if (!changed.length) return { text: 'DIFF: nothing changed (NO-OP).', changedCount: 0 };
  const lines = [`DIFF: ${changed.length} cell(s) changed.`];
  const gained = new Map();
  const lost = new Map();
  for (const c of changed) {
    if (!lost.has(c.from)) lost.set(c.from, []);
    lost.get(c.from).push({ x: c.x, y: c.y });
    if (!gained.has(c.to)) gained.set(c.to, []);
    gained.get(c.to).push({ x: c.x, y: c.y });
  }
  for (const [color, g] of gained) {
    const l = lost.get(color) || [];
    if (g.length >= 4 && g.length === l.length) {
      const cg = g.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
      const cl = l.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
      const dx = Math.round((cg.x - cl.x) / g.length), dy = Math.round((cg.y - cl.y) / g.length);
      if (dx || dy) lines.push(`  -> color ${color} ${COLOR_NAME[color]} block MOVED (dx ${dx}, dy ${dy}) [${dy < 0 ? 'up ' : dy > 0 ? 'down ' : ''}${dx < 0 ? 'left' : dx > 0 ? 'right' : ''}]`);
    }
  }
  lines.push(`  cells: ${changed.slice(0, 24).map((c) => `(${c.x},${c.y})${c.from}->${c.to}`).join(' ')}${changed.length > 24 ? ' ...' : ''}`);
  return { text: lines.join('\n'), changedCount: changed.length };
}

// Full frame text for one turn. obs is normalizeObs() output; prevGrid may be null.
export function renderFrame(obs, prevGrid) {
  const seg = obs.segments ?? segment(obs.grid);
  const d = renderDiff(prevGrid, obs.grid);
  const out = [];
  out.push(`state ${obs.state} · levels completed ${obs.levelsCompleted}/${obs.winLevels}`);
  out.push(`actions available this turn: ${obs.availableActions.join(', ')}`);
  out.push('');
  out.push(d.text);
  out.push('');
  out.push(renderSegments(seg));
  out.push('');
  out.push(renderGrid(obs.grid, seg.background));
  return { text: out.join('\n'), changedCount: d.changedCount };
}

// ---------------------------------------------------------------------------
// Turn message — everything the mind needs THIS turn, with the governor's
// loud flags. `notices` carries harness events (deaths, resets, level-ups).
// ---------------------------------------------------------------------------
export function buildTurnMessage({ moveNo, movesLeft, frameText, noopAction = null, noopStreakActions = [], memo = '', lastPrediction = '', notices = [] }) {
  const lines = [];
  lines.push(`MOVE ${moveNo} · moves left in budget: ${movesLeft}`);
  for (const n of notices) lines.push(`[NOTICE] ${n}`);
  if (noopAction) {
    lines.push(`[LAST ACTION = NO-OP] ${noopAction} changed NOTHING. That action is BLOCKED in this state — do not repeat it here.`);
  }
  if (noopStreakActions.length >= 2) {
    lines.push(`[STAGNATION] ${noopStreakActions.length} consecutive no-ops: ${noopStreakActions.join(', ')}. Every one of these is blocked here. Pick from the UNTRIED set, or reconsider what kind of game this is.`);
  }
  if (memo) lines.push(`[YOUR MEMO FROM LAST TURN] ${memo}`);
  if (lastPrediction) lines.push(`[YOUR LAST PREDICTION] ${lastPrediction}`);
  lines.push('');
  lines.push(frameText);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Reply parsing — tolerant (models fence, prefix, or chat around JSON) but
// strict about the one thing that matters: exactly one legal action.
// ---------------------------------------------------------------------------

// Balanced-brace scan (string-aware) from one starting '{'; returns the
// parsed object or null.
function tryParseFrom(t, start) {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\' && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    if (ch === '}') { depth--; if (depth === 0) {
      try { return JSON.parse(t.slice(start, i + 1)); } catch { return null; }
    } }
  }
  return null;
}

// Try every '{' candidate in order: leading chatter that contains braces
// (or a brace inside an earlier string) must not doom a valid reply. Prefer
// the first candidate that carries an action (this parser exists to find the
// mind's reply); fall back to the first parseable object otherwise.
function scanForObject(t) {
  let fallback = null;
  for (let start = t.indexOf('{'); start >= 0; start = t.indexOf('{', start + 1)) {
    const obj = tryParseFrom(t, start);
    if (obj && typeof obj === 'object') {
      if (obj.action != null) return obj;
      if (!fallback) fallback = obj;
    }
  }
  return fallback;
}

function extractJsonObject(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  // A fenced block is only trusted if it actually yields an object —
  // triple backticks can also appear INSIDE string values of a valid reply.
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    const fromFence = scanForObject(fence[1].trim());
    if (fromFence) return fromFence;
  }
  return scanForObject(t);
}

function normalizeAction(a, top) {
  // Accept: "ACTION3" | "3" | 3 | {name:"ACTION6",x,y} | {action:6,x,y}; also
  // top-level x/y when action is the bare string/number for a click.
  if (a == null) return null;
  if (typeof a === 'object') {
    const name = normalizeActionName(a.name ?? a.action ?? a.id);
    if (!name) return null;
    const out = { name };
    if (a.x != null) out.x = Number(a.x);
    if (a.y != null) out.y = Number(a.y);
    return out;
  }
  const name = normalizeActionName(a);
  if (!name) return null;
  const out = { name };
  if (top && top.x != null) out.x = Number(top.x);
  if (top && top.y != null) out.y = Number(top.y);
  return out;
}

function normalizeActionName(v) {
  if (v == null) return null;
  const s = String(v).trim().toUpperCase();
  if (/^ACTION[1-7]$/.test(s)) return s;
  if (/^[1-7]$/.test(s)) return `ACTION${s}`;
  const m = s.match(/^A(?:CTION)?\s*([1-7])$/);
  if (m) return `ACTION${m[1]}`;
  return null;
}

export function parseMindReply(text) {
  const obj = extractJsonObject(text);
  if (!obj) return { ok: false, error: 'no parseable JSON object in reply' };
  const action = normalizeAction(obj.action, obj);
  if (!action) return { ok: false, error: `missing or malformed "action" (got ${JSON.stringify(obj.action)})` };
  if (action.name === 'ACTION6') {
    if (!Number.isInteger(action.x) || !Number.isInteger(action.y) || action.x < 0 || action.x > 63 || action.y < 0 || action.y > 63) {
      return { ok: false, error: 'ACTION6 needs integer x,y in 0..63' };
    }
  }
  // optional plan: up to 8 verified-execution steps
  const plan = [];
  if (Array.isArray(obj.plan)) {
    for (const step of obj.plan) {
      if (plan.length >= 8) break;
      const a = normalizeAction(step?.action ?? step, step);
      if (!a) continue;
      if (a.name === 'ACTION6' && !(Number.isInteger(a.x) && Number.isInteger(a.y) && a.x >= 0 && a.x <= 63 && a.y >= 0 && a.y <= 63)) continue;
      const expect = typeof step?.expect === 'string' ? step.expect.slice(0, 40) : 'changed';
      plan.push({ action: a, expect });
    }
  }
  return {
    ok: true,
    action,
    plan,
    whatISee: typeof obj.whatISee === 'string' ? obj.whatISee : '',
    delta: typeof obj.delta === 'string' ? obj.delta : '',
    hypothesis: typeof obj.hypothesis === 'string' ? obj.hypothesis : '',
    reason: typeof obj.reason === 'string' ? obj.reason : '',
    prediction: typeof obj.prediction === 'string' ? obj.prediction : '',
    memo: typeof obj.memo === 'string' ? obj.memo.slice(0, 600) : '',
  };
}

// ---------------------------------------------------------------------------
// Plan-step verification — the cheap harness-side reality check that makes
// mind-authored plans safe to run without a model call per move.
//   "any"                     -> always passes
//   "changed"                 -> some cell changed (not a pure no-op)
//   "moved"                   -> any color block registered a rigid move
//   "moved:<color>:<dir>"     -> that color moved that direction (up|down|left|right)
// Pure: takes the previous and next grids, returns {ok, note}.
// ---------------------------------------------------------------------------
export function checkPlanExpectation(expect, prevGrid, nextGrid) {
  if (expect === 'any') return { ok: true, note: 'any' };
  if (!prevGrid || !nextGrid) return { ok: false, note: 'no grids to compare' };
  const moves = [];
  let changed = 0;
  const gained = new Map();
  const lost = new Map();
  for (let y = 0; y < nextGrid.length; y++) for (let x = 0; x < nextGrid[0].length; x++) {
    const f = prevGrid[y][x], t = nextGrid[y][x];
    if (f === t) continue;
    changed++;
    if (!lost.has(f)) lost.set(f, []);
    lost.get(f).push({ x, y });
    if (!gained.has(t)) gained.set(t, []);
    gained.get(t).push({ x, y });
  }
  for (const [color, g] of gained) {
    const l = lost.get(color) || [];
    if (g.length >= 2 && g.length === l.length) {
      const cg = g.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
      const cl = l.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
      const dx = (cg.x - cl.x) / g.length, dy = (cg.y - cl.y) / g.length;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        moves.push({ color, dir: Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up') });
      }
    }
  }
  if (expect === 'changed') return changed > 0 ? { ok: true, note: `${changed} cells` } : { ok: false, note: 'no-op' };
  if (expect === 'moved') return moves.length ? { ok: true, note: `moved ${moves.map((m) => m.color + ':' + m.dir).join(',')}` } : { ok: false, note: changed ? 'changed but no rigid move' : 'no-op' };
  const m = expect.match(/^moved:(\d+):(up|down|left|right)$/);
  if (m) {
    const hit = moves.find((v) => v.color === Number(m[1]) && v.dir === m[2]);
    return hit ? { ok: true, note: 'matched' } : { ok: false, note: `wanted ${expect}, saw ${moves.map((v) => v.color + ':' + v.dir).join(',') || (changed ? 'non-move change' : 'no-op')}` };
  }
  return { ok: false, note: `unknown expectation "${expect}"` };
}

// A parsed action is only legal if the game offers it this turn.
export function validateAction(action, availableActions) {
  const n = Number(action.name.slice(6));
  const avail = (availableActions || []).map(Number);
  if (!avail.includes(n)) {
    return { ok: false, error: `ACTION${n} is not available this turn (available: ${avail.join(', ') || 'none'})` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// TurnWindow — bounded sliding window of (user, assistant) PAIRS with perfect
// parity. Too much history causes orientation blindness; broken parity throws
// 400s on strict providers. Pairs only ever enter together.
// ---------------------------------------------------------------------------
export class TurnWindow {
  constructor(maxPairs = 5) {
    this.maxPairs = maxPairs;
    this.pairs = [];
  }
  push(userText, assistantText) {
    this.pairs.push({ user: userText, assistant: assistantText });
    while (this.pairs.length > this.maxPairs) this.pairs.shift();
  }
  // Messages for the NEXT call: prior pairs then the new user turn.
  messages(newUserText) {
    const out = [];
    for (const p of this.pairs) {
      out.push({ role: 'user', content: p.user });
      out.push({ role: 'assistant', content: p.assistant });
    }
    out.push({ role: 'user', content: newUserText });
    return out;
  }
}

