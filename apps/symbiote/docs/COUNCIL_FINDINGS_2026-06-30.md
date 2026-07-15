# Fusion Council — Live Audit Findings (2026-06-30)

First real multi-model run via `core/run-council.ts` (OpenRouter). Council: `claude-opus-4.8`, `glm-5.2`,
`deepseek-v4-pro`, `qwen3.7-max` (voted) + `kimi-k2.7-code` (adapter failed — `invalid_json`/`schema_mismatch`,
never reached the provider). Budget 25, 5 safety shards.

**Verdict: `RED_QUORUM`** — green 5 · yellow 15 · red 3 · non-votes 2. (Quorum is fail-safe: a few RED votes
on a shard trip it.) Shards: authority_gate_receipts **RED**, opencode_womb_prompt **RED**,
vk_chronos_parked_safety **RED**, memory_burn_sleep YELLOW, fusion_ops_reliability YELLOW.

> **What this means (honest):** the council audited the EXISTING kernel chokepoint (`index.ts`, `crypto.ts`,
> receipts) — NOT the M4/proprioception/savepoint round. The RED is "the authority root has real hardening
> gaps before it is promotion-grade" — which is exactly what we already say (HEADLESS_READY, AUMLOK dev-shim,
> NOT promotion-ready). This is the concrete punch-list for the road to promotion. None of it changes the
> headless posture; all of it is pre-promotion work.

## Confirmed findings (current disposition after hardening rounds)

| # | Finding | Verified | Where | Brick |
|---|---------|----------|-------|-------|
| 1 | `getChain()` returns the **live mutable** `globalReceipts` array — external code can tamper the receipt chain. Return `Object.freeze([...])` or a deep copy. | ✅ resolved — frozen snapshot + regression tests | `core/src/index.ts:getChain`, `core/tests/gateHardening.test.ts` | receipt-immutability |
| 2 | `__AUKORA_TEST_SENTINEL__` is checked in the **production path** — a test global gating prod logic is a bypass surface. Strip via DI / compile-time, not a runtime global. | ✅ resolved — sentinel removed + source guard | `core/src/index.ts:_resetChain`, `core/tests/gateHardening.test.ts` | strip-test-sentinel |
| 3 | `NonceLedger` (+ `globalReceipts`) grow **unbounded** — only `clear()` on reset, no TTL/LRU eviction or cap → memory-exhaustion DoS. | ✅ resolved for nonce ledger — `BoundedNonceLedger`; audit-log cap deferred by design | `core/src/boundedNonceLedger.ts`, `core/src/index.ts` | ledger-eviction |
| 4 | Receipt.id / PoP.argsHash should bind to the **full canonical normalized intent + a monotonic sequence number**, not just `{action,resource,ring}` (anti-replay/collision). | ✅ resolved (#4a) — receipt now binds PoP provenance (principalFingerprint/methodId/argsHash/nonceHash) + monotonic `seq` + `version`; tamper-evident; hashes/fingerprints only (no secret leak); legacy v0 receipts still verify | `core/src/crypto.ts`, `core/src/index.ts`, `core/tests/receiptProvenance.test.ts` | receipt-binding ✅ |
| 5 | Race/atomicity: global-state mutation in `evaluateIntent` + `signedHead` assignment should be atomic with Merkle-root computation. (Node is single-threaded, but **async interleaving** across `await` points can still corrupt.) | ✅ tested invariant while `evaluateIntent` stays synchronous; serialized append required if it ever becomes async | `core/src/index.ts`, `core/tests/receiptBinding.test.ts` | concurrency-review |
| 6 | Memory enforcement (YELLOW): reject/hash-namespace caller-supplied `explicitId` (prevent hypothesis overwrite), clamp confidence to `[0,10]`, wire `SleepSkillGateSignal`. | ✅ resolved — explicitId collision rejected; clamp/no-authority/sleep hard-gate tested | `core/src/hypothesisMemory.ts`, `core/src/sleepSkill.ts`, `core/tests/memoryEnforcement.test.ts` | memory-enforcement |

## ✅ Resolved this round (#1–#3)
- **#1** — `getChain()` now returns `Object.freeze([...globalReceipts])` (immutable snapshot). `index.ts:getChain`.
- **#2** — the runtime-global sentinel escape is **removed**; `_resetChain` is gated by `NODE_ENV` only. `index.ts:_resetChain`.
- **#3** — `NonceLedger` is now a **`BoundedNonceLedger`** (FIFO cap, `core/src/boundedNonceLedger.ts`) — memory bounded.
- Regression tests: `core/tests/gateHardening.test.ts` (frozen chain + no-bypass + source guards + real golden→refused replay) and `core/tests/boundedNonceLedger.test.ts`. Gate GREEN (82 files / 1106 tests). `index.ts` is not in the gate byte-pin, so no re-pin needed (pin still VERIFIED). Deferred `fusionActionItems.test.ts` FAI-001 updated to the hardened posture.
## ✅ Round 2 (#4–#6) — evidence-first

**#5 atomicity → TESTED INVARIANT.** `evaluateIntent` and its crypto deps are fully synchronous (no
async/await/Promise) → single-threaded JS cannot interleave → the append (push → Merkle → signedHead,
`index.ts:54-60`) is atomic by construction. `core/tests/receiptBinding.test.ts` proves N synchronous appends
yield one ordered, fully-verifiable chain, and that `evaluateIntent` returns a value (not a Promise). **No
serialized-append primitive is needed now; it becomes REQUIRED only if `evaluateIntent` is ever made async.**

**#6 memory enforcement → TESTED INVARIANTS.**
- ✅ `explicitId` overwrite **FIXED** — `createHypothesis` rejects a colliding caller-supplied id
  (`hypothesisMemory.ts`), so accumulated verified evidence can't be erased. (`memoryEnforcement.test.ts`)
- ✅ confidence clamp `[0,10]` — already proven (`hypothesisMemory.test.ts` "Confidence stays bounded 0..10").
- ✅ memory has no authority surface (no `evaluateIntent`/`executeDecision`/`signPoP`/`promote`) and the gate
  does **not** import memory organs.
- ✅ sleepSkill: `advisoryOnly/grantsAuthority/applyEligible` are fixed literals; the hard-gate **throws** on a
  secret or authority-leakage scan failure; quarantined labels (refused/unsafe/contradicted/stale) never
  produce positive instructions. `SleepSkillGateSignal` is a status REPORT, consumed as authority nowhere.

**#4 receipt/PoP binding → PARTIAL (decision fully bound; auth-provenance NOT — exact blocker list).**
- ✅ PROVEN tamper-evident (`receiptBinding.test.ts`): the receipt binds the **complete normalized intent**
  (normalization strips every extra field — `normalizer.ts:67-69` — so `{action,resource,ring}` IS the whole
  intent), the verdict, the prevHash chain link, the receipt id, the Merkle root, and the ML-DSA signed head.
  Tampering ANY of these fails verification.
- ✅ **#4a RESOLVED (round 3)** — the receipt now records `provenance: { principalFingerprint, methodId,
  argsHash, nonceHash }` for every golden_success (null for refused), built in `index.ts` from the verified
  PoP and **bound into the receipt id** via a versioned preimage (`crypto.ts:hashReceiptPreimage`). Because
  the id feeds the next `prevHash`, tampering any provenance field breaks the whole chain. **No secret leak:**
  fingerprints/hashes only — the raw nonce and signature are never stored (`receiptProvenance.test.ts` asserts
  the raw nonce is absent and `nonceHash === hash(nonce)`).
- ✅ **#4b RESOLVED** — a monotonic `seq` (chain index) is recorded and bound into the id; tampering it breaks
  verifyChain. Ordering remains additionally enforced by the prevHash chain + Merkle root.
- ✅ **Migration / rollback-compatible** — `Receipt` fields are optional and the v0 preimage is unchanged, so
  legacy v0 receipts still verify; new receipts are `version:1`. Proven in `receiptProvenance.test.ts`.
- `globalReceipts` cap still deferred (it is the audit log — capping it is a separate, careful design).

**Net: #4a, #4b, #5, #6 are tested invariants. #4 receipt binding now covers BOTH the decision AND the
authorization-provenance, tamper-evident and secret-safe. Remaining Step-4 work is the AUMLOK production
authority *root* (Ed25519 → ML-DSA) — separate from receipt binding.**

## How these map to the roadmap
- **#1, #2, #3** are resolved and regression-tested. `index.ts` is not in the current 7-file gate byte-pin;
  the pin still verifies.
- **#4** remains the cryptographic auth-provenance schema/preimage change → **AUMLOK Step-4**.
- **#5** is stable while the append path remains synchronous; if it ever becomes async, a serialized append
  primitive becomes required before promotion.
- **#6** is resolved and regression-tested in the memory/sleep law surface.

## Plumbing to fix (council's own reliability — `fusion_ops_reliability` shard)
- `kimi-k2.7-code` adapter fails before contacting the provider (`invalid_json` / `schema_mismatch`). Either
  the slug is wrong on OpenRouter or the request/response schema doesn't match. 4-model quorum held without it.

*The council reviews; it grants no authority (advisory_only=true). These findings are a worklist, not a gate.*
