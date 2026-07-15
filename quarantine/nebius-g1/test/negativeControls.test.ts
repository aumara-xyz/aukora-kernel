// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Round-22 negative-control suite. The engine is a GOVERNED evolutionary optimizer: a candidate genome can
 * neither measure itself nor gain authority. These tests assert the POSITIVE path (a strictly-fitter child
 * advances) and then that every NEGATIVE control REFUSES advancement (retains the parent) or throws.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { GENOME_SCHEMA, validateGenome, mutate, type GenomeV0 } from '../src/genome';
import { evaluate, EVALUATOR_DIGEST } from '../src/evaluator';
import { safetyOf, SAFETY_DIGEST } from '../src/safety';
import { buildArtifact, verifyArtifact, fixtureCouncil, type SealedArtifact } from '../src/evidence';
import {
  advanceGuard,
  candidateDigest,
  strictlyDominates,
  type EvaluatedCandidate,
} from '../src/lineage';
import { resolveContained, ContainmentError } from '../src/containment';
import { verifyD6 } from '../src/d6selfcheck';
import {
  runGeneration,
  runGenerations,
  SEED_GENOME,
  DEFAULT_BUNDLE_ROOT,
  GenomeRefusedError,
} from '../src/controller';
import { assertDeployable, checkBundle } from '../src/allowlist';

const BUNDLE_ROOT = DEFAULT_BUNDLE_ROOT;
const WRONG_DIGEST = 'f'.repeat(64);

let TMP: string;
beforeAll(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'g1-out-'));
});
afterAll(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
});

// --- test helpers: replicate exactly what the immutable controller computes -------------------------------

function evalCandidate(genome: GenomeV0, generation: number, parentDigest: string): EvaluatedCandidate {
  const ev = evaluate(genome);
  return {
    genome,
    generation,
    parentDigest,
    candidateDigest: candidateDigest(genome),
    metrics: ev.metrics,
    resourceMeasurements: ev.resourceMeasurements,
  };
}

function makeGen(parentGenome: GenomeV0, seed: number, generation: number): {
  parent: EvaluatedCandidate;
  child: EvaluatedCandidate;
  artifact: SealedArtifact;
} {
  const parent = evalCandidate(parentGenome, generation - 1, '');
  const child = evalCandidate(mutate(parentGenome, seed), generation, parent.candidateDigest);
  const artifact = buildArtifact({
    generation,
    parentDigest: parent.candidateDigest,
    candidateDigest: child.candidateDigest,
    metrics: child.metrics,
    resourceMeasurements: child.resourceMeasurements,
    evaluatorDigest: EVALUATOR_DIGEST,
    safetyDigest: SAFETY_DIGEST,
    fixtureCouncilVerdict: fixtureCouncil(child.candidateDigest, child.metrics),
  });
  return { parent, child, artifact };
}

/** Deterministically find a seed whose child advances (and one that does not) against SEED_GENOME. */
function findSeeds(): { advanceSeed: number; retainSeed: number } {
  let advanceSeed = -1;
  let retainSeed = -1;
  for (let s = 1; s <= 5000 && (advanceSeed < 0 || retainSeed < 0); s++) {
    const g = makeGen(SEED_GENOME, s, 1);
    const d = advanceGuard(g.parent, g.child, g.artifact, EVALUATOR_DIGEST, SAFETY_DIGEST, true);
    if (d.advance && advanceSeed < 0) advanceSeed = s;
    else if (!d.advance && retainSeed < 0) retainSeed = s;
  }
  return { advanceSeed, retainSeed };
}

const { advanceSeed, retainSeed } = findSeeds();

// clone helper for tamper tests
function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

// --- baseline sanity -------------------------------------------------------------------------------------

describe('baseline', () => {
  it('SEED_GENOME is a valid numeric genome', () => {
    expect(validateGenome(SEED_GENOME).ok).toBe(true);
  });

  it('the real vendored D6 tree self-check passes', () => {
    expect(verifyD6(BUNDLE_ROOT)).toBe(true);
  });

  it('deterministic seeds were found (an advancing and a non-advancing one)', () => {
    expect(advanceSeed).toBeGreaterThan(0);
    expect(retainSeed).toBeGreaterThan(0);
  });
});

// --- POSITIVE path ---------------------------------------------------------------------------------------

describe('positive path', () => {
  it('a strictly-fitter, safe child ADVANCES and is retained as the next parent', () => {
    const g = makeGen(SEED_GENOME, advanceSeed, 1);
    const d = advanceGuard(g.parent, g.child, g.artifact, EVALUATOR_DIGEST, SAFETY_DIGEST, true);
    expect(d.advance).toBe(true);
    expect(d.retainParent).toBe(false);
    expect(d.refusals).toEqual([]);
    expect(strictlyDominates(g.child.metrics, g.parent.metrics)).toBe(true);
    expect(safetyOf(g.child.genome, g.child.metrics).safe).toBe(true);
    expect(verifyArtifact(g.artifact)).toBe(true);
  });

  it('the controller runGeneration advances the fitter child and writes a verifiable artifact', () => {
    const res = runGeneration(SEED_GENOME, 1, advanceSeed, { bundleRoot: BUNDLE_ROOT, outDir: TMP });
    expect(res.advance).toBe(true);
    expect(res.nextParent).not.toEqual(SEED_GENOME);
    expect(fs.existsSync(res.artifactPath)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(res.artifactPath, 'utf8')) as SealedArtifact;
    expect(verifyArtifact(onDisk)).toBe(true);
    expect(onDisk.body.grantsAuthority).toBe(false);
    expect(onDisk.body.advisoryOnly).toBe(true);
    expect(onDisk.body.fixtureCouncilVerdict.live).toBe(false);
  });

  it('runGenerations drives multiple generations deterministically and never partial-steps', () => {
    const a = runGenerations(1234, 4, { bundleRoot: BUNDLE_ROOT, outDir: TMP });
    const b = runGenerations(1234, 4, { bundleRoot: BUNDLE_ROOT, outDir: TMP });
    expect(candidateDigest(a.finalParent)).toBe(candidateDigest(b.finalParent));
    for (const gen of a.generations) {
      // every generation either advanced OR retained the parent — never a partial forward step
      expect(gen.advance === !gen.retainParent).toBe(true);
    }
  });
});

// --- NEGATIVE controls -----------------------------------------------------------------------------------

describe('negative control: non-fitter child retains the parent', () => {
  it('a non-dominating child does NOT advance', () => {
    const g = makeGen(SEED_GENOME, retainSeed, 1);
    const d = advanceGuard(g.parent, g.child, g.artifact, EVALUATOR_DIGEST, SAFETY_DIGEST, true);
    expect(d.advance).toBe(false);
    expect(d.retainParent).toBe(true);
  });
});

describe('negative control: tampered artifact byte', () => {
  it('mutating a metric flips the digest and REFUSES advancement', () => {
    const g = makeGen(SEED_GENOME, advanceSeed, 1);
    const bad = clone(g.artifact);
    (bad.body.metrics as { cost: number }).cost = bad.body.metrics.cost + 1;
    expect(verifyArtifact(bad)).toBe(false);
    const d = advanceGuard(g.parent, g.child, bad, EVALUATOR_DIGEST, SAFETY_DIGEST, true);
    expect(d.advance).toBe(false);
    expect(d.retainParent).toBe(true);
    expect(d.refusals).toContain('artifact-verify-failed');
  });
});

describe('negative control: mutated EVALUATOR_DIGEST', () => {
  it('a pinned evaluator digest that does not match REFUSES advancement', () => {
    const g = makeGen(SEED_GENOME, advanceSeed, 1);
    const d = advanceGuard(g.parent, g.child, g.artifact, WRONG_DIGEST, SAFETY_DIGEST, true);
    expect(d.advance).toBe(false);
    expect(d.retainParent).toBe(true);
    expect(d.refusals).toContain('evaluator-digest-mismatch');
  });
});

describe('negative control: mutated SAFETY_DIGEST', () => {
  it('a pinned safety digest that does not match REFUSES advancement', () => {
    const g = makeGen(SEED_GENOME, advanceSeed, 1);
    const d = advanceGuard(g.parent, g.child, g.artifact, EVALUATOR_DIGEST, WRONG_DIGEST, true);
    expect(d.advance).toBe(false);
    expect(d.retainParent).toBe(true);
    expect(d.refusals).toContain('safety-digest-mismatch');
  });
});

describe('negative control: mutated D6 byte', () => {
  it('a corrupted vendored D6 file makes verifyD6 false and the guard REFUSES', () => {
    const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'g1-d6-'));
    try {
      fs.cpSync(path.join(BUNDLE_ROOT, 'd6'), path.join(fakeRoot, 'd6'), { recursive: true });
      // clean copy verifies
      expect(verifyD6(fakeRoot)).toBe(true);
      // flip a byte in a vendored evidence file
      const victim = path.join(fakeRoot, 'd6', 'evidence', 'digest.ts');
      fs.appendFileSync(victim, '\n// tamper\n');
      expect(verifyD6(fakeRoot)).toBe(false);

      // guard with pinnedD6Ok=false refuses regardless of everything else being valid
      const g = makeGen(SEED_GENOME, advanceSeed, 1);
      const d = advanceGuard(g.parent, g.child, g.artifact, EVALUATOR_DIGEST, SAFETY_DIGEST, false);
      expect(d.advance).toBe(false);
      expect(d.refusals).toContain('d6-verification-failed');
    } finally {
      fs.rmSync(fakeRoot, { recursive: true, force: true });
    }
  });
});

describe('negative control: wrong parentDigest', () => {
  it('a broken parent linkage REFUSES advancement', () => {
    const g = makeGen(SEED_GENOME, advanceSeed, 1);
    const child = { ...g.child, parentDigest: WRONG_DIGEST };
    const d = advanceGuard(g.parent, child, g.artifact, EVALUATOR_DIGEST, SAFETY_DIGEST, true);
    expect(d.advance).toBe(false);
    expect(d.refusals).toContain('parent-linkage-mismatch');
  });
});

describe('negative control: non-sequential generation', () => {
  it('a generation that is not parent+1 REFUSES advancement', () => {
    const g = makeGen(SEED_GENOME, advanceSeed, 1);
    const child = { ...g.child, generation: 3 };
    const d = advanceGuard(g.parent, child, g.artifact, EVALUATOR_DIGEST, SAFETY_DIGEST, true);
    expect(d.advance).toBe(false);
    expect(d.refusals).toContain('non-sequential-generation');
  });
});

describe('negative control: path containment', () => {
  it("rejects '../etc' traversal", () => {
    expect(() => resolveContained(TMP, '../etc/passwd')).toThrow(ContainmentError);
  });

  it('rejects an absolute path', () => {
    expect(() => resolveContained(TMP, '/etc/passwd')).toThrow(ContainmentError);
  });

  it('rejects a symlink escape planted inside the base dir', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'g1-base-'));
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'g1-target-'));
    try {
      fs.symlinkSync(target, path.join(base, 'evil'));
      expect(() => resolveContained(base, 'evil/x.json')).toThrow(ContainmentError);
      // a normal contained path still resolves
      expect(resolveContained(base, 'ok.json')).toBe(path.join(fs.realpathSync(base), 'ok.json'));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
      fs.rmSync(target, { recursive: true, force: true });
    }
  });
});

describe('negative control: missing resourceMeasurements sensor field', () => {
  it('deleting a sensor field fails verifyArtifact and REFUSES advancement', () => {
    const g = makeGen(SEED_GENOME, advanceSeed, 1);
    const bad = clone(g.artifact);
    delete (bad.body.resourceMeasurements as { toolCalls?: number }).toolCalls;
    expect(verifyArtifact(bad)).toBe(false);
    const d = advanceGuard(g.parent, g.child, bad, EVALUATOR_DIGEST, SAFETY_DIGEST, true);
    expect(d.advance).toBe(false);
    expect(d.refusals).toContain('artifact-verify-failed');
  });
});

describe('negative control: candidate cannot supply authority/measurement fields', () => {
  it('a genome carrying {grantsAuthority:true} is REFUSED by validateGenome', () => {
    const bad = { ...SEED_GENOME, grantsAuthority: true } as unknown;
    const v = validateGenome(bad);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reasons.some((r) => r.startsWith('unknown-key:grantsAuthority'))).toBe(true);
  });

  it("a genome carrying {apply:'x'} is REFUSED by validateGenome", () => {
    const bad = { ...SEED_GENOME, apply: 'x' } as unknown;
    const v = validateGenome(bad);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reasons).toContain('unknown-key:apply');
      expect(v.reasons.some((r) => r.startsWith('authority-shaped-key:apply'))).toBe(true);
    }
  });

  it('a genome carrying its own metrics/evaluatorDigest is REFUSED', () => {
    const bad = {
      ...SEED_GENOME,
      metrics: { admitAccuracy: 1000, recoveryLatency: 0, cost: 0 },
      evaluatorDigest: WRONG_DIGEST,
    } as unknown;
    const v = validateGenome(bad);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reasons).toContain('unknown-key:metrics');
      expect(v.reasons).toContain('unknown-key:evaluatorDigest');
    }
  });

  it('the controller refuses a smuggling parent genome before anything runs', () => {
    const bad = { ...SEED_GENOME, apply: 'x' } as unknown as GenomeV0;
    expect(() => runGeneration(bad, 1, advanceSeed, { bundleRoot: BUNDLE_ROOT, outDir: TMP })).toThrow(
      GenomeRefusedError,
    );
  });

  it('out-of-bounds and non-integer fields are REFUSED', () => {
    expect(validateGenome({ ...SEED_GENOME, maxConcurrency: 999 }).ok).toBe(false);
    expect(validateGenome({ ...SEED_GENOME, admitThresholdBp: 1.5 }).ok).toBe(false);
    expect(validateGenome({ ...SEED_GENOME, admitThresholdBp: -0 }).ok).toBe(false);
  });
});

describe('negative control: deploy allowlist excludes key material (blocker 10)', () => {
  it('permits ordinary bundle sources', () => {
    expect(() => assertDeployable('src/controller.ts')).not.toThrow();
    expect(() => assertDeployable('d6/evidence/index.ts')).not.toThrow();
  });

  it('DENIES every SSH/private-key/secret shape', () => {
    for (const p of [
      'deploy/authority-node.key',
      '.ssh/id_ed25519',
      'id_rsa',
      'server.pem',
      '.env.production',
      'my-secret.txt',
    ]) {
      expect(() => assertDeployable(p)).toThrow();
    }
    const report = checkBundle([
      'src/controller.ts',
      'deploy/authority-node.key',
      '.ssh/id_ed25519',
      'aumlok/authority-ed25519.key',
    ]);
    expect(report.deployable).toContain('src/controller.ts');
    expect(report.denied).toContain('deploy/authority-node.key');
    expect(report.denied).toContain('.ssh/id_ed25519');
    expect(report.denied).toContain('aumlok/authority-ed25519.key');
  });
});

// --- determinism ----------------------------------------------------------------------------------------

describe('determinism', () => {
  it('same seed → same candidateDigest and same metrics', () => {
    const c1 = mutate(SEED_GENOME, 4242);
    const c2 = mutate(SEED_GENOME, 4242);
    expect(candidateDigest(c1)).toBe(candidateDigest(c2));
    expect(evaluate(c1)).toEqual(evaluate(c2));
  });

  it('EVALUATOR_DIGEST and SAFETY_DIGEST are stable 64-hex digests', () => {
    expect(EVALUATOR_DIGEST).toMatch(/^[0-9a-f]{64}$/);
    expect(SAFETY_DIGEST).toMatch(/^[0-9a-f]{64}$/);
  });
});
