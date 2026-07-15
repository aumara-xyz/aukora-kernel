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

/** The exact, closed key set of a valid artifact body (R23 blocker 2 — exact-key closed, no extra keys). */
const ARTIFACT_BODY_KEYS: readonly string[] = [
  'schema', 'domain', 'advisoryOnly', 'grantsAuthority', 'generation', 'parentDigest',
  'candidateDigest', 'metrics', 'resourceMeasurements', 'evaluatorDigest', 'safetyDigest',
  'fixtureCouncilVerdict',
];
/** The exact, closed key set of the fixture council verdict. */
const VERDICT_KEYS: readonly string[] = ['kind', 'live', 'grantsAuthority', 'verdict', 'score', 'note'];

/**
 * Exact-key closure: the object must have EXACTLY these own keys — no missing, no extra — where "extra" includes
 * NON-ENUMERABLE string keys and SYMBOL keys (R24 amendment, P2). Object.keys sees only own enumerable string
 * keys — the same view canonicalBytes/textHasSecret use — so a `{enumerable:false}` or Symbol-keyed property
 * would otherwise ride along un-counted, un-digested, and un-scanned. Requiring BOTH the enumerable-string count
 * AND the total-own-key count (Reflect.ownKeys, which includes non-enumerable strings and symbols) to equal the
 * closed set guarantees every expected key is present and enumerable and that nothing else exists on the object.
 */
function hasExactKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  if (Object.keys(o).length !== keys.length) return false;      // exactly these enumerable string keys
  if (Reflect.ownKeys(o).length !== keys.length) return false;  // no non-enumerable / symbol extras
  for (const k of keys) if (!Object.prototype.hasOwnProperty.call(o, k)) return false;
  return true;
}

const METRICS_KEYS: readonly string[] = ['admitAccuracy', 'recoveryLatency', 'cost'];
const RESOURCES_KEYS: readonly string[] = ['steps', 'peakBytes', 'toolCalls'];

/**
 * Structural screen (R24 amendment, P2 second round — the patent's Family A3). Rejects any NON-ORDINARY
 * container anywhere in the body tree: a symbol own key, a non-enumerable own key, an accessor (getter/setter),
 * or an exotic prototype. This closes two residuals the first amendment missed: (A) a non-enumerable / symbol
 * key on the nested metrics/resourceMeasurements objects (Object.keys — used by the counter, the canonical
 * digest, AND the secret scan — never sees it), and (B) a getter that returns benign bytes to validation/scan
 * and secret bytes to the digest (a read-twice TOCTOU). After this passes, art.body is an ordinary data tree, so
 * reading it three times (validate, digest, scan) is consistent. Depth-bounded (schema is shallow) to fail
 * closed on a deep/circular hostile object.
 */
function isOrdinaryTree(x: unknown, depth = 0): boolean {
  if (x === null || typeof x !== 'object') return true;
  if (depth > 8) return false; // shallow fixed schema; refuse deep/circular hostiles
  if (Object.getOwnPropertySymbols(x).length > 0) return false; // no symbol keys
  const proto = Object.getPrototypeOf(x);
  if (Array.isArray(x)) {
    if (proto !== Array.prototype && proto !== null) return false;
    for (const k of Object.getOwnPropertyNames(x)) {
      if (k === 'length') continue;
      const d = Object.getOwnPropertyDescriptor(x, k);
      if (d === undefined || !d.enumerable || d.get !== undefined || d.set !== undefined) return false;
      if (!isOrdinaryTree(d.value, depth + 1)) return false;
    }
    return true;
  }
  if (proto !== Object.prototype && proto !== null) return false; // no exotic prototype
  for (const k of Object.getOwnPropertyNames(x)) {
    const d = Object.getOwnPropertyDescriptor(x, k);
    if (d === undefined || !d.enumerable || d.get !== undefined || d.set !== undefined) return false;
    if (!isOrdinaryTree(d.value, depth + 1)) return false;
  }
  return true;
}

function isMetrics(m: unknown): m is Metrics {
  if (m === null || typeof m !== 'object' || Array.isArray(m)) return false;
  const o = m as Record<string, unknown>;
  if (!hasExactKeys(o, METRICS_KEYS)) return false; // exact-key closed (non-enum/symbol counted)
  return (
    Number.isSafeInteger(o.admitAccuracy) &&
    Number.isSafeInteger(o.recoveryLatency) &&
    Number.isSafeInteger(o.cost)
  );
}

function isResources(r: unknown): r is Resources {
  if (r === null || typeof r !== 'object' || Array.isArray(r)) return false;
  const o = r as Record<string, unknown>;
  if (!hasExactKeys(o, RESOURCES_KEYS)) return false; // exact-key closed; a deleted/added sensor field ⇒ refuse
  return (
    Number.isSafeInteger(o.steps) &&
    Number.isSafeInteger(o.peakBytes) &&
    Number.isSafeInteger(o.toolCalls)
  );
}

function isValidArtifactBody(b: unknown): b is NebiusFuRehearsalArtifactV0 {
  if (b === null || typeof b !== 'object' || Array.isArray(b)) return false;
  const o = b as Record<string, unknown>;
  // EXACT-KEY CLOSURE (R23 blocker 2): reject any body carrying an extra (e.g. recomputed authority-shaped)
  // key, or missing a required one. A digest recomputed over an extra key can no longer sneak past verify.
  if (!hasExactKeys(o, ARTIFACT_BODY_KEYS)) return false;
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
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  if (!hasExactKeys(v, VERDICT_KEYS)) return false; // exact-key closed verdict too
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
    // Two complementary defenses, because neither alone is complete:
    // (1) STRUCTURAL SCREEN the LIVE body (Family A3): reject any non-ordinary container — non-enumerable or
    //     symbol keys, accessor getters/setters, exotic prototypes — anywhere in the tree. This REJECTS (not
    //     merely drops) a hostile plain object that a caller built with Object.defineProperty, so the smuggled
    //     field cannot even reach a downstream reader of the live body. It cannot see through a Proxy facade.
    if (!isOrdinaryTree(art.body)) return false;
    // (2) SNAPSHOT-FIRST (Family A4, as D6's own sealEnvelope does): canonicalize EXACTLY ONCE into an inert
    //     plain snapshot, then validate + digest + scan THAT snapshot. A single [[Get]]-driven read means a
    //     Proxy get-trap (which passes the screen by forwarding descriptor/ownKeys/proto to a benign target)
    //     cannot present a benign surface to the scan and a secret surface to the digest — whatever it injects
    //     lands in the one snapshot and is scanned. This is the closure a structural screen cannot provide.
    let snapshot: unknown;
    try {
      snapshot = JSON.parse(canonicalString(art.body));
    } catch {
      return false;
    }
    if (!isValidArtifactBody(snapshot)) return false;
    if (artifactDigest(snapshot) !== art.digest) return false; // digest binds exactly the validated snapshot
    if (textHasSecret(canonicalString(snapshot))) return false; // scan the SAME snapshot the digest bound
    return true;
  } catch {
    return false;
  }
}

/**
 * Offline Fu contract (R23 blocker 7 — distinguish a SYNTHETIC threshold fixture from a REAL live Fu council
 * result). This bundle has NO approved provider credential, so any Fu evidence it produces is offline. Per the
 * Round-24 FU GATE, an honest offline artifact declares exactly this shape and is a NON-VOTE for live quorum.
 */
export const FU_OFFLINE_CONTRACT = Object.freeze({
  providerContacted: false as const,
  paidCalls: 0 as const,
  liveEligible: false as const,
  verdict: 'insufficient-quorum' as const,
});

/**
 * True iff `art` is the offline rehearsal-fixture artifact. It is NEVER live. A VERIFIED artifact necessarily
 * carries schema===ARTIFACT_SCHEMA and domain===REHEARSAL_DOMAIN (isValidArtifactBody requires both on the
 * snapshot), so this is exactly verifyArtifact — we do NOT re-read the live (possibly-Proxy) body.
 */
export function isRehearsalArtifact(art: SealedArtifact): boolean {
  return verifyArtifact(art);
}

/**
 * liveEligible — the guard that keeps a synthetic rehearsal fixture from EVER being counted as a live Fu vote.
 * A rehearsal artifact (this bundle's only artifact kind) is offline by construction: it carries live:false and
 * grantsAuthority:false, so this returns false. Only a genuinely live, provider-contacted, paid Fu artifact of
 * a DIFFERENT schema could ever return true — and this bundle produces none, so it is always false here.
 */
export function liveEligible(art: SealedArtifact): boolean {
  if (isRehearsalArtifact(art)) return false; // synthetic fixture ⇒ never live-eligible
  return false; // no live-Fu artifact schema is produced by this quarantined bundle
}
