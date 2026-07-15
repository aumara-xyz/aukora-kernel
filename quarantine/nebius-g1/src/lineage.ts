// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Lineage + the atomic advance-guard (Round-22 blockers 6 + 8).
 *
 * candidateDigest(genome) is the D6 packDigest over the canonical genome. A Generation records the atomic
 * parent→child linkage {generation, parentDigest, candidateDigest, artifactDigest}.
 *
 * advanceGuard is the sole arbiter of a step. It advances to the child ONLY if EVERY invariant holds; ANY
 * failure ⇒ the PARENT is retained (never a partial or forward step). Crucially the guard RE-COMPUTES the
 * metrics and resource measurements from the immutable evaluator and re-runs the safety contract, so a
 * candidate can neither supply nor tamper with its own measurements: a mismatch is a refusal.
 */
import * as fs from 'node:fs';
import { packDigest } from '../d6/evidence/index';
import { evaluate, EVALUATOR_DIGEST, type Metrics, type Resources } from './evaluator';
import { safetyOf, SAFETY_DIGEST } from './safety';
import { verifyArtifact, type SealedArtifact } from './evidence';
import { writeContainedAtomic, resolveContained } from './containment';
import type { GenomeV0 } from './genome';

/** The D6 packDigest over the canonical genome (candidate identity). */
export function candidateDigest(genome: GenomeV0): string {
  return packDigest(genome);
}

export interface Generation {
  readonly generation: number;
  readonly parentDigest: string;
  readonly candidateDigest: string;
  readonly artifactDigest: string;
}

const HEX64_RE = /^[0-9a-f]{64}$/;

/** Structural validation of a persisted lineage record read back from disk (fail-closed). */
function isGenerationRecord(x: unknown): x is Generation {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  if (Object.keys(o).length !== 4) return false; // exact-key closed
  if (!Number.isSafeInteger(o.generation) || (o.generation as number) < 1) return false;
  if (typeof o.candidateDigest !== 'string' || !HEX64_RE.test(o.candidateDigest)) return false;
  if (typeof o.artifactDigest !== 'string' || !HEX64_RE.test(o.artifactDigest)) return false;
  // parentDigest is a 64-hex digest, or '' for the genesis parent record.
  if (typeof o.parentDigest !== 'string' || (o.parentDigest !== '' && !HEX64_RE.test(o.parentDigest))) return false;
  return true;
}

/**
 * DURABLE lineage (R23 blocker 8). Persist one generation record as its own file, written through the
 * containment atomic writer: temp + fsync + rename. A crash therefore leaves EITHER no file OR a complete file
 * (never a half record), and the write cannot follow a symlink out of the lineage directory. Returns the path.
 */
export function persistGenerationRecord(lineageDir: string, rec: Generation): string {
  return writeContainedAtomic(lineageDir, `gen-${rec.generation}.json`, JSON.stringify(rec, null, 2) + '\n');
}

/**
 * Read the durable lineage back, in generation order. Only fully-written `gen-<n>.json` records are read;
 * the atomic writer's hidden `.gen-*.tmp-*` temporaries (a crash mid-write) are ignored, so a partial write is
 * invisible. A structurally-invalid record file makes the whole read fail closed (returns null).
 */
export function readLineage(lineageDir: string): Generation[] | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(lineageDir);
  } catch {
    return [];
  }
  const files = entries.filter((f) => /^gen-\d+\.json$/.test(f));
  const recs: Generation[] = [];
  for (const f of files) {
    let abs: string;
    try {
      abs = resolveContained(lineageDir, f); // never follow a symlink back out
    } catch {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch {
      return null;
    }
    if (!isGenerationRecord(parsed)) return null;
    recs.push(parsed);
  }
  recs.sort((a, b) => a.generation - b.generation);
  return recs;
}

/**
 * Verify a durable lineage chain, encoding the ATOMIC-ADVANCEMENT invariant. A "generation" here is an
 * evaluation attempt; the deployed parent changes ONLY when a child advances. Therefore, for each step after
 * the first, the record's parentDigest must be EITHER the previous record's parentDigest (the parent was
 * retained) OR the previous record's candidateDigest (the previous child advanced and became the parent) — it
 * can never jump to any other value. Generations must also be sequential 1..N with no gap or repeat. The first
 * record's parent is the genesis parent digest (a 64-hex digest, or '' if none). Empty chain ⇒ true.
 */
export function verifyLineageChain(records: readonly Generation[]): boolean {
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.generation !== i + 1) return false; // sequential, no gap/repeat
    if (i === 0) {
      if (r.parentDigest !== '' && !HEX64_RE.test(r.parentDigest)) return false;
    } else {
      const prev = records[i - 1];
      const retained = r.parentDigest === prev.parentDigest;
      const advanced = r.parentDigest === prev.candidateDigest;
      if (!retained && !advanced) return false; // parent neither held nor advanced-to-prev-candidate
    }
  }
  return true;
}

/** A fully controller-evaluated candidate. Metrics/resources here always come from the immutable evaluator. */
export interface EvaluatedCandidate {
  readonly genome: GenomeV0;
  readonly generation: number;
  readonly parentDigest: string;
  readonly candidateDigest: string;
  readonly metrics: Metrics;
  readonly resourceMeasurements: Resources;
}

export interface AdvanceDecision {
  readonly advance: boolean;
  readonly retainParent: boolean;
  readonly refusals: string[];
}

function metricsEqual(a: Metrics, b: Metrics): boolean {
  return a.admitAccuracy === b.admitAccuracy && a.recoveryLatency === b.recoveryLatency && a.cost === b.cost;
}

function resourcesEqual(a: Resources, b: Resources): boolean {
  return a.steps === b.steps && a.peakBytes === b.peakBytes && a.toolCalls === b.toolCalls;
}

/** Strict Pareto domination: the child must be strictly better on EVERY objective. */
export function strictlyDominates(child: Metrics, parent: Metrics): boolean {
  return (
    child.admitAccuracy > parent.admitAccuracy &&
    child.recoveryLatency < parent.recoveryLatency &&
    child.cost < parent.cost
  );
}

/**
 * advanceGuard — atomic, fail-closed. Returns advance only when all of the following hold; otherwise the
 * parent is retained and every failed invariant is listed in `refusals`:
 *   1. D6 tracked-tree self-check passed (pinnedD6Ok).
 *   2. sequential generation (child = parent + 1).
 *   3. correct parent linkage (child.parentDigest === parent.candidateDigest).
 *   4. candidate digests recompute (parent & child) from their genomes.
 *   5. the rehearsal artifact verifies (framed digest + shape + no secrets) and binds this exact child.
 *   6. artifact evaluator/safety digests equal the pinned immutable digests.
 *   7. controller-recomputed metrics/resources match what the child & artifact claim (no self-measurement).
 *   8. safety passes and its digest matches the pinned one.
 *   9. child metrics strictly dominate the parent.
 */
export function advanceGuard(
  parent: EvaluatedCandidate,
  child: EvaluatedCandidate,
  artifact: SealedArtifact,
  pinnedEvaluatorDigest: string,
  pinnedSafetyDigest: string,
  pinnedD6Ok: boolean,
): AdvanceDecision {
  const refusals: string[] = [];

  // 1. D6 integrity.
  if (pinnedD6Ok !== true) refusals.push('d6-verification-failed');

  // 2. sequential generation.
  if (child.generation !== parent.generation + 1) refusals.push('non-sequential-generation');

  // 3. parent linkage.
  if (child.parentDigest !== parent.candidateDigest) refusals.push('parent-linkage-mismatch');

  // 4. candidate digests recompute from the genomes themselves.
  if (candidateDigest(parent.genome) !== parent.candidateDigest) refusals.push('parent-candidate-digest-mismatch');
  if (candidateDigest(child.genome) !== child.candidateDigest) refusals.push('child-candidate-digest-mismatch');

  // 5. artifact verifies and binds THIS child.
  if (!verifyArtifact(artifact)) {
    refusals.push('artifact-verify-failed');
  } else {
    const b = artifact.body;
    if (b.generation !== child.generation) refusals.push('artifact-generation-mismatch');
    if (b.candidateDigest !== child.candidateDigest) refusals.push('artifact-candidate-mismatch');
    if (b.parentDigest !== parent.candidateDigest) refusals.push('artifact-parent-mismatch');
    if (b.evaluatorDigest !== pinnedEvaluatorDigest) refusals.push('evaluator-digest-mismatch');
    if (b.safetyDigest !== pinnedSafetyDigest) refusals.push('safety-digest-mismatch');
  }

  // 6. pinned digests must be the module's immutable ones (defense-in-depth against a swapped pin).
  if (pinnedEvaluatorDigest !== EVALUATOR_DIGEST) refusals.push('pinned-evaluator-digest-unrecognized');
  if (pinnedSafetyDigest !== SAFETY_DIGEST) refusals.push('pinned-safety-digest-unrecognized');

  // 7. RE-MEASURE with the immutable evaluator — the candidate cannot supply/forge measurements.
  const reChild = evaluate(child.genome);
  const reParent = evaluate(parent.genome);
  if (!metricsEqual(reChild.metrics, child.metrics)) refusals.push('child-metrics-not-reproducible');
  if (!resourcesEqual(reChild.resourceMeasurements, child.resourceMeasurements)) refusals.push('child-resources-not-reproducible');
  if (!metricsEqual(reParent.metrics, parent.metrics)) refusals.push('parent-metrics-not-reproducible');
  if (verifyArtifact(artifact)) {
    const b = artifact.body;
    if (!metricsEqual(b.metrics, reChild.metrics)) refusals.push('artifact-metrics-mismatch');
    if (!resourcesEqual(b.resourceMeasurements, reChild.resourceMeasurements)) refusals.push('artifact-resources-mismatch');
  }

  // 8. safety (fail-closed) over the re-measured metrics; digest must match the pin.
  const safety = safetyOf(child.genome, reChild.metrics);
  if (!safety.safe) refusals.push(`unsafe:${safety.reasons.join('|')}`);
  if (safety.safetyDigest !== pinnedSafetyDigest) refusals.push('safety-digest-recompute-mismatch');

  // 9. strict domination (fitness). Only reached as the last gate; a non-dominating child retains the parent.
  if (!strictlyDominates(reChild.metrics, reParent.metrics)) refusals.push('not-dominating');

  const advance = refusals.length === 0;
  return { advance, retainParent: !advance, refusals: refusals.sort() };
}
