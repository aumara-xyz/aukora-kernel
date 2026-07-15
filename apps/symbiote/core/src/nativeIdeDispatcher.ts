// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Native Aukora IDE dispatcher — the SINGLE chokepoint for the ten tools in ideToolContract.ts. This is the
 * first native tool-call membrane: instead of an external agent editing files directly, a task can flow
 * status -> self_map -> list_files -> read_file -> search -> propose_patch -> sandbox_apply -> run_tests ->
 * write_receipt -> rollback_sandbox, entirely through THIS module's own code.
 *
 * Hard rules, enforced structurally (not by convention):
 *   - no direct live writes — the only write anywhere in this file goes through sandboxApply.ts's existing
 *     temp-only mechanism (reused, not reinvented); rollback_sandbox only ever removes a path proven to be
 *     under the system temp dir.
 *   - no subprocess spawning of any kind, anywhere in this file — run_tests is a safe SIMULATED check (sandbox
 *     file content vs. the proposal), never a command-line invocation, even though a tightly-bounded runner
 *     path would have been allowed; this is deliberately stricter than required.
 *   - no outbound network call of any kind.
 *   - no import of the platform's remote shared-database client.
 *   - no import of any cryptographic signing-key module — only the LOCAL STUB approval root (the same one
 *     the sandbox heartbeat already uses for sandbox permits) is ever imported here.
 *   - no dependency on the vendored donor IDE toolset anywhere in this file, in any form.
 *   - every file path argument must be repo-relative, contain no `..`, and resolve to stay inside the repo.
 *   - every tool result is bounded and validated against ideToolContract's exact allow-list before it is
 *     ever returned — a bug in one tool's implementation cannot silently produce an out-of-contract result.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import {
  isIdeToolName, validateIdeToolResult,
  type IdeToolName, type IdeToolCall, type IdeToolResult,
} from './ideToolContract';
import { buildKernelActionTable, classifyDraftAction } from './kernelActionClassifier';
import { applySandboxPatch, isSafeRelPath, type SandboxPatchFile } from './sandboxApply';
import { resolveRepoReadPath } from './repoReadPathResolver';
import { issueSandboxApplyPermit } from './sandboxApplyPermit';
import { buildRootOrganismRegistry } from './rootOrganismRegistry';
import { isLivePromotionUnlocked } from './aumlokAuthorityRoot';
import { createLocalAumlokRoot } from './aumlokApprovalRoot';
import { buildRecursiveIdeRehearsalReceipt } from './recursiveIdeRehearsalReceipt';
import { computeProposalHash } from './proposalHash';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Path confinement for the read lane (traversal + symlink escape + secret-shaped refusal) is centralized in
// repoReadPathResolver.ts (issue #75) and shared with kiraBrain.ingestSelfMap. The lexical-only in-file
// helpers that used to live here (resolveRepoRelative + refusesAsSecretPath) were REPLACED by that resolver:
// they followed symlinks via statSync/readFileSync, letting a committed in-repo symlink escape the repo.

function ok(tool: IdeToolName, output: unknown, now: string): IdeToolResult {
  return { schema: 'ide-tool-result-v1', tool, ok: true, output, advisoryOnly: true, grantsAuthority: false, createdAt: now };
}
function refused(tool: IdeToolName, reason: string, now: string): IdeToolResult {
  return { schema: 'ide-tool-result-v1', tool, ok: false, output: null, reason, advisoryOnly: true, grantsAuthority: false, createdAt: now };
}

/** The one entrypoint. Unknown tool names are refused before anything else runs. Every return path is
 *  re-validated against the exact tool-result contract — a fail-closed result is substituted if a tool's
 *  own implementation ever produced something out of contract. */
export function dispatchIdeTool(call: IdeToolCall, now = new Date().toISOString()): IdeToolResult {
  return dispatchIdeToolWithState(call, now).result;
}

/**
 * Same dispatch, plus an internal-only side channel for the ONE value that must never enter the public
 * tool-result contract: the real absolute sandbox path. sandbox_apply's `output` only ever carries a hash
 * of it (pseudonymity discipline — never persist/log/serialize a raw local temp path). recursiveWorkbench.ts
 * (the only intended caller of this variant) threads `rawSandboxPath` into the args of the next tool calls
 * (run_tests / write_receipt / rollback_sandbox); it must never print or persist this field verbatim.
 */
export function dispatchIdeToolWithState(
  call: IdeToolCall,
  now = new Date().toISOString(),
): { result: IdeToolResult; rawSandboxPath?: string } {
  if (!call || typeof call !== 'object' || !isIdeToolName((call as any).tool)) {
    return { result: refused('status', `unknown tool name: ${String((call as any)?.tool)}`, now) };
  }
  const args = (call.args && typeof call.args === 'object') ? call.args : {};
  let result: IdeToolResult;
  let rawSandboxPath: string | undefined;
  try {
    if (call.tool === 'sandbox_apply') {
      const built = toolSandboxApply(args, now);
      result = built.result;
      rawSandboxPath = built.rawSandboxPath;
    } else {
      result = runTool(call.tool, args, now);
    }
  } catch (e) {
    result = refused(call.tool, `tool threw: ${e instanceof Error ? e.message : String(e)}`, now);
  }
  const v = validateIdeToolResult(result);
  if (!v.valid) return { result: refused(call.tool, `result failed contract validation: ${v.reason}`, now) };
  return { result, rawSandboxPath };
}

function runTool(tool: IdeToolName, args: Record<string, unknown>, now: string): IdeToolResult {
  switch (tool) {
    case 'status': return toolStatus(now);
    case 'self_map': return toolSelfMap(now);
    case 'list_files': return toolListFiles(args, now);
    case 'read_file': return toolReadFile(args, now);
    case 'search': return toolSearch(args, now);
    case 'propose_patch': return toolProposePatch(args, now);
    case 'sandbox_apply': return toolSandboxApply(args, now).result;
    case 'run_tests': return toolRunTests(args, now);
    case 'write_receipt': return toolWriteReceipt(args, now);
    case 'rollback_sandbox': return toolRollbackSandbox(args, now);
    default: return refused(tool, `unknown tool name: ${String(tool)}`, now);
  }
}

// ── status — pure, no shell. Reports fixed, already-real invariants (no scripts/status.sh subprocess). ──
function toolStatus(now: string): IdeToolResult {
  const registry = buildRootOrganismRegistry();
  return ok('status', {
    headless: true,
    livePromotionUnlocked: isLivePromotionUnlocked(),
    aumlokMode: createLocalAumlokRoot().mode,
    organCount: registry.summary.total,
    organsPresent: registry.summary.present,
  }, now);
}

// ── self_map — reuse rootOrganismRegistry.ts entirely; no new self-map system. ──
function toolSelfMap(now: string): IdeToolResult {
  const registry = buildRootOrganismRegistry();
  const organs = registry.organs.slice(0, 60).map((o) => ({ id: o.id, present: o.present, mountState: o.mountState, role: o.role }));
  return ok('self_map', { summary: registry.summary, organs }, now);
}

// ── list_files — repo-relative directory listing only, bounded. ──
function toolListFiles(args: Record<string, unknown>, now: string): IdeToolResult {
  const dir = typeof args.dir === 'string' ? args.dir : '';
  if (!dir) return refused('list_files', 'dir is required', now);
  const r = resolveRepoReadPath(dir); // #75: symlink-denied, realpath-confined, secret-shaped-refused
  if (!r.ok) return refused('list_files', r.reason, now);
  if (!fs.statSync(r.real).isDirectory()) return refused('list_files', `not a directory: ${dir}`, now);
  const entries = fs.readdirSync(r.real, { withFileTypes: true })
    .filter((e) => e.name !== 'node_modules' && e.name !== '.git')
    .slice(0, 200)
    .map((e) => ({ name: e.name, isDir: e.isDirectory() }));
  return ok('list_files', { dir, entries }, now);
}

// ── read_file — repo-relative only; refuses secret/env/private-key-shaped paths; bounded output. ──
// `offset` (optional, characters) pages a long file: the same bounded window, starting later. Added
// after two different cheap-lane agent models deterministically stalled (stoppedReason=no_tool_calls)
// on a 30KB css file: the propose contract requires `find` snippets copied verbatim from a READ, and
// with no way to read past the first window the honest models correctly refused to propose an edit
// they could not see. Paging changes NOTHING about confinement — same resolver, same per-call cap,
// same refusals; a window is never larger, only later. Fail-closed on a malformed offset: refusing
// beats silently reading from 0 and letting the model believe it saw a window it did not.
const MAX_READ_CHARS = 8_000;
function toolReadFile(args: Record<string, unknown>, now: string): IdeToolResult {
  const relPath = typeof args.relPath === 'string' ? args.relPath : '';
  if (!relPath) return refused('read_file', 'relPath is required', now);
  let offset = 0;
  if (args.offset !== undefined) {
    if (typeof args.offset !== 'number' || !Number.isInteger(args.offset) || args.offset < 0) {
      return refused('read_file', 'offset must be a non-negative integer (character offset into the file)', now);
    }
    offset = args.offset;
  }
  const r = resolveRepoReadPath(relPath); // #75: lexical + secret-shaped + symlink-denied + realpath-confined
  if (!r.ok) return refused('read_file', r.reason, now);
  if (!fs.statSync(r.real).isFile()) return refused('read_file', `not a file: ${relPath}`, now);
  let content: string;
  try { content = fs.readFileSync(r.real, 'utf-8'); } catch (e) { return refused('read_file', `unreadable: ${relPath}`, now); }
  const end = Math.min(offset + MAX_READ_CHARS, content.length);
  const truncated = end < content.length; // more content exists AFTER this window
  return ok('read_file', { relPath, content: content.slice(offset, end), truncated, totalLength: content.length, offset }, now);
}

// ── search — pure in-process text search, no grep subprocess. Bounded scan + bounded results. ──
// .js/.css/.html joined the set when the first UI-targeted rehearsal exposed that the ENTIRE app
// layer (spatial/app is .js + .css + .html) was invisible to search: an agent asked to edit a css
// rule got honest zero hits for every query and had no way to locate its target (live repro
// 2026-07-07, two models, six runs — the searches were fine, the extension set was blind). Same
// resolver confinement, same scan/result caps; text files only, nothing secret-shaped changes.
const SEARCH_EXTENSIONS = new Set(['.ts', '.md', '.json', '.txt', '.sh', '.js', '.css', '.html']);
const MAX_SEARCH_FILES_SCANNED = 1500;
const MAX_SEARCH_RESULTS = 50;
function toolSearch(args: Record<string, unknown>, now: string): IdeToolResult {
  const query = typeof args.query === 'string' ? args.query : '';
  if (!query || query.length < 2) return refused('search', 'query must be a string of length >= 2', now);
  const dirArg = typeof args.dir === 'string' ? args.dir : '.';
  const rootReal = fs.realpathSync(REPO_ROOT); // realpath the root so per-file confinement + rels line up
  let startAbs: string;
  if (dirArg === '.') {
    startAbs = rootReal;
  } else {
    const r = resolveRepoReadPath(dirArg); // #75: symlink-denied, realpath-confined start dir
    if (!r.ok) return refused('search', r.reason, now);
    startAbs = r.real;
  }

  const needle = query.toLowerCase();
  const results: Array<{ relPath: string; line: number; snippet: string }> = [];
  let scanned = 0;

  const walk = (dir: string) => {
    if (results.length >= MAX_SEARCH_RESULTS || scanned >= MAX_SEARCH_FILES_SCANNED) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (results.length >= MAX_SEARCH_RESULTS || scanned >= MAX_SEARCH_FILES_SCANNED) return;
      if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.')) continue;
      if (e.isSymbolicLink()) continue; // #75: never follow a symlink (dir or file) — cheaper than lstat per entry
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!SEARCH_EXTENSIONS.has(path.extname(e.name))) continue;
      // #75: confine + secret-shaped refusal via the shared resolver; silently skip refused entries.
      const resolved = resolveRepoReadPath(path.relative(rootReal, abs), { root: rootReal });
      if (!resolved.ok) continue;
      scanned++;
      let text: string;
      try { text = fs.readFileSync(resolved.real, 'utf-8'); } catch { continue; }
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(needle)) {
          results.push({ relPath: path.relative(rootReal, resolved.real), line: i + 1, snippet: lines[i].trim().slice(0, 160) });
          if (results.length >= MAX_SEARCH_RESULTS) break;
        }
      }
    }
  };
  walk(startAbs);
  return ok('search', { query, filesScanned: scanned, results, boundedResults: results.length >= MAX_SEARCH_RESULTS }, now);
}

// ── propose_patch — classify + hash only; writes nothing. Refuses sacred/authority targets up front. ──
export interface ProposedFile { relPath: string; content: string }
function toolProposePatch(args: Record<string, unknown>, now: string): IdeToolResult {
  const goal = typeof args.goal === 'string' ? args.goal : '';
  const files = Array.isArray(args.files) ? (args.files as ProposedFile[]) : [];
  if (!goal) return refused('propose_patch', 'goal is required', now);
  if (!files.length) return refused('propose_patch', 'at least one file is required', now);
  if (files.length > 20) return refused('propose_patch', 'too many files (cap = 20)', now);

  const table = buildKernelActionTable();
  for (const f of files) {
    if (typeof f.relPath !== 'string' || typeof f.content !== 'string') return refused('propose_patch', 'each file needs relPath + content strings', now);
    if (!isSafeRelPath(f.relPath)) return refused('propose_patch', `unsafe path: ${f.relPath}`, now);
    if (f.content.length > 100_000) return refused('propose_patch', `content too large: ${f.relPath}`, now);
    const verdict = classifyDraftAction(`write ${f.relPath}`, table);
    if (verdict.class === 'sacred') return refused('propose_patch', `sacred/Ring-0 path refused: ${f.relPath} (${verdict.rationale})`, now);
  }
  const targetFiles = files.map((f) => f.relPath);
  const proposalHash = computeProposalHash(goal, files);
  return ok('propose_patch', { goal, targetFiles, proposalHash, admitted: true }, now);
}

// ── sandbox_apply — REUSES sandboxApply.ts's existing temp-only mechanism. No second sandbox system.
// Returns the raw sandbox path ONLY on the internal side channel — the tool-result `output` (which is what
// gets logged/serialized/printed) carries a hash of it, never the raw local path. ──
function toolSandboxApply(args: Record<string, unknown>, now: string): { result: IdeToolResult; rawSandboxPath?: string } {
  const goal = typeof args.goal === 'string' ? args.goal : '';
  const files = Array.isArray(args.files) ? (args.files as SandboxPatchFile[]) : [];
  const proposalHash = typeof args.proposalHash === 'string' ? args.proposalHash : '';
  if (!goal || !files.length || !proposalHash) return { result: refused('sandbox_apply', 'goal, files, and proposalHash are required', now) };

  const permitRes = issueSandboxApplyPermit({ draftHash: proposalHash, actionClass: 'write_gated', nonce: sha256(proposalHash + now).slice(0, 16), issuedAt: now });
  if (!permitRes.ok) return { result: refused('sandbox_apply', `permit refused: ${permitRes.reason}`, now) };

  const apply = applySandboxPatch({ permit: permitRes.permit, draftHash: proposalHash, files, keepSandbox: true, engineSource: 'native_ide_dispatcher', now });
  if (!apply.ok) return { result: refused('sandbox_apply', `sandbox apply refused: ${apply.reason}`, now) };

  const result = ok('sandbox_apply', {
    sandboxPathHash: sha256(apply.receipt.sandboxPath),
    filesChanged: apply.filesChanged,
    appliedSandbox: apply.receipt.appliedSandbox,
    appliedLive: false,
  }, now);
  return { result, rawSandboxPath: apply.receipt.sandboxPath };
}

// ── run_tests — a SAFE SIMULATED check against the sandbox copy. No shell, no arbitrary command. ──
function toolRunTests(args: Record<string, unknown>, now: string): IdeToolResult {
  const sandboxPath = typeof args.sandboxPath === 'string' ? args.sandboxPath : '';
  const files = Array.isArray(args.files) ? (args.files as SandboxPatchFile[]) : [];
  if (!sandboxPath || !files.length) return refused('run_tests', 'sandboxPath and files are required', now);

  // hard check: this tool may only ever read from a path proven to be under the system temp dir.
  const tmpReal = fs.realpathSync(os.tmpdir());
  let sandboxReal: string;
  try { sandboxReal = fs.realpathSync(sandboxPath); } catch { return refused('run_tests', 'sandbox path does not exist', now); }
  if (sandboxReal !== tmpReal && !sandboxReal.startsWith(tmpReal + path.sep)) {
    return refused('run_tests', 'sandbox path is not under the system temp dir — refusing to read it', now);
  }

  const ran: string[] = [];
  let passed = true; let detail = '';
  for (const f of files) {
    ran.push(`sandbox-content:${f.relPath}`);
    let match = false;
    try { match = fs.readFileSync(path.join(sandboxPath, f.relPath), 'utf-8') === f.content; } catch { match = false; }
    if (!match) { passed = false; detail += `mismatch ${f.relPath}; `; }
  }
  if (passed) detail = `all ${ran.length} sandbox file(s) match the proposal`;
  return ok('run_tests', { ran, passed, detail }, now);
}

// ── write_receipt — thin wrapper; the real schema/validator live in recursiveIdeRehearsalReceipt.ts. ──
function toolWriteReceipt(args: Record<string, unknown>, now: string): IdeToolResult {
  const task = typeof args.task === 'string' ? args.task : '';
  const toolCallsUsed = Array.isArray(args.toolCallsUsed) ? (args.toolCallsUsed as string[]) : [];
  const targetFiles = Array.isArray(args.targetFiles) ? (args.targetFiles as string[]) : [];
  const proposalHash = typeof args.proposalHash === 'string' ? args.proposalHash : '';
  const sandboxPath = typeof args.sandboxPath === 'string' ? args.sandboxPath : '';
  const testResult = (args.testResult && typeof args.testResult === 'object') ? args.testResult as { passed: boolean; ran: string[]; detail: string } : { passed: false, ran: [], detail: 'missing' };
  if (!task || !proposalHash || !sandboxPath) return refused('write_receipt', 'task, proposalHash, and sandboxPath are required', now);

  const receipt = buildRecursiveIdeRehearsalReceipt({ task, toolCallsUsed, targetFiles, proposalHash, sandboxPath, testResult, now });
  return ok('write_receipt', { receipt }, now);
}

// ── rollback_sandbox — removes ONLY a path proven to be under the system temp dir. ──
function toolRollbackSandbox(args: Record<string, unknown>, now: string): IdeToolResult {
  const sandboxPath = typeof args.sandboxPath === 'string' ? args.sandboxPath : '';
  if (!sandboxPath) return refused('rollback_sandbox', 'sandboxPath is required', now);
  const tmpReal = fs.realpathSync(os.tmpdir());
  let sandboxReal: string;
  try { sandboxReal = fs.realpathSync(sandboxPath); } catch { return ok('rollback_sandbox', { sandboxRemoved: true, liveRepoTouched: false, note: 'already gone' }, now); }
  if (sandboxReal !== tmpReal && !sandboxReal.startsWith(tmpReal + path.sep)) {
    return refused('rollback_sandbox', 'refusing to remove a path outside the system temp dir', now);
  }
  fs.rmSync(sandboxPath, { recursive: true, force: true });
  const sandboxRemoved = !fs.existsSync(sandboxPath);
  return ok('rollback_sandbox', { sandboxRemoved, liveRepoTouched: false }, now);
}

/** The dispatcher never grants authority — structural, not a promise. */
export function dispatcherGrantsAuthority(_r: IdeToolResult): false { return false; }
