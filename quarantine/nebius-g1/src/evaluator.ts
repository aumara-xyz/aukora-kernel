// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * The CONTROLLER-ONLY evaluator (Round-22 blocker 5).
 *
 * A candidate genome can NEVER measure itself. This module — part of the immutable controller surface —
 * runs a DETERMINISTIC synthetic challenge/recovery workload against a FIXED, seeded fixture and returns the
 * metrics and resource measurements. Same genome ⇒ byte-identical result, on every platform, forever.
 *
 * All returned numbers are integers so they canonicalize under the vendored D6 primitives (which reject
 * floats). EVALUATOR_DIGEST binds this module's pinned identity constant: mutate the evaluator's definition
 * and the digest changes, so the immutable advance-guard can detect a swapped evaluator.
 */
import { sha256Hex, canonicalBytes } from '../d6/evidence/index';
import { mulberry32 } from './prng';
import type { GenomeV0 } from './genome';

export interface Metrics {
  /** Admission accuracy in per-mille [0, 1000] (integer). Higher is better. */
  readonly admitAccuracy: number;
  /** Accumulated recovery latency (integer, ms-scale). Lower is better. */
  readonly recoveryLatency: number;
  /** Aggregate resource cost (integer, abstract units). Lower is better. */
  readonly cost: number;
}

export interface Resources {
  /** Simulation steps executed (integer). */
  readonly steps: number;
  /** Peak memory estimate in bytes (integer). */
  readonly peakBytes: number;
  /** Recovery tool-calls made (integer). */
  readonly toolCalls: number;
}

export interface EvalResult {
  readonly metrics: Metrics;
  readonly resourceMeasurements: Resources;
}

/**
 * Pinned evaluator identity. The digest is taken over these bytes; any change to the workload's defining
 * constants (or a wholesale evaluator swap that changes this tag) re-derives EVALUATOR_DIGEST.
 */
export const EVALUATOR_IDENTITY = {
  evaluator: 'aukora-g1-evaluator-v0',
  fixtureSeed: 24029,
  fixtureSize: 200,
  fixtureCutoff: 620,
} as const;

export const EVALUATOR_DIGEST: string = sha256Hex(canonicalBytes(EVALUATOR_IDENTITY));

interface FixtureEvent {
  readonly load: number; // 0..999
  readonly shouldAdmit: boolean;
  readonly recoveryCost: number; // 1..10
}

/** Build the fixed fixture ONCE, from the pinned seed — never from any candidate-supplied value. */
function buildFixture(): readonly FixtureEvent[] {
  const rnd = mulberry32(EVALUATOR_IDENTITY.fixtureSeed);
  const cutoff = EVALUATOR_IDENTITY.fixtureCutoff;
  const out: FixtureEvent[] = [];
  for (let i = 0; i < EVALUATOR_IDENTITY.fixtureSize; i++) {
    const load = Math.floor(rnd() * 1000);
    const noisy = rnd() < 0.05; // fixed 5% label noise
    const base = load >= cutoff;
    const shouldAdmit = noisy ? !base : base;
    const recoveryCost = 1 + Math.floor(rnd() * 10);
    out.push({ load, shouldAdmit, recoveryCost });
  }
  return out;
}

const FIXTURE: readonly FixtureEvent[] = buildFixture();

/**
 * Deterministic evaluation. The genome's thresholds drive a hysteretic admission controller over the fixture;
 * mis-admissions trigger bounded recovery (a tool call plus concurrency-shared backoff). Returns integer
 * metrics and resource measurements.
 */
export function evaluate(genome: GenomeV0): EvalResult {
  const admitCut = genome.admitThresholdBp / 10 + genome.admitBiasBp / 20; // load-space
  const rejectCut = genome.rejectThresholdBp / 10;
  const band = genome.hysteresisBandBp / 20;
  const parallel = Math.max(1, genome.maxConcurrency);

  let admitting = false;
  let errors = 0;
  let toolCalls = 0;
  let latency = 0;
  let steps = 0;

  for (const e of FIXTURE) {
    steps++;
    if (!admitting) {
      if (e.load >= admitCut + band) admitting = true;
    } else if (e.load < rejectCut - band) {
      admitting = false;
    }
    if (admitting !== e.shouldAdmit) {
      errors++;
      toolCalls++;
      latency += (e.recoveryCost * genome.recoveryBackoffMs) / parallel;
    }
    if (genome.rateLimitPerSec < 100) steps++; // congestion adds a step
  }

  const total = FIXTURE.length;
  const admitAccuracy = Math.round(((total - errors) / total) * 1000);
  const recoveryLatency = Math.round(latency);
  const cost = Math.round(genome.maxConcurrency * 10 + genome.rateLimitPerSec / 10 + errors * 25);
  const peakBytes = genome.maxConcurrency * 4096;

  return {
    metrics: { admitAccuracy, recoveryLatency, cost },
    resourceMeasurements: { steps, peakBytes, toolCalls },
  };
}
