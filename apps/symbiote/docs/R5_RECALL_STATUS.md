# R5 — Recall Cutover Status

**STATUS 2026-07-07: CUT OVER. The governed Convex brain is the default fuzzy recall source**
(step 4 below). Sections above step 4 are the honest history of how it got here.

**Goal:** move Auma's day-to-day recall reads from the frozen `state/kira/brain.json` to the live
governed Convex brain.

## What shipped this round (read-side FOUNDATION)

`core/src/memoryRecall.ts` — the client that reads ONE migrated memory back **by exact key**, under the
owner root's proof-of-possession (`aumlokMemRecall` domain), loopback-only, custody-checked seed, typed
envelopes, graceful fallback. Hermetically tested (`core/tests/memoryRecall.test.ts`). It is the proven
read PRIMITIVE and is deliberately **not imported by any lane yet**.

## The honest blocker — why the lane cutover did NOT happen this round

The voice/presence lanes do **fuzzy multi-perceiver recall** (`kiraBrain.recall`): given the owner's turn
text, they score *all* atoms (lexical + glyph + topology) and return the top few. The Convex kernel's
`aumlokMemory:aumlokMemoryRecall` is a **keyed point read** — owner root id + one exact key, PoP-scoped
per key. The migrated `aukora_memory` table has:

- **no** `searchIndex` (no by-text search),
- **no** `vectorIndex` (no semantic search),
- **no** content-listing query (nothing returns the owner's atoms in bulk to score client-side).

So there is currently **no way to serve fuzzy recall from Convex**. Repointing the lanes today would
replace fuzzy recall with either nothing or 77 signed round-trips per turn. Neither is a cutover; both are
a regression. This is a genuine architecture fork, not a judgment call — flagged, not forced.

## R5b — steps 1–4 BUILT — THE CUTOVER LANDED 2026-07-07

1. Kernel: **BUILT** (R5b-candidate brick, 2026-07-07): a `search_value` full-text index on
   `aukora_memory` + `aumlokMemorySearch` (internal-only; owner-root PoP under the dedicated
   `aumlokMemSearch` domain, query text inside the signed preimage; ranked KEYS ONLY — content
   stays behind the integrity-checked point read; erased/quarantined/deleted rows never
   surface). **BENCHMARKED 2026-07-08** on the owner's real corpus
   (`docs/R5B_BASELINE_20260708.md`): the Convex candidate beat the Kira baseline (hit@1 100%
   vs 94%, MRR 1.000 vs 0.967; ~48 ms vs ~4 ms mean latency, well inside a voice turn). A
   vector index remains future work.
2. Client: **BUILT** (2026-07-07, this brick): `core/src/memoryRecall.ts` gained
   `searchMemoryKeys` + `recallMemoriesByQuery` (search → integrity-checked point reads;
   found:false rows skipped honestly; every refusal typed and fail-closed; core stays
   convex-free via injected signers). Edge signers in `scripts/memoryRecallAdapter.ts`
   (`buildOwnerSearchSigner`, `convexRecallByQuery`), built from the kernel's own head
   machinery. Hermetic tests: `core/tests/memoryRecallByQuery.test.ts`.
3. Lanes: **BUILT** (2026-07-07, this brick): `spatial/recallSource.ts` is the ONE router;
   voiceLane (both recall sites) and presenceLane route through it — no lane knows or decides
   where memory comes from. Built first flag-gated for review, then flipped the same day by
   step 4 (owner direction, benchmark in hand). Routing behavior proven hermetically:
   `core/tests/recallSourceRouting.test.ts`.
4. **DONE — THE CUTOVER (2026-07-07, owner-directed, ratified by merge review).** The default
   recall source is the governed CONVEX brain, on the strength of the committed verdict
   (`docs/R5B_BASELINE_20260708.md`: Convex beat the Kira baseline on the owner's real corpus).
   The archived Kira JSON brain is NEVER read by default — a governed refusal serves the turn
   with NO memory, loudly (console + `/api/brain` refusal record), because an honest empty
   recall beats a stale shadow brain. The ONLY legacy path is the exact owner-set env
   `AUKORA_RECALL_SOURCE=kira-json-legacy` — the migration hatch for nodes that have not run
   the M4 ceremony yet. The pin tests now pin THIS boundary.

**Per-node migration checklist (run once per node, then remove the hatch env):**
1. `bun scripts/captureSubjectAdapter.ts provision` — custody secrets + kernel deploy (idempotent).
2. `bun scripts/m4MigrateAtoms.ts` — genesis + byte-parity migration of the node's `brain.json`
   atoms into the governed store (resume-safe; freezes + archives the source file at the end).
3. `bun scripts/captureSubjectAdapter.ts status` — verify green, row count = live atom count.
4. Restart the node with `AUKORA_MEMORY_SHADOW_CAPTURE=1` so new conversations become governed
   rows; remove any `AUKORA_RECALL_SOURCE` env. Done: one brain, all doors.

State after cutover: **Convex = the ONE brain (canonical store of record AND the default recall
surface). Kira JSON = archived legacy (migration corpus + explicitly-labeled hatch on
un-migrated nodes; scheduled for full retirement once every node has migrated).**

## R5c — the VECTOR CONTENDER (Great Merge round 3, #178; built 2026-07-08, UNSCORED)

Semantic recall enters the same door full-text did: as a benchmark CONTENDER, nothing more.
- Kernel: optional 384-d `embedding` on `aukora_memory` + `by_owner_embedding` vector index
  (additive; embeddings are DERIVED, REBUILDABLE index data OUTSIDE the integrity chain — the
  memoryHash law is untouched, pinned by test); `aumlokMemoryVectorSearch` (action; owner-root
  PoP under the dedicated `aumlokMemVecSearch` domain, query-vector hash inside the signed
  preimage, ranked KEYS ONLY, erasure/quarantine law holds off-index — all pinned);
  `aumlokMemoryEmbedBackfill` (owner-signed under dedicated `aumlokMemEmbed`, absent-only,
  idempotent, content-untouched — pinned).
- Embedding is LOCAL-ONLY: the vendored all-MiniLM-L6-v2 daemon (`memory/embedder/`,
  zero-egress by construction). The model dir is an OWNER-PLACED artifact — a node without it
  gets typed refusals and an honest `absent` line in the benchmark, never an auto-download.
- Scoring: `scripts/r5bRecallBenchmark.ts` now scores THREE engines (kira baseline, full-text
  incumbent, vector contender) on the same corpus and queries. Per-node road: vendor the model
  → `bun memory/embedder/embedder-daemon.ts` → `bun scripts/embedBackfill.ts --state <brain.json>`
  → benchmark with `--out`.
- **The law, restated:** the vector road changes NOTHING about live recall. Ranking cutover to
  (or blending with) vectors is a separate owner-reviewed brick that lands only on a committed
  report where the contender demonstrably beats the incumbent — exactly how full-text earned
  its place.
