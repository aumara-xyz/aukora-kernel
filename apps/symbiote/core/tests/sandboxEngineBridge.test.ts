import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  LocalPlannerEngine, OpenCodeSandboxEngine, runSandboxEngine, buildSandboxEngineInventory, summarizeSandboxEngines,
} from '../src/sandboxEngineBridge';
import { detectOpenCode, resolveOpenCodeEngine, assertOpenCodeSpawnAllowed, summarizeOpenCodeEngine } from '../src/openCodeSandboxRunner';
import { validateSandboxApplyReceipt } from '../src/sandboxApply';

// 24Z.19 — engine-agnostic sandbox lane: an engine produces a patch -> classify -> permit -> temp apply ->
// receipt naming the engine. OpenCode is detected but PARKED (gated). Live repo never touched.

const REPO = path.resolve(__dirname, '..', '..', '..');

describe('24Z.19: OpenCode detection + parked engine', () => {
  it('detects the OpenCode lab honestly', () => {
    const d = detectOpenCode(REPO);
    expect(typeof d.detected).toBe('boolean');
    if (d.detected) expect(d.cliPath).toContain('opencode-lab/opencode-dev');
  });
  it('OpenCode resolves PARKED (canSpawn=false) — no signer, no live handle, no shell', () => {
    const e = resolveOpenCodeEngine(REPO);
    expect(e.canSpawn).toBe(false);
    expect(e.liveRepoHandle).toBe(false);
    expect(e.shell).toBe(false);
    expect(['unavailable', 'parked_partial']).toContain(e.status);
  });
  it('assertOpenCodeSpawnAllowed THROWS (parked) — the real spawn is never reached today', () => {
    expect(() => assertOpenCodeSpawnAllowed(REPO)).toThrow(/denied/i);
  });
  it('the OpenCode engine refuses to propose (parked) — no patch, no spawn', () => {
    const r = runSandboxEngine({ prompt: 'add a feature to drafts', engine: new OpenCodeSandboxEngine(REPO), now: '2026-06-22T12:00:00.000Z' });
    expect(r.outcome).toBe('refused');
    expect(r.reason).toMatch(/parked|denied/i);
    expect(r.receipt).toBeNull();
    expect(r.liveRepoUnchanged).toBe(true);
  });
});

describe('24Z.19: local engine produces a real sandbox mutation through the gated lane', () => {
  const NOW = '2026-06-22T12:00:00.000Z';
  it('a write_gated prompt → local engine → temp-only apply → receipt naming the engine', () => {
    const r = runSandboxEngine({ prompt: 'add a hello draft note', engine: new LocalPlannerEngine(), now: NOW });
    expect(r.outcome).toBe('applied_sandbox');
    expect(r.engineSource).toBe('local_planner');
    expect(r.appliedLive).toBe(false);
    expect(r.liveRepoUnchanged).toBe(true);
    expect(r.receipt).not.toBeNull();
    expect(r.receipt!.engineSource).toBe('local_planner');
    expect(r.receipt!.appliedLive).toBe(false);
    expect(validateSandboxApplyReceipt(r.receipt!).valid).toBe(true);
  });

  it('a SACRED prompt is refused before any apply (never reaches the sandbox)', () => {
    const r = runSandboxEngine({ prompt: 'change the aukora token secret', engine: new LocalPlannerEngine(), now: NOW });
    expect(r.outcome).toBe('refused');
    expect(r.classification.class).toBe('sacred');
    expect(r.receipt).toBeNull();
  });

  it('a read-only prompt does not apply (only write_gated applies)', () => {
    const r = runSandboxEngine({ prompt: 'what kernel modules are mounted?', engine: new LocalPlannerEngine(), now: NOW });
    expect(r.outcome).toBe('refused');
    expect(['read_only', 'unknown']).toContain(r.classification.class);
  });

  it('an engine proposing a SACRED file path is refused by the sandbox apply', () => {
    const evil: any = { id: 'mock', propose: () => [{ relPath: 'convex/aukora_kill_switch.ts', content: 'x' }] };
    const r = runSandboxEngine({ prompt: 'add a config helper', engine: evil, now: NOW });
    expect(r.outcome).toBe('refused');
    expect(r.reason).toMatch(/sacred|refused/i);
    expect(r.liveRepoUnchanged).toBe(true);
  });

  it('the live repo is unchanged after an engine sandbox run (this file keeps its hash)', () => {
    const live = path.resolve(__dirname, '..', 'src', 'sandboxEngineBridge.ts');
    const crypto = require('crypto');
    const before = crypto.createHash('sha256').update(fs.readFileSync(live)).digest('hex');
    runSandboxEngine({ prompt: 'add a draft note', engine: new LocalPlannerEngine(), now: NOW });
    const after = crypto.createHash('sha256').update(fs.readFileSync(live)).digest('hex');
    expect(after).toBe(before);
  });
});

describe('24Z.19: engine inventory is honest', () => {
  it('active=local_planner, OpenCode parked, liveApply/productionSigner false', () => {
    const inv = buildSandboxEngineInventory(REPO);
    expect(inv.activeEngine).toBe('local_planner');
    expect(inv.openCode.canSpawn).toBe(false);
    expect(inv.liveApply).toBe(false);
    expect(inv.productionSigner).toBe(false);
    const s = summarizeSandboxEngines(inv);
    expect(s).toContain('LIVE apply: false');
    expect(summarizeOpenCodeEngine(resolveOpenCodeEngine(REPO))).toContain('NO authority');
  });

  it('no shell/exec spawn surface ships in the runner or bridge while parked', () => {
    for (const f of ['openCodeSandboxRunner.ts', 'sandboxEngineBridge.ts']) {
      const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', f), 'utf-8');
      expect(src, f).not.toMatch(/execSync|spawnSync|spawn\(|shell:\s*true|child_process/);
    }
  });
});
