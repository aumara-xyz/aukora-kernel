// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * 24Z.64 — the governed tool boundary. `governedAsk` is the drop-in replacement for OpenCode's `ctx.ask`
 * (`packages/opencode/src/session/tools.ts:63`) AND the MCP path (`tools.ts:134`, which uses `always:["*"]`). It runs the
 * mandatory Aukora gate; on anything but `allow` it THROWS, so the tool's subsequent side effect (e.g. `afs.writeWithDirs`
 * in `tool/edit.ts`) never executes. Because BOTH ask sites route through here, the MCP wildcard cannot bypass the gate.
 *
 * `governedWrite` is a real, end-to-end governed file-write effect path used to prove the gate live (low-risk writes;
 * sensitive/high-risk is blocked before any byte is written). Writes are jailed to a workdir.
 */
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname, sep } from 'path';
import { aukoraGate } from './aukoraGate';
import type { AukoraAskInput, AukoraSession, GateDecision, GateReceipt } from './types';

export class AukoraGateDenied extends Error {
  constructor(public readonly decision: GateDecision) {
    super(decision.reason);
    this.name = 'AukoraGateDenied';
  }
}

export type ReceiptSink = (r: GateReceipt) => void;

/** Mandatory governed ask. allow → returns the decision; deny/pause → throws AukoraGateDenied (side effect never runs). */
export function governedAsk(input: AukoraAskInput, session: AukoraSession, onReceipt?: ReceiptSink): GateDecision {
  const decision = aukoraGate(input, session);
  onReceipt?.(decision.receipt);
  if (decision.effect !== 'allow') throw new AukoraGateDenied(decision);
  return decision;
}

export interface GovernedWriteResult { written: boolean; decision: GateDecision }

/** A real governed file write: build the ctx.ask-shaped request → gate → write only if allowed. Jailed to workdir. */
export function governedWrite(
  path: string,
  content: string,
  session: AukoraSession,
  opts?: { workdir?: string; onReceipt?: ReceiptSink },
): GovernedWriteResult {
  const workdir = resolve(opts?.workdir ?? process.cwd());
  const abs = resolve(workdir, path);
  // path-jail (defense-in-depth; the risk classifier handles sensitive paths, this stops workdir escape)
  if (abs !== workdir && !abs.startsWith(workdir + sep)) {
    const decision = aukoraGate({ tool: 'write', permission: 'edit', patterns: [path], metadata: { filepath: path } }, session);
    const denied: GateDecision = { ...decision, effect: 'deny', reason: `path_escape: ${path}`, receipt: { ...decision.receipt, effect: 'deny' } };
    opts?.onReceipt?.(denied.receipt);
    return { written: false, decision: denied };
  }
  const diff = content.split('\n').map((l) => '+' + l).join('\n');   // present the new content as added lines for the scan
  const input: AukoraAskInput = { tool: 'write', permission: 'edit', patterns: [path], always: ['*'], metadata: { filepath: path, diff } };
  let decision: GateDecision;
  try {
    decision = governedAsk(input, session, opts?.onReceipt);
  } catch (e) {
    if (e instanceof AukoraGateDenied) return { written: false, decision: e.decision };
    throw e;
  }
  // ALLOWED → perform the real effect.
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return { written: true, decision };
}
