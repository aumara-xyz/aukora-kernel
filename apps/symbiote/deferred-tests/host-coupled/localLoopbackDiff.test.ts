import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { runLocalLoopbackSandboxDiff } from '../src/sandboxEngineBridge';
import { resolveModelConfig } from '../src/openCodeModelWire';
import { generateLabSandboxKey, signLabActivation } from '../src/mldsaSandboxSigner';
import { getTraces, clearTraces } from '../src/boundaryTraceTelemetry';
import type { SandboxActivationPermit } from '../src/openCodeSandboxDraftEngine';

const REPO = path.resolve(__dirname, '..', '..', '..');
const SEED = 'b'.repeat(64);
const F = String.fromCodePoint;

function labPermit(): SandboxActivationPermit {
  const key = generateLabSandboxKey(SEED);
  return { signedPermit: '', manifestHash: '', labActivation: signLabActivation({ key, nonce: 'n27' }) };
}

let server: http.Server | null = null;
function startModel(body: string): Promise<string> {
  return new Promise((resolve) => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: body } }] }));
    });
    server.listen(0, '127.0.0.1', () => { const a = server!.address(); resolve(`http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`); });
  });
}
afterEach(() => { if (server) { server.close(); server = null; } clearTraces(); });

const opts = (endpoint: string) => ({ permit: labPermit(), modelConfig: resolveModelConfig({ OPENCODE_MODEL_PROVIDER: 'local', OPENCODE_MODEL: 'q', OPENCODE_MODEL_ENDPOINT: endpoint }), enabled: true, now: '2026-06-22T12:00:00.000Z' });

describe('24Z.27: REAL local loopback model → sandbox diff (full route), live repo untouched', () => {
  it('a reachable loopback model produces a sentinel-cleaned candidate → temp apply → receipt → HRT trace', async () => {
    const url = await startModel(JSON.stringify({ objective: 'add a loopback note', files: [{ relPath: 'drafts/loop.md', content: '# from a real local model (sandbox)\n' }] }));
    clearTraces();
    const r = await runLocalLoopbackSandboxDiff(REPO, 'add a hello draft note', opts(url));
    expect(r.ran).toBe(true);                    // a REAL endpoint actually responded
    expect(r.reachable).toBe(true);
    expect(r.run?.outcome).toBe('applied_sandbox');
    expect(r.run?.engineSource).toBe('opencode');
    expect(r.run?.liveRepoUnchanged).toBe(true);
    expect(r.run?.receipt).toBeTruthy();
    expect(getTraces().some((t: any) => t.source === 'sandboxApply')).toBe(true);   // HRT recorded it
    expect(fs.existsSync(path.join(REPO, 'drafts', 'loop.md'))).toBe(false);         // live repo untouched
  });

  it('REFUSES a hidden-channel payload from the model (no apply, live repo untouched)', async () => {
    const url = await startModel(JSON.stringify({ objective: 'ok', files: [{ relPath: 'drafts/x.md', content: `evil${F(0x200b)}payload` }] }));
    const r = await runLocalLoopbackSandboxDiff(REPO, 'add a hello draft note', opts(url));
    expect(r.ran).toBe(false);                   // sentinel refused → no candidate
    expect(r.reason).toMatch(/refused/i);
  });

  it('stays PARKED honestly when the endpoint is unreachable (no fake "real model")', async () => {
    const r = await runLocalLoopbackSandboxDiff(REPO, 'add a hello draft note', { ...opts('http://127.0.0.1:1'), permit: labPermit() });
    expect(r.ran).toBe(false);
    expect(r.parked).toBe(true);
    expect(r.reason).toMatch(/not reachable/i);
  });

  it('stays PARKED when lab activation is missing (gate closed) — never calls the model', async () => {
    const url = await startModel(JSON.stringify({ objective: 'x', files: [{ relPath: 'drafts/x.md', content: 'y' }] }));
    const r = await runLocalLoopbackSandboxDiff(REPO, 'add a hello draft note', { modelConfig: resolveModelConfig({ OPENCODE_MODEL_PROVIDER: 'local', OPENCODE_MODEL: 'q', OPENCODE_MODEL_ENDPOINT: url }), enabled: true /* no permit */ });
    expect(r.ran).toBe(false);
    expect(r.parked).toBe(true);
    expect(r.reason).toMatch(/gate closed/i);
  });

  it('stays PARKED when no local provider is configured', async () => {
    const r = await runLocalLoopbackSandboxDiff(REPO, 'add a hello draft note', { permit: labPermit(), enabled: true });
    expect(r.parked).toBe(true);
    expect(r.reason).toMatch(/no local loopback model configured/i);
  });
});
