// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
//
// AGI · ARC 3 — the onboard arcade. Three tiny worlds that speak the exact
// FrameResponse contract of three.arcprize.org, so Auma's reasoner can prove
// blind general reasoning with no key, no network, and no prior knowledge —
// in the browser and in CI.
//
// HONESTY RULE: these are NOT the benchmark. They exist so the loop is
// verifiable end-to-end; live wins only count when the real API says so.
//
// Each world scrambles its control mapping per seed — ACTION1 is NOT "up"
// unless the reasoner earns that fact through calibration. That is the point.

import { mulberry32 } from './engine.js';

const W = 64, H = 64;

function blankGrid(fill) {
  return Array.from({ length: H }, () => new Array(W).fill(fill));
}

function stamp(grid, x0, y0, w, h, color) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (y >= 0 && y < H && x >= 0 && x < W) grid[y][x] = color;
    }
  }
}

function scrambleDirections(rng) {
  // actionId (1..4) → direction vector, shuffled so nothing can be assumed.
  const dirs = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
  for (let i = dirs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
  }
  return new Map([[1, dirs[0]], [2, dirs[1]], [3, dirs[2]], [4, dirs[3]]]);
}

// ---------------------------------------------------------------------------
// World 1: mk-maze — walk the walker to the beacon. 3 levels, walls thicken.
// Colors: floor 5 (dark), walls 2, self 9 (blue), goal 14 (green).
// ---------------------------------------------------------------------------

// Can a 4×4 body stepping 2 cells at a time get from self to goal? Mirrors the
// exact movement + win rules of mazeGame so generated levels are solvable BY
// CONSTRUCTION — a world the reasoner "must beat" may never be a lottery.
function mazeSolvable(grid, self, goal) {
  const fits = (x, y) => {
    if (x < 0 || y < 0 || x + 4 > W || y + 4 > H) return false;
    for (let yy = y; yy < y + 4; yy++) for (let xx = x; xx < x + 4; xx++) if (grid[yy][xx] === 2) return false;
    return true;
  };
  const seen = new Set([`${self.x},${self.y}`]);
  const queue = [{ x: self.x, y: self.y }];
  while (queue.length) {
    const { x, y } = queue.shift();
    if (Math.abs(x - goal.x) < 4 && Math.abs(y - goal.y) < 4) return true;
    for (const [dx, dy] of [[0, -2], [0, 2], [-2, 0], [2, 0]]) {
      const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
      if (!seen.has(k) && fits(nx, ny)) { seen.add(k); queue.push({ x: nx, y: ny }); }
    }
  }
  return false;
}

function makeMaze(rng, level) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const grid = blankGrid(5);
    // border walls
    stamp(grid, 0, 0, W, 2, 2); stamp(grid, 0, H - 2, W, 2, 2);
    stamp(grid, 0, 0, 2, H, 2); stamp(grid, W - 2, 0, 2, H, 2);
    // internal walls: level+2 random full-ish bars with a gap (skipped on the
    // last resort attempt so a solvable board always exists)
    const bars = attempt === 39 ? 0 : level + 2;
    for (let i = 0; i < bars; i++) {
      const vertical = rng() < 0.5;
      const pos = 8 + Math.floor(rng() * (W - 20));
      const gap = 6 + Math.floor(rng() * (H - 20));
      if (vertical) { stamp(grid, pos, 2, 3, H - 4, 2); stamp(grid, pos, gap, 3, 8, 5); }
      else { stamp(grid, 2, pos, W - 4, 3, 2); stamp(grid, gap, pos, 8, 3, 5); }
    }
    const spot = () => {
      for (let tries = 0; tries < 500; tries++) {
        const x = 4 + Math.floor(rng() * (W - 12));
        const y = 4 + Math.floor(rng() * (H - 12));
        let clear = true;
        for (let yy = y; yy < y + 4 && clear; yy++) for (let xx = x; xx < x + 4; xx++) if (grid[yy][xx] !== 5) { clear = false; break; }
        if (clear) return { x, y };
      }
      return null;
    };
    const self = spot();
    if (!self) continue;
    let goal = null;
    for (let g = 0; g < 40; g++) {
      const cand = spot();
      if (cand && Math.hypot(cand.x - self.x, cand.y - self.y) >= 24) { goal = cand; break; }
    }
    if (!goal) continue;
    if (!mazeSolvable(grid, self, goal)) continue;
    stamp(grid, goal.x, goal.y, 4, 4, 14);
    stamp(grid, self.x, self.y, 4, 4, 9);
    return { grid, self, goal };
  }
  throw new Error('mk-maze: could not generate a solvable board');
}

function mazeGame(seed) {
  const rng = mulberry32(seed);
  const controls = scrambleDirections(rng);
  const LEVELS = 3;
  let level = 0;
  let world = makeMaze(rng, level);

  return {
    availableActions: [1, 2, 3, 4],
    winLevels: LEVELS,
    levelsCompleted: () => level,
    state: () => (level >= LEVELS ? 'WIN' : 'NOT_FINISHED'),
    frame: () => [world.grid.map((r) => r.slice())],
    act(actionId) {
      if (level >= LEVELS) return;
      const v = controls.get(actionId);
      if (!v) return;
      const { grid, self } = world;
      const nx = self.x + v.dx * 2, ny = self.y + v.dy * 2;
      // blocked if any target cell is wall
      for (let y = ny; y < ny + 4; y++) {
        for (let x = nx; x < nx + 4; x++) {
          if (x < 0 || y < 0 || x >= W || y >= H) return;
          const c = grid[y][x];
          if (c === 2) return; // wall — a visible noop
        }
      }
      stamp(grid, self.x, self.y, 4, 4, 5);
      self.x = nx; self.y = ny;
      // goal reached?
      const g = world.goal;
      if (Math.abs(self.x - g.x) < 4 && Math.abs(self.y - g.y) < 4) {
        level++;
        if (level < LEVELS) world = makeMaze(rng, level);
        else stamp(grid, self.x, self.y, 4, 4, 9);
        return;
      }
      stamp(grid, self.x, self.y, 4, 4, 9);
    },
    click() { /* clicks do nothing in the maze */ },
    resetLevel() { world = makeMaze(rng, level); },
  };
}

// ---------------------------------------------------------------------------
// World 1b: mk-ember — the budget world (the ls20 lesson). Same maze bones,
// but every move burns one ember: a fuel bar drains along the top and an
// empty bar ends the life (GAME_OVER). RESET relights the SAME maze, so what
// a death taught carries into the next life. Explorers die broke here —
// winning requires learning the budget and committing.
// Colors: floor 5, walls 2, self 9, goal 14, fuel 13.
// ---------------------------------------------------------------------------

// Shortest solve in MOVES (not cells) under the exact maze movement rules —
// ember boards must be winnable with fuel to spare, by construction.
function mazeMoves(grid, self, goal) {
  const fits = (x, y) => {
    if (x < 0 || y < 0 || x + 4 > W || y + 4 > H) return false;
    for (let yy = y; yy < y + 4; yy++) for (let xx = x; xx < x + 4; xx++) if (grid[yy][xx] === 2) return false;
    return true;
  };
  const seen = new Map([[`${self.x},${self.y}`, 0]]);
  const queue = [{ x: self.x, y: self.y }];
  while (queue.length) {
    const { x, y } = queue.shift();
    const d = seen.get(`${x},${y}`);
    if (Math.abs(x - goal.x) < 4 && Math.abs(y - goal.y) < 4) return d;
    for (const [dx, dy] of [[0, -2], [0, 2], [-2, 0], [2, 0]]) {
      const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
      if (!seen.has(k) && fits(nx, ny)) { seen.set(k, d + 1); queue.push({ x: nx, y: ny }); }
    }
  }
  return Infinity;
}

function emberGame(seed) {
  const rng = mulberry32(seed + 311);
  const controls = scrambleDirections(rng);
  const LEVELS = 2;
  const FUEL = 30; // makeMaze goals sit ≥24 cells out (≥12 moves) — one tank
                   // must cover the straightest board plus a few honest bumps
  let level = 0;
  let fuel = FUEL;
  let dead = false;

  const makeBoard = () => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const world = makeMaze(rng, level);
      if (mazeMoves(world.grid, world.self, world.goal) <= 14) return world;
    }
    throw new Error('mk-ember: could not generate a board winnable on one tank');
  };
  let world = makeBoard();

  const draw = () => {
    const grid = world.grid.map((r) => r.slice());
    // The gauge: one lit ember per remaining move, row 3 (inside the border,
    // above where bodies can stand — spot() never places one higher than y=4).
    for (let i = 0; i < fuel; i++) grid[3][4 + i] = 13;
    return grid;
  };

  return {
    availableActions: [1, 2, 3, 4],
    winLevels: LEVELS,
    levelsCompleted: () => level,
    state: () => (dead ? 'GAME_OVER' : level >= LEVELS ? 'WIN' : 'NOT_FINISHED'),
    frame: () => [draw()],
    act(actionId) {
      if (dead || level >= LEVELS) return;
      const v = controls.get(actionId);
      if (!v) return;
      // Every attempted move burns an ember — bumping a wall is not free.
      fuel--;
      if (fuel <= 0) { dead = true; return; }
      const { grid, self } = world;
      const nx = self.x + v.dx * 2, ny = self.y + v.dy * 2;
      for (let y = ny; y < ny + 4; y++) {
        for (let x = nx; x < nx + 4; x++) {
          if (x < 0 || y < 0 || x >= W || y >= H) return;
          if (grid[y][x] === 2) return; // wall — a visible noop (minus one ember)
        }
      }
      stamp(grid, self.x, self.y, 4, 4, 5);
      self.x = nx; self.y = ny;
      const g = world.goal;
      if (Math.abs(self.x - g.x) < 4 && Math.abs(self.y - g.y) < 4) {
        level++;
        fuel = FUEL;
        if (level < LEVELS) world = makeBoard();
        else stamp(grid, self.x, self.y, 4, 4, 9);
        return;
      }
      stamp(grid, self.x, self.y, 4, 4, 9);
    },
    click() { /* clicks do nothing in the ember maze */ },
    // RESET after a death replays the SAME board with a full tank — the
    // platform way. Lessons about these walls stay honest across lives.
    resetLevel() { fuel = FUEL; dead = false; },
  };
}

// ---------------------------------------------------------------------------
// World 2: mk-glyphs — a 3×3 board of tiles; clicking a tile toggles it and its
// orthogonal neighbours (Lights-Out family). Win = all tiles lit. 2 levels.
// Colors: bg 5, tile off 8 (red), tile on 11 (yellow).
// ---------------------------------------------------------------------------

function glyphsGame(seed) {
  const rng = mulberry32(seed + 77);
  const LEVELS = 2;
  let level = 0;
  let tiles; // 3×3 booleans

  const scramble = () => {
    tiles = Array.from({ length: 3 }, () => new Array(3).fill(true));
    // apply random presses so the puzzle is always solvable
    const presses = 3 + level * 2;
    for (let i = 0; i < presses; i++) toggle(Math.floor(rng() * 3), Math.floor(rng() * 3));
    if (tiles.flat().every(Boolean)) toggle(1, 1); // never start solved
  };
  const toggle = (tx, ty) => {
    const flip = (x, y) => { if (x >= 0 && x < 3 && y >= 0 && y < 3) tiles[y][x] = !tiles[y][x]; };
    flip(tx, ty); flip(tx - 1, ty); flip(tx + 1, ty); flip(tx, ty - 1); flip(tx, ty + 1);
  };
  scramble();

  const TILE = 14, GAP = 5, X0 = 4, Y0 = 4;
  const draw = () => {
    const grid = blankGrid(5);
    for (let ty = 0; ty < 3; ty++) {
      for (let tx = 0; tx < 3; tx++) {
        stamp(grid, X0 + tx * (TILE + GAP), Y0 + ty * (TILE + GAP), TILE, TILE, tiles[ty][tx] ? 11 : 8);
      }
    }
    return grid;
  };

  return {
    availableActions: [6],
    winLevels: LEVELS,
    levelsCompleted: () => level,
    state: () => (level >= LEVELS ? 'WIN' : 'NOT_FINISHED'),
    frame: () => [draw()],
    act() { /* no simple actions */ },
    click(x, y) {
      if (level >= LEVELS) return;
      const tx = Math.floor((x - X0) / (TILE + GAP));
      const ty = Math.floor((y - Y0) / (TILE + GAP));
      if (tx < 0 || tx > 2 || ty < 0 || ty > 2) return;
      // only inside the tile, not the gap
      if ((x - X0) % (TILE + GAP) >= TILE || (y - Y0) % (TILE + GAP) >= TILE) return;
      toggle(tx, ty);
      if (tiles.flat().every(Boolean)) {
        level++;
        if (level < LEVELS) scramble();
      }
    },
    resetLevel() { scramble(); },
  };
}

// ---------------------------------------------------------------------------
// World 2b: mk-oddball — twelve look-alike tiles, ONE wears the wrong color;
// clicking the deviant advances the level, clicking anywhere else does
// nothing. The ft09/lp85 family in miniature: the mechanism IS the anomaly.
// Colors: bg 5, tiles 8, the odd one 11. 2 levels, deviant reshuffles.
// ---------------------------------------------------------------------------

function oddballGame(seed) {
  const rng = mulberry32(seed + 431);
  const LEVELS = 2;
  const COLS = 4, ROWS = 3, TILE = 10, GAP = 4, X0 = 6, Y0 = 8;
  let level = 0;
  let oddIx = Math.floor(rng() * COLS * ROWS);

  const draw = () => {
    const grid = blankGrid(5);
    for (let i = 0; i < COLS * ROWS; i++) {
      const tx = X0 + (i % COLS) * (TILE + GAP);
      const ty = Y0 + Math.floor(i / COLS) * (TILE + GAP);
      stamp(grid, tx, ty, TILE, TILE, i === oddIx ? 11 : 8);
    }
    return grid;
  };

  return {
    availableActions: [6],
    winLevels: LEVELS,
    levelsCompleted: () => level,
    state: () => (level >= LEVELS ? 'WIN' : 'NOT_FINISHED'),
    frame: () => [draw()],
    act() { /* no simple actions */ },
    click(x, y) {
      if (level >= LEVELS) return;
      const cx = Math.floor((x - X0) / (TILE + GAP));
      const cy = Math.floor((y - Y0) / (TILE + GAP));
      if (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS) return;
      if ((x - X0) % (TILE + GAP) >= TILE || (y - Y0) % (TILE + GAP) >= TILE) return;
      if (cy * COLS + cx !== oddIx) return; // only the deviant answers
      level++;
      if (level < LEVELS) oddIx = Math.floor(rng() * COLS * ROWS);
    },
    resetLevel() { /* the deviant stays where it is — nothing to reset */ },
  };
}

// ---------------------------------------------------------------------------
// World 2c: mk-mirror — four blocks of tiles; three agree, the FRAMED one has
// cells wearing the wrong color. Clicking a wrong cell flips it to match.
// Level done when the framed block agrees with its family. The consensus /
// reference-matching regime (the ft09/lp85 click family) in miniature.
// Colors: bg 5, tiles 8/11, frame 14. 2 levels, wrong cells reshuffle.
// ---------------------------------------------------------------------------

function mirrorGame(seed) {
  const rng = mulberry32(seed + 613);
  const LEVELS = 2;
  const TILE = 6, GAP = 2, BX = [6, 38], BY = [6, 38];
  let level = 0;
  let pattern, canvas; // 3×3 color matrices (values 8 or 11); canvas differs

  const scramble = () => {
    pattern = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => (rng() < 0.5 ? 8 : 11)));
    canvas = pattern.map((row) => row.slice());
    // flip 2 distinct cells in the canvas
    const flipped = new Set();
    while (flipped.size < 2) {
      const i = Math.floor(rng() * 9);
      if (flipped.has(i)) continue;
      flipped.add(i);
      const r = Math.floor(i / 3), c = i % 3;
      canvas[r][c] = canvas[r][c] === 8 ? 11 : 8;
    }
  };
  scramble();

  const draw = () => {
    const grid = blankGrid(5);
    // frame around the canvas block (bottom-right)
    stamp(grid, BX[1] - 4, BY[1] - 4, 30, 30, 14);
    stamp(grid, BX[1] - 2, BY[1] - 2, 26, 26, 5);
    for (let by = 0; by < 2; by++) {
      for (let bx = 0; bx < 2; bx++) {
        const isCanvas = bx === 1 && by === 1;
        const m = isCanvas ? canvas : pattern;
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
          stamp(grid, BX[bx] + c * (TILE + GAP), BY[by] + r * (TILE + GAP), TILE, TILE, m[r][c]);
        }
      }
    }
    return grid;
  };

  return {
    availableActions: [6],
    winLevels: LEVELS,
    levelsCompleted: () => level,
    state: () => (level >= LEVELS ? 'WIN' : 'NOT_FINISHED'),
    frame: () => [draw()],
    act() { /* no simple actions */ },
    click(x, y) {
      if (level >= LEVELS) return;
      const c = Math.floor((x - BX[1]) / (TILE + GAP));
      const r = Math.floor((y - BY[1]) / (TILE + GAP));
      if (r < 0 || r > 2 || c < 0 || c > 2) return;
      if ((x - BX[1]) % (TILE + GAP) >= TILE || (y - BY[1]) % (TILE + GAP) >= TILE) return;
      if (canvas[r][c] === pattern[r][c]) return; // clicking agreement does nothing
      canvas[r][c] = pattern[r][c];
      if (canvas.flat().join() === pattern.flat().join()) {
        level++;
        if (level < LEVELS) scramble();
      }
    },
    resetLevel() { scramble(); },
  };
}

// ---------------------------------------------------------------------------
// World 3: mk-forge — hybrid: walk the walker onto the switch (click the door
// to open it first). Walk + one meaningful click. 2 levels.
// Colors: floor 5, wall 2, self 9, door 12 (orange, click to open), pad 14.
// ---------------------------------------------------------------------------

function forgeGame(seed) {
  const rng = mulberry32(seed + 191);
  const controls = scrambleDirections(rng);
  const LEVELS = 2;
  let level = 0;
  let st;

  const build = () => {
    st = {
      self: { x: 6, y: 28 },
      pad: { x: 52, y: 28 },
      door: { x: 30, y: 20, open: false },
      wallX: 31,
    };
  };
  build();

  const draw = () => {
    const grid = blankGrid(5);
    stamp(grid, 0, 0, W, 2, 2); stamp(grid, 0, H - 2, W, 2, 2);
    stamp(grid, 0, 0, 2, H, 2); stamp(grid, W - 2, 0, 2, H, 2);
    // dividing wall with a doorway
    stamp(grid, st.wallX, 2, 3, H - 4, 2);
    if (st.door.open) stamp(grid, st.wallX, st.door.y, 3, 12, 5);
    else stamp(grid, st.wallX, st.door.y, 3, 12, 12);
    stamp(grid, st.pad.x, st.pad.y, 4, 4, 14);
    stamp(grid, st.self.x, st.self.y, 4, 4, 9);
    return grid;
  };

  return {
    availableActions: [1, 2, 3, 4, 6],
    winLevels: LEVELS,
    levelsCompleted: () => level,
    state: () => (level >= LEVELS ? 'WIN' : 'NOT_FINISHED'),
    frame: () => [draw()],
    act(actionId) {
      if (level >= LEVELS) return;
      const v = controls.get(actionId);
      if (!v) return;
      const nx = st.self.x + v.dx * 2, ny = st.self.y + v.dy * 2;
      if (nx < 2 || ny < 2 || nx + 4 > W - 2 || ny + 4 > H - 2) return;
      // wall collision (door counts as wall while closed)
      if (nx + 4 > st.wallX && nx < st.wallX + 3) {
        const inDoor = st.door.open && ny >= st.door.y && ny + 4 <= st.door.y + 12;
        if (!inDoor) return;
      }
      st.self.x = nx; st.self.y = ny;
      if (Math.abs(st.self.x - st.pad.x) < 4 && Math.abs(st.self.y - st.pad.y) < 4) {
        level++;
        if (level < LEVELS) build();
      }
    },
    click(x, y) {
      if (level >= LEVELS) return;
      if (x >= st.wallX - 1 && x <= st.wallX + 4 && y >= st.door.y - 1 && y <= st.door.y + 13) {
        st.door.open = !st.door.open;
      }
    },
    resetLevel() { build(); },
  };
}

// ---------------------------------------------------------------------------
// World 4b: mk-courier — the pickup-and-deliver regime (the ls20 family).
// Walk onto the parcel and it rides on your head; walk the parcel onto the
// pad of ITS OWN COLOR and the level falls. The pad's twin-color is the only
// clue — what you carry names where you go.
// Colors: floor 5, walls 2, self 9, parcel+pad 12. 2 levels.
// ---------------------------------------------------------------------------

function courierGame(seed) {
  const rng = mulberry32(seed + 1109);
  const controls = scrambleDirections(rng);
  const LEVELS = 2;
  let level = 0;
  let st;

  const spot = (grid) => {
    for (let tries = 0; tries < 500; tries++) {
      const x = 6 + Math.floor(rng() * (W - 16));
      const y = 6 + Math.floor(rng() * (H - 16));
      let clear = true;
      for (let yy = y; yy < y + 4 && clear; yy++) for (let xx = x; xx < x + 4; xx++) if (grid[yy][xx] !== 5) { clear = false; break; }
      if (clear) return { x, y };
    }
    throw new Error('mk-courier: no clear spot');
  };

  const build = () => {
    const walls = blankGrid(5);
    stamp(walls, 0, 0, W, 2, 2); stamp(walls, 0, H - 2, W, 2, 2);
    stamp(walls, 0, 0, 2, H, 2); stamp(walls, W - 2, 0, 2, H, 2);
    const self = spot(walls);
    let parcel = null, pad = null;
    while (!parcel || Math.hypot(parcel.x - self.x, parcel.y - self.y) < 16) parcel = spot(walls);
    while (!pad || Math.hypot(pad.x - parcel.x, pad.y - parcel.y) < 16 || Math.hypot(pad.x - self.x, pad.y - self.y) < 16) pad = spot(walls);
    st = { walls, self, parcel, pad, carrying: false };
  };
  build();

  const draw = () => {
    const grid = st.walls.map((r) => r.slice());
    stamp(grid, st.pad.x - 1, st.pad.y - 1, 6, 6, 12);
    stamp(grid, st.pad.x, st.pad.y, 4, 4, 5); // a hollow pad — a socket, not a lump
    if (st.carrying) stamp(grid, st.self.x, st.self.y - 3, 4, 2, 12);
    else stamp(grid, st.parcel.x, st.parcel.y, 4, 2, 12);
    stamp(grid, st.self.x, st.self.y, 4, 4, 9);
    return grid;
  };

  return {
    availableActions: [1, 2, 3, 4],
    winLevels: LEVELS,
    levelsCompleted: () => level,
    state: () => (level >= LEVELS ? 'WIN' : 'NOT_FINISHED'),
    frame: () => [draw()],
    act(actionId) {
      if (level >= LEVELS) return;
      const v = controls.get(actionId);
      if (!v) return;
      const nx = st.self.x + v.dx * 2, ny = st.self.y + v.dy * 2;
      if (nx < 2 || ny < 2 || nx + 4 > W - 2 || ny + 4 > H - 2) return;
      st.self.x = nx; st.self.y = ny;
      if (!st.carrying && Math.abs(st.self.x - st.parcel.x) < 4 && Math.abs(st.self.y - st.parcel.y) < 4) {
        st.carrying = true;
      }
      if (st.carrying && Math.abs(st.self.x - st.pad.x) < 3 && Math.abs(st.self.y - st.pad.y) < 3) {
        level++;
        if (level < LEVELS) build();
      }
    },
    click() { /* clicks do nothing for a courier */ },
    resetLevel() { build(); },
  };
}

// ---------------------------------------------------------------------------
// World 5: mk-rail — path-locked movement with turn-then-step controls. The
// head can ONLY sit on the winding track (everywhere else is vacuum), and the
// first press of a new direction only rotates the head (a pure noop frame);
// the second press moves. Two regimes seen live, in one practice world.
// Colors: bg 5, track alternating 6/10, head 9, goal 14.
// ---------------------------------------------------------------------------

function railGame(seed) {
  const rng = mulberry32(seed + 877);
  const controls = scrambleDirections(rng);
  const LEVELS = 2;
  const C = 4; // track cell size
  let level = 0;

  const buildPath = (mirror) => {
    // S-shaped rail: three vertical runs joined by horizontal bridges.
    // Level 2 mirrors the whole path left-right (adjacency preserved).
    const p = [];
    const cols = [8, 28, 48];
    for (let i = 0; i <= 8; i++) p.push({ x: cols[0], y: 48 - i * C }); // up
    for (let x = cols[0] + C; x < cols[1]; x += C) p.push({ x, y: 48 - 8 * C }); // right
    for (let i = 0; i <= 8; i++) p.push({ x: cols[1], y: 16 + i * C }); // down
    for (let x = cols[1] + C; x < cols[2]; x += C) p.push({ x, y: 48 }); // right
    for (let i = 0; i <= 8; i++) p.push({ x: cols[2], y: 48 - i * C }); // up
    return mirror ? p.map(({ x, y }) => ({ x: 60 - x, y })) : p;
  };
  let path = buildPath(false);
  let ix = 0;
  let heading = null; // {dx,dy} the head faces; step requires facing the way

  const draw = () => {
    const grid = blankGrid(5);
    for (let i = 0; i < path.length; i++) stamp(grid, path[i].x, path[i].y, C, C, i % 2 ? 6 : 10);
    const goal = path[path.length - 1];
    stamp(grid, goal.x, goal.y, C, C, 14);
    stamp(grid, path[ix].x, path[ix].y, C, C, 9);
    return grid;
  };

  return {
    availableActions: [1, 2, 3, 4],
    winLevels: LEVELS,
    levelsCompleted: () => level,
    state: () => (level >= LEVELS ? 'WIN' : 'NOT_FINISHED'),
    frame: () => [draw()],
    act(actionId) {
      if (level >= LEVELS) return;
      const v = controls.get(actionId);
      if (!v) return;
      if (!heading || heading.dx !== v.dx || heading.dy !== v.dy) {
        heading = v; // first press turns; the board shows nothing (pure noop)
        return;
      }
      // second press: step along the rail if a neighbouring cell lies that way
      for (const ni of [ix + 1, ix - 1]) {
        if (ni < 0 || ni >= path.length) continue;
        const dx = Math.sign(path[ni].x - path[ix].x), dy = Math.sign(path[ni].y - path[ix].y);
        if (dx === v.dx && dy === v.dy) {
          ix = ni;
          if (ix === path.length - 1) {
            level++;
            if (level < LEVELS) { path = buildPath(level % 2 === 1); ix = 0; heading = null; }
          }
          return;
        }
      }
      // off the rail — vacuum; a visible noop
    },
    click() { /* clicks do nothing on the rail */ },
    resetLevel() { ix = 0; heading = null; },
  };
}

// ---------------------------------------------------------------------------
// The arcade — FrameResponse-contract driver around the worlds.
// ---------------------------------------------------------------------------

const BUILDERS = {
  'mk-maze': { title: 'MK·MAZE', make: mazeGame, blurb: 'walk to the beacon — controls scrambled per run' },
  'mk-ember': { title: 'MK·EMBER', make: emberGame, blurb: 'the beacon on a budget — every move burns fuel' },
  'mk-glyphs': { title: 'MK·GLYPHS', make: glyphsGame, blurb: 'light all nine tiles — a toggling cross' },
  'mk-oddball': { title: 'MK·ODDBALL', make: oddballGame, blurb: 'twelve look-alikes, one deviant — click it' },
  'mk-mirror': { title: 'MK·MIRROR', make: mirrorGame, blurb: 'make the framed block agree with its family' },
  'mk-courier': { title: 'MK·COURIER', make: courierGame, blurb: 'carry the parcel to the pad of its own color' },
  'mk-rail': { title: 'MK·RAIL', make: railGame, blurb: 'a winding rail — turn first, step second' },
  'mk-forge': { title: 'MK·FORGE', make: forgeGame, blurb: 'open the door, reach the pad — walk and click' },
};

export function createMockArcade(seed = 1) {
  const sessions = new Map(); // guid → { game, gameId, actions }
  let guidSeq = 0;

  const frameResponse = (gameId, guid, s) => ({
    game_id: gameId,
    guid,
    frame: s.game.frame(),
    state: s.game.state(),
    levels_completed: s.game.levelsCompleted(),
    win_levels: s.game.winLevels,
    action_input: { id: 0, data: {} },
    available_actions: s.game.availableActions.slice(),
  });

  return {
    listGames() {
      return Object.entries(BUILDERS).map(([id, b]) => ({ game_id: `${id}-${(seed >>> 0).toString(16)}`, title: b.title, blurb: b.blurb, local: true }));
    },
    reset(gameId, guid) {
      const base = gameId.split('-').slice(0, 2).join('-');
      const b = BUILDERS[base];
      if (!b) throw new Error(`unknown mock game ${gameId}`);
      const existing = guid ? sessions.get(guid) : null;
      if (existing) {
        existing.game.resetLevel();
        return frameResponse(gameId, guid, existing);
      }
      const g = `mock-${++guidSeq}-${Math.floor(Math.random() * 1e6)}`;
      const s = { game: b.make(seed + guidSeq * 1013), gameId };
      sessions.set(g, s);
      return frameResponse(gameId, g, s);
    },
    act(gameId, guid, actionName, x, y) {
      const s = sessions.get(guid);
      if (!s) throw new Error('unknown session — RESET first');
      if (actionName === 'ACTION6') s.game.click(x, y);
      else {
        const id = Number(actionName.replace('ACTION', ''));
        s.game.act(id);
      }
      return frameResponse(gameId, guid, s);
    },
  };
}
