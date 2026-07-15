import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { buildRuntimeTruthManifest, summarizeManifest, manifestGrantsAuthority } from '../src/runtimeTruthManifest';

// 24Z.14.1 — the manifest is GENERATED from disk/git, classifications cannot exceed proof, grants nothing.
const GEN_AT = '2026-06-20T00:00:00Z';

describe('24Z.14.1: runtime truth manifest (generated, not hand-written)', () => {
  it('is generated from real disk/git state', () => {
    const m = buildRuntimeTruthManifest({ generatedAt: GEN_AT });
    expect(m.schema).toBe('runtime-truth-manifest-v0');
    expect(m.gitHead.length).toBeGreaterThan(6); // a real sha or ref from .git
    expect(m.organs.length).toBeGreaterThan(0);
    expect(m.kernel.modules).toContain('aukoraReceipts');
    expect(m.grantsAuthority).toBe(false);
    expect(manifestGrantsAuthority(m)).toBe(false);
  });

  it('the live closure has NO real LLM (local planner active) and no apply lane', () => {
    const m = buildRuntimeTruthManifest({ generatedAt: GEN_AT });
    expect(m.runtimeClosure.realLlmInClosure).toBe(false);
    expect(m.primaryEngine).toBe('local-planner');
    expect(m.aumlok.applyLaneBuilt).toBe(false);
    expect(m.aumlok.signerWired).toBe(false);
    expect(m.kernel.mountedIntoApp).toBe(false); // inventoried only — not claimed runtime
    expect(m.convexBrain.status).toBe('lab_only'); // not claimed active
  });

  it('classifications cannot exceed proof — a missing repo root marks organs missing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aukora-man-'));
    try {
      const m = buildRuntimeTruthManifest({ generatedAt: GEN_AT, repoRoot: tmp, gitHead: 'deadbeef00' });
      expect(m.organs.find((o) => o.id === 'tauri-womb')!.mountState).toBe('missing');
      expect(m.kernel.modules).toEqual([]);
      expect(m.primaryEngine).toBe('local-planner'); // safe fallback
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('carries forbidden claims that guard Monday overclaim', () => {
    const m = buildRuntimeTruthManifest({ generatedAt: GEN_AT });
    const f = m.forbiddenClaims.join(' ').toLowerCase();
    expect(f).toContain('opencode powers tori');
    expect(f).toContain('self-build');
    expect(f).toContain('kernel is the app runtime');
  });

  it('has a generated landmine board', () => {
    const m = buildRuntimeTruthManifest({ generatedAt: GEN_AT });
    expect(m.landmineBoard.length).toBeGreaterThan(0);
    for (const l of m.landmineBoard) expect(['red', 'yellow', 'ok']).toContain(l.severity);
  });

  it('24Z.17: the draftPipeline is generated read-only (canApply=false) + carries a FRESH kernel fingerprint', async () => {
    const { checkKernelActionTableFreshness } = await import('../src/kernelActionClassifier');
    const m = buildRuntimeTruthManifest({ generatedAt: GEN_AT });
    expect(m.draftPipeline.canApply).toBe(false);
    expect(m.draftPipeline.sacredPatterns.length).toBeGreaterThan(0);
    // the embedded fingerprint matches a fresh re-parse of the live registry (no staleness/drift)
    expect(checkKernelActionTableFreshness(m.draftPipeline.fingerprint).fresh).toBe(true);
  });

  it('is DETERMINISTIC — same inputs regenerate byte-identical (GLM rec: not a plausible-lie generator)', () => {
    const a = buildRuntimeTruthManifest({ generatedAt: GEN_AT, gitHead: 'fixedsha123' });
    const b = buildRuntimeTruthManifest({ generatedAt: GEN_AT, gitHead: 'fixedsha123' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('summary is truthful + advisory (live vs lab/parked, no authority language)', () => {
    const s = summarizeManifest(buildRuntimeTruthManifest({ generatedAt: GEN_AT }));
    expect(s).toContain('Runtime truth');
    expect(s).toContain('active engine = local-planner');
    expect(s).toContain('grants no authority');
    expect(s.toLowerCase()).not.toContain('access granted');
  });
});
