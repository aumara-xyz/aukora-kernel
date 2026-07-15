// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * 24Z.52 — Aukora Host Engine (dev-only, server-side). Aukora is the GOVERNING layer; OpenCode is the coding ENGINE.
 *
 * Flow: a free-form coding request runs the REAL OpenCode CLI (from source via bun) inside a throwaway GIT WORKTREE of
 * this repo (real isolation; OpenCode may edit any project file there). We capture the `git diff` + the after-bytes of
 * each changed file, classify RISK from the changed paths, and return a structured run. Nothing is written to the live
 * repo here — APPLY (low-risk, only inside an AUMLOK-unlocked session) and UNDO are separate, explicit server steps.
 *
 * Safety envelope:
 *   - FIXED bun executable + FIXED opencode entry + FIXED model; the prompt is passed as a single argv arg (never a
 *     shell string), so there is no shell injection. (A coding agent is SUPPOSED to take free prompts; the boundary is
 *     the worktree + the apply gate, not prompt restriction.)
 *   - the worktree is a detached `git worktree` under /tmp; the live repo is never edited by OpenCode.
 *   - risk is HIGH (→ pause, never auto-apply) for: secrets/.env/keys/auth/admin, .aukora, AUMLOK/kernel-authority/
 *     signer code, .github/workflows, lockfiles/package.json, PATENTS, .git internals, ANY deletion, or a broad rewrite.
 *   - keys are passed via env only and scrubbed from any returned detail; never logged or returned.
 */
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname, sep } from 'path';
import { createHash, randomUUID } from 'crypto';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const scrub = (s: string) => s.replace(/sk-[A-Za-z0-9_-]+/g, 'sk-<redacted>').replace(/(key|token|secret|authorization)[=:]\s*\S+/gi, '$1=<redacted>');

export const HOST_REPO_ROOT = resolve(__dirname, '../../..');                 // aukora-os
const OPENCODE_ENTRY = resolve(__dirname, '../../opencode-lab/opencode-dev/packages/opencode/src/index.ts');
const OPENCODE_CWD = resolve(OPENCODE_ENTRY, '../..');
const FIXED_MODEL = 'openrouter/anthropic/claude-opus-4.5';
const TIMEOUT_MS = 240_000;
const BROAD_FILE_COUNT = 8;        // > this many files → broad rewrite → HIGH risk
const BROAD_LINE_COUNT = 400;      // > this many changed lines → broad rewrite → HIGH risk

// HIGH-risk path patterns — any match pauses (never auto-applies), even inside an unlocked session.
const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
  [/(^|\/)\.env(\.|$)/, 'env file'],
  [/(^|\/)secrets?(\/|\.|$)/i, 'secrets'],
  [/\.(key|pem|p12|keystore)$/i, 'key material'],
  [/auth\.json$/i, 'auth file'],
  [/admin[-_]?key/i, 'admin key'],
  [/(^|\/)\.aukora\//, 'aukora identity dir'],
  [/aumlok/i, 'AUMLOK authority code'],
  [/manifestSigner|kernelSigner|\bsigner\b/i, 'signer/authority code'],
  [/structuredTruth/i, 'structured-truth authority'],
  [/(^|\/)node-template\/convex\//, 'kernel/convex authority code'],
  [/(^|\/)\.github\/workflows\//, 'CI workflow'],
  [/(^|\/)PATENTS?/i, 'patent file'],
  [/package\.json$|package-lock|bun\.lock|yarn\.lock|pnpm-lock/i, 'dependency/manifest'],
  [/(^|\/)\.git\//, 'git internals'],
  [/id_rsa|credentials/i, 'credentials'],
  [/aukoraHostEngine/i, 'host governance engine'],   // the agent editing its OWN apply-gate/risk code is high-risk
  [/vite\.config/i, 'dev-server / apply-gate config'],   // (the UI component AukoraHost.tsx is NOT the boundary — low-risk)
];

export type HostRisk = 'low' | 'high';
export interface HostChangedFile { path: string; status: 'modified' | 'added' | 'deleted'; afterContent?: string }
export interface HostRunResult {
  ok: boolean;
  runId: string;
  engine: 'opencode';
  model?: string;
  promptHash: string;
  changedFiles?: HostChangedFile[];
  diff?: string;
  diffHash?: string;
  risk?: HostRisk;
  riskReasons?: string[];
  blocker?: 'opencode_unavailable' | 'empty_diff' | 'host_error' | 'bad_request';
  detail?: string;
}

function bunBin(): string | null {
  try { return execFileSync('which', ['bun']).toString().trim() || null; } catch { return null; }
}

export function hostEngineAvailable(): { available: boolean; model: string; detail: string } {
  const bun = bunBin();
  const ok = !!bun && existsSync(OPENCODE_ENTRY);
  return { available: ok, model: FIXED_MODEL, detail: `bun=${!!bun} opencodeEntry=${existsSync(OPENCODE_ENTRY)}` };
}

// HIGH-risk CONTENT patterns — a denylist on paths "fails open" (Fusion 24Z.52: a secret hardcoded in a normal-named
// tracked file would classify LOW). So we ALSO scan the ADDED diff lines for apparent secret material → HIGH, path
// notwithstanding. High-precision patterns only (avoid pausing legit long tokens/hashes).
const SECRET_CONTENT_PATTERNS: Array<[RegExp, string]> = [
  [/sk-[A-Za-z0-9_-]{16,}/, 'apparent API key (sk-)'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key block'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/, 'GitHub token'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/\b(api[_-]?key|secret|token|password|passwd|client[_-]?secret|access[_-]?key)\b\s*[:=]\s*['"][A-Za-z0-9_\-./+]{16,}['"]/i, 'hardcoded credential'],
];

/** Classify risk from the changed paths + ADDED diff content + diff size. HIGH → must pause (never auto-apply). */
export function classifyRisk(files: HostChangedFile[], diff: string): { risk: HostRisk; reasons: string[] } {
  const reasons: string[] = [];
  for (const f of files) {
    for (const [re, label] of SENSITIVE_PATTERNS) if (re.test(f.path)) { reasons.push(`${f.path}: ${label}`); break; }
    if (f.status === 'deleted') reasons.push(`${f.path}: deletion`);
  }
  // content scan — only the ADDED lines (a credential introduced by this edit), never path-trusting.
  const added = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n');
  for (const [re, label] of SECRET_CONTENT_PATTERNS) if (re.test(added)) { reasons.push(`secret in diff content: ${label}`); break; }
  if (files.length > BROAD_FILE_COUNT) reasons.push(`broad rewrite: ${files.length} files`);
  const addedRemoved = (diff.match(/^[+-]/gm) || []).length;
  if (addedRemoved > BROAD_LINE_COUNT) reasons.push(`broad rewrite: ~${addedRemoved} changed lines`);
  return { risk: reasons.length ? 'high' : 'low', reasons };
}

/**
 * Run a free-form coding request through OpenCode in a throwaway git worktree. Returns the captured diff + after-bytes
 * + risk. Does NOT write the live repo. Pure capture — the caller (server) gates apply/undo.
 */
export function runHostEdit(prompt: string): HostRunResult {
  const runId = randomUUID();
  const promptHash = sha256(prompt);
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000) {
    return { ok: false, runId, engine: 'opencode', promptHash, blocker: 'bad_request', detail: 'empty or oversized prompt' };
  }
  const avail = hostEngineAvailable();
  const bun = bunBin();
  if (!avail.available || !bun) {
    return { ok: false, runId, engine: 'opencode', promptHash, blocker: 'opencode_unavailable', detail: avail.detail };
  }
  const base = mkdtempSync(join(tmpdir(), 'aukora-host-'));
  const wt = join(base, 'wt');
  const gitRepo = (args: string[]) => execFileSync('git', ['-C', HOST_REPO_ROOT, ...args], { stdio: 'pipe' }).toString();
  const gitWt = (args: string[]) => execFileSync('git', ['-C', wt, ...args], { stdio: 'pipe' }).toString();
  try {
    gitRepo(['worktree', 'add', '--detach', '--quiet', wt, 'HEAD']);   // real isolated checkout at HEAD
    let lastErr = '';
    let diff = '';
    for (let attempt = 1; attempt <= 3 && !diff.trim(); attempt++) {
      try { gitWt(['checkout', '--', '.']); gitWt(['clean', '-fdq']); } catch { /* clean baseline */ }
      try {
        execFileSync(bun, ['--conditions=browser', OPENCODE_ENTRY, 'run', '--pure', '--dir', wt, '-m', FIXED_MODEL, prompt], {
          cwd: OPENCODE_CWD, timeout: TIMEOUT_MS, killSignal: 'SIGTERM', stdio: 'pipe',
          env: { ...process.env, OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? '' },
        });
      } catch (runErr) {
        const re = runErr as { stderr?: Buffer; stdout?: Buffer; message?: string };
        lastErr = scrub((re.stderr?.toString() || '') + (re.stdout?.toString() || '') || re.message || '').slice(0, 300);
      }
      gitWt(['add', '-A']);
      diff = gitWt(['--no-pager', 'diff', '--cached']);
    }
    if (!diff.trim()) {
      return { ok: false, runId, engine: 'opencode', model: FIXED_MODEL, promptHash, blocker: lastErr ? 'host_error' : 'empty_diff', detail: lastErr || 'OpenCode produced no change after 3 attempts' };
    }
    // changed files from the staged status (XY path); capture after-bytes for non-deletions.
    const status = gitWt(['status', '--porcelain']).trim();
    const changedFiles: HostChangedFile[] = status.split('\n').map((l) => {
      const code = l.slice(0, 2).trim();
      const path = l.slice(2).trim().split(' -> ').pop()!.trim();
      const st: HostChangedFile['status'] = code.includes('D') ? 'deleted' : code.includes('A') || code === '??' ? 'added' : 'modified';
      const full = join(wt, path);
      const afterContent = st === 'deleted' ? undefined : (existsSync(full) ? readFileSync(full, 'utf-8') : undefined);
      return { path, status: st, afterContent };
    }).filter((f) => f.path);
    const { risk, reasons } = classifyRisk(changedFiles, diff);
    return { ok: true, runId, engine: 'opencode', model: FIXED_MODEL, promptHash, changedFiles, diff, diffHash: sha256(diff), risk, riskReasons: reasons };
  } catch (e) {
    const err = e as { message?: string; stderr?: Buffer; stdout?: Buffer };
    const detail = scrub((err.stderr?.toString() || '') + (err.stdout?.toString() || '') || err.message || String(e)).slice(0, 400);
    return { ok: false, runId, engine: 'opencode', model: FIXED_MODEL, promptHash, blocker: 'host_error', detail };
  } finally {
    try { gitRepo(['worktree', 'remove', '--force', wt]); } catch { /* best effort */ }
    try { if (base.startsWith(tmpdir()) && base.includes('aukora-host-')) rmSync(base, { recursive: true, force: true }); } catch { /* noop */ }
    try { gitRepo(['worktree', 'prune']); } catch { /* noop */ }
  }
}

// ---- apply / undo (the governed boundary into the LIVE repo) -----------------------------------------------------
export interface HostCheckpoint { runId: string; checkpointId: string; createdAt: number; files: Array<{ path: string; prevContent: string | null }> }
export interface HostApplyResult { applied: boolean; checkpoint?: HostCheckpoint; appliedFiles?: string[]; reason?: string }

/** A target path is safe ONLY if it resolves strictly inside the repo root (no traversal escape). */
function safeRepoPath(relPath: string): string | null {
  const abs = resolve(HOST_REPO_ROOT, relPath);
  return abs === HOST_REPO_ROOT || abs.startsWith(HOST_REPO_ROOT + sep) ? abs : null;
}

/** Apply a captured run to the live repo. Refuses HIGH risk (defense in depth) + any path escaping the repo. Snapshots
 *  prior bytes into a checkpoint for undo. The caller MUST also enforce the AUMLOK session + risk gate. */
export function applyHostRun(run: HostRunResult): HostApplyResult {
  if (!run.ok || !run.changedFiles?.length) return { applied: false, reason: 'no_changes' };
  if (run.risk === 'high') return { applied: false, reason: 'high_risk_paused' };
  for (const f of run.changedFiles) if (!safeRepoPath(f.path)) return { applied: false, reason: `path_escape:${f.path}` };
  const checkpoint: HostCheckpoint = { runId: run.runId, checkpointId: randomUUID(), createdAt: Date.now(), files: [] };
  for (const f of run.changedFiles) {
    const abs = safeRepoPath(f.path)!;
    checkpoint.files.push({ path: f.path, prevContent: existsSync(abs) ? readFileSync(abs, 'utf-8') : null });
    if (f.status === 'deleted') { if (existsSync(abs)) rmSync(abs); }
    else { mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, f.afterContent ?? ''); }
  }
  return { applied: true, checkpoint, appliedFiles: run.changedFiles.map((f) => f.path) };
}

/** Undo an applied run by restoring the checkpoint's prior bytes (recreate / restore / re-delete as appropriate). */
export function undoHostApply(checkpoint: HostCheckpoint): { undone: boolean; reason?: string } {
  if (!checkpoint?.files?.length) return { undone: false, reason: 'empty_checkpoint' };
  for (const f of checkpoint.files) {
    const abs = safeRepoPath(f.path);
    if (!abs) continue;                                   // never touch a path outside the repo
    if (f.prevContent === null) { if (existsSync(abs)) rmSync(abs); }   // file did not exist before → remove
    else { mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, f.prevContent); }
  }
  return { undone: true };
}
