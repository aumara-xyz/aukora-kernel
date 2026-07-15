// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * FAIL-BEFORE repro. Every assertion here describes the PRE-FIX (vulnerable) behavior of the base commit
 * (11ed50a6). Run against the BASE sources it PASSES (the vulnerabilities are present); run against the FIXED
 * sources it FAILS (the vulnerabilities are closed). scripts/fail-before.sh drives both directions.
 *
 * Imports only symbols that exist in BOTH base and fixed sources, so it loads either way.
 */
import { it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveContained } from '../src/containment';
import { buildArtifact, verifyArtifact, artifactDigest, fixtureCouncil } from '../src/evidence';
import { verifyD6 } from '../src/d6selfcheck';
import { runGenerations, SEED_GENOME } from '../src/controller';
import { assertDeployable } from '../src/allowlist';
import { evaluate, EVALUATOR_DIGEST } from '../src/evaluator';
import { SAFETY_DIGEST } from '../src/safety';
import { candidateDigest } from '../src/lineage';
import { HardStop } from '../src/teardown';

const BUNDLE_ROOT = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'g1-fb-'));

it('BASE#1 a final-component symlink is NOT rejected (escape possible)', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fb1-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fb1o-'));
  fs.writeFileSync(path.join(out, 'v.txt'), 'x');
  fs.symlinkSync(path.join(out, 'v.txt'), path.join(base, 'g.json'));
  // PRE-FIX: resolveContained returns a path (parent is fine); the final-component symlink is not caught.
  expect(() => resolveContained(base, 'g.json')).not.toThrow();
});

it('BASE#2 verifyArtifact ACCEPTS an extra body key with a recomputed digest', () => {
  const ev = evaluate(SEED_GENOME);
  const cd = candidateDigest(SEED_GENOME);
  const art = buildArtifact({
    generation: 1, parentDigest: 'a'.repeat(64), candidateDigest: cd,
    metrics: ev.metrics, resourceMeasurements: ev.resourceMeasurements,
    evaluatorDigest: EVALUATOR_DIGEST, safetyDigest: SAFETY_DIGEST,
    fixtureCouncilVerdict: fixtureCouncil(cd, ev.metrics),
  });
  const bad = JSON.parse(JSON.stringify(art));
  bad.body.grantsAuthorityForReal = true;
  bad.digest = artifactDigest(bad.body);
  // PRE-FIX: not exact-key closed ⇒ the recomputed digest matches and verify passes.
  expect(verifyArtifact(bad)).toBe(true);
});

it('BASE#3 verifyD6 ACCEPTS a pin that names a different commit', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fb3-'));
  fs.cpSync(path.join(BUNDLE_ROOT, 'd6'), path.join(root, 'd6'), { recursive: true });
  const pinPath = path.join(root, 'd6', 'D6_TREE_VERIFICATION.json');
  const pin = JSON.parse(fs.readFileSync(pinPath, 'utf8'));
  pin.d6_commit = 'deadbeef'.repeat(5); // wrong commit, file hashes untouched
  fs.writeFileSync(pinPath, JSON.stringify(pin, null, 2));
  // PRE-FIX: only per-file hashes were bound ⇒ a swapped commit still verifies.
  expect(verifyD6(root)).toBe(true);
});

it('BASE#4 runGenerations IGNORES a pre-expired hard-stop and runs all generations', () => {
  const now = () => 1_000_000;
  const hardStop = new HardStop(now(), 0, 0);
  const out = path.join(TMP, 'fb4');
  // PRE-FIX: RunOptions had no hard-stop; the deadline is ignored and all `count` generations run.
  const s = runGenerations(1234, 3, { bundleRoot: BUNDLE_ROOT, outDir: out, hardStop, now } as never) as { generations: unknown[] };
  expect(s.generations.length).toBe(3);
});

it('BASE#5 package-lock.json is NOT deployable (runtime closure incomplete)', () => {
  // PRE-FIX: package-lock.json was not on the allowlist ⇒ refused.
  expect(() => assertDeployable('package-lock.json')).toThrow();
});
