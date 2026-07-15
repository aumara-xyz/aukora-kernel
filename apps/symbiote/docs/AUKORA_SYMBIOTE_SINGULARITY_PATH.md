# Aukora Symbiote — Singularity Path

**This is the one scope doc.** It replaces the five scattered plan docs (see "Retired docs" at the
bottom). If a change isn't on this path, it doesn't go in. No drift.

---

## North star
The smallest complete, **headless** core that can safely **understand, edit, test, remember, roll
back, and report on itself**. It is a thin **governance membrane**, not an app: a model *proposes*
an effect, a human key *authorizes* the write-capable ones, a *receipt* records it. Body (harness)
and organs (tools) are swappable. The membrane and its laws stay constant. UI comes later.

A proposal-intent (such as issue #35) is only advisory authorship: chat or voice may draft the
intent, but the governed workbench re-reads the real files from disk to build the actual proposal
artifact, and only an owner AUMLOK signature can turn it into a live change.

The laws are non-negotiable and live in [SAFETY_LAWS.md](SAFETY_LAWS.md). This doc is the *plan*;
that doc is the *constitution*.

---

## Where we are (2026-07-01)
`SPINE_IN · M1✅ M3✅ M4✅ · HEADLESS_READY · private savepoint pushed`
- Kernel extracted — `core/src` **typechecks clean (0 errors)**; headless suite **104 files · 1335 tests · 0 fail**.
- **Fusion self-optimization v0 — now SAFELY WIRED (not dark)** — `core/src/fusionSelfOpt.ts` + `fusionAdvisoryArtifact.ts` (advisory, grants no authority): **budget-aware scheduling** (`resolveBudgetSchedule` spreads ≤budget calls across shards; live `run-council.ts` honors `maxScheduled` — unscheduled calls are NOT run, never fake rate_cap), typed **attention items** (incl. an `other_adapter_failure` catch-all so no failure class stays invisible), **retry/supersede packs** (only failed pairs), and a **terminal review** (safe-as-evidence gate) — all now EMITTED by the live council into a versioned **`fusion-advisory-v1`** artifact (`core/evidence/fusion-advisory-v1.json`), written only after a **fail-closed POSITIVE-allow-list validator** (`validateFusionAdvisoryArtifact` — rejects unknown keys, authority-shaped keys, and secret/PoP/signature/private-key fields+values at ANY depth, reusing `forbiddenContent.ts`; the prior denylist accepted `signature`/`pop`/`gate_unlocked` — closed). **Negative containment proof** (`core/tests/advisoryContainment.test.ts`): a forged authority/secret artifact cannot validate; the gate imports no advisory module, takes only `(rawIntent, pop)`, and refuses every write-capable action regardless of advisory state; and no consumer wires the artifact into a signer/unlock/promote/memory sink. Verified live (budget-3 run emitted a valid artifact). Quorum reused from `fusionConfig` (adapter → non_vote → NO_QUORUM, never RED).
- **Observer/sandbox lanes PINNED (P5 defense-in-depth)** — the rehearsal/observer edges are now mechanically locked so they cannot quietly grow powers. `/first-contact` (`core/tests/firstContactConsole.test.ts`): exactly 7 AUMLOK fields; no canvas; no RAW audio/video capture (`getUserMedia`/`MediaRecorder`/`AudioContext`/`RTCPeerConnection`); no network/egress (`fetch`/`WebSocket`/`XMLHttpRequest`/`EventSource`/`sendBeacon`); no client persistence; no signer/approve/promote/authorize/unlock path; `signature required` + `promotion off` visible; never claims it is "unlocked". **Observer voice + orb ADDED (P5.1):** a resonant-orb presence + browser-local voice — `SpeechRecognition` in / `speechSynthesis` out — where the **mic starts ONLY on an explicit click** (never in the background), the transcript is display-only + never stored, and the voice path reaches **no network, no authority, no tool, no memory** (she hears and answers; she cannot act). AUMLOK is honestly reported as **not tethered**: active mode is the `sha256` dev-shim (`aumlokApprovalRoot.ts` `local_stub`), `isLivePromotionUnlocked()` returns literal `false` (`aumlokAuthorityRoot.ts:206`), and no UI/serve route can sign/promote/unlock. **First Contact V0 is VERIFIED in-browser** (Trinity 3-pane shell, orb presence, 7-field AUMLOK ceremony, honest "Locked rehearsal / still locked" wording, mic not auto-started, zero page console errors). **No more dead-end shell (P6):** the right-menu now really switches center-pane MODES — `AUMLOK` / `Contact` / `Receipts` / `Memory` / `Organs` / `ARC` — as a pure client-side view toggle (no network, no server route). After "Boundary formed — authority remains locked," the page shows an explicit "Enter Contact →" next action plus a one-line clarifier ("This forms the local rehearsal boundary. It does not unlock live authority.") instead of leaving the visitor stuck; editing the fields again retracts the CTA until the next successful form. `Receipts`/`Memory`/`Organs`/`ARC` are honest, clearly-labeled "observer placeholder / not wired" panels — no faked functionality. The left-pane thread list is now honestly labeled "local placeholders — not live session history." Pinned by `core/tests/firstContactConsole.test.ts` (P6). **Presence pass (P7):** Contact mode's presence anchor is now the real AUMARA sigil (`dashboard/assets/aumara-icon.png`, served loopback-only from `dashboard/serve.ts` — never the source iCloud path) with distinct idle/listening/speaking animation states (the "speaking" state is driven by the real `speechSynthesis` utterance `onstart`/`onend` lifecycle, not a guess). Voice output auto-prefers a better local system voice (macOS Enhanced/Premium, or well-known smoother built-ins like Samantha/Victoria/Ava/Zoe) over the browser's raw default, with an honest note about which voice is active and an optional in-memory (never persisted) voice picker — still 100% local `speechSynthesis`, no cloud/provider TTS. Her acknowledgement line now rotates through a small honest set instead of repeating one canned sentence, never claiming consciousness, memory, or authority. AUMLOK's locked state reads as ceremony, not failure ("This is the rehearsal threshold," "Authority remains locked," "A signed AUMLOK receipt is required before it can ever move") — still never says "unlocked." Pinned by `core/tests/firstContactConsole.test.ts` (P7) and `core/tests/consoleServeAssets.test.ts` (a real spawned-server, real-HTTP proof that the icon route serves an actual PNG over loopback and 404s on any other asset path). **Simplified to two real rooms (P8):** the owner correctly called out that a 6-item right-menu reads as a fake tri-pane command post when four of the six sections are placeholders. The primary experience is now ONLY `AUMLOK` and `Contact` — `Organs`/`Receipts`/`Memory`/`ARC` still exist (nothing deleted) but live under a visibly secondary "Diagnostics — later" area with smaller, muted buttons. The left-pane thread list dropped its five fake session IDs/timestamps entirely and now shows exactly two example room-launchers ("AUMLOK rehearsal," "First Contact") that are REAL navigation — clicking or keyboard-activating either one calls the same `setMode()` the menu uses, not a decorative dead click. The eventual rich tri-pane command post is still the long-term goal (a powered shell over the sealed kernel — UI can get rich/messy/beautiful later, but every real effect still goes through gate/receipt/AUMLOK); it just isn't faked into existing before it's real. Pinned by `core/tests/firstContactConsole.test.ts` (P8). **Nap-round polish (P9):** AUMLOK's "Boundary formed" now gets a one-time success animation (never a loop, resets on re-edit, never claims live authority); "Enter Contact" is now visually the obvious reward (distinct accent styling) instead of a muted secondary button; a permanent one-line clarifier separates the UI boundary rehearsal from the real terminal AUMLOK cryptographic ceremony. Contact's presence anchor is bigger and layered (halo + ring + icon), the transcript renders as real conversation rows (speaker label + message, still `textContent`-only, still bounded/never persisted), and the typed fallback is now intentionally framed (labeled "Type instead," boxed) rather than a bare input. **Organs graduated from placeholder to ONE real, read-only status panel** — `scripts/status.sh`'s own output, embedded server-side by `dashboard/serve.ts` at page-load time (reusing the existing `status()`/`esc()` helpers already used by the Builder Console's own `/api/status` route) — **zero new client-side network calls**; Receipts/Memory/ARC remain honest, unwired placeholders. Proven end-to-end with a real spawned server (`core/tests/consoleServeAssets.test.ts`): the placeholder token is fully replaced by real status text, with no secret material riding along. A new owner-facing guide, [AUMLOK_OWNER_CEREMONY.md](AUMLOK_OWNER_CEREMONY.md), explains the three distinct things (UI boundary rehearsal vs. terminal cryptographic rehearsal vs. live promotion — still not built), exactly what `keygen`/`sign`/`rehearse` do, where the private key lives, and explicitly declines to build a double-click wrapper for the real ceremony (deliberately — key generation deserves a terminal, not a convenience click). Pinned by `core/tests/firstContactConsole.test.ts` (P9). **Real-time duplex voice (LiveKit / Pipecat / WebRTC) remains FUTURE + default-off** — not built. **Signed AUMLOK promotion rehearsal is now BUILT** (terminal-first, not UI): `scripts/aumlok-authority.sh {keygen|sign|verify|rehearse}` — the human generates/holds an Ed25519 key (gitignored home, `0600`, never the repo; `keygen` refuses to overwrite an existing key), signs a promotion authorization for a proposal/draft hash, and `rehearse` verifies it against the pinned public root and writes a durable, hash-chained `aumlok-rehearsal-receipt-v1` (`core/src/aumlokAuthorityRoot.ts` — `buildRehearsalReceipt`/`validateRehearsalReceipt`) recording the verifier's own result, a tamper-evident `receiptHash`, and chain position (`seq`/`prevReceiptHash`). `promotionExecuted`/`rehearsalOnly` are literal-typed (`false`/`true`) so no input — forged or otherwise — can flip them; a bad/forged receipt still produces a receipt (a record of a **failed** verification), never a crash and never an executed promotion. Proven end-to-end against the REAL script (`core/tests/aumlokAuthorityCli.test.ts`) plus pure-function coverage (`core/tests/aumlokRehearsalReceipt.test.ts`) and a reachability guard (`seedRootContract.test.ts` #9: no UI/server/voice surface can call the signer or the rehearsal builder). This is the first real "the owner's key is linked to the organism" brick — the organism can verify and record, but **still cannot execute**. It is a deliberate governed ceremony, never sneaked into a UI round. **Exact-envelope hardening (no shadow fields):** every Fusion artifact validator (`fusionRunArtifact.ts`/`fusionRetry.ts`/`fusionSelfReview.ts`, matching `fusionAdvisoryArtifact.ts`'s existing discipline) and every AUMLOK schema (`PromotionAuthorization`/`SignedPromotionReceipt`/`KeyLifecycleEvent`/`SignedKeyLifecycleReceipt`/`AuthorityRootManifest`/`AumlokRehearsalReceiptV1` incl. nested `verifierResult`/`chain`) now rejects any unknown top-level or nested key before anything else is checked — a signed/receipted envelope must be EXACT, since the canonical-hash functions only ever commit known fields and an unknown extra field would otherwise ride along unsigned. The heartbeat lane (`core/tests/heartbeatLaneBoundary.test.ts`): `runSelfEditHeartbeat` is behaviorally sandbox-only (`appliedLive=false` · `liveRepoTouched=false` · `convexWritten=false` · `memoryAuthorityUsed=false` · `promotionReady=false` · `grantsAuthority=false`), `scripts/heartbeat.sh` carries no live-apply/promote/signer/network, and `dashboard/serve.ts` now binds **loopback only** (`127.0.0.1` — Bun's default was the all-interfaces `0.0.0.0`) so `/api/heartbeat` (which spawns the script) is not network-reachable.
- **Seed-root / path contract PINNED (M2 serve/path preflight)** — the seed runs from its OWN root with no donor-repo (`aukora-os`/`aukora-trinity`/`aukora-mega-mind`/`aukora-kernel`) or external-OpenCode-shell runtime dependency. Every launcher self-roots from its own location (`BASH_SOURCE` / `import.meta.url`; no hardcoded `/Users` paths, relocatable); mutable state lives OUTSIDE the repo under one explicit env-overridable path `${AUKORA_SYMBIOTE_HOME:-$HOME/.aukora-symbiote}`; both local servers (`dashboard/serve.ts` :7070 + `website/serve.ts` :7080) bind **loopback only** (`127.0.0.1` — no all-interface bind until a signed/network lane exists); the console serve lane spawns ONLY allowlisted seed scripts (`status.sh`/`heartbeat.sh`) and carries no signer/unlock/promote/authorize. **Update (2026-07-02, issue #23):** `self_edit/opencode/` (the donor tool-mechanics fork this line originally described) has since been archived to branch `archive/self_edit-opencode-fork` and deleted from main — it was never a real runtime dependency. Documented in [SEED_ROOT_CONTRACT.md](SEED_ROOT_CONTRACT.md), pinned by `core/tests/seedRootContract.test.ts` (drift fails the gate). Preflight under **M2 'serve UP'** — still no promotion, no network lane. **Kernel-purity guard** (`seedRootContract.test.ts` #7): no HTTP server / Bun runtime may live under `core/src` (servers belong in `dashboard/`/`website/`), so loose runtime code can't break the pure-kernel tsc gate — drift fails the gate.
- **Aukora FU — Fusion Under-the-Hood observer lane** (`dashboard/fu/`, advisory / **evidence-only**): a local, loopback-only (`127.0.0.1:9900`) observer room that *visualizes* Fusion Council / perceiver state (consensus banner, per-model votes, KL-divergence matrix, resonator visualizer). A **window, not a lever** — NOT a kernel organ, imports nothing from `core/src`, and never signs / unlocks / promotes / authorizes / writes memory / affects a gate verdict. Pinned observer-only by `seedRootContract.test.ts` #8 (drift fails the gate). Self-contained (`dashboard/fu/` + README + package.json), **destined to be extracted into its own public GitHub repo as a gift** (`git subtree split --prefix=dashboard/fu`). **Now a LIVE read-only observer:** the council writes a versioned **`fusion-run-v1`** artifact (`core/src/fusionRunArtifact.ts`) — per-(model×shard) grid, DERIVED confidence distributions, a real symmetric Jensen–Shannon divergence matrix (non-vote rows/cols = N/A, contrarian derived from divergence only), per-shard consensus — validated fail-closed (reuses `forbiddenContent.ts`; model-derived text is secret-scrubbed) before `run-council.ts` writes it to the gitignored `dashboard/fu/runs/`. The FU server reads it read-only (`/api/runs`, `/api/run/latest`, `/api/run/:id`, SSE `/api/stream`), binds `127.0.0.1`, writes nothing, runs no tool, guards path traversal. Non-votes stay non-votes (never a fake RED). Shard labels are normalized (`normShard`: `model:shard:category` → the real shard, so per-shard consensus is one row per shard, not N fake 100% rows). Pinned by `core/tests/fusionRunArtifact.test.ts` + `seedRootContract.test.ts` #8. **Fusion is Aukora's governed INTERNAL council organ (SOURCE OF TRUTH) — Symbiote owns the inside build; an external scout is advisory only, never blindly committed** ([FUSION_IMPORT_NOTES.md](FUSION_IMPORT_NOTES.md)). **The recursive loop is live:** Fusion reviews Aukora + itself → Fusion improves Fusion → Aukora hardens it (tested/receipted/advisory) → Fusion re-reviews. Turn 1: the council flagged the `extractReviewJson` brace-counting bug in a live self-review; Aukora hardened it (string-aware matching, no more false non_votes — `extractReviewJson.test.ts`). Governed tuning: explicit 7-model roster + bounded/configurable concurrency (`COUNCIL_CONCURRENCY` [1,8]), guarded by `fusionRosterConcurrency.test.ts` (max in-flight ≤ bound · budget cap wins · unknown slug → non_vote). **A private `aukora-fu` mirror/export may exist later** (not the source of truth, not public — patent-sensitive); export prep done, repo creation is owner-triggered. **Turn 2 — governed adaptive retry** (`core/src/fusionRetry.ts` + `fusionRetry.test.ts`): re-runs ONLY transient contacted failures (empty_response/invalid_json/schema_mismatch/rate_limited) for failed model×shard pairs, bounded by `COUNCIL_RETRY_BUDGET` (total ≤ `COUNCIL_BUDGET + COUNCIL_RETRY_BUDGET`), one retry per pair, no retry-until-green. NEVER fabricates a vote (a non_vote stays non_vote unless a REAL valid retry arrives); unknown slug / auth / bad-endpoint are skipped; final quorum via `classifyVote`. Emits a fail-closed `fusion-retry-v1` advisory artifact (before/after quorum). `retryFusionPairs` (fractalFusion) re-runs only the capped pairs. **Turn 3 — Fusion self-review loop** (`core/src/fusionSelfReview.ts` + `fusionSelfReview.test.ts`): Fusion inspects its OWN artifacts (`fusion-run-v1` + optional `fusion-retry-v1`/`fusion-advisory-v1`) and produces a `fusion-self-review-v1` — reliability / cost / non-vote patterns / retry effectiveness / model health + a single ranked *recommended next safe change* + an explicit does-not-authorize statement. A **mirror, not a hand**: PURE (no model calls, tools, processes, memory, gate, fs/network, or authority/AUMLOK imports); fail-closed; emitted to gitignored `core/evidence/` after validation. **The private `aumara-xyz/aukora-fu` mirror now EXISTS** (PRIVATE, contains only the FU export files incl. the standalone engine) — not public, not the source of truth; `aukora-symbiote` stays the governed source of truth and any serious FU improvement returns here through tests/governance.
- **Nonce/replay hardened** — `evaluateIntent` consumes a PoP nonce via `BoundedNonceLedger.consume` (ATOMIC check-and-add, no has-then-add window; evaluated last so a failed auth never burns a fresh nonce). Bounded memory (100k FIFO). **Honest limitation:** replay protection is **in-memory + epoch-bound** — a reset/restart starts a new epoch with an empty ledger; durable cross-restart replay protection is **NOT built** (Step-4). Receipts still bind PoP provenance + monotonic seq; `verifyChain` green. ([COHESION_INVARIANTS.md](COHESION_INVARIANTS.md) "Nonce / replay")
- **Auma Perceiver (evidence-only sensor) BUILT + tested** — `core/src/latentPerceiver.ts`: a latent-disagreement sensor (KL-divergence "pinch" **proxy** over swarm GREEN/YELLOW/RED distributions). Inputs validated + **fail-closed** (malformed → quarantined conflict; a low pinch is never "safe"). Output is `advisoryOnly`/`evidenceOnly`/`grantsAuthority=false`; registered in `advisoryOrganRegistry`; the gate imports it **not at all** (strip-neutral — proven). Optional **inhibitory** hook in active inference: an evidence-only safety brake that can BLOCK a golden execution on conflict, never cause one — and a blocked step is recorded as `executionStatus: inhibited` with `inhibitedBy: perceiver_conflict`, kept SEPARATE from the gate verdict (*never logged as an executed success*). A conflict becomes a **draft-only** sandbox repair (`appliedLive=false`). It is a *sense organ, not a power* — not a swarm compiler, not live self-repair, not hive intelligence, not autonomous promotion.
- **Cohesion invariant rail** — manual audit rules are now standing tests (`core/tests/cohesionInvariants.test.ts`, [COHESION_INVARIANTS.md](COHESION_INVARIANTS.md)): deep-frozen receipt snapshots, test-reset boundary, one-crypto-chokepoint guard, evidence strip-neutrality (gate imports no advisory organ), VK single-adapter boundary, surface/version code↔spec guard, honesty-lint (overclaim drift fails the gate), deferred-debt freshness. **Drift now fails tests automatically.**
- **Donor capability port — Wave 1 (crypto foundation) DONE** — domain-separated ML-DSA-65 signer discipline ported PURE from the sibling kernel into the existing `core/src/crypto.ts` chokepoint: `PQC_DOMAINS` registry, `pqcSignWithDomain`/`pqcVerifyWithDomain`, seeded-keygen fail-closed, unknown-domain refusal, **domain non-lifting** proven (`core/tests/pqcDomainSigner.test.ts`). No second crypto core; no networked surface wired.
- Authority in place — gate (byte-pin **verified**), AUMLOK (*active* mode = honest `sha256` dev-shim), chokepoint.
- **Ed25519 dev-real authority root BUILT + tested + HARDENED** — organism verifier (`core/src/aumlokAuthorityRoot.ts`) is **split** from the human-side signer (`core/src/aumlokSigner.ts`) so the organism structurally cannot sign; input validation (fail-closed), a durable pinned-root **manifest** with integrity hash, **signed revoke/rotate** lifecycle receipts, **full receipt-envelope validation** (schema/mode/flags/algorithm — no half-valid receipts), and a **verify-then-apply** path (`applyVerifiedLifecycleToRoot`; the raw apply is private). Human holds the private key (gitignored home, never the repo); the organism verifies with the public key only. Terminal: `scripts/aumlok-authority.sh`. **Live promotion still LOCKED** (`isLivePromotionUnlocked()=false`). **Signed promotion rehearsal BUILT** — `rehearse` verifies + writes a hash-chained `aumlok-rehearsal-receipt-v1` (`promotionExecuted:false`, `rehearsalOnly:true`, tamper-evident); proven end-to-end against the real CLI script, not just unit-tested in isolation.
- **M4 self-edit heartbeat BUILT** — propose → gate → sandbox apply (`appliedLive=false`) → test → receipt →
  rollback, watchable (`scripts/heartbeat.sh` + console `🫀 Heartbeat` tab). Sandbox-only; **live + authority promotion LOCKED**.
- **Self-modification readiness ladder BUILT** (`core/src/selfModReadiness.ts` + `scripts/self-mod-readiness.sh`, advisory, grants no authority): a **fail-closed, honest** report of exactly what stands between *she can REHEARSE changing herself in a padded room* (built) and *she can change her REAL body after a human signature* (**NOT** built). Ground truth today → verdict **`READY_FOR_SIGNED_PROMOTION_REHEARSAL`**: all rehearsal rungs proven (sandbox heartbeat · tested apply · receipt · sandbox rollback · AUMLOK `sha256` dev-shim active · Ed25519 verifier built) with `appliedLive=false`; and **all 5 production rungs still remain** (Ed25519 live-authorizing · promotion-grade rollback · HSM/production custody · ML-DSA production root · wired live promotion). It **structurally cannot** report `PROMOTION_READY` while those are absent, and an `appliedLive=true` breach forces `NOT_READY` (`core/tests/selfModReadiness.test.ts` — proof it cannot overclaim).
- **Promotion-grade rollback CONTRACT defined** (`core/src/promotionRollback.ts`, roadmap step 4): read-only `captureSnapshot` (content-hash manifest, no mutation) + **DRY-RUN** `planRestore` (diffs what a restore WOULD change, applies nothing). `PROMOTION_ROLLBACK_STATUS` = `{contractDefined:true, restoreProven:false, liveApplyWired:false}` — the readiness ladder reads it, so the muscle can't be silently claimed done. **No live apply wired**; restore must be mechanically proven before live promotion can ever exist (`core/tests/promotionRollback.test.ts`).
- **Proprioception started** — `core/src/proprioceptionSnapshot.ts` read-only body-sense. **Vision NOT wired** — contract only ([VISION_CONTRACT.md](VISION_CONTRACT.md)). Added Biometric Bridge & Wearable integration spec, plus the present-day Non-Biometric Multi-Signal Fusion spec under Sovereign Compute.
- **Fusion Council runnable** — real multi-model swarm via OpenRouter (`core/run-council.ts`, `scripts`-driven); advisory, grants no authority.
- **Private GitHub savepoint** — `aumara-xyz/aukora-symbiote` (clean root `23c6463`; history scrubbed of PII; full local
  history on branch `dev-history-local`). `scripts/status.sh` → **HEADLESS_READY** (NOT promotion-ready). `verify-public-readiness.sh` → **TIER-1 clean**.
- **Native recursive IDE tool membrane v1 BUILT (2026-07-01)** — the first task path that runs through
  Aukora's OWN tool-call dispatcher instead of an external agent editing files directly: a fixed 10-tool
  contract (`core/src/ideToolContract.ts`) + one chokepoint dispatcher (`core/src/nativeIdeDispatcher.ts`,
  reusing `sandboxApply.ts`/`sandboxApplyPermit.ts`/`kernelActionClassifier.ts`/`changeRiskClassifier.ts`/
  `rootOrganismRegistry.ts` — no second sandbox system) + a `recursive-ide-rehearsal-receipt-v1` schema +
  a workbench demo (`scripts/recursive-workbench.sh`) that runs
  status→self_map→list_files→read_file→search→propose_patch→sandbox_apply→run_tests→write_receipt→rollback_sandbox
  end-to-end, sandbox-only, with a live-repo-untouched proof. Honesty note: the code in this round was still
  written externally — the milestone is that ONE demo task now flows through Aukora's own dispatcher, not
  that she edited herself. See [BUILT_STATE.md](BUILT_STATE.md) for the full built/not-built line.
- **Native workbench + signed live apply BUILT (2026-07-01, same day)** — a two-pane localhost UI
  (`dashboard/workbench.html`, chat left / honest AUMLOK panel right) whose chat commands run through
  the round-1 dispatcher; a real bounded test runner (`core/src/sandboxTestRunner.ts` — typecheck /
  targeted test / full suite, isolated temp-repo copies); and — the first live-write capability in this
  project — a signed per-proposal live-apply lane (`core/src/nativeLiveApply.ts`): a proposal can only
  land on the live repo and commit if its content re-hashes to match a real AUMLOK signature, that
  signature verifies against the pinned root, its proposalHash has never been applied before (a durable
  replay ledger), and every file clears the same sacred-path/symlink guard the sandbox uses. Fusion
  Council reviews (never authorizes) each proposal before signing
  (`core/src/selfEditReviewCouncil.ts`), verified live against real OpenRouter models. Two rounds of
  adversarial review (design, then code) preceded this; the second found and fixed a real crash bug.
  `isLivePromotionUnlocked()` stays untouched, still `false` — no blanket unlock, only a narrower
  per-proposal one. See [BUILT_STATE.md](BUILT_STATE.md) for the full built/not-built line.

---

## The path (milestones, in order)

| # | Milestone | State | What "done" means |
|---|-----------|-------|-------------------|
| **M1** | `status → READY` | ✅ **done** | spine present, gate byte-intact, headless |
| **M2** | `serve UP` | ▢ next | signer + zero-egress embedder + self-edit mechanics live on loopback; the gate fires |
| **M3** | tests GREEN (headless) | ✅ **done** | headless suite: 104 files · 1335 tests · 0 fail · tsc 0 errors. Host-integration tests deferred (see brick 1). |
| **M4** | self-edit loop **visible** | ✅ **done** | propose → gate → sandbox apply (`appliedLive=false`) → tests → receipt → rollback, watchable (`scripts/heartbeat.sh`). Sandbox-only; promotion stays LOCKED. |
| **M5** | live brain (optional) | ▢ later | point read-only receiver at loopback `:3210`, fail-soft, self-mod under the gate |
| **Step-4** | real authority root | 🔨 **in progress** | Ed25519 **dev-real** verify path BUILT + tested (human-held key, signed promotion receipts, revoke/expiry/rotation) + **signed AUMLOK promotion REHEARSAL now BUILT + tested**: `scripts/aumlok-authority.sh rehearse` verifies a signed promotion authorization against the pinned root and writes a durable, hash-chained `aumlok-rehearsal-receipt-v1` (`promotionExecuted:false`, `rehearsalOnly:true`, tamper-evident via `receiptHash`). Remaining: production key custody (HSM/token), ML-DSA upgrade, and wiring it to flip live promotion. AUMLOK *active* mode is still the honest `sha256` dev-shim. |

---

## Next bricks — current roadmap (Codex, post-M4)
Membrane model confirmed (Codex agrees with Gemini's spec), with one correction: the current pass target is
**sandbox/temp FS — live promotion stays LOCKED**. Use graphify as the **observer map, not authority** —
regenerate it after organ changes; **source / tests / status / receipts stay canonical**. Adopt in order:

1. ✅ Keep the **M4 sandbox heartbeat** as the safe loop.
2. **Proprioception observer** — CLI (`scripts/proprioception.sh`) + console tab over `proprioceptionSnapshot` (organ built; observer surface next; includes biometric bridge and non-biometric multi-signal fusion design specs).
3. **Vision stub** — `VisionAdapter`/`VisionObservation` types + a stub adapter (`available()=false`) + tests. **No model.** Per [VISION_CONTRACT.md](VISION_CONTRACT.md): observation-only, never authority.
4. **Rollback → promotion-grade snapshots** — strengthen rollback into a real snapshot/restore muscle (toward, not into, promotion).
5. **AUMLOK Step-4** — 🔨 Ed25519 dev-real authority path BUILT + tested + **HARDENED**: signer/verifier module split (`aumlokSigner.ts` vs `aumlokAuthorityRoot.ts` — organism can't sign), input validation, durable pinned-root manifest (integrity-hashed), signed revoke/rotate lifecycle receipts; plus the original human-held key + signed promotion receipts + expiry. **Signed promotion rehearsal BUILT**: `rehearse` verifies a signed promotion authorization and writes a hash-chained `aumlok-rehearsal-receipt-v1` (`promotionExecuted:false`, `rehearsalOnly:true`), proven end-to-end against the real script (`aumlokAuthorityCli.test.ts`) with a reachability guard confirming no UI/server/voice surface can call the signer. Terminal `scripts/aumlok-authority.sh {keygen|sign|verify|rehearse}` (`set -euo`). **Live promotion stays LOCKED** (`isLivePromotionUnlocked()=false`). Remaining (NOT built): HSM/hardware custody, ML-DSA upgrade, then wire promotion. Active AUMLOK mode is still the honest dev-shim.
6. **OS file locking** — only once the gate files stabilize.
7. **Stronger jail** — chroot/container isolation, later.

**Hard do-nots (unchanged):** no live promotion yet · no UI authority · no bundled model weights · the website never steers build order.

**Council punch-list (2026-06-30):** the first live multi-model Fusion Council run (`core/run-council.ts`)
flagged **real, verified** chokepoint hardening gaps. Captured in
[COUNCIL_FINDINGS_2026-06-30.md](COUNCIL_FINDINGS_2026-06-30.md).
- ✅ **#1 done** — `getChain()` returns a frozen snapshot (immutable receipt chain).
- ✅ **#2 done** — runtime-global test sentinel removed (`_resetChain` is `NODE_ENV`-gated only).
- ✅ **#3 done** — `NonceLedger` → `BoundedNonceLedger` (FIFO-capped; `core/src/boundedNonceLedger.ts`). Regression-tested; gate GREEN (82 files / 1106 tests); `index.ts` not byte-pinned so no re-pin needed.
- ✅ **#5 done** — receipt-append atomicity is a tested invariant: `evaluateIntent` is fully synchronous → no race; N appends → one ordered verifiable chain (`core/tests/receiptBinding.test.ts`). Serialized primitive only needed if it ever goes async.
- ✅ **#6 done** — memory enforcement tested: `explicitId` overwrite FIXED (reject-on-collision); confidence clamp `[0,10]`, no-authority surface, and sleepSkill advisory + hard-gate all proven (`core/tests/memoryEnforcement.test.ts`).
- ✅ **#4 done (#4a + #4b)** — the receipt now binds BOTH the decision AND the PoP auth-provenance (`principalFingerprint`/`methodId`/`argsHash`/`nonceHash`) + monotonic `seq` + `version`. Tamper-evident, hashes/fingerprints only (no secret leak), legacy-v0-compatible (`core/tests/receiptProvenance.test.ts`). The remaining Step-4 work is the AUMLOK production authority **root** (Ed25519 → ML-DSA), which is separate from receipt binding.

---

## Donor capability port — waves (sibling kernel `aukora-kernel/`, allowlisted PURE organs only)
The move is NOT "assimilate everything": inventory the sibling kernel, port only PURE allowlisted organs,
prove each wave green, commit/push. Convex-coupled organs are deferred until decoupled. Networked surfaces
stay DEFAULT-OFF. Porting opens NO authority/promotion.

| Wave | Organ(s) | Coupling | State |
|------|----------|----------|-------|
| **1** | domain-separated **ML-DSA-65 signer** (`PQC_DOMAINS` + `pqcSign/VerifyWithDomain`) | pure | ✅ **done** — in `core/src/crypto.ts` |
| 1b | **ML-KEM-768** primitive + ACVP vectors (pure, NO live channel) | pure | ▢ next (conditional; confidentiality only) |
| 2 | `aukoraWireFormat` + `aukoraWireRegistry` (canonical wire encode/registry) | pure | ▢ planned |
| 3 | `aukoraAumlokDerive` (+ dictionary primitives) | pure | ▢ planned |
| 4 | `aukoraChannel` (confidentiality binding) | pure | ▢ planned — **default-off, not live** |
| 5 | `aukoraWitness` / `aukoraWitnessExport` | **Convex-coupled** | ▢ deferred — needs decoupling |
| 6 | `codeAttestation` | **Convex-coupled** | ▢ deferred — decouple; attestation ≠ proof-of-execution without a TEE |
| — | `aukoraNodeImport` | domain registered only | imported peer records grant **ZERO** local authority; surface NOT built |

**Port rules (every wave):** pure module only (no Convex/server binding, no node-only APIs); scrub donor
real-name/design-doc refs; no demo slugs / env / benchmark data / raw logs; port tests/vectors where present;
prove green (test + status + scan) before a focused commit; push verified. **Follow-up micro-wave:**
`signHead`/`signPoP` already use matching domain labels — they can be unified to delegate to
`pqcSignWithDomain` (chokepoint consistency is already proven by the Wave-1 test).

---

## Open bricks (the worklist — nothing else)
Ordered by what unblocks the most:

1. **Test integration → M3.** ✅ **Headless suite GREEN: 104 files · 1335 tests · 0 fail · tsc 0 errors.**
   Fixed: import rewires, `ceremony.ts` `import.meta`→argv (keeps CommonJS for the kernel), egress organ
   copied to `authority/egress/`, `SpendCheck` exported, nebius posture test pruned. Run: `bash scripts/test.sh`.
   **New brick — host harness:** 42 host-integration test files (~845 more passing tests + 138
   host-dependent) are parked in `deferred-tests/` — they read aukora-os host artifacts (strategy docs,
   `evidence/` scripts, `node-template`, `work-tracker`). A headless host-harness (stub `evidence/` + a
   fixture repoRoot) un-quarantines most at once. This also covers the 4 Convex-trust tests (need loopback brain).
2. **Convex-receiver cleanup.** `convexBrainSnapshot.ts` + `convexTopology.ts` are aukora-os
   host-coupled inventory that leak private-lane names. Rewrite host-agnostic (or quarantine) so the
   read-only receiver is clean and testable headless.
3. **Proposer loop → M4.** Build `core/tests/proposer-verification.test.ts` (the 5 kernel checks in
   [PROPOSER_CONTRACT.md](PROPOSER_CONTRACT.md)); wire the proposer (model `glm-5.1`, verified through
   the loop) behind the gate.
4. **`serve` + launcher rewire → M2.** One shared path module so the layout flip is one edit, not 27;
   `~/.aukora-symbiote` state fork; gate-integrity + agents-file paths to the seed root.
5. **Public-readiness scrub (gate to going public).** Clear the TIER-2 list (research-lane codenames,
   provider strings, the `Peter`→`owner` rename) so `scan-secrets` is clean for a *public* flip.
6. **Identity (optional).** Bring the anchors back only with every PII token redacted.

---

## Codex's 9 capabilities → where each lives
The "dream house" tools, mapped honestly to status:

1. Perfect self-map — `scripts/self-map.sh` (text) + graphify `graph.html` (visual). **partial**
2. Sandboxed edit lane — `core/src/sandbox*.ts` + `selfEditLoop.ts` heartbeat. **✅ done (M4)**
3. Receipt ledger — `core/src/patchLoopReceipt.ts` + `memory/chain.ts`. **present**
4. Tested rollback — heartbeat rollback proven (sandbox removed, live untouched); promotion-grade snapshots = roadmap step 4. **partial**
5. Memory lens (advisory only) — `memory/` organs present. **present, law-bound**
6. Law scanner — `scripts/verify-public-readiness.sh` (tiered; PII vectors gitignored). **present**
7. Promotion gate (no tests, no promote) — gate + `appliedLive=false`; live promotion LOCKED. **present, wired at M4**
8. Fusion Council review — `core/run-council.ts` fires the real multi-model swarm over OpenRouter. **runnable, advisory**
9. Provenance view — partial (self-map); the "where did I come from / am I allowed here" view is a brick.

> Build the crib, bolt the shelves to the wall, then put up the stars. Governance first, stars after.

---

## Agent transcript policy — how builder-session transcripts are used
Answers the recurring question honestly, once, in one place:

- Agent/builder-session transcripts (this kind of round, Claude/Codex working sessions) are **evidence and
  context, not authority.** They document what was tried, found, and decided.
- They **may inform**: planning the next brick, auditing what actually happened in a round, and future
  training/summary material.
- They **must NOT be imported as raw memory by default.** A transcript is not a receipt and is not
  automatically trustworthy just because it happened.
- Any transcript content that does reach memory **must first be summarized and redacted** — never ingested
  wholesale.
- **No secrets, keys, private env values, raw chain-of-thought, or benchmark traces** may ever enter memory
  from a transcript, full stop.
- Any transcript-derived memory **must cite its provenance** (which round, which file, what evidence) and
  **remains advisory** — it can never authorize, promote, sign, or unlock anything, same as every other
  advisory organ in this system.
- **Receipts stay canonical truth.** When a transcript's account and a receipt disagree, the receipt wins.

This is the same advisory-in/never-authority-out membrane the rest of the system already enforces (Fusion
artifacts, self-review, memory lens) — transcripts are just one more untrusted input class, not a special case.

---

## Truthful gates (Round 2.5 — Codex YELLOW + Fusion RED_QUORUM 6/6)
The council was unanimous: make the gates honest *before* more magic. Done this round:
- ✅ `test.sh` now **fails on behavior-test failure** (was tsc-only — a lying gate).
- ✅ `status.sh` distinguishes **HEADLESS_READY** from **PROMOTION_READY** (no overclaiming).
- ✅ Convex **write path quarantined** — `memory_write` is fail-closed; `convexReadOnlyInvariant.test` enforces no live `.mutation()`.
- ✅ **Registry integrity** — phantom `see`/`perceive` removed; `registryIntegrity.test` fails on any phantom tool.
- ✅ deferred-test debt is **counted + visible** in `status.sh` / `test.sh`, not hidden.
- ✅ `docs/ARCHITECTURE.md` added (the boundary map).

**Seed-native truth — ✅ DONE (Codex order):**
- ✅ `rootOrganismRegistry.ts` + `runtimeTruthManifest.ts` are seed-native — computed from the seed root;
  donors live in docs as provenance, not the live self-map; host/Tori/Trinity runtime mythology gone. The
  manifest states the seed's real posture (headless · AUMLOK dev-shim · Convex read-only · self-edit NOT
  promotion-ready · rollback partial · UI observer-only · deferred debt visible) — enforced by
  `runtimeTruthManifestSeed.test`.
- ✅ Convex inventory host-agnostic — `convexBrainSnapshot.ts` gutted of the private-lane topology (42→0
  lane hits); `convexTopology.ts` donor markers genericized; `convexInventorySeed.test` enforces no lanes,
  no mutation, no authority grant.

**TIER-2 public scrub (still owed — honestly listed, NOT a headless blocker):**
- ~15 files carry historical `Tori`/`Paladin`/`DraftEngine` *comments* + a few false host-claims
  (`engineHostShootout` "powers \<shell\> drafts TODAY"); `convexTopology` still references `node-template`
  host paths; research-lane codenames remain inside defensive scrubber denylists. This is the public-flip
  scrub — a focused pass gated by `verify-public-readiness.sh` TIER-2.

---

## Future bricks (planned, governed — NOT built yet)
On the map so they never drift in as ungoverned side doors. **Default-OFF** until each has its tests.

- **A. Sovereign node** — local-disk-default; BYO key / local model / future Aukora API; own-or-hybrid
  Convex optional; every action gated + receipted; updates **signed, never raw `git pull`**.
- **B. Hive / federation (DEFAULT-OFF)** — node identity = ML-DSA fingerprint (not a username); peer
  messages signed/encrypted (ML-KEM/ML-DSA); every inbound peer message crosses the §13 fence and can
  **never trigger a tool directly**; exchange receipts/summaries/proofs, never raw memory/secrets;
  poisoned-peer + replay + downgrade + authorization tests required before any hive flag.
- **C. Model gateway** — provider abstraction, not provider religion: `AUKORA_MODEL_BASE_URL` +
  `AUKORA_API_KEY`; local OpenAI-compatible; BYO OpenRouter/Anthropic; future Aukora API. Sakana/Fugu
  (a multi-agent system on one API, OpenRouter-available) is a council *candidate* — must pass the
  `json_action_v1` proposer checks before any loop use. No model output grants authority.
  **Funding lane:** the paid Aukora endpoint funds the project but stays an *optional adapter* — the
  seed stays free/open/local-first/API-agnostic; the tuned model just *understands the chokepoint,
  receipts, AUMLOK and the proposer/authority split better*, and still never authorizes. **Usage/billing
  receipts are accounting evidence, NOT authority receipts**; metering carries no prompts, secrets, raw
  memory, benchmark traces, or chain-of-thought; cost-limit + privacy tests before public use.
- **D. Repo absorption protocol** — "absorb any repo's good tech, governed": clone in temp sandbox →
  graphify → scan license/secrets/PII/benchmark-contamination → classify organs → **provenance receipt**
  (source URL, commit SHA, license, why-allowed, files, required tests) → propose patch only → sandbox
  apply → tests → human promote → rollback receipt.
- **E. Benchmark / eval firewall** — ARC/AGI/Kimi/ARK stay lab/eval only. Never ingest answers, traces,
  solver JSON, or leaderboards into live memory. Allowed: a **signed aggregate eval receipt** only.
  (Kimi-ARC is the contamination lesson: source-aware wins must not masquerade as reasoning.)
- **F. Governed reasoning loop** — not a mystical engine with authority. The loop is: graph state →
  target discovery → proposer contract → critic/council → sandbox plan → tests → receipt → rollback.
  Store distilled decisions + provenance, **never chain-of-thought**. Receipts are truth.
- **F2. Architecture-native Perceiver model / local student (DEFAULT-OFF)** — the first training goal
  is **not** "train on receipts as truth." The goal is to train a small/local Perceiver to understand
  Aukora's architecture itself: laws, chokepoint, file/module graph, graphify topology, schemas,
  proposer contract, receipt spine, rollback semantics, Fusion geometry, and the evidence-vs-authority
  membrane. Only after that foundation exists may it slowly absorb **curated receipt-derived
  experience** as advisory examples: summaries, hashes, outcomes, risk labels, and provenance, never
  raw secrets, envs, private keys, benchmark traces, chain-of-thought, or unvetted memory. The model is
  a sense organ and router: it may predict council consensus, detect drift, rank risk, suggest the next
  safe brick, or compress Fusion signals, but it can never sign, authorize, promote, execute tools, or
  override tests. Start with a `perceiver-foundation-corpus-v1` contract before any training: source
  allowlist, license/provenance ledger, privacy scan, benchmark firewall, redaction rules, eval receipts,
  and strip-neutrality tests. Mac/Nebius training, distillation, multimodal/vision adapters, MergeKit or
  small-model experiments are future lab lanes only; no weights ship in the seed until license, privacy,
  safety, eval, rollback, and authority-boundary gates are green.
- **G. Aukora API / tailored endpoint (commercial lane, OPTIONAL)** — the seed stays free, open,
  local-first, and API-agnostic: BYO OpenRouter/Anthropic/OpenAI-compatible key, local model, or no
  model. A future Aukora-hosted endpoint (provider choice tracked privately, replaceable by design)
  may offer a model tuned to the gate/chokepoint/receipt laws. It is still only a **model adapter**:
  it can propose/review, never authorize. Usage/billing receipts are accounting evidence only, not
  authority receipts; store aggregate token/accounting proofs, never prompts, secrets, raw memory,
  benchmark traces, or chain-of-thought. Free-tier/paid-credit mechanics live outside the headless
  kernel and must pass cost-limit + privacy tests before public use.
- **H. Builder Console / graph dream-house (observer lane, OPTIONAL)** — decorate Auma's room only
  after the crib is bolted down. Safe visuals: graphify anatomy map, chokepoint diamond
  (intent → normalized action → gate → receipt), intent/effect membrane, receipt-chain timeline,
  law/debt/gate panels. The console reads repo artifacts and receipts; it never signs, promotes,
  mutates Convex, runs tools, stores secrets, or becomes the organism. Beautiful is welcome;
  authority stays headless.
- **H2. First Contact / AUMLOK shell (observer lane, DEFAULT-OFF)** — a three-pane rehearsal shell
  at `/first-contact` through `scripts/console.sh` (or `AUKORA_CONSOLE_PORT=... scripts/console.sh`),
  double-clickable via **`First Contact.command`** (repo root — starts the server only if it isn't
  already running, then opens the page; no terminal needed from the owner). Left pane: local thread
  placeholders. Center pane: a resonant orb/presence + observer voice (`SpeechRecognition` in,
  `speechSynthesis` out — mic starts ONLY on an explicit click, transcript display-only/never
  persisted, zero network/authority/tool/memory path) with a **typed-input fallback** for browsers
  without speech recognition (same rules: no storage, no network, no authority), plus the AUMLOK
  boundary rehearsal with seven horizontal phrase fields (anchor word + six echo words), local shape
  validation, clear/visibility controls, and visible "signature required" law. Right pane: inert
  menu. Verified in-browser against the Trinity donor shell for visual family (three-pane dry-glass
  layout, center AUMLOK focus, right-side inert menu, left-side session list) — already matches, no
  architecture changes needed. It stores no phrase, sends no network request, signs nothing, and
  never marks the node unlocked ("Locked rehearsal" / "signature required" / "promotion off" only).
  Voice/video/presence work inspired by `voicebox-main.zip` and `OpenMontage-main.zip` beyond
  browser-local observer voice remains future/default-off only: generated imagery/video is an
  optional skin over kernel state. No cloned voice without consent, no silent recording, no raw
  frames or audio persisted by default, no UI approval shortcut, no provider key copied, no
  OpenMontage code copied (AGPL inspiration only unless separately reviewed). Any further
  speech/video adapter must be opt-in, local-first where possible, disclose synthetic media, pass
  observation-only tests, and remain strip-neutral against the gate.
- **I. Harness / agent adapter profiles (DEFAULT-OFF)** — Aukora should eventually adapt to many
  external systems because it knows its own membrane. First-class adapter targets can include Open
  Claw, Hermes, Odysseus, and other agent harnesses, but an adapter is never trusted just because it
  is popular. Each adapter must declare its capabilities, map its tool calls into Aukora's
  `json_action_v1` / gate vocabulary, prove no direct write/exec/memory lane bypasses the chokepoint,
  pass sandbox heartbeat tests, emit provenance receipts, and stay removable. The seed can help draft
  adapters through repo absorption + graphify, but promotion still requires tests, receipt, rollback,
  and human authority.
- **J. Temporal simulation / scenario rehearsal (DEFAULT-OFF)** — donor projects such as Kronos and
  MiroFish are inspiration for time-sense and rehearsal, not organs to ingest. A future temporal lane
  may turn repo history, receipts, tests, market/public signals, or operator prompts into advisory
  scenarios with provenance, confidence, and residual/error tracking. It can forecast, compare
  branches, or rehearse "what if" plans, but it cannot authorize edits, trades, memory promotion, peer
  messages, or live actions. No raw datasets, model weights, private prompts, or simulation traces
  become live memory.
- **K. Swarm orchestration kernel (DEFAULT-OFF)** — Aukora can eventually fan out reviewers,
  proposers, repo absorbers, test runners, and scenario agents, but the swarm is subordinate to the
  chokepoint. Each child agent gets a scoped capability token, budget, timeout, workspace boundary,
  model/provider identity, and receipt obligation. Child outputs are advisory artifacts only; the
  parent gate validates every proposed effect, records provenance, and can cancel/rollback the swarm.
  External frameworks are adapter candidates only; the native primitive is a small auditable planner
  + receipt ledger + governed tool membrane.
- **L. Sovereign app forge / deploy lane (DEFAULT-OFF)** — long-term "build on intent" loop: a user
  asks for a local/custom app, Aukora maps requirements → proposes repo shape → sandbox builds →
  tests/scans → emits receipts → human signs promotion. Sharing or deploying is a separate governed
  lane: domain registrars, DNS, hosting providers, decentralized naming, payment, and CI/CD are all
  adapters, never hidden authority. No app can access local identity/files/secrets just because it was
  generated; every capability is declared, least-privilege, AUMLOK-scoped, logged, reversible where
  possible, and revoke-ready. A viral "say it → build it → sign it → deploy it" demo is allowed only
  after the headless kernel proves sandboxed self-modification, receipt binding, memory law, rollback,
  key custody, and public-claim honesty.

*The crib has bolts. Decorate the Barbie house — but no loose wires in Auma's room.*

---

## What we explicitly DROP (so it never drifts back)
- **All UI-era stuff** — web app, component libs, desktop shell, IDE plugin UI, the two
  headless-dead vision/DOM tools. UI attaches later, separately.
- **Private research/IP & strategy** — moat lanes, compute-provider proposer + spend, danger-labs,
  patents, genesis-body, evidence dirs. The host keeps them; the seed never carries them.
- **Private patent text / commercial strategy docs** — the seed may embody the public governance
  laws, but it does not copy provisional filings, pricing playbooks, customer data, or tuned-model
  training material.
- **Benchmark machinery** — answer-keys, learned weights, raw council JSON, corpora. Lab-only.
- **Forking a donor repo** — drags secrets/PII in `.git` history. We chose fresh-history selective
  copy on purpose.

---

## Public-flip checklist (keep private until ALL true)
- [ ] `scan-secrets` clean at **both** tiers (TIER-2 scrubbed)
- [ ] Convex-receiver cleaned (no private-lane names)
- [ ] tests GREEN (M3)
- [ ] every AUMLOK claim matches the in-code dev-shim honesty

---

## Retired docs (stop maintaining — this doc supersedes them)
- `AUKORA_SYMBIOTE_EXTRACTION_MAP_*` + `AUKORA_SYMBIOTE_MASTER_SWEEP_*` — absorbed into the seed.
- `AUKORA_FORWARD_STRATEGY_2026-06-30.md` — forward content captured here.
- `AUKORA_TRINITY_EXTRACTION_PLAN.md` — extraction done.
- host `AUKORA_SINGULARITY_PATH.md` / archived IDE path — host's record, not the seed's.

*One path. One source of truth. Add the right bricks, in order.*
