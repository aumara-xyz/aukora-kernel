// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Sandbox test runner — the FIRST real subprocess-execution capability in this codebase. Deliberately
 * kept OUT of nativeIdeDispatcher.ts (which stays subprocess-free, its own tested invariant untouched)
 * so this new, distinct capability class gets its own narrow surface, its own tests, and cannot be
 * confused with the advisory/read-only 10-tool contract.
 *
 * Hard rules:
 *   - only 3 NAMED commands may ever run (`typecheck` / `targeted_test` / `full_test_suite`) — there is
 *     no way to pass an arbitrary command string in; every invocation is a fixed argv array picked from
 *     a closed switch, never built from string concatenation or shell interpolation.
 *   - execFileSync only, `shell` never set to true, every argv element a literal or a validated token.
 *   - runs against a FRESH TEMP COPY of core/ (+ scripts/test.sh for full_test_suite), never the live
 *     repo — the proposed sandbox files are overlaid onto that copy before running.
 *   - node_modules is REUSED via a read-only symlink to the real core/node_modules (re-installing for
 *     every run would be impractical) — the test process may read but this repo's own test suite is
 *     the only thing ever run here, not arbitrary code from chat input.
 *   - bounded output (truncated + hashed), a hard timeout per command, and the temp copy is always
 *     removed (try/finally) even on timeout or a thrown error.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { isSafeRelPath, type SandboxPatchFile } from './sandboxApply';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CORE_ROOT = path.join(REPO_ROOT, 'core');
const MAX_OUTPUT_CHARS = 20_000;
const TIMEOUT_MS = { typecheck: 60_000, targeted_test: 60_000, full_test_suite: 180_000 } as const;

export const ALLOWED_TEST_COMMANDS = ['typecheck', 'targeted_test', 'full_test_suite'] as const;
export type AllowedTestCommand = typeof ALLOWED_TEST_COMMANDS[number];

export function isAllowedTestCommand(x: unknown): x is AllowedTestCommand {
  return typeof x === 'string' && (ALLOWED_TEST_COMMANDS as readonly string[]).includes(x);
}

export interface SandboxTestRunResult {
  schema: 'sandbox-test-run-v1';
  command: AllowedTestCommand;
  resolvedArgv: string;    // human-readable, e.g. "bun x tsc --noEmit" — for the receipt, never a raw shell string executed as-is
  ok: boolean;              // exitCode === 0 && !timedOut
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  outputHash: string;       // sha256 of the FULL (untruncated) combined stdout+stderr
  outputExcerpt: string;    // bounded
  truncated: boolean;
  advisoryOnly: true;
  grantsAuthority: false;
}

function refuse(command: AllowedTestCommand, reason: string): SandboxTestRunResult {
  return {
    schema: 'sandbox-test-run-v1', command, resolvedArgv: '(refused)', ok: false, exitCode: null,
    timedOut: false, durationMs: 0, outputHash: sha256(reason), outputExcerpt: reason, truncated: false,
    advisoryOnly: true, grantsAuthority: false,
  };
}

const TEST_FILE_NAME_RE = /^[A-Za-z0-9_]+\.test\.ts$/;

// core/tests/*.test.ts genuinely reaches outside core/ (../../authority, ../../memory, ../../receiver,
// etc.) — a copy of core/ alone is NOT self-contained. Copy the whole repo root instead, excluding only
// heavy/reinstallable directories (node_modules — reused via symlink instead; matched at any depth).
// `.git` IS copied (small — a real test shells out to `git status` and expects a real repo to exist).
// A handful of tests also assert the resolved root directory NAME ends in "aukora-symbiote" — the
// workspace is therefore a same-named SUBDIRECTORY of the mkdtemp'd random dir, not the random dir itself.
const EXCLUDE_DIR_NAMES = new Set(['node_modules', 'graphify-out']);

// Defensive: the live repo is NOT quiesced during a copy — a concurrent process (another editor
// session, a background git gc, etc.) can rename/delete a file between readdirSync and copyFileSync.
// A transient ENOENT on one file must never abort the rest of the tree — skip it and keep going. This
// matters most for .git/objects/** (loose objects git can repack/prune at any time) and is the
// difference between a reliable copy and a nondeterministically-truncated one under real-world load.
function copyTreeExcluding(src: string, dst: string) {
  fs.mkdirSync(dst, { recursive: true });
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(src, { withFileTypes: true }); } catch { return; } // src vanished mid-walk — skip this subtree
  for (const entry of entries) {
    if (EXCLUDE_DIR_NAMES.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    try {
      if (entry.isSymbolicLink()) continue; // never follow/copy pre-existing symlinks from the live tree
      if (entry.isDirectory()) copyTreeExcluding(s, d);
      else if (entry.isFile()) fs.copyFileSync(s, d);
    } catch { /* transient — file/dir vanished or changed type between readdir and copy; skip it */ }
  }
}

/** Build a fresh temp workspace: a copy of the WHOLE repo root (node_modules reused via symlink, since
 *  re-installing for every run would be impractical) with the proposed sandbox files overlaid on top.
 *  The Convex kernel is reachable through type-only imports in the voice/capture tests, so its deps are
 *  reused too; otherwise isolated `tsc` sees copied convex/*.ts files without `convex/node_modules`.
 *  Returns the workspace root; caller must remove it when done. */
function buildTestWorkspace(files: SandboxPatchFile[]): string {
  const tmpReal = fs.realpathSync(os.tmpdir());
  const mktemp = fs.mkdtempSync(path.join(tmpReal, 'aukora-test-run-'));
  const workspaceRoot = path.join(mktemp, 'aukora-symbiote');
  copyTreeExcluding(REPO_ROOT, workspaceRoot);

  for (const [realDir, dstDir] of [
    [path.join(REPO_ROOT, 'node_modules'), path.join(workspaceRoot, 'node_modules')],
    [path.join(CORE_ROOT, 'node_modules'), path.join(workspaceRoot, 'core', 'node_modules')],
    [path.join(REPO_ROOT, 'convex', 'node_modules'), path.join(workspaceRoot, 'convex', 'node_modules')],
  ] as const) {
    try { if (fs.existsSync(realDir)) fs.symlinkSync(realDir, dstDir, 'dir'); } catch { /* transient — best effort, not fatal */ }
  }

  for (const f of files) {
    if (!isSafeRelPath(f.relPath)) continue; // already validated upstream by propose_patch; defense in depth
    const abs = path.join(workspaceRoot, f.relPath);
    const rel = path.relative(workspaceRoot, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue; // escape attempt — silently skip, never write outside workspace
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.content, 'utf-8');
  }

  return workspaceRoot;
}

function runBounded(command: AllowedTestCommand, bin: string, argv: string[], cwd: string, resolvedArgv: string): SandboxTestRunResult {
  const start = Date.now();
  let stdout = '';
  let exitCode: number | null = 0;
  let timedOut = false;
  try {
    stdout = execFileSync(bin, argv, { cwd, timeout: TIMEOUT_MS[command], encoding: 'utf-8', shell: false, maxBuffer: 32 * 1024 * 1024 }).toString();
  } catch (e: any) {
    stdout = [e?.stdout, e?.stderr].filter(Boolean).join('\n') || String(e?.message ?? e);
    exitCode = typeof e?.status === 'number' ? e.status : null;
    timedOut = e?.signal === 'SIGTERM' && e?.status === null; // execFileSync sets status=null + signal on timeout kill
  }
  const durationMs = Date.now() - start;
  const truncated = stdout.length > MAX_OUTPUT_CHARS;
  return {
    schema: 'sandbox-test-run-v1', command, resolvedArgv,
    ok: exitCode === 0 && !timedOut,
    exitCode, timedOut, durationMs,
    outputHash: sha256(stdout),
    outputExcerpt: truncated ? stdout.slice(0, MAX_OUTPUT_CHARS) : stdout,
    truncated,
    advisoryOnly: true, grantsAuthority: false,
  };
}

export interface RunSandboxTestCommandInput {
  command: AllowedTestCommand;
  testFile?: string;             // required for 'targeted_test' — must be an existing core/tests/*.test.ts name
  files: SandboxPatchFile[];     // the proposal's files, overlaid onto the fresh workspace copy
}

/** Run ONE allow-listed test command against a fresh temp copy of core/ with the proposal overlaid.
 *  Never touches the live repo. Never accepts a caller-supplied command string — only the closed enum. */
export function runSandboxTestCommand(input: RunSandboxTestCommandInput): SandboxTestRunResult {
  if (!isAllowedTestCommand(input.command)) return refuse(input.command as AllowedTestCommand, `unknown command: ${String(input.command)}`);
  if (input.command === 'targeted_test') {
    if (!input.testFile || !TEST_FILE_NAME_RE.test(input.testFile)) {
      return refuse('targeted_test', 'testFile must be a bare *.test.ts filename (no path segments)');
    }
    if (!fs.existsSync(path.join(CORE_ROOT, 'tests', input.testFile))) {
      return refuse('targeted_test', `no such test file in core/tests: ${input.testFile}`);
    }
  }

  const workspaceRoot = buildTestWorkspace(input.files);
  try {
    if (input.command === 'typecheck') {
      return runBounded('typecheck', 'bun', ['x', 'tsc', '--noEmit', '-p', 'tsconfig.json'], path.join(workspaceRoot, 'core'), 'bun x tsc --noEmit -p tsconfig.json');
    }
    if (input.command === 'targeted_test') {
      const argv = ['./node_modules/vitest/vitest.mjs', 'run', `tests/${input.testFile}`];
      return runBounded('targeted_test', 'node', argv, path.join(workspaceRoot, 'core'), `node ${argv.join(' ')}`);
    }
    // full_test_suite
    return runBounded('full_test_suite', 'bash', [path.join(workspaceRoot, 'scripts', 'test.sh')], workspaceRoot, 'bash scripts/test.sh');
  } finally {
    // remove the OUTER mktemp wrapper (workspaceRoot's parent), not just the inner aukora-symbiote/
    // subdir — the wrapper itself is never reused for anything else and would otherwise leak forever.
    fs.rmSync(path.dirname(workspaceRoot), { recursive: true, force: true });
  }
}

/** This runner never grants authority — a real test run is evidence, not a mutation. */
export function sandboxTestRunGrantsAuthority(_r: SandboxTestRunResult): false { return false; }
