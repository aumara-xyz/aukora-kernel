// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * The CONTROLLER-ONLY safety contract (Round-22 blocker 5). Fails closed.
 *
 * safetyOf(genome, metrics) → { safe, reasons, safetyDigest }. A candidate can neither run nor influence this
 * check: only the immutable controller invokes it, over metrics the immutable evaluator produced. SAFETY_DIGEST
 * binds this module's pinned identity; a mutated safety contract changes the digest, which the advance-guard
 * detects.
 */
import { sha256Hex, canonicalBytes } from '../d6/evidence/index';
import { validateGenome, type GenomeV0 } from './genome';
import type { Metrics } from './evaluator';

export const SAFETY_IDENTITY = {
  safety: 'aukora-g1-safety-v0',
  accuracyFloorPerMille: 500,
  latencyCeiling: 100000,
  costCeiling: 5000,
} as const;

export const SAFETY_DIGEST: string = sha256Hex(canonicalBytes(SAFETY_IDENTITY));

export interface SafetyResult {
  readonly safe: boolean;
  readonly reasons: string[];
  readonly safetyDigest: string;
}

/** Fail-closed safety: an out-of-bounds genome or any breached ceiling/floor makes the candidate unsafe. */
export function safetyOf(genome: GenomeV0, metrics: Metrics): SafetyResult {
  const reasons: string[] = [];

  const gv = validateGenome(genome);
  if (!gv.ok) reasons.push('genome-invalid');

  if (!(metrics.admitAccuracy >= SAFETY_IDENTITY.accuracyFloorPerMille)) reasons.push('accuracy-below-floor');
  if (!(metrics.recoveryLatency <= SAFETY_IDENTITY.latencyCeiling)) reasons.push('latency-above-ceiling');
  if (!(metrics.cost <= SAFETY_IDENTITY.costCeiling)) reasons.push('cost-above-ceiling');

  return { safe: reasons.length === 0, reasons, safetyDigest: SAFETY_DIGEST };
}
