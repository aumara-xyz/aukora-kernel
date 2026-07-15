// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * 24Z.64 — Aukora IDE gate types. These mirror the OpenCode tool-permission contract (MIT — see ../NOTICE):
 * a tool calls `ctx.ask({ permission, patterns, always, metadata:{filepath,diff} })` BEFORE its side effect
 * (e.g. `packages/opencode/src/tool/edit.ts:102` → `afs.writeWithDirs`). The Aukora gate is the governed decision that
 * replaces/augments that ask. `always` (OpenCode's "remember allow", incl. the MCP wildcard `always:["*"]`) is captured
 * here but is IGNORED by the gate's risk decision — that is the anti-bypass invariant.
 */
export type GateEffect = 'allow' | 'deny' | 'pause';

export interface AukoraAskInput {
  tool: string;                  // e.g. 'edit' | 'write' | 'apply_patch' | 'bash' | 'mcp:<name>'
  permission: string;            // OpenCode permission key (edit/bash/webfetch/...)
  patterns?: string[];
  always?: string[];             // OpenCode "remember allow" — recorded, NEVER used to skip the Aukora risk decision
  metadata?: { filepath?: string; diff?: string; command?: string;[k: string]: unknown };
  sessionID?: string;
}

export interface AukoraSession {
  unlocked: boolean;             // an AUMLOK session is unlocked
  expiresAt?: number;            // epoch ms; expired → treated as locked
}

export interface GateReceipt {
  kind: 'aukora_gate_decision_v0' | 'aukora_read_gate_decision_v0'; // 24Z.72 B0 — read-gate receipts share the log
  tool: string;
  permission: string;
  effect: GateEffect;
  path?: string;                 // path only (paths are not secrets); the change CONTENT is never stored
  argsHash: string;              // sha256 over {tool,permission,patterns,filepath,diff/command} — no secret value kept
  riskReasons: string[];         // gate reason LABELS only
  ts: string;
}

export interface GateDecision {
  effect: GateEffect;
  reason: string;
  riskReasons: string[];
  receipt: GateReceipt;
}

// write-capable tools: an unlocked AUMLOK session is required before any of these may proceed.
// 24Z.70 P1 — 'memory'/'memory_write' added: a DURABLE memory write is authority-gated like any other write (AUMLOK +
// secret-classifier), so a fact is never stored ungoverned. Memory READS are not write-capable (advisory, no authority).
const WRITE_CAPABLE_TOOLS = new Set(['edit', 'write', 'apply_patch', 'patch', 'bash', 'shell', 'task', 'memory', 'memory_write']);
const WRITE_CAPABLE_PERMS = new Set(['edit', 'write', 'bash', 'patch', 'memory', 'memory_write']);
export function isWriteCapable(tool: string, permission: string): boolean {
  return WRITE_CAPABLE_TOOLS.has(tool.toLowerCase()) || WRITE_CAPABLE_PERMS.has((permission || '').toLowerCase());
}

// 24Z.72 B0 — read-class tools/permissions: they pull disk/URL content to the model and are governed by the READ-GATE
// (path-policy deny of the secret surface, regardless of lock state). Shell is write-capable AND can read — handled separately.
const READ_CAPABLE = new Set(['read', 'grep', 'glob', 'webfetch', 'list', 'perceive', 'see', 'memory_recall']); // read-class permission policy. see/perceive are LEGACY classes — NO such tool is registered in the seed (registryIntegrity.test enforces it); the gate keeps their read-class classification as defense-in-depth. memory/memory_write stay WRITE_CAPABLE.
export function isReadCapable(tool: string, permission: string): boolean {
  return READ_CAPABLE.has((tool || '').toLowerCase()) || READ_CAPABLE.has((permission || '').toLowerCase());
}
