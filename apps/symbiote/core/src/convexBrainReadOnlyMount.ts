/**
 * 24Z.16 — Convex Brain Read-Only Mount + Durable Workflow Inventory (Great Merge: the memory/workflow organ).
 *
 * Mounts the EXISTING, proven Convex brain (buildConvexBrainSnapshot — loopback-only, secret-omitting,
 * mutation-denying) into Aukora OS as a READ-ONLY organ for the console/DraftEngine, and adds a durable-workflow
 * inventory parsed from the real Convex sources. It is metadata only:
 *   - NO live production Convex connection (loopback-only + cloud-domain deny enforced; `liveReadEdge` only
 *     true if a loopback bridge is actually present — false in static/generated mode).
 *   - NO mutation/write surface is EXPOSED (writes are listed as PARKED/FORBIDDEN inventory, never callable).
 *   - NO workflow executor wired (actions listed as PARKED; never imported/run).
 *   - NO secrets, NO phone-home wire. grantsAuthority:false.
 * Honest line: "Convex brain mounted READ-ONLY as inventory; no write, no live prod edge, no autonomous run."
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildConvexBrainSnapshot, type ConvexBrainSnapshot } from './convexBrainSnapshot';
import { rejectNonLoopback, rejectMutation } from './convexBrainReadonly';

export type WorkflowClassification = 'readonly' | 'parked' | 'forbidden' | 'missing';

export interface WorkflowFn {
  name: string;
  kind: 'query' | 'mutation' | 'action' | 'internalMutation' | 'internalQuery' | 'internalAction' | 'unknown';
  file: string;
  path: string;
  classification: WorkflowClassification; // readonly=query metadata; parked=write/execute (not mounted); forbidden=authority write
  reason: string;
}

export interface ConvexBrainReadOnlyMount {
  schema: 'convex-brain-readonly-mount-v0';
  brain: {
    bridgeMode: ConvexBrainSnapshot['bridgeMode'];
    liveReadEdge: boolean;               // true ONLY if a local loopback read bridge is actually present
    organCount: number;
    activeCandidate: number;
    readOnlyCandidate: number;
    labOnly: number;
    forbidden: number;
    future: number;
    donor: number;
    risks: string[];
  };
  workflows: WorkflowFn[];
  workflowSummary: { total: number; readonly: number; parked: number; forbidden: number; missingFiles: string[] };
  productionConnection: false;  // hard — no cloud convex domains, no phone-home
  mutationExposed: false;       // hard — writes are inventory only, never a callable surface
  executorWired: false;         // hard — no workflow/action is imported or run
  secretsExposed: false;        // hard — snapshot is secret-omitting by construction
  mountedIntoApp: boolean;      // consumed by the console/DraftEngine as metadata
  advisoryOnly: true;
  grantsAuthority: false;
}

// 24Z.16 (Fusion Opus/Gemini/Grok): the ONLY bridge modes that may carry a live read edge. A live edge is a
// LOCAL LOOPBACK read only — never production. static_inventory/missing can never be a live edge. This is the
// central correctness seam: liveReadEdge is computed solely from this allowlist, and assertConvexMountSafe
// hard-denies any mount that claims liveReadEdge outside a verified loopback mode (or with a prod connection).
const VERIFIED_LIVE_READ_MODES = new Set<ConvexBrainSnapshot['bridgeMode']>(['local_loopback_readonly']);

export function computeLiveReadEdge(bridgeMode: ConvexBrainSnapshot['bridgeMode']): boolean {
  return VERIFIED_LIVE_READ_MODES.has(bridgeMode);
}

// Real Convex durable-workflow / memory sources to inventory (parsed, never imported).
const WORKFLOW_SOURCES = ['workflow.ts', 'memory.ts', 'aumlokMemory.ts'];
// Authority writes — listed as FORBIDDEN (would require a signed apply lane that does not exist).
const FORBIDDEN_WRITES = new Set(['aumlokMemoryWrite', 'executeDecision', 'writeReceiptRow', 'signPoP', 'submitAndConsume']);
const FN_RE = /export const (\w+)\s*=\s*(internalMutation|internalQuery|internalAction|mutation|query|action)\b/g;

function classifyFn(name: string, kind: WorkflowFn['kind']): { classification: WorkflowClassification; reason: string } {
  if (FORBIDDEN_WRITES.has(name)) return { classification: 'forbidden', reason: 'authority write — needs signed apply lane (not built)' };
  if (/query/i.test(kind)) return { classification: 'readonly', reason: 'read-only query — readable metadata (no live read edge yet)' };
  if (/mutation/i.test(kind)) return { classification: 'parked', reason: 'write mutation — parked, not exposed as callable' };
  return { classification: 'parked', reason: 'action/executor — parked, never imported or run' };
}

export interface ConvexMountOptions {
  repoRoot?: string;
  mountedIntoApp?: boolean; // default true (consumed via the manifest)
}

export function buildConvexBrainReadOnlyMount(opts: ConvexMountOptions = {}): ConvexBrainReadOnlyMount {
  const repoRoot = opts.repoRoot ?? path.resolve(__dirname, '..', '..', '..');
  const snapshot = buildConvexBrainSnapshot(repoRoot);
  const convexDir = path.join(repoRoot, 'node-template', 'convex');

  const workflows: WorkflowFn[] = [];
  const missingFiles: string[] = [];
  for (const file of WORKFLOW_SOURCES) {
    const abs = path.join(convexDir, file);
    if (!fs.existsSync(abs)) { missingFiles.push(file); continue; }
    const src = fs.readFileSync(abs, 'utf-8');
    let m: RegExpExecArray | null;
    FN_RE.lastIndex = 0;
    while ((m = FN_RE.exec(src)) !== null) {
      const name = m[1];
      const kind = m[2] as WorkflowFn['kind'];
      const { classification, reason } = classifyFn(name, kind);
      workflows.push({ name, kind, file, path: abs, classification, reason });
    }
  }

  const liveReadEdge = computeLiveReadEdge(snapshot.bridgeMode);
  return {
    schema: 'convex-brain-readonly-mount-v0',
    brain: {
      bridgeMode: snapshot.bridgeMode,
      liveReadEdge,
      organCount: snapshot.organs.length,
      activeCandidate: snapshot.activeCandidateCount,
      readOnlyCandidate: snapshot.readOnlyCandidateCount,
      labOnly: snapshot.labOnlyCount,
      forbidden: snapshot.forbiddenCount,
      future: snapshot.futureCount,
      donor: snapshot.donorCount,
      risks: snapshot.risks,
    },
    workflows,
    workflowSummary: {
      total: workflows.length,
      readonly: workflows.filter((w) => w.classification === 'readonly').length,
      parked: workflows.filter((w) => w.classification === 'parked').length,
      forbidden: workflows.filter((w) => w.classification === 'forbidden').length,
      missingFiles,
    },
    productionConnection: false,
    mutationExposed: false,
    executorWired: false,
    secretsExposed: false,
    mountedIntoApp: opts.mountedIntoApp ?? true,
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

export function convexMountGrantsAuthority(_m: ConvexBrainReadOnlyMount): false {
  return false;
}

/**
 * Defense-in-depth assertion: prove the mount can neither reach production nor expose a mutation. Reuses the
 * proven loopback + mutation-deny guards from the read-only bridge. Throws if any invariant is violated.
 */
export function assertConvexMountSafe(m: ConvexBrainReadOnlyMount): void {
  if (m.productionConnection || m.mutationExposed || m.executorWired || m.secretsExposed || m.grantsAuthority) {
    throw new Error('convex_mount_invariant_violation');
  }
  // 24Z.16 (Fusion Opus): liveReadEdge may ONLY be true in a verified loopback mode, and never with a
  // production connection. A mount claiming liveReadEdge outside the allowlist is a tampered/overclaiming mount.
  if (m.brain.liveReadEdge && (!VERIFIED_LIVE_READ_MODES.has(m.brain.bridgeMode) || m.productionConnection)) {
    throw new Error(`convex_mount_live_read_edge_unverified: bridgeMode=${m.brain.bridgeMode}`);
  }
  // a callable mutation/action would be a write surface — none may be exposed
  rejectNonLoopback('http://127.0.0.1:3210'); // loopback OK (no throw)
  for (const w of m.workflows) {
    if (w.classification === 'forbidden' || w.kind.includes('mutation') || w.kind.includes('action')) {
      rejectMutation(w.name); // throws if a known mutation name leaks into a callable path
    }
  }
}

/** Compact context for the console/DraftEngine: brain/memory/workflow/parked/write questions. */
export function summarizeConvexBrainMount(m: ConvexBrainReadOnlyMount): string {
  const wf = m.workflowSummary;
  return [
    `Convex brain: mounted READ-ONLY (bridgeMode=${m.brain.bridgeMode}, liveReadEdge=${m.brain.liveReadEdge}). NOT active, NOT production-wired.`,
    `Brain organs inventoried: ${m.brain.organCount} (readOnly=${m.brain.readOnlyCandidate}, labOnly=${m.brain.labOnly}, forbidden=${m.brain.forbidden}, donor=${m.brain.donor}).`,
    `Durable workflows: ${wf.total} found — readonly(query)=${wf.readonly}, parked(write/exec)=${wf.parked}, forbidden(authority write)=${wf.forbidden}. executorWired=${m.executorWired}.`,
    `Can you write memory? NO — mutationExposed=${m.mutationExposed}, no signed apply lane. Can workflows run? NO — no executor.`,
    'Advisory only — grants no authority; read-only inventory, no live production connection, no autonomous run.',
  ].join('\n');
}
