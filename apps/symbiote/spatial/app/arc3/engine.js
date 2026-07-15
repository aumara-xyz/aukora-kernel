// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
//
// AGI · ARC 3 — Auma's general reasoning engine.
//
// A blind agent for interactive grid worlds (ARC-AGI-3 shaped): 64×64 frames of
// 4-bit color, actions ACTION1..ACTION5 (simple) + ACTION6 (click x,y). The
// engine carries ZERO per-game knowledge. Everything it believes it must earn
// from observed deltas, and every belief carries an evidence grade.
//
// The loop (each turn): SENSE → ORIENT → HYPOTHESIZE → ACT → VERIFY.
//   SENSE        frame → percept: connected color regions, diffs vs last frame.
//   ORIENT       find "self" (the region that moves when I act), learn what
//                each action does (direction vectors, change magnitudes).
//   HYPOTHESIZE  a ledger of candidate mechanics with confidence + grade —
//                the canonical-extraction law: no observed delta, no lesson.
//   ACT          novelty-guided exploration over the learned state graph,
//                goal-seeking when a self + goal candidate exist, click
//                saliency over segmented regions when clicking is on the menu.
//   VERIFY       a receipt per action: frame hash before/after, noop flag,
//                levels_completed, novelty. Receipts are the ONLY substrate
//                the UI and the meta-mind read — enthusiasm is a bug.
//
// Pure module: no DOM, no fetch, no timers. Drivers (the organ UI, the mock
// arcade, bun tests) own I/O and pacing. Deterministic under an injected rng.

// ---------------------------------------------------------------------------
// Evidence grades — shared language with docs/AUMA canon (canonical extraction §5).
//   di      directly inspected (this process watched the delta happen)
//   intu    internally consistent inference, not yet directly confirmed
//   moga    hypothetical / untested
// (padi/nevidi exist in the canon for multi-agent settings; a single local
//  reasoner only ever earns di, intu, moga.)
// ---------------------------------------------------------------------------

export const GRADES = ['di', 'intu', 'moga'];

export const SIMPLE_ACTIONS = [1, 2, 3, 4, 5];
export const CLICK_ACTION = 6;

// ---------------------------------------------------------------------------
// Frame primitives. Frames arrive as number[64][64] (values 0..15); we keep
// them as-is (row-major, frame[y][x]) and hash with FNV-1a for state identity.
// ---------------------------------------------------------------------------

export function lastGrid(frames) {
  // FrameResponse.frame is a LIST of 64×64 grids (animations); the settled
  // world is the last one.
  if (!Array.isArray(frames) || frames.length === 0) return null;
  const g = frames[frames.length - 1];
  return Array.isArray(g) && Array.isArray(g[0]) ? g : null;
}

export function frameHash(grid) {
  let h = 0x811c9dc5;
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    for (let x = 0; x < row.length; x++) {
      h ^= row[x] & 0xff;
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function diffFrames(a, b) {
  // → { changed, cells: [{x,y,from,to}] (capped), box } — the observable delta.
  if (!a || !b) return { changed: 0, cells: [], box: null };
  let changed = 0;
  const cells = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let y = 0; y < b.length; y++) {
    const ra = a[y], rb = b[y];
    if (!ra) continue;
    for (let x = 0; x < rb.length; x++) {
      if (ra[x] !== rb[x]) {
        changed++;
        if (cells.length < 512) cells.push({ x, y, from: ra[x], to: rb[x] });
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  return { changed, cells, box: changed ? { x0: minX, y0: minY, x1: maxX, y1: maxY } : null };
}

// Connected color regions (4-neighbour). Background = the most common color.
// Returns regions sorted large→small: { color, size, box, cx, cy }.
export function segment(grid, maxRegions = 96) {
  if (!grid) return { background: 0, regions: [] };
  const H = grid.length, W = grid[0].length;
  const counts = new Array(16).fill(0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) counts[grid[y][x]]++;
  let background = 0;
  for (let c = 1; c < 16; c++) if (counts[c] > counts[background]) background = c;

  const seen = new Uint8Array(W * H);
  const regions = [];
  const qx = new Int16Array(W * H), qy = new Int16Array(W * H);
  for (let sy = 0; sy < H; sy++) {
    for (let sx = 0; sx < W; sx++) {
      const c = grid[sy][sx];
      if (c === background || seen[sy * W + sx]) continue;
      // BFS flood
      let head = 0, tail = 0;
      qx[tail] = sx; qy[tail] = sy; tail++;
      seen[sy * W + sx] = 1;
      let size = 0, sumX = 0, sumY = 0;
      let minX = sx, maxX = sx, minY = sy, maxY = sy;
      while (head < tail) {
        const x = qx[head], y = qy[head]; head++;
        size++; sumX += x; sumY += y;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (x > 0 && !seen[y * W + x - 1] && grid[y][x - 1] === c) { seen[y * W + x - 1] = 1; qx[tail] = x - 1; qy[tail] = y; tail++; }
        if (x < W - 1 && !seen[y * W + x + 1] && grid[y][x + 1] === c) { seen[y * W + x + 1] = 1; qx[tail] = x + 1; qy[tail] = y; tail++; }
        if (y > 0 && !seen[(y - 1) * W + x] && grid[y - 1][x] === c) { seen[(y - 1) * W + x] = 1; qx[tail] = x; qy[tail] = y - 1; tail++; }
        if (y < H - 1 && !seen[(y + 1) * W + x] && grid[y + 1][x] === c) { seen[(y + 1) * W + x] = 1; qx[tail] = x; qy[tail] = y + 1; tail++; }
      }
      regions.push({
        color: c, size,
        box: { x0: minX, y0: minY, x1: maxX, y1: maxY },
        cx: sumX / size, cy: sumY / size,
      });
    }
  }
  regions.sort((a, b) => b.size - a.size);
  return { background, regions: regions.slice(0, maxRegions) };
}

// Centroid of every cell of one color — cheap "where is this thing" probe.
export function colorCentroid(grid, color) {
  let n = 0, sx = 0, sy = 0;
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    for (let x = 0; x < row.length; x++) {
      if (row[x] === color) { n++; sx += x; sy += y; }
    }
  }
  return n ? { x: sx / n, y: sy / n, n } : null;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// The Reasoner — one mind per game session. Drivers call decide() → act in the
// world → observe() with the result. All learning lives here.
// ---------------------------------------------------------------------------

const CAL_ROUNDS = 2;              // times each simple action is probed in calibration
const STAGNATION_WINDOW = 24;      // actions without a novel state before strategy rotation
const CLICK_MEMORY = 160;          // remembered click outcomes
const MOVE_TOL = 0.35;             // min centroid displacement (cells) to call it movement
// Chrome detection must not swallow the player: a walking body flips any one
// cell only on enter/leave, while a HUD counter flips its cells on nearly
// EVERY action for the whole run. High threshold + slow rate = only the
// relentless flickerers qualify (~a dozen consecutive changes).
const CHROME_T = 0.85;             // change-EWMA above this = HUD chrome, not world
const CHROME_ALPHA = 0.15;         // EWMA rate for the chrome mask

export class Reasoner {
  constructor(opts = {}) {
    this.rng = opts.rng || mulberry32(opts.seed ?? 0xa03a);
    this.meta = opts.meta || null;             // MetaMind priors (optional, advisory)
    this.actions = [];                          // available simple action ids
    this.canClick = false;

    this.step = 0;
    this.level = 0;
    this.phase = 'calibrate';                   // calibrate → explore → seek
    this.calQueue = [];                         // pending calibration probes
    this.effects = new Map();                   // actionId → { tried, noops, moved:{dx,dy,n}, avgChange }
    this.selfColor = null;                      // the color region that answers to me
    this.dirMap = new Map();                    // actionId → {dx,dy} unit-ish vector
    this.graph = new Map();                     // frameHash → { out: Map(actionKey → hash), seen }
    this.curHash = null;
    this.lastNovelStep = 0;
    this.clickTried = [];                       // [{x,y,changed}] recent click outcomes
    this.hypotheses = [];                       // [{id,text,confidence,grade}]
    this.receipts = [];                         // per-action receipts (driver may drain)
    // Chrome mask: real games carry HUD cells (step counters, score bars) that
    // change on EVERY action. Left unmasked they poison everything — no noop
    // is ever seen, every state hashes "novel", walls are never learned. Each
    // cell keeps an EWMA of "did you change this action"; cells above CHROME_T
    // are chrome and are excluded from state identity and noop judgment.
    this.cellChange = new Float32Array(64 * 64);
    this.chromeCells = 0;
    this.strategy = 'survey';                   // survey | walk | click-sweep
    this.goal = null;                           // {x,y,color} candidate target
    this.lastDecision = null;
    this.plan = [];                             // queued actionIds for goal walks
    // Budget sense: some worlds sell moves, not time — a gauge drains every
    // action and an empty gauge ends the life. Three organs, three grades:
    //   drain-watch  a color whose cell-count shrinks step after step is a
    //                gauge, not world — mask it like chrome, read it as fuel (intu)
    //   death-ledger a watched GAME_OVER fixes moves-per-life exactly (di)
    //   commit mode  when the budget is tight, stop paying for curiosity
    this.stepsThisLife = 0;
    this.lifeLengths = [];                      // completed life spans, in actions
    this.movesPerLife = null;                   // di — set only by a watched death
    // The ONE allowed prior (owner's rule): guess 1=up 2=down 3=left 4=right,
    // grade moga, and RE-TEST IT EVERY GAME. It never routes anything — lived
    // displacement is the only routing evidence — it only breaks ties when
    // exploring toward a believed goal before calibration has finished.
    this.dirPrior = new Map([
      [1, { dx: 0, dy: -1 }], [2, { dx: 0, dy: 1 }],
      [3, { dx: -1, dy: 0 }], [4, { dx: 1, dy: 0 }],
    ]);
    this._planRetry = false;                    // one re-press before a plan dies (turn-then-step worlds)
    this._recal = false;                        // second calibration pass (double presses) fired?
    this._lastSimple = null;                    // last simple action pressed…
    this._lastSimpleNoop = false;               // …and whether it nooped (turn-vs-wall discrimination)
    this.goalBans = new Set();                  // goal identities proven to be paintings, not places
    this._goalTrack = null;                     // {key, bestDist, spent} — progress meter for the active goal
    this.carriedColor = null;                   // cargo: a color that moves WITH me
    this._attachVotes = new Map();              // color → consecutive moved-with-me count
    this.fuelColor = null;                      // the gauge's color, once caught
    this.fuelMask = new Uint8Array(64 * 64);    // cells the gauge has ever owned
    this.fuelRemaining = null;                  // intu estimate from the drain rate
    this.committing = false;
    this._drainStreaks = new Int16Array(16);
    this._drainTotals = new Float32Array(16);
    this._lastColorCounts = null;
  }

  // --- lifecycle -----------------------------------------------------------

  begin(obs) {
    // First observation after RESET: read the action menu, set up calibration.
    this.actions = (obs.availableActions || []).filter((a) => a >= 1 && a <= 5);
    this.canClick = (obs.availableActions || []).includes(CLICK_ACTION);
    this.curHash = this.worldHash(obs.grid);
    this.graph.set(this.curHash, { out: new Map(), seen: 1 });
    this.calQueue = [];
    for (let r = 0; r < CAL_ROUNDS; r++) for (const a of this.actions) this.calQueue.push(a);
    if (this.actions.length === 0 && this.canClick) this.phase = 'explore';
    else this.phase = 'calibrate';
    this._hypo('menu', `the world offers [${(obs.availableActions || []).join(', ')}] — reading the controls`, 0.9, 'di');
    if (this.actions.length >= 2) {
      this._hypo('dir-prior', 'until this world proves otherwise I guess 1=up 2=down 3=left 4=right — testing each', 0.3, 'moga');
    }
    if (this.meta) {
      const prior = this.meta.prior(obs.availableActions || []);
      if (prior) this._hypo('prior', `this smells like ${prior.mechanic} (seen ${prior.support}× before)`, prior.confidence, 'intu');
    }
  }

  // The driver watched a death and reset the world: same board, fresh life.
  // Everything earned survives — walls, directions, the goal, the budget.
  // Only the per-life meters restart.
  rebirth(obs) {
    this.stepsThisLife = 0;
    this.fuelRemaining = null;
    this._drainStreaks.fill(0);
    this._drainTotals.fill(0);
    this._lastColorCounts = null;
    this.plan = [];
    this.carriedColor = null;   // a fresh life starts empty-handed
    this._attachVotes.clear();
    this.curHash = this.worldHash(obs.grid);
    if (!this.graph.has(this.curHash)) this.graph.set(this.curHash, { out: new Map(), seen: 1 });
  }

  // Moves left this life: a watched death outranks a gauge read; either beats nothing.
  budgetRemaining() {
    if (this.movesPerLife != null) return Math.max(0, this.movesPerLife - this.stepsThisLife);
    if (this.fuelRemaining != null) return this.fuelRemaining;
    return null;
  }

  // --- decisions -----------------------------------------------------------

  decide(obs) {
    this.step++;
    let d;
    if (this.phase === 'calibrate' && this.calQueue.length > 0) d = this._decideCalibrate();
    else d = this._decideMain(obs);
    this.lastDecision = d;
    return d;
  }

  _decideCalibrate() {
    const actionId = this.calQueue.shift();
    if (this.calQueue.length === 0) this.phase = 'explore';
    return {
      kind: 'simple', actionId,
      reason: `trying ACTION${actionId} to learn what it does`,
      tag: 'calibrate',
    };
  }

  _decideMain(obs) {
    // Budget sense: with a known small budget the WHOLE life is tight; with
    // only a gauge read, tight begins when the needle nears empty. Committing
    // means curiosity stops being free — no strategy rotation, no long
    // frontier walks, no coin-flip clicks. Goal first, always.
    const remaining = this.budgetRemaining();
    const wasCommitting = this.committing;
    this.committing = (this.movesPerLife != null && this.movesPerLife <= 48)
      || (remaining != null && remaining <= 14);
    if (this.committing && !wasCommitting) {
      this._hypo('budget-mode', `the budget is tight (~${remaining ?? this.movesPerLife} moves) — spending every move on the goal now`,
        0.8, this.movesPerLife != null ? 'di' : 'intu');
    }

    // Turn-then-step suspicion: if EVERY control came back a noop through the
    // whole first calibration, the world may rotate on the first press and
    // step on the second. Re-probe each action twice in a row — round-robin
    // probing can never catch that mechanic.
    if (!this._recal && this.actions.length >= 2) {
      const eff = this.actions.map((a) => this.effects.get(a));
      if (eff.every((e) => e && e.tried >= CAL_ROUNDS && e.noops === e.tried)) {
        this._recal = true;
        for (const a of this.actions) this.calQueue.push(a, a);
        this.phase = 'calibrate';
        this._hypo('recal', 'every control looked dead — maybe this world turns before it steps; pressing each twice', 0.6, 'intu');
        return this._decideCalibrate();
      }
    }

    // Stagnation check: if nothing new for a while, rotate strategy.
    if (!this.committing && this.step - this.lastNovelStep > STAGNATION_WINDOW) {
      this.lastNovelStep = this.step; // reset the meter so we rotate once, not every turn
      this.plan = [];
      this.strategy = this._nextStrategy();
      this._hypo('rotate', `no new states in ${STAGNATION_WINDOW} moves — switching to ${this.strategy}`, 0.6, 'di');
    }

    // A queued plan (goal walk or frontier escape) continues unless the world
    // contradicted it (observe() clears the plan on any noop step).
    if (this.plan.length > 0) {
      const step = this.plan.shift();
      if (step.kind === 'click') {
        return { kind: 'click', x: step.x, y: step.y, reason: 'replaying a click on my path to unexplored ground', tag: 'plan' };
      }
      return { kind: 'simple', actionId: step.actionId, reason: this._dirReason(step.actionId, step.why || 'following my path'), tag: 'plan' };
    }

    // Goal seeking: self + direction map + a goal candidate → walk toward it.
    // Wanting OUTRANKS wandering: this runs before the pocket escape, because
    // in a small looping room the escape fires every turn and the goal is
    // never even attempted. Bad wants can't trap us anymore — the painting
    // ban kills any goal that never gets closer.
    if (this.selfColor != null && this.dirMap.size >= 2) {
      const goal = this._pickGoal(obs);
      if (goal) {
        this.goal = goal;
        // Model-based first: if I know which colors stop me, I can read the
        // whole route off the frame in one look — plan it end to end.
        const route = this._gridPlan(obs, goal);
        if (route && route.length) {
          this.plan = route.slice(1);
          const wallList = [...this._blockers()].map((c) => `color-${c}`).join(', ');
          return {
            kind: 'simple', actionId: route[0].actionId,
            reason: `I can see a ${route.length}-step route to the ${goal.why}, around the ${wallList || 'open'} walls`,
            tag: 'route',
          };
        }
        // No route through the believed walls. If I can click, the small odd
        // piece of "wall" is the prime suspect — walls do not come in
        // door-sized pieces for no reason.
        if (this.canClick && this._blockers().size) {
          const door = this._pickDoor(obs);
          if (door) {
            return {
              kind: 'click', x: door.x, y: door.y,
              reason: `the way to the ${goal.why} is shut — that ${door.size}-cell piece of wall looks like a door, clicking it`,
              tag: 'door',
            };
          }
        }
        const step = this._stepToward(obs, goal);
        if (step != null) {
          return {
            kind: 'simple', actionId: step,
            reason: this._dirReason(step, `moving toward the ${goal.why} at (${Math.round(goal.x)},${Math.round(goal.y)})`),
            tag: 'seek',
          };
        }
      }
    }

    // Pocket escape (fallback, after wanting): if I keep landing on this same
    // state with nothing to want, greedy walking is circling. Plan a path
    // THROUGH THE LEARNED GRAPH to the nearest state with an untried action —
    // exploration with a map, not a coin. (Skipped when committing: a
    // frontier walk is a luxury the budget can't buy.)
    const here = this.graph.get(this.curHash);
    if (!this.committing && here && here.seen > 3) {
      const path = this._pathToFrontier();
      if (path && path.length) {
        this.plan = path.slice(1);
        const first = path[0];
        this._hypo('escape', `I am circling ${here.seen} visits deep — walking my own map to unexplored ground (${path.length} steps)`, 0.7, 'di');
        if (first.kind === 'click') return { kind: 'click', x: first.x, y: first.y, reason: 'walking my map toward unexplored ground', tag: 'escape' };
        return { kind: 'simple', actionId: first.actionId, reason: this._dirReason(first.actionId, 'walking my map toward unexplored ground'), tag: 'escape' };
      }
    }

    // Click saliency, when clicking is available and either it's a click world
    // or the walk is stuck.
    if (this.canClick && (this.actions.length === 0 || this.strategy === 'click-sweep' || (!this.committing && this.rng() < 0.25))) {
      const target = this._pickClick(obs);
      if (target) {
        return {
          kind: 'click', x: target.x, y: target.y,
          reason: `clicking ${target.why} at (${target.x},${target.y})`,
          tag: 'click',
        };
      }
    }

    // Frontier exploration: prefer actions never tried from THIS state, then
    // actions not known to be a wall here (self-loop edges), then anything.
    if (this.actions.length > 0) {
      const node = this.graph.get(this.curHash);
      const untried = this.actions.filter((a) => !node || !node.out.has(String(a)));
      const fresh = this.actions.filter((a) => !node || node.out.get(String(a)) !== this.curHash);
      const productive = fresh.filter((a) => {
        const e = this.effects.get(a);
        return !e || e.tried === 0 || e.noops / e.tried < 0.8;
      });
      const pool = untried.length ? untried : (productive.length ? productive : (fresh.length ? fresh : this.actions));
      // Owner's prior as a TIEBREAK only: before lived vectors exist, prefer
      // the untried action whose guessed direction points at the goal.
      let actionId;
      if (this.goal && this.dirMap.size < 2) {
        const self = this.selfColor != null ? colorCentroid(obs.grid, this.selfColor) : null;
        if (self) {
          const dx = this.goal.x - self.x, dy = this.goal.y - self.y;
          const scored = pool.map((a) => {
            const p = this.dirPrior.get(a);
            return { a, s: p ? p.dx * dx + p.dy * dy : -Infinity };
          }).sort((q, w) => w.s - q.s);
          if (scored[0] && scored[0].s > 0) actionId = scored[0].a;
        }
      }
      if (actionId == null) actionId = pool[Math.floor(this.rng() * pool.length)];
      // In a confirmed turn-then-step world, a single press proves nothing —
      // every probe is a press-pair from here on.
      if (this._recal) this.plan.push({ kind: 'simple', actionId, why: 'the follow-through press — this world steps on the second touch' });
      const why = untried.length ? 'an action I have not tried from here' : 'an action that usually changes something';
      return { kind: 'simple', actionId, reason: `exploring — ${why} (ACTION${actionId})`, tag: 'explore' };
    }

    // Click-only world with no salient target left: grid sweep with jitter.
    const gx = 4 + Math.floor(this.rng() * 8) * 8;
    const gy = 4 + Math.floor(this.rng() * 8) * 8;
    return { kind: 'click', x: gx, y: gy, reason: `sweeping — clicking (${gx},${gy}) to see what answers`, tag: 'sweep' };
  }

  _nextStrategy() {
    const order = this.canClick && this.actions.length > 0
      ? ['walk', 'click-sweep', 'survey']
      : this.canClick ? ['click-sweep', 'survey'] : ['walk', 'survey'];
    const i = order.indexOf(this.strategy);
    return order[(i + 1) % order.length];
  }

  _dirReason(actionId, base) {
    const v = this.dirMap.get(actionId);
    if (!v) return `${base} (ACTION${actionId})`;
    const name = Math.abs(v.dx) > Math.abs(v.dy) ? (v.dx > 0 ? 'right' : 'left') : (v.dy > 0 ? 'down' : 'up');
    return `${base} — ACTION${actionId} is my ${name}`;
  }

  // Colors with repeated stop-evidence — believed walls. A color my body has
  // ever successfully covered is exonerated for good: floors collect stray
  // votes at partial bumps, but lived traversal outranks suspicion.
  _blockers() {
    const out = new Set();
    if (this.blockerVotes) {
      for (const [c, v] of this.blockerVotes) {
        if (v >= 2 && !(this.passableColors && this.passableColors.has(c))) out.add(c);
      }
    }
    return out;
  }

  // Model-based route: BFS over the PIXEL GRID, footprint = my own body's
  // bounding box, step = each action's observed average displacement, walls =
  // colors that have stopped me before. Pure lived physics — nothing assumed.
  _gridPlan(obs, goal, maxNodes = 5000) {
    const blockers = this._blockers();
    if (!blockers.size || !goal.box) return null;
    const grid = obs.grid;
    const Hh = grid.length, Ww = grid[0].length;
    // My body's bbox.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let y = 0; y < Hh; y++) for (let x = 0; x < Ww; x++) if (grid[y][x] === this.selfColor) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x0 > x1) return null;
    const fw = x1 - x0 + 1, fh = y1 - y0 + 1;
    if (fw > 16 || fh > 16) return null; // that's no body, that's scenery
    // Per-action integer step vectors from lived displacement.
    const moves = [];
    for (const [aid] of this.dirMap) {
      const e = this.effects.get(aid);
      if (!e || e.moved.n === 0) continue;
      const dx = Math.round(e.moved.dx / e.moved.n), dy = Math.round(e.moved.dy / e.moved.n);
      if (dx === 0 && dy === 0) continue;
      moves.push({ aid, dx, dy });
    }
    if (moves.length < 2) return null;
    const passable = (px, py) => {
      if (px < 0 || py < 0 || px + fw > Ww || py + fh > Hh) return false;
      for (let y = py; y < py + fh; y++) for (let x = px; x < px + fw; x++) {
        if (blockers.has(grid[y][x])) return false;
      }
      return true;
    };
    const g = goal.box;
    const reached = (px, py) => px <= g.x1 && px + fw - 1 >= g.x0 && py <= g.y1 && py + fh - 1 >= g.y0;
    const startKey = `${x0},${y0}`;
    const prev = new Map([[startKey, null]]);
    const queue = [{ x: x0, y: y0 }];
    let hit = null;
    while (queue.length && prev.size < maxNodes) {
      const { x, y } = queue.shift();
      if (reached(x, y)) { hit = `${x},${y}`; break; }
      for (const m of moves) {
        const nx = x + m.dx, ny = y + m.dy, k = `${nx},${ny}`;
        if (prev.has(k) || !passable(nx, ny)) continue;
        prev.set(k, { from: `${x},${y}`, aid: m.aid });
        queue.push({ x: nx, y: ny });
      }
    }
    if (!hit) return null;
    const path = [];
    for (let k = hit; k !== startKey;) {
      const link = prev.get(k);
      if (!link) return null;
      path.unshift({ kind: 'simple', actionId: link.aid, why: 'walking the route I read off the board' });
      k = link.from;
    }
    return path.length ? path.slice(0, 64) : null;
  }

  // The smallest blocker-colored region not yet clicked from this state —
  // the "that bit of wall is probably a door" instinct.
  _pickDoor(obs) {
    const seg = obs.segments || segment(obs.grid);
    const blockers = this._blockers();
    const node = this.graph.get(this.curHash);
    let best = null;
    for (const r of seg.regions) {
      if (!blockers.has(r.color)) continue;
      if (r.size > 160) continue; // that is just wall
      const x = Math.round(r.cx), y = Math.round(r.cy);
      if (node && node.out.has(`6@${x},${y}`)) continue;
      if (!best || r.size < best.size) best = { x, y, size: r.size };
    }
    return best;
  }

  _goalKey(r) {
    return `${r.color}@${Math.round(r.cx / 4)},${Math.round(r.cy / 4)}`;
  }

  // Cells I could walk to through everything not yet proven a wall — a cheap
  // flood from my own body. Regions outside this set are scenery until the
  // walls are disproven.
  _reachableMask(grid) {
    const H = grid.length, W = grid[0].length;
    const blockers = this._blockers();
    const mask = new Uint8Array(W * H);
    const qx = new Int16Array(W * H), qy = new Int16Array(W * H);
    let tail = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (grid[y][x] === this.selfColor) { mask[y * W + x] = 1; qx[tail] = x; qy[tail] = y; tail++; }
    }
    for (let head = 0; head < tail; head++) {
      const x = qx[head], y = qy[head];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const i = ny * W + nx;
        if (mask[i] || blockers.has(grid[ny][nx]) || this.fuelMask[i]) continue;
        mask[i] = 1; qx[tail] = nx; qy[tail] = ny; tail++;
      }
    }
    return mask;
  }

  // Goal = a small, uniquely-colored region that is not me and not background.
  // Reachable places outrank pretty pictures; banned paintings are skipped.
  _pickGoal(obs) {
    const seg = obs.segments || segment(obs.grid);
    const colorCount = new Map();
    for (const r of seg.regions) colorCount.set(r.color, (colorCount.get(r.color) || 0) + 1);
    const self = colorCentroid(obs.grid, this.selfColor);
    if (!self) return null;
    const reach = this._blockers().size ? this._reachableMask(obs.grid) : null;
    let best = null, bestScore = -Infinity;
    for (const r of seg.regions) {
      if (r.color === this.selfColor) continue;
      if (r.size > 220) continue;                        // walls / chrome
      if (r.color === this.fuelColor) continue;          // never chase the dashboard
      const ci = Math.round(r.cy) * 64 + Math.round(r.cx);
      if (this.fuelMask[ci] || this.cellChange[ci] > CHROME_T) continue; // it lives on the HUD, not in the world
      if (this.goalBans.has(this._goalKey(r))) continue; // a proven painting
      const unique = colorCount.get(r.color) === 1 ? 1 : 0;
      const dist = Math.hypot(r.cx - self.x, r.cy - self.y);
      if (dist < 1.5) continue;
      // What I carry names my want: a far-away sibling of the cargo color is
      // the delivery target, and it outranks everything — even reachability
      // caution, since deliveries often mean walking INTO boxes.
      const cargoKin = this.carriedColor != null && r.color === this.carriedColor && dist > 6 ? 1 : 0;
      // A goal I can flood-walk to is worth far more than a prettier one
      // sealed behind proven walls (legend boxes, decorations, HUD art).
      const reachable = reach ? (reach[ci] ? 1 : 0) : 1;
      // Near beats far: a want must survive being approached (the old
      // farther-is-better term made her orbit between two candidates forever).
      const score = cargoKin * 14 + reachable * 8 + unique * 6 - Math.min(dist, 40) / 20 - Math.abs(r.size - 9) / 20;
      if (score > bestScore) {
        bestScore = score;
        best = {
          x: r.cx, y: r.cy, box: r.box, color: r.color,
          why: cargoKin ? `sibling of the color-${r.color} piece I carry — where it belongs`
            : (unique ? 'one-of-a-kind island' : 'distinct region'),
        };
      }
    }
    return best;
  }

  // One step toward the goal along the learned direction map; queues a short
  // plan so the walk has commitment (re-planned whenever observe() sees walls).
  // Directions already known to be a wall FROM THIS EXACT STATE (a self-loop
  // edge in the learned graph) are excluded — the graph is the memory of walls.
  _stepToward(obs, goal) {
    const self = colorCentroid(obs.grid, this.selfColor);
    if (!self) return null;
    const node = this.graph.get(this.curHash);
    const dx = goal.x - self.x, dy = goal.y - self.y;
    const choices = [];
    for (const [aid, v] of this.dirMap) {
      // A self-loop edge normally means "wall here" — but in a turn-then-step
      // world every first press loops, so the graph cannot damn a direction.
      if (!this._recal && node && node.out.get(String(aid)) === this.curHash) continue; // known wall here
      const align = v.dx * dx + v.dy * dy; // projection onto the need vector
      if (align > 0.1) choices.push({ aid: Number(aid), align });
    }
    if (!choices.length) return null;
    choices.sort((a, b) => b.align - a.align);
    const first = choices[0].aid;
    // Commit to up to 3 repeats of the dominant direction — receipts will
    // cancel the plan the moment a step turns out to be a noop (wall).
    const repeats = Math.min(3, Math.max(1, Math.round(Math.max(Math.abs(dx), Math.abs(dy)) / 4)));
    for (let i = 1; i < repeats; i++) this.plan.push({ kind: 'simple', actionId: first, why: 'holding my heading toward the goal' });
    return first;
  }

  // BFS across the learned state graph to the nearest node that still has an
  // untried simple action. Deterministic worlds replay edge-for-edge; if the
  // world disagrees mid-plan, the noop rule clears the plan and we re-think.
  _pathToFrontier(maxNodes = 3000) {
    const start = this.curHash;
    const untriedAt = (h) => {
      const node = this.graph.get(h);
      if (!node) return null;
      const u = this.actions.filter((a) => !node.out.has(String(a)));
      return u.length ? u[Math.floor(this.rng() * u.length)] : null;
    };
    // If unexplored ground is right under my feet, no walk needed.
    const hereUntried = untriedAt(start);
    if (hereUntried != null) return [{ kind: 'simple', actionId: hereUntried }];

    const prev = new Map([[start, null]]); // hash → {from, edgeKey}
    const depth = new Map([[start, 0]]);
    const queue = [start];
    const candidates = [];
    while (queue.length && prev.size < maxNodes) {
      const h = queue.shift();
      const node = this.graph.get(h);
      if (!node) continue;
      if (h !== start && untriedAt(h) != null) {
        candidates.push(h);
        if (candidates.length >= 24) break; // enough options to choose among
      }
      for (const [edgeKey, to] of node.out) {
        if (to === h || prev.has(to)) continue;
        prev.set(to, { from: h, edgeKey });
        depth.set(to, (depth.get(h) || 0) + 1);
        queue.push(to);
      }
    }
    if (!candidates.length) return null;
    // Goal-biased choice: prefer frontier states standing closer to the goal
    // (when a goal is believed), tie-broken by path length.
    let found = candidates[0], bestCost = Infinity;
    for (const h of candidates) {
      const node = this.graph.get(h);
      const d = depth.get(h) || 0;
      let cost = d;
      if (this.goal && node && node.pos) cost = d * 0.5 + Math.hypot(node.pos.x - this.goal.x, node.pos.y - this.goal.y);
      if (cost < bestCost) { bestCost = cost; found = h; }
    }
    const path = [];
    for (let h = found; h !== start;) {
      const link = prev.get(h);
      if (!link) return null;
      path.unshift(this._edgeKeyToStep(link.edgeKey));
      h = link.from;
    }
    // The whole point of the walk: FIRE the untried action on arrival.
    path.push({ kind: 'simple', actionId: untriedAt(found) });
    // Cap: long replays drift in animated worlds; take the first stretch.
    return path.slice(0, 14);
  }

  _edgeKeyToStep(edgeKey) {
    if (edgeKey.startsWith('6@')) {
      const [x, y] = edgeKey.slice(2).split(',').map(Number);
      return { kind: 'click', x, y };
    }
    return { kind: 'simple', actionId: Number(edgeKey) };
  }

  // Tile-lattice reader: many click worlds arrange a dominant family of
  // same-sized tiles into BLOCKS on a lattice (think: several small grids on
  // one board). Cluster the family's centers into lattice rows/columns, split
  // where the spacing jumps, and read each block as a small color matrix
  // (missing slots — often markers sitting in a tile's place — read null).
  // Pure geometry from the current frame; no game knowledge.
  _tileBlocks(seg) {
    const regs = seg.regions.filter((r) => r.size >= 9 && r.size <= 256);
    if (regs.length < 8) return null;
    // dominant size family (by sqrt bucket)
    const bySide = new Map();
    for (const r of regs) {
      const k = Math.round(Math.sqrt(r.size));
      if (!bySide.has(k)) bySide.set(k, []);
      bySide.get(k).push(r);
    }
    let fam = null;
    for (const arr of bySide.values()) if (!fam || arr.length > fam.length) fam = arr;
    if (!fam || fam.length < 8) return null;
    const side = Math.sqrt(fam[0].size);
    // 1-D lattice clustering with block splits where the gap jumps
    const axes = (vals) => {
      const s = [...vals].sort((a, b) => a - b);
      const centers = [];
      let group = [s[0]];
      for (let i = 1; i < s.length; i++) {
        if (s[i] - s[i - 1] > side * 0.7) { centers.push(group.reduce((a, b) => a + b, 0) / group.length); group = []; }
        group.push(s[i]);
      }
      centers.push(group.reduce((a, b) => a + b, 0) / group.length);
      return centers;
    };
    const xs = axes(fam.map((r) => r.cx));
    const ys = axes(fam.map((r) => r.cy));
    if (xs.length < 2 || ys.length < 2) return null;
    // split lattice lines into block groups where spacing jumps
    const split = (lines) => {
      const gaps = lines.slice(1).map((v, i) => v - lines[i]);
      const modal = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
      const groups = [[0]];
      for (let i = 1; i < lines.length; i++) {
        if (lines[i] - lines[i - 1] > modal * 1.7) groups.push([]);
        groups[groups.length - 1].push(i);
      }
      return groups;
    };
    const colGroups = split(xs), rowGroups = split(ys);
    if (colGroups.length * rowGroups.length < 2) return null;
    const nearest = (lines, v) => {
      let best = 0;
      for (let i = 1; i < lines.length; i++) if (Math.abs(lines[i] - v) < Math.abs(lines[best] - v)) best = i;
      return Math.abs(lines[best] - v) <= side * 0.7 ? best : -1;
    };
    const blocks = [];
    for (let bg = 0; bg < rowGroups.length; bg++) {
      for (let cg = 0; cg < colGroups.length; cg++) {
        const rowsIx = rowGroups[bg], colsIx = colGroups[cg];
        const cells = Array.from({ length: rowsIx.length }, () => new Array(colsIx.length).fill(null));
        const centers = Array.from({ length: rowsIx.length }, () => new Array(colsIx.length).fill(null));
        for (let rr = 0; rr < rowsIx.length; rr++) {
          for (let cc = 0; cc < colsIx.length; cc++) {
            centers[rr][cc] = { x: Math.round(xs[colsIx[cc]]), y: Math.round(ys[rowsIx[rr]]) };
          }
        }
        blocks.push({
          rows: rowsIx.length, cols: colsIx.length, cells, centers,
          // tile extents: half a side past the outer centers (+1 forgiveness)
          bbox: {
            x0: xs[colsIx[0]] - side / 2 - 1, x1: xs[colsIx[colsIx.length - 1]] + side / 2 + 1,
            y0: ys[rowsIx[0]] - side / 2 - 1, y1: ys[rowsIx[rowsIx.length - 1]] + side / 2 + 1,
          },
        });
      }
    }
    // fill each block's color matrix from the family tiles
    for (const t of fam) {
      for (const b of blocks) {
        if (t.cx < b.bbox.x0 || t.cx > b.bbox.x1 || t.cy < b.bbox.y0 || t.cy > b.bbox.y1) continue;
        const ci = nearest(b.centers[0].map((c) => c.x), t.cx);
        const riLines = b.centers.map((row) => row[0].y);
        const ri = nearest(riLines, t.cy);
        if (ri >= 0 && ci >= 0) b.cells[ri][ci] = t.color;
        break;
      }
    }
    return { blocks, family: fam, side };
  }

  // Harmonize: when one block of the lattice is WRAPPED by a foreign region
  // (a frame — the board's own way of saying "this one"), and its pattern
  // disagrees with its most-similar sibling, the disagreeing cells are the
  // most promising clicks on the board. "Make the marked one agree with its
  // family" — earned generality: if the guess is wrong, the click is still a
  // probe of the board's one distinguished object.
  _harmonize(seg, obs) {
    const tb = this._tileBlocks(seg);
    if (!tb || tb.blocks.length < 2) return null;
    const framed = tb.blocks.find((b) =>
      seg.regions.some((r) =>
        !tb.family.includes(r) && r.size >= 40 &&
        r.box.x0 <= b.bbox.x0 && r.box.x1 >= b.bbox.x1 &&
        r.box.y0 <= b.bbox.y0 && r.box.y1 >= b.bbox.y1));
    if (!framed) return null;
    let ref = null, refScore = -1;
    for (const b of tb.blocks) {
      if (b === framed || b.rows !== framed.rows || b.cols !== framed.cols) continue;
      let score = 0;
      for (let rr = 0; rr < b.rows; rr++) for (let cc = 0; cc < b.cols; cc++) {
        if (b.cells[rr][cc] != null && framed.cells[rr][cc] != null && b.cells[rr][cc] === framed.cells[rr][cc]) score++;
      }
      if (score > refScore) { refScore = score; ref = b; }
    }
    if (!ref) return null;
    const node = this.graph.get(this.curHash);
    for (let rr = 0; rr < framed.rows; rr++) {
      for (let cc = 0; cc < framed.cols; cc++) {
        if (framed.cells[rr][cc] == null || ref.cells[rr][cc] == null) continue;
        if (framed.cells[rr][cc] === ref.cells[rr][cc]) continue;
        const { x, y } = framed.centers[rr][cc];
        if (node && node.out.has(`6@${x},${y}`)) continue; // tried from this state
        return { x, y, why: `making the framed block agree with its closest twin — cell (${rr},${cc}) wears the wrong color` };
      }
    }
    return null;
  }

  // Odd-one-out: ARC worlds love a family of look-alike pieces with exactly
  // one deviant — and the deviant is usually the mechanism. A region is odd
  // when enough same-sized peers exist and every peer but it shares a color.
  // Stateless read of the current segmentation; no game knowledge, just
  // "one of these things is not like the others".
  _oddOneOut(seg) {
    const out = new Map(); // region → peers count
    const regs = seg.regions.filter((r) => r.size >= 4 && r.size <= 300);
    for (const r of regs) {
      const peers = regs.filter((o) => o !== r && o.size >= r.size * 0.6 && o.size <= r.size * 1.6);
      if (peers.length < 3) continue;
      const sameColor = peers.filter((o) => o.color === r.color).length;
      const modal = new Map();
      for (const o of peers) modal.set(o.color, (modal.get(o.color) || 0) + 1);
      const [, modalCount] = [...modal.entries()].sort((a, b) => b[1] - a[1])[0];
      // odd = my color is unique in the family, and the family is otherwise uniform-ish
      if (sameColor === 0 && modalCount >= peers.length - 1) out.set(r, peers.length);
    }
    return out;
  }

  // Click saliency: the odd one out first, then small distinct regions, then
  // regions that changed recently, then unexplored board areas. Never hammer
  // a dead spot, and never repeat a click already tried from THIS EXACT STATE
  // (the graph remembers).
  _pickClick(obs) {
    const seg = obs.segments || segment(obs.grid);
    const node = this.graph.get(this.curHash);
    const dead = new Set(this.clickTried.filter((c) => c.changed === 0).map((c) => `${c.x},${c.y}`));
    // Strongest structural signal first: a framed block disagreeing with its
    // family — click the disagreement (unless that exact spot proved dead).
    const harm = this._harmonize(seg, obs);
    if (harm && !dead.has(`${harm.x},${harm.y}`)) return harm;
    const hot = this.clickTried.filter((c) => c.changed > 0);
    const odd = this._oddOneOut(seg);
    let best = null, bestScore = -Infinity;
    for (const r of seg.regions) {
      const x = Math.round(r.cx), y = Math.round(r.cy);
      if (dead.has(`${x},${y}`)) continue;
      if (node && node.out.has(`6@${x},${y}`)) continue; // been here, clicked that
      const tried = this.clickTried.some((c) => Math.abs(c.x - x) <= 1 && Math.abs(c.y - y) <= 1);
      const nearHot = hot.some((c) => Math.hypot(c.x - x, c.y - y) < 10) ? 1 : 0;
      const smallBonus = r.size <= 64 ? 3 : r.size <= 144 ? 1.5 : 0;
      const oddBonus = odd.has(r) ? 5 : 0;
      const score = oddBonus + smallBonus + nearHot * 1.2 + (tried ? -1 : 2) + this.rng() * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = {
          x, y,
          why: odd.has(r)
            ? `the odd one out — a color-${r.color} piece among ${odd.get(r)} look-alikes`
            : (tried ? 'a live region from a new angle' : `the ${r.size}-cell region I have not touched`),
        };
      }
    }
    if (best) return best;
    // Everything salient was tried from this state — take the least-worn live
    // region anyway (the world may be a sequence puzzle needing repeats).
    const live = this.clickTried.filter((c) => c.changed > 0);
    if (live.length) {
      const pick = live[Math.floor(this.rng() * live.length)];
      return { x: pick.x, y: pick.y, why: 'the region that answered before' };
    }
    return null;
  }

  // --- learning --------------------------------------------------------------

  // Drain-watch: a per-cell EWMA can never catch a fuel BAR — each bar cell
  // changes exactly once as the tip passes it. But the bar's COLOR bleeds
  // cells steadily, action after action. A color whose count shrinks by a
  // small amount for enough consecutive steps is a gauge: mask every cell it
  // has ever owned out of state identity (like chrome), and read the drain
  // rate as a fuel estimate. Bodies don't qualify (their count holds), walls
  // don't qualify (they don't shrink steadily), one-off explosions don't
  // qualify (streak resets).
  _watchDrain(prevGrid, nextGrid) {
    const counts = new Array(16).fill(0);
    for (let y = 0; y < nextGrid.length; y++) {
      const row = nextGrid[y];
      for (let x = 0; x < row.length; x++) counts[row[x]]++;
    }
    const prev = this._lastColorCounts;
    this._lastColorCounts = counts;
    if (!prev) return;
    for (let c = 0; c < 16; c++) {
      const drop = prev[c] - counts[c];
      if (prev[c] > 0 && counts[c] > 0 && counts[c] <= 128 && drop >= 1 && drop <= 4) {
        this._drainStreaks[c]++;
        this._drainTotals[c] += drop;
      } else {
        this._drainStreaks[c] = 0;
        this._drainTotals[c] = 0;
      }
      if (this.fuelColor == null && this._drainStreaks[c] >= 6) {
        this.fuelColor = c;
        this._hypo('fuel', `the color-${c} gauge bleeds every move I make — that is fuel, not world; I read it as my budget`, 0.7, 'intu');
      }
      if (this.fuelColor === c && this._drainStreaks[c] > 0) {
        const rate = this._drainTotals[c] / this._drainStreaks[c];
        this.fuelRemaining = Math.max(0, Math.round(counts[c] / Math.max(rate, 0.25)));
      }
    }
    // The gauge's territory joins the mask: every cell it holds now or held
    // a step ago. (Territory only grows — a refilled bar reclaims old cells.)
    if (this.fuelColor != null) {
      for (let y = 0; y < nextGrid.length; y++) {
        const rn = nextGrid[y], rp = prevGrid[y];
        for (let x = 0; x < rn.length; x++) {
          if (rn[x] === this.fuelColor || rp[x] === this.fuelColor) this.fuelMask[y * 64 + x] = 1;
        }
      }
    }
  }

  // Update the chrome mask from this action's raw diff, then return the
  // EFFECTIVE change count (world cells only) and the world hash (chrome
  // cells zeroed out of state identity).
  _updateChrome(prevGrid, nextGrid) {
    const H = nextGrid.length, W = nextGrid[0].length;
    let effective = 0;
    for (let y = 0; y < H; y++) {
      const rp = prevGrid[y], rn = nextGrid[y];
      for (let x = 0; x < W; x++) {
        const i = y * 64 + x;
        const changed = rp[x] !== rn[x] ? 1 : 0;
        this.cellChange[i] = this.cellChange[i] * (1 - CHROME_ALPHA) + changed * CHROME_ALPHA;
        if (changed && this.cellChange[i] <= CHROME_T && !this.fuelMask[i]) effective++;
      }
    }
    let chrome = 0;
    for (let i = 0; i < this.cellChange.length; i++) if (this.cellChange[i] > CHROME_T) chrome++;
    if (chrome >= 8 && this.chromeCells < 8) {
      this._hypo('chrome', `${chrome} cells flicker no matter what I do — that is the game's dashboard, not the world; I stop reading it as state`, 0.8, 'di');
    }
    this.chromeCells = chrome;
    return effective;
  }

  worldHash(grid) {
    let h = 0x811c9dc5;
    for (let y = 0; y < grid.length; y++) {
      const row = grid[y];
      for (let x = 0; x < row.length; x++) {
        const i = y * 64 + x;
        const v = (this.cellChange[i] > CHROME_T || this.fuelMask[i]) ? 0xee : (row[x] & 0xff);
        h ^= v;
        h = Math.imul(h, 0x01000193);
      }
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  // The world answered. prevObs/nextObs are normalized observations; decision
  // is what decide() returned. Emits and stores a receipt; updates all beliefs.
  observe(prevObs, decision, nextObs) {
    const diff = diffFrames(prevObs.grid, nextObs.grid);
    this.stepsThisLife++;
    // Drain-watch BEFORE hashing, so the receipt's before/after hashes are
    // computed under the same (just-updated) gauge mask — the noop invariant
    // must hold even on the step the gauge is first caught.
    this._watchDrain(prevObs.grid, nextObs.grid);
    const effectiveChanged = this._updateChrome(prevObs.grid, nextObs.grid);
    const noop = effectiveChanged === 0 && nextObs.levelsCompleted === prevObs.levelsCompleted
      && nextObs.state === prevObs.state;
    const leveled = nextObs.levelsCompleted > prevObs.levelsCompleted;

    // State identity through the chrome mask — the graph must not see the HUD.
    // BOTH hashes are computed fresh under the SAME (just-updated) mask, so
    // the receipt invariant "noop ⇒ hashBefore === hashAfter" holds exactly
    // even while the mask is still learning.
    const prevHash = this.worldHash(prevObs.grid);
    const nextHash = this.worldHash(nextObs.grid);
    const novel = !this.graph.has(nextHash);

    // State graph edge.
    const key = decision.kind === 'click' ? `6@${decision.x},${decision.y}` : String(decision.actionId);
    let node = this.graph.get(prevHash);
    if (!node) { node = { out: new Map(), seen: 0 }; this.graph.set(prevHash, node); }
    node.out.set(key, nextHash);
    let next = this.graph.get(nextHash);
    if (!next) { next = { out: new Map(), seen: 0 }; this.graph.set(nextHash, next); }
    next.seen++;
    // Stash where I stood in this state — lets the frontier search walk my map
    // TOWARD the goal instead of anywhere (A* over lived experience).
    if (this.selfColor != null && !next.pos) {
      const p = colorCentroid(nextObs.grid, this.selfColor);
      if (p) next.pos = { x: p.x, y: p.y };
    }
    this.curHash = nextHash;
    if (novel) this.lastNovelStep = this.step;

    // Effect table for simple actions.
    if (decision.kind === 'simple') {
      let e = this.effects.get(decision.actionId);
      if (!e) { e = { tried: 0, noops: 0, moved: { dx: 0, dy: 0, n: 0 }, avgChange: 0 }; this.effects.set(decision.actionId, e); }
      e.tried++;
      if (noop) e.noops++;
      e.avgChange += (diff.changed - e.avgChange) / e.tried;
      // Across a level transition the frame pair is two different worlds —
      // nothing may be learned from that diff.
      if (!noop && !leveled) this._learnMovement(prevObs, nextObs, decision.actionId, e);
      // In a turn-then-step world the FIRST noop of a direction is a turn,
      // not a wall — only a repeated noop of the same action votes blockers.
      const repeatNoop = this._lastSimple === decision.actionId && this._lastSimpleNoop;
      if (noop && !leveled && (!this._recal || repeatNoop)) this._learnBlocker(prevObs, decision.actionId);
      this._lastSimple = decision.actionId;
      this._lastSimpleNoop = noop;
      if (noop && this.plan.length > 0) {
        // Some worlds turn first and step second: the first press of a new
        // direction rotates the body (a visual noop under the mask) and only
        // the second press moves. One re-press before the plan dies tells
        // turn-then-step apart from a real wall.
        if (!this._planRetry) {
          this._planRetry = true;
          this.plan.unshift({ kind: 'simple', actionId: decision.actionId, why: 'pressing again — some worlds turn before they step' });
        } else {
          // Twice noop on the same step — the wall spoke. Rethink.
          this._planRetry = false;
          this.plan = [];
        }
      } else if (!noop) {
        this._planRetry = false;
      }
    } else if (decision.kind === 'click') {
      this.clickTried.push({ x: decision.x, y: decision.y, changed: effectiveChanged });
      if (this.clickTried.length > CLICK_MEMORY) this.clickTried.shift();
      if (effectiveChanged > 0) {
        this._hypo('click', `clicking near (${decision.x},${decision.y}) changes ${effectiveChanged} cells — that spot is alive`, 0.7, 'di');
      }
    }

    // Paintings aren't places: if the active goal never gets closer no matter
    // how many moves are spent walking at it, it is scenery — ban it for the
    // rest of this run and want something else.
    if (this.goal && this.selfColor != null) {
      const self = colorCentroid(nextObs.grid, this.selfColor);
      if (self) {
        const key = this._goalKey({ color: this.goal.color, cx: this.goal.x, cy: this.goal.y });
        const dist = Math.hypot(this.goal.x - self.x, this.goal.y - self.y);
        if (!this._goalTrack || this._goalTrack.key !== key) this._goalTrack = { key, bestDist: dist, spent: 0 };
        else if (dist < this._goalTrack.bestDist - 2) { this._goalTrack.bestDist = dist; this._goalTrack.spent = 0; }
        else this._goalTrack.spent++;
        if (this._goalTrack.spent >= 30) {
          this.goalBans.add(key);
          this._hypo('painting', `the ${this.goal.why} never gets closer no matter what I spend — a picture, not a place; I stop walking at it`, 0.8, 'di');
          this.goal = null;
          this.plan = [];
          this._goalTrack = null;
        }
      }
    }

    if (leveled) {
      this.level = nextObs.levelsCompleted;
      this.plan = [];
      this.goal = null;
      this.goalBans.clear();  // a new board deserves fresh wants
      this._goalTrack = null;
      this.carriedColor = null;   // deliveries end at the door of a new board
      this._attachVotes.clear();
      this._hypo('level', `level ${nextObs.levelsCompleted} complete — the way I just moved was the mechanism`, 0.95, 'di');
    }

    // Death-ledger: a watched GAME_OVER is the one receipt that fixes the
    // budget exactly — this life bought stepsThisLife moves, no more.
    if (nextObs.state === 'GAME_OVER' && prevObs.state !== 'GAME_OVER') {
      this.lifeLengths.push(this.stepsThisLife);
      const sorted = this.lifeLengths.slice().sort((a, b) => a - b);
      this.movesPerLife = sorted[Math.floor(sorted.length / 2)];
      this._hypo('budget', `that life lasted exactly ${this.stepsThisLife} moves — this world sells moves; I get ~${this.movesPerLife} per life and I will commit sooner`, 0.9, 'di');
    }

    const receipt = {
      step: this.step,
      action: decision.kind === 'click' ? { id: 6, x: decision.x, y: decision.y } : { id: decision.actionId },
      reason: decision.reason,
      tag: decision.tag,
      hashBefore: prevHash,
      hashAfter: nextHash,
      changed: effectiveChanged,
      changedRaw: diff.changed,
      noop,
      novel,
      levelsCompleted: nextObs.levelsCompleted,
      state: nextObs.state,
    };
    this.receipts.push(receipt);
    return receipt;
  }

  // Movement learning: did some color's centroid displace under this action?
  _learnMovement(prevObs, nextObs, actionId, effect) {
    const seg = prevObs.segments || segment(prevObs.grid);
    // Candidate colors: small-to-mid regions only (a whole wall doesn't walk).
    const candidates = new Set(seg.regions.filter((r) => r.size <= 200).map((r) => r.color));
    let bestColor = null, bestDist = MOVE_TOL, bestVec = null;
    for (const c of candidates) {
      const p0 = colorCentroid(prevObs.grid, c);
      const p1 = colorCentroid(nextObs.grid, c);
      if (!p0 || !p1 || p0.n === 0 || p1.n === 0) continue;
      if (Math.abs(p0.n - p1.n) > Math.max(4, p0.n * 0.5)) continue; // appeared/vanished, not moved
      const d = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      if (d > bestDist) { bestDist = d; bestColor = c; bestVec = { dx: p1.x - p0.x, dy: p1.y - p0.y }; }
    }
    if (bestColor == null) return;
    effect.moved.dx += bestVec.dx; effect.moved.dy += bestVec.dy; effect.moved.n++;
    // Cargo watch: a small REGION that keeps moving by MY vector, right next
    // to me, is not another creature — it is in my hands. And what I carry
    // names my want: its color-siblings elsewhere are where it belongs.
    // Region-level, not color-level: a distant twin (a pad, a legend) must
    // not dilute the reading of the piece on my head.
    const selfNow = colorCentroid(nextObs.grid, bestColor);
    const selfPrev = colorCentroid(prevObs.grid, bestColor);
    const nextSeg = nextObs.segments || segment(nextObs.grid);
    const nearestRegion = (segs, color, pt) => {
      let bestR = null, bd = Infinity;
      for (const r of segs.regions) {
        if (r.color !== color) continue;
        const d = Math.hypot(r.cx - pt.x, r.cy - pt.y);
        if (d < bd) { bd = d; bestR = r; }
      }
      return bestR ? { r: bestR, d: bd } : null;
    };
    for (const c of candidates) {
      if (c === bestColor) continue;
      if (!selfNow || !selfPrev) break;
      const p = nearestRegion(seg, c, selfPrev);
      const q = nearestRegion(nextSeg, c, selfNow);
      if (!p || !q || q.r.size > 60) { this._attachVotes.delete(c); continue; }
      const vec = { dx: q.r.cx - p.r.cx, dy: q.r.cy - p.r.cy };
      const sameVec = Math.hypot(vec.dx - bestVec.dx, vec.dy - bestVec.dy) < 0.8;
      const nearMe = q.d < 8;
      if (sameVec && nearMe && Math.hypot(vec.dx, vec.dy) > MOVE_TOL) {
        const v = (this._attachVotes.get(c) || 0) + 1;
        this._attachVotes.set(c, v);
        if (v >= 3 && this.carriedColor !== c) {
          this.carriedColor = c;
          this._hypo('carrying', `the color-${c} piece moves exactly with me — I am carrying it; its siblings are where it belongs`, 0.85, 'di');
        }
      } else if (this._attachVotes.has(c)) {
        this._attachVotes.set(c, 0);
        if (this.carriedColor === c) {
          this.carriedColor = null;
          this._hypo('carrying', `the color-${c} piece left my hands`, 0.7, 'di');
        }
      }
    }
    // Ground truth about the ground: whatever my body just covered is passable.
    if (!this.passableColors) this.passableColors = new Set();
    for (let y = 0; y < nextObs.grid.length; y++) {
      const rn = nextObs.grid[y], rp = prevObs.grid[y];
      for (let x = 0; x < rn.length; x++) {
        if (rn[x] === bestColor && rp[x] !== bestColor) this.passableColors.add(rp[x]);
      }
    }
    // Self = the color with the most accumulated movement evidence.
    if (!this.moverVotes) this.moverVotes = new Map();
    this.moverVotes.set(bestColor, (this.moverVotes.get(bestColor) || 0) + 1);
    let top = null, topVotes = 0;
    for (const [c, v] of this.moverVotes) if (v > topVotes) { top = c; topVotes = v; }
    this.selfColor = top;
    const n = effect.moved.n;
    const vx = effect.moved.dx / n, vy = effect.moved.dy / n;
    const mag = Math.hypot(vx, vy);
    if (mag > MOVE_TOL) {
      this.dirMap.set(actionId, { dx: vx / mag, dy: vy / mag });
      const name = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 'right' : 'left') : (vy > 0 ? 'down' : 'up');
      this._hypo(`dir${actionId}`, `ACTION${actionId} moves the color-${bestColor} body ${name}`, Math.min(0.95, 0.5 + n * 0.15), n >= 2 ? 'di' : 'intu');
    }
  }

  // A blocked move is a lesson about the world's materials: whatever color sat
  // in front of my body along that direction just voted itself "wall".
  _learnBlocker(prevObs, actionId) {
    if (this.selfColor == null) return;
    const v = this.dirMap.get(actionId);
    const e = this.effects.get(actionId);
    if (!v || !e || e.moved.n === 0) return;
    const stepX = Math.round(e.moved.dx / e.moved.n), stepY = Math.round(e.moved.dy / e.moved.n);
    if (stepX === 0 && stepY === 0) return;
    const grid = prevObs.grid;
    const Hh = grid.length, Ww = grid[0].length;
    if (!this.blockerVotes) this.blockerVotes = new Map();
    const before = this._blockers().size;
    for (let y = 0; y < Hh; y++) {
      for (let x = 0; x < Ww; x++) {
        if (grid[y][x] !== this.selfColor) continue;
        const ax = x + stepX, ay = y + stepY;
        if (ax < 0 || ay < 0 || ax >= Ww || ay >= Hh) continue;
        const c = grid[ay][ax];
        if (c === this.selfColor) continue;
        this.blockerVotes.set(c, (this.blockerVotes.get(c) || 0) + 1);
      }
    }
    const after = this._blockers();
    if (after.size > before) {
      this._hypo('walls', `${[...after].map((c) => `color-${c}`).join(', ')} stop${after.size === 1 ? 's' : ''} me — walls`, 0.85, 'di');
    }
  }

  _hypo(id, text, confidence, grade) {
    const at = this.step;
    const i = this.hypotheses.findIndex((h) => h.id === id);
    const h = { id, text, confidence, grade, at };
    if (i >= 0) this.hypotheses[i] = h; else this.hypotheses.push(h);
    if (this.hypotheses.length > 24) this.hypotheses.shift();
  }

  // A compact self-description for the UI and the meta-mind.
  summary() {
    const dirs = {};
    for (const [aid, v] of this.dirMap) {
      dirs[aid] = Math.abs(v.dx) > Math.abs(v.dy) ? (v.dx > 0 ? 'right' : 'left') : (v.dy > 0 ? 'down' : 'up');
    }
    return {
      phase: this.phase,
      strategy: this.strategy,
      selfColor: this.selfColor,
      directions: dirs,
      statesSeen: this.graph.size,
      steps: this.step,
      level: this.level,
      hypotheses: this.hypotheses.slice(),
      budget: {
        movesPerLife: this.movesPerLife,
        remaining: this.budgetRemaining(),
        committing: this.committing,
        fuelColor: this.fuelColor,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Normalize a FrameResponse (live API or mock arcade) into the observation the
// Reasoner consumes. Segmentation is computed lazily once per observation.
// ---------------------------------------------------------------------------

export function normalizeObs(fr) {
  const grid = lastGrid(fr.frame);
  const obs = {
    gameId: fr.game_id,
    guid: fr.guid,
    grid,
    hash: grid ? frameHash(grid) : 'nil',
    state: fr.state,
    levelsCompleted: fr.levels_completed ?? 0,
    winLevels: fr.win_levels ?? 0,
    availableActions: fr.available_actions || [],
    segments: null,
  };
  if (grid) obs.segments = segment(grid);
  return obs;
}

// ---------------------------------------------------------------------------
// MetaMind — cross-game pattern memory. Stores LESSONS (mechanic fingerprints
// with outcomes), answers with PRIORS (advisory nudges, never hardcoded
// solutions). Serializable; the organ persists it in localStorage, and its
// shape matches the Convex receipts schema so it can graduate to the reactive
// brain later.
// ---------------------------------------------------------------------------

export class MetaMind {
  constructor(data) {
    this.lessons = (data && Array.isArray(data.lessons)) ? data.lessons : [];
  }

  static fingerprint(availableActions) {
    const simple = availableActions.filter((a) => a >= 1 && a <= 5).sort().join('');
    const click = availableActions.includes(6) ? 'C' : '';
    return `${simple}|${click}`;
  }

  // A finished run teaches. Only receipt-backed facts arrive here: the driver
  // calls this with the run's actual outcome, never with a guess.
  learn({ gameId, availableActions, mechanic, won, levels, steps }) {
    this.lessons.push({
      at: new Date().toISOString(),
      gameId,
      fingerprint: MetaMind.fingerprint(availableActions),
      mechanic,
      won: !!won,
      levels: levels | 0,
      steps: steps | 0,
    });
    if (this.lessons.length > 400) this.lessons.splice(0, this.lessons.length - 400);
  }

  // Wipe every lesson from one game family (or all of them, with no id) —
  // the owner's right to send her in truly blind again. Ids carry a deploy
  // suffix ('ft09-0d8bbf25', 'mk-maze-2a'); family = the id minus that tail.
  forget(gameId) {
    const family = (id) => String(id).split('-').slice(0, -1).join('-') || String(id);
    const before = this.lessons.length;
    this.lessons = gameId == null ? [] : this.lessons.filter((l) => family(l.gameId) !== family(gameId));
    return before - this.lessons.length;
  }

  // Advisory prior for a new world with this action menu.
  prior(availableActions) {
    const fp = MetaMind.fingerprint(availableActions);
    const hits = this.lessons.filter((l) => l.fingerprint === fp && l.won);
    if (!hits.length) return null;
    const byMech = new Map();
    for (const h of hits) byMech.set(h.mechanic, (byMech.get(h.mechanic) || 0) + 1);
    const [mechanic, support] = [...byMech.entries()].sort((a, b) => b[1] - a[1])[0];
    return { mechanic, support, confidence: Math.min(0.8, 0.3 + support * 0.1) };
  }

  toJSON() {
    return { lessons: this.lessons };
  }
}

// Label the mechanic a finished run most looked like — for lessons and the UI.
export function inferMechanic(reasoner) {
  const dirs = reasoner.dirMap.size;
  const clicks = reasoner.clickTried.filter((c) => c.changed > 0).length;
  if (dirs >= 2 && clicks === 0) return 'maze-walk';
  if (dirs === 0 && clicks > 0) return 'click-pattern';
  if (dirs >= 2 && clicks > 0) return 'hybrid-walk-click';
  return 'unknown';
}
