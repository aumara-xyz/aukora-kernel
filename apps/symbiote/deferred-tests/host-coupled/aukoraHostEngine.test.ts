import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { join } from 'path';
import { classifyRisk, applyHostRun, undoHostApply, HOST_REPO_ROOT, type HostChangedFile, type HostRunResult } from '../src/aukoraHostEngine';

/**
 * 24Z.52 — Aukora Host engine safety suite. The governance boundary: HIGH-risk paths/deletes/broad-rewrites pause;
 * apply refuses high-risk + path-escape; apply/undo is a clean round-trip. (runHostEdit itself needs OpenCode — that
 * is an integration path, exercised in the live demo, not here.)
 */

const cf = (path: string, status: HostChangedFile['status'] = 'modified', afterContent = 'x'): HostChangedFile => ({ path, status, afterContent });

describe('risk classification — sensitive paths / deletes / broad rewrites are HIGH', () => {
  it('a normal app-source edit is LOW risk', () => {
    expect(classifyRisk([cf('internal/tauri-womb/src/components/Hello.tsx')], '+a\n-b').risk).toBe('low');
  });
  it.each([
    ['internal/edge-node/.env', 'env'],
    ['some/auth.json', 'auth'],
    ['internal/secrets/key.txt', 'secrets'],
    ['x/admin-key.txt', 'admin key'],
    ['internal/edge-node/src/aumlokCeremony.ts', 'aumlok'],
    ['node-template/convex/aukoraDevReceipt.ts', 'kernel'],
    ['.github/workflows/ci.yml', 'workflow'],
    ['internal/tauri-womb/vite.config.ts', 'apply-gate config'],
    ['internal/edge-node/src/aukoraHostEngine.ts', 'host governance'],
    ['internal/edge-node/.env.local', 'env variant'],
    ['x/server.key', 'key material'],
  ])('HIGH risk: %s (%s)', (path) => {
    expect(classifyRisk([cf(path)], '+a').risk).toBe('high');
  });
  it('a deletion is HIGH risk', () => {
    expect(classifyRisk([cf('internal/tauri-womb/src/x.tsx', 'deleted')], '-a').risk).toBe('high');
  });
  it('a broad rewrite (many files) is HIGH risk', () => {
    const many = Array.from({ length: 9 }, (_, i) => cf(`internal/tauri-womb/src/f${i}.tsx`));
    expect(classifyRisk(many, '+a').risk).toBe('high');
  });
  it('a broad rewrite (many lines) is HIGH risk', () => {
    const bigDiff = Array.from({ length: 450 }, () => '+line').join('\n');
    expect(classifyRisk([cf('internal/tauri-womb/src/f.tsx')], bigDiff).risk).toBe('high');
  });

  // Fusion 24Z.52: the path denylist FAILS OPEN — a secret in a NORMAL-named tracked file. Content scan catches it.
  it.each([
    ['+const x = "sk-abcdefghij1234567890XYZ";', 'sk- key'],
    ['+const k = "AKIAIOSFODNN7EXAMPLE";', 'AWS key'],
    ['+const t = "ghp_abcdefghijklmnopqrstuvwxyz0123";', 'github token'],
    ['+const apiKey = "abcdef0123456789abcdef01";', 'credential assignment'],
    ['+-----BEGIN RSA PRIVATE KEY-----', 'private key block'],
  ])('HIGH risk: a secret in the diff content of a normal file (%s)', (line) => {
    expect(classifyRisk([cf('internal/tauri-womb/src/components/Normal.tsx')], line).risk).toBe('high');
  });
  it('PRECISION: a benign long hex/string in a normal file stays LOW (no false-positive pause)', () => {
    expect(classifyRisk([cf('internal/tauri-womb/src/x.tsx')], '+const hash = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";').risk).toBe('low');
    expect(classifyRisk([cf('internal/tauri-womb/src/x.tsx')], '+const title = "Hello from the Aukora Host welcome card";').risk).toBe('low');
  });
});

describe('lifecycle hardening present (worktree cleanup) — Fusion 24Z.52 GLM', () => {
  it('runHostEdit removes the worktree + prunes in a finally block', () => {
    const src = fs.readFileSync(join(__dirname, '../src/aukoraHostEngine.ts'), 'utf-8');
    expect(src).toMatch(/finally\s*\{[\s\S]*worktree', 'remove', '--force'/);
    expect(src).toMatch(/worktree', 'prune'/);
  });
});

describe('apply / undo — refuses high-risk + path-escape; clean round-trip on a safe in-repo path', () => {
  it('refuses to apply a HIGH-risk run', () => {
    const run = { ok: true, runId: 'r1', engine: 'opencode', promptHash: 'h', risk: 'high', changedFiles: [cf('internal/edge-node/.env')] } as HostRunResult;
    expect(applyHostRun(run).applied).toBe(false);
    expect(applyHostRun(run).reason).toBe('high_risk_paused');
  });
  it('refuses a path that escapes the repo root (no write outside)', () => {
    const evil = '../../../../tmp/aukora-host-escape-test.txt';
    const run = { ok: true, runId: 'r2', engine: 'opencode', promptHash: 'h', risk: 'low', changedFiles: [cf(evil, 'added', 'pwned')] } as HostRunResult;
    const ap = applyHostRun(run);
    expect(ap.applied).toBe(false);
    expect(ap.reason).toMatch(/path_escape/);
    expect(fs.existsSync('/tmp/aukora-host-escape-test.txt')).toBe(false);
  });
  it('applies a LOW-risk added file inside the repo, then undo restores (removes) it', () => {
    const rel = 'internal/edge-node/.host-engine-test-tmp.txt';
    const abs = join(HOST_REPO_ROOT, rel);
    if (fs.existsSync(abs)) fs.rmSync(abs);
    const run = { ok: true, runId: 'r3', engine: 'opencode', promptHash: 'h', risk: 'low', changedFiles: [cf(rel, 'added', 'hello-host')] } as HostRunResult;
    const ap = applyHostRun(run);
    try {
      expect(ap.applied).toBe(true);
      expect(fs.readFileSync(abs, 'utf-8')).toBe('hello-host');   // really written
      expect(ap.checkpoint!.files[0].prevContent).toBe(null);     // it did not exist before
      const u = undoHostApply(ap.checkpoint!);
      expect(u.undone).toBe(true);
      expect(fs.existsSync(abs)).toBe(false);                     // undo removed the new file
    } finally { if (fs.existsSync(abs)) fs.rmSync(abs); }
  });
  it('undo restores prior bytes of a modified file', () => {
    const rel = 'internal/edge-node/.host-engine-test-mod.txt';
    const abs = join(HOST_REPO_ROOT, rel);
    fs.writeFileSync(abs, 'ORIGINAL');
    const run = { ok: true, runId: 'r4', engine: 'opencode', promptHash: 'h', risk: 'low', changedFiles: [cf(rel, 'modified', 'CHANGED')] } as HostRunResult;
    const ap = applyHostRun(run);
    try {
      expect(fs.readFileSync(abs, 'utf-8')).toBe('CHANGED');
      undoHostApply(ap.checkpoint!);
      expect(fs.readFileSync(abs, 'utf-8')).toBe('ORIGINAL');     // prior bytes restored
    } finally { if (fs.existsSync(abs)) fs.rmSync(abs); }
  });
});
