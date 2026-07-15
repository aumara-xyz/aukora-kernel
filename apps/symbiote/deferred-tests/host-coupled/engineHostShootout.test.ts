import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { buildEngineShootout, summarizeShootout, shootoutGrantsAuthority } from '../src/engineHostShootout';

// 24Z.14 — Host Engine Shootout. Evidence-based; no engine may write/run/apply; one active engine.

describe('24Z.14: engine host shootout (evidence, not mythology)', () => {
  it('benchmarks local-planner / opencode / hermes with honest status', () => {
    const s = buildEngineShootout();
    const byId = Object.fromEntries(s.engines.map((e) => [e.id, e]));
    expect(byId['local-planner'].status).toBe('active'); // powers Tori drafts today
    expect(['parked', 'blocked']).toContain(byId['opencode'].status);
    expect(['parked', 'donor_only']).toContain(byId['hermes'].status);
    expect(s.grantsAuthority).toBe(false);
    expect(shootoutGrantsAuthority(s)).toBe(false);
  });

  it('EVERY engine is draft-only — write/run/apply hard-pinned OFF', () => {
    for (const e of buildEngineShootout().engines) {
      expect(e.capabilities.canWriteFiles).toBe(false);
      expect(e.capabilities.canRunCommands).toBe(false);
      expect(e.capabilities.canApply).toBe(false);
    }
  });

  it('exactly ONE active engine, and it is the primary', () => {
    const s = buildEngineShootout();
    const active = s.engines.filter((e) => e.status === 'active');
    expect(active.length).toBe(1);
    expect(s.primaryEngine).toBe(active[0].id);
  });

  it('OpenCode is MIT + bun + carries an exact blocker (not vaguely "parked")', () => {
    const oc = buildEngineShootout().engines.find((e) => e.id === 'opencode')!;
    expect(oc.license).toBe('MIT');
    expect(oc.packageManager).toContain('bun');
    expect(oc.blocker.length).toBeGreaterThan(20);
    expect(oc.consumedBy).toBe('not_yet'); // honestly not the active engine
  });

  it('Hermes is honestly donor/parked (not claimed active) with a license-confirm note', () => {
    const h = buildEngineShootout().engines.find((e) => e.id === 'hermes')!;
    expect(['donor_only', 'parked']).toContain(h.status);
    expect(h.role).toBe('planner_orchestrator');
    expect(h.consumedBy.toLowerCase()).toContain('not_yet');
  });

  it('a fixture root with no engines still keeps a safe active fallback (local-planner)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aukora-eng-'));
    try {
      const s = buildEngineShootout({ repoRoot: tmp, hermesUnpacked: false });
      expect(s.primaryEngine).toBe('local-planner');
      expect(s.engines.find((e) => e.id === 'opencode')!.present).toBe(false);
      expect(s.engines.find((e) => e.id === 'opencode')!.status).toBe('blocked');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('summary is truthful + advisory (no authority language)', () => {
    const s = summarizeShootout(buildEngineShootout());
    expect(s).toContain('Active engine:');
    expect(s).toContain('draft-only');
    expect(s.toLowerCase()).not.toContain('access granted');
  });
});
