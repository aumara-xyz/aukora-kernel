// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Eagle Eye (#86): the doctor's verdict logic, pinned with INJECTED probes (never the host).
// Required tools FAIL when absent; optional tools + first-run conditions are CHECK; a clean
// environment is READY; and the render never emits keys, env values, usernames, or home paths.
import { describe, it, expect } from 'vitest';
import { evaluateDoctor, renderDoctor, type DoctorFacts } from '../../scripts/doctorChecks';

const READY: DoctorFacts = {
  platform: 'darwin', arch: 'arm64',
  bunVersion: '1.3.14', gitVersion: 'git version 2.44.0', nodeVersion: 'v22.0.0',
  ghPresent: true, ghAuthenticated: true,
  sourceForm: 'clone', repoIsPrivate: true,
  nodeHomeWritable: true, freeDiskGb: 120,
  requiredPorts: [3210, 7089, 7090, 7091, 7092, 7093, 7094, 7095], portsInUse: [],
  shellAssetsPresent: true, convexBackendPresent: true,
};
const byId = (f: DoctorFacts, id: string) => evaluateDoctor(f).checks.find((c) => c.id === id)!;

describe('evaluateDoctor — required tools are hard blockers', () => {
  it('a fully-ready clone has zero FAIL and reports READY', () => {
    const r = evaluateDoctor(READY);
    expect(r.fail).toBe(0);
    expect(r.ok).toBe(true);
    expect(renderDoctor(r)).toContain('READY');
  });
  it('missing Bun FAILs (required runtime)', () => {
    const r = evaluateDoctor({ ...READY, bunVersion: null });
    expect(byId({ ...READY, bunVersion: null }, 'bun').status).toBe('FAIL');
    expect(r.ok).toBe(false);
  });
  it('missing Git FAILs (required)', () => {
    expect(byId({ ...READY, gitVersion: null }, 'git').status).toBe('FAIL');
  });
  it('an unsupported platform/arch FAILs', () => {
    expect(byId({ ...READY, platform: 'aix' }, 'os').status).toBe('FAIL');
    expect(byId({ ...READY, arch: 'mips' }, 'os').status).toBe('FAIL');
  });
  it('a non-writable node home FAILs', () => {
    expect(byId({ ...READY, nodeHomeWritable: false }, 'home').status).toBe('FAIL');
  });
  it('missing shell assets FAILs (incomplete copy)', () => {
    expect(byId({ ...READY, shellAssetsPresent: false }, 'assets').status).toBe('FAIL');
  });
});

describe('evaluateDoctor — optional + first-run conditions are advisory CHECK, not FAIL', () => {
  it('missing Node is CHECK (app runs on Bun)', () => {
    const c = byId({ ...READY, nodeVersion: null }, 'node');
    expect(c.status).toBe('CHECK');
    expect(evaluateDoctor({ ...READY, nodeVersion: null }).ok).toBe(true);
  });
  it('gh is irrelevant for a ZIP or public source → PASS not-needed', () => {
    expect(byId({ ...READY, sourceForm: 'zip', ghPresent: false, ghAuthenticated: null }, 'gh').detail)
      .toContain('not needed');
  });
  it('a private clone without gh auth is CHECK with a gh auth action', () => {
    const c = byId({ ...READY, ghPresent: true, ghAuthenticated: false }, 'gh');
    expect(c.status).toBe('CHECK');
    expect(c.nextAction).toContain('gh auth login');
  });
  it('a ZIP source is CHECK (read/run only)', () => {
    expect(byId({ ...READY, sourceForm: 'zip' }, 'source').status).toBe('CHECK');
  });
  it('an absent backend is CHECK (downloads on first run)', () => {
    const c = byId({ ...READY, convexBackendPresent: false }, 'backend');
    expect(c.status).toBe('CHECK');
    expect(c.nextAction).toContain('55MB');
  });
  it('occupied required ports are CHECK and list only the numbers', () => {
    const c = byId({ ...READY, portsInUse: [7090, 3210, 65000] }, 'ports');
    expect(c.status).toBe('CHECK');
    expect(c.detail).toContain('3210');
    expect(c.detail).toContain('7090');
    expect(c.detail).not.toContain('65000'); // not in requiredPorts → ignored
  });
  it('undeterminable / low disk is CHECK, healthy disk is PASS', () => {
    expect(byId({ ...READY, freeDiskGb: null }, 'disk').status).toBe('CHECK');
    expect(byId({ ...READY, freeDiskGb: 0.4 }, 'disk').status).toBe('CHECK');
    expect(byId({ ...READY, freeDiskGb: 50 }, 'disk').status).toBe('PASS');
  });
});

describe('renderDoctor — privacy: no keys, env values, usernames, or home paths', () => {
  it('the rendered screen contains none of the sensitive host tokens', () => {
    // Even if the environment carried these, facts never do — so the render cannot leak them.
    const out = renderDoctor(evaluateDoctor({ ...READY, portsInUse: [7091] }));
    for (const bad of [process.env.HOME ?? '/Users', process.env.USER ?? 'nobody', 'admin-key', 'instance-secret', '.env']) {
      expect(out.includes(bad)).toBe(false);
    }
    expect(out).toContain('AUKORA DOCTOR');
  });
});
