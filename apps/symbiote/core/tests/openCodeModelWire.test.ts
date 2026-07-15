import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { resolveModelConfig, modelConfigured, summarizeModelWire } from '../src/openCodeModelWire';
import { resolveOpenCodeEngine, buildOpenCodeSpawnSpec, runOpenCodeSandboxDiff, assertOpenCodeSpawnAllowed, prepareOpenCodeSpawn } from '../src/openCodeSandboxRunner';

const REPO = path.resolve(__dirname, '..', '..', '..');

describe('24Z.24: OpenCode model-wire config (no secrets, parked by default)', () => {
  it('default provider is none → not configured', () => {
    const cfg = resolveModelConfig({});
    expect(cfg.provider).toBe('none');
    expect(modelConfigured(cfg)).toBe(false);
  });
  it('openrouter needs a present key env var (NAME only; VALUE never stored)', () => {
    const noKey = resolveModelConfig({ OPENCODE_MODEL_PROVIDER: 'openrouter', OPENCODE_MODEL: 'x' });
    expect(modelConfigured(noKey)).toBe(false);
    const withKey = resolveModelConfig({ OPENCODE_MODEL_PROVIDER: 'openrouter', OPENCODE_MODEL: 'x', OPENROUTER_API_KEY: 'sk-secret-value-123456' });
    expect(modelConfigured(withKey)).toBe(true);
    expect(withKey.keyPresent).toBe(true);
    // the secret VALUE never appears in the config object or the summary
    expect(JSON.stringify(withKey)).not.toContain('sk-secret-value');
    expect(JSON.stringify(summarizeModelWire(withKey))).not.toContain('sk-secret-value');
  });
  it('local provider requires a LOOPBACK endpoint (no remote prod wire)', () => {
    expect(modelConfigured(resolveModelConfig({ OPENCODE_MODEL_PROVIDER: 'local', OPENCODE_MODEL: 'q', OPENCODE_MODEL_ENDPOINT: 'http://127.0.0.1:11434' }))).toBe(true);
    expect(modelConfigured(resolveModelConfig({ OPENCODE_MODEL_PROVIDER: 'local', OPENCODE_MODEL: 'q', OPENCODE_MODEL_ENDPOINT: 'https://evil.example.com' }))).toBe(false);
  });
  it('source never hardcodes a key or reads loose key files', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'openCodeModelWire.ts'), 'utf-8');
    expect(src).not.toMatch(/sk-[A-Za-z0-9]{12,}|readFileSync|readFile\(|\.pem|id_rsa/);
  });
});

describe('24Z.24: OpenCode engine stays PARKED (canSpawn needs detection AND signer gate AND model)', () => {
  it('canSpawn=false by default (no model, no signer); status parked_partial', () => {
    const e = resolveOpenCodeEngine(REPO);
    expect(e.canSpawn).toBe(false);
    expect(e.modelConfigured).toBe(false);
    expect(['unavailable', 'parked_partial']).toContain(e.status);
  });
  it('canSpawn stays false even WITH a configured model (signer gate still closed)', () => {
    const cfg = resolveModelConfig({ OPENCODE_MODEL_PROVIDER: 'local', OPENCODE_MODEL: 'q', OPENCODE_MODEL_ENDPOINT: 'http://127.0.0.1:11434' });
    const e = resolveOpenCodeEngine(REPO, { modelConfig: cfg });
    expect(e.modelConfigured).toBe(true);   // model configured...
    expect(e.canSpawn).toBe(false);          // ...but the signed gate is still closed → still parked
  });
  it('assertOpenCodeSpawnAllowed + runOpenCodeSandboxDiff throw (parked; gate closed by default)', () => {
    expect(() => assertOpenCodeSpawnAllowed(REPO)).toThrow(/denied/i);
    // parked by default (no activation, no model) → the fused chokepoint refuses before any transport runs
    expect(() => runOpenCodeSandboxDiff(REPO, 'hi')).toThrow(/denied/i);
  });
  // Fusion GLM/Gemini/Kimi hardening: the fused gate+spec chokepoint refuses to produce an executable spec while
  // the gate is closed — even WITH a configured model (the spec can never be wired to a process before activation).
  it('prepareOpenCodeSpawn (fused gate+spec) throws at the gate even with a configured model', () => {
    const cfg = resolveModelConfig({ OPENCODE_MODEL_PROVIDER: 'local', OPENCODE_MODEL: 'q', OPENCODE_MODEL_ENDPOINT: 'http://127.0.0.1:11434' });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-prep-'));
    try {
      expect(() => prepareOpenCodeSpawn(REPO, tmp, 'do a small change', { modelConfig: cfg })).toThrow(/denied/i);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });
});

describe('24Z.24: spawn SPEC is safe-by-construction (no shell, cwd under temp, no live path, no secret values)', () => {
  const cfg = resolveModelConfig({ OPENCODE_MODEL_PROVIDER: 'openrouter', OPENCODE_MODEL: 'x', OPENROUTER_API_KEY: 'sk-secret-value-123456' });
  it('builds a bounded no-shell spec with cwd under the system temp dir', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-spec-'));
    try {
      const spec = buildOpenCodeSpawnSpec(tmp, 'do a small change', cfg);
      expect(spec.cmd).toBe('bun');
      expect(spec.shell).toBe(false);
      expect(spec.liveRepoHandle).toBe(false);
      expect(Array.isArray(spec.argv)).toBe(true);
      expect(spec.argv).not.toContain(REPO);                 // never the live repo path
      // env lists NAMES only — never the secret VALUE
      expect(spec.allowedEnvVars).toContain('OPENROUTER_API_KEY');
      expect(JSON.stringify(spec)).not.toContain('sk-secret-value');
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });
  it('REFUSES a live-repo cwd (only the system temp dir is allowed)', () => {
    expect(() => buildOpenCodeSpawnSpec(REPO, 'x', cfg)).toThrow(/temp dir/i);
    expect(() => buildOpenCodeSpawnSpec(path.join(REPO, 'internal'), 'x', cfg)).toThrow();
  });
  it('REFUSES an oversized prompt (bounded input)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-spec2-'));
    try { expect(() => buildOpenCodeSpawnSpec(tmp, 'x'.repeat(9000), cfg)).toThrow(/bounded/i); }
    finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });
  it('the runner/model-wire ship NO process-spawn surface while parked', () => {
    for (const f of ['openCodeSandboxRunner.ts', 'openCodeModelWire.ts']) {
      const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', f), 'utf-8');
      expect(src, f).not.toMatch(/child_process|execSync|execFileSync|spawnSync|spawn\(|shell:\s*true/);
    }
  });
});
