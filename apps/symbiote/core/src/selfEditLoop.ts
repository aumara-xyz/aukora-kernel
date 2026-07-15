// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * M4 — the visible self-edit HEARTBEAT (sandbox-only, observable, authorizes NOTHING).
 *
 * The smallest real loop, composed from already-tested organs:
 *   propose -> GATE classifies (risk + action class) -> if safe, apply ONLY to a throwaway temp sandbox
 *   (appliedLive=false, hard) -> test the sandbox copy -> emit a phased receipt -> roll back (remove the
 *   sandbox) and PROVE the live repo was never touched.
 *
 * Hard line: nothing here promotes, writes the live repo, mutates Convex, touches memory authority, or
 * grants any capability. promotionReady is hard-false. It is a heartbeat you can WATCH — not a steering wheel.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { classifyRisk, type HostChangedFile } from './changeRiskClassifier';
import { buildKernelActionTable, classifyDraftAction } from './kernelActionClassifier';
import { issueSandboxApplyPermit } from './sandboxApplyPermit';
import { applySandboxPatch, type SandboxPatchFile, type SandboxApplyReceipt } from './sandboxApply';

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export interface SelfEditProposal {
  proposalId: string;
  goal: string;                  // human-readable intent
  codec: 'json_action_v1';       // the proposer contract (PROPOSER_CONTRACT.md)
  files: SandboxPatchFile[];     // the proposed change (full-file content)
}

export type HeartbeatPhase =
  | { phase: 'proposal'; proposalId: string; goal: string; targetFiles: string[]; proposalHash: string }
  | { phase: 'gate'; risk: 'low' | 'high'; reasons: string[]; actionClass: string; admitted: boolean; refusedReason?: string }
  | { phase: 'sandbox'; appliedSandbox: boolean; appliedLive: false; liveRepoUnchanged: true; sandboxReceipt: SandboxApplyReceipt | null; refusedReason?: string }
  | { phase: 'test'; ran: string[]; passed: boolean; detail: string }
  | { phase: 'receipt'; receiptHash: string; verdict: 'tested_green' | 'tested_red' | 'refused' }
  | { phase: 'rollback'; sandboxRemoved: boolean; liveRepoTouched: false; restored: boolean };

export interface SelfEditHeartbeat {
  schema: 'self-edit-heartbeat-v0';
  proposalId: string;
  phases: HeartbeatPhase[];
  outcome: 'tested_green' | 'tested_red' | 'refused';
  // hard invariants — every one is asserted by selfEditLoop.test.ts:
  appliedLive: false;
  liveRepoTouched: false;
  convexWritten: false;
  memoryAuthorityUsed: false;
  promotionReady: false;       // M4 is sandbox-only; promotion is a SEPARATE, later, proven lane
  advisoryOnly: true;
  grantsAuthority: false;
  createdAt: string;
}

export interface HeartbeatOptions {
  proposal: SelfEditProposal;
  now?: string;
  liveWitnessPath?: string;    // a live file proven byte-unchanged before/after (default: this module)
}

function close(proposalId: string, phases: HeartbeatPhase[], outcome: SelfEditHeartbeat['outcome'], now: string): SelfEditHeartbeat {
  return {
    schema: 'self-edit-heartbeat-v0', proposalId, phases, outcome,
    appliedLive: false, liveRepoTouched: false, convexWritten: false, memoryAuthorityUsed: false,
    promotionReady: false, advisoryOnly: true, grantsAuthority: false, createdAt: now,
  };
}

/** Run one observable self-edit heartbeat. Pure orchestration over the tested organs; authorizes nothing. */
export function runSelfEditHeartbeat(opts: HeartbeatOptions): SelfEditHeartbeat {
  const now = opts.now ?? new Date().toISOString();
  const p = opts.proposal;
  const phases: HeartbeatPhase[] = [];
  const targetFiles = p.files.map((f) => f.relPath);
  const proposalHash = sha256(JSON.stringify({ id: p.proposalId, goal: p.goal, files: p.files.map((f) => ({ r: f.relPath, c: sha256(f.content) })) }));

  // a live witness file, proven byte-identical before & after (the loop never touches the live repo)
  const witnessPath = opts.liveWitnessPath ?? __filename;
  const readWitness = () => { try { return sha256(fs.readFileSync(witnessPath, 'utf-8')); } catch { return 'unreadable'; } };
  const witnessBefore = readWitness();

  phases.push({ phase: 'proposal', proposalId: p.proposalId, goal: p.goal, targetFiles, proposalHash });

  // ── GATE: classify risk + action class. HIGH risk or a non-write_gated class is REFUSED (no permit, no apply).
  const changed: HostChangedFile[] = p.files.map((f) => ({ path: f.relPath, status: 'added' as const }));
  const pseudoDiff = p.files.map((f) => f.content.split('\n').map((l) => '+' + l).join('\n')).join('\n');
  const risk = classifyRisk(changed, pseudoDiff);
  const table = buildKernelActionTable();
  // classifyDraftAction reads an INTENT string (it looks for write verbs); express the proposed change as
  // "write <path>" so a normal file is write_gated and an authority/sacred path is refused as 'sacred'.
  const worstClass = p.files.reduce<string>((acc, f) => {
    const c = classifyDraftAction(`write ${f.relPath}`, table).class;
    return c === 'sacred' ? 'sacred' : acc === 'sacred' ? 'sacred' : c;
  }, 'write_gated');
  const admitted = risk.risk === 'low' && worstClass === 'write_gated';
  phases.push({ phase: 'gate', risk: risk.risk, reasons: risk.reasons, actionClass: worstClass, admitted, refusedReason: admitted ? undefined : risk.risk !== 'low' ? `risk ${risk.risk}` : `action class ${worstClass}` });

  const refuse = (where: string, reason: string): SelfEditHeartbeat => {
    phases.push({ phase: 'sandbox', appliedSandbox: false, appliedLive: false, liveRepoUnchanged: true, sandboxReceipt: null, refusedReason: `${where}: ${reason}` });
    phases.push({ phase: 'test', ran: [], passed: false, detail: `skipped — ${where}` });
    phases.push({ phase: 'receipt', receiptHash: sha256(proposalHash + '|refused'), verdict: 'refused' });
    phases.push({ phase: 'rollback', sandboxRemoved: false, liveRepoTouched: false, restored: readWitness() === witnessBefore });
    return close(p.proposalId, phases, 'refused', now);
  };

  if (!admitted) return refuse('gate refused', risk.risk !== 'low' ? `risk ${risk.risk}: ${risk.reasons[0] ?? ''}` : `action class ${worstClass}`);

  // ── SANDBOX APPLY: issue a sandbox-only permit + apply to a THROWAWAY temp dir (appliedLive=false hard).
  const draftHash = proposalHash;
  const permitRes = issueSandboxApplyPermit({ draftHash, actionClass: 'write_gated', nonce: sha256(draftHash + now).slice(0, 16), issuedAt: now });
  if (!permitRes.ok) return refuse('permit refused', permitRes.reason);

  const apply = applySandboxPatch({ permit: permitRes.permit, draftHash, files: p.files, keepSandbox: true, engineSource: 'seed_proposer', now });
  if (!apply.ok) return refuse('sandbox apply refused', apply.reason);
  const receipt = apply.receipt;
  phases.push({ phase: 'sandbox', appliedSandbox: receipt.appliedSandbox, appliedLive: false, liveRepoUnchanged: true, sandboxReceipt: receipt });

  // ── TEST against the sandbox copy: each applied file matches the proposal.
  const ran: string[] = [];
  let passed = true; let detail = '';
  for (const f of p.files) {
    ran.push(`sandbox-content:${f.relPath}`);
    let ok = false;
    try { ok = fs.readFileSync(path.join(receipt.sandboxPath, f.relPath), 'utf-8') === f.content; } catch { ok = false; }
    if (!ok) { passed = false; detail += `mismatch ${f.relPath}; `; }
  }
  if (passed) detail = `all ${ran.length} sandbox file(s) match the proposal`;
  phases.push({ phase: 'test', ran, passed, detail });

  // ── RECEIPT (phased): proposal -> sandbox -> test, verdict tested_green/red.
  const verdict: 'tested_green' | 'tested_red' = passed ? 'tested_green' : 'tested_red';
  phases.push({ phase: 'receipt', receiptHash: sha256([proposalHash, receipt.draftHash, String(passed), 'sandbox_only'].join('|')), verdict });

  // ── ROLLBACK: remove the throwaway sandbox; prove the live witness is byte-unchanged.
  let sandboxRemoved = false;
  try { fs.rmSync(receipt.sandboxPath, { recursive: true, force: true }); sandboxRemoved = !fs.existsSync(receipt.sandboxPath); } catch { sandboxRemoved = false; }
  phases.push({ phase: 'rollback', sandboxRemoved, liveRepoTouched: false, restored: readWitness() === witnessBefore });

  return close(p.proposalId, phases, verdict, now);
}

/** The heartbeat NEVER grants authority — it proposes, sandboxes, tests, receipts, and rolls back. */
export function heartbeatGrantsAuthority(_h: SelfEditHeartbeat): false { return false; }

/** A tiny SAFE demo proposal (a benign sandbox-only note) — the seed's first self-proposed change. */
export function demoHeartbeatProposal(): SelfEditProposal {
  return {
    proposalId: 'heartbeat_demo_v0',
    goal: 'the seed proposes a tiny, benign, sandbox-only note to prove the loop',
    codec: 'json_action_v1',
    files: [{ relPath: 'demo/seed-heartbeat.txt', content: 'Aukora Symbiote — first self-edit heartbeat. Sandbox only. appliedLive=false.\n' }],
  };
}

/** A deliberately UNSAFE proposal (sacred/authority path) — the gate must REFUSE it. For the negative test. */
export function unsafeHeartbeatProposal(): SelfEditProposal {
  return {
    proposalId: 'heartbeat_unsafe_v0',
    goal: 'an unsafe proposal targeting authority code — the gate must refuse it',
    codec: 'json_action_v1',
    files: [{ relPath: 'authority/aumlok/ceremony.ts', content: 'export const HACKED = true;\n' }],
  };
}
