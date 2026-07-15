// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Rehearsal-queue runner (the swarm skeleton's executable) — Round A.
 *
 * Auma's rehearse_intent seat tool queues governed work orders to ~/.aukora-symbiote/aumlok/rehearsal-queue/.
 * This CLI drains that queue THROUGH THE EXISTING WORKBENCH — it authors nothing, signs nothing, applies
 * nothing. Every rehearsal runs `run: --from-proposal <intentId>`, which the workbench takes through
 * agent → sandbox → typecheck → Fusion review → receipt and STOPS at AWAITING_OWNER_SIGNATURE. There is no
 * apply path here and none is reachable: only Peter's key applies anything, exactly as before.
 *
 * Two modes, DRY-RUN by default (landing/running this arms nothing):
 *   (default)   print the plan — which orders would rehearse, in what order, with the exact command each runs.
 *   --execute   actually run the planned rehearsals through the workbench, up to --max, printing each one's
 *               terminal state (expected: AWAITING_OWNER_SIGNATURE). Still no apply.
 *
 * Queue hygiene (--execute only): every planned order leaves the queue once handled — moved to
 * rehearsal-queue/archive/ — so a run is never repeated on the next drain. An order whose source intent
 * no longer exists (owner archived/deleted it) is refused WITHOUT running: one bounded
 * REFUSED_INTENT_MISSING evidence record lands on the same advisory surface as every other outcome.
 *
 * The PURE planning (read queue, validate orders, order + cap them) lives in core/src/rehearsalQueue.ts and
 * is unit-tested; this file is the thin side-effecting shell (fs read of the queue + workbench invocation),
 * mirroring the brain.sh/convexBackendManager split. The convex/workbench imports live ONLY here (scripts/),
 * never in the isolated-typechecked core planner.
 *
 *   bun scripts/rehearsalQueueRunner.ts                 # dry-run, show the plan
 *   bun scripts/rehearsalQueueRunner.ts --max 3         # dry-run, cap the plan at 3
 *   bun scripts/rehearsalQueueRunner.ts --execute --max 3   # run up to 3 rehearsals (still stops at signature)
 *   bun scripts/rehearsalQueueRunner.ts --ring-ceiling 3 # only rehearse Ring>=3 (lowest-risk) orders
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readRehearsalQueue, planRehearsals } from '../core/src/rehearsalQueue';
import { readProposalIntentById, validateProposalIntent, walkSupersedesChain, type ProposalIntentV1 } from '../core/src/proposalIntent';
import { deriveRehearsalTerminalStatus, isSignableRehearsalStatus } from '../core/src/rehearsalStatus';
import type { Ring } from '../core/src/governedWorkOrder';

function queueDir(): string {
  const home = process.env.AUKORA_SYMBIOTE_HOME ?? path.join(os.homedir(), '.aukora-symbiote');
  return path.join(home, 'aumlok', 'rehearsal-queue');
}

// Brick 3.2: resolve an intent for lineage-walking from pending-intents OR its archive/ — a superseded
// ancestor is usually archived, and the ladder must still count it (otherwise archiving would quietly
// reset the attempt count). Same fail-closed posture as readProposalIntentById: 64-hex ids only, full
// shape validation, null on anything less. Read-only.
function resolveIntentAnywhere(intentId: string): ProposalIntentV1 | null {
  const viaPending = readProposalIntentById(intentId);
  if (viaPending.ok) return viaPending.intent;
  if (!/^[0-9a-f]{64}$/.test(intentId)) return null;
  try {
    const p = path.join(path.dirname(queueDir()), 'pending-intents', 'archive', `${intentId}.json`);
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return validateProposalIntent(parsed).valid ? (parsed as ProposalIntentV1) : null;
  } catch { return null; }
}

/** 1-based attempt number of an intent within its supersedes-lineage (known minimum when truncated). */
function attemptOfIntent(intentId: string): number {
  const intent = resolveIntentAnywhere(intentId);
  if (!intent) return 1; // a missing queued intent is refused later on its own path — not the ladder's call
  return walkSupersedesChain(intent, resolveIntentAnywhere).attempt;
}

// Bounded advisory evidence: one small summary per executed rehearsal, written to
// ~/.aukora-symbiote/aumlok/rehearsal-results/<orderId>.json so Spatial's loop surface
// (GET /api/loop) can show "what happened". Facts only — ids, ring, status, proposal hash,
// the same capped lines the console printed. No prompts, no chain-of-thought, no secrets,
// no authority (advisoryOnly:true / grantsAuthority:false). Best-effort by design: a failed
// evidence write never fails — or blocks — the rehearsal itself.
function writeRehearsalResult(summary: Record<string, unknown>): void {
  try {
    const dir = path.join(path.dirname(queueDir()), 'rehearsal-results');
    fs.mkdirSync(dir, { recursive: true });
    const safe = String(summary.orderId ?? '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80) || `order-${Date.now()}`;
    fs.writeFileSync(path.join(dir, `${safe}.json`), JSON.stringify(summary, null, 1));
  } catch { /* advisory evidence is best-effort */ }
}

// Queue hygiene (mesh-flagged): once an order has RUN — or been refused because its intent is gone —
// its queue file moves to rehearsal-queue/archive/<file>, so the next --execute never rehearses it
// again. The planner cannot see the archive (it reads only regular *.json files directly in the queue
// dir), so archiving is invisible to planning by construction. Best-effort like the evidence write: a
// failed move never blocks or fails the run — the worst case is the order re-runs once more.
function archiveOrder(file: string): void {
  try {
    const dir = path.join(queueDir(), 'archive');
    fs.mkdirSync(dir, { recursive: true });
    fs.renameSync(path.join(queueDir(), file), path.join(dir, file));
  } catch { /* best-effort */ }
}

function parseArgs(argv: string[]): { execute: boolean; max: number; ringCeiling?: Ring } {
  const execute = argv.includes('--execute');
  const maxIdx = argv.indexOf('--max');
  const max = maxIdx >= 0 && argv[maxIdx + 1] ? Math.max(1, Math.min(50, Number(argv[maxIdx + 1]) || 0)) : 5;
  const rcIdx = argv.indexOf('--ring-ceiling');
  let ringCeiling: Ring | undefined;
  if (rcIdx >= 0 && argv[rcIdx + 1] !== undefined) {
    const n = Number(argv[rcIdx + 1]);
    if ([0, 1, 2, 3, 4].includes(n)) ringCeiling = n as Ring;
  }
  return { execute, max, ringCeiling };
}

async function main() {
  const { execute, max, ringCeiling } = parseArgs(process.argv.slice(2));
  const dir = queueDir();
  const { orders, skipped } = readRehearsalQueue(dir);
  const plan = planRehearsals(orders, { maxPerRun: max, ringCeiling, attemptOf: attemptOfIntent });

  console.log(`── rehearsal queue: ${dir} ──`);
  console.log(`  valid orders: ${orders.length} · skipped: ${skipped.length} · planned this run: ${plan.planned.length} · deferred: ${plan.deferred.length} · lineages locked: ${plan.locked.length}`);
  for (const s of skipped) console.log(`  SKIPPED ${s.file}: ${s.reason}`);
  for (const p of plan.planned) console.log(`  PLAN  order=${p.orderId} ring=${p.ring}  ${p.command}`);
  for (const d of plan.deferred) console.log(`  DEFER order=${d.order.id} ring=${d.ring} (over cap or below ring ceiling)`);
  for (const l of plan.locked) console.log(`  LOCKED order=${l.order.order.id} attempt=${l.attempt}: ${l.reason}`);

  if (!execute) {
    console.log(`\nDRY-RUN — nothing ran. Re-run with --execute to rehearse the planned orders (each stops at AWAITING_OWNER_SIGNATURE; no apply).`);
    return;
  }

  // Brick 3.2: a locked lineage ESCALATES — one receipt on the loop's evidence surface, then the order
  // leaves the queue so it never silently re-locks every run. The intent itself stays wherever it is;
  // reviving a locked lineage is the owner's move (a fresh draft with the owner in the loop).
  for (const l of plan.locked) {
    console.log(`\n⛔ lineage locked (no rehearsal ran): order ${l.order.order.id} — ${l.reason}`);
    writeRehearsalResult({
      schema: 'rehearsal-result-summary-v1',
      orderId: l.order.order.id,
      intentId: l.order.intentId,
      ring: l.order.ring,
      command: null,
      status: 'LINEAGE_LOCKED',
      proposalHash: null,
      summaryLines: [l.reason.slice(0, 400)],
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      advisoryOnly: true,
      grantsAuthority: false,
    });
    archiveOrder(l.order.file);
  }

  // --execute: run each planned rehearsal through the EXISTING workbench (stops at signature; no apply).
  const { freshWorkbenchSession, runWorkbenchCommand } = await import('../core/src/workbenchCommandLoop');
  console.log(`\n── executing ${plan.planned.length} rehearsal(s) (each stops at owner signature; nothing applies) ──`);
  const outcomes: string[] = []; // persisted status per EXECUTED rehearsal — the closing line must tell the truth
  for (const p of plan.planned) {
    console.log(`\n▶ order ${p.orderId} (ring ${p.ring}): ${p.command}`);
    const startedAt = new Date().toISOString();
    // Mesh-flagged gap: an order whose intent is gone (owner archived or deleted the pending intent)
    // can never rehearse. Refuse it HERE with one bounded evidence record — the same advisory surface
    // /api/loop and read_rehearsal_logs already read — and archive the order, instead of failing the
    // same way silently on every future run. readProposalIntentById is the existing fail-closed reader
    // (64-hex only, full shape validation), so this check can never be steered to another path.
    const intentCheck = readProposalIntentById(p.intentId);
    if (!intentCheck.ok) {
      console.log(`   ✗ refused (no rehearsal ran): ${intentCheck.reason}`);
      writeRehearsalResult({
        schema: 'rehearsal-result-summary-v1',
        orderId: p.orderId,
        intentId: p.intentId,
        ring: p.ring,
        command: p.command,
        status: 'REFUSED_INTENT_MISSING',
        proposalHash: null,
        summaryLines: [intentCheck.reason.slice(0, 400)],
        startedAt,
        finishedAt: new Date().toISOString(),
        advisoryOnly: true,
        grantsAuthority: false,
      });
      archiveOrder(p.file);
      continue;
    }
    try {
      const session = freshWorkbenchSession();
      const entries = await runWorkbenchCommand(p.command, session);
      const terminal = entries.filter((e) => /terminal state|AWAITING_OWNER_SIGNATURE|FAILED_AT|proposalHash/i.test(e.text ?? ''));
      const shown = terminal.length ? terminal : entries.slice(-3);
      for (const e of shown) console.log(`   [${e.kind}] ${(e.text ?? '').slice(0, 400)}`);
      const all = entries.map((e) => e.text ?? '').join('\n');
      // Brick 3.1 surfacing: the evidence packet's structured-failure lines are the whole point of a
      // failed rehearsal's record — pull them out as their OWN capped lines so the 400-char entry cap
      // can never bury "why it failed" mid-packet. (The packet already redacted + bounded them.)
      const evidenceLines = all.split('\n').filter((l) =>
        /^(why it failed|failing test:|assertion:|\(\+\d+ more failure|terminal state:)/.test(l.trim()));
      // Round-6 continuity truth fix: explicit FAILED_AT terminal evidence takes PRECEDENCE over the
      // flow's generic awaiting-signature wording — a failed rehearsal must never persist as signable.
      const status = deriveRehearsalTerminalStatus(all);
      outcomes.push(status);
      writeRehearsalResult({
        schema: 'rehearsal-result-summary-v1',
        orderId: p.orderId,
        intentId: p.intentId,
        ring: p.ring,
        command: p.command,
        status,
        proposalHash: all.match(/proposalHash[^0-9a-f]{0,20}([0-9a-f]{64})/i)?.[1] ?? null,
        summaryLines: [
          ...shown.slice(0, 4).map((e) => `[${e.kind}] ${(e.text ?? '').slice(0, 400)}`),
          ...evidenceLines.slice(0, 6).map((l) => l.trim().slice(0, 400)),
        ],
        startedAt,
        finishedAt: new Date().toISOString(),
        advisoryOnly: true,
        grantsAuthority: false,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`   ✗ rehearsal errored (no apply happened): ${msg}`);
      outcomes.push('errored');
      writeRehearsalResult({
        schema: 'rehearsal-result-summary-v1',
        orderId: p.orderId,
        intentId: p.intentId,
        ring: p.ring,
        command: p.command,
        status: 'errored',
        proposalHash: null,
        summaryLines: [msg.slice(0, 400)],
        startedAt,
        finishedAt: new Date().toISOString(),
        advisoryOnly: true,
        grantsAuthority: false,
      });
    }
    // Ran (or errored) — either way the outcome is on the evidence surface; the order leaves the queue.
    archiveOrder(p.file);
  }
  // Same truth-bug class as the persisted status, on the console surface: the old closing line said
  // "every rehearsal stopped at owner signature" even when every rehearsal FAILED. Count honestly.
  const awaiting = outcomes.filter(isSignableRehearsalStatus).length;
  const notSignable = outcomes.length - awaiting;
  console.log(`\nDone. ${outcomes.length} rehearsal(s) executed: ${awaiting} awaiting the owner's signature, ${notSignable} failed/errored (not signable). Nothing was applied either way — only Peter's key ever applies.`);
}

main().catch((e) => { console.error(`rehearsal runner failed: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
