import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runSandboxTestCommand, isAllowedTestCommand, ALLOWED_TEST_COMMANDS, sandboxTestRunGrantsAuthority } from '../src/sandboxTestRunner';

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'sandboxTestRunner.ts'), 'utf-8');

describe('sandboxTestRunner: closed command enum, no arbitrary execution', () => {
  it('ALLOWED_TEST_COMMANDS is exactly the 3 named commands', () => {
    expect([...ALLOWED_TEST_COMMANDS].sort()).toEqual(['full_test_suite', 'targeted_test', 'typecheck'].sort());
  });

  it('isAllowedTestCommand refuses anything outside the closed enum', () => {
    expect(isAllowedTestCommand('typecheck')).toBe(true);
    expect(isAllowedTestCommand('bash -c "rm -rf /"')).toBe(false);
    expect(isAllowedTestCommand('shell')).toBe(false);
    expect(isAllowedTestCommand(123)).toBe(false);
    expect(isAllowedTestCommand(undefined)).toBe(false);
  });

  it('runSandboxTestCommand refuses an unknown command without running anything', () => {
    const r = runSandboxTestCommand({ command: 'run_anything_i_want' as any, files: [] });
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBeNull();
  });

  it('never uses shell:true or string-interpolated commands anywhere in the module', () => {
    expect(SRC).not.toMatch(/shell:\s*true/);
    expect(SRC).not.toMatch(/\bexec\s*\(|\bexecSync\s*\(/); // only execFileSync is used, never exec/execSync
    expect(SRC).toMatch(/execFileSync/);
  });

  // Fable QA (Round 6): this runs a real tsc subprocess (same as its siblings elsewhere in this file)
  // but had no explicit timeout, meaning it fell back to vitest's 5s default — too tight for a real
  // subprocess run under load. Given the same 30s budget as the rest of this file.
  it('sandboxTestRunGrantsAuthority is always false', () => {
    const r = runSandboxTestCommand({ command: 'typecheck', files: [] });
    expect(sandboxTestRunGrantsAuthority(r)).toBe(false);
  }, 30_000);
});

describe('sandboxTestRunner: targeted_test input validation', () => {
  it('refuses a missing testFile', () => {
    const r = runSandboxTestCommand({ command: 'targeted_test', files: [] });
    expect(r.ok).toBe(false);
  });

  it('refuses a testFile with a path segment (traversal attempt)', () => {
    const r = runSandboxTestCommand({ command: 'targeted_test', testFile: '../../etc/passwd.test.ts', files: [] });
    expect(r.ok).toBe(false);
  });

  it('refuses a testFile that does not exist under core/tests', () => {
    const r = runSandboxTestCommand({ command: 'targeted_test', testFile: 'doesNotExistAtAll.test.ts', files: [] });
    expect(r.ok).toBe(false);
  });

  it('refuses a testFile without the exact .test.ts suffix', () => {
    const r = runSandboxTestCommand({ command: 'targeted_test', testFile: 'ideToolContract.ts', files: [] });
    expect(r.ok).toBe(false);
  });
}, 20_000);

describe('sandboxTestRunner: real, isolated execution (slower — real subprocess runs)', () => {
  it('typecheck runs the real tsc against a fresh isolated copy with the proposal overlaid, and passes for a harmless change', () => {
    const r = runSandboxTestCommand({
      command: 'typecheck',
      files: [{ relPath: 'docs/SANDBOX_TEST_RUNNER_FIXTURE_A.md', content: 'harmless doc content' }],
    });
    expect(r.schema).toBe('sandbox-test-run-v1');
    expect(r.ok).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.outputHash).toMatch(/^[0-9a-f]{64}$/);
    // the live repo must never see this fixture file
    expect(fs.existsSync(path.join(__dirname, '..', '..', 'docs', 'SANDBOX_TEST_RUNNER_FIXTURE_A.md'))).toBe(false);
  }, 30_000);

  it('typecheck FAILS when the overlaid proposal introduces a real type error', () => {
    const r = runSandboxTestCommand({
      command: 'typecheck',
      files: [{ relPath: 'core/src/sandboxTestRunnerFixtureBadType.ts', content: 'export const x: number = "not a number";\n' }],
    });
    expect(r.ok).toBe(false);
    expect(r.exitCode).not.toBe(0);
    expect(r.outputExcerpt).toMatch(/error TS/);
  }, 30_000);

  it('targeted_test runs a real, isolated vitest invocation of exactly one file', () => {
    const r = runSandboxTestCommand({
      command: 'targeted_test',
      testFile: 'ideToolContract.test.ts',
      files: [{ relPath: 'docs/SANDBOX_TEST_RUNNER_FIXTURE_B.md', content: 'harmless' }],
    });
    expect(r.ok).toBe(true);
    expect(r.resolvedArgv).toContain('tests/ideToolContract.test.ts');
    expect(r.resolvedArgv).not.toContain('..'); // no traversal ever reaches the resolved argv
  }, 30_000);

  it('output is bounded (truncated flag set + capped length) even for a command that produces long output', () => {
    // a deliberately-broken proposal produces a long tsc error dump; just assert the bound is respected if hit
    const r = runSandboxTestCommand({
      command: 'typecheck',
      files: [{ relPath: 'core/src/sandboxTestRunnerFixtureBadType.ts', content: 'export const x: number = "not a number";\n' }],
    });
    expect(r.outputExcerpt.length).toBeLessThanOrEqual(20_000);
    if (r.truncated) expect(r.outputExcerpt.length).toBe(20_000);
  }, 30_000);

  // Fable QA (Round 6): this used to count `aukora-test-run-*` dirs in the SHARED OS tmpdir before/after
  // — a real full-suite run failed once (before=1, after=0) because a DIFFERENT concurrent test file's
  // own workspace (also under the shared tmpdir) existed at the first snapshot and finished cleanup
  // before the second, an interleaving race, not a real leak. Fixed by giving this ONE test its own
  // PRIVATE tmpdir (via TMPDIR, which os.tmpdir() reads fresh on every call — confirmed, not cached) so
  // nothing else can ever perturb the count.
  it('the temp workspace is always removed after the run, win or lose', () => {
    const privateTmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-tmpdir-count-test-'));
    const prevTmpdir = process.env.TMPDIR;
    process.env.TMPDIR = privateTmp;
    try {
      runSandboxTestCommand({ command: 'typecheck', files: [{ relPath: 'docs/SANDBOX_TEST_RUNNER_FIXTURE_C.md', content: 'x' }] });
      const leftover = fs.readdirSync(privateTmp).filter((f: string) => f.startsWith('aukora-test-run-'));
      expect(leftover).toEqual([]);
    } finally {
      if (prevTmpdir === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = prevTmpdir;
      fs.rmSync(privateTmp, { recursive: true, force: true });
    }
  }, 30_000);
});
