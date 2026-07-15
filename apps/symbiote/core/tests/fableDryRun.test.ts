import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { runFableSyntheticDryRun } from '../src/fableDryRun';
import { consolidateEpisodes } from '../src/continuityConsolidation';
import { buildFixtureEpisodeSeed } from '../src/fableIngestionSeed';

// 24Z.34 — the Fable dry run is SYNTHETIC, deterministic, evidence-only, and can never become real.
const lessons = consolidateEpisodes(buildFixtureEpisodeSeed('24Z.34')).lessons;

describe('24Z.34 Fable synthetic dry run', () => {
  it('is labeled synthetic_fixture and CANNOT authorize / be real', () => {
    const r = runFableSyntheticDryRun(lessons);
    expect(r.fableDryRunSource).toBe('synthetic_fixture');
    expect(r.ranOnRealEpisodes).toBe(false);
    expect(r.isRealFableModel).toBe(false);
    expect(r.grantsAuthority).toBe(false);
    expect(r.canAuthorize).toBe(false);
    expect(r.proposals.every((p) => p.canAuthorize === false && p.source === 'synthetic_fixture')).toBe(true);
  });
  it('is deterministic (same input → identical output)', () => {
    expect(JSON.stringify(runFableSyntheticDryRun(lessons))).toBe(JSON.stringify(runFableSyntheticDryRun(lessons)));
  });
  it('proposals are sorted by priority desc and carry NO episode prose (fixed rationale per kind)', () => {
    const r = runFableSyntheticDryRun(lessons);
    for (let i = 1; i < r.proposals.length; i++) expect(r.proposals[i - 1].priorityScore >= r.proposals[i].priorityScore).toBe(true);
    // rationale is one of the fixed engine strings (never contains a hash/id/payload)
    for (const p of r.proposals) expect(p.rationale).toMatch(/proposal only|NOTED only|baseline/i);
  });
  it('skips quarantine / non-Fable-readable lessons (they are metadata, not optimization input)', () => {
    const fakeLessons = [
      { ...lessons[0], fableReadable: false, lessonKind: 'boundary', consolidationId: 'q1' },
      { ...lessons[0], fableReadable: true, lessonKind: 'success', consolidationId: 's1' },
    ] as any;
    const r = runFableSyntheticDryRun(fakeLessons);
    expect(r.proposalCount).toBe(1);              // only the Fable-readable one produced a proposal
  });
});

describe('24Z.34 Fable dry run FIREWALL (evidence-only)', () => {
  const srcDir = path.resolve(__dirname, '..', 'src');
  it('fableDryRun imports no gate/apply/OpenCode/signer module', () => {
    const src = fs.readFileSync(path.join(srcDir, 'fableDryRun.ts'), 'utf-8');
    expect(src).not.toMatch(/from '\.\/(sandboxApply|sandboxApplyPermit|sandboxEngineBridge|openCodeSandboxRunner|mldsaSandboxSigner|kernelActionClassifier|localModelClient)'/);
  });
  it('no authority module imports fableDryRun', () => {
    for (const f of ['sandboxApply.ts', 'sandboxEngineBridge.ts', 'openCodeSandboxRunner.ts', 'mldsaSandboxSigner.ts', 'kernelActionClassifier.ts']) {
      const p = path.join(srcDir, f);
      if (fs.existsSync(p)) expect(fs.readFileSync(p, 'utf-8'), f).not.toMatch(/fableDryRun/);
    }
  });
});
