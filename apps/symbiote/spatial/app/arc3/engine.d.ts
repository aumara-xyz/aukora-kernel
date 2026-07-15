// Types for the AGI · ARC 3 reasoning engine (engine.js) — used by core/tests
// and any TS driver. The JS stays dependency-free browser ESM.

export const GRADES: string[];
export const SIMPLE_ACTIONS: number[];
export const CLICK_ACTION: number;

export type Grid = number[][];

export interface FrameResponseLike {
  game_id: string;
  guid: string;
  frame: Grid[];
  state: 'NOT_FINISHED' | 'NOT_STARTED' | 'WIN' | 'GAME_OVER';
  levels_completed?: number;
  win_levels?: number;
  action_input?: { id?: number; data?: Record<string, unknown> };
  available_actions?: number[];
}

export interface Observation {
  gameId: string;
  guid: string;
  grid: Grid | null;
  hash: string;
  state: string;
  levelsCompleted: number;
  winLevels: number;
  availableActions: number[];
  segments: Segmentation | null;
}

export interface Region {
  color: number;
  size: number;
  box: { x0: number; y0: number; x1: number; y1: number };
  cx: number;
  cy: number;
}

export interface Segmentation {
  background: number;
  regions: Region[];
}

export interface Decision {
  kind: 'simple' | 'click';
  actionId?: number;
  x?: number;
  y?: number;
  reason: string;
  tag: string;
}

export interface Receipt {
  step: number;
  action: { id: number; x?: number; y?: number };
  reason: string;
  tag: string;
  hashBefore: string;
  hashAfter: string;
  changed: number;
  changedRaw: number;
  noop: boolean;
  novel: boolean;
  levelsCompleted: number;
  state: string;
  levelUp?: boolean;
}

export interface Hypothesis {
  id: string;
  text: string;
  confidence: number;
  grade: 'di' | 'intu' | 'moga';
  at: number;
}

export function lastGrid(frames: Grid[]): Grid | null;
export function frameHash(grid: Grid): string;
export function diffFrames(a: Grid | null, b: Grid | null): {
  changed: number;
  cells: Array<{ x: number; y: number; from: number; to: number }>;
  box: { x0: number; y0: number; x1: number; y1: number } | null;
};
export function segment(grid: Grid | null, maxRegions?: number): Segmentation;
export function colorCentroid(grid: Grid, color: number): { x: number; y: number; n: number } | null;
export function mulberry32(seed: number): () => number;
export function normalizeObs(fr: FrameResponseLike): Observation;
export function inferMechanic(reasoner: Reasoner): string;

export class Reasoner {
  constructor(opts?: { rng?: () => number; seed?: number; meta?: MetaMind | null });
  actions: number[];
  canClick: boolean;
  step: number;
  level: number;
  phase: string;
  strategy: string;
  selfColor: number | null;
  dirMap: Map<number, { dx: number; dy: number }>;
  graph: Map<string, { out: Map<string, string>; seen: number; pos?: { x: number; y: number } }>;
  curHash: string | null;
  clickTried: Array<{ x: number; y: number; changed: number }>;
  hypotheses: Hypothesis[];
  receipts: Receipt[];
  goal: { x: number; y: number; color: number; box?: Region['box']; why: string } | null;
  chromeCells: number;
  /** di — moves per life, fixed only by a watched death (null until then). */
  movesPerLife: number | null;
  /** the budget gauge's color, once caught (null until then). */
  fuelColor: number | null;
  /** reset the per-life counters after a watched death. */
  rebirth(obs: Observation): void;
  /** remaining moves this life, when a watched death fixed the budget; null before. */
  budgetRemaining(): number | null;
  begin(obs: Observation): void;
  decide(obs: Observation): Decision;
  observe(prevObs: Observation, decision: Decision, nextObs: Observation): Receipt;
  worldHash(grid: Grid): string;
  summary(): {
    phase: string;
    strategy: string;
    selfColor: number | null;
    directions: Record<string, string>;
    statesSeen: number;
    steps: number;
    level: number;
    hypotheses: Hypothesis[];
  };
}

export interface Lesson {
  at: string;
  gameId: string;
  fingerprint: string;
  mechanic: string;
  won: boolean;
  levels: number;
  steps: number;
}

export class MetaMind {
  constructor(data?: { lessons?: Lesson[] } | null);
  lessons: Lesson[];
  static fingerprint(availableActions: number[]): string;
  learn(args: { gameId: string; availableActions: number[]; mechanic: string; won: boolean; levels: number; steps: number }): void;
  /** drop lessons for a game family (null = all); returns how many were forgotten. */
  forget(gameId: string | null): number;
  prior(availableActions: number[]): { mechanic: string; support: number; confidence: number } | null;
  toJSON(): { lessons: Lesson[] };
}
