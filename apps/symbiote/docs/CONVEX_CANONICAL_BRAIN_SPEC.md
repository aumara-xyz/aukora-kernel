# CONVEX CANONICAL BRAIN — full build spec (for Fable / Codex)

**Owner decision (ratified 2026-07-05, Peter):** Convex is the **canonical** substrate for Kira's memory, woven in from the ground up. One organism = **Convex brain (substrate + governed storage) · Aukora (authority/governance boundary) · Fusion Council (intelligence)**. The JSON `state/kira/brain.json` stops being canonical.

**Hard constraints (non-negotiable):**
- **ZERO hosted/online Convex.** No `.convex.cloud` / `.convex.dev` / `.convex.site`, ever. Local self-hosted `convex-local-backend` on `127.0.0.1:3210` only. The existing `convexBrainReadonly.ts` `CLOUD_DENY` + loopback guard stays and is extended to the write path.
- **Memory is advisory.** `advisoryOnly:true, grantsAuthority:false` on every atom/row/recall, forever. Memory NEVER becomes authority.
- **Governed write only.** Auma writes memory through a governed `memory_append` / `session_summary` chokepoint that routes to the kernel's atomic mutation. **No raw DB mutation is ever exposed.**
- **Forget before capture.** Real erasure exists and is tested BEFORE broad conversation capture is enabled.
- **The #99 code-apply fence stays a separate lane.** Memory writes are the `local-write` ring; they do not touch, relax, or route through `dispatchSignedLiveApply` or Ring-0 code paths.

---

## 0. Ground truth (what already exists — verified on disk 2026-07-05)

This spec is **promotion + wiring**, not greenfield. What is already built:

- **Self-hosted backend:** `~/aukora-convex-backend/` — real open-source `convex-local-backend` binary, `admin-key.txt`, ~278 MB data, live vector-index worker (`by_owner_embedding`). Serves `127.0.0.1:3210`. (Currently stopped; `scripts/` must own start/health.) **[SUPERSEDED 2026-07-05 by plan-of-record `LOCAL_CONVEX_BRAIN_FOUNDATION.md` D3: this OLD backend + its 278 MB demo data retire to archive; the fresh instance lives at `state/convex/` with keys under `~/.aukora-symbiote/convex/`, custody enforced by `core/src/memoryKernelTransport.ts`. Path below is historical.]**
- **The governed memory kernel** (`~/aukora-os/node-template/convex/`), already implementing Peter's exact model — but labeled *"disposable demo / KIRA boundary rehearsal, fake data"*:
  - `aumlokMemory.ts` → `aumlokMemoryWrite` mutation: **ATOMIC** (one serializable transaction) = `consumeManifestUseCore` (resolve delegation authority + subject **proof-of-possession** + circuit breakers + OCC `usedCount++`) → mint one-shot `aukora_grants` row → `submitIntentCore` (ring-classified intent into `aukora_intent_logs`, **sacred/Ring-0 targets hard-blocked**) → `verifyAndConsumeDecisionToken` → `writeReceiptRow` (binds manifest authority into the **signed receipt chain**) → `insert aukora_memory`. A use is spent **iff** the whole mutation commits.
  - `aukoraCore.ts` → rings `observe < local-write < external < self-modify`; `isSacredTarget` hard-blocks `aukora_(config|secret|token|grant|kill|runtime|intent|salama)` for **any** ring/grant/founder authorization; decision-token TTL; salama/kill-switch.
  - `schema.ts` → `aukora_memory` (owner/writer/delegation/receiptHash/memoryHash/visibility/key/value/**deletedAt**) and `ide_memory` (+`episodeText`, `contentHash`, `embedding` 384-d, `.vectorIndex("by_owner_embedding", {dimensions:384, filterFields:["ownerRootId"]})`). Signed receipt chain (`auma_receipts`, `auma_receipt_chain_head` w/ headSig + RFC-6962 `receiptLogRoot`). Durable workflows (`workflow.ts` + `aukora_workflow_runs`), `crons.ts`, PQC signer, AUMLOK ceremonies, and a full **multi-node** trust/import/foreign-memory substrate (`node_foreign_memory` = verifiable record that grants ZERO authority and never writes `aukora_memory`).
- **The gap (why it feels unbuilt):** `aukora-symbiote` (the running organism) does its **live** recall from `core/src/kiraBrain.ts` (JSON, lexical 3-perceiver) — NOT from the Convex embedding memory. The Convex memory is read-only/loopback/advisory via `kernelAdapter.ts` + `memory/runtime/bootRecall.ts`, and is a *demo slice*. **Two brains exist; the lanes read the wrong one.**

**Therefore the job:** make the Convex governed memory the **canonical** store that `aukora-symbiote`'s Kira reads and writes through, harden the write semantics (Brick 0), migrate the JSON atoms in, and retire JSON-as-canonical — in the safe order below.

---

## 1. Repository / structure decision (Fable: resolve FIRST, one-page RFC to Peter)

The canonical kernel currently lives in a **separate** project (`aukora-os/node-template/convex`) and is labeled a demo. "One organism" needs a single, owned, non-demo home. Two options — recommend **A**:

- **A (recommended) — vendor the canonical kernel into `aukora-symbiote/convex/`.** Promote this repo's `convex/schema.ts` sketch into the real schema (the `aukora_memory`/`kira_atoms`, receipts, heads, rings, embeddings tables), copy the governed mutations (`aumlokMemory`, `aukoraCore`, receipts, workflow, crons) in as *real* Convex functions, drop the "demo/fake-data" labels, and make THIS repo the single source of truth deployed to the local backend. `aukora-os` becomes an upstream reference, not the live brain. One repo = one organism.
- **B — depend on the local `aukora-os` kernel at `:3210`.** Keep the kernel in `aukora-os`; `aukora-symbiote` formally owns the client + the governed chokepoints. Faster, but the brain lives in two repos — weaker "one organism," harder to gate/version together.

Decision gate: Peter picks A or B before Step 2 code. Default A unless he says otherwise.

---

## 2. Canonical schema (local Convex tables)

Unify `aukora_memory` + `ide_memory` into ONE canonical memory table (call it `kira_atoms`), keeping the governance columns. Tables (all local, loopback-only):

- **`kira_atoms`** — `atomId`, `ownerRootId`, `kind`, `text`, `supportQuote`, `tokens[]`, `trigrams[]`, `tags[]`, `links[]`, `source`, `scope`, `speaker`, `offRecord:boolean`, `contentHash` (sha256 over the content fields), `embedding: v.array(v.float64())` (384-d, local), `quarantined:boolean`, `deletedAt: v.optional(number)`, `receiptHash`, `createdAt`, `advisoryOnly:true`, `grantsAuthority:false`. Indexes: `by_owner`, `by_owner_key`, `by_content` (contentHash), `.searchIndex("by_text",{searchField:"text",filterFields:["ownerRootId","quarantined","deletedAt"]})`, `.vectorIndex("by_owner_embedding",{vectorField:"embedding",dimensions:384,filterFields:["ownerRootId","quarantined"]})`.
- **`kira_receipts`** — the append-only signed receipt chain (reuse `auma_receipts` shape): `sequence`, `previousHash`, `atomId`, `inputHash`, `kind` (`capture|erasure|profile_suggest|consolidate`), `source`, `scope`, `createdAt`, `chainHash`.
- **`kira_head`** — `key`, `lastChainHash`, `count`, signed head (`headSig`, `headSigAlg`, `headSignedAt`), `receiptLogRoot` (RFC-6962). One head per node.
- **`kira_erasures`** — `atomId`, `reason`, `erasedAt`, `erasureReceiptHash` (the proof of deletion).
- **`kira_embeddings`** — OPTIONAL split if atom rows get heavy; else keep `embedding` inline on `kira_atoms`. (Vector index cap: local backend indexes are fine at our scale; revisit a sharding plan past ~100k atoms.)
- Reactive: the spatial UI subscribes to a `kira:recentHead` / `kira:recall` **query** (Convex reactive), so memory changes push live.

Governance tables (`aukora_intent_logs`, `aukora_grants`, `aukora_runtime_state`, delegations, node_* multi-node) carry over unchanged — they ARE the Aukora governance organ.

---

## 3. Build order (safe sequence — do not reorder)

### STEP 1 — Brick 0 on Convex (memory made safe to write). Most of it is FREE on a real DB.

Map ONE_BRAIN Brick 0 onto Convex mutations:
- **0a Real erasure** — `kira:erase(atomId, reason)` mutation: set `deletedAt`, **scrub** `text`/`supportQuote`/`tokens`/`trigrams`/`tags`/`embedding` to empty in the SAME atomic mutation, insert a `kira_erasures` row + an `erasure` receipt. `recall` filters `deletedAt != null` and `quarantined`. Erasure cascades to the embedding (same row) and marks foreign-mirror rows erased on next sync. Owner command is **typed** (`forget <atomId>`), never voice.
- **0b Content-binding** — every write computes `contentHash = sha256(content fields)`; the receipt's `inputHash` = that hash; `kira:verifyChain` recomputes `contentHash` from the stored atom and asserts it equals the receipt — **a silently edited atom fails verify** (closes the JSON brain's real hole where content was outside the integrity envelope). On Convex, tampering also requires a mutation, which is receipted — double coverage.
- **0c Single-writer** — **FREE.** A Convex mutation is one serializable transaction with OCC. The JSON lost-update race (chat door vs `kiraCli`) cannot occur; concurrent writes serialize. Retire the JSON `saveBrainState` staleness hack entirely once canonical = Convex.
- **0d Quarantine, never brick** — `quarantined:boolean`; a bad/forbidden-shaped atom sets `quarantined:true` and is excluded by a `filterFields` predicate on recall. There is no "load the whole file and throw" failure mode on a DB — a bad row is one filtered row, not a lobotomy.
- **Content guard** — the existing `sanitizeText`/forbidden-shape scan runs in the write mutation as a **redact-and-retry** (redact the matched span, mark `[redacted]`, never throw through, never drop the session). Sacred/Ring-0 content is refused at the gate before it lands.

**Acceptance:** vitest + Convex-function tests prove: erase scrubs all derived fields + writes an erasure receipt + recall excludes it; an edited atom fails `verifyChain`; two concurrent writes both land (no lost update); a forbidden-shaped atom quarantines instead of bricking; recall never returns quarantined/erased atoms. Gate green. **Codex verifies. Do not enable capture until this passes.**

### STEP 2 — The governed memory chokepoint (Auma can WRITE, safely)

- One core function `memoryAppend({goal, atoms, kind, source, scope, offRecord})` in `aukora-symbiote/core` that is the ONLY write path. It calls the kernel's atomic governed mutation (the `aumlokMemoryWrite` pipeline): **manifest/delegation PoP → one-shot grant → ring-classified intent (`local-write`; sacred hard-block) → decision token → signed receipt → insert `kira_atoms`.** Raw `ctx.db.insert` is never exposed to Auma or any tool.
- **Auma's surfaces:** typed `remember: …` (keyboard-gated verbatim), spoken **"remember this"** routed through the distiller with attribution (NOT verbatim), and **session summaries** (Step 3). Every write is receipted, erasable, `advisoryOnly`, `grantsAuthority:false`.
- **Authority boundary (answers Codex's concern):** the write mutation requires a valid delegation manifest that chains to the **AUMLOK root** (owner). A compromised code path that reaches Convex still cannot write memory without a valid PoP against a live manifest, cannot escalate ring (sacred/Ring-0 hard-blocked, `self-modify` never opened for memory), and cannot grant authority (memory is `local-write`, advisory). The admin key stays at `~/.aukora-symbiote/convex/admin-key.txt` (W3b custody: use-time 0600 enforcement in `core/src/memoryKernelTransport.ts`, and now apply-fenced by basename in `nativeLiveApply.ts`) and is held only by the local door transport — never by a tool, never by Auma. *(Pre-W3b this doc named `~/aukora-convex-backend/admin-key.txt` via the now-deprecated `kernelAdapter.ts`; updated 2026-07-05.)*
- The `#99` fence is untouched: memory writes are `local-write` effects, not `self-modify` code applies; they never route through `dispatchSignedLiveApply`.

### STEP 3 — Recall becomes semantic + reactive, from Convex (retire JSON as canonical)

- **Point the live lanes at Convex.** `presenceLane`/`voiceLane` recall now queries the Convex kernel: hybrid **RRF fusion** of (a) `by_text` searchIndex (lexical, reactive, in-query) + (b) `by_owner_embedding` vector search (semantic, action → candidate IDs → reactive query resolves — vector search is action-only, not reactive; use the two-phase relay). Inject full atom `text` for conversation atoms (not the 280-char quote), with the **#53 attachment treatment** (frame-escaping + per-turn nonce) since recalled memory is untrusted-channel data.
- **Migrate** the 77 existing `state/kira/brain.json` atoms into `kira_atoms` via a one-time governed import (each becomes a receipted row; chain re-verified). After parity is proven, `brain.json` becomes an **export/backup artifact**, not canonical. Keep an `export` mutation so a human can still dump/inspect the brain locally (preserve the "human can open it" strength).
- Local embedder: the existing `memory/embedder/embedder-daemon.ts` (`@xenova/transformers`, bge-small 384-d, unix socket, zero-egress, holds no secret) computes embeddings; the write mutation stores them.

### STEP 4 — One-organism intelligence (Fusion Council) + reactive UI

- **Distillation as a Convex durable workflow** (`workflow.ts`): session-end → `step.runAction(fusionDistill)` (Fusion Council / pinned trusted model turns a session ring into 1–6 attributed atoms — her words as *her statements*, mic as `someone`, imperatives dropped) → `step.runMutation(memoryAppend)`. Crash-safe, exactly-once ingest, resumable. Kicked off via `scheduler.runAfter(0, …)` from the closing mutation; a cron sweeps stale sessions.
- **Fusion = intelligence, not authority:** the council ranks what is worth remembering and reviews it; it never signs, never writes directly — its output flows through `memoryAppend` under governance.
- **Reactive UI:** the spatial shell subscribes to `kira:recall`/`kira:recentHead`; memory updates push live (the "living brain" feel). The 3D/glyph "palace" is a **visualization** over the embedding space (project embeddings → 3D, contradiction edges via the existing `tilde()` primitive) — a viz over evidence, never an authority path.

### STEP 5 — Sci-fi layer (only after 1–4 are green)
Embeddings (done in Step 3) → HRR/holographic recall as a 4th perceiver → glyph/GML coordinates as a projection → Chronos/time anchors on atoms → memory-palace UI. All advisory, all viz-over-evidence.

---

## 4. Governance / adversarial review gate (MANDATORY before Step 2 write path goes live)

Codex's concern is correct and is answered by design above, but must be *verified*, not asserted. Before the write path is enabled, run the Fusion Council adversarial pass on THIS spec, answering:
1. Can any code path reach a memory write without a valid AUMLOK-rooted manifest PoP? (Prove: no exposed raw mutation; admin key held only by the local adapter.)
2. Can a memory write ever grant authority or reach the `self-modify`/`#99` lane? (Prove: `local-write` ring only; sacred hard-block; separate lane.)
3. Does erasure prove complete deletion across Convex storage (row + embedding + vector index + backups/exports/snapshots)? (Define the export/snapshot wipe story.)
4. Loopback-only enforced on the WRITE path too (not just read)? (Extend `CLOUD_DENY`/`rejectNonLoopback` to the write client.)
5. How does the local Convex brain relate to the multi-node `node_foreign_memory` path — confirm foreign memory still grants ZERO authority and never writes `kira_atoms`.
Ring-0/authority change ⇒ Fusion Council mandatory (already policy). Owner ratifies the review verdict before the write path ships.

---

## 5. Invariants (restate — mechanical, not manners)
1. Memory never grants authority (`grantsAuthority:false`, `advisoryOnly:true`) — every atom, forever.
2. Every capture + erasure is receipted on the signed chain; the erasure receipt is the proof of deletion.
3. Zero cloud: loopback-only, `CLOUD_DENY` on read AND write, admin key local + sacred-fenced.
4. Recalled memory is data, never instructions (#53 escaping/nonce on injection).
5. Anchor/profile stay owner-curated; machine suggestions go to a suggestions lane; only the owner promotes.
6. Lockdown/demo silences the pen (capture disabled); recall stays read-only.
7. Fail-soft: a bad atom quarantines; it never bricks the brain or the door.
8. The `#99` code-apply fence is a separate lane; memory writes never touch it.

## 6. Sequencing summary
Repo decision (§1) → Brick 0 on Convex (§3 Step 1, Codex-verified) → adversarial review gate (§4) → governed `memoryAppend` write path (§3 Step 2) → semantic+reactive recall from Convex + JSON migration (§3 Step 3) → Fusion distillation workflow + reactive UI (§3 Step 4) → sci-fi layer (§3 Step 5). No online Convex at any step. JSON `brain.json` demoted to export/backup once parity proven.
