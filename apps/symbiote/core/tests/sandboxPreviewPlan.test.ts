import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { buildKernelActionTable, classifyDraftAction } from '../src/kernelActionClassifier';
import { buildSandboxPreviewPlan, summarizeSandboxPreviewPlan, previewPlanGrantsAuthority } from '../src/sandboxPreviewPlan';

// 24Z.17 — sandbox preview PLAN: a description of what a gated dry-run would do. Writes nothing, applies nothing.

const table = buildKernelActionTable();
const plan = (intent: string, files?: string[]) =>
  buildSandboxPreviewPlan({ intent, verdict: classifyDraftAction(intent, table), filesLikelyTouched: files });

describe('24Z.17: sandbox preview plan (no live write, gate unsatisfied)', () => {
  it('always applied:false, liveWrite:false, gateSatisfied:false, canApplyNow:false', () => {
    for (const i of ['add a feature to App.tsx', 'write a fact to auma_memory', 'change the token secret', 'explain receipts']) {
      const p = plan(i);
      expect(p.applied).toBe(false);
      expect(p.liveWrite).toBe(false);
      expect(p.gateSatisfied).toBe(false);
      expect(p.canApplyNow).toBe(false);
      expect(p.grantsAuthority).toBe(false);
      expect(previewPlanGrantsAuthority(p)).toBe(false);
    }
  });

  it('a sacred (Ring-0) intent is REFUSED before preview — never applyable', () => {
    const p = plan('rotate the kill switch');
    expect(p.verdict.class).toBe('sacred');
    expect(p.blockedReason).toBe('ring0_sacred_never_applyable');
    expect(p.steps[0]).toMatch(/REFUSED/);
    expect(p.wouldWriteIfApplied).toBe(false); // sacred never writes
  });

  it('a write intent describes a gated dry-run that would touch named files but writes nothing now', () => {
    const p = plan('add a TestPanel to App.tsx', ['App.tsx']);
    expect(p.verdict.class).toBe('write_gated');
    expect(p.blockedReason).toBe('no_signed_apply_lane');
    expect(p.wouldWriteIfApplied).toBe(true);
    expect(p.predictedEffects[0]).toContain('App.tsx');
    expect(p.steps.some((s) => /never passed/.test(s))).toBe(true); // live repo path never passed
    expect(p.steps.some((s) => /BLOCKED/.test(s))).toBe(true);
  });

  it('a read intent needs no sandbox run and writes nothing', () => {
    const p = plan('what brain is mounted?');
    expect(p.verdict.class).toBe('read_only');
    expect(p.blockedReason).toBe('no_write_intended');
    expect(p.wouldWriteIfApplied).toBe(false);
  });

  it('summary is honest about the gate + no write', () => {
    const s = summarizeSandboxPreviewPlan(plan('add a feature to App.tsx', ['App.tsx']));
    expect(s).toContain('gateSatisfied=false');
    expect(s).toContain('writes nothing and runs nothing');
  });

  it('source never spawns/execs/writes', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'sandboxPreviewPlan.ts'), 'utf-8');
    expect(src).not.toMatch(/child_process|execFile|spawn\(|\bexec\(|writeFileSync|fetch\(/);
  });
});
