// Types for the onboard arcade (mock-arcade.js).
import type { FrameResponseLike } from './engine';

export interface MockGameInfo {
  game_id: string;
  title: string;
  blurb: string;
  local: true;
}

export interface MockArcade {
  listGames(): MockGameInfo[];
  reset(gameId: string, guid?: string | null): FrameResponseLike;
  act(gameId: string, guid: string, actionName: string, x?: number, y?: number): FrameResponseLike;
}

export function createMockArcade(seed?: number): MockArcade;
