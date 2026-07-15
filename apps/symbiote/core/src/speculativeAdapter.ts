/**
 * 24Z.97 — speculative prefix × adapter-v1: the DeepSpec/DSpark cognition pattern bound to the Fable adapter law.
 *
 * A cheap DRAFTER proposes an ORDERED block of candidate intents (each a Fable propose() payload, with an optional
 * confidence as a SCHEDULING hint only). The verifier drives them left-to-right through adapter.propose() — the ONLY
 * effect path — accepting + receipting the longest safe prefix and halting at the FIRST pause/deny. The rejected
 * suffix is never proposed, never executed, never receipted.
 *
 * The law is exactly §13, made faster: the model may guess MORE; it gains EXACTLY ZERO more authority. Confidence
 * can only reduce how much work the verifier is asked to do; it can never override a refusal. Verifying the prefix
 * IS committing it here (each accepted candidate's effect + receipt is produced by adapter.propose), so budget
 * (maxUses) is consumed in order — a budget refusal at item N halts the block exactly like a scope/deny refusal.
 */
import { createHash } from "crypto"
import {
  schedulePrefix,
  verifySpeculativePrefix,
  type PrefixScheduleOptions,
  type PrefixVerifier,
  type SpeculativeCandidate,
  type SpeculativePrefixResult,
} from "./speculativePrefix"
import type { AgentAdapter, Intent } from "./adapterV1"

/**
 * TELEMETRY ONLY — a public audit trace of which imagined futures were collapsed into the accepted prefix. It NEVER
 * replaces receipts and NEVER grants authority (advisoryOnly/grantsAuthority are hard-coded). The cherry: a record of
 * the dream, the prefix that became real (with its receipt ids), and the suffix that dissolved.
 */
export interface SpeculativePrefixSummary {
  kind: "speculative_prefix_summary_v1"
  advisoryOnly: true
  grantsAuthority: false
  blockHash: string
  acceptedIds: string[]
  receiptIds: string[]
  stoppedById: string | null
  stoppedByDecision: "pause" | "deny" | null
  discardedCount: number
  checkedCount: number
  scheduleReason: string
}

/** A drafted candidate: an intent to propose, with an advisory confidence + optional evidence (never authority). */
export type AdapterCandidate<TEvidence = unknown> = SpeculativeCandidate<Intent, TEvidence>

export interface AcceptedReceipt {
  candidateId: string
  receiptId: string
  useSeq: number
}

export interface SpeculativeAdapterRun<TEvidence = unknown> {
  result: SpeculativePrefixResult<Intent, TEvidence>
  /** receipts for the ACCEPTED prefix only — one per committed effect, in order. */
  receipts: AcceptedReceipt[]
  /** ids of the candidates that were proposed (= checked); the suffix beyond the halt is never proposed. */
  proposedIds: string[]
  /** TELEMETRY ONLY — the audit trace of imagined-vs-real. Never authority; never a substitute for receipts. */
  summary: SpeculativePrefixSummary
  /** the law this run upholds. */
  law: "drafter_proposes_kernel_verifies_prefix"
  grantsAuthority: false
}

/** Deterministic hash of the proposed block (the "dream") — id + intent, in order. Never includes bodies as authority. */
function blockHashOf(candidates: readonly AdapterCandidate<unknown>[]): string {
  const shape = candidates.map((c) => ({ id: c.id, intent: c.intent }))
  return createHash("sha256").update(JSON.stringify(shape)).digest("hex")
}

/**
 * Run a drafted candidate block through the adapter as a verified prefix.
 *
 * @param adapter   the Fable adapter-v1 (the only effect path; the kernel decides inside propose()).
 * @param candidates ordered drafted intents (a "speculative block").
 * @param scheduleOpts confidence-based WORK budget only (minMarginalSurvival / maxPrefixLength). Never authority.
 */
export function runSpeculativeAdapter<TEvidence = unknown>(
  adapter: AgentAdapter,
  candidates: readonly AdapterCandidate<TEvidence>[],
  scheduleOpts?: PrefixScheduleOptions,
): SpeculativeAdapterRun<TEvidence> {
  const receipts: AcceptedReceipt[] = []
  const proposedIds: string[] = []

  // The verifier IS the kernel: it commits the candidate through the one door and maps the result to a prefix verdict.
  const verifier: PrefixVerifier<Intent, TEvidence> = (candidate) => {
    proposedIds.push(candidate.id)
    const r = adapter.propose(candidate.intent)
    if (r.ok) {
      receipts.push({ candidateId: candidate.id, receiptId: r.receiptId, useSeq: r.useSeq })
      return { decision: "allow", reason: `receipt ${r.receiptId}` }
    }
    // paused → 'pause' (retriable after the human unlocks); everything else → 'deny' (terminal). Both halt the block.
    return { decision: r.refused.kind === "paused" ? "pause" : "deny", reason: `${r.refused.code} (${r.refused.kind})` }
  }

  const schedule = schedulePrefix(candidates, scheduleOpts)
  const result = verifySpeculativePrefix<Intent, TEvidence>(candidates, verifier, schedule)

  const stoppedDecision = result.stoppedBy?.verdict.decision
  const summary: SpeculativePrefixSummary = {
    kind: "speculative_prefix_summary_v1",
    advisoryOnly: true,
    grantsAuthority: false,
    blockHash: blockHashOf(candidates),
    acceptedIds: result.accepted.map((x) => x.candidate.id),
    receiptIds: receipts.map((r) => r.receiptId),
    stoppedById: result.stoppedBy?.candidate.id ?? null,
    stoppedByDecision: stoppedDecision === "pause" || stoppedDecision === "deny" ? stoppedDecision : null,
    discardedCount: result.discarded.length,
    checkedCount: result.checked.length,
    scheduleReason: schedule.reason,
  }

  return {
    result,
    receipts,
    proposedIds,
    summary,
    law: "drafter_proposes_kernel_verifies_prefix",
    grantsAuthority: false,
  }
}

/** Convenience: build a json_action_v1 intent for a memory write (the v1 demo surface). */
export function memoryWriteIntent(resource: string, key: string, value: unknown): Intent {
  return { codec: "json_action_v1", action: "memory.write", resource, ring: "local-write", args: { key, value } }
}

/** Convenience: a drafted candidate from an intent + advisory confidence. */
export function draftCandidate<TEvidence = unknown>(id: string, intent: Intent, confidence?: number, evidence?: TEvidence): AdapterCandidate<TEvidence> {
  return { id, intent, ...(confidence !== undefined ? { confidence } : {}), ...(evidence !== undefined ? { evidence } : {}) }
}
