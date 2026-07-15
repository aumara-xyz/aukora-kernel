// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * NebiusFuRehearsalArtifactV0 (Round-22 blockers 7 + 8).
 *
 * A per-generation, candidate-bound OFFLINE Fu rehearsal artifact. It binds {generation, parentDigest,
 * candidateDigest, metrics, resourceMeasurements, evaluatorDigest, safetyDigest, fixtureCouncilVerdict} and is
 * sealed with a DOMAIN-SEPARATED, length-framed digest reusing the D6 primitives:
 *
 *   digest = hex( SHA-256( utf8('aukora-g1-rehearsal-v0') ‖ 0x00 ‖ uint64BE(len(C)) ‖ C ) ),  C = canonicalBytes(body)
 *
 * The council verdict is a DETERMINISTIC FIXTURE produced offline. It is explicitly rehearsal evidence — NOT
 * a live council — and grants NO authority (the literals advisoryOnly:true / grantsAuthority:false are
 * load-bearing invariants). verifyArtifact recomputes the framed digest, revalidates the body shape (so a
 * deleted sensor field is caught), and runs the D6 secret scan over the whole artifact.
 */
import { sha256Hex, canonicalBytes, canonicalString, uint64BE, textHasSecret } from '../d6/evidence/index';
import type { Metrics, Resources } from './evaluator';

export const REHEARSAL_DOMAIN = 'aukora-g1-rehearsal-v0';
export const ARTIFACT_SCHEMA = 'NebiusFuRehearsalArtifactV0';

export interface FixtureCouncilVerdict {
  readonly kind: 'rehearsal-fixture';
  readonly live: false;
  readonly grantsAuthority: false;
  readonly verdict: string; // 'rehearsal-pass' | 'rehearsal-hold'
  readonly score: number; // integer
  readonly note: string;
}

export interface NebiusFuRehearsalArtifactV0 {
  readonly schema: typeof ARTIFACT_SCHEMA;
  readonly domain: typeof REHEARSAL_DOMAIN;
  readonly advisoryOnly: true;
  readonly grantsAuthority: false;
  readonly generation: number;
  readonly parentDigest: string;
  readonly candidateDigest: string;
  readonly metrics: Metrics;
  readonly resourceMeasurements: Resources;
  readonly evaluatorDigest: string;
  readonly safetyDigest: string;
  readonly fixtureCouncilVerdict: FixtureCouncilVerdict;
}

export interface SealedArtifact {
  readonly body: NebiusFuRehearsalArtifactV0;
  readonly digest: string;
}

const encoder = new TextEncoder();

/** Domain-separated, length-framed digest over the canonical body — reuses D6 canonicalBytes/uint64BE/sha256Hex. */
export function artifactDigest(body: NebiusFuRehearsalArtifactV0): string {
  const c = canonicalBytes(body);
  const dom = encoder.encode(REHEARSAL_DOMAIN);
  const framed = new Uint8Array(dom.length + 1 + 8 + c.length);
  framed.set(dom, 0);
  framed[dom.length] = 0x00;
  framed.set(uint64BE(c.length), dom.length + 1);
  framed.set(c, dom.length + 9);
  return sha256Hex(framed);
}

/**
 * DETERMINISTIC offline fixture council. NOT a live council; produces no authority. The verdict is a pure
 * function of the (controller-computed) metrics, so it is reproducible and cannot be steered by a candidate.
 */
export function fixtureCouncil(candidateDigest: string, metrics: Metrics): FixtureCouncilVerdict {
  void candidateDigest; // bound at the artifact's top level; not needed for the deterministic verdict
  const pass =
    metrics.admitAccuracy >= 500 && metrics.cost <= 5000 && metrics.recoveryLatency <= 100000;
  return {
    kind: 'rehearsal-fixture',
    live: false,
    grantsAuthority: false,
    verdict: pass ? 'rehearsal-pass' : 'rehearsal-hold',
    score: metrics.admitAccuracy,
    note: 'offline deterministic rehearsal fixture; not a live council; grants no authority',
  };
}

export interface BuildArtifactInput {
  readonly generation: number;
  readonly parentDigest: string;
  readonly candidateDigest: string;
  readonly metrics: Metrics;
  readonly resourceMeasurements: Resources;
  readonly evaluatorDigest: string;
  readonly safetyDigest: string;
  readonly fixtureCouncilVerdict: FixtureCouncilVerdict;
}

export function buildArtifact(input: BuildArtifactInput): SealedArtifact {
  const body: NebiusFuRehearsalArtifactV0 = {
    schema: ARTIFACT_SCHEMA,
    domain: REHEARSAL_DOMAIN,
    advisoryOnly: true,
    grantsAuthority: false,
    generation: input.generation,
    parentDigest: input.parentDigest,
    candidateDigest: input.candidateDigest,
    metrics: input.metrics,
    resourceMeasurements: input.resourceMeasurements,
    evaluatorDigest: input.evaluatorDigest,
    safetyDigest: input.safetyDigest,
    fixtureCouncilVerdict: input.fixtureCouncilVerdict,
  };
  return { body, digest: artifactDigest(body) };
}

const HEX64 = /^[0-9a-f]{64}$/;

function isMetrics(m: unknown): m is Metrics {
  if (m === null || typeof m !== 'object') return false;
  const o = m as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== 3) return false;
  return (
    Number.isSafeInteger(o.admitAccuracy) &&
    Number.isSafeInteger(o.recoveryLatency) &&
    Number.isSafeInteger(o.cost)
  );
}

function isResources(r: unknown): r is Resources {
  if (r === null || typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== 3) return false; // a deleted sensor field ⇒ wrong count ⇒ refuse
  return (
    Number.isSafeInteger(o.steps) &&
    Number.isSafeInteger(o.peakBytes) &&
    Number.isSafeInteger(o.toolCalls)
  );
}

function isValidArtifactBody(b: unknown): b is NebiusFuRehearsalArtifactV0 {
  if (b === null || typeof b !== 'object') return false;
  const o = b as Record<string, unknown>;
  if (o.schema !== ARTIFACT_SCHEMA) return false;
  if (o.domain !== REHEARSAL_DOMAIN) return false;
  if (o.advisoryOnly !== true) return false;
  if (o.grantsAuthority !== false) return false;
  if (!Number.isSafeInteger(o.generation) || (o.generation as number) < 0) return false;
  if (typeof o.parentDigest !== 'string' || !HEX64.test(o.parentDigest)) return false;
  if (typeof o.candidateDigest !== 'string' || !HEX64.test(o.candidateDigest)) return false;
  if (typeof o.evaluatorDigest !== 'string' || !HEX64.test(o.evaluatorDigest)) return false;
  if (typeof o.safetyDigest !== 'string' || !HEX64.test(o.safetyDigest)) return false;
  if (!isMetrics(o.metrics)) return false;
  if (!isResources(o.resourceMeasurements)) return false;
  const v = o.fixtureCouncilVerdict as Record<string, unknown> | null;
  if (v === null || typeof v !== 'object') return false;
  if (v.kind !== 'rehearsal-fixture') return false;
  if (v.live !== false || v.grantsAuthority !== false) return false;
  if (typeof v.verdict !== 'string') return false;
  if (!Number.isSafeInteger(v.score)) return false;
  if (typeof v.note !== 'string') return false;
  return true;
}

/**
 * verifyArtifact — refuses (returns false) unless the artifact is structurally valid, its framed digest
 * recomputes to the stored digest, it carries the advisory/no-authority literals, and it contains NO secret /
 * authority-shaped content per the D6 scan. Total: never throws on hostile input.
 */
export function verifyArtifact(art: SealedArtifact): boolean {
  try {
    if (art === null || typeof art !== 'object') return false;
    if (typeof art.digest !== 'string' || !HEX64.test(art.digest)) return false;
    if (!isValidArtifactBody(art.body)) return false;
    if (artifactDigest(art.body) !== art.digest) return false;
    // Secret / authority-shaped content scan over the full canonical serialization (fail-closed).
    if (textHasSecret(canonicalString(art.body))) return false;
    return true;
  } catch {
    return false;
  }
}
