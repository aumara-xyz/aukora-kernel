# ONE CORE MEMORY — architecture map, receipt envelope, and shadow evidence

Round: one-core-memory (2026-07-13). Issues: #45, #244. Base: `origin/main@b973ffec`.
Branch: `fable/one-core-memory-20260713`. Status: **draft — owner review required; nothing merged.**

## 1. The verified architecture map (code, not comments)

Every claim below was verified in source on `b973ffec`. "Armed" means
`AUKORA_MEMORY_SHADOW_CAPTURE=1` + advisory capability mode (default OFF, re-checked per call).

### Writes — ONE governed client path

| surface | entry | chain | store |
|---|---|---|---|
| typed chat | `spatial/chat-serve.ts:428` (`origin: 'chat'`) | `captureCompletedTurn` (spatial/shadowCapture.ts) → `captureTurn` (core/src/conversationShadowCapture.ts) → `memoryAppend` (core/src/memoryAppend.ts) | Convex `aukora_memory` via the ONE internal mutation `aumlokMemory:aumlokMemoryWrite` (convex/aumlokMemory.ts:86), receipt on the `mem:{owner}:{key}` chain |
| Auma Live (presence lane — `spatial/chat-serve.ts:76` names it "AUMA · LIVE presence lane") | `spatial/chat-serve.ts:262` (`origin: 'presence'`) | same chain, same process | same store |
| self-mod outcomes (#244) | AUMLOK approve door → disposition journal → `projectSelfModOutcomes` (core/src/selfModOutcomeProjection.ts) via `spatial/selfModOutcomeCapture.ts` | `memoryAppend` — the same single client | same store |

`core/tests/convexReadOnlyInvariant.test.ts` pins that client `.mutation(` calls exist ONLY in
`core/src/memoryAppend.ts` across its scan set (`core/src`, `memory`, `authority`, `spatial`;
`scripts/` is outside that scan and holds the owner-run ceremonies, e.g. m4MigrateAtoms, which
themselves write through memoryAppend) and that the vendored kernel exposes zero public
registrations — acceptance "no unreceipted side write" is a standing structural law, not a new
claim.

### Reads — ONE recall router

| surface | entry | chain |
|---|---|---|
| voice reply recall | `spatial/voiceLane.ts` `kiraRecallContext` | `fuzzyRecallHits` (spatial/recallSource.ts) → `scripts/memoryRecallAdapter` → `recallMemoriesByQuery` (core/src/memoryRecall.ts): PoP-signed search + integrity-checked point reads |
| voice fallback | `spatial/voiceLane.ts` `kiraFallback` | same router |
| Auma Live recall | `spatial/presenceLane.ts` `presenceRecall` | same router |
| seat observability | `memory_peek` (spatial/voiceReadToolBridge.ts:611) | `peekRecentMemories` (core/src/memoryRecall.ts) — same kernel, read-only |

Default source is the governed Convex brain (R5b cutover); the archived Kira JSON serves only
under the explicit `AUKORA_RECALL_SOURCE=kira-json-legacy` hatch; a governed refusal serves an
honest EMPTY recall, never a silent legacy read.

**Verdict on "one engine":** chat, presence, voice recall, and self-mod outcomes already converge
on one loopback Convex deployment (`http://127.0.0.1:3210`), one owner namespace
(`mem:aumara.root`), one write client, one recall router. What was missing was not routing but
**identification** — no surface *said* which core/namespace it intended, no row carried thread
identity, and cross-thread recall was implicit and un-disableable. That is this round's brick.

### Disclosed gaps (unchanged this round)

- "Voice chat" has no separate door process: `voiceLane` serves voice replies inside the chat
  door, so its recall points are the mapped ones; the browser-side duplex audio
  (`spatial/app/aumalive.js`) is a client of the presence lane above.
- Fusion chat and the agora/arc3/drain doors touch NO governed memory on main (verified by
  grep over `fusion/`, `spatial/fusionReadingLane.ts`, `spatial/agora-serve.ts`,
  `spatial/arc3-serve.ts`, `spatial/drain-serve.ts` — zero calls into `memoryAppend`,
  `fuzzyRecallHits`, or capture). By design; routing Fusion is future work, not claimed here.
- Capture stays default-OFF behind the owner's env arm; recall is live by default.
- Whether a given running node is armed is a runtime fact (`/api/brain` capture block), not
  provable from source alone.

## 2. The core receipt stamp (`core-receipt-stamp-v1`)

`core/src/coreMemoryEnvelope.ts` — a bounded ADDITIVE block riding inside existing values
(`turn-summary-v1`, `self-mod-outcome-v1`). No new mutation, no new transport.

| mission field | carried as | note |
|---|---|---|
| core instance ID | `coreInstanceId` = `core.`+sha256(`url\|owner`)[0..12] | deterministic; two doors on one brain agree; a different deployment provably differs |
| source door/surface | `origin` (existing door-slug law) | on the enclosing value |
| thread/session ID | `thread` | `sess.<boot-utc>.<4hex>` from `spatial/coreSession.ts`; process-session granularity, honestly disclosed |
| canonical receipt ID | row key + `mem:{owner}:{key}` receipt chain | a value cannot contain its own receipt hash (cycle); the recall citation `convex:mem:{owner}:{key}` is the receipt reference |
| timestamp | `at` | |
| repository commit | `sourceCommit` | pure-fs resolve, worktree-aware; absent when unresolvable, never guessed |
| memory namespace | `namespace` = `mem:{ownerRootId}` | exactly memoryAppend's resource scope |
| provenance | `provenance` (`distilled-turn` \| `selfmod-outcome`) | writer kind vs. door |
| consent/visibility scope | `scope` (`owner-shared` default \| `thread-private`) | kernel row `visibility:"private"` (owner vs world) is untouched and authoritative |
| supersedes/erase | `supersedesKey` (advisory lineage); erasure remains the kernel's M2b stub law | |
| derived-index digest | `derivedIndexDigest` | optional; drift detection for derived caches |

Laws: drop-not-fail on every optional field; an unbuildable/oversize stamp is omitted and the
memory still writes; the reader (`readCoreReceiptStamp`) re-validates every field as untrusted
input; `advisoryOnly:true` / `grantsAuthority:false` on every stamp. **Memory grants no authority
and never overrides AUMLOK; identifying a core grants even less.**

## 3. Cross-thread awareness (explicit, receipted, disableable)

- Recall traces now cite the ROW's own identity: `… · via <door> <thread> · <age>` — a memory
  from another session is never presented as if it came from this one. Old rows read exactly as
  before (honest absence).
- Admission law (`admitRecallHit`, spatial/recallSource.ts), enforced on BOTH content-serving
  read roads — fuzzy recall (`convexRecallHits`, with a one-shot over-fetch so an exclusion
  inside the kernel top-k cannot starve a turn while admissible rows exist deeper) and
  `memory_peek` (withheld rows reported as `withheldByThreadScope`, never hidden):
  - `thread-private` rows serve ONLY their own thread — fail-closed, switch-independent; an
    unrecognized scope string a writer tried to set also collapses to thread-private (consent
    fails closed).
  - Owner switch `AUKORA_CROSS_THREAD_RECALL=0` excludes every row identifying another thread.
  - **Disclosed limits:** pre-stamp rows carry no thread identity and keep serving under the
    switch — excluding them would be a memory wipe, not a gate. Thread ids are per process boot,
    so with the switch OFF a restart hides ALL earlier stamped sessions by design — that is what
    "disable cross-thread recall" means; legacy identity-less rows still serve. The archived
    kira-json-legacy hatch predates stamps entirely (its rows carry no identities to admit on).
- Exclusions are counted per door process on `recallSourceStatus()` and logged loudly, and
  memory_peek reports its own withheld count in-band; the cross-process `/api/brain` surface
  shows the SWITCH (env-derived, valid across processes) and says where the counts live — it
  cannot see another process's counters and does not pretend to.
- **Disclosed:** the stamp's bytes ride inside the stored value, so they enter the kernel's
  full-text `search_value` index like every other envelope field (schema/model/origin already
  do); the client-side informative-term re-ranker treats stamp tokens as ordinary low-signal
  terms.

## 4. Gaussian / mesh_peek status — SHADOW / RESEARCH ONLY

Honest ground truth, unchanged by this round:

- Historical store probe (PR #249 lineage, distilled in #258): **3/4 gates PASS**
  (PASS-CLUMP FAIL-as-preregistered with post-hoc analysis); braid probe: **4/4**.
- `core/src/meshPeekCandidate.ts` (PR #262) remains **dormant in live lanes** — its only importer
  is this round's research-only `meshPeekShadow.ts`, which is itself imported by nothing live
  (structural pin in the benchmark test).
- **Nebius is NOT running live 4D Gaussian memory.** No production rows feed any Gaussian
  structure. Derived vectors/tensors/glyph indexes are caches, never authority.

This round adds `core/src/meshPeekShadow.ts` + `core/tests/meshPeekShadowBenchmark.test.ts`:
an opt-in shadow READER over synthetic receipt fixtures. Verdict of the deterministic run
(seedless — same bytes every run): shadow hit@1 **5/5** labeled queries (baseline authoritative,
all baseline ranks ≤3), contamination **0**, erase invalidation **proven** (rebuild; fail-closed
self-check), supersede lineage **crosses threads with provenance**, drift/receipt mismatch
**auto-disables**, encoder digest recorded and config-sensitive. The shadow returns metrics only;
it cannot alter any user response. Live wiring did NOT happen and is not proposed here.

Disclosed benchmark limits: the synthetic corpus declares research `subject` buckets; real
turn-summary rows carry no subject today, so live clumping would degrade to per-row handles.
Latency here is an injected-clock artifact, not a wall-clock claim.

## 5. Follow-up plan — the same benchmark in a disposable Nebius guest (NOT this round)

1. Base: a sealed bundle of the accepted green main that contains this brick (post-merge pin),
   external preflight exactly per the LOCAL_FABLE lane law (commit/tree/entry-count/fsck/
   no-remote/no-credentials/metadata-blocked).
2. Guest gets **no production credentials and no private memory** — fixtures only: the synthetic
   corpus in-tree, optionally extended by an owner-approved SANITIZED export that passes the
   release scanner (the #258 distillation precedent).
3. Run `core/tests/meshPeekShadowBenchmark.test.ts` plus a scaled variant (10k+ synthetic rows,
   latency under a real clock, stress dims per PR #268) inside the guest; seal
   `summary.json`/`report.md` + the encoder digest as evidence; destroy the guest; evidence
   returns as a branch, never a merge.
4. Any proposal to wire mesh_peek into live recall remains a separate owner-reviewed brick with
   its own issue, after this evidence.

## 6. Acceptance evidence

| # | claim | evidence |
|---|---|---|
| 1 | chat + presence + self-mod use one governed core path | `core/tests/coreReceiptStamp.test.ts` (same fake kernel sees all three through `memoryAppend`) + standing `convexReadOnlyInvariant.test.ts` |
| 2 | same core instance + namespace identified | same test: identical `coreInstanceId`/`namespace` across surfaces; different deployment ⇒ different id |
| 3 | cross-thread recall cites origin | `crossThreadRecall.test.ts` (why-trace `via <door> <thread>`) |
| 4 | recall disableable | `AUKORA_CROSS_THREAD_RECALL=0` law in `crossThreadRecall.test.ts`; switch surfaced on `/api/brain`; per-door exclusion counts on `recallSourceStatus()` + memory_peek `withheldByThreadScope` |
| 5 | erase/supersede invalidates derived | kernel M2b (existing): value scrubbed to `""`; EVERY read road (recall, search, recent, vector) excludes erased rows — "the keys filter is the wall, not the index" (convex/aumlokMemory.ts:515) — and embed backfill refuses erased rows ("a forgotten memory grows no new index", :554). The stub's stored vector is not physically unset — the wall is the filter, disclosed. Shadow tier: G-ERASE/G-SUPERSEDE rebuild-and-verify |
| 6 | no unreceipted side write | `convexReadOnlyInvariant.test.ts` (unchanged, green) |
| 7 | memory grants no authority | advisory pins on every new envelope/read; `coreReceiptStampGrantsAuthority()` et al. |
| 8–9 | no regressions; main gate green | full `scripts/test.sh` on this branch: 252/252 files, 3513/3513 tests, both typechecks, release package. NOTE for reproducers: this owner's interactive shell exports `AUKORA_VOICE_*=1`, which arms env-gated tools and fails 3 env-sensitive tests on ANY branch including pristine main — run the gate with those unset (`env -u AUKORA_VOICE_READ_TOOLS -u AUKORA_VOICE_PROPOSE -u AUKORA_VOICE_REHEARSE -u AUKORA_VOICE_READ_REHEARSAL_LOGS`) |
| 10 | Gaussian labeled shadow/research only | this document §4; module headers; structural dormancy pin |
