// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Governed Work Order v0 — the SPINE of the Governed Autonomy Pack.
 *
 * A work order is an ADVISORY, ring-tagged unit of work that Auma (or any lane) can queue from inside. It is a
 * REQUEST, not a hand: it grants NO authority and applies NOTHING. The only path from a work order to a live
 * change is a worker producing a proposal that STILL passes the live-apply gate (dispatchSignedLiveApply) +
 * the owner's AUMLOK signature. This module is the data model + the governance matrix ONLY — there is no worker,
 * no apply, no signer here. Every value is advisoryOnly:true, grantsAuthority:false, canApplyNow:false.
 *
 * Hard invariants (Codex spec, "max autonomy UNDER governance"):
 *   - Ring 0 (gate/signer/policy/secrets/state/.github) → NEVER worker-eligible; a live change needs AUMLOK.
 *   - Ring 1 → not worker-eligible; needs an explicit owner session grant (a SEPARATE, owner-ratified brick).
 *   - Ring 2/3/4 → a bounded worker may DRAFT + TEST; but in v0 a LIVE apply STILL needs AUMLOK. The
 *     "worker applies under a session grant" authority is the NEXT brick and requires the owner's explicit
 *     ratification — v0 deliberately grants NO new apply authority, it only classifies + queues + records.
 *   - No lane may self-sign; shadow/Nebius-sourced orders can never be trusted into live authority.
 */
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export type Ring = 0 | 1 | 2 | 3 | 4;
export type WorkOrderStatus = 'queued' | 'claimed' | 'proposed' | 'awaiting_signature' | 'applied' | 'rejected' | 'blocked';
export type Lane = 'auma' | 'fable' | 'codex' | 'owner';
export type OrderSource = 'local' | 'shadow'; // shadow = Nebius/experimental — never trusted into live authority

/** The governance matrix: what a given ring requires before a LIVE apply. Pure; grants nothing. */
export interface RingAuthorization {
  ring: Ring;
  workerEligible: boolean;                                   // may a bounded worker DRAFT+TEST without the owner in the loop?
  applyRequires: 'aumlok_signature' | 'owner_session_grant'; // v0: Ring 0/2/3/4 = AUMLOK; Ring 1 = session grant
  fusionCouncil: 'mandatory' | 'optional';
  neverSelfSignable: true;                                    // hard — the owner is always the authority root
}

export function ringAuthorization(ring: Ring): RingAuthorization {
  const base = { ring, neverSelfSignable: true as const };
  if (ring === 0) return { ...base, workerEligible: false, applyRequires: 'aumlok_signature', fusionCouncil: 'mandatory' };
  if (ring === 1) return { ...base, workerEligible: false, applyRequires: 'owner_session_grant', fusionCouncil: 'mandatory' };
  // Ring 2/3/4: worker may DRAFT+TEST. v0 keeps apply at AUMLOK (no new authority); Fusion optional for Ring 3/4.
  return { ...base, workerEligible: true, applyRequires: 'aumlok_signature', fusionCouncil: ring === 2 ? 'optional' : 'optional' };
}

export interface GovernedWorkOrderV1 {
  schema: 'governed-work-order-v1';
  id: string;              // deterministic: sha256(goal + '\n' + sortedTargetPaths + '\n' + createdAt).slice(0,16)
  goal: string;
  requestedBy: Lane;
  source: OrderSource;
  targetPaths: string[];   // the paths this work intends to touch (advisory)
  ring: Ring;              // MOST-RESTRICTIVE (lowest) ring among targetPaths — fail-closed to 0
  authorization: RingAuthorization;
  status: WorkOrderStatus;
  evidence: string[];      // pointers: inbox lines, issue URLs, receipt hashes (append-only trail)
  createdAt: string;
  advisoryOnly: true;
  grantsAuthority: false;
  canApplyNow: false;      // HARD — a work order never applies; a worker produces a proposal that goes through the gate
}

const RING_TABLE_REL = path.join('docs', 'policy-rings', 'ring-table.json');

/** Most-restrictive (lowest) ring among the paths, from the ratified ring-table. An unclassifiable path fails
 *  CLOSED to Ring 0 (never worker-eligible). Same precedence as docs/policy-rings/check-ring-coverage.mjs:
 *  longest dir match wins; on a tie the lower ring wins; exact-file rule beats any dir rule. */
export function classifyHighestRing(targetPaths: string[], repoRoot?: string): Ring {
  if (!Array.isArray(targetPaths) || targetPaths.length === 0) return 0;
  const root = repoRoot ?? path.resolve(__dirname, '..', '..');
  let rules: Array<{ glob: string; ring: number }>;
  try {
    rules = JSON.parse(fs.readFileSync(path.join(root, RING_TABLE_REL), 'utf-8')).rules;
  } catch {
    return 0; // no table → fail closed
  }
  const ringOf = (file: string): number => {
    let best = -1;
    let ring = Number.NaN;
    for (const r of rules) {
      let s = -1;
      if (r.glob.endsWith('/**')) { const d = r.glob.slice(0, -3); if (file === d || file.startsWith(d + '/')) s = d.split('/').length * 100; }
      else if (r.glob.endsWith('/*')) { const d = r.glob.slice(0, -2); if (file.startsWith(d + '/') && !file.slice(d.length + 1).includes('/')) s = d.split('/').length * 100 + 50; }
      else if (r.glob === file) s = 1e9;
      if (s > best) { best = s; ring = r.ring; }
      else if (s === best && s >= 0) ring = Math.min(ring, r.ring);
    }
    return ring;
  };
  let lowest = 4;
  for (const f of targetPaths) {
    const r = ringOf(String(f));
    if (!Number.isFinite(r)) return 0;                // unclassifiable → fail closed to Ring 0
    lowest = Math.min(lowest, r);
  }
  return Math.max(0, Math.min(4, lowest)) as Ring;
}

export interface BuildWorkOrderInput {
  goal: string;
  requestedBy: Lane;
  targetPaths: string[];
  source?: OrderSource;      // default 'local'
  ring?: Ring;               // TEST/override — defaults to classifyHighestRing(targetPaths)
  now?: string;
  repoRoot?: string;
}

/** Build an advisory work order. Grants nothing; applies nothing. The ring is classified fail-closed. */
export function buildWorkOrder(input: BuildWorkOrderInput): GovernedWorkOrderV1 {
  const now = input.now ?? new Date().toISOString();
  const source: OrderSource = input.source ?? 'local';
  const targetPaths = [...input.targetPaths];
  const ring = input.ring ?? classifyHighestRing(targetPaths, input.repoRoot);
  const id = createHash('sha256').update(`${input.goal}\n${[...targetPaths].sort().join(',')}\n${now}`).digest('hex').slice(0, 16);
  return {
    schema: 'governed-work-order-v1',
    id, goal: input.goal, requestedBy: input.requestedBy, source, targetPaths, ring,
    authorization: ringAuthorization(ring),
    status: 'queued', evidence: [], createdAt: now,
    advisoryOnly: true, grantsAuthority: false, canApplyNow: false,
  };
}

const WORK_ORDER_KEYS: ReadonlySet<string> = new Set([
  'schema', 'id', 'goal', 'requestedBy', 'source', 'targetPaths', 'ring', 'authorization', 'status',
  'evidence', 'createdAt', 'advisoryOnly', 'grantsAuthority', 'canApplyNow',
]);

/** Fail-closed shape + invariant check for a work order. The invariants (advisoryOnly/grantsAuthority/
 *  canApplyNow, and the ring↔authorization consistency) are enforced here so a tampered order is rejected. */
export function validateWorkOrder(a: any): { valid: boolean; reason?: string } {
  if (!a || typeof a !== 'object') return { valid: false, reason: 'not an object' };
  if (a.schema !== 'governed-work-order-v1') return { valid: false, reason: 'wrong schema' };
  if (Object.keys(a).some((k) => !WORK_ORDER_KEYS.has(k))) return { valid: false, reason: 'unknown field(s)' };
  if (typeof a.goal !== 'string' || !a.goal) return { valid: false, reason: 'goal must be a non-empty string' };
  if (![0, 1, 2, 3, 4].includes(a.ring)) return { valid: false, reason: 'ring must be 0..4' };
  if (!Array.isArray(a.targetPaths) || !a.targetPaths.every((p: any) => typeof p === 'string')) return { valid: false, reason: 'targetPaths must be strings' };
  if (a.advisoryOnly !== true) return { valid: false, reason: 'advisoryOnly must be true' };
  if (a.grantsAuthority !== false) return { valid: false, reason: 'grantsAuthority must be false' };
  if (a.canApplyNow !== false) return { valid: false, reason: 'canApplyNow must be false (a work order never applies)' };
  // ring ↔ authorization must be exactly the matrix for that ring (no smuggled elevation).
  const expected = ringAuthorization(a.ring);
  if (JSON.stringify(a.authorization) !== JSON.stringify(expected)) return { valid: false, reason: 'authorization does not match the ring matrix (tampered)' };
  return { valid: true };
}

/** A work order NEVER grants authority — a mechanical guarantee mirrored across the governed surfaces. */
export function workOrderGrantsAuthority(_o: GovernedWorkOrderV1): false { return false; }
