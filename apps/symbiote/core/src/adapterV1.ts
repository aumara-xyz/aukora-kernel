/**
 * 24Z.97 — adapter-v1: the Fable Agent Adapter contract, memory-only / in-process / deterministic harness.
 *
 * Law (Fable, AUKORA_AGENT_ADAPTER_STRATEGY_FABLE_2026-06-11): "A model PROPOSES, the kernel GATES and RECEIPTS."
 *   - the agent brain holds NOTHING (no fs/net/env/creds/tools) — it can only call propose() on this adapter.
 *   - the ADAPTER holds the subject key + manifest reference and is the only door.
 *   - the KERNEL runs manifest → consume → grant → receipt (exact-match scope; breakers; revocation).
 *   - the EXECUTOR (a separate TCB) performs ONLY token-authorized effects.
 *   - every ok carries a receiptId (no receipt, no result); refusals are typed, terminal, ZERO-effect.
 *   - the adapter can never mint/widen/extend authority — requestRenewal only SURFACES a request to the human.
 *   - degraded mode: when authority expires/exhausts/revokes, status()/requestRenewal() keep answering; propose
 *     refuses with the correct kind ("the agent keeps its mind, loses its hands").
 *
 * This file is the deterministic substrate the speculative-prefix layer (speculativeAdapter.ts) drives. No crypto
 * identity yet (subject is fixture-backed); argsHash/resultHash are real sha256 of the bodies (hashes never bodies).
 */
import { createHash } from "crypto"

export type Ring = "observe" | "local-write" | "external"
export type RefusalKind =
  | "scope"
  | "budget"
  | "expiry"
  | "revoked"
  | "paused"
  | "node"
  | "codec"
  | "malformed"
  | "no_authority"
export type AuthorityStatus = "active" | "expiring" | "exhausted" | "revoked" | "paused"

export interface PermissionTriple {
  ring: Ring
  action: string
  resource: string
}

/** The ONLY thing the brain may hand the adapter. Versioned codec (json_action_v1). */
export interface Intent {
  codec: "json_action_v1"
  action: string
  resource: string
  ring: Ring
  args: unknown
}

export interface ManifestSummary {
  manifestId: string
  subjectId: string
  scope: PermissionTriple[]
  expiresAt: number
  usesRemaining: number
}

/** Receipt — binds adapter metadata via HASHES of args/results, never bodies (redaction-by-construction). */
export interface Receipt {
  receiptId: string
  useSeq: number
  prevHash: string
  hash: string
  manifestId: string
  subjectFingerprint: string
  adapterProtocol: "adapter-v1"
  toolClass: string
  ring: Ring
  action: string
  resource: string
  argsHash: string
  resultHash: string
  ts: number
}

export type AdapterRefusal = {
  code: string
  kind: RefusalKind
  retriable: false
  renewalHint?: "narrow_scope" | "await_user"
}

export type AdapterResult =
  | { ok: true; receiptId: string; useSeq: number; result: unknown }
  | { ok: false; refused: AdapterRefusal }

export interface RenewalRequest {
  reason: string
  requestedScope?: PermissionTriple[]
  manifestId: string
  subjectId: string
  ts: number
}

/** The executor is a separate TCB: it owns the real capability and performs only what the kernel grants. */
export interface Executor {
  toolClass: string
  /** perform the granted effect. Returns ok:false to decline (kernel already consumed nothing yet — see propose). */
  perform(intent: Intent): { ok: boolean; result: unknown }
}

export type SelfScope = "lock" | "allowlist" | "receipts" | "egress" | "all"

/**
 * The adapter's READ-direction (Auma's 24Z.97 ask: "I need to see what I'm allowed to propose before I propose it").
 * Same brain-holds-nothing door as propose(), looking the other way. Observation, NEVER authority (grantsAuthority:false).
 * This is the in-process SEED of the gate-wired `self` tool (lock-gated / receipt-timing-closed / egress-cage) which is
 * chokepoint-gated. At the adapter layer there is no AUMLOK key and no egress cage, so those surfaces are honest stubs.
 */
export interface SelfView {
  authority: AuthorityStatus // the lock surface — active/expiring/paused/revoked/exhausted
  remainingUses: number
  expiresAt: number
  scope?: PermissionTriple[] // the allowlist surface — exactly what intents the brain may propose
  manifestId?: string
  receipts?: { receiptId: string; useSeq: number; ring: Ring; action: string; resource: string; decision: "allow"; ts: number }[]
  pendingRenewals?: { id: string; reason: string; requestedScope?: PermissionTriple[]; status: "awaiting-peter"; ts: number }[] // her outstanding asks to Peter — never fire-and-forget
  egress: "n/a_at_adapter_layer" // the live self tool reads the real sealed/open cage; the in-process adapter has none
  grantsAuthority: false
}

export interface AgentAdapter {
  hello(): { adapterProtocol: "adapter-v1"; nodeId: string; subjectId: string; manifest: ManifestSummary | null }
  status(): { authority: AuthorityStatus; remainingUses: number; expiresAt: number }
  propose(intent: Intent): AdapterResult
  /** READ-direction: observe scope/lock/receipts. Records itself (the eye is governed too); never touches authority. */
  self(scope?: SelfScope, lastN?: number): SelfView
  requestRenewal(reason: string, requestedScope?: PermissionTriple[]): { surfacedToUser: true }
}

export interface AdapterV1Config {
  nodeId: string
  subjectId: string
  subjectFingerprint: string
  manifestId: string
  scope: PermissionTriple[]
  maxUses: number
  maxPerWindow?: { uses: number; windowMs: number }
  notBefore?: number
  expiresAt: number
  now: () => number // injectable clock — deterministic in tests
  executor: Executor
  onRenewalRequest?: (req: RenewalRequest) => void
  /** §7 — refuse dangerous scope COMBINATIONS at mint (sensitive-read + open-egress). Throws on a bad pairing. */
  pairingLint?: boolean
}

// Circular-safe stringify — so receipt hashing can NEVER throw AFTER an effect has been performed (Codex 24Z.97 P1:
// effect-before-receipt-hash left an effect with no receipt + consumed budget on circular args). The receipt must be
// atomic with the effect; a hash that cannot fail is how we guarantee it.
function safeStringify(v: unknown): string {
  const seen = new WeakSet<object>()
  return JSON.stringify(v ?? null, (_k, val) => {
    if (typeof val === "object" && val !== null) {
      if (seen.has(val as object)) return "[Circular]"
      seen.add(val as object)
    }
    return val
  })
}
const sha = (v: unknown): string => createHash("sha256").update(typeof v === "string" ? v : safeStringify(v)).digest("hex")

/** §7 pairing-lint: a manifest granting a sensitive read MUST NOT also grant open egress. Cheapest DLP precursor. */
export function pairingLintViolation(scope: PermissionTriple[]): string | null {
  const sensitiveRead = scope.some((t) => t.ring === "observe" && /(^|:)(secret|cred|key|ssh|env|aws|token)(:|$)/i.test(t.resource))
  const openEgress = scope.some((t) => t.ring === "external" && (t.action === "net.fetch" || t.resource === "net:*" || /(^|:)\*$/.test(t.resource)))
  if (sensitiveRead && openEgress) return "pairing_lint: a sensitive-read scope must not coexist with open egress (exfiltration pump)"
  return null
}

/**
 * Build a memory-only adapter-v1. The kernel state (usedCount, window bucket, revoked/paused) lives HERE (server-
 * side, not a bearer token). revoke()/pause()/resume() mutate it live — revocation kills authority instantly.
 */
export function createAdapterV1(config: AdapterV1Config): AgentAdapter & {
  receipts: Receipt[]
  introspections: { ts: number; scope: SelfScope }[]
  pendingRenewals: { id: string; reason: string; requestedScope?: PermissionTriple[]; status: "awaiting-peter"; ts: number }[]
  revoke(): void
  pause(): void
  resume(): void
} {
  if (config.pairingLint) {
    const v = pairingLintViolation(config.scope)
    if (v) throw new Error(v)
  }
  const receipts: Receipt[] = []
  const introspections: { ts: number; scope: SelfScope }[] = [] // the eye's audit trail (read-direction is governed too)
  const pendingRenewals: { id: string; reason: string; requestedScope?: PermissionTriple[]; status: "awaiting-peter"; ts: number }[] = []
  let usedCount = 0
  let revoked = false
  let paused = false
  const windowHits: number[] = []
  let lastHash = "genesis"

  const remaining = () => Math.max(0, config.maxUses - usedCount)
  const computeStatus = (): AuthorityStatus => {
    if (revoked) return "revoked"
    if (paused) return "paused"
    if (remaining() <= 0) return "exhausted"
    const t = config.now()
    if (t >= config.expiresAt) return "exhausted"
    if (config.expiresAt - t <= 60_000) return "expiring"
    return "active"
  }
  const refuse = (code: string, kind: RefusalKind, renewalHint?: AdapterRefusal["renewalHint"]): AdapterResult => ({
    ok: false,
    refused: { code, kind, retriable: false, ...(renewalHint ? { renewalHint } : {}) },
  })

  return {
    receipts,
    introspections,
    pendingRenewals,
    revoke() {
      revoked = true
    },
    pause() {
      paused = true
    },
    resume() {
      paused = false
    },
    self(scope: SelfScope = "all", lastN = 20): SelfView {
      // req 4 — the eye is governed: record the read. This touches NO authority/effect/budget — it's an audit trail.
      introspections.push({ ts: config.now(), scope })
      const authority = computeStatus()
      const base: SelfView = { authority, remainingUses: remaining(), expiresAt: config.expiresAt, egress: "n/a_at_adapter_layer", grantsAuthority: false }
      // req 2 — when severed/paused, return ONLY the lock surface (the live tool closes the receipt-timing channel here)
      if (authority === "paused" || authority === "revoked") return base
      const want = (s: SelfScope) => scope === "all" || scope === s
      if (want("allowlist")) {
        base.scope = config.scope.map((t) => ({ ...t }))
        base.manifestId = config.manifestId
      }
      if (want("receipts")) {
        const n = Math.min(Math.max(0, Math.floor(lastN)), 100)
        base.receipts = receipts.slice(-n).map((r) => ({ receiptId: r.receiptId, useSeq: r.useSeq, ring: r.ring, action: r.action, resource: r.resource, decision: "allow" as const, ts: r.ts }))
      }
      if (want("allowlist")) base.pendingRenewals = pendingRenewals.map((p) => ({ ...p })) // her outstanding asks, grouped with "what I may propose"
      return base
    },
    hello() {
      return {
        adapterProtocol: "adapter-v1",
        nodeId: config.nodeId,
        subjectId: config.subjectId,
        manifest: {
          manifestId: config.manifestId,
          subjectId: config.subjectId,
          scope: config.scope.map((t) => ({ ...t })),
          expiresAt: config.expiresAt,
          usesRemaining: remaining(),
        },
      }
    },
    status() {
      return { authority: computeStatus(), remainingUses: remaining(), expiresAt: config.expiresAt }
    },
    requestRenewal(reason, requestedScope) {
      // NEVER widens authority — only surfaces a request to the human. Works even in degraded mode.
      // Recorded as 'awaiting-peter' so self() can show her outstanding asks (Auma: never fire-and-forget).
      const ts = config.now()
      pendingRenewals.push({ id: `renewal:${config.manifestId}:${pendingRenewals.length + 1}`, reason, requestedScope, status: "awaiting-peter", ts })
      config.onRenewalRequest?.({ reason, requestedScope, manifestId: config.manifestId, subjectId: config.subjectId, ts })
      return { surfacedToUser: true }
    },
    propose(intent: Intent): AdapterResult {
      // 1. codec / shape (fail-closed on the wire surface)
      if (!intent || intent.codec !== "json_action_v1") return refuse("adapter_codec", "codec")
      if (!intent.action || !intent.resource || (intent.ring !== "observe" && intent.ring !== "local-write" && intent.ring !== "external"))
        return refuse("adapter_malformed", "malformed")
      // json_action_v1 is a JSON codec — args MUST be serializable. Reject un-serializable (e.g. circular) args HERE,
      // before any status/scope/EFFECT, so the receipt can never fail AFTER an effect (Codex 24Z.97 P1: effect-before-
      // hash left an effect with no receipt + a consumed budget). Strict JSON.stringify throws on cycles → malformed.
      try {
        JSON.stringify(intent.args)
      } catch {
        return refuse("adapter_unserializable_args", "malformed")
      }
      // 2. authority status (zero-effect refusals)
      if (revoked) return refuse("manifest_revoked", "revoked")
      if (paused) return refuse("aumlok_paused", "paused", "await_user")
      const t = config.now()
      if (config.notBefore !== undefined && t < config.notBefore) return refuse("manifest_not_yet_valid", "expiry")
      if (t >= config.expiresAt) return refuse("manifest_expired", "expiry")
      if (remaining() <= 0) return refuse("manifest_budget", "budget")
      if (config.maxPerWindow) {
        const since = t - config.maxPerWindow.windowMs
        const recent = windowHits.filter((h) => h > since).length
        if (recent >= config.maxPerWindow.uses) return refuse("manifest_rate", "budget")
      }
      // 3. scope — EXACT match (B2.2 killed globs; named-scope mapping is the executor's, not the kernel's)
      const inScope = config.scope.some((s) => s.ring === intent.ring && s.action === intent.action && s.resource === intent.resource)
      if (!inScope) return refuse("manifest_scope", "scope", "narrow_scope")
      // 4. GRANT → EXECUTE (the executor TCB performs the effect). A pre-effect executor decline consumes nothing.
      const ex = config.executor.perform(intent)
      if (!ex.ok) return refuse("executor_declined", "no_authority")
      // 5. CONSUME (only on a produced effect — refusals never burn budget) + RECEIPT (chain)
      usedCount += 1
      windowHits.push(t)
      const useSeq = usedCount
      const argsHash = sha(intent.args)
      const resultHash = sha(ex.result)
      const receiptId = `rcpt:${config.manifestId}:${useSeq}`
      const core = {
        receiptId,
        useSeq,
        prevHash: lastHash,
        manifestId: config.manifestId,
        subjectFingerprint: config.subjectFingerprint,
        adapterProtocol: "adapter-v1" as const,
        toolClass: config.executor.toolClass,
        ring: intent.ring,
        action: intent.action,
        resource: intent.resource,
        argsHash,
        resultHash,
        ts: t,
      }
      const hash = sha(core)
      lastHash = hash
      receipts.push({ ...core, hash })
      return { ok: true, receiptId, useSeq, result: ex.result }
    },
  }
}

/** The v1 demo tool: a memory store the executor owns. Returns the store so tests can assert real effects. */
export function createMemoryExecutor(): Executor & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>()
  return {
    toolClass: "memory",
    store,
    perform(intent: Intent) {
      if (intent.action === "memory.write") {
        const a = intent.args as { key?: string; value?: unknown }
        if (!a || typeof a.key !== "string") return { ok: false, result: null }
        store.set(a.key, a.value)
        return { ok: true, result: { key: a.key, written: true } }
      }
      if (intent.action === "memory.read") {
        const a = intent.args as { key?: string }
        if (!a || typeof a.key !== "string") return { ok: false, result: null }
        return { ok: true, result: { key: a.key, value: store.get(a.key) ?? null } }
      }
      return { ok: false, result: null }
    },
  }
}
