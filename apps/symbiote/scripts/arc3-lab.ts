#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
//
// arc3-lab — the headless bench. Drives the SAME engine the organ uses
// (spatial/app/arc3/engine.js, byte for byte) against the onboard arcade or
// the live arena through the door (:7093), with no browser and no UI pacing.
// The lab is where the engine is beaten against the benchmark and improved;
// the organ is where a human watches. Same mind, two rooms.
//
//   bun scripts/arc3-lab.ts --arena onboard --game mk-ember --runs 3
//   bun scripts/arc3-lab.ts --arena live --game ft09 --runs 2 --max 600
//   bun scripts/arc3-lab.ts --arena live --game lp85 --blind        # fresh meta
//
// Results land as JSON under ~/.aukora-symbiote/arc3/lab/ (machine state,
// never committed); the honest summary is printed for the ledger. The lab
// meta-mind persists across lab runs in that same directory so she keeps
// learning — pass --blind to leave it on the shelf for a provably blind run.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { Reasoner, MetaMind, normalizeObs, inferMechanic } from '../spatial/app/arc3/engine.js';
import { createMockArcade } from '../spatial/app/arc3/mock-arcade.js';

// ---- frame → PNG (the lab's eyes: every level start and every end state
// lands on disk, so losses become diagnosable pictures, not just numbers) ----
const PAL: Array<[number, number, number]> = [
  [0, 0, 0], [0, 116, 217], [255, 65, 54], [46, 204, 64], [255, 220, 0], [170, 170, 170],
  [240, 18, 190], [255, 133, 27], [127, 219, 255], [135, 12, 37], [133, 20, 75], [57, 204, 204],
  [1, 255, 112], [61, 153, 112], [178, 102, 255], [255, 255, 255]];

function savePng(grid: number[][], file: string, scale = 8): void {
  const h = grid.length, w = grid[0].length, W = w * scale, H = h * scale;
  const raw = Buffer.alloc(H * (W * 3 + 1));
  let o = 0;
  for (let y = 0; y < H; y++) {
    raw[o++] = 0;
    for (let x = 0; x < W; x++) {
      const [r, g, b] = PAL[grid[(y / scale) | 0][(x / scale) | 0] % 16];
      raw[o++] = r; raw[o++] = g; raw[o++] = b;
    }
  }
  const chunk = (tag: string, data: Buffer) => {
    const t = Buffer.from(tag);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crcBuf = Buffer.concat([t, data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(crcBuf) >>> 0 : crc32(crcBuf));
    return Buffer.concat([len, t, data, crc]);
  };
  // minimal CRC32 (zlib.crc32 exists in bun; fallback kept for node)
  function crc32(buf: Buffer): number {
    let c = ~0;
    for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
    return ~c >>> 0;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]));
}

// :7093 — the arc3 door's home since the 2026-07-08 port dedup (7092 belongs to
// the Auma Live voice sidecar; this stale default silently broke live lab runs).
const DOOR = process.env.AUKORA_ARC3_DOOR ?? 'http://127.0.0.1:7093';
const LAB_DIR = path.join(os.homedir(), '.aukora-symbiote', 'arc3', 'lab');
const META_PATH = path.join(LAB_DIR, 'meta.json');

// ---- tiny arg reader ----
function arg(name: string, fallback: string | null = null): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : 'true';
}

const arena = (arg('arena', 'onboard') as 'onboard' | 'live');
const gamePrefix = arg('game', arena === 'onboard' ? 'mk-maze' : 'ft09')!;
const runs = Number(arg('runs', '1'));
const maxActions = Number(arg('max', arena === 'live' ? '600' : '4000'));
const maxLives = Number(arg('lives', '5'));
const blind = arg('blind') === 'true';
const seedBase = Number(arg('seed', String((Date.now() % 100000) | 0)));

// ---- door client (live arena) ----
async function door(pathname: string, body?: unknown): Promise<any> {
  const res = await fetch(`${DOOR}${pathname}`, body === undefined
    ? undefined
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: any = new Error((json as any)?.message || `door ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

function loadLabMeta(): MetaMind {
  if (blind) return new MetaMind(undefined);
  try { return new MetaMind(JSON.parse(fs.readFileSync(META_PATH, 'utf8'))); }
  catch { return new MetaMind(undefined); }
}
function saveLabMeta(meta: MetaMind): void {
  if (blind) return; // a blind run leaves no lessons behind either — clean rooms stay clean
  fs.mkdirSync(LAB_DIR, { recursive: true });
  fs.writeFileSync(META_PATH, JSON.stringify(meta.toJSON()));
}

type RunSummary = {
  arena: string; game: string; seed: number;
  won: boolean; levels: number; winLevels: number;
  actions: number; noops: number; novel: number; lives: number;
  movesPerLife: number | null; fuelColor: number | null; mechanic: string;
  scorecard?: string; endedBy: string;
};

async function runOnce(seed: number, meta: MetaMind): Promise<RunSummary> {
  const r = new Reasoner({ seed, meta });
  let lives = 1;
  let endedBy = 'budget';
  let cardId: string | null = null;
  let gameId: string;
  let act: (d: any, guid: string) => Promise<any>;
  let reset: (guid: string | null) => Promise<any>;

  if (arena === 'live') {
    const games: Array<{ game_id: string }> = await door('/arc3/games');
    const g = games.find((x) => x.game_id.startsWith(gamePrefix));
    if (!g) throw new Error(`live arena does not list ${gamePrefix}`);
    gameId = g.game_id;
    cardId = (await door('/arc3/open', { tags: ['auma', 'arc3-lab'] })).card_id;
    reset = (guid) => door('/arc3/cmd', { name: 'RESET', payload: { game_id: gameId, card_id: cardId, ...(guid ? { guid } : {}) } });
    act = (d, guid) => {
      const reasoning = { agent: 'auma', step: r.step, why: d.reason, tag: d.tag };
      return d.kind === 'click'
        ? door('/arc3/cmd', { name: 'ACTION6', payload: { game_id: gameId, guid, x: d.x, y: d.y, reasoning } })
        : door('/arc3/cmd', { name: `ACTION${d.actionId}`, payload: { game_id: gameId, guid, reasoning } });
    };
  } else {
    const arcade = createMockArcade(seed);
    const g = arcade.listGames().find((x: { game_id: string }) => x.game_id.startsWith(gamePrefix));
    if (!g) throw new Error(`onboard arcade does not know ${gamePrefix}`);
    gameId = g.game_id;
    reset = async (guid) => arcade.reset(gameId, guid ?? undefined);
    act = async (d, guid) => (d.kind === 'click'
      ? arcade.act(gameId, guid, 'ACTION6', d.x, d.y)
      : arcade.act(gameId, guid, `ACTION${d.actionId}`));
  }

  // Opening RESET: the door rolls the backend dice internally; roll again a
  // few times here if all twelve come up empty (measured platform behavior).
  let fr: any = null;
  for (let attempt = 0; attempt < 5 && !fr; attempt++) {
    try { fr = await reset(null); }
    catch (e: any) {
      if (attempt === 4) throw e;
      if (!/not found/i.test(e.message)) throw e;
    }
  }
  let obs = normalizeObs(fr);
  r.begin(obs);
  let noops = 0, novel = 0, steps = 0, rateHits = 0;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(LAB_DIR, { recursive: true });
  const dump = (label: string) => {
    if (obs.grid) { try { savePng(obs.grid, path.join(LAB_DIR, `${stamp}-${gamePrefix}-s${seed}-${label}.png`)); } catch { /* eyes are best-effort */ } }
  };
  let lastLevel = obs.levelsCompleted;
  dump('L1-start');

  while (steps < maxActions) {
    if (obs.state === 'WIN') { endedBy = 'win'; break; }
    if (obs.state === 'GAME_OVER' || obs.state === 'NOT_STARTED') {
      if (lives >= maxLives) { endedBy = 'out of lives'; break; }
      lives++;
      fr = await reset(obs.guid);
      obs = normalizeObs(fr);
      r.rebirth(obs);
      continue;
    }
    const d = r.decide(obs);
    const prev = obs;
    let nextFr;
    try { nextFr = await act(d, obs.guid); }
    catch (e: any) {
      // Pacing pushback is survivable — but only so many times; a wall of
      // 429s must end the run honestly instead of spinning forever.
      if (e.status === 429 && ++rateHits <= 30) { await Bun.sleep(5000); continue; }
      throw e;
    }
    obs = normalizeObs(nextFr);
    const receipt = r.observe(prev, d, obs);
    if (receipt.noop) noops++;
    if (receipt.novel) novel++;
    steps++;
    if (obs.levelsCompleted > lastLevel) {
      lastLevel = obs.levelsCompleted;
      dump(`L${lastLevel + 1}-start`);
    }
  }
  dump(`end-${endedBy.replace(/\W+/g, '_')}-lvl${obs.levelsCompleted}`);

  const won = obs.state === 'WIN';
  if (won || obs.levelsCompleted > 0) {
    meta.learn({ gameId, availableActions: obs.availableActions, mechanic: inferMechanic(r), won, levels: obs.levelsCompleted, steps });
    saveLabMeta(meta);
  }
  if (cardId) { try { await door('/arc3/close', { card_id: cardId }); } catch { /* zero-env close 404s; benign */ } }

  return {
    arena, game: gameId, seed, won,
    levels: obs.levelsCompleted, winLevels: obs.winLevels,
    actions: steps, noops, novel, lives,
    movesPerLife: r.movesPerLife, fuelColor: r.fuelColor,
    mechanic: inferMechanic(r),
    ...(cardId ? { scorecard: cardId } : {}),
    endedBy,
  };
}

async function main() {
  const meta = loadLabMeta();
  const out: RunSummary[] = [];
  console.log(`arc3-lab · ${arena} · ${gamePrefix} · ${runs} run(s) · max ${maxActions} acts · ${blind ? 'BLIND (no meta)' : `meta: ${meta.lessons.length} lessons`}`);
  for (let i = 0; i < runs; i++) {
    const seed = seedBase + i * 7919;
    const t0 = Date.now();
    try {
      const s = await runOnce(seed, meta);
      out.push(s);
      console.log(`run ${i + 1}/${runs} seed ${seed}: ${s.won ? 'WON' : `${s.levels}/${s.winLevels}`} — ${s.actions} acts, ${s.noops} noops, ${s.lives} lives, ${((Date.now() - t0) / 1000).toFixed(0)}s`
        + (s.movesPerLife != null ? `, budget ${s.movesPerLife}/life` : '')
        + (s.fuelColor != null ? `, gauge color-${s.fuelColor}` : '')
        + (s.scorecard ? `, card ${s.scorecard}` : ''));
    } catch (e: any) {
      console.log(`run ${i + 1}/${runs} seed ${seed}: FAILED — ${e.message}`);
      out.push({ arena, game: gamePrefix, seed, won: false, levels: 0, winLevels: 0, actions: 0, noops: 0, novel: 0, lives: 0, movesPerLife: null, fuelColor: null, mechanic: 'n/a', endedBy: `error: ${e.message}` });
    }
  }
  fs.mkdirSync(LAB_DIR, { recursive: true });
  const file = path.join(LAB_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}-${gamePrefix}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\nsummary → ${file}`);
  const wonN = out.filter((s) => s.won).length;
  const bestLevels = Math.max(0, ...out.map((s) => s.levels));
  console.log(`totals: ${wonN}/${out.length} won · best ${bestLevels} level(s) · honest per the ledger law`);
}

main();
