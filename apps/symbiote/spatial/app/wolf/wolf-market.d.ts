export const SIM_SOURCE: string;
export const INSTRUMENTS: ReadonlyArray<{ symbol: string; name: string; hue: string; start: number; drift: number; vol: number }>;
export function mulberry32(seed: number): () => number;
export function createMarket(opts?: { seed?: number }): any;
