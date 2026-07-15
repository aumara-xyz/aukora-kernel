// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * latentPerceiver.ts — The Auma Perceiver (EVIDENCE-ONLY sensor, NOT a signer).
 *
 * From Open Weave V2: instead of parsing English prose, it reads the probability distributions (logprobs) of
 * the swarm over safety states (GREEN/YELLOW/RED), computes Kullback–Leibler divergence between them, and
 * derives a "pinch" — a proxy for how much the statistical manifold disagrees. A high pinch is an ADDRESS for
 * governed self-repair: it can detect disagreement, trigger a DRAFT, and create EVIDENCE.
 *
 * HARD LINE (cohesion rail): the Perceiver is a SENSOR. It can never authorize, execute, promote, bypass
 * AUMLOK/PoP, or change a gate verdict. Its output is advisoryOnly / evidenceOnly / grantsAuthority=false. It
 * is registered in advisoryOrganRegistry; the gate (index.ts) imports it NOT AT ALL (strip-neutral by rail).
 * Inputs are validated and FAIL CLOSED to a quarantined conflict — a low pinch never means "safe".
 */
import type { SelfEditProposal } from './selfEditLoop';

export interface ProbabilityDistribution {
  green: number;
  yellow: number;
  red: number;
}

export interface PerceiverVerdict {
  coherenceScore: number; // 0 = perfect agreement, 1 = perfect coherence
  curvature: number;      // PROXY for metric pinch (= avgDivergence*10); NOT true manifold curvature
  verdict: 'GREEN' | 'YELLOW' | 'RED';
  divergenceMatrix: number[][];
}

const EPSILON = 1e-9;
export const PERCEIVER_CONFLICT_THRESHOLD = 1.0; // pinch at/above this is a structural conflict
const QUARANTINE_PINCH = 1e6;                     // bounded sentinel for malformed/empty input (never Infinity)

/** A probability input is valid only if every component is a finite, non-negative number with a positive total. */
export function isValidDistribution(d: unknown): d is ProbabilityDistribution {
  if (!d || typeof d !== 'object') return false;
  const { green, yellow, red } = d as Record<string, unknown>;
  for (const v of [green, yellow, red]) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return false;
  }
  return (green as number) + (yellow as number) + (red as number) > 0;
}

/** Smooth a distribution to avoid divide-by-zero or log of zero. */
function smooth(p: ProbabilityDistribution): ProbabilityDistribution {
  const sum = p.green + p.yellow + p.red;
  const d = sum + 3 * EPSILON;
  return { green: (p.green + EPSILON) / d, yellow: (p.yellow + EPSILON) / d, red: (p.red + EPSILON) / d };
}

/** KL divergence D_KL(P || Q) between two distributions. */
export function computeKLDivergence(p: ProbabilityDistribution, q: ProbabilityDistribution): number {
  const P = smooth(p);
  const Q = smooth(q);
  let kl = 0;
  kl += P.green * Math.log(P.green / Q.green);
  kl += P.yellow * Math.log(P.yellow / Q.yellow);
  kl += P.red * Math.log(P.red / Q.red);
  return Math.max(0, kl); // KL is mathematically non-negative
}

/** Average pairwise KL across the swarm. FAIL-CLOSED: empty or any malformed input yields a fail-safe RED. */
export function evaluateSwarmCoherence(distributions: ProbabilityDistribution[]): PerceiverVerdict {
  if (distributions.length === 0 || !distributions.every(isValidDistribution)) {
    return { coherenceScore: 0, curvature: QUARANTINE_PINCH, verdict: 'RED', divergenceMatrix: [] };
  }

  const n = distributions.length;
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  let totalDivergence = 0;
  let pairs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const kl = computeKLDivergence(distributions[i], distributions[j]);
      matrix[i][j] = kl;
      totalDivergence += kl;
      pairs++;
    }
  }
  const avgDivergence = pairs > 0 ? totalDivergence / pairs : 0;
  const curvature = avgDivergence * 10; // PROXY (see PerceiverVerdict.curvature)

  let avgGreen = 0, avgYellow = 0, avgRed = 0;
  for (const d of distributions) { avgGreen += d.green; avgYellow += d.yellow; avgRed += d.red; }
  avgGreen /= n; avgYellow /= n; avgRed /= n;
  const total = avgGreen + avgYellow + avgRed || 1;
  avgGreen /= total; avgYellow /= total; avgRed /= total;

  let verdict: 'GREEN' | 'YELLOW' | 'RED' = 'YELLOW';
  if (avgRed > 0.05) verdict = 'RED';                                  // any notable RED -> fail-safe
  else if (avgGreen > avgYellow && avgGreen > avgRed) verdict = 'GREEN';

  return { coherenceScore: Math.max(0, 1 - avgDivergence), curvature, verdict, divergenceMatrix: matrix };
}

// ── Governed EVIDENCE artifact ──
export interface PerceiverObservation {
  schema: 'perceiver-observation-v0';
  // bounded math vectors only — NO raw prompts, NO PoPs, NO signatures/signedHeads, NO secrets, NO keys
  coherenceScore: number;
  pinchProxy: number;                          // honest name for the curvature proxy
  advisoryState: 'GREEN' | 'YELLOW' | 'RED';   // an ADVISORY safety reading; NOT a gate verdict
  divergenceMatrix: number[][];
  modelCount: number;
  conflict: boolean;                           // high pinch OR quarantined (an address for draft-only repair)
  quarantined: boolean;                        // malformed/empty input -> fail-safe; a low pinch is NOT "safe"
  // hard governance flags — this is EVIDENCE, never authority:
  advisoryOnly: true;
  evidenceOnly: true;
  grantsAuthority: false;
  approvalRequired: true;                       // anything it triggers needs human approval
  draftOnly: true;                              // any proposal it triggers is draft-only
}

/** Turn swarm distributions into a governed evidence observation. FAIL CLOSED on malformed/empty input. */
export function perceive(distributions: ProbabilityDistribution[]): PerceiverObservation {
  const base = {
    schema: 'perceiver-observation-v0' as const,
    advisoryOnly: true as const, evidenceOnly: true as const, grantsAuthority: false as const,
    approvalRequired: true as const, draftOnly: true as const,
  };
  if (distributions.length === 0 || !distributions.every(isValidDistribution)) {
    return { ...base, coherenceScore: 0, pinchProxy: QUARANTINE_PINCH, advisoryState: 'RED', divergenceMatrix: [], modelCount: distributions.length, conflict: true, quarantined: true };
  }
  const v = evaluateSwarmCoherence(distributions);
  return {
    ...base,
    coherenceScore: v.coherenceScore, pinchProxy: v.curvature, advisoryState: v.verdict,
    divergenceMatrix: v.divergenceMatrix, modelCount: distributions.length,
    conflict: v.curvature >= PERCEIVER_CONFLICT_THRESHOLD || v.verdict === 'RED', quarantined: false,
  };
}

/** The Perceiver NEVER grants authority — it senses; it does not sign. */
export function perceiverGrantsAuthority(_o: PerceiverObservation): false { return false; }

/**
 * Turn a CONFLICT observation into a DRAFT-ONLY repair proposal that flows through the EXISTING sandbox
 * heartbeat (`runSelfEditHeartbeat`, appliedLive=false) — never a live lane, never a signer. The proposal
 * carries only bounded conflict metrics (no prompts/secrets). Mapping the pinch onto the exact stressed
 * organ (via graphify) is future work; for now it records the conflict as a sandbox-only note.
 */
export function perceiverConflictToProposal(obs: PerceiverObservation): SelfEditProposal {
  return {
    proposalId: 'perceiver_conflict_v0',
    goal: `structural conflict (pinchProxy=${obs.pinchProxy.toFixed(2)}, state=${obs.advisoryState}) — draft-only sandbox repair`,
    codec: 'json_action_v1',
    files: [{ relPath: 'demo/perceiver-conflict.txt', content: `Auma Perceiver structural conflict — coherence=${obs.coherenceScore}, models=${obs.modelCount}. Advisory evidence only.\n` }],
  };
}
