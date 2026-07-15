# Aukora Symbiote — Architecture (the boundaries)

The seed is a **thin governance membrane**, not an app. This doc names the boundaries; the
non-negotiable rules live in [SAFETY_LAWS.md](SAFETY_LAWS.md); the plan lives in
[AUKORA_SYMBIOTE_SINGULARITY_PATH.md](AUKORA_SYMBIOTE_SINGULARITY_PATH.md). One law per boundary.

```
        proposer (a model, OUTSIDE the boundary)
                 │  proposes  (json_action_v1)
                 ▼
        ┌─────────────────────────────────────┐
        │  AUTHORITY  (gate · AUMLOK · choke)  │   ← decides every effect
        └─────────────────────────────────────┘
          allow │            │ deny / pause
   ┌────────────┼────────────┬───────────────┐
   ▼            ▼            ▼               ▼
 CORE        MEMORY      RECEIVER         FUSION
 kernel      advisory    Convex (RO)      council
                 │
                 ▼
          RECEIPT LEDGER  (every effect, hash-chained)
```

## Boundaries

1. **Headless kernel.** `core/` is the law; it has no UI and never renders. A UI (later, separate)
   may *observe* but never *authorize*. SAFETY_LAWS 10.
2. **Advisory memory.** `memory/` recalls and contextualizes. Every artifact is `advisoryOnly`,
   `grantsAuthority:false`. It may suggest; it may never authorize. SAFETY_LAWS 1, 3.
3. **Kira brain.** `core/src/kiraBrain.ts` is a running local memory organ, not a placeholder:
   append-only receipts, persistent atoms, self-map ingestion, three perceivers
   (`lexical`, `glyph/trigram`, `topology`), interference scoring, and cited recall. It persists in
   `state/kira/brain.json` by default, which is gitignored. The memory chain can be mirrored into
   Convex-shaped rows by `core/src/kiraConvexMirror.ts`.
4. **Convex read-only.** The receiver reads the brain over loopback only, allowlisted queries,
   fail-closed. `receiver/kiraLoopback.ts` exposes a local Convex-style `/api/query` surface for
   `kira:getHeadPublic` and `kira:recall`; it has no `/api/mutation`. There is **no live mutation path**:
   `memory_write` is quarantined until a separately
   built + tested **signed apply lane** exists (`convexReadOnlyInvariant.test` enforces it). SAFETY_LAWS 2.
5. **Receipt = authority record.** Every self-modification emits a receipt (authority + intent +
   effect), hash-chained. No receipt, no reality. SAFETY_LAWS 7.
6. **Sandbox apply lane.** Self-edits land in a throwaway sandbox (`appliedLive=false`); green tests
   are required to promote. `core/src/sandbox*.ts`. SAFETY_LAWS 8.
7. **Rollback lane.** Snapshot/revert is always reachable; ring-0 / sacred paths refused. SAFETY_LAWS 9.
8. **Lab / eval quarantine.** Benchmark answers, traces, raw solver JSON, leaderboard data **never**
   enter live memory. Only a *signed aggregate eval receipt* (harness X on commit Y → pass/fail Z,
   artifact hash H) crosses in. `lab_only/` is gitignored.
9. **Console = observer.** `dashboard/` is builder tooling that reads the repo read-only. It is NOT the
   organism and holds NO authority.

## Adapters (propose / review only — never authorize)
Models (OpenRouter, local, Fusion Council, future orchestrators) are **adapters**. They may propose
and review. They may NOT authorize, mutate memory, write canonical receipts, or persist
chain-of-thought. A proposer must pass [PROPOSER_CONTRACT.md](PROPOSER_CONTRACT.md) before any loop use.

## Readiness has two levels (gates must not lie)
- **HEADLESS_READY** — spine assembled, gate byte-intact, headless. (`scripts/status.sh`)
- **PROMOTION_READY** — headless behavior suite green (`scripts/test.sh`), Convex-write quarantined,
  deferred-test debt acknowledged, M4 self-edit loop built. *Not yet reached.*
