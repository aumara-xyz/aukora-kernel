// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Round-24 (R23 blocker) repair suite. One or more executable controls per blocker. Each asserts the POST-FIX
 * (pass-after) behavior; the companion FAIL-BEFORE evidence is produced by scripts/fail-before.sh, which runs
 * this same file against the pre-fix source and shows the corresponding controls failing.
 *
 * Blockers (quarantine/nebius-g1/IMPORT_BLOCKERS_R23.md):
 *   1 final-component symlink escape · 2 artifact not exact-key closed · 3 weak D6 provenance binding ·
 *   4 hard-stop not wired · 5 runtime-closure/allowlist · 6 no runner/state contract · 7 synthetic-vs-live Fu ·
 *   8 durable lineage / self-covering manifest.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { SEED_GENOME, runGeneration, runGenerations } from '../src/controller';
import {
  resolveContained,
  writeContainedAtomic,
  ContainmentError,
} from '../src/containment';
import { verifyD6 } from '../src/d6selfcheck';
import {
  buildArtifact,
  verifyArtifact,
  artifactDigest,
  fixtureCouncil,
  isRehearsalArtifact,
  liveEligible,
  FU_OFFLINE_CONTRACT,
  type SealedArtifact,
} from '../src/evidence';
import { evaluate, EVALUATOR_DIGEST } from '../src/evaluator';
import { SAFETY_DIGEST } from '../src/safety';
import { mutate, type GenomeV0 } from '../src/genome';
import {
  candidateDigest,
  advanceGuard,
  readLineage,
  verifyLineageChain,
  type EvaluatedCandidate,
  type Generation,
} from '../src/lineage';
import { HardStop } from '../src/teardown';
import { runCanary, assertEnvelope, MANDATED_ENVELOPE, EnvelopeContractError } from '../src/runner';
import { ALLOW, missingClosure, assertDeployable, checkBundle, REQUIRED_CLOSURE } from '../src/allowlist';

const BUNDLE_ROOT = path.resolve(__dirname, '..');

let TMP: string;
beforeAll(() => { TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'g1-r24-')); });
afterAll(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ } });

function clone<T>(x: T): T { return JSON.parse(JSON.stringify(x)) as T; }

/** A mutable view of an artifact clone so tamper tests can reassign the (normally readonly) digest. */
type MutableArtifact = { body: Record<string, unknown>; digest: string };
function mutClone(a: SealedArtifact): MutableArtifact { return clone(a) as unknown as MutableArtifact; }

function makeArtifact(genome: GenomeV0, generation: number): { child: EvaluatedCandidate; artifact: SealedArtifact; parentDigest: string } {
  const ev = evaluate(genome);
  const cd = candidateDigest(genome);
  const parentDigest = 'a'.repeat(64);
  const artifact = buildArtifact({
    generation,
    parentDigest,
    candidateDigest: cd,
    metrics: ev.metrics,
    resourceMeasurements: ev.resourceMeasurements,
    evaluatorDigest: EVALUATOR_DIGEST,
    safetyDigest: SAFETY_DIGEST,
    fixtureCouncilVerdict: fixtureCouncil(cd, ev.metrics),
  });
  const child: EvaluatedCandidate = {
    genome, generation, parentDigest, candidateDigest: cd,
    metrics: ev.metrics, resourceMeasurements: ev.resourceMeasurements,
  };
  return { child, artifact, parentDigest };
}

// ── Blocker 1: final-component symlink escape ────────────────────────────────────────────────────────────
describe('R23#1 final-component symlink escape', () => {
  it('resolveContained REFUSES a final-component symlink and writeContainedAtomic never follows it', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'g1-base1-'));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'g1-out1-'));
    const outsideTarget = path.join(outsideDir, 'victim.txt');
    fs.writeFileSync(outsideTarget, 'ORIGINAL');
    try {
      // plant a symlink AS THE FINAL COMPONENT inside base, pointing at a file outside base
      fs.symlinkSync(outsideTarget, path.join(base, 'gen-1.artifact.json'));
      // resolveContained must throw on the final-component symlink (parent is fine; the target is the link)
      expect(() => resolveContained(base, 'gen-1.artifact.json')).toThrow(ContainmentError);
      // the atomic writer must also refuse — and the outside file must be UNTOUCHED (no follow)
      expect(() => writeContainedAtomic(base, 'gen-1.artifact.json', 'PWNED')).toThrow(ContainmentError);
      expect(fs.readFileSync(outsideTarget, 'utf8')).toBe('ORIGINAL');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('writeContainedAtomic writes a fresh contained file atomically', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'g1-base1b-'));
    try {
      const p = writeContainedAtomic(base, 'ok.json', '{"x":1}');
      expect(p).toBe(path.join(fs.realpathSync(base), 'ok.json'));
      expect(fs.readFileSync(p, 'utf8')).toBe('{"x":1}');
      // no leftover temp files
      expect(fs.readdirSync(base).filter((f) => f.includes('.tmp-'))).toEqual([]);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

// ── Blocker 2: artifact verification must be exact-key closed ─────────────────────────────────────────────
describe('R23#2 artifact verification is exact-key closed', () => {
  it('an extra authority-shaped body key with a RECOMPUTED digest is still REFUSED', () => {
    const { artifact } = makeArtifact(SEED_GENOME, 1);
    expect(verifyArtifact(artifact)).toBe(true); // sanity: the clean artifact verifies
    const bad = mutClone(artifact);
    bad.body.grantsAuthorityForReal = true; // smuggled extra key
    bad.digest = artifactDigest(bad.body as never); // recompute so the digest check alone would pass
    expect(verifyArtifact(bad as unknown as SealedArtifact)).toBe(false); // exact-key closure refuses regardless
  });

  it('an extra key on the fixture verdict with a recomputed digest is REFUSED', () => {
    const { artifact } = makeArtifact(SEED_GENOME, 1);
    const bad = mutClone(artifact);
    (bad.body.fixtureCouncilVerdict as Record<string, unknown>).apply = 'x';
    bad.digest = artifactDigest(bad.body as never);
    expect(verifyArtifact(bad as unknown as SealedArtifact)).toBe(false);
  });
});

// ── Blocker 3: strong D6 provenance binding ──────────────────────────────────────────────────────────────
describe('R23#3 D6 provenance is strongly bound (commit/tree/ls/count/exact-map)', () => {
  function freshD6(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g1-d6-'));
    fs.cpSync(path.join(BUNDLE_ROOT, 'd6'), path.join(root, 'd6'), { recursive: true });
    return root;
  }
  const pinPathOf = (root: string) => path.join(root, 'd6', 'D6_TREE_VERIFICATION.json');
  const readPin = (root: string) => JSON.parse(fs.readFileSync(pinPathOf(root), 'utf8'));
  const writePin = (root: string, pin: unknown) => fs.writeFileSync(pinPathOf(root), JSON.stringify(pin, null, 2));

  it('the clean vendored tree verifies', () => {
    const root = freshD6();
    try { expect(verifyD6(root)).toBe(true); } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('a pin naming a DIFFERENT commit (with correct file hashes) is REFUSED', () => {
    const root = freshD6();
    try {
      const pin = readPin(root); pin.d6_commit = 'deadbeef'.repeat(5); writePin(root, pin);
      expect(verifyD6(root)).toBe(false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('a pin with a wrong tracked-entry count is REFUSED', () => {
    const root = freshD6();
    try {
      const pin = readPin(root); pin.d6_tracked_entry_count = 37; writePin(root, pin);
      expect(verifyD6(root)).toBe(false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('a pin with an EXTRA vendored map entry is REFUSED (exact-key closed)', () => {
    const root = freshD6();
    try {
      const pin = readPin(root); pin.vendored_evidence_sha256['d6/evidence/extra.ts'] = 'f'.repeat(64); writePin(root, pin);
      expect(verifyD6(root)).toBe(false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('a pin MISSING a vendored map entry is REFUSED', () => {
    const root = freshD6();
    try {
      const pin = readPin(root); delete pin.vendored_evidence_sha256['d6/evidence/types.ts']; writePin(root, pin);
      expect(verifyD6(root)).toBe(false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});

// ── Blocker 4: hard-stop wired into the controller loop ──────────────────────────────────────────────────
describe('R23#4 hard-stop is wired into the controller loop', () => {
  it('a pre-expired hard-stop stops the loop BEFORE any generation', () => {
    const now = () => 1_000_000;
    const hardStop = new HardStop(now(), 0, 0); // deadline == armed time ⇒ already reached
    const outDir = path.join(TMP, 'hs-expired');
    const s = runGenerations(1234, 4, { bundleRoot: BUNDLE_ROOT, outDir, hardStop, now });
    expect(s.stoppedByDeadline).toBe(true);
    expect(s.generationsRun).toBe(0);
  });

  it('a far-future hard-stop lets all generations run', () => {
    const now = () => 1_000_000;
    const hardStop = new HardStop(now(), 60 * 60 * 1000, 60 * 60 * 1000); // 1h out
    const outDir = path.join(TMP, 'hs-far');
    const s = runGenerations(1234, 3, { bundleRoot: BUNDLE_ROOT, outDir, hardStop, now });
    expect(s.stoppedByDeadline).toBe(false);
    expect(s.generationsRun).toBe(3);
  });
});

// ── Blocker 6: explicit runner / GPU / UI / egress state contract ─────────────────────────────────────────
describe('R23#6 runner enforces an explicit sealed-envelope state contract', () => {
  const noopEnv = { now: () => 5_000_000, setTimer: () => 0, clearTimer: () => {}, forceExit: () => {} };

  it('assertEnvelope REFUSES any deviation from the mandated posture', () => {
    expect(() => assertEnvelope({ ...MANDATED_ENVELOPE, egress: 'allowed' })).toThrow(EnvelopeContractError);
    expect(() => assertEnvelope({ ...MANDATED_ENVELOPE, signing: 'present' })).toThrow(EnvelopeContractError);
    expect(() => assertEnvelope(null)).toThrow(EnvelopeContractError);
    expect(() => assertEnvelope(MANDATED_ENVELOPE)).not.toThrow();
  });

  it('a pre-expired deadline yields phase=stopped-deadline, 0 generations, durable+valid lineage', () => {
    const report = runCanary({
      envelope: MANDATED_ENVELOPE, seed0: 42, maxGenerations: 4,
      hardStopMs: 0, teardownMs: 0, bundleRoot: BUNDLE_ROOT,
      outDir: path.join(TMP, 'canary-expired'), env: noopEnv,
    });
    expect(report.state.phase).toBe('stopped-deadline');
    expect(report.state.generationsRun).toBe(0);
    expect(report.state.envelope).toEqual(MANDATED_ENVELOPE);
    expect(report.state.envelope.egress).toBe('denied');
    expect(report.state.teardownArmed).toBe(true);
    expect(report.state.lineageDurable).toBe(true);
    expect(report.state.lineageChainValid).toBe(true);
  });

  it('a live deadline runs generations and produces a durable, chain-valid lineage', () => {
    const report = runCanary({
      envelope: MANDATED_ENVELOPE, seed0: 7, maxGenerations: 3,
      hardStopMs: 60 * 60 * 1000, teardownMs: 60 * 60 * 1000, bundleRoot: BUNDLE_ROOT,
      outDir: path.join(TMP, 'canary-live'), env: noopEnv,
    });
    expect(report.state.phase).toBe('stopped-count');
    expect(report.state.generationsRun).toBe(3);
    expect(report.state.lineageDurable).toBe(true);
    expect(report.state.lineageChainValid).toBe(true);
    expect(report.lineage.length).toBe(3);
  });
});

// ── Blocker 7: synthetic threshold fixture is distinguished from a real live Fu artifact ──────────────────
describe('R23#7 synthetic rehearsal fixture is never live-eligible', () => {
  it('a verified rehearsal artifact is a rehearsal and NOT live-eligible', () => {
    const { artifact } = makeArtifact(SEED_GENOME, 1);
    expect(isRehearsalArtifact(artifact)).toBe(true);
    expect(liveEligible(artifact)).toBe(false);
  });

  it('the offline Fu contract is an explicit non-vote', () => {
    expect(FU_OFFLINE_CONTRACT.providerContacted).toBe(false);
    expect(FU_OFFLINE_CONTRACT.paidCalls).toBe(0);
    expect(FU_OFFLINE_CONTRACT.liveEligible).toBe(false);
    expect(FU_OFFLINE_CONTRACT.verdict).toBe('insufficient-quorum');
  });
});

// ── Blocker 8: durable lineage + atomic advancement ──────────────────────────────────────────────────────
describe('R23#8 lineage is durable and chain-verifiable', () => {
  it('runGenerations persists a durable, chain-valid lineage; a stray temp file is ignored', () => {
    const outDir = path.join(TMP, 'lineage-run');
    const s = runGenerations(2026, 3, { bundleRoot: BUNDLE_ROOT, outDir });
    const lineageDir = s.lineageDir;
    // plant a stray temp file simulating a crash mid-write — readLineage must ignore it
    fs.writeFileSync(path.join(lineageDir, '.gen-9.json.tmp-999-0'), 'PARTIAL');
    const recs = readLineage(lineageDir);
    expect(recs).not.toBeNull();
    expect(recs!.length).toBe(3);
    expect(verifyLineageChain(recs!)).toBe(true);
  });

  it('a broken parent→child linkage fails verifyLineageChain', () => {
    const broken: Generation[] = [
      { generation: 1, parentDigest: '', candidateDigest: 'a'.repeat(64), artifactDigest: 'b'.repeat(64) },
      { generation: 2, parentDigest: 'c'.repeat(64), candidateDigest: 'd'.repeat(64), artifactDigest: 'e'.repeat(64) },
    ];
    expect(verifyLineageChain(broken)).toBe(false); // gen2.parent !== gen1.candidate
  });
});

// ── Blocker 5: runtime dependency closure / allowlist completeness ────────────────────────────────────────
describe('R23#5 runtime dependency closure + allowlist completeness', () => {
  it('package-lock.json is now allow-listed (runtime closure)', () => {
    expect(ALLOW).toContain('package-lock.json');
    expect(() => assertDeployable('package-lock.json')).not.toThrow();
  });

  it('missingClosure flags an incomplete bundle and passes a complete one', () => {
    expect(missingClosure(['package.json', 'tsconfig.json'])).toContain('package-lock.json');
    expect(missingClosure([...REQUIRED_CLOSURE])).toEqual([]);
  });

  it('the on-disk bundle actually carries its required closure', () => {
    for (const f of REQUIRED_CLOSURE) {
      expect(fs.existsSync(path.join(BUNDLE_ROOT, f))).toBe(true);
    }
  });

  it('allowlist.ts ALLOW mirrors deploy/deploy-allowlist.json', () => {
    const json = JSON.parse(fs.readFileSync(path.join(BUNDLE_ROOT, 'deploy', 'deploy-allowlist.json'), 'utf8'));
    expect([...ALLOW].sort()).toEqual([...json.allow].sort());
  });
});

// ── R24 AMENDMENT: three P2 findings from the adversarial falsification pass, now closed ──────────────────
describe('R24 amend P2 — exact-key closure covers non-enumerable + symbol keys', () => {
  it('a NON-ENUMERABLE extra body key (digest unchanged) is REFUSED', () => {
    const { artifact } = makeArtifact(SEED_GENOME, 1);
    const bad = mutClone(artifact);
    Object.defineProperty(bad.body, 'grantsAuthorityForReal', { value: true, enumerable: false, configurable: true, writable: true });
    // digest is unchanged (non-enum excluded from canonicalBytes) so the digest check alone would pass:
    expect(artifactDigest(bad.body as never)).toBe(bad.digest);
    expect(verifyArtifact(bad as unknown as SealedArtifact)).toBe(false); // now refused by Reflect.ownKeys count
  });

  it('a SYMBOL-keyed extra body property is REFUSED', () => {
    const { artifact } = makeArtifact(SEED_GENOME, 1);
    const bad = mutClone(artifact);
    Object.defineProperty(bad.body, Symbol('x'), { value: 'authority', enumerable: true, configurable: true });
    expect(verifyArtifact(bad as unknown as SealedArtifact)).toBe(false);
  });

  it('a NON-ENUMERABLE extra verdict key is REFUSED', () => {
    const { artifact } = makeArtifact(SEED_GENOME, 1);
    const bad = mutClone(artifact);
    Object.defineProperty(bad.body.fixtureCouncilVerdict, 'apply', { value: 'x', enumerable: false, configurable: true });
    expect(verifyArtifact(bad as unknown as SealedArtifact)).toBe(false);
  });

  // Second-round residuals found by the re-check: nested objects + getter TOCTOU.
  it('a NON-ENUMERABLE extra key on nested metrics is REFUSED', () => {
    const { artifact } = makeArtifact(SEED_GENOME, 1);
    const bad = mutClone(artifact);
    Object.defineProperty(bad.body.metrics, 'smuggled', { value: 'ghp_' + 'A'.repeat(36), enumerable: false, configurable: true });
    expect(verifyArtifact(bad as unknown as SealedArtifact)).toBe(false);
  });

  it('a SYMBOL key on nested resourceMeasurements is REFUSED', () => {
    const { artifact } = makeArtifact(SEED_GENOME, 1);
    const bad = mutClone(artifact);
    Object.defineProperty(bad.body.resourceMeasurements, Symbol('x'), { value: 1, enumerable: true, configurable: true });
    expect(verifyArtifact(bad as unknown as SealedArtifact)).toBe(false);
  });

  it('a GETTER on verdict.note (read-twice TOCTOU) is REFUSED', () => {
    const { artifact } = makeArtifact(SEED_GENOME, 1);
    const bad = mutClone(artifact);
    let n = 0;
    Object.defineProperty(bad.body.fixtureCouncilVerdict, 'note', {
      get() { n++; return n === 2 ? 'ghp_' + 'B'.repeat(36) : 'benign offline note'; },
      enumerable: true, configurable: true,
    });
    expect(verifyArtifact(bad as unknown as SealedArtifact)).toBe(false); // snapshot-first: one read, no split
  });

  it('a Proxy body with a lying get-trap cannot bind a secret past the scan (snapshot-first)', () => {
    const { artifact } = makeArtifact(SEED_GENOME, 1);
    const plain = JSON.parse(JSON.stringify(artifact.body)) as Record<string, unknown>;
    const verdict = plain.fixtureCouncilVerdict as Record<string, unknown>;
    const secretNote = 'ghp_' + 'C'.repeat(36);
    const proxyBody = new Proxy(plain, {
      get(t, k, r) {
        if (k === 'fixtureCouncilVerdict') return { ...verdict, note: secretNote };
        return Reflect.get(t, k, r);
      },
    });
    // Attacker even sets the digest to match the secret-bearing snapshot; the scan still catches it.
    const secretBody = { ...plain, fixtureCouncilVerdict: { ...verdict, note: secretNote } };
    const bad = { body: proxyBody, digest: artifactDigest(secretBody as never) };
    expect(verifyArtifact(bad as unknown as SealedArtifact)).toBe(false);
  });

  it('a legit artifact read back from disk (JSON round-trip) still verifies', () => {
    const { artifact } = makeArtifact(SEED_GENOME, 1);
    const roundTripped = JSON.parse(JSON.stringify(artifact)) as SealedArtifact;
    expect(verifyArtifact(roundTripped)).toBe(true);
  });
});

describe('R24 amend P2 — deny list is case-insensitive (case-insensitive filesystems)', () => {
  it('mis-cased key material is DENIED, not deployable', () => {
    for (const p of ['src/authority.KEY', 'deploy/authority-node.KEY', 'test/prod.PEM', 'id_ED25519', 'My.EnV', 'X.Secret.txt']) {
      expect(() => assertDeployable(p)).toThrow();
    }
    const report = checkBundle(['src/authority.KEY', 'test/prod.PEM', 'src/controller.ts']);
    expect(report.denied).toContain('src/authority.KEY');
    expect(report.denied).toContain('test/prod.PEM');
    expect(report.deployable).toContain('src/controller.ts');
  });
});

describe('R24 amend P2 — runner envelope is exact-key closed', () => {
  it('an envelope with correct postures PLUS authority-shaped extras is REFUSED', () => {
    const evil = { ...MANDATED_ENVELOPE, apply: 'grant', authorityToken: 'SIGNED-AUTHORITY', signingKey: 'ed25519:deadbeef' };
    expect(() => assertEnvelope(evil)).toThrow(EnvelopeContractError);
  });

  it('a non-enumerable extra envelope key is REFUSED', () => {
    const evil: Record<string, unknown> = { ...MANDATED_ENVELOPE };
    Object.defineProperty(evil, 'authorityToken', { value: 'x', enumerable: false, configurable: true });
    expect(() => assertEnvelope(evil)).toThrow(EnvelopeContractError);
  });

  it('runCanary attests only the four mandated fields (no smuggled key in state.envelope)', () => {
    const report = runCanary({
      envelope: MANDATED_ENVELOPE, seed0: 1, maxGenerations: 1,
      hardStopMs: 60 * 60 * 1000, teardownMs: 60 * 60 * 1000, bundleRoot: BUNDLE_ROOT,
      outDir: path.join(TMP, 'canary-clean'),
      env: { now: () => 9_000_000, setTimer: () => 0, clearTimer: () => {}, forceExit: () => {} },
    });
    expect(Object.keys(report.state.envelope).sort()).toEqual(['egress', 'gpu', 'signing', 'ui']);
  });
});

// ── advanceGuard still refuses an exact-key-smuggled artifact end-to-end ──────────────────────────────────
describe('R23#2 end-to-end: advanceGuard refuses a smuggled-key artifact', () => {
  it('the guard retains the parent when the artifact carries an extra key', () => {
    const parentGenome = SEED_GENOME;
    const childGenome = mutate(parentGenome, 3);
    const pe = evaluate(parentGenome);
    const ce = evaluate(childGenome);
    const parent: EvaluatedCandidate = {
      genome: parentGenome, generation: 0, parentDigest: '',
      candidateDigest: candidateDigest(parentGenome), metrics: pe.metrics, resourceMeasurements: pe.resourceMeasurements,
    };
    const child: EvaluatedCandidate = {
      genome: childGenome, generation: 1, parentDigest: parent.candidateDigest,
      candidateDigest: candidateDigest(childGenome), metrics: ce.metrics, resourceMeasurements: ce.resourceMeasurements,
    };
    const good = buildArtifact({
      generation: 1, parentDigest: parent.candidateDigest, candidateDigest: child.candidateDigest,
      metrics: ce.metrics, resourceMeasurements: ce.resourceMeasurements,
      evaluatorDigest: EVALUATOR_DIGEST, safetyDigest: SAFETY_DIGEST,
      fixtureCouncilVerdict: fixtureCouncil(child.candidateDigest, ce.metrics),
    });
    const bad = mutClone(good);
    bad.body.apply = 'x';
    bad.digest = artifactDigest(bad.body as never);
    const d = advanceGuard(parent, child, bad as unknown as SealedArtifact, EVALUATOR_DIGEST, SAFETY_DIGEST, true);
    expect(d.advance).toBe(false);
    expect(d.retainParent).toBe(true);
    expect(d.refusals).toContain('artifact-verify-failed');
  });
});
