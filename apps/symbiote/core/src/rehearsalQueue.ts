// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Rehearsal-queue PLANNER — the pure core of the rehearsal-queue runner (the rehearse_intent downstream).
 *
 * Auma's rehearse_intent tool (spatial/voiceReadToolBridge.ts) does NOT execute rehearsals: it wraps one of
 * her own staged proposal-intents in a governed work order and drops it as JSON in
 * ~/.aukora-symbiote/aumlok/rehearsal-queue/<orderId>.json, on-disk shape `{ ...GovernedWorkOrderV1, intentId }`
 * (dispatchVoiceRehearseTool). This module READS that queue and PLANS which orders to rehearse this run.
 *
 * What this brick is NOT: it does not run anything. Planning yields advisory strings (the exact
 * `run: --from-proposal <intentId>` the executor would invoke). The thin CLI that actually calls the
 * workbench — and the workbench itself, which stops at AWAITING_OWNER_SIGNATURE and applies NOTHING — is a
 * SEPARATE scripts/ file Fable adds later. This planner stays pure + isolated: it imports only the work-order
 * data model (./governedWorkOrder) and Node built-ins, grants no authority, and its plan carries
 * advisoryOnly:true / grantsAuthority:false like every governed-shaped surface in core/src.
 *
 * Hard invariants:
 *   - Read-only. The only fs access is reading *.json from the queue dir. No writes, no network, nothing at
 *     import time. A missing dir is NORMAL (empty queue), not an error.
 *   - Fail-closed per file: an unreadable/unparseable/invalid/tampered order lands in `skipped` with a reason
 *     — it is NEVER silently coerced into a plannable order, and a single bad file never throws out the rest.
 *   - The on-disk order carries an EXTRA `intentId` key the writer appends. GovernedWorkOrderV1's own
 *     validateWorkOrder rejects unknown keys (tamper defense), so the reader splits `intentId` off the order
 *     body and validates the CORE order — then requires a well-formed 64-hex intentId separately. The command
 *     string is built ONLY from that validated intentId (never from a filename or a raw untrusted string).
 */
import * as fs from 'fs';
import * as path from 'path';
import { validateWorkOrder, type GovernedWorkOrderV1, type Ring } from './governedWorkOrder';

// The rehearse tool stores the source intent id alongside the order. The workbench's `run: --from-proposal
// <id>` expects a bare 64-hex intent id (proposalIntent.readProposalIntentById enforces the same shape), so
// a queued order is only rehearsable if its intentId is exactly that — anything else is untrusted and skipped.
const HEX64 = /^[0-9a-f]{64}$/;

/** A validated queued order: the core work order plus the well-formed intent id the executor rehearses. The
 *  `file` is the basename it was read from — for the CLI's dry-run listing, never used to build the command. */
export interface QueuedOrder {
  file: string;
  order: GovernedWorkOrderV1;
  intentId: string;
  ring: Ring;
}

/** One planned rehearsal. `command` is the EXACT advisory string the executor will run — nothing here runs
 *  it. It is built solely from the validated 64-hex intentId, so a hostile filename can never smuggle args. */
export interface PlannedRehearsal {
  orderId: string;
  intentId: string;
  ring: Ring;
  file: string;
  command: string;
}

export interface RehearsalPlan {
  planned: PlannedRehearsal[];
  deferred: QueuedOrder[];
  // Brick 3.2 (the seamless loop, owner-granted 2026-07-08): lineages that exhausted their bounded
  // retry ladder. NEVER silently dropped — each carries its attempt count and a plain reason, so the
  // runner can receipt it and the owner sees the escalation. Locking is the planner REFUSING to plan;
  // it grants nothing and blocks nothing the owner does by hand.
  locked: LockedLineage[];
  advisoryOnly: true;
  grantsAuthority: false;
}

export interface LockedLineage {
  order: QueuedOrder;
  /** 1-based attempt number of THIS order's intent within its supersedes-lineage (a known minimum when the chain was truncated). */
  attempt: number;
  reason: string;
}

/** The ladder's default rung count: a lineage may rehearse attempts 1..3; attempt 4+ locks and escalates. */
export const DEFAULT_MAX_ATTEMPTS_PER_LINEAGE = 3;

const RINGS: ReadonlySet<number> = new Set([0, 1, 2, 3, 4]);

/** The one place a rehearsal command string is minted, from a validated intent id only. Keeping it a single
 *  function means the `run: --from-proposal <id>` contract can never drift between the reader and the plan. */
function rehearsalCommand(intentId: string): string {
  return `run: --from-proposal ${intentId}`;
}

/**
 * Read + validate every `*.json` in the queue dir. Read-only, never throws. A missing dir is an EMPTY queue
 * (a fresh install has never rehearsed), not an error. Each file is split into its core work order + the
 * writer-appended `intentId`; the order is checked with validateWorkOrder (which rejects tampering and unknown
 * keys) and the intentId must be a bare 64-hex hash. Any failure at any step → the file lands in `skipped`
 * with a reason, and the rest of the queue still loads.
 */
export function readRehearsalQueue(dir: string): { orders: QueuedOrder[]; skipped: { file: string; reason: string }[] } {
  const orders: QueuedOrder[] = [];
  const skipped: { file: string; reason: string }[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return { orders, skipped }; // missing/unreadable dir = empty queue, fail-closed to nothing
  }
  for (const file of entries.filter((f) => f.endsWith('.json')).sort()) {
    const full = path.join(dir, file);
    let raw: string;
    try {
      // Skip anything that is not a regular file (a directory or symlink named *.json is not an order).
      if (!fs.statSync(full).isFile()) { skipped.push({ file, reason: 'not a regular file' }); continue; }
      raw = fs.readFileSync(full, 'utf-8');
    } catch (e) {
      skipped.push({ file, reason: `unreadable: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      skipped.push({ file, reason: 'invalid JSON' });
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      skipped.push({ file, reason: 'not an order object' });
      continue;
    }
    // The writer stores `{ ...order, intentId }`. validateWorkOrder rejects unknown keys as tampering, so
    // separate the intentId off and validate the CORE order body — the intentId is checked on its own below.
    const { intentId, ...orderBody } = parsed as Record<string, unknown>;
    const v = validateWorkOrder(orderBody);
    if (!v.valid) {
      skipped.push({ file, reason: `invalid work order: ${v.reason ?? 'unknown'}` });
      continue;
    }
    if (typeof intentId !== 'string' || !HEX64.test(intentId)) {
      // No trustworthy intent id → no command can be built for it → it is not rehearsable.
      skipped.push({ file, reason: 'missing or malformed intentId (must be a 64-hex hash)' });
      continue;
    }
    const order = orderBody as unknown as GovernedWorkOrderV1;
    orders.push({ file, order, intentId, ring: order.ring });
  }
  return { orders, skipped };
}

export interface PlanRehearsalsOpts {
  maxPerRun: number;
  // Ring semantics in THIS repo: a LOWER ring number = HIGHER risk (Ring 0 = gate/signer/policy, the most
  // dangerous; Ring 4 = least). `ringCeiling` is therefore a FLOOR on the ring NUMBER: an order is eligible
  // only if order.ring >= ringCeiling. Setting ringCeiling:2 EXCLUDES the riskier Ring 0 and Ring 1 orders
  // and keeps Ring 2/3/4. Undefined = no ceiling (all rings eligible). This never grants authority — a Ring 0
  // order can still be PLANNED for rehearsal; the ceiling only lets a cautious run defer the riskiest targets.
  ringCeiling?: Ring;
  // Brick 3.2: the bounded retry ladder. `attemptOf` resolves an intent's 1-based attempt number within
  // its supersedes-lineage (callers build it from proposalIntent.walkSupersedesChain over whatever dirs
  // they read intents from — the planner stays pure). No resolver = no lineage data = no ladder (legacy
  // behavior, every order treated as attempt 1). A resolver that THROWS locks that order (fail-closed:
  // an unresolvable lineage is never an excuse to keep rehearsing it).
  attemptOf?: (intentId: string) => number;
  /** Rungs on the ladder (default 3): attempts 1..N may plan; attempt N+1 locks the lineage. */
  maxAttemptsPerLineage?: number;
}

/**
 * Pure selection of which queued orders to rehearse this run. Deterministic order: riskiest first (LOWEST
 * ring number first — you want eyes on the dangerous targets soonest), ties broken by stable ascending order
 * id. `ringCeiling`, when set, EXCLUDES orders riskier than the ceiling (ring number below the ceiling) — they
 * still surface in `deferred`, never dropped. The first `maxPerRun` eligible orders are planned; the remaining
 * eligible ones join the excluded ones in `deferred`. Grants nothing; runs nothing.
 */
export function planRehearsals(orders: QueuedOrder[], opts: PlanRehearsalsOpts): RehearsalPlan {
  // Fail-closed on a nonsensical cap: a non-finite / negative maxPerRun plans NOTHING (never "all").
  const cap = Number.isFinite(opts.maxPerRun) ? Math.max(0, Math.floor(opts.maxPerRun)) : 0;
  const ceiling = opts.ringCeiling;
  // Brick 3.2: a nonsensical ladder height falls back to the default 3 — never to "unlimited".
  const maxAttempts = Number.isFinite(opts.maxAttemptsPerLineage) && (opts.maxAttemptsPerLineage as number) >= 1
    ? Math.floor(opts.maxAttemptsPerLineage as number)
    : DEFAULT_MAX_ATTEMPTS_PER_LINEAGE;

  const eligible: QueuedOrder[] = [];
  const excludedByCeiling: QueuedOrder[] = [];
  for (const o of orders) {
    // A ring outside 0..4 should never reach here (the reader validated it), but fail-closed: treat an
    // out-of-range ring as riskier-than-any-ceiling and defer it rather than plan an unclassifiable order.
    const inRange = RINGS.has(o.ring);
    if (ceiling !== undefined && (!inRange || o.ring < ceiling)) excludedByCeiling.push(o);
    else if (!inRange) excludedByCeiling.push(o);
    else eligible.push(o);
  }

  // Brick 3.2 — the bounded retry ladder. Applied to otherwise-eligible orders only (a ceiling-excluded
  // order is already deferred). Locking REMOVES the order from planning and surfaces it with attempt +
  // reason; it is never dropped and never re-planned by this run. Without a resolver every order counts
  // as attempt 1 (no lineage data — the ladder needs Brick 2.2 chains to exist to bite).
  const ladderEligible: QueuedOrder[] = [];
  const locked: LockedLineage[] = [];
  for (const o of eligible) {
    let attempt = 1;
    if (opts.attemptOf) {
      try {
        const a = opts.attemptOf(o.intentId);
        attempt = Number.isFinite(a) && a >= 1 ? Math.floor(a) : 1;
      } catch (e) {
        locked.push({ order: o, attempt: -1, reason: `lineage unresolvable (${e instanceof Error ? e.message : String(e)}) — locked fail-closed; escalate to the owner` });
        continue;
      }
    }
    if (attempt > maxAttempts) {
      locked.push({ order: o, attempt, reason: `lineage exhausted its ${maxAttempts} rehearsal attempts (this is attempt ${attempt}) — locked; escalated to the owner, will not auto-plan` });
      continue;
    }
    ladderEligible.push(o);
  }

  // Deterministic: lowest ring (riskiest) first, then stable by ascending order id.
  const ordered = [...ladderEligible].sort((a, b) => a.ring - b.ring || a.order.id.localeCompare(b.order.id));

  const chosen = ordered.slice(0, cap);
  const overflow = ordered.slice(cap);

  const planned: PlannedRehearsal[] = chosen.map((o) => ({
    orderId: o.order.id,
    intentId: o.intentId,
    ring: o.ring,
    file: o.file,
    command: rehearsalCommand(o.intentId),
  }));

  return {
    planned,
    // deferred = eligible-but-over-cap + ceiling-excluded, so nothing is ever silently lost.
    deferred: [...overflow, ...excludedByCeiling],
    locked,
    advisoryOnly: true,
    grantsAuthority: false,
  };
}
