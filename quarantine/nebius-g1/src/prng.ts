// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Deterministic, seedable PRNG (mulberry32). Pure: given the same 32-bit seed it yields the identical
 * sequence on every platform. Used ONLY to make the evaluator fixture and the genome mutation
 * reproducible — never for cryptography (crypto is exclusively the vendored D6 primitives).
 */

/** Returns a function that yields deterministic floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
