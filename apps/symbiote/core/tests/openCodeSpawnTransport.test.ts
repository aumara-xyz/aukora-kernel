import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { realOpenCodeTransport, assertTransportSpecSafe, buildScrubbedEnv } from '../src/openCodeSpawnTransport';
import type { OpenCodeSpawnSpec } from '../src/openCodeSandboxRunner';

const REPO = path.resolve(__dirname, '..', '..', '..');
const baseSpec = (over: Partial<OpenCodeSpawnSpec> = {}): OpenCodeSpawnSpec => ({
  cmd: 'bun', argv: ['x'], cwd: fs.realpathSync(os.tmpdir()), timeoutMs: 1000, shell: false,
  allowedEnvVars: ['PATH'], liveRepoHandle: false, promptBytes: 1, ...over,
});

describe('24Z.25: openCodeSpawnTransport is the SOLE, quarantined process-spawn', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'openCodeSpawnTransport.ts'), 'utf-8');

  it('uses ONLY execFileSync — never a shell, exec, execSync, or spawn', () => {
    expect(src).toContain('execFileSync');
    expect(src).not.toMatch(/\bexecSync\b|\bspawnSync\b|\bspawn\(|child_process['"]\)\s*;?\s*\n?.*\bexec\(/);
    expect(src).not.toMatch(/\bexec\(/);          // no shell-exec
    expect(src).not.toMatch(/shell:\s*true/);     // never a shell
    expect(src).toMatch(/shell:\s*false/);        // explicit no-shell
  });

  it('child_process is imported ONLY here (the rest of the OpenCode lane is spawn-free)', () => {
    for (const f of ['openCodeSandboxRunner.ts', 'openCodeModelWire.ts', 'openCodeOutputNormalizer.ts', 'sandboxEngineBridge.ts']) {
      const s = fs.readFileSync(path.resolve(__dirname, '..', 'src', f), 'utf-8');
      expect(s, f).not.toMatch(/child_process|execFileSync|execSync|spawn\(/);
    }
  });

  it('refuses a shell spec, a non-bun command, and a cwd outside the system temp dir (before any spawn)', () => {
    expect(() => realOpenCodeTransport(baseSpec({ shell: true as unknown as false }))).toThrow(/shell/i);
    expect(() => realOpenCodeTransport(baseSpec({ cmd: 'sh' as unknown as 'bun' }))).toThrow(/command/i);
    expect(() => realOpenCodeTransport(baseSpec({ cwd: REPO }))).toThrow(/temp dir/i);              // never the live repo
    expect(() => realOpenCodeTransport(baseSpec({ cwd: path.join(REPO, 'internal') }))).toThrow();
  });

  // Fusion (Opus/GLM) YELLOW: the env-scrub + cwd re-assert were only exercised via the test double. These pure
  // functions make the spawn-boundary safety unit-tested WITHOUT a real process (the only untested bit is the
  // literal execFileSync call against a live model, which needs a running local model — honest residual).
  it('assertTransportSpecSafe (pure) re-asserts the boundary independently of a spawn', () => {
    expect(() => assertTransportSpecSafe(baseSpec())).not.toThrow();
    expect(() => assertTransportSpecSafe(baseSpec({ shell: true as unknown as false }))).toThrow(/shell/i);
    expect(() => assertTransportSpecSafe(baseSpec({ cmd: 'node' as unknown as 'bun' }))).toThrow(/command/i);
    expect(() => assertTransportSpecSafe(baseSpec({ cwd: REPO }))).toThrow(/temp dir/i);
  });
  it('buildScrubbedEnv (pure) keeps ONLY allowed var names — secrets are dropped', () => {
    const fakeEnv = { PATH: '/usr/bin', SECRET_KEY: 'sk-leak-me', OPENROUTER_API_KEY: 'sk-also-leak', HOME: '/home/x' };
    const scrubbed = buildScrubbedEnv(baseSpec({ allowedEnvVars: ['PATH', 'HOME'] }), fakeEnv);
    expect(scrubbed).toEqual({ PATH: '/usr/bin', HOME: '/home/x' });
    expect(JSON.stringify(scrubbed)).not.toContain('sk-leak');     // no secret bleeds into the spawn env
    expect(scrubbed.SECRET_KEY).toBeUndefined();
    expect(scrubbed.OPENROUTER_API_KEY).toBeUndefined();
  });
});
