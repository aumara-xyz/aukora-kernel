import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';

const ROOT = join(__dirname, '..', '..');

function makeScannerRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aukora-scan-test-'));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  cpSync(join(ROOT, 'scripts', 'verify-public-readiness.sh'), join(dir, 'scripts', 'verify-public-readiness.sh'));
  cpSync(join(ROOT, 'scripts', 'scan-secrets.sh'), join(dir, 'scripts', 'scan-secrets.sh'));
  return dir;
}

function runScanner(cwd: string, env: Record<string, string> = {}) {
  return spawnSync('bash', ['scripts/verify-public-readiness.sh'], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

describe('public-readiness scanner outside Git (#77)', () => {
  it('fails closed in a non-Git tree instead of reporting an empty clean scan', () => {
    const dir = makeScannerRoot();
    writeFileSync(join(dir, 'README.md'), 'hello\n');
    const r = runScanner(dir);
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}\n${r.stderr}`).toContain('not a Git worktree');
  });

  it('keeps the normal Git worktree behavior', () => {
    const dir = makeScannerRoot();
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    writeFileSync(join(dir, 'README.md'), 'hello\n');
    const r = runScanner(dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('TIER 1 CLEAN');
  });

  it('the explicit find fallback catches a real key shape in an extracted package', () => {
    const dir = makeScannerRoot();
    writeFileSync(join(dir, 'leak.txt'), 'OPENROUTER_API_KEY=sk-or-v1-ABCDEFGHIJKLMNOPQRSTUVWX\n');
    const r = runScanner(dir, { AUKORA_PUBLIC_READINESS_ALLOW_FIND: '1' });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('real OpenRouter key');
  });

  it('scan-release-archive scans the final archive contents and fails on an injected secret fixture', () => {
    const dir = makeScannerRoot();
    writeFileSync(join(dir, 'leak.txt'), 'OPENROUTER_API_KEY=sk-or-v1-ABCDEFGHIJKLMNOPQRSTUVWX\n');
    const archive = join(tmpdir(), `aukora-release-scan-${Date.now()}.tar`);
    execFileSync('tar', ['-cf', archive, '-C', dir, '.']);
    const r = spawnSync('bash', [join(ROOT, 'scripts', 'scan-release-archive.sh'), archive], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('real OpenRouter key');
  });
});
