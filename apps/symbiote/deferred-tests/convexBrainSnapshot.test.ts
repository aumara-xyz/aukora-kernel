import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import {
  buildConvexBrainSnapshot,
  validateSnapshot,
  type ConvexBrainSnapshot,
} from '../src/convexBrainSnapshot';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

describe('24Y.1: Convex Brain Snapshot', () => {
  let snapshot: ConvexBrainSnapshot;

  it('builds snapshot from real repo', () => {
    snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    expect(snapshot).toBeDefined();
    expect(snapshot.advisoryOnly).toBe(true);
    expect(snapshot.grantsAuthority).toBe(false);
  });

  it('snapshot has advisoryOnly=true', () => {
    snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    expect(snapshot.advisoryOnly).toBe(true);
  });

  it('snapshot has grantsAuthority=false', () => {
    snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    expect(snapshot.grantsAuthority).toBe(false);
  });

  it('finds Convex schema', () => {
    snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    expect(snapshot.brainStatus.schemaFound).toBe(true);
  });

  it('counts tables correctly (30+)', () => {
    snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    expect(snapshot.brainStatus.tableCount).toBeGreaterThanOrEqual(30);
  });

  it('finds test files (35+)', () => {
    snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    expect(snapshot.brainStatus.testFileCount).toBeGreaterThanOrEqual(35);
  });

  it('has active candidate organs', () => {
    snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    expect(snapshot.activeCandidateCount).toBeGreaterThan(0);
  });

  it('has read-only candidate organs', () => {
    snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    expect(snapshot.readOnlyCandidateCount).toBeGreaterThan(0);
  });

  it('organ map includes receipts', () => {
    snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    const receipts = snapshot.organs.filter(o => o.category === 'receipts');
    expect(receipts.length).toBeGreaterThan(0);
    expect(receipts.some(o => o.name === 'aukoraReceipts')).toBe(true);
  });

  it('organ map includes aumlok', () => {
    snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    const aumlok = snapshot.organs.filter(o => o.category === 'aumlok');
    expect(aumlok.length).toBeGreaterThan(0);
    expect(aumlok.some(o => o.name === 'aumlokManifests')).toBe(true);
  });

  it('organ map includes witness', () => {
    snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    const witness = snapshot.organs.filter(o => o.category === 'witness');
    expect(witness.length).toBeGreaterThan(0);
  });

  it('organ map includes channel', () => {
    snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    const channel = snapshot.organs.filter(o => o.category === 'channel');
    expect(channel.length).toBeGreaterThan(0);
  });

  it('organ map includes core', () => {
    snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    const core = snapshot.organs.filter(o => o.category === 'core');
    expect(core.length).toBeGreaterThan(0);
  });

  it('FORBIDDEN organs are not safe to expose', () => {
    snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    const forbidden = snapshot.organs.filter(o => o.status === 'FORBIDDEN');
    for (const organ of forbidden) {
      expect(organ.safeToExposeToWomb).toBe(false);
    }
  });

  it('passes validation', () => {
    snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    const v = validateSnapshot(snapshot);
    expect(v.valid).toBe(true);
    expect(v.violations).toEqual([]);
  });

  it('bridgeMode is static_inventory (no live connection)', () => {
    snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    expect(snapshot.bridgeMode).toBe('static_inventory');
  });

  it('lists risks about integration gap', () => {
    snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    expect(snapshot.risks.length).toBeGreaterThan(0);
    expect(snapshot.risks.some(r => r.toLowerCase().includes('not wired'))).toBe(true);
  });

  it('has next safe wiring step', () => {
    snapshot = buildConvexBrainSnapshot(REPO_ROOT);
    expect(snapshot.nextSafeWiringStep.length).toBeGreaterThan(0);
  });
});

describe('24Y.1: Snapshot validation rejects bad snapshots', () => {
  it('rejects grantsAuthority=true', () => {
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    (snap as any).grantsAuthority = true;
    const v = validateSnapshot(snap);
    expect(v.valid).toBe(false);
  });

  it('rejects advisoryOnly=false', () => {
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    (snap as any).advisoryOnly = false;
    const v = validateSnapshot(snap);
    expect(v.valid).toBe(false);
  });

  it('rejects secret fields', () => {
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    (snap as any).apiKey = 'sk-test';
    const v = validateSnapshot(snap);
    expect(v.valid).toBe(false);
  });

  it('rejects deployment URLs', () => {
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    (snap as any).deploymentUrl = 'https://foo.convex.cloud';
    const v = validateSnapshot(snap);
    expect(v.valid).toBe(false);
  });

  it('rejects deployment slugs', () => {
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    (snap as any).deploymentSlug = 'my-slug';
    const v = validateSnapshot(snap);
    expect(v.valid).toBe(false);
  });

  it('rejects cloud URL in string values', () => {
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    (snap as any).url = 'https://something.convex.cloud/api';
    const v = validateSnapshot(snap);
    expect(v.valid).toBe(false);
  });

  it('rejects FORBIDDEN organ marked safe', () => {
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    const forbidden = snap.organs.find(o => o.status === 'FORBIDDEN');
    if (forbidden) {
      forbidden.safeToExposeToWomb = true;
      const v = validateSnapshot(snap);
      expect(v.valid).toBe(false);
    }
  });

  it('rejects invalid bridgeMode', () => {
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    (snap as any).bridgeMode = 'live_cloud';
    const v = validateSnapshot(snap);
    expect(v.valid).toBe(false);
  });
});

describe('24Y.1: Structural safety', () => {
  it('convexBrainSnapshot.ts has no cloud calls', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'convexBrainSnapshot.ts'), 'utf-8');
    const lines = src.split('\n');
    for (const line of lines) {
      expect(line).not.toMatch(/\bfetch\s*\(/);
      expect(line).not.toMatch(/https:\/\/.*convex\.(cloud|dev)/);
      expect(line).not.toMatch(/openrouter/i);
      expect(line).not.toMatch(/nebius/i);
    }
  });

  it('convexBrainSnapshot.ts has no Convex mutations', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'convexBrainSnapshot.ts'), 'utf-8');
    expect(src).not.toMatch(/mutation\s*\(/);
    expect(src).not.toMatch(/\.insert\s*\(/);
    expect(src).not.toMatch(/\.replace\s*\(/);
    expect(src).not.toMatch(/\.delete\s*\(/);
    expect(src).not.toMatch(/\.patch\s*\(/);
  });

  it('convexBrainSnapshot.ts has no AUMA-ONE runtime imports', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'convexBrainSnapshot.ts'), 'utf-8');
    const importLines = src.split('\n').filter(l => l.match(/^\s*(import|require)\s/));
    for (const line of importLines) {
      expect(line).not.toMatch(/AUMA-ONE-APP/);
    }
  });

  it('Gate remains only authority', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'convexBrainSnapshot.ts'), 'utf-8');
    const authorityMatches = src.match(/grantsAuthority:\s*(true|false)/g) ?? [];
    for (const m of authorityMatches) {
      expect(m).toContain('false');
    }
  });

  it('master path mentions Convex is built but not womb-wired', () => {
    const masterPath = fs.readFileSync(path.join(REPO_ROOT, 'AUKORA_SINGULARITY_PATH.md'), 'utf-8');
    expect(masterPath).toContain('BUILT');
    expect(masterPath).toMatch(/NOT.*WOMB.WIRED|not.*womb.wired|NOT_WOMB_WIRED/i);
  });

  it('artifact type includes convex brain snapshot', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'opencodeWombArtifact.ts'), 'utf-8');
    expect(src).toContain('current_convex_brain_snapshot');
    expect(src).toContain('ConvexBrainSnapshot');
  });

  it('node-template/convex directory exists', () => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'node-template', 'convex'))).toBe(true);
  });

  it('internal/convex-brain directory exists', () => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'internal', 'convex-brain'))).toBe(true);
  });
});

describe('24Y.2: AUMA-ONE donor inventory', () => {
  it('donorCount > 0', () => {
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    expect(snap.donorCount).toBeGreaterThan(0);
  });

  it('sourceRepos includes AUMA-ONE-APP', () => {
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    expect(snap.sourceRepos).toContain('AUMA-ONE-APP');
    expect(snap.sourceRepos).toContain('aukora-os');
  });

  it('organ map includes donor memory', () => {
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    const mem = snap.organs.find(o => o.name === 'donor_memory');
    expect(mem).toBeDefined();
    expect(mem!.status).toBe('DONOR_ONLY');
    expect(mem!.sourceRepo).toBe('AUMA-ONE-APP');
    expect(mem!.runtimeImportAllowed).toBe(false);
  });

  it('organ map includes donor paladin', () => {
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    const pal = snap.organs.find(o => o.name === 'donor_paladin');
    expect(pal).toBeDefined();
    expect(pal!.category).toBe('paladin');
    expect(pal!.status).toBe('DONOR_ONLY');
  });

  it('organ map includes donor womb', () => {
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    expect(snap.organs.some(o => o.name === 'donor_womb')).toBe(true);
  });

  it('organ map includes donor aumlok', () => {
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    expect(snap.organs.some(o => o.name === 'donor_aumlok')).toBe(true);
  });

  it('organ map includes donor organism', () => {
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    expect(snap.organs.some(o => o.name === 'donor_organism')).toBe(true);
  });

  it('organ map includes KNVS trinity', () => {
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    const knvs = snap.organs.find(o => o.name === 'donor_knvs_trinity');
    expect(knvs).toBeDefined();
    expect(knvs!.category).toBe('knvs');
  });

  it('organ map includes donor project37 council', () => {
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    expect(snap.organs.some(o => o.name === 'donor_project37')).toBe(true);
  });

  it('no AUMA-ONE organ has runtimeImportAllowed', () => {
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    const donors = snap.organs.filter(o => o.sourceRepo === 'AUMA-ONE-APP');
    expect(donors.length).toBeGreaterThan(0);
    for (const d of donors) {
      expect(d.runtimeImportAllowed).toBe(false);
    }
  });

  it('no AUMA-ONE organ is safe to expose to womb', () => {
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    const donors = snap.organs.filter(o => o.sourceRepo === 'AUMA-ONE-APP');
    for (const d of donors) {
      expect(d.safeToExposeToWomb).toBe(false);
    }
  });

  it('all aukora-os organs have sourceRepo=aukora-os', () => {
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    const runtime = snap.organs.filter(o => !o.name.startsWith('donor_'));
    for (const r of runtime) {
      expect(r.sourceRepo).toBe('aukora-os');
    }
  });

  it('donor organs have fileCount > 0', () => {
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    const donors = snap.organs.filter(o => o.sourceRepo === 'AUMA-ONE-APP');
    for (const d of donors) {
      expect(d.fileCount).toBeGreaterThan(0);
    }
  });

  it('validation rejects DONOR_ONLY with runtimeImportAllowed', () => {
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    const donor = snap.organs.find(o => o.status === 'DONOR_ONLY');
    expect(donor).toBeDefined();
    donor!.runtimeImportAllowed = true;
    const v = validateSnapshot(snap);
    expect(v.valid).toBe(false);
    expect(v.violations.some(v => v.includes('runtimeImportAllowed'))).toBe(true);
  });

  it('validation rejects donorCount=0', () => {
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    snap.donorCount = 0;
    const v = validateSnapshot(snap);
    expect(v.valid).toBe(false);
  });

  it('validation rejects missing sourceRepos', () => {
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    snap.sourceRepos = ['aukora-os'];
    const v = validateSnapshot(snap);
    expect(v.valid).toBe(false);
  });

  it('no mutation/write APIs in bridge code', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'convexBrainSnapshot.ts'), 'utf-8');
    expect(src).not.toMatch(/mutation\s*\(/);
    expect(src).not.toMatch(/ctx\.db\./);
  });

  it('no cloud Convex URL in source', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'convexBrainSnapshot.ts'), 'utf-8');
    expect(src).not.toMatch(/https:\/\/.*convex\.(cloud|dev|site)/);
  });
});

describe('24Y.1: Readiness check', () => {
  it('readiness script exists and exports checkReadiness', async () => {
    const { checkReadiness } = await import('../evidence/check-convex-brain-readiness');
    expect(typeof checkReadiness).toBe('function');
  });

  it('readiness check returns advisory result', async () => {
    const { checkReadiness } = await import('../evidence/check-convex-brain-readiness');
    const result = checkReadiness();
    expect(result.advisoryOnly).toBe(true);
    expect(result.grantsAuthority).toBe(false);
  });

  it('readiness check finds schema', async () => {
    const { checkReadiness } = await import('../evidence/check-convex-brain-readiness');
    const result = checkReadiness();
    expect(result.schemaFound).toBe(true);
    expect(result.tableCount).toBeGreaterThanOrEqual(30);
  });
});

// ── 24Y.3 Preflight: local loopback bridge constraints ──

const LOOPBACK_RE = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

function isLoopbackUrl(url: string): boolean {
  return LOOPBACK_RE.test(url);
}

describe('24Y.3 preflight: loopback URL validation', () => {
  it('accepts localhost', () => {
    expect(isLoopbackUrl('http://localhost:3220')).toBe(true);
  });

  it('accepts 127.0.0.1', () => {
    expect(isLoopbackUrl('http://127.0.0.1:3220')).toBe(true);
  });

  it('accepts [::1]', () => {
    expect(isLoopbackUrl('http://[::1]:3220')).toBe(true);
  });

  it('accepts localhost without port', () => {
    expect(isLoopbackUrl('http://localhost')).toBe(true);
  });

  it('accepts https loopback', () => {
    expect(isLoopbackUrl('https://127.0.0.1:3220')).toBe(true);
  });

  it('rejects convex.cloud', () => {
    expect(isLoopbackUrl('https://my-app.convex.cloud')).toBe(false);
  });

  it('rejects convex.dev', () => {
    expect(isLoopbackUrl('https://my-app.convex.dev')).toBe(false);
  });

  it('rejects arbitrary hostname', () => {
    expect(isLoopbackUrl('https://example.com:3220')).toBe(false);
  });

  it('rejects IP that is not 127.0.0.1', () => {
    expect(isLoopbackUrl('http://192.168.1.1:3220')).toBe(false);
  });

  it('rejects URL with credentials', () => {
    expect(isLoopbackUrl('http://user:pass@localhost:3220')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isLoopbackUrl('')).toBe(false);
  });
});

describe('24Y.3 preflight: bridge mode constraints', () => {
  it('snapshot bridgeMode is static_inventory when no live server', () => {
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    expect(snap.bridgeMode).toBe('static_inventory');
  });

  it('no mutation APIs in convexBrainSnapshot.ts', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'convexBrainSnapshot.ts'), 'utf-8');
    expect(src).not.toMatch(/\.insert\s*\(/);
    expect(src).not.toMatch(/\.replace\s*\(/);
    expect(src).not.toMatch(/\.delete\s*\(/);
    expect(src).not.toMatch(/\.patch\s*\(/);
    expect(src).not.toMatch(/mutation\s*\(/);
    expect(src).not.toMatch(/ctx\.db\./);
  });

  it('donor organs cannot be runtime-imported', () => {
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    const donors = snap.organs.filter(o => o.status === 'DONOR_ONLY');
    expect(donors.length).toBeGreaterThan(0);
    for (const d of donors) {
      expect(d.runtimeImportAllowed).toBe(false);
      expect(d.sourceRepo).toBe('AUMA-ONE-APP');
    }
  });

  it('artifact JSON is fallback when live source missing', () => {
    const snap = buildConvexBrainSnapshot(REPO_ROOT);
    expect(snap.bridgeMode).toBe('static_inventory');
    expect(snap.risks.some(r => r.toLowerCase().includes('not wired'))).toBe(true);
  });

  it('existing loopback URL validator rejects cloud URLs', () => {
    const providerSrc = fs.readFileSync(
      path.join(REPO_ROOT, 'internal', 'convex-brain', 'local-organism', 'convexCodebookProvider.ts'),
      'utf-8'
    );
    expect(providerSrc).toContain('refuse_non_loopback_convex_url');
    expect(providerSrc).toMatch(/127\.0\.0\.1|localhost/);
  });

  it('design doc exists for 24Y.3', () => {
    expect(fs.existsSync(path.join(__dirname, '..', 'evidence', '24y3-local-loopback-readonly-plan.md'))).toBe(true);
  });
});
