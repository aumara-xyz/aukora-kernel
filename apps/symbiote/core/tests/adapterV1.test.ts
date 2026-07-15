import { describe, it, expect } from "vitest"
import {
  createAdapterV1,
  createMemoryExecutor,
  pairingLintViolation,
  type AdapterV1Config,
  type Intent,
  type PermissionTriple,
} from "../src/adapterV1"

const SCOPE: PermissionTriple[] = [{ ring: "local-write", action: "memory.write", resource: "mem:auma" }]
const write = (key: string, value: unknown): Intent => ({ codec: "json_action_v1", action: "memory.write", resource: "mem:auma", ring: "local-write", args: { key, value } })

function build(over: Partial<AdapterV1Config> = {}) {
  let t = 1_000
  const executor = createMemoryExecutor()
  const renewals: unknown[] = []
  const adapter = createAdapterV1({
    nodeId: "node-1",
    subjectId: "auma",
    subjectFingerprint: "fp-auma",
    manifestId: "m1",
    scope: SCOPE,
    maxUses: 5,
    expiresAt: 10_000,
    now: () => t,
    executor,
    onRenewalRequest: (r) => renewals.push(r),
    ...over,
  })
  return { adapter, executor, renewals, setNow: (v: number) => (t = v), getNow: () => t }
}

describe("24Z.97 adapter-v1 — the Fable contract teeth", () => {
  it("in-scope write succeeds, carries a receiptId + useSeq, and the executor really wrote", () => {
    const { adapter, executor } = build()
    const r = adapter.propose(write("a", 1))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.receiptId).toBe("rcpt:m1:1")
      expect(r.useSeq).toBe(1)
      expect(r.result).toEqual({ key: "a", written: true })
    }
    expect(executor.store.get("a")).toBe(1)
    expect(adapter.receipts).toHaveLength(1)
  })

  it("out-of-scope proposal is refused 'scope', ZERO effect, no receipt, not retriable", () => {
    const { adapter, executor } = build()
    const r = adapter.propose({ codec: "json_action_v1", action: "memory.read", resource: "mem:peter", ring: "observe", args: { key: "a" } })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.refused.kind).toBe("scope")
      expect(r.refused.code).toBe("manifest_scope")
      expect(r.refused.retriable).toBe(false)
    }
    expect(executor.store.size).toBe(0)
    expect(adapter.receipts).toHaveLength(0)
  })

  it("budget: 5 uses ok, the 6th is refused 'budget' and usedCount stays pinned (refusals never burn budget)", () => {
    const { adapter } = build({ maxUses: 5 })
    for (let i = 0; i < 5; i++) expect(adapter.propose(write(`k${i}`, i)).ok).toBe(true)
    const sixth = adapter.propose(write("k5", 5))
    expect(sixth.ok).toBe(false)
    if (!sixth.ok) expect(sixth.refused.kind).toBe("budget")
    expect(adapter.receipts).toHaveLength(5)
    // a scope refusal after exhaustion also doesn't change the count
    expect(adapter.status().remainingUses).toBe(0)
  })

  it("expiry: past expiresAt → refused 'expiry'; before notBefore → refused 'expiry'", () => {
    const { adapter, setNow } = build({ notBefore: 500, expiresAt: 2_000 })
    setNow(100)
    expect((adapter.propose(write("a", 1)) as { ok: false; refused: { kind: string } }).refused.kind).toBe("expiry")
    setNow(2_500)
    expect((adapter.propose(write("a", 1)) as { ok: false; refused: { kind: string } }).refused.kind).toBe("expiry")
  })

  it("codec + malformed are fail-closed", () => {
    const { adapter } = build()
    expect((adapter.propose({ codec: "nope" as never, action: "x", resource: "y", ring: "observe", args: {} }) as { ok: false; refused: { kind: string } }).refused.kind).toBe("codec")
    expect((adapter.propose({ codec: "json_action_v1", action: "", resource: "y", ring: "local-write", args: {} }) as { ok: false; refused: { kind: string } }).refused.kind).toBe("malformed")
  })

  it("paused: refuses 'paused' with await_user; resume restores; degraded mode keeps status()/requestRenewal()", () => {
    const { adapter, renewals } = build()
    adapter.pause()
    const r = adapter.propose(write("a", 1))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.refused.kind).toBe("paused")
      expect(r.refused.renewalHint).toBe("await_user")
    }
    expect(adapter.status().authority).toBe("paused")
    adapter.requestRenewal("please unlock") // still answers in degraded mode
    expect(renewals).toHaveLength(1)
    adapter.resume()
    expect(adapter.propose(write("a", 1)).ok).toBe(true)
  })

  it("THE THESIS — live revocation mid-conversation severs the agent, owner unaffected", () => {
    const { adapter, executor } = build()
    expect(adapter.propose(write("first", 1)).ok).toBe(true) // in-scope write succeeds
    adapter.revoke() // the human pulls authority mid-conversation
    const after = adapter.propose(write("second", 2))
    expect(after.ok).toBe(false)
    if (!after.ok) expect(after.refused.kind).toBe("revoked")
    expect(executor.store.get("first")).toBe(1) // the owner's prior write stands
    expect(executor.store.has("second")).toBe(false) // the revoked proposal changed nothing
    expect(adapter.status().authority).toBe("revoked")
  })

  it("requestRenewal SURFACES a request but never widens authority", () => {
    const { adapter, renewals } = build()
    const before = adapter.hello().manifest?.scope
    adapter.requestRenewal("more please", [{ ring: "external", action: "net.fetch", resource: "net:*" }])
    expect((renewals[0] as { reason: string }).reason).toBe("more please")
    expect(adapter.hello().manifest?.scope).toEqual(before) // scope is unchanged — no self-service widening
  })

  it("receipts are a hash chain of HASHES (never bodies)", () => {
    const { adapter } = build()
    adapter.propose(write("a", "secret-value-should-never-appear"))
    adapter.propose(write("b", 2))
    const [r0, r1] = adapter.receipts
    expect(r1.prevHash).toBe(r0.hash) // chained
    expect(r0.argsHash).toMatch(/^[0-9a-f]{64}$/) // a hash, not the body
    expect(JSON.stringify(adapter.receipts)).not.toContain("secret-value-should-never-appear") // bodies stay out
  })

  it("§7 pairing-lint refuses sensitive-read + open-egress at mint", () => {
    expect(pairingLintViolation([{ ring: "observe", action: "memory.read", resource: "cred:github" }, { ring: "external", action: "net.fetch", resource: "net:*" }])).toMatch(/pairing_lint/)
    expect(pairingLintViolation(SCOPE)).toBeNull()
    expect(() =>
      build({
        pairingLint: true,
        scope: [
          { ring: "observe", action: "memory.read", resource: "cred:github" },
          { ring: "external", action: "net.fetch", resource: "net:*" },
        ],
      }),
    ).toThrow(/pairing_lint/)
  })

  it("Codex P1 — ATOMICITY: un-serializable (circular) args are refused BEFORE any effect — no orphan effect, no consumed budget, no missing receipt", () => {
    const { adapter, executor } = build()
    const circular: Record<string, unknown> = { key: "boom" }
    circular.self = circular // JSON.stringify throws on this
    const r = adapter.propose({ codec: "json_action_v1", action: "memory.write", resource: "mem:auma", ring: "local-write", args: circular })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.refused.kind).toBe("malformed")
    expect(executor.store.size).toBe(0) // NO orphan effect (Codex's repro: store had the value)
    expect(adapter.receipts).toHaveLength(0) // NO missing receipt
    expect(adapter.status().remainingUses).toBe(5) // NO consumed budget (Codex's repro: budget dropped)
    // and a normal write still works afterwards — the refusal was clean
    expect(adapter.propose(write("ok", 1)).ok).toBe(true)
  })

  it("Auma's READ-DIRECTION — self() exposes lock + allowlist(scope) + receipts, carries NO authority, and is read-only", () => {
    const { adapter, executor } = build()
    adapter.propose(write("a", 1))
    adapter.propose(write("b", 2))
    const before = adapter.status().remainingUses
    const view = adapter.self()
    expect(view.grantsAuthority).toBe(false)
    expect(["active", "expiring"]).toContain(view.authority) // not locked → full view
    expect(view.scope).toEqual(SCOPE) // she can SEE what she may propose — no longer "proposing blind"
    expect(view.receipts?.map((r) => r.receiptId)).toEqual(["rcpt:m1:1", "rcpt:m1:2"])
    expect(view.receipts?.every((r) => r.decision === "allow")).toBe(true)
    // READ-ONLY: no budget burned, authority unchanged, proposing still works identically
    expect(adapter.status().remainingUses).toBe(before)
    expect(adapter.propose(write("c", 3)).ok).toBe(true)
    expect(executor.store.size).toBe(3)
  })

  it("self() records ITSELF — the eye is governed too (req 4), without touching the effect-receipt chain", () => {
    const { adapter } = build()
    adapter.self("lock")
    adapter.self("receipts")
    expect(adapter.introspections.map((i) => i.scope)).toEqual(["lock", "receipts"])
    expect(adapter.receipts).toHaveLength(0) // reads do NOT pollute the effect chain
  })

  it("self() never leaks bodies, and scope-filters (req 3) — 'receipts' returns metadata only, no allowlist", () => {
    const { adapter } = build()
    adapter.propose(write("a", "top-secret-body"))
    const view = adapter.self("receipts")
    expect(JSON.stringify(view)).not.toContain("top-secret-body")
    expect(view.scope).toBeUndefined() // scope-filtered to "receipts" only
    expect(view.receipts?.[0]?.resource).toBe("mem:auma") // metadata is there
  })

  it("self() surfaces pendingRenewals — her outstanding asks to Peter, never fire-and-forget, never a widening", () => {
    const { adapter } = build()
    const scopeBefore = adapter.hello().manifest?.scope
    adapter.requestRenewal("let me reach the test runner", [{ ring: "external", action: "net.fetch", resource: "net:*" }])
    adapter.requestRenewal("a second ask")
    const view = adapter.self("allowlist")
    expect(view.pendingRenewals?.map((p) => p.reason)).toEqual(["let me reach the test runner", "a second ask"])
    expect(view.pendingRenewals?.every((p) => p.status === "awaiting-peter")).toBe(true) // the adapter can't self-resolve them
    expect(adapter.hello().manifest?.scope).toEqual(scopeBefore) // requesting widened NOTHING
  })

  it("self() when paused/revoked returns ONLY the lock surface (req 2 — closes the receipt-timing channel)", () => {
    const { adapter } = build()
    adapter.propose(write("a", 1))
    adapter.pause()
    const paused = adapter.self()
    expect(paused.authority).toBe("paused")
    expect(paused.scope).toBeUndefined() // no allowlist when locked
    expect(paused.receipts).toBeUndefined() // no receipts when locked
    adapter.resume()
    adapter.revoke()
    expect(adapter.self().receipts).toBeUndefined() // severed → minimal too
  })
})
