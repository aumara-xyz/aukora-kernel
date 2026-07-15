export const STATES: readonly string[];
export const MARKS: readonly string[];
export const LAYERS: readonly string[];
export const SUITS: readonly { key: string; gloss: string }[];

export type LuminaraCard = {
  n: number;
  name: string;
  letter: string;
  essence: string;
};

export type LuminaraPosition = {
  key: string;
  name: string;
  gloss: string;
  affinity: number;
};

export type LuminaraReading = {
  sections: Array<{
    position: LuminaraPosition;
    card: LuminaraCard;
    silent: boolean;
    body: string;
  }>;
  vectors: Array<{ line: string }>;
  harmonic: string;
  landing: string;
  summary: string;
  allSilent: boolean;
};

export const CARDS: readonly LuminaraCard[];
export const SILENCES: Record<number, { name: string; asks: string; lines: string[] }>;
export const POSITIONS: readonly LuminaraPosition[];

export function codeOf(n: number): number[];
export function codeMarks(n: number): string;
export function cardOf(n: number): LuminaraCard;
export function isSilent(n: number): boolean;
export function drawThree(seedStr: string): number[];
export function drawOne(seedStr: string, exclude?: number[]): number;
export function composeReading(cast: number[], intention: string | null): LuminaraReading;
export function askAumaText(reading: LuminaraReading): string;
