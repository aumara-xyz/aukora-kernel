// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * GenomeV0 — the ONLY thing an evolutionary candidate may carry.
 *
 * GOVERNANCE INVARIANT (Round-22 blocker 4 + 5): the genome is a FIXED, purely-numeric resource policy.
 * It expresses generic admission thresholds, a hysteresis band, and concurrency / rate / backoff limits.
 * It carries NO strings except the schema tag, NO free-form content, NO private research, and — critically —
 * NO way to smuggle its own metrics, evaluator/safety digests, resource measurements, tests, or any
 * authority-shaped field. All numeric fields are integers because the vendored D6 canonicalizer only accepts
 * safe integers (floats have no canonical spelling), so every field is digest-stable by construction.
 *
 * Thresholds are expressed in integer basis points (bp, 1e-4) so a "0.62 admission threshold" is the integer
 * 6200 — numeric, bounded, canonical-safe, and free of any floating-point / string content.
 */
import { textHasSecret, AUTHORITY_KEY_RE } from '../d6/evidence/index';
import { mulberry32 } from './prng';

export const GENOME_SCHEMA = 'aukora-g1-genome-v0';

/** Fixed numeric resource-policy genome. `schema` is the sole string; every other field is a bounded integer. */
export interface GenomeV0 {
  readonly schema: typeof GENOME_SCHEMA;
  /** Admission threshold, basis points [0, 10000]. */
  readonly admitThresholdBp: number;
  /** Release/reject threshold, basis points [0, 10000] — the low edge of the hysteresis loop. */
  readonly rejectThresholdBp: number;
  /** Hysteresis dead-band half-width, basis points [0, 5000]. */
  readonly hysteresisBandBp: number;
  /** Max concurrent recovery workers, integer [1, 64]. */
  readonly maxConcurrency: number;
  /** Admission rate limit per second, integer [1, 1000]. */
  readonly rateLimitPerSec: number;
  /** Recovery backoff, milliseconds, integer [0, 5000]. */
  readonly recoveryBackoffMs: number;
  /** Signed admission bias, basis points [-1000, 1000]. */
  readonly admitBiasBp: number;
}

interface Bound { readonly min: number; readonly max: number }

/** The complete, closed set of numeric fields and their inclusive integer bounds. */
export const GENOME_BOUNDS = {
  admitThresholdBp: { min: 0, max: 10000 },
  rejectThresholdBp: { min: 0, max: 10000 },
  hysteresisBandBp: { min: 0, max: 5000 },
  maxConcurrency: { min: 1, max: 64 },
  rateLimitPerSec: { min: 1, max: 1000 },
  recoveryBackoffMs: { min: 0, max: 5000 },
  admitBiasBp: { min: -1000, max: 1000 },
} as const satisfies Record<string, Bound>;

export type NumericKey = keyof typeof GENOME_BOUNDS;
export const NUMERIC_KEYS = Object.keys(GENOME_BOUNDS) as NumericKey[];
/** The exhaustive, closed key allowlist. Any other own key on a candidate ⇒ refusal. */
export const ALLOWED_KEYS: readonly string[] = ['schema', ...NUMERIC_KEYS];

export type GenomeValidation =
  | { readonly ok: true; readonly value: GenomeV0 }
  | { readonly ok: false; readonly reasons: string[] };

function isSafeInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && Number.isSafeInteger(n) && !Object.is(n, -0);
}

/**
 * validateGenome — the fail-closed gate. REFUSES, with explicit reasons, any candidate that:
 *  - is not a plain object;
 *  - carries an unknown / extra key (this alone rejects smuggled `metrics`, `evaluatorDigest`,
 *    `safetyDigest`, `resourceMeasurements`, `tests`, `grantsAuthority`, `apply`, `sign`, … );
 *  - is missing a required field;
 *  - has a non-integer, -0, or out-of-bounds numeric field;
 *  - has any string other than the fixed `schema` tag;
 *  - has any key or string value that trips the D6 authority-key regex or the D6 secret catalogue
 *    (defense-in-depth over keys AND values).
 */
export function validateGenome(g: unknown): GenomeValidation {
  const reasons: string[] = [];
  if (g === null || typeof g !== 'object' || Array.isArray(g)) {
    return { ok: false, reasons: ['not-a-plain-object'] };
  }
  const obj = g as Record<string, unknown>;
  const keys = Object.keys(obj);

  // Closed-key allowlist: reject any extra/unknown key up front (catches every smuggled field).
  for (const k of keys) {
    if (!ALLOWED_KEYS.includes(k)) reasons.push(`unknown-key:${k}`);
    // Authority-shaped or secret-shaped KEY names are refused even if they were ever allowlisted.
    if (AUTHORITY_KEY_RE.test(k)) reasons.push(`authority-shaped-key:${k}`);
    if (textHasSecret(k)) reasons.push(`secret-shaped-key:${k}`);
  }

  // schema: the one and only string.
  if (obj.schema !== GENOME_SCHEMA) reasons.push('bad-schema');

  // Every numeric field must be present, a safe integer, not -0, and within bounds.
  for (const k of NUMERIC_KEYS) {
    const v = obj[k];
    if (!(k in obj)) { reasons.push(`missing:${k}`); continue; }
    if (!isSafeInt(v)) { reasons.push(`non-integer:${k}`); continue; }
    const b = GENOME_BOUNDS[k];
    if (v < b.min || v > b.max) reasons.push(`out-of-bounds:${k}`);
  }

  // No strings except schema; scan any stray string value for secrets/authority shapes.
  for (const k of keys) {
    if (k === 'schema') continue;
    const v = obj[k];
    if (typeof v === 'string') {
      reasons.push(`unexpected-string:${k}`);
      if (textHasSecret(v)) reasons.push(`secret-string-value:${k}`);
    }
  }

  if (reasons.length > 0) return { ok: false, reasons: Array.from(new Set(reasons)).sort() };
  return { ok: true, value: obj as unknown as GenomeV0 };
}

const MUTATION_RATE = 0.25;

function clampInt(v: number, b: Bound): number {
  let r = Math.round(v);
  if (r < b.min) r = b.min;
  if (r > b.max) r = b.max;
  if (Object.is(r, -0)) r = 0; // Math.round can produce -0; canonicalizer rejects -0
  return r;
}

/**
 * Deterministic in-bounds mutation. Given the same parent and seed it yields the identical child on every
 * platform. Each numeric field takes an independent signed step scaled to its range, then is rounded to an
 * integer and clamped back inside its bounds — so a mutant is always a valid GenomeV0 (never escapes the
 * policy envelope, never introduces a string or an unknown field).
 */
export function mutate(g: GenomeV0, seed: number): GenomeV0 {
  const rnd = mulberry32(seed >>> 0);
  const out: Record<string, unknown> = { schema: GENOME_SCHEMA };
  for (const k of NUMERIC_KEYS) {
    const b = GENOME_BOUNDS[k];
    const range = b.max - b.min;
    const step = (rnd() * 2 - 1) * range * MUTATION_RATE;
    out[k] = clampInt(g[k] + step, b);
  }
  return out as unknown as GenomeV0;
}
