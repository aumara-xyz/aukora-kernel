# Cohesion Invariant Rail

Manual audit rules become **standing tests** so drift fails the gate automatically — no reviewer has to
notice. Enforced by `core/tests/cohesionInvariants.test.ts` (+ the deep-freeze in `core/src/index.ts`).
Run with `bash scripts/test.sh`.

| # | Invariant | Enforced by |
|---|-----------|-------------|
| 1 | `getChain()` returns a **deeply-frozen, cloned** snapshot — verdict / normalizedIntent / provenance are immutable at every depth, and mutations cannot reach the live ledger. | `index.ts:getChain` (deepFreeze + clone) + test |
| 2 | The test-reset (`_resetChain`) is **test-only by usage**: no runtime src module calls it. | source scan |
| 3 | **One crypto chokepoint** — only the allowlisted modules import `@noble/post-quantum`; new donor ML-DSA must go through `crypto.ts`. | source scan vs allowlist |
| 4 | **Strip neutrality** — the gate (`index.ts`) imports NO registered advisory/evidence organ, so evidence can inform context but never change a verdict. | `advisoryOrganRegistry.ts` + source scan |
| 5 | **VK boundary** — VK is touched only via the single `writeVkRow` adapter, *downstream* of the verdict. | source-order scan |
| 6 | **Surface/version registry** — every registered versioned surface exists in `core/src` (code↔spec can't silently diverge). | `surfaceVersionRegistry.ts` + scan |
| 7 | **Honesty lint** — no doc/status claims live promotion, production authority root, live hive/channel/witness, or solved AUMLOK entropy; honesty anchors (LOCKED, dev-shim) must be present. | doc scan |
| 8 | **Deferred-test debt** stays mechanically fresh (non-stub), not dead mythology. | deferred-tests scan |

## Honest limitations (do not overclaim the rails)

- **#2 — NODE_ENV is not non-spoofable.** `_resetChain` is gated by `process.env.NODE_ENV !== 'test'`. Anyone
  who controls the process env could flip it, so NODE_ENV alone is **not** a hard boundary. The real
  protection is that **no runtime code path reaches `_resetChain`** (invariant #2 proves no non-test src
  module calls it). A true compile-time strip is not available in this repo's current flat-module bun/TS
  setup; #2 enforces the strongest boundary available today. When a build step or a `__testonly__` module
  boundary becomes available, tighten this.
- **#3 — allowlist has legacy exceptions.** Current `@noble/post-quantum` importers:
  `crypto.ts` (the canonical chokepoint), `convexCanonicalPin.ts`, `mldsaSandboxSigner.ts`. The latter two are
  pre-existing. **TODO:** evaluate delegating their ML-DSA calls to `crypto.ts` to shrink the allowlist to one;
  until then they are explicitly allowlisted, and the rail blocks any *new* importer.
- **#6 — this is a stop-gap.** The full `aukoraWireRegistry` (Wave 2) supersedes this with a bidirectional
  code↔spec registry. **Wave 2 acceptance test:** every versioned surface string in `core/src` is in the
  registry *and* vice-versa, and every surface's verifier fails closed on an unknown version/domain.

## Nonce / replay — what is protected today (and what is not)

- **In-session, single-use (atomic).** `evaluateIntent` consumes a PoP nonce via
  `BoundedNonceLedger.consume` — an ATOMIC check-and-add with **no separable has-then-add window**. A fresh
  nonce is accepted exactly once; a replay is refused. It is evaluated **last** (`&&`), so a request that
  fails any other auth check never burns a fresh nonce.
- **Bounded memory.** The ledger FIFO-evicts at a cap (100k) so a flood of distinct nonces cannot exhaust
  memory. Tradeoff (honest): a *very old* nonce that has been evicted becomes consumable again — this is
  bounded-memory replay protection, not infinite history.
- **NOT protected: cross-restart / cross-epoch durability.** Replay protection is **in-memory and
  epoch-bound**. A `_resetChain` or a process **restart** opens a new epoch with an EMPTY ledger — nonces from
  a prior epoch are not remembered. **Durable cross-restart replay protection is NOT built** (it needs a
  persistent nonce ledger — a Step-4 / promotion hardening). The `BoundedNonceLedger.epoch` counter makes the
  session boundary explicit and is tested directly.

*Evidence is never authority. The gate's verdict is a pure function of the normalized intent + the PoP —
nothing an advisory organ emits can change it, and the rail now proves that mechanically.*
