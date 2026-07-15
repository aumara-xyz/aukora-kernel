import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { runOpenCodeSandboxDiff } from '../src/openCodeSandboxRunner';
import { OpenCodeSandboxEngine, runSandboxEngine } from '../src/sandboxEngineBridge';
import { resolveModelConfig } from '../src/openCodeModelWire';
import { generateLabSandboxKey, signLabActivation, verifyLabActivation } from '../src/mldsaSandboxSigner';
import { HiddenChannelError } from '../src/openCodeOutputNormalizer';
import { getTraces, clearTraces } from '../src/boundaryTraceTelemetry';
import type { OpenCodeSpawnSpec } from '../src/openCodeSandboxRunner';
import type { SandboxActivationPermit } from '../src/openCodeSandboxDraftEngine';

const REPO = path.resolve(__dirname, '..', '..', '..');
const SEED = 'a'.repeat(64);
const LOOPBACK = { OPENCODE_MODEL_PROVIDER: 'local', OPENCODE_MODEL: 'q', OPENCODE_MODEL_ENDPOINT: 'http://127.0.0.1:11434' };

function labPermit(): SandboxActivationPermit {
  const key = generateLabSandboxKey(SEED);
  return { signedPermit: '', manifestHash: '', labActivation: signLabActivation({ key, nonce: 'n1' }) };
}

// a deterministic test double standing in for a running local model (none is available in CI). It asserts the
// spec is SAFE (cwd under temp, no live-repo path in argv) and returns OpenCode-shaped JSON.
const goodTransport = (spec: OpenCodeSpawnSpec): string => {
  expect(spec.shell).toBe(false);
  expect(spec.cwd.includes(REPO)).toBe(false);          // never the live repo
  expect(spec.argv.some((a) => a.includes(REPO))).toBe(false);
  expect(spec.argv).toContain('--model-endpoint');       // loopback endpoint passed as inspectable flag
  return JSON.stringify({ objective: 'add an opencode note', files: [{ relPath: 'drafts/oc-note.md', content: '# from opencode (sandbox)\n' }] });
};

describe('24Z.25: lab activation token (real ML-DSA, lab key)', () => {
  it('verifies a freshly signed token; rejects a tampered one', () => {
    const key = generateLabSandboxKey(SEED);
    const tok = signLabActivation({ key, nonce: 'n1' });
    expect(verifyLabActivation(tok).valid).toBe(true);
    expect(verifyLabActivation({ ...tok, signatureHex: tok.signatureHex.replace(/.$/, '0') }).valid).toBe(false);
    expect(verifyLabActivation({ ...tok, payload: { ...tok.payload, scope: 'x' as any } }).valid).toBe(false);
    expect(verifyLabActivation(tok, { now: '2099-01-01T00:00:00Z' }).valid).toBe(false); // expired
  });
});

describe('24Z.25: OpenCode stays PARKED unless detected + signed activation + loopback model all hold', () => {
  it('parked by default (no activation, no model) → runOpenCodeSandboxDiff throws denied', () => {
    expect(() => runOpenCodeSandboxDiff(REPO, 'add a hello draft note')).toThrow(/denied/i);
  });
  it('denied WITHOUT a signed activation (loopback model alone is not enough)', () => {
    const cfg = resolveModelConfig(LOOPBACK);
    expect(() => runOpenCodeSandboxDiff(REPO, 'add a hello draft note', { modelConfig: cfg, enabled: true, transport: goodTransport })).toThrow(/denied/i);
  });
  it('denied with a NON-loopback endpoint (model not configured)', () => {
    const cfg = resolveModelConfig({ ...LOOPBACK, OPENCODE_MODEL_ENDPOINT: 'https://evil.example.com' });
    expect(() => runOpenCodeSandboxDiff(REPO, 'add a hello draft note', { permit: labPermit(), modelConfig: cfg, enabled: true, transport: goodTransport })).toThrow(/denied/i);
  });
});

describe('24Z.25: FIRST OpenCode sandbox diff — full loop (lab activation + loopback + test double)', () => {
  it('produces a sanitized patch candidate from the (test-double) local model', () => {
    const candidate = runOpenCodeSandboxDiff(REPO, 'add a hello draft note', { permit: labPermit(), modelConfig: resolveModelConfig(LOOPBACK), enabled: true, transport: goodTransport });
    expect(candidate.sanitized).toBe(true);
    expect(candidate.engineSource).toBe('opencode');
    expect(candidate.files).toEqual([{ relPath: 'drafts/oc-note.md', content: '# from opencode (sandbox)\n' }]);
  });

  it('routes OpenCode → classifier → lab signer → temp apply → receipt → HRT trace; live repo unchanged', () => {
    clearTraces();
    const engine = new OpenCodeSandboxEngine({ repoRoot: REPO, permit: labPermit(), modelConfig: resolveModelConfig(LOOPBACK), enabled: true, transport: goodTransport });
    const r = runSandboxEngine({ prompt: 'add a hello draft note', engine, now: '2026-06-22T12:00:00.000Z' });
    expect(r.outcome).toBe('applied_sandbox');
    expect(r.engineSource).toBe('opencode');
    expect(r.appliedLive).toBe(false);
    expect(r.liveRepoUnchanged).toBe(true);
    expect(r.receipt).toBeTruthy();
    // HRT recorded the sandbox-apply events (telemetry-only) for the OpenCode-sourced apply
    expect(getTraces().some((t: any) => t.source === 'sandboxApply')).toBe(true);
    // live repo is untouched — the candidate file never lands in the real repo
    expect(fs.existsSync(path.join(REPO, 'drafts', 'oc-note.md'))).toBe(false);
  });

  it('REFUSES a hidden-channel payload in the model output end-to-end (human-opacity refusal)', () => {
    const evilTransport = () => JSON.stringify({ objective: 'ok', files: [{ relPath: 'drafts/x.md', content: `evil${String.fromCodePoint(0x200b)}payload` }] });
    expect(() => runOpenCodeSandboxDiff(REPO, 'add a hello draft note', { permit: labPermit(), modelConfig: resolveModelConfig(LOOPBACK), enabled: true, transport: evilTransport })).toThrow(HiddenChannelError);
    // and through the bridge it refuses cleanly (no apply, live repo untouched)
    const engine = new OpenCodeSandboxEngine({ repoRoot: REPO, permit: labPermit(), modelConfig: resolveModelConfig(LOOPBACK), enabled: true, transport: evilTransport });
    const r = runSandboxEngine({ prompt: 'add a hello draft note', engine, now: '2026-06-22T12:00:00.000Z' });
    expect(r.outcome).toBe('refused');
    expect(r.liveRepoUnchanged).toBe(true);
  });
});
