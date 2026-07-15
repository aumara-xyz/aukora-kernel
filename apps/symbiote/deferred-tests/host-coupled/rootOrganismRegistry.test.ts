import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  buildRootOrganismRegistry, summarizeRegistryForContext, registryGrantsAuthority,
} from '../src/rootOrganismRegistry';

// 24Z.13 — Root Organism Registry. REAL fs checks; no ghost integrations. Missing ALWAYS beats present.

describe('24Z.13: root organism registry (live disk truth)', () => {
  it('reports the live organism with real present/missing from disk', () => {
    const r = buildRootOrganismRegistry();
    expect(r.schema).toBe('root-organism-registry-v0');
    expect(r.grantsAuthority).toBe(false);
    expect(registryGrantsAuthority(r)).toBe(false);
    // in-repo organs that genuinely exist must be present + classified (not 'missing')
    const byId = Object.fromEntries(r.organs.map((o) => [o.id, o]));
    expect(byId['aukora-os'].present).toBe(true);
    expect(byId['tauri-womb'].mountState).toBe('active_runtime');
    expect(byId['edge-node'].mountState).toBe('active_runtime');
    expect(byId['kernel-template'].present).toBe(true);
  });

  it('inventories REAL kernel modules from node-template/convex', () => {
    const r = buildRootOrganismRegistry();
    expect(r.kernelModules).toContain('aukoraReceipts');
    expect(r.kernelModules).toContain('aukoraMerkleLog');
    expect(r.kernelModules).toContain('aukoraPqcSigner');
    expect(r.kernelModules.length).toBeGreaterThanOrEqual(5);
  });

  it('OpenCode is honestly PARKED (source unpacked, not built) — not claimed active', () => {
    const oc = buildRootOrganismRegistry().organs.find((o) => o.id === 'opencode-lab')!;
    expect(oc.present).toBe(true);
    expect(oc.mountState).toBe('parked');
    expect(oc.consumedBy).toContain('not_yet');
    expect(oc.safeToExposeToTori).toBe(false); // engine source not exposed to the UI
  });

  it('ANTI-GHOST: a path that does not exist is marked missing, never present (Skunk rename red-team)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aukora-reg-'));
    try {
      // an empty fixture repo root: nothing exists → every in-repo organ must be 'missing'
      const r = buildRootOrganismRegistry({ repoRoot: tmp, externalBase: tmp });
      const repoOrgan = r.organs.find((o) => o.id === 'tauri-womb')!;
      expect(repoOrgan.present).toBe(false);
      expect(repoOrgan.mountState).toBe('missing');
      expect(repoOrgan.safeToExposeToTori).toBe(false);
      expect(r.kernelModules).toEqual([]); // no kernel dir in the fixture
      expect(r.summary.missing).toBeGreaterThan(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('a present-organ fixture flips back to its intended state (proves the check is real both ways)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aukora-reg2-'));
    try {
      fs.mkdirSync(path.join(tmp, 'internal', 'tauri-womb'), { recursive: true });
      const r = buildRootOrganismRegistry({ repoRoot: tmp, externalBase: tmp });
      expect(r.organs.find((o) => o.id === 'tauri-womb')!.present).toBe(true);
      expect(r.organs.find((o) => o.id === 'edge-node')!.present).toBe(false); // not created → still missing
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('the context summary is truthful + advisory (no authority language)', () => {
    const s = summarizeRegistryForContext(buildRootOrganismRegistry());
    expect(s).toContain('Aukora OS organism');
    expect(s).toContain('grants no authority');
    expect(s.toLowerCase()).not.toContain('access granted');
  });
});
