import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  buildConvexBrainReadOnlyMount, summarizeConvexBrainMount, assertConvexMountSafe, convexMountGrantsAuthority,
  computeLiveReadEdge,
} from '../src/convexBrainReadOnlyMount';

// 24Z.16 — Convex brain mounted READ-ONLY: real inventory, no prod, no mutation surface, no executor, no secrets.

describe('24Z.16: Convex brain read-only mount', () => {
  it('mounts the real brain snapshot + a durable workflow inventory', () => {
    const m = buildConvexBrainReadOnlyMount();
    expect(m.schema).toBe('convex-brain-readonly-mount-v0');
    expect(m.brain.organCount).toBeGreaterThan(0);
    expect(m.workflowSummary.total).toBeGreaterThan(0); // workflow.ts/memory.ts/aumlokMemory.ts parsed
  });

  it('NEVER claims a live read edge or production connection in static mode', () => {
    const m = buildConvexBrainReadOnlyMount();
    expect(m.productionConnection).toBe(false);
    expect(m.brain.liveReadEdge).toBe(false); // static_inventory in generated/test mode → not active
    expect(['static_inventory', 'local_loopback_readonly', 'missing']).toContain(m.brain.bridgeMode);
  });

  it('exposes NO mutation/write surface and NO executor; grants no authority', () => {
    const m = buildConvexBrainReadOnlyMount();
    expect(m.mutationExposed).toBe(false);
    expect(m.executorWired).toBe(false);
    expect(m.secretsExposed).toBe(false);
    expect(m.grantsAuthority).toBe(false);
    expect(convexMountGrantsAuthority(m)).toBe(false);
    expect(() => assertConvexMountSafe(m)).not.toThrow();
  });

  it('classifies workflow functions honestly: queries readonly, writes parked, authority-writes forbidden', () => {
    const m = buildConvexBrainReadOnlyMount();
    const byName = Object.fromEntries(m.workflows.map((w) => [w.name, w]));
    expect(byName['getWorkflowStatus'].classification).toBe('readonly'); // query
    expect(byName['stageWorkflowEffect'].classification).toBe('parked'); // write mutation
    expect(byName['runWorkflow'].classification).toBe('parked');         // action/executor
    expect(byName['aumlokMemoryWrite'].classification).toBe('forbidden'); // authority write
  });

  it('a missing convex dir → empty inventory + every source listed missing (real scan)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aukora-cvx-'));
    try {
      const m = buildConvexBrainReadOnlyMount({ repoRoot: tmp });
      expect(m.workflowSummary.total).toBe(0);
      expect(m.workflowSummary.missingFiles.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('summary answers brain/memory/workflow/write/parked truthfully', () => {
    const s = summarizeConvexBrainMount(buildConvexBrainReadOnlyMount());
    expect(s).toContain('mounted READ-ONLY');
    expect(s).toContain('Can you write memory? NO');
    expect(s).toContain('NOT production-wired');
  });

  it('source is pure metadata — no production convex url / auma.one / mutation execution', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'convexBrainReadOnlyMount.ts'), 'utf-8');
    expect(src).not.toMatch(/\.convex\.cloud|\.convex\.dev|\.convex\.site|auma\.one/);
    expect(src).not.toMatch(/ConvexHttpClient|new ConvexClient|\.mutation\(|\.action\(/);
  });

  // ── Fusion 24Z.16 fold-ins (Opus/GLM/DeepSeek) ──

  it('(Opus) liveReadEdge can ONLY be true via a verified loopback mode — static/missing can never flip it', () => {
    expect(computeLiveReadEdge('static_inventory')).toBe(false);
    expect(computeLiveReadEdge('missing')).toBe(false);
    expect(computeLiveReadEdge('local_loopback_readonly')).toBe(true); // the only verified mode
  });

  it('(Opus) a tampered mount claiming liveReadEdge outside a verified mode is HARD-DENIED', () => {
    const base = buildConvexBrainReadOnlyMount();
    // forge an overclaim: liveReadEdge true while bridgeMode is static_inventory
    const forged = { ...base, brain: { ...base.brain, liveReadEdge: true, bridgeMode: 'static_inventory' as const } };
    expect(() => assertConvexMountSafe(forged)).toThrow(/live_read_edge_unverified/);
    // forge a prod connection alongside a "verified" loopback mode → still denied
    const forgedProd = { ...base, brain: { ...base.brain, liveReadEdge: true, bridgeMode: 'local_loopback_readonly' as const }, productionConnection: true as unknown as false };
    expect(() => assertConvexMountSafe(forgedProd)).toThrow();
  });

  it('(GLM/Kimi) inventory does NOT drift: re-parsing the sources matches the mount classification', () => {
    const convexDir = path.resolve(__dirname, '..', '..', '..', 'node-template', 'convex');
    const RE = /export const (\w+)\s*=\s*(internalMutation|internalQuery|internalAction|mutation|query|action)\b/g;
    const fresh: Record<string, string> = {};
    for (const file of ['workflow.ts', 'memory.ts', 'aumlokMemory.ts']) {
      const src = fs.readFileSync(path.join(convexDir, file), 'utf-8');
      let m: RegExpExecArray | null; RE.lastIndex = 0;
      while ((m = RE.exec(src)) !== null) fresh[m[1]] = m[2];
    }
    const mount = buildConvexBrainReadOnlyMount();
    // every freshly-parsed function appears in the mount with the same kind (no silent drop/misclass)
    for (const [name, kind] of Object.entries(fresh)) {
      const w = mount.workflows.find((x) => x.name === name);
      expect(w, `workflow ${name} missing from mount`).toBeTruthy();
      expect(w!.kind).toBe(kind);
    }
    expect(mount.workflows.length).toBe(Object.keys(fresh).length); // no phantom entries
  });

  it('(DeepSeek/Qwen) every parked/forbidden workflow has NO callable surface — only inert metadata', () => {
    const m = buildConvexBrainReadOnlyMount();
    for (const w of m.workflows) {
      // a WorkflowFn is pure data: name/kind/file/path/classification/reason — no function handle to invoke
      expect(typeof (w as unknown as Record<string, unknown>).invoke).toBe('undefined');
      expect(typeof (w as unknown as Record<string, unknown>).handler).toBe('undefined');
      expect(Object.values(w).some((v) => typeof v === 'function')).toBe(false);
    }
    // and the safety assertion proves no known mutation name leaks into a callable path
    expect(() => assertConvexMountSafe(m)).not.toThrow();
  });
});
