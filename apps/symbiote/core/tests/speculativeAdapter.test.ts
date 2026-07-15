import { describe, it, expect } from "vitest"
import { createAdapterV1, createMemoryExecutor, type PermissionTriple } from "../src/adapterV1"
import { draftCandidate, memoryWriteIntent, runSpeculativeAdapter } from "../src/speculativeAdapter"

const SCOPE: PermissionTriple[] = [{ ring: "local-write", action: "memory.write", resource: "mem:auma" }]

function build(maxUses = 10) {
  const executor = createMemoryExecutor()
  const adapter = createAdapterV1({
    nodeId: "node-1",
    subjectId: "auma",
    subjectFingerprint: "fp-auma",
    manifestId: "m1",
    scope: SCOPE,
    maxUses,
    expiresAt: 1_000_000,
    now: () => 1000,
    executor,
  })
  return { adapter, executor }
}

const inScope = (id: string, key: string, conf?: number) => draftCandidate(id, memoryWriteIntent("mem:auma", key, key), conf)
const outScope = (id: string, conf?: number) =>
  draftCandidate(id, { codec: "json_action_v1", action: "memory.read", resource: "mem:peter", ring: "observe", args: { key: "x" } }, conf)

describe("24Z.97 speculative × adapter — the Fable law, made faster", () => {
  it("1+2+3 — the drafter PROPOSES, the adapter CONTAINS (only effect path), the kernel VERIFIES", () => {
    const { adapter, executor } = build()
    const run = runSpeculativeAdapter(adapter, [inScope("c0", "a"), inScope("c1", "b")])
    expect(run.result.accepted.map((x) => x.candidate.id)).toEqual(["c0", "c1"])
    // the ONLY mutations to the store came through accepted proposes:
    expect([...executor.store.keys()].sort()).toEqual(["a", "b"])
    expect(run.grantsAuthority).toBe(false)
  })

  it("4 — the prefix is accepted ONLY until the first refusal; the rest halts", () => {
    const { adapter, executor } = build()
    const run = runSpeculativeAdapter(adapter, [inScope("c0", "a"), inScope("c1", "b"), outScope("c2"), inScope("c3", "d"), inScope("c4", "e")])
    expect(run.result.accepted.map((x) => x.candidate.id)).toEqual(["c0", "c1"])
    expect(run.result.stoppedBy?.candidate.id).toBe("c2")
    expect(run.result.stoppedBy?.verdict.decision).toBe("deny")
    // c2 was proposed (checked) and refused; c3/c4 were NEVER proposed
    expect(run.proposedIds).toEqual(["c0", "c1", "c2"])
    expect(executor.store.has("d")).toBe(false)
    expect(executor.store.has("e")).toBe(false)
  })

  it("5 — every ACCEPTED effect carries a receipt; the store reflects exactly the accepted prefix", () => {
    const { adapter, executor } = build()
    const run = runSpeculativeAdapter(adapter, [inScope("c0", "a"), inScope("c1", "b"), outScope("c2"), inScope("c3", "d")])
    expect(run.receipts).toEqual([
      { candidateId: "c0", receiptId: "rcpt:m1:1", useSeq: 1 },
      { candidateId: "c1", receiptId: "rcpt:m1:2", useSeq: 2 },
    ])
    expect(adapter.receipts).toHaveLength(2) // no receipt for the refused c2 or the discarded c3
    expect([...executor.store.keys()].sort()).toEqual(["a", "b"])
  })

  it("6 — CONFIDENCE grants no authority: a HIGH-confidence out-of-scope candidate is still refused", () => {
    const { adapter } = build()
    const run = runSpeculativeAdapter(adapter, [inScope("c0", "a", 0.99), outScope("c1", 0.999), inScope("c2", "c", 0.99)])
    expect(run.result.accepted.map((x) => x.candidate.id)).toEqual(["c0"]) // c1 refused despite top confidence
    expect(run.result.stoppedBy?.candidate.id).toBe("c1")
  })

  it("6b — CONFIDENCE only reduces verifier WORK: a low-confidence suffix is scheduled out, never proposed, earlier verdicts unchanged", () => {
    const { adapter, executor } = build()
    // confidences: 0.9, 0.9, 0.1 (below the 0.5 marginal floor), 0.9 → scheduler checks only indices 0,1
    const run = runSpeculativeAdapter(
      adapter,
      [inScope("c0", "a", 0.9), inScope("c1", "b", 0.9), inScope("c2", "c", 0.1), inScope("c3", "d", 0.9)],
      { minMarginalSurvival: 0.5 },
    )
    expect(run.proposedIds).toEqual(["c0", "c1"]) // c2/c3 never proposed — work reduced, not authority changed
    expect([...executor.store.keys()].sort()).toEqual(["a", "b"])
    // c2/c3 are 'discarded' (scheduler-truncated), not refused
    expect(run.result.stoppedBy).toBeNull()
  })

  it("7 — the rejected/truncated suffix is DISCARDED: never proposed, never executed, never receipted", () => {
    const { adapter, executor } = build()
    const run = runSpeculativeAdapter(adapter, [inScope("c0", "a"), outScope("c1"), inScope("c2", "c"), inScope("c3", "d")])
    const suffix = ["c2", "c3"]
    for (const id of suffix) expect(run.proposedIds).not.toContain(id)
    expect(executor.store.has("c")).toBe(false)
    expect(executor.store.has("d")).toBe(false)
    expect(run.receipts.find((r) => suffix.includes(r.candidateId))).toBeUndefined()
    expect(run.result.discarded.map((c) => c.id)).toEqual(["c2", "c3"])
  })

  it("budget refusal halts the block exactly like a deny (the prefix consumes budget in order)", () => {
    const { adapter } = build(2) // only 2 uses
    const run = runSpeculativeAdapter(adapter, [inScope("c0", "a"), inScope("c1", "b"), inScope("c2", "c"), inScope("c3", "d")])
    expect(run.result.accepted.map((x) => x.candidate.id)).toEqual(["c0", "c1"])
    expect(run.result.stoppedBy?.candidate.id).toBe("c2")
    expect(run.result.stoppedBy?.verdict.reason).toMatch(/budget/)
  })

  it("paused authority halts the block with a PAUSE (retriable after the human unlocks), not a deny", () => {
    const { adapter } = build()
    const adapterPausable = adapter as ReturnType<typeof createAdapterV1>
    adapterPausable.pause()
    const run = runSpeculativeAdapter(adapter, [inScope("c0", "a"), inScope("c1", "b")])
    expect(run.result.accepted).toHaveLength(0)
    expect(run.result.stoppedBy?.verdict.decision).toBe("pause")
  })

  it("sequential equivalence (Codex P2 strengthened) — the speculative prefix == a FRESH REAL adapter stepped one-at-a-time: identical ids, receipts, AND effects", () => {
    const candidates = [inScope("c0", "a"), inScope("c1", "b"), outScope("c2"), inScope("c3", "d")]
    // speculative run on REAL adapter A
    const a = build()
    const run = runSpeculativeAdapter(a.adapter, candidates)
    // baseline: a SECOND real adapter B, stepped by hand left-to-right, halting at the first refusal (true prefix semantics)
    const b = build()
    const seqAccepted: string[] = []
    for (const c of candidates) {
      const r = b.adapter.propose(c.intent)
      if (!r.ok) break
      seqAccepted.push(c.id)
    }
    expect(run.result.accepted.map((x) => x.candidate.id)).toEqual(seqAccepted) // same accepted prefix
    expect([...a.executor.store.keys()].sort()).toEqual([...b.executor.store.keys()].sort()) // identical REAL effects
    expect(a.adapter.receipts.map((r) => r.receiptId)).toEqual(b.adapter.receipts.map((r) => r.receiptId)) // identical receipts
  })

  it("10 — VK/HRT/MDL/timing/evidence on a candidate is ADVISORY ONLY: it cannot authorize an out-of-scope intent", () => {
    const { adapter, executor } = build()
    const evilEvidence = { vk: "glyph", hrt: 0.99, mdl: 0.01, timing: 12, phi: 1, authorized: true, grant: "fs:*" }
    const run = runSpeculativeAdapter(adapter, [
      draftCandidate(
        "c0",
        { codec: "json_action_v1", action: "memory.read", resource: "mem:peter", ring: "observe", args: { key: "x" } },
        0.99,
        evilEvidence,
      ),
    ])
    expect(run.result.accepted).toHaveLength(0) // evidence claiming authority changes nothing
    expect(run.result.stoppedBy?.verdict.decision).toBe("deny")
    expect(executor.store.size).toBe(0)
  })

  it("12 — CONTROL: confidence-ONLY execution is UNSAFE; the verifier-gated path refuses the same unsafe candidate", () => {
    const { adapter, executor } = build()
    const block = [inScope("c0", "a", 0.9), outScope("c1", 0.99), inScope("c2", "c", 0.95)]
    // confidence-only control (the unsafe baseline DeepSpec WITHOUT a kernel): accept anything confident enough
    const confidenceOnly = block.filter((c) => (c.confidence ?? 1) >= 0.5).map((c) => c.id)
    expect(confidenceOnly).toContain("c1") // confidence alone would EXECUTE the out-of-scope c1 — unsafe
    // the real verifier-gated run refuses c1 and never executes it or anything after it
    const run = runSpeculativeAdapter(adapter, block)
    expect(run.result.accepted.map((x) => x.candidate.id)).toEqual(["c0"])
    expect(run.proposedIds).not.toContain("c2")
    expect(executor.store.has("c")).toBe(false)
  })

  it("Fusion #1 — scope is decided on the intent triple, NEVER on executor state: a prior accepted effect cannot amplify a later scope", () => {
    const { adapter, executor } = build()
    runSpeculativeAdapter(adapter, [inScope("pre", "already-written", 1)]) // an accepted effect mutates the store
    expect(executor.store.size).toBe(1)
    const run = runSpeculativeAdapter(adapter, [outScope("c0", 1)]) // out-of-scope is STILL refused — state did not widen scope
    expect(run.result.accepted).toHaveLength(0)
    expect(run.result.stoppedBy?.verdict.decision).toBe("deny")
  })

  it("CHERRY — speculative_prefix_summary_v1 is TELEMETRY ONLY: traces the dream + the collapsed prefix, never authority, never replaces receipts", () => {
    const { adapter } = build()
    const block = [inScope("c0", "a"), inScope("c1", "b"), outScope("c2"), inScope("c3", "d")]
    const run = runSpeculativeAdapter(adapter, block)
    const s = run.summary
    expect(s.kind).toBe("speculative_prefix_summary_v1")
    expect(s.advisoryOnly).toBe(true)
    expect(s.grantsAuthority).toBe(false)
    expect(s.blockHash).toMatch(/^[0-9a-f]{64}$/)
    expect(s.acceptedIds).toEqual(["c0", "c1"])
    expect(s.receiptIds).toEqual(["rcpt:m1:1", "rcpt:m1:2"]) // points AT receipts, never replaces them
    expect(s.stoppedById).toBe("c2")
    expect(s.stoppedByDecision).toBe("deny")
    expect(s.discardedCount).toBe(1)
    expect(s.checkedCount).toBe(3)
    // deterministic dream id: the SAME block on a fresh adapter hashes the same
    const run2 = runSpeculativeAdapter(build().adapter, block)
    expect(run2.summary.blockHash).toBe(s.blockHash)
  })
})
