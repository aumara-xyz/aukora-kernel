// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
//
// MK·PULSE — "find the silent door." Her first architecture-as-game contact
// (THE GREAT MERGE #178, Phase C rung 0): the node's own surfaces rendered as
// unlabeled, per-session-shuffled tiles, spoken in the exact FrameResponse
// contract the blind engine already plays. A click is ONE real read-only
// loopback status probe — the same check `bun run start` performs. Nothing is
// written anywhere; the sign line is untouched by construction.
//
// Round 3 (latency bands): probes now MEASURE. A door can be fast, slow, or
// silent — and slow is not dead. Each probed tile wears its band as color and
// carries a speed strip that shrinks as the door degrades; only the SILENT
// door wins when marked, so slow decoys must be told apart from the dead.
// The probe budget itself is drawn as a draining bar — a real gauge on her
// own body, food for the engine's drain-watch and death-ledger.
//
// The blind law holds: tile placement shuffles per session, so which tile
// answers to which surface must be EARNED from observed deltas.
//
// Conflicting probes of the SAME tile (answered before, silent now) are not
// averaged away — they interfere. We express that through the aukora-fu v8
// primitives (`tilde`, `decayShear`) as first-class Contradiction objects
// riding the frame response, advisory-only. Reused, not rebuilt. A band
// shift (fast→slow) is degradation, not negation — it drains the strip but
// is no contradiction.

import { tilde, decayShear } from '../core/src/aukoraFuEngine';
import type { Contradiction, GlyphPacket } from '../core/src/aukoraFuEngine';

export interface PulseSurface { name: string; url: string; }
export interface ProbeReading { up: boolean; ms: number; }
export type Prober = (url: string) => Promise<ProbeReading>;

// The node's doors. `hollow` is the honest control: a real probe of a real
// address that CANNOT answer — port 1 (tcpmux) needs root to bind, so no
// sibling lane can ever squat it (7097 got claimed within a day; structural
// silence beats registry silence). The world thereby always contains at
// least one silent door, even on a perfectly healthy node.
export const NODE_SURFACES: PulseSurface[] = [
  { name: 'spatial', url: 'http://127.0.0.1:7090/' },
  { name: 'chat-door', url: 'http://127.0.0.1:7091/' },
  { name: 'arc-door', url: 'http://127.0.0.1:7093/arc3/status' },
  { name: 'brain', url: 'http://127.0.0.1:3210/' },
  { name: 'hollow', url: 'http://127.0.0.1:1/' },
];

const W = 64, H = 64, TILE = 8;
const ACTION_CAP = 24;   // moves per life — rendered as the draining bar below
const LEVELS = 2;
const DEFAULT_SLOW_MS = 250;

// Candidate tile anchors, spread so segmentation reads five clean islands.
// (Anchors leave room for each tile's speed strip on the row beneath it.)
const SLOTS: Array<{ x: number; y: number }> = [
  { x: 8, y: 8 }, { x: 44, y: 8 }, { x: 26, y: 22 },
  { x: 8, y: 38 }, { x: 44, y: 38 }, { x: 26, y: 46 },
];

// Colors: unknown 5 (gray), fast 3 (green), slow 4 (yellow), silent 9 (dark
// red); speed strips 12; the probe-budget bar 13. Background 0.
const C_BG = 0, C_UNKNOWN = 5, C_FAST = 3, C_SLOW = 4, C_DOWN = 9, C_STRIP = 12, C_BUDGET = 13;

function lcg(seed: number) {
  // scramble + warm up so neighbouring seeds land on different orbits
  // (Math.imul, not * — the float product aliases the low 32 bits)
  let s = Math.imul(seed ^ 0x9e3779b9, 2654435761) >>> 0;
  const next = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  next(); next(); next();
  return next;
}

type Band = 'unknown' | 'fast' | 'slow' | 'down';

interface Tile {
  surface: PulseSurface;
  x: number; y: number;
  state: Band;
  probes: number;
  lastPacket: GlyphPacket | null;
}

function packet(surface: PulseSurface, reading: ProbeReading, slowMs: number, probeN: number): GlyphPacket {
  const band: Band = reading.up ? (reading.ms < slowMs ? 'fast' : 'slow') : 'down';
  return {
    modelId: `probe:${surface.name}#${probeN}`,
    stance: reading.up ? '⊕' : '⊖',
    confidence: probeN >= 2 ? '↑' : '→',
    strategy: '⇄',
    distribution: reading.up
      ? (band === 'fast'
        ? { explore: 0.1, exploit: 0.5, verify: 0.35, abstain: 0.05 }
        : { explore: 0.2, exploit: 0.3, verify: 0.4, abstain: 0.1 })
      : { explore: 0.45, exploit: 0.05, verify: 0.15, abstain: 0.35 },
    framework: 'embodied',
    hypothesis: band === 'fast' ? `${surface.name} answers quickly`
      : band === 'slow' ? `${surface.name} answers, but slowly — degraded is not dead`
        : `${surface.name} is silent`,
    reasoning: `lived loopback probe #${probeN} (${reading.up ? `${reading.ms}ms` : 'no answer'})`,
    timestamp: Date.now(),
  };
}

export interface PulseFrameResponse {
  game_id: string;
  guid: string;
  frame: number[][][];
  state: 'NOT_FINISHED' | 'WIN' | 'GAME_OVER';
  levels_completed: number;
  win_levels: number;
  available_actions: number[];
  action_input: { id: number; data: Record<string, unknown> };
  // Advisory extras (unknown fields are ignored by the engine):
  pulse_contradictions: Array<{ id: string; about: string; shearNow: number; status: Contradiction['phaseLockStatus'] }>;
}

export function createPulseSession(opts: {
  seed?: number;
  guid?: string;
  prober: Prober;
  surfaces?: PulseSurface[];
  slowMs?: number;
}) {
  const surfaces = opts.surfaces ?? NODE_SURFACES;
  const slowMs = opts.slowMs ?? DEFAULT_SLOW_MS;
  const guid = opts.guid ?? `pulse-${Math.floor(Math.random() * 1e9).toString(16)}`;
  const baseSeed = (opts.seed ?? (Date.now() % 1e6)) >>> 0;
  let level = 0;
  let actions = 0;
  let dead = false;
  let tiles: Tile[] = [];
  const contradictions: Contradiction[] = [];
  let finding: { surface: PulseSurface; level: number; probes: number } | null = null;

  function shuffleTiles(): void {
    const rng = lcg(baseSeed + level * 7919);
    const slots = SLOTS.slice();
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    tiles = surfaces.map((surface, i) => ({
      surface, x: slots[i].x, y: slots[i].y, state: 'unknown' as const, probes: 0, lastPacket: null,
    }));
  }
  shuffleTiles();

  function grid(): number[][] {
    const g = Array.from({ length: H }, () => new Array(W).fill(C_BG));
    for (const t of tiles) {
      const c = t.state === 'unknown' ? C_UNKNOWN : t.state === 'fast' ? C_FAST : t.state === 'slow' ? C_SLOW : C_DOWN;
      for (let y = t.y; y < t.y + TILE; y++) for (let x = t.x; x < t.x + TILE; x++) g[y][x] = c;
      // the speed strip: a probed door wears its health under its tile —
      // fast fills it, slow leaves a stub, silent leaves nothing
      const lit = t.state === 'fast' ? TILE : t.state === 'slow' ? 3 : 0;
      for (let x = t.x; x < t.x + lit; x++) g[t.y + TILE + 1][x] = C_STRIP;
    }
    // the probe budget, drawn honestly: two rows that drain one column per
    // action — her own action economy as a gauge on her own body
    const remaining = Math.max(0, ACTION_CAP - actions);
    for (let i = 0; i < remaining; i++) { g[61][2 + i] = C_BUDGET; g[62][2 + i] = C_BUDGET; }
    return g;
  }

  function frame(): PulseFrameResponse {
    return {
      game_id: 'pulse-node',
      guid,
      frame: [grid()],
      state: dead ? 'GAME_OVER' : level >= LEVELS ? 'WIN' : 'NOT_FINISHED',
      levels_completed: level,
      win_levels: LEVELS,
      available_actions: [6],
      action_input: { id: 0, data: {} },
      pulse_contradictions: contradictions.map((c) => ({
        id: c.id,
        about: c.id.split('~')[1] ?? c.id,
        shearNow: decayShear(c),
        status: c.phaseLockStatus,
      })),
    };
  }

  return {
    guid,
    // The naming, handed over exactly once — the door may turn it into an
    // advisory work-order draft through the proposal ceremony.
    takeFinding(): { surface: PulseSurface; level: number; probes: number } | null {
      const f = finding;
      finding = null;
      return f;
    },
    reset(): PulseFrameResponse {
      actions = 0;
      dead = false;
      // same level, same seed: a fresh life replays the same shuffled board,
      // the platform way — what a death taught carries into the next life
      shuffleTiles();
      return frame();
    },
    async act(name: string, x?: number, y?: number): Promise<PulseFrameResponse> {
      if (dead || level >= LEVELS) return frame();
      actions++;
      if (actions > ACTION_CAP) { dead = true; return frame(); }
      if (name !== 'ACTION6' || x == null || y == null) return frame();
      const t = tiles.find((tt) => x >= tt.x && x < tt.x + TILE && y >= tt.y && y < tt.y + TILE);
      if (!t) return frame();
      const wasState = t.state;
      const wasPacket = t.lastPacket;
      let reading: ProbeReading;
      try { reading = await opts.prober(t.surface.url); } catch { reading = { up: false, ms: 0 }; }
      t.probes++;
      const pkt = packet(t.surface, reading, slowMs, t.probes);
      // Interference: the same door NEGATING itself across probes (answered
      // before, silent now — or back) is a contradiction, first-class,
      // φ-decaying, never averaged away. A band shift within "answering"
      // (fast→slow) is degradation, not negation: the strip drains, no ~.
      const wasUp = wasState === 'fast' || wasState === 'slow';
      if (wasPacket && ((wasUp && !reading.up) || (wasState === 'down' && reading.up))) {
        contradictions.push(tilde(wasPacket, pkt));
        if (contradictions.length > 16) contradictions.shift();
      }
      t.lastPacket = pkt;
      // The MARK: re-probing a door already known silent is the commitment —
      // still silent means she has NAMED the silent door. Level falls. A
      // marked SLOW door answers instead: a spent action, not a win — the
      // whole discrimination in one rule.
      if (wasState === 'down' && !reading.up) {
        finding = { surface: t.surface, level: level + 1, probes: t.probes };
        level++;
        actions = 0;
        if (level < LEVELS) shuffleTiles();
        return frame();
      }
      t.state = reading.up ? (reading.ms < slowMs ? 'fast' : 'slow') : 'down';
      return frame();
    },
  };
}
