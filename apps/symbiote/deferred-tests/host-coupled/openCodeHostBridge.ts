// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * 24Z.44 — OpenCode HOST BRIDGE (dev-only, server-side). Invokes the REAL OpenCode CLI (from source via bun) in a
 * CONSTRAINED throwaway sandbox to produce a BOUNDED diff — never the live repo, never live-apply. Safety envelope:
 *   - FIXED executable (bun) + FIXED args (opencode run --pure --dir <sandbox> -m <fixed model> <templated message>);
 *     the only caller-supplied value is a RE-VALIDATED color — no raw shell string, no free-form prompt.
 *   - the sandbox is a fresh /tmp dir holding a COPY of ONE allowlisted target file; opencode is confined via --dir.
 *   - timeout + kill; the result is a `git diff` of the sandbox; we VERIFY only the allowlisted file changed.
 *   - liveRepoTouched is ALWAYS false (we copy to /tmp and diff; we never write back to the live repo).
 * OpenCode is a PROPOSER/host here — the Aukora Kernel still records the effect via a durable receipt (done by the
 * caller). If opencode is unavailable or the diff is empty/out-of-scope, an exact blocker is returned (never faked).
 */
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, copyFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, basename } from 'path';
import { createHash } from 'crypto';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// the ONLY files opencode may edit (by key). Resolved to absolute live paths; a COPY is sandboxed, never the original.
const REPO_ROOT = resolve(__dirname, '../../..');
export const ALLOWLISTED_TARGETS: Record<string, string> = {
  wombPortalAccentTheme: join(REPO_ROOT, 'internal/tauri-womb/src/generated/live-theme.css'),
};
// mirror of livePatchSpec NAMED_COLORS — the only values a request may carry.
const SAFE_COLORS = new Set(['green', 'blue', 'purple', 'red', 'teal', 'gold', 'amber', 'cyan', 'magenta', 'orange', 'pink', 'violet', 'indigo', 'lime', 'aqua', 'crimson', 'white']);
const isSafeColor = (v: unknown): v is string => typeof v === 'string' && (SAFE_COLORS.has(v.toLowerCase()) || /^#[0-9a-fA-F]{3,8}$/.test(v));

const OPENCODE_ENTRY = resolve(__dirname, '../../opencode-lab/opencode-dev/packages/opencode/src/index.ts');
const OPENCODE_CWD = resolve(OPENCODE_ENTRY, '../..');   // packages/opencode — bun resolves node_modules from here
// must be a model OpenCode resolves in its OpenRouter provider list (claude-opus-4.8 is NOT listed → ProviderModelNotFound).
const FIXED_MODEL = 'openrouter/anthropic/claude-opus-4.5';
const TIMEOUT_MS = 150_000;

export interface OpenCodeHostResult {
  ok: boolean;
  host: 'opencode';
  available: boolean;
  version?: string;
  model?: string;
  sandboxPath?: string;
  file?: string;
  diff?: string;
  filesChanged?: string[];
  onlyAllowlistedFileChanged?: boolean;
  liveRepoTouched: false;        // INVARIANT — the bridge only ever copies to /tmp and diffs.
  // 24Z.45 — exact bytes + hashes for a later AUMLOK-gated apply:
  targetKey?: string;
  value?: string;
  afterContent?: string;
  beforeContent?: string;
  beforeHash?: string;
  afterHash?: string;
  diffHash?: string;
  blocker?: 'opencode_unavailable' | 'bad_request' | 'empty_diff' | 'out_of_scope_changes' | 'host_error';
  detail?: string;
}

function bunBin(): string | null {
  try { return execFileSync('which', ['bun']).toString().trim() || null; } catch { return null; }
}

/** Run real OpenCode in a sandbox to produce ONE bounded diff for an allowlisted target. Caller mints the receipt. */
export function runOpenCodeSandboxDiff(targetKey: string, value: string): OpenCodeHostResult {
  if (!Object.prototype.hasOwnProperty.call(ALLOWLISTED_TARGETS, targetKey) || !isSafeColor(value)) {
    return { ok: false, host: 'opencode', available: true, liveRepoTouched: false, blocker: 'bad_request', detail: 'target not allowlisted or value not a safe color' };
  }
  const bun = bunBin();
  const livePath = ALLOWLISTED_TARGETS[targetKey];
  if (!bun || !existsSync(OPENCODE_ENTRY) || !existsSync(livePath)) {
    return { ok: false, host: 'opencode', available: false, liveRepoTouched: false, blocker: 'opencode_unavailable', detail: `bun=${!!bun} entry=${existsSync(OPENCODE_ENTRY)} target=${existsSync(livePath)}` };
  }
  const color = value.toLowerCase();
  const fileName = basename(livePath);
  const sandbox = mkdtempSync(join(tmpdir(), 'aukora-oc-'));
  try {
    // sandbox = a COPY of ONE allowlisted file + a git baseline (live repo is NEVER touched).
    copyFileSync(livePath, join(sandbox, fileName));
    const git = (args: string[]) => execFileSync('git', ['-C', sandbox, ...args], { stdio: 'pipe' }).toString();
    git(['init', '-q']); git(['add', '-A']); git(['-c', 'user.email=lab@aukora', '-c', 'user.name=lab', 'commit', '-qm', 'baseline']);
    // TEMPLATED message — only the validated color varies; opencode gets it as an argv message, never a shell string.
    const message = `In ${fileName} only, change the --womb-portal-accent CSS variable value to ${color}. Edit only ${fileName}. Do not create, delete, or modify any other file.`;
    const version = 'local';
    // FIXED exe + FIXED args; bun resolves from the opencode package (cwd), opencode operates on --dir <sandbox> ONLY;
    // key passed via env only (never logged/returned). RETRY up to 3x — opencode intermittently throws
    // ProviderModelNotFoundError on a flaky OpenRouter provider-list fetch; reset the sandbox to baseline each attempt.
    let lastErr = '';
    let diff = '';
    for (let attempt = 1; attempt <= 3 && !diff.trim(); attempt++) {
      try { git(['checkout', '--', '.']); } catch { /* baseline already clean */ }
      try {
        execFileSync(bun, ['--conditions=browser', OPENCODE_ENTRY, 'run', '--pure', '--dir', sandbox, '-m', FIXED_MODEL, message], {
          cwd: OPENCODE_CWD, timeout: TIMEOUT_MS, killSignal: 'SIGTERM', stdio: 'pipe',
          env: { ...process.env, OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? '' },
        });
      } catch (runErr) {
        const re = runErr as { stderr?: Buffer; stdout?: Buffer; message?: string };
        lastErr = ((re.stderr?.toString() || '') + (re.stdout?.toString() || '') || re.message || '').replace(/sk-[A-Za-z0-9_-]+/g, 'sk-<redacted>').slice(0, 300);
      }
      diff = git(['--no-pager', 'diff']);
    }
    if (!diff.trim()) return { ok: false, host: 'opencode', available: true, version, model: FIXED_MODEL, sandboxPath: sandbox, file: fileName, liveRepoTouched: false, blocker: lastErr ? 'host_error' : 'empty_diff', detail: lastErr || 'opencode produced no change after 3 attempts' };
    const status = git(['status', '--porcelain']).trim();
    // porcelain line = "XY <path>" (rename uses "-> new"); take the last whitespace token → robust path extraction.
    const filesChanged = status.split('\n').map((l) => l.trim().split(/\s+/).pop() ?? '').filter(Boolean);
    const onlyAllowlistedFileChanged = filesChanged.length > 0 && filesChanged.every((f) => f === fileName);
    if (!diff.trim()) return { ok: false, host: 'opencode', available: true, version, model: FIXED_MODEL, sandboxPath: sandbox, file: fileName, liveRepoTouched: false, blocker: 'empty_diff', detail: 'opencode produced no change' };
    if (!onlyAllowlistedFileChanged) return { ok: false, host: 'opencode', available: true, version, model: FIXED_MODEL, sandboxPath: sandbox, file: fileName, diff, filesChanged, onlyAllowlistedFileChanged, liveRepoTouched: false, blocker: 'out_of_scope_changes', detail: `touched: ${filesChanged.join(', ')}` };
    // 24Z.45 — carry the exact bytes + hashes so a later AUMLOK-gated apply can write EXACTLY the reviewed content
    // (and only if the live file still matches beforeHash). afterContent = the sandbox file after opencode's edit.
    const afterContent = readFileSync(join(sandbox, fileName), 'utf-8');
    const beforeContent = readFileSync(livePath, 'utf-8');
    return {
      ok: true, host: 'opencode', available: true, version, model: FIXED_MODEL, sandboxPath: sandbox, file: fileName,
      diff, filesChanged, onlyAllowlistedFileChanged: true, liveRepoTouched: false,
      targetKey, value: color, afterContent, beforeContent, beforeHash: sha256(beforeContent), afterHash: sha256(afterContent), diffHash: sha256(diff),
    };
  } catch (e) {
    const err = e as { message?: string; stderr?: Buffer; stdout?: Buffer };
    const stderr = err.stderr ? err.stderr.toString() : '';
    const stdout = err.stdout ? err.stdout.toString() : '';
    const detail = (stderr || stdout || err.message || String(e)).replace(/sk-[A-Za-z0-9_-]+/g, 'sk-<redacted>').slice(0, 400);
    return { ok: false, host: 'opencode', available: true, sandboxPath: sandbox, liveRepoTouched: false, blocker: 'host_error', detail };
  }
}

/** Discard a sandbox (revert/cleanup). */
export function discardSandbox(sandboxPath: string): boolean {
  try { if (sandboxPath.startsWith(tmpdir()) && sandboxPath.includes('aukora-oc-')) { rmSync(sandboxPath, { recursive: true, force: true }); return true; } } catch { /* noop */ }
  return false;
}

// re-export for the runner
export { writeFileSync, readFileSync };
