import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { buildKernelReadOnlyMount, summarizeKernelMount, kernelMountGrantsAuthority } from '../src/kernelReadOnlyMount';

// 24Z.15 — kernel read-only mount: real fs scan, no execution/deploy, MOUNTED_READONLY not ACTIVE_RUNTIME.

describe('24Z.15: kernel read-only mount', () => {
  it('scans REAL kernel files and mounts them read-only', () => {
    const m = buildKernelReadOnlyMount();
    expect(m.schema).toBe('kernel-readonly-mount-v0');
    const byId = Object.fromEntries(m.modules.map((x) => [x.id, x]));
    expect(byId['receipts'].present).toBe(true);
    expect(byId['receipts'].status).toBe('mounted_readonly');
    expect(byId['merkle_log'].present).toBe(true);
    expect(byId['pq_signer'].present).toBe(true);
    expect(m.summary.mounted).toBeGreaterThanOrEqual(10);
  });

  it('NEVER executes/imports kernel code or deploys Convex; grants no authority', () => {
    const m = buildKernelReadOnlyMount();
    expect(m.executableImport).toBe(false);
    expect(m.convexDeploy).toBe(false);
    expect(m.grantsAuthority).toBe(false);
    expect(kernelMountGrantsAuthority(m)).toBe(false);
  });

  it('does NOT overclaim: every present module is mounted_readonly (never active_runtime)', () => {
    for (const mod of buildKernelReadOnlyMount().modules) {
      expect(['mounted_readonly', 'missing']).toContain(mod.status);
    }
  });

  it('exact source paths are included (so Tori can answer "where is the receipt code?")', () => {
    const receipts = buildKernelReadOnlyMount().modules.find((x) => x.id === 'receipts')!;
    expect(receipts.path).toContain('node-template/convex/aukoraReceipts.ts');
  });

  it('a missing kernel dir marks every module missing (real scan, not a hardcoded list)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aukora-kern-'));
    try {
      const m = buildKernelReadOnlyMount({ repoRoot: tmp, externalBase: tmp });
      expect(m.summary.mounted).toBe(0);
      expect(m.modules.every((x) => x.status === 'missing')).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('summary is truthful (read-only, not executed)', () => {
    const s = summarizeKernelMount(buildKernelReadOnlyMount());
    expect(s).toContain('read-only, NOT executed');
    expect(s).toContain('MOUNTED_READONLY (not ACTIVE_RUNTIME)');
  });
});
