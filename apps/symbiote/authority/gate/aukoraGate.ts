// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * 24Z.64 — THE NATIVE AUKORA GATE. The single governed decision that sits in front of every write-capable OpenCode tool
 * call. It is MANDATORY and independent of OpenCode's own allow/deny rules and of `always:["*"]` (the MCP wildcard) — an
 * OpenCode rule can never bypass it. Order:
 *   1. write-capable tool requires an unlocked AUMLOK session (locked → PAUSE / held);
 *   2. the risk classifier runs on the proposed change → HIGH → DENY (blocked), even if OpenCode said allow/always;
 *   3. otherwise ALLOW.
 * Every decision emits a receipt (tool, effect, argsHash, reason labels) with NO secret value copied.
 *
 * Model/provider proposes the tool call; THIS authorizes. (Patent: C-229 native tool-boundary insertion · C-230 AUMLOK
 * replacing native permissions.)
 */
import { createHash } from 'crypto';
import { realpathSync, lstatSync, readlinkSync } from 'fs';
import { dirname, basename, join, isAbsolute } from 'path';
import { classifyRisk, classifyRead } from './risk';
import { isWriteCapable, isReadCapable, type AukoraAskInput, type AukoraSession, type GateDecision, type GateEffect } from './types';

function sha256(s: string): string { return createHash('sha256').update(s).digest('hex'); }

// 88f-confirm round2 #1/#2/#4 — SYMLINK/TRAVERSAL HONOR: the kernel cage matches the RESOLVED vnode; the classifier matched the
// LEXICAL literal. An innocent-named symlink (notes.txt→.env, innocent.ts→risk.ts) or a `..` traversal therefore diverged them,
// and the in-process read/write tools (which never hit the cage) followed the link. Fix: canonicalize every read/write target the
// SAME way the kernel does (realpath; for a not-yet-existing leaf, realpath the longest existing ancestor + re-append the tail) and
// hand the classifier BOTH the literal AND the resolved form. realpath also collapses `..`/`.`. Pure-string fallback if FS unavailable.
function resolveForPolicy(p: string): string | null {
  if (!p || !p.startsWith('/')) return null; // relative/opaque → caller keeps the literal (resolved against cwd elsewhere)
  try { return realpathSync.native(p); } catch {}
  // 88f-confirm r3 #1 — p did not fully resolve. If p ITSELF is a (dangling/missing-leaf) SYMLINK — the normal case for a write
  // that CREATES a new file through a link — follow ONE level to its target and resolve THAT (the kernel cage follows it; we must
  // too). The earlier ancestor-walk re-appended the LINK's own name → it saw the innocent name, not the target (the round-2 bug).
  try {
    if (lstatSync(p).isSymbolicLink()) {
      const tgt = readlinkSync(p);
      const abs = isAbsolute(tgt) ? tgt : join(dirname(p), tgt);
      return resolveForPolicy(abs) ?? abs;
    }
  } catch {}
  // a not-yet-existing leaf under a real (non-symlink) dir → resolve the longest existing ancestor + re-append the tail.
  let dir = dirname(p); const tail: string[] = [basename(p)];
  while (dir && dir !== '/' && dir.length > 1) {
    try { return join(realpathSync.native(dir), ...tail.reverse()); } catch { tail.push(basename(dir)); dir = dirname(dir); }
  }
  return null; // no ancestor resolvable → the literal lexical checks still apply
}
// Return the original paths PLUS any distinct realpath-resolved forms (so SENSITIVE/READ_DENY/deny-by-default see the vnode too).
function withResolved(paths: string[]): string[] {
  const out: string[] = [];
  for (const p of paths) { if (p) out.push(p); const r = resolveForPolicy(p); if (r && r !== p && !out.includes(r)) out.push(r); }
  return out;
}

function argsHashOf(input: AukoraAskInput): string {
  // hash the args (incl. the change content) so the receipt references the exact request WITHOUT storing any secret value.
  // 24Z.69 Step 2b-Docker (P1.3) — also hash apply_patch files[] + move/rename targets so a move attempt is uniquely identified.
  const md: any = input.metadata ?? {};
  const files = Array.isArray(md.files) ? md.files.map((f: any) => ({ filePath: f?.filePath ?? null, movePath: f?.movePath ?? null, type: f?.type ?? null })) : null;
  return sha256(JSON.stringify({
    tool: input.tool, permission: input.permission, patterns: input.patterns ?? [],
    filepath: md.filepath ?? null, diff: md.diff ?? null, command: md.command ?? null, files,
  }));
}

function nowIso(): string { try { return new Date().toISOString(); } catch { return '—'; } }

export function aukoraGate(input: AukoraAskInput, session: AukoraSession): GateDecision {
  const writeCapable = isWriteCapable(input.tool, input.permission);
  const md = input.metadata ?? {};
  const path = md.filepath;
  const argsHash = argsHashOf(input);
  const ts = nowIso();
  const mk = (effect: GateEffect, reason: string, riskReasons: string[] = []): GateDecision => ({
    effect, reason, riskReasons,
    receipt: { kind: 'aukora_gate_decision_v0', tool: input.tool, permission: input.permission, effect, path, argsHash, riskReasons, ts },
  });
  // read-gate receipts share the same log under a distinct kind; the receipt path is the read TARGET (no content stored).
  const mkRead = (effect: GateEffect, reason: string, riskReasons: string[] = []): GateDecision => ({
    effect, reason, riskReasons,
    receipt: { kind: 'aukora_read_gate_decision_v0', tool: input.tool, permission: input.permission, effect, path: (input.patterns ?? [])[0] ?? (md.path as string) ?? (md.url as string) ?? (md.command as string) ?? path, argsHash, riskReasons, ts },
  });

  // 1) 24Z.72 B0 — THE READ-GATE (runs FIRST — path-deny is policy, not lock-state, so a sensitive read DENIES whether
  // locked or unlocked, never just "paused"). Read-class tools (read/grep/glob/webfetch/list) + shell READ commands governed
  // by path-policy: the secret surface is denied BEFORE the read; fail-closed on an unresolvable/opaque target. The decision
  // reads ONLY static policy, never the content read (§13: content/perception/memory must never become authority). This also
  // UN-BREAKS the read tools (previously blanket-denied by the opaque-wildcard rule) — normal reads ALLOW, secrets DENY.
  const readClass = isReadCapable(input.tool, input.permission);
  if (readClass || typeof md.command === 'string') {
    // 88f-confirm round2 #1 — feed the read-gate the realpath-RESOLVED targets too, so an innocent-named symlink to a secret
    // (notes.txt→.env) is matched on its vnode the SAME way the kernel cage does (the in-process read tool follows the link).
    const rr = classifyRead({ permission: input.permission, tool: input.tool, patterns: withResolved(input.patterns ?? []), metadata: md });
    if (rr.reasons.length) return mkRead('deny', 'BLOCKED BY AUKORA READ-GATE — sensitive read refused (content withheld from the model)', rr.reasons);
    if (readClass) {
      if (!rr.hadTarget) return mkRead('deny', 'BLOCKED BY AUKORA READ-GATE — read with no resolvable target (fail-closed)', ['read target unresolvable']);
      return mkRead('allow', 'read allowed — non-sensitive target (read-gate)');
    }
    // a shell command that passed the read-gate → continue to the write/AUMLOK handling below (it may also write).
  }

  // 2) AUMLOK session — write-capable tools are HELD when locked/expired (regardless of OpenCode rules or `always`).
  const sessionLive = !!session.unlocked && (!session.expiresAt || session.expiresAt > Date.now());
  if (writeCapable && !sessionLive) {
    return mk('pause', 'AUMLOK locked — unlock a session to allow write-capable tools');
  }

  // 2b) MCP / opaque-wildcard deny-by-default (24Z.69 Step 2b, P0.3) — an `always:["*"]` call with NO resolvable target
  // (no filepath/diff/command) is the MCP wildcard signature; it cannot be verified safe → DENY. (The edit tool also sends
  // always:["*"] but carries metadata.filepath, so it is NOT opaque and is classified normally below.)
  const opaqueWildcard = (input.always ?? []).includes('*') && !md.filepath && !md.diff && !md.command;
  if (opaqueWildcard) return mk('deny', 'BLOCKED BY AUKORA — opaque MCP/wildcard tool call with no resolvable target (deny-by-default)', ['opaque MCP/wildcard call — no resolvable target']);

  // 2) Risk classifier — independent of OpenCode allow/deny/`always`. HIGH → blocked. Shell commands are classified by
  // their resolved WRITE TARGETS (24Z.69 Step 2b); apply_patch by EVERY file + move/rename DESTINATION (24Z.69 Step 2b-final).
  if (writeCapable || md.filepath || md.diff || md.command || (md as any).files) {
    const paths: string[] = [];
    if (typeof md.filepath === 'string') for (const p of md.filepath.split(/\s*,\s*/)) if (p) paths.push(p); // split joined paths (anchors)
    const files = (md as any).files;
    if (Array.isArray(files)) for (const f of files) { // apply_patch move-target: a rename ONTO a gate file overwrites it
      if (f?.filePath) paths.push(String(f.filePath));
      if (f?.movePath) paths.push(String(f.movePath));
      if (f?.relativePath) paths.push(String(f.relativePath));
    }
    const command = md.command;
    const added = md.diff ?? (command ? '+' + command : '');
    // 88f-confirm #4 — the workspace root for the in-process write deny-by-default: the shell carries its spawn cwd (md.cwd,
    // matching the cage); the in-process write/edit tool carries none → use the server's cwd (the opened project root). try/catch
    // because process.cwd() can throw if the cwd was unlinked; on failure → undefined → classifyRisk fails-open (no deny-all).
    let workspace: string | undefined = typeof md.cwd === 'string' && md.cwd ? md.cwd : undefined;
    if (!workspace) { try { workspace = process.cwd(); } catch { workspace = undefined; } }
    // 88f-confirm round2 #1/#2/#4 — resolve relative write targets against the workspace, then add the realpath-RESOLVED vnode for
    // each (so a symlink ONTO an authority/outside target, or a `..` traversal, is matched the SAME way the kernel cage matches it).
    const resolvedPaths = withResolved(paths.map((p) => (p.startsWith('/') || !workspace ? p : join(workspace, p))));
    const { risk, reasons } = classifyRisk({ paths: resolvedPaths, addedContent: added, command, cwd: typeof md.cwd === 'string' ? md.cwd : undefined, workspace }); // 24Z.88d — cwd resolves relative shell-write targets; 88f — workspace = deny-by-default root + realpath-resolved targets
    if (risk === 'high') return mk('deny', 'BLOCKED BY AUKORA — high-risk change refused (the agent proposes; Aukora authorizes)', reasons);
  }

  // 3) Allow.
  return mk('allow', writeCapable ? 'low-risk change allowed in an unlocked AUMLOK session' : 'allowed');
}
