// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * The IMMUTABLE controller (Round-22 — the piece that must be root-owned + immutable on deploy).
 *
 * A candidate genome is inert data. The controller does ALL the work the candidate is forbidden to touch:
 *   - self-checks the vendored D6 tree at the start of every generation, and REFUSES to run if it fails;
 *   - validates the parent and the mutated child against the fixed numeric schema (a genome that carries
 *     metrics/digests/measurements/authority fields is refused here, before anything runs);
 *   - computes the evaluation and safety itself (never from the candidate);
 *   - builds + seals the candidate-bound offline Fu rehearsal artifact and writes it through the containment
 *     resolver (no path escape);
 *   - runs the atomic advance-guard and advances to the child ONLY if every invariant holds, else RETAINS the
 *     parent (never a partial/forward step).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mutate, validateGenome, GENOME_SCHEMA, type GenomeV0 } from './genome';
import { evaluate, EVALUATOR_DIGEST } from './evaluator';
import { safetyOf, SAFETY_DIGEST } from './safety';
import { buildArtifact, verifyArtifact, fixtureCouncil, type SealedArtifact } from './evidence';
import {
  advanceGuard,
  candidateDigest,
  type AdvanceDecision,
  type EvaluatedCandidate,
  type Generation,
} from './lineage';
import { resolveContained } from './containment';
import { verifyD6 } from './d6selfcheck';

export class D6VerificationError extends Error {
  constructor(bundleRoot: string) {
    super(`D6 tracked-tree verification failed for bundle root: ${bundleRoot}`);
    this.name = 'D6VerificationError';
  }
}

export class GenomeRefusedError extends Error {
  readonly which: 'parent' | 'child';
  readonly reasons: string[];
  constructor(which: 'parent' | 'child', reasons: string[]) {
    super(`genome refused (${which}): ${reasons.join(', ')}`);
    this.name = 'GenomeRefusedError';
    this.which = which;
    this.reasons = reasons;
  }
}

/** Default bundle root = the directory two levels up from this source file (…/aukora-g1-bundle). */
export const DEFAULT_BUNDLE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Deliberately suboptimal starting policy: admits almost everything, congested rate, high backoff. */
export const SEED_GENOME: GenomeV0 = {
  schema: GENOME_SCHEMA,
  admitThresholdBp: 200,
  rejectThresholdBp: 100,
  hysteresisBandBp: 0,
  maxConcurrency: 32,
  rateLimitPerSec: 50,
  recoveryBackoffMs: 2000,
  admitBiasBp: 0,
};

export interface RunOptions {
  readonly bundleRoot?: string;
  readonly outDir?: string;
}

export interface GenerationResult {
  readonly generation: number;
  readonly advance: boolean;
  readonly retainParent: boolean;
  readonly refusals: string[];
  readonly nextParent: GenomeV0;
  readonly record: Generation;
  readonly artifact: SealedArtifact;
  readonly artifactPath: string;
  readonly decision: AdvanceDecision;
}

/** Refuse to run unless the vendored D6 tree self-check passes. */
export function assertD6(bundleRoot: string): void {
  if (!verifyD6(bundleRoot)) throw new D6VerificationError(bundleRoot);
}

/**
 * Run one generation. Pure w.r.t. authority; the only side effect is writing the (contained) artifact file.
 * Returns the next parent (child iff the guard advanced, else the unchanged parent) and the lineage record.
 */
export function runGeneration(
  parentGenome: GenomeV0,
  generation: number,
  seed: number,
  opts: RunOptions = {},
): GenerationResult {
  const bundleRoot = opts.bundleRoot ?? DEFAULT_BUNDLE_ROOT;
  const outDir = opts.outDir ?? path.join(bundleRoot, '.g1-out');

  // (1/2 runtime) D6 self-check — refuse to run on any vendored-tree mismatch.
  assertD6(bundleRoot);
  const d6Ok = true; // assertD6 threw otherwise

  // Parent must itself be a clean numeric genome (rejects a parent that smuggled forbidden fields).
  const pv = validateGenome(parentGenome);
  if (!pv.ok) throw new GenomeRefusedError('parent', pv.reasons);

  // Mutate → child, then validate the child (belt-and-suspenders; mutate stays in-bounds by construction).
  const child = mutate(pv.value, seed);
  const cv = validateGenome(child);
  if (!cv.ok) throw new GenomeRefusedError('child', cv.reasons);

  // CONTROLLER computes evaluation + safety — never the candidate.
  const parentEval = evaluate(pv.value);
  const childEval = evaluate(cv.value);
  const parentDigest = candidateDigest(pv.value);
  const childDigest = candidateDigest(cv.value);
  const safety = safetyOf(cv.value, childEval.metrics);
  void safety; // advisory here; the guard re-runs safety authoritatively

  // Build + seal the candidate-bound offline rehearsal artifact.
  const verdict = fixtureCouncil(childDigest, childEval.metrics);
  const artifact = buildArtifact({
    generation,
    parentDigest,
    candidateDigest: childDigest,
    metrics: childEval.metrics,
    resourceMeasurements: childEval.resourceMeasurements,
    evaluatorDigest: EVALUATOR_DIGEST,
    safetyDigest: SAFETY_DIGEST,
    fixtureCouncilVerdict: verdict,
  });

  // Persist through the containment resolver (no path escape, no symlink escape).
  fs.mkdirSync(outDir, { recursive: true });
  const artifactPath = resolveContained(outDir, `gen-${generation}.artifact.json`);
  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));

  // Sanity: the artifact must verify before we even consider advancing.
  if (!verifyArtifact(artifact)) {
    return refusedResult(generation, parentGenome, parentDigest, childDigest, artifact, artifactPath, [
      'artifact-verify-failed',
    ]);
  }

  const parentRec: EvaluatedCandidate = {
    genome: pv.value,
    generation: generation - 1,
    parentDigest: '',
    candidateDigest: parentDigest,
    metrics: parentEval.metrics,
    resourceMeasurements: parentEval.resourceMeasurements,
  };
  const childRec: EvaluatedCandidate = {
    genome: cv.value,
    generation,
    parentDigest,
    candidateDigest: childDigest,
    metrics: childEval.metrics,
    resourceMeasurements: childEval.resourceMeasurements,
  };

  const decision = advanceGuard(parentRec, childRec, artifact, EVALUATOR_DIGEST, SAFETY_DIGEST, d6Ok);
  const nextParent = decision.advance ? cv.value : pv.value;
  const record: Generation = {
    generation,
    parentDigest,
    candidateDigest: childDigest,
    artifactDigest: artifact.digest,
  };

  return {
    generation,
    advance: decision.advance,
    retainParent: decision.retainParent,
    refusals: decision.refusals,
    nextParent,
    record,
    artifact,
    artifactPath,
    decision,
  };
}

function refusedResult(
  generation: number,
  parentGenome: GenomeV0,
  parentDigest: string,
  childDigest: string,
  artifact: SealedArtifact,
  artifactPath: string,
  refusals: string[],
): GenerationResult {
  return {
    generation,
    advance: false,
    retainParent: true,
    refusals,
    nextParent: parentGenome,
    record: { generation, parentDigest, candidateDigest: childDigest, artifactDigest: artifact.digest },
    artifact,
    artifactPath,
    decision: { advance: false, retainParent: true, refusals },
  };
}

export interface RunSummary {
  readonly finalParent: GenomeV0;
  readonly generations: GenerationResult[];
}

/** Deterministic multi-generation driver starting from SEED_GENOME. */
export function runGenerations(seed0: number, count: number, opts: RunOptions = {}): RunSummary {
  const bundleRoot = opts.bundleRoot ?? DEFAULT_BUNDLE_ROOT;
  assertD6(bundleRoot);
  let parent: GenomeV0 = SEED_GENOME;
  const generations: GenerationResult[] = [];
  for (let g = 1; g <= count; g++) {
    const seed = (Math.imul(seed0 ^ g, 2654435761) ^ (g * 40503)) >>> 0;
    const res = runGeneration(parent, g, seed, { bundleRoot, outDir: opts.outDir });
    generations.push(res);
    parent = res.nextParent;
  }
  return { finalParent: parent, generations };
}
