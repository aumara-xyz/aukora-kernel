// Types for the game-agnostic reasoning-loop core (mind.js) — used by
// core/tests and the TS driver (scripts/fable-arc3-auto.ts). The JS stays
// dependency-free browser ESM.

import type { Grid, Observation, Segmentation } from './engine.js';

export const COLOR_NAME: Record<number, string>;
export const MIND_SYSTEM_PROMPT: string;

export function renderGrid(grid: Grid, bg: number): string;
export function renderSegments(seg: Segmentation): string;
export function renderDiff(prev: Grid | null, grid: Grid): { text: string; changedCount: number };
export function renderFrame(obs: Observation, prevGrid: Grid | null): { text: string; changedCount: number };

export function buildTurnMessage(args: {
  moveNo: number;
  movesLeft: number;
  frameText: string;
  noopAction?: string | null;
  noopStreakActions?: string[];
  memo?: string;
  lastPrediction?: string;
  notices?: string[];
}): string;

export interface MindAction {
  name: string;
  x?: number;
  y?: number;
}

export type ParsedMindReply =
  | {
      ok: true;
      action: MindAction;
      plan: Array<{ action: MindAction; expect: string }>;
      whatISee: string;
      delta: string;
      hypothesis: string;
      reason: string;
      prediction: string;
      memo: string;
    }
  | { ok: false; error: string };

export function parseMindReply(text: string): ParsedMindReply;
export function validateAction(action: MindAction, availableActions: number[]): { ok: true } | { ok: false; error: string };

export class TurnWindow {
  constructor(maxPairs?: number);
  maxPairs: number;
  pairs: Array<{ user: string; assistant: string }>;
  push(userText: string, assistantText: string): void;
  messages(newUserText: string): Array<{ role: 'user' | 'assistant'; content: string }>;
}
