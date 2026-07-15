# Fusion import notes — Symbiote owns internal Fusion

**Ownership model.** Fusion lives INSIDE `aukora-symbiote` as Aukora's governed internal council organ —
**this is the source of truth**. `dashboard/fu/` is the observer window attached to that organ. Symbiote
owns the inside build: import → harden → test → commit happens here, the owner checks. An external scout
("Guardian") may extract/report, but its output is **advisory input, not authority** — never blindly
committed.

**The recursive loop (the core magic):** Fusion runs internally and reviews Aukora + itself every round →
Fusion improves Fusion (roster, retry, shard design, divergence math, UI) → Aukora hardens those
improvements (tests, receipts, advisory-only, no authority) → Fusion reviews Aukora again with the stronger
version. **Fusion can point; Aukora decides; AUMLOK authorizes.** Every step advisory, tested, receipted, governed.

## Imported (verified + committed)
- **`normShard` label normalization** (`fusionRunArtifact.ts`): `model:shard:category` → group by the REAL
  shard, not per (model×shard). Tested (`fusionRunArtifact.test.ts` #8).
- **`extractReviewJson` robustness** (`externalReview.ts`): STRING-AWARE brace matching — a `{`/`}` (or an
  escaped quote) inside a JSON string value no longer breaks extraction. **The Fusion Council flagged this
  exact brace-counting bug in a live self-review**; it caused FALSE non_votes on prose-wrapped replies. Tested
  (`extractReviewJson.test.ts` — reproduced on the old impl, green on the fix). *(Recursive loop, turn 1.)*
- **Governed roster + concurrency** (`run-council.ts` + `fusionRosterConcurrency.test.ts`): explicit 7-model
  roster (added `openai/gpt-5.5` + `mistralai/mistral-large-2512`, observed reachable); concurrency is now
  bounded + configurable (`COUNCIL_CONCURRENCY`, clamped [1,8], default 3 — never a blind 8). Guards tested:
  max in-flight ≤ the configured bound, the budget cap always wins over roster size, and unknown/unreachable
  slugs become honest `non_vote`s (never fabricated).

- **Governed adaptive retry** (`fusionRetry.ts` + `fractalFusion.retryFusionPairs` + `fusionRetry.test.ts`):
  re-runs ONLY transient contacted failures (empty_response / invalid_json / schema_mismatch / rate_limited)
  for failed model×shard pairs. Bounded by `COUNCIL_RETRY_BUDGET` (total calls ≤ `COUNCIL_BUDGET +
  COUNCIL_RETRY_BUDGET`); ONE retry per pair; no retry-until-green. NEVER fabricates a vote — a non_vote stays
  a non_vote unless a REAL valid retry response arrives; unknown-slug / auth / bad-endpoint / budget-cap are
  skipped with a reason; final quorum via `classifyVote`. Emits a fail-closed `fusion-retry-v1` advisory
  artifact (before/after quorum) to the gitignored `core/evidence/`. Live-verified (budget-3 run: lane
  executes + emits honestly, cap enforced, 0 fabricated).

- **Fusion self-review loop** (`fusionSelfReview.ts` + `fusionSelfReview.test.ts`): Fusion reads its OWN
  `fusion-run-v1` (+ optional `fusion-retry-v1` / `fusion-advisory-v1`) and produces a `fusion-self-review-v1`
  — reliability / cost / non-vote patterns / retry effectiveness / model health + a single ranked recommended
  next SAFE change + an explicit does-not-authorize statement. A **mirror, not a hand**: PURE, no model
  calls / tools / processes / memory / gate / fs / network / authority-AUMLOK imports; fail-closed; emitted
  to gitignored `core/evidence/` after validation. It notices, ranks, recommends — Aukora decides.

## Deferred (next, not yet built)
- Richer self-review over run HISTORY (trends across runs), and consuming the self-review recommendation as a
  proposal into the sandbox self-edit heartbeat (still advisory, gated, `appliedLive=false`).

## FU mirror/export — PRIVATE mirror now EXISTS
`aukora-symbiote` stays the governed **source of truth**. The private mirror **now exists**:
`https://github.com/aumara-xyz/aukora-fu` — **PRIVATE**, containing only the FU export files
(`.env.example`, `.gitignore`, `README.md`, `dashboard.html`, `package.json`, `run-council.ts` [the
self-contained standalone engine — imports no kernel], `runs/.gitkeep`, `server.ts`). It is **not public**
(patent-sensitive) and **not** the authority source. Generated `runs/*.json` stay gitignored. Any serious
improvement discovered in the FU lab returns to Symbiote **through tests/governance** — never straight to
production. Public release remains deferred.
