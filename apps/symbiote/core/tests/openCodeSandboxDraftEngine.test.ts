import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  runSandboxDraft, MockSandboxRunner, assertSandboxEnabled, openCodeSandboxStatus,
  OPENCODE_SANDBOX_ENABLED, type SandboxEngineRunner,
} from '../src/openCodeSandboxDraftEngine';

// 24Z.14.1 — the sandbox envelope: engines run ONLY in a throwaway temp dir; the live repo is never touched.

describe('24Z.14.1: OpenCode sandbox draft envelope', () => {
  it('runs the engine in a temp workspace and returns a draft-only result', () => {
    const r = runSandboxDraft({ prompt: 'add a teal button', runner: new MockSandboxRunner() });
    expect(r.applied).toBe(false);
    expect(r.mode).toBe('draft_only');
    expect(r.grantsAuthority).toBe(false);
    expect(r.liveRepoTouched).toBe(false);
    expect(r.tempWorkspaceUsed).toBe(true);
    expect(r.filesWrittenInTemp).toContain('draft.patch'); // captured the temp write
  });

  it('the temp workspace is ALWAYS deleted (cleanup), even across many runs', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aukora-sbx-base-'));
    try {
      for (let i = 0; i < 5; i++) runSandboxDraft({ prompt: `draft ${i}`, runner: new MockSandboxRunner(), tmpBase: base });
      const leftover = fs.readdirSync(base).filter((d) => d.startsWith('aukora-sandbox-'));
      expect(leftover).toEqual([]); // no temp dirs left behind
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it('LIVE REPO UNCHANGED: the engine only ever receives the temp cwd, never the repo', () => {
    // a paranoid runner that tries to write to its cwd's parent stays inside temp (cwd is the temp dir).
    let receivedCwd = '';
    const spyRunner: SandboxEngineRunner = {
      id: 'spy',
      run(cwd) { receivedCwd = cwd; fs.writeFileSync(path.join(cwd, 'x.txt'), 'in temp only'); return 'ok'; },
    };
    const repoFile = path.resolve(__dirname, '..', 'package.json');
    const before = fs.readFileSync(repoFile, 'utf-8');
    const r = runSandboxDraft({ prompt: 'p', runner: spyRunner });
    expect(receivedCwd).toContain('aukora-sandbox-'); // engine got the temp dir, not the repo
    expect(receivedCwd).not.toContain('internal/edge-node/src');
    expect(fs.readFileSync(repoFile, 'utf-8')).toBe(before); // repo file byte-identical
    expect(r.liveRepoTouched).toBe(false);
  });

  it('a throwing runner is contained (draft-only result, temp still cleaned)', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aukora-sbx-err-'));
    try {
      const bad: SandboxEngineRunner = { id: 'bad', run() { throw new Error('boom'); } };
      const r = runSandboxDraft({ prompt: 'p', runner: bad, tmpBase: base });
      expect(r.applied).toBe(false);
      expect(r.diffSummary.toLowerCase()).toContain('error');
      expect(fs.readdirSync(base).filter((d) => d.startsWith('aukora-sandbox-'))).toEqual([]);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it('the real OpenCode runner is GATED OFF behind a SIGNED permit (Fusion consensus rec)', async () => {
    const { sandboxActivationAllowed } = await import('../src/openCodeSandboxDraftEngine');
    expect(OPENCODE_SANDBOX_ENABLED).toBe(false);
    expect(() => assertSandboxEnabled()).toThrow(/activation denied/);
    // config-drift cannot enable it: even with the flag forced ON + a permit string, no signer verifies → denied
    expect(sandboxActivationAllowed(undefined, true)).toBe(false);
    expect(sandboxActivationAllowed({ signedPermit: 'fake-sig', manifestHash: 'abc' }, true)).toBe(false);
    expect(openCodeSandboxStatus().active).toBe(false);
    expect(openCodeSandboxStatus().reason).toContain('SIGNED activation permit');
  });

  it('module ships NO spawn/exec surface (envelope only; real runner is the gated next step)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'openCodeSandboxDraftEngine.ts'), 'utf-8');
    expect(src).not.toMatch(/child_process|execFile|execSync|spawn\s*\(|\bfetch\s*\(/);
  });
});
