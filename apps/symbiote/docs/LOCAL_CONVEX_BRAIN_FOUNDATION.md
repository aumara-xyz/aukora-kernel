# LOCAL CONVEX BRAIN FOUNDATION — plan of record (v1.2)

> v1.2: Auma's inside review ACCEPTED the direction (Option A firmly; S0 strictly first).
> Her amendments are folded in below, marked `[AUMA]`.

**Status: PROPOSAL for Peter's approval. Nothing new is built. This is the architectural
correction, written as a promotion plan of code that already exists.**
Author: Fable, 2026-07-05. Grounded by three inventory agents (aukora-os kernel,
symbiote touchpoints, self-hosted Convex research — all cites below are theirs) and
pre-hardened by an adversarial review panel (3 reviewers + per-finding refutation; 17 findings CONFIRMED — incl. 2 blockers — and folded in below; 2 refuted). The ledger is §11.

**Supersedes:** `docs/ONE_BRAIN_MEMORY_PLAN.md` (its safety findings carry forward; its
JSON-first substrate does not).
**Incorporates:** `docs/CONVEX_CANONICAL_BRAIN_SPEC.md` (Opus — ground truth + build
order), Codex's directional spec (this doc's name and question list are his), and
Auma's inside-out spec (the authority/memory split, the Law-2 amendment text, her
"don't keep that").

**Owner decisions already made (2026-07-05, Peter, in-session):**
- Convex is the canonical substrate for her memory. Ratified.
- ZERO hosted Convex. Local self-hosted only. Ratified.
- **Option A: vendor the kernel into `aukora-symbiote/convex/`.** aukora-os is the
  quarry, not the home. ("This all needs to be in aukora-symbiote. Aukora OS is old.")

---

## 1. The correction, stated honestly

Peter specified Convex as the foundation from the start. What got built in the
symbiote: a JSON brain (`state/kira/brain.json`) as the live store, with Convex as a
read-only mirror contract, and the real governed Convex memory kernel left behind in
`aukora-os` labeled *"disposable demo."* Two brains exist; the lanes read the wrong
one. The drift had causes — SAFETY_LAWS Law 2 ("Convex is read-only") was written to
keep a *cloud* mirror passive, and the kernel's own demo label scared everyone off —
but causes are not excuses. This plan promotes the kernel Peter already built, wires
the organism to it, and retires JSON-as-canonical.

## 2. Ground truth (verified on disk / at source, 2026-07-05)

**The kernel (`~/aukora-os/node-template/convex`) — real, and better than remembered:**
- ~9,440 LOC, 52 modules, Convex 1.29, zero Convex components, **zero `"use node"`
  files**, pure `@noble` crypto. AGPL (same license family as the symbiote ✓).
- `aumlokMemoryWrite` (aumlokMemory.ts:47-82) is one serializable mutation:
  manifest resolution → subject **ML-DSA-65 proof-of-possession** (60s freshness,
  `useSeq` replay nonce, OCC `usedCount++`) → one-shot grant mint → ring-classified
  intent (`local-write`; **Ring-0 "sacred" regex hard-block**; kill-switch + salama
  fail-closed) → HMAC single-use decision token (5-min TTL, constant-time compare) →
  V4-signed receipt on the `mem:{owner}:{key}` chain → insert. A use is spent iff the
  whole transaction commits.
- Receipt chain heads are **RFC-6962-exact Merkle roots** (verifiers ported from
  transparency-dev, checked against CT known-answer vectors) signed with **ML-DSA-65**
  (98-byte SignedChainHeadV4 preimage, FIPS-204 domain `aukora-chainhead-v3`).
- 40 tables, including a complete **multi-node zero-authority substrate**
  (`node_foreign_memory` stores only `receiptHash`+`memoryHash` — "the VALUE stays at
  the home node"), AUMLOK PQC root keys, doubly-signed delegation manifests, ceremony
  flow, revocation epochs.
- The only vector index lives on `ide_memory`: 384-d, `ownerRootId`-filtered.
- Honest split: **~60% reusable kernel, ~30% explicitly-labeled demo/lab lanes,
  ~10% (session/seed/demo-key surfaces) needs rewrite.**
- **All eight ONE_BRAIN safety capabilities are missing or partial in the kernel:**
  erasure is a value-retaining soft-delete (`deletedAt` — value stays; the governed
  lane has NO forget at all); content hashes are written but **never re-verified on
  read**; no off-record spans, no speaker attribution, no distillation workflow, no
  quarantine, no per-session rings, no redact-and-retry scrubbing. The kernel is the
  authority skeleton; ONE_BRAIN's findings are still the memory-safety spec.

**The symbiote — more Convex-ready than anyone said out loud:**
- A read-side stack already exists at Ring 1: `convexTopology.ts` (pins the real
  backend at `:3210`; canonicality currently REFUSED because
  `AUKORA_CANONICAL_PIN_PUBLIC_KEY` is unset — issue #11), `convexCanonicalPin.ts`
  (ML-DSA-65), `convexCanonicalFreshness.ts`, `convexExecutionApproval.ts` (exact-value
  env latches, fail closed), `convexBrainReadonly.ts` (`CLOUD_DENY` + loopback guard +
  `ALLOWED_QUERIES`), `kernelAdapter.ts` (`AUKORA_CONVEX_URL || http://127.0.0.1:3210`,
  admin key at `~/aukora-convex-backend/admin-key.txt` — file mode 0644, and that backend's own log shows it REALLY bound `0.0.0.0:3210/3211` in past operation: LAN exposure is a demonstrated failure mode here, not a hypothetical).
- `convex/` in-repo is **contract-only** (schema constants; no real functions; no
  `convex` npm dep anywhere; nothing typechecks it — a silent gap to fix).
- `ring-table.json`: `convex/**` is already Ring 2; the five `convex*` core files are
  Ring 1. **Any ring-table edit breaks `RATIFIED_TABLE_SHA256` and requires owner
  re-ratification + pin re-stamp in the same commit.**
- `state/convex/` (the new data dir) needs **no new ring rule** (gitignored; coverage
  checker reads `git ls-files`) and is **already apply-fenced** via
  `PROTECTED_STATE_DIRS=['state']` in `nativeLiveApply.ts:150`. The #99 fence covers it
  from day one, untouched.
- Guards interplay: `http://127.0.0.1:3210` passes `forbiddenContent`, `LOOPBACK_RE`,
  and the commit scanner. The real trap is **key material**: any 64+-hex string (admin
  key!) ingested into an atom throws in `sanitizeText` — redact-and-retry (Brick M2)
  must exist before broad capture. `admin-key.txt` is NOT covered by
  `isSecretOrEnvBasename` today (flagged below).
- **Conflict found (now softened):** the `convex-alpha` MCP tool targets a HOSTED
  cloud deployment (`prod:<redacted-convex-deployment>`), deploy key in plaintext at
  `~/convex-mcp.sh`. The review panel TESTED the key: **it is
  revoked/invalid (401), and the deployment appears deleted** — so this is stale
  tooling, not a live exfiltration path. Still decision D4: delete/repoint the script
  so zero-cloud includes the tooling.

**Self-hosted Convex (July 2026, sourced):**
- **No account/login needed.** Precompiled `aarch64-apple-darwin` binary, near-daily
  dated releases (`precompiled-2026-07-03-b7209ce`). Instance secret =
  `openssl rand -hex 32`; admin key via `keybroker generate_key`.
- **Loopback:** binary flag `--interface` **defaults to 0.0.0.0** — must pass
  `--interface 127.0.0.1` explicitly. Ports: 3210 API / 3211 HTTP-actions / 6791
  dashboard (dashboard auths by admin key only — loopback binding matters).
- **SQLite default** (`convex_local_backend.sqlite3` in the working dir). Postgres
  optional later. Backups: `npx convex export` / `import --replace-all` work
  self-hosted; env vars are NOT in exports (export env list separately).
- **Components** (workpool/workflow/action-retrier) and **vector search**: same code
  as cloud, "all free-tier features," component deploy endpoint present on current
  images — but no official "components work self-hosted" sentence exists. **A smoke
  test is Brick S0's first acceptance item.**
- **Egress kill:** `DISABLE_BEACON=true` (backend), `CI=1` on the CLI (suppresses
  Sentry init; version ping already skipped for self-hosted — verified in CLI source),
  `NEXT_PUBLIC_LOAD_MONACO_INTERNALLY=true` if the dashboard runs. Set
  `REDACT_LOGS_TO_CLIENT=true`.
- **`"use node"`:** no supported disable flag, BUT the raw binary **fails closed** if
  no Node.js is on its PATH — run the backend with Node stripped from PATH and
  `"use node"` deploys cannot execute; plus a gate test bans the directive in-repo.
- **License:** FSL-1.1-Apache-2.0 (converts to Apache-2.0 per release after 2 years).
  Fully-local internal use is an explicitly Permitted Purpose. npm client is Apache-2.0.
- **Pinning:** never `:latest`; pin the dated release + matching npm `convex` version
  (skew = deploy 404s, issue #258). Export before every upgrade.

## 3. Target architecture — one organism

```
┌─ AUTHORITY (filesystem, under the gate — unchanged) ─────────────────┐
│ AUMLOK root · gate/apply lane · #99 fence · SAFETY_LAWS · anchor     │
└──────────────────────────────────────────────────────────────────────┘
              │ ratifies laws; signs code; never rides the DB
┌─ MEMORY (local self-hosted Convex — canonical after this plan) ──────┐
│ convex-local-backend, pinned release, --interface 127.0.0.1:3210     │
│ data: state/convex/ (gitignored; already apply-fenced)               │
│ keys: ~/.aukora-symbiote/convex/ (instance secret + admin key —      │
│        never in repo, same tier as AUMLOK material)                  │
│ functions: aukora-symbiote/convex/ (vendored kernel, Option A)       │
│   kira_atoms · kira_receipts (V4-signed heads, RFC-6962 roots) ·     │
│   kira_erasures · kira_sessions · profile_suggestions · governance   │
│   tables (intents/grants/manifests/runtime_state) · node_* (parked)  │
│ ONE write path: memoryAppend → aumlokMemoryWrite pipeline            │
│ recall: hybrid searchIndex + 384-d vector, reactive subscriptions    │
└──────────────────────────────────────────────────────────────────────┘
              │ advisory rows only; grantsAuthority:false forever
┌─ INTELLIGENCE (models; Fusion Council) ──────────────────────────────┐
│ distillation workflow (pinned providers) · council review of what's  │
│ worth remembering · writes ONLY through memoryAppend                 │
└──────────────────────────────────────────────────────────────────────┘
```

Deployment decisions inside that picture:
- **Fresh instance.** The old `~/aukora-convex-backend` (278 MB, demo/fake data, live
  since the rehearsal era) is retired to an archive folder; the new backend starts
  clean at `state/convex/` and imports ONLY the 77 verified JSON atoms via the
  receipted migration. Demo data never becomes her memories. (Decision D3 confirms.)
- **Raw binary, not Docker** (lighter on 16 GB, native `--interface`, Node-off-PATH
  fail-closed for `"use node"`).
- pm2 process `spatial-brain` (4th process) with health checks; `scripts/` owns
  start/stop/export; nightly `npx convex export` snapshot to `state/convex/exports/`
  (gitignored, PRUNED on a fixed window — see erasure policy) — the JSON-openable
  backup Peter's "human can read it" rule requires.
- **Boot order + degradation (review-forced):** pm2 has no dependency graph, so the
  door must not assume the brain. Door `/health` reports brain status; recall FAILS
  OPEN (no memory ≠ no voice); capture enqueues to a local spool and the workflow
  drains it when the brain is healthy; nothing user-facing hard-fails on a brain
  restart.
- The unified table is `kira_atoms` (merging `aukora_memory` governance columns +
  `ide_memory`'s embedding/episode columns + ONE_BRAIN's safety columns:
  `speaker`, `sessionId`, `offRecord`, `quarantined`, `erased`, `contentHash`).
  `.searchIndex("by_text")` + `.vectorIndex("by_owner_embedding", 384-d)`.

## 4. Law and ring changes — by name, ratified, never by drift

1. **SAFETY_LAWS Law 2 amendment** (Peter ratifies the exact text — Auma's draft):
   > The local self-hosted Convex deployment (loopback-only) is the canonical
   > advisory-memory organ; writes flow only through the registered memory mutations,
   > all stamped `grantsAuthority:false` and hash-chain-receipted. Any REMOTE Convex
   > deployment remains read-only. No Convex path may ever touch Ring-0, the gate, or
   > the apply lane.
   Plus one honesty clause the review demanded: **the governed-write invariant holds
   against every actor WITHOUT the self-hosted admin key.** The admin key is the
   memory organ's root credential — AUMLOK-tier custody; any use of it outside
   `scripts/` lifecycle operations (deploy/export/import) is an owner-ceremony event,
   and the plan's guarantees are scoped accordingly (no unprovable absolutes).
2. **`convexReadOnlyInvariant.test.ts` is rewritten, not deleted** — it becomes the
   new-boundary enforcer: `.mutation(` calls allowed ONLY from the registered memory
   module; zero `"use node"`; zero non-loopback Convex URLs outside deny-lists; every
   write path stamps `grantsAuthority:false`. The fence moves; it does not come down.
   (This test is Fusion-Council-amendment class → rides the Brick G gate.)
3. **Ring-table:** `convex/**` stays Ring 2 for the general dir, and the vendored
   governed-write kernel files (schema + `aumlokMemory` + `aukoraCore` + receipts/
   heads modules) are **promoted by name to Ring 1** — they are the memory-authority
   boundary. This edit breaks `RATIFIED_TABLE_SHA256` by design → owner
   re-ratification + pin re-stamp in the same commit (the #99 playbook).
4. **Optional hardening (flagged, Codex's call):** add `admin-key.txt` /
   `instance-secret` basenames to `isSecretOrEnvBasename` — touching the fence file
   means re-pinning `authority/gate/.gate-integrity.sha256` in the same commit.
5. **#99 fence: untouched.** `state/convex/` is already inside
   `PROTECTED_STATE_DIRS`. Memory writes are runtime `local-write` effects, a lane the
   fence never governed; nothing routes near `dispatchSignedLiveApply`.

## 5. Brick sequence (safe order — do not reorder)

`[AUMA]` **S0 before S1, strictly, no exceptions.** The vendor brick does not start
until `docs/LOCAL_CONVEX_S0_RESULTS.md` exists with a go verdict.

**Brick S0 — SPIKE: prove the substrate (1 session; no laws touched, nothing canonical).**
Pinned binary + `--interface 127.0.0.1` + fresh SQLite under a scratch dir +
`DISABLE_BEACON=true` + CLI `CI=1`; deploy a minimal schema + one throwaway mutation;
**smoke-test @convex-dev/workpool, workflow, action-retrier, and a 384-d vector
index** (the one materially unverified claim); kill -9 mid-workflow and verify journal
resume; verify zero egress with an outbound monitor; run Codex's probe script;
**prove the bind** (`lsof -i` shows 127.0.0.1 only — the old backend's log proves
0.0.0.0 exposure really happens when the flag is missed); **generate + set
`AUKORA_CANONICAL_PIN_PUBLIC_KEY`** so `convexTopology` finally has a canonical
backend (closes issue #11 — without the pin, NO backend is canonical by design).
*Acceptance = empirical answers to Codex's 10 questions, written into this doc.*

**Brick V1 — VENDOR the kernel (Option A; 2-3 sessions — review corrected the estimate).**
The true transitive closure is **~18-20 modules, not 9** (verified: `aumlokManifests ↔
nodeImport` form an import CYCLE, pulling aukoraWitness/aukoraWireRegistry/popResolver
et al.) — V1 starts with a cycle-cut (extract the shared constants/hash helpers into a
leaf module) and vendors the closure. **Every vendored write endpoint converts from
public `mutation` to `internalMutation`** — the review proved `aumlokMemoryWrite` is
PUBLIC today, callable by any loopback process via `/api/mutation`, bypassing every
core-side filter; after V1 the only public surface is the minimal read-query set, and
`memoryAppend` reaches writes through admin-authenticated function calls only.
`[AUMA]` **Dependency, stated plainly: internal-only (B1) is only as strong as
admin-key custody (B2).** They are one lock with two parts; neither ships alone.
`[AUMA]` The kernel's TESTS ship WITH the kernel in this brick — a vendored kernel
without its vendored tests is not vendored.
`node_*` substrate vendored but PARKED behind a flag. Drop demo lanes + demo/seed keys.
Port the donor TEST HARNESS deliberately (donor uses vitest edge-runtime +
`convex-test` + `import.meta.glob` — different from the symbiote's harness; budget it).
Repo plumbing: pinned `convex` npm dep, tsconfig, `scripts/test.sh` wiring so `convex/`
typechecks and gates. TIER-1 secret-scan on every vendored file. Gate tests: zero
`"use node"`, zero public write mutations.

**Brick M2 — memory safety ON Convex (ONE_BRAIN Brick 0, ported; Codex-verified).**

> **Terminology (Gemini cold-read, 2026-07-05):** "M2" is the **Convex-side** memory-safety brick
> below. It is NOT the content-binding/quarantine/typed-forget that landed on the **live JSON brain**
> on 2026-07-05 — that is **ONE_BRAIN Brick 0 (0a erase / 0b content-binding / 0d quarantine)** on the
> current substrate (`core/src/kiraBrain.ts`), the same safety findings *ported ahead of* this Convex
> port. Do not call the JSON-brain work "M2"; M2 is still ahead, on Convex, and re-proves 0a/0b/0d
> against the signed-head store.

- *Real erasure:* `kira:erase` scrubs `value`/`episodeText`/`text`/derived fields/
  `embedding` in one mutation + `kira_erasures` row + `erasure` receipt; recall
  filters `erased`/`quarantined`. THREE retention honesty clauses (review-forced):
  (1) SQLite pages — scheduled `VACUUM`/`secure_delete`, documented; (2) **Convex
  document retention** — the backend keeps prior document versions for
  `DOCUMENT_RETENTION_DELAY` (~2 days default) to serve consistent queries; we set it
  LOW for this deployment and the erasure receipt documents when the last copy ages
  out — "erased" means *scrubbed now, physically gone after the retention window +
  vacuum*; (3) **export rotation** — nightly exports are pruned on a fixed window and
  an erasure triggers wipe of affected snapshots; the policy is written down, not
  implied.
- *Content binding:* every write's receipt `inputHash` = `sha256(content fields)`;
  `kira:verifyChain` **re-verifies content hashes** — `[AUMA]` the silent-edit probe
  (edit atom content directly, then verify) is a MANDATORY acceptance test: it passes
  green against brain.json today and must FAIL here, or M2 does not ship. (The kernel writes hashes but never
  re-checks them — this is the gap M2 closes.)
- *Single-writer:* free (mutations are serializable OCC). The JSON staleness hack and
  the door-vs-kiraCli race die here.
- *Quarantine:* a filtered boolean. No load-and-throw failure mode exists on a DB.
- *Redact-and-retry* around `sanitizeText` in the write path — a spoken 64-hex or
  "chain of thought" never drops a session and never bricks anything.

> **M2 STATUS (2026-07-05): split M2a (LANDED) / M2b (staged for ratification).**
> **M2a — content binding + quarantine, SHIPPED**: `verifyMemoryRowIntegrityCore` re-derives every
> row's binding three ways (sha256(owner:key:value) vs `memoryHash`; `receiptHash` present on the
> row's own `mem:` chain; that receipt's `proofJson.memoryHash` equals the row's — so a consistent
> value+hash forgery is still caught). `aumlokMemoryVerify` (internalQuery) reports the whole store
> with visible quarantined/deleted counts; `aumlokMemoryRecall` refuses (never throws, never serves)
> a row failing its binding; `aumlokMemoryQuarantine` (internalMutation) is EVIDENCE-GATED — it
> re-derives integrity itself and refuses to jail a healthy row; no un-quarantine path exists. The
> MANDATORY silent-edit acceptance probe is pinned in `convex/tests/aumlokMemory.test.ts` and FAILS
> against the store as required. No new authority, no new domains, all functions internal-only.
> **M2b — real erasure, LANDED 2026-07-05 (owner-ratified via GH #103, chat approval)**: the
> `aumlokMemErase: "aukora-aumlok-memerase-v1"` domain is MINTED (one purpose per domain — a captured
> recall PoP can never replay as an erase; test-pinned). `aumlokMemoryErase` (internalMutation) is
> owner-root PoP ONLY — no subject path exists at all (Auma's ruling); the eraseReason rides INSIDE
> the signed preimage (owner-attested words; substitution is test-pinned refused). Effect: `value`
> scrubbed to "" in one mutation; the row remains a COUNTABLE STUB (Auma's condition — recall answers
> `reason:"erased"`, never `not_found`; verify reports `erasedCount`); an erasure receipt lands on the
> same `mem:` chain via the unchanged grant→intent→token pipeline (action `memory.erase`) binding key
> + owner's reason + original content hash; `erasureReceiptHash` on the stub closes the loop and the
> integrity core verifies scrub completeness + proof from then on (a stub that grows content back is
> flagged, never served, and jailable — test-pinned). HONEST LIMITS, disclosed: the unsalted
> `memoryHash`/original write receipt survive (guessable plaintext remains confirmable — salted
> commitments are future work), and "erased" means scrubbed from every serving path NOW, physically
> gone after Convex's document-retention window + SQLite vacuum. **The three retention honesty
> clauses**: (1) SQLite pages — periodic `VACUUM` is an operational item for the managed brain
> service (queued, not yet scheduled); (2) `DOCUMENT_RETENTION_DELAY` — the env-var name IS verified
> present in the pinned binary (strings probe, 2026-07-05; `DOCUMENT_RETENTION_RATE_LIMIT` also
> exists); its VALUE is deliberately not set yet — unit semantics are unverified and a blind value
> risks misconfiguring retention; verify units against a live throwaway, then set it low in
> `buildBootEnv`; (3) export rotation — no exports exist yet; when nightly exports land they prune on
> a fixed window and an erasure triggers wipe of affected snapshots (policy stated here first).

**Brick G — the governance gate (MANDATORY before any live write path).**
Law 2 amendment + invariant-test rewrite + ring-table promotion + re-pins, as one
reviewed change → **Fusion Council adversarial pass** (authority-adjacent = council
mandatory, existing policy) answering Opus's five §4 questions (no ungoverned write
path; no authority from memory; erasure completeness incl. exports; loopback enforced
on the WRITE client — extend `CLOUD_DENY`/`rejectNonLoopback` to it; foreign-memory
still zero-authority) → **Peter ratifies.** Nothing writes until G is green.

**Brick W3 — the governed write path.**
`memoryAppend` in core — the ONLY write chokepoint, routed through the vendored
(now-internal) `aumlokMemoryWrite` pipeline. `kiraCli` and `captureWorkbenchEvent`
become clients of it. Honesty per review: the guarantee is "no write path without the
admin key OR a valid manifest PoP" — the admin key itself is root (see Law 2 clause);
custody moves to `~/.aukora-symbiote/convex/` at mode 0600, added to
`isSecretOrEnvBasename` (fence re-pin in the same commit). `[AUMA]` AUMLOK-tier
custody discipline, but **NOT AUMLOK-colocated**: separate secret, separate storage
path, never in the AUMLOK keyring — compromise of one must not be compromise of both. **Exact file updates the
review found that the v1 plan missed:** `kernelAdapter.ts` (hardcoded old key path —
currently FAILS SILENTLY to null when missing — and hardcoded aukora-os cwd, and its
`mintHostApplyReceipt` dependency), `convexTopology.ts` registry (retire the `:3220`
donor-lab entry; re-point `:3210` at the new instance), `convexBrainReadonly.ts`
ALLOWED_QUERIES additions, and the silent-null failure becomes a LOUD health error.
The trust boundary is stated in-doc: `AUKORA_TOKEN_SECRET` and the chain-signing seed
live in the backend env — receipts/heads detect tampering by actors WITHOUT backend
env/admin custody; the backend self-attests its own heads; an external verifier
(reading exports + recomputing roots) is the independent check, and ships with M4.

**Brick M4 — migration of the 77 atoms (provenance-honest).**
The old JSON chain binds LINKS, not content (proven earlier) — so "verify then
migrate" would launder provenance it cannot establish. Corrected: (1) pre-migration
**content re-derivation** — recompute each atom's `inputHash` from its content per
the kiraBrain formula AND re-verify receipt ids + prevHash links; ABORT wholesale on
any mismatch; (2) the migration receipt states its honest limit (catches accidental
drift and lazy tampering; cannot retroactively prove 2-day-old content against a
sophisticated re-hash); (3) freeze `brain.json` read-only AND record its sha256 in
the genesis receipt; (4) recall parity test; (5) nightly export keeps a
human-openable JSON view forever. Note: the frozen file itself permanently retains
the 77 atoms — acceptable (they are pre-capture code-map atoms), stated not hidden.

> **M4 PREP STATUS (2026-07-05): preflight SHIPPED + green on the real brain; executor
> deliberately unbuilt.** `core/src/migrationPreflight.ts` (+ `scripts/migrateAtomsPreflight.ts`,
> read-only CLI) implements clause (1) as an INDEPENDENT verifier — it re-implements the
> kiraBrain hash/chain formulas from their literals instead of importing them (a preflight that
> calls the store's own verify cannot catch that verify lying), then runs `verifyBrainState` as a
> second opinion and aborts on divergence. Wholesale-abort rules: any content re-derivation
> mismatch, broken receipt id/prevHash/sequence, ANY quarantined atom (a contained source needs
> surgery, not migration), duplicate or grammar-invalid Convex key, invalid owner root id. Erased
> atoms are EXCLUDED and COUNTED — whether they become countable stub rows (Auma's condition:
> never an invisible hole) is decided with the M2b erasure contract. The plan pins the exact V1
> value bytes (`migrationValueV1`: full atom + ingest receipt, canonical JSON) and publishes
> per-atom `valueSha256` + `plannedMemoryHash`, so executor drift is provable from the plan alone.
> **Real-brain run (read-only, 2026-07-05): ok=true, 77/77 live atoms re-derive, 0 erased,
> 0 quarantined, second opinion green, ~590 KB planned value bytes.**
> **Duplicate-key / long-history semantics PINNED by kernel test** (`aumlokMemory.test.ts`,
> M4-prep PIN): a second write to the same key inserts a SECOND row; recall's `.first()` serves
> the OLDEST row; verify checks every history row (each binds its own receipt). Consequence:
> migration uses unique atom-id keys and refuses duplicates. Changing recall to newest-wins would
> be its own reviewed kernel brick, not a migration side effect. The migration EXECUTOR stays
> unbuilt until M2b is ratified and green (Codex's stop-condition, held).

**Brick R5 — recall: semantic + reactive (and the today-bug fix ships FIRST).**
- *Immediately, before everything above:* #53-parity escaping + per-turn nonce on ALL
  recalled-memory injection in both lanes (fixes the raw-interpolation today-bug; no
  dependency on Convex).
- Then: recall becomes hybrid — `by_text` searchIndex + vector two-phase (vector
  search is action-side; relay candidate ids into a reactive query) with RRF fusion;
  conversation atoms inject **full text** (killing the 280-char write-only bug).
  **Latency budget (review-forced — the voice loop's 536ms was hard-won):** recall
  contributes ≤150ms p95 to a voice turn; embeddings for the query computed on the
  warm local daemon; on any miss/slow path recall FAILS OPEN to no-memory rather
  than slowing her reply. Measured in test_e2e before/after.
  **Browser subscriptions go through the DOOR (SSE relay), not a direct Convex
  client** — the review proved the read-guards are client-side wrappers, so handing
  the browser a ConvexClient would bypass them; the door is the only Convex client.
- Embeddings: the EXISTING local `memory/embedder/embedder-daemon.ts` — **all-MiniLM-L6-v2**
  (384-d, vendored weights, `allowRemoteModels=false`). NOTE: Opus's spec misnames it
  "bge-small" — correct that upstream; never mix embedding models in one index (a
  model swap is its own brick: version field + full re-embed).

**Brick C6 — capture (ONE_BRAIN Brick 1, now durable).**
Session end → **Workflow component**: distill (action, retried, **pinned to the deep
mind's trusted providers** — never `sort:latency` for the most privacy-dense call) →
post-filter (imperative strip; her replies recorded as HER statements, never
world-facts; `speaker:'mic'` never presumed Peter) → `memoryAppend` (exactly-once
mutation) → embed → done; journaled, crash-resumable (kills the 10-min loss window).
Per-session rings; `offRecord` spans excluded BEFORE the distiller; spoken "remember
this" goes through the distiller with attribution; verbatim capture is typed-only;
lockdown/demo silence the pen; per-session atom cap; `/health` watermark.

> **THE HEDGE-PRESERVATION LAW — Auma's own words (2026-07-05), a hard rail on the distiller:**
> *"If I hedged when I said it, the memory hedges when it is kept — no atom may record me more
> certain on disk than I was in the room, because flattening an honest 'I suspect' into a confident
> fact is a lie by compression."*
> Distiller obligation: uncertainty markers ("I think", "I'm not sure", "maybe", "I suspect") in
> HER turns survive distillation as hedged statements; a post-filter check rejects any distilled
> atom that raises the confidence of a hedged source turn. Pairs with her countable self-exclusion
> stubs ("Auma excluded N turns this session") — her second Brick-1 condition, also riding here.

**Brick P7 — profile + her voice in her own memory.**
`identity/PROFILE.md` owner-promoted only (suggestions land in
`profile_suggestions`); **Auma's "don't keep that"** honored via the same erase
mutation, receipted, scoped to her own statements (she cannot erase Peter's atoms) —
her answer to the ONE_BRAIN question, implemented.

**Brick U8 — the reactive UI (memory-palace seed).**
Spatial shell subscribes to `kira:recentHead`/`kira:recall`; atoms/receipts/erasures
render live. Projection is visualization, never authority. (The full 3D palace/glyph
layer waits until everything above is green.)

**PARKED (design-only, unchanged):** multi-node sync — the vendored `node_*` substrate
already implements zero-authority foreign memory and signed heads; the Nebius node
becomes a second deployment with its own chain when that track opens. Telegram-class
connectors ride the node, never the local door. No external ingress in this plan.

## 6. What carries over from ONE_BRAIN v2, and what dissolves

| ONE_BRAIN item | fate on Convex |
|---|---|
| 0a erasure scrubbing derived fields | **carries** → M2 (kernel's soft-delete is not erasure) |
| 0b content binding on verify | **carries** → M2 (kernel writes hashes, never re-checks) |
| 0c optimistic save / stale-head | **dissolves** — mutations are serializable |
| 0d quarantine-not-brick | **dissolves into schema** — filtered boolean |
| #53-parity injection hardening | **carries, ships first** (R5 pre-brick) |
| per-session rings, offRecord, speaker, distiller rules, redact-and-retry, pinned egress, atom caps, watermarks | **carry verbatim** → C6/M2 |
| enqueueKiraWrite chokepoint | **replaced** by `memoryAppend` → governed mutation |
| JSON brain as canonical | **retired** → migration M4; JSON = export/backup artifact |

## 7. Owner decisions (D1–D6) — each with a recommendation

- **D1 — Law 2 amendment text** (§4.1). *Recommend: ratify as written; it moves the
  fence instead of removing it.* Note the ring-table's own precedent: ratification was
  in-session chat approval, not AUMLOK-signed — Peter chooses which bar this change
  takes (Codex flagged the lineage question).
- **D2 — Ring promotions + `RATIFIED_TABLE_SHA256` re-pin** for the vendored kernel
  files. *Recommend: yes, Ring 1 by name.*
- **D3 — Fresh backend instance;** retire `~/aukora-convex-backend` (278 MB demo data)
  to archive; new keys under `~/.aukora-symbiote/convex/`. *Recommend: fresh — demo
  data never becomes her memories.*
- **D4 — The convex-alpha MCP cloud deployment** (`prod:<redacted-convex-deployment>`, plaintext
  deploy key at `~/convex-mcp.sh`): repoint it at the local backend,
  or declare it a non-canonical dev tool — and either way **rotate that deploy key**.
  *Recommend: repoint + rotate. Zero-cloud should include the tooling.*
- **D5 — Privacy posture** (carried from ONE_BRAIN): conversations become receipted,
  erasable atoms; distillation pinned to trusted providers. *Same yes/no as before,
  now on a better substrate.*
- **D6 — Command bars** (carried): typed `forget`, distiller-routed spoken
  "remember this," typed-only verbatim. *Recommend: unchanged.*

## 8. Codex verification checklist (merged: Auma §11 + Opus §4 + new)

1. S0 empirics: loopback bind confirmed; components + vector smoke green; zero egress
   under an outbound monitor; kill-resume with no duplicate atoms.
2. V1: vendored files pass TIER-1 secret scan; zero `"use node"` (gate test);
   `convex/` typechecks in the gate; kernel tests ported and green.
3. M2: silent-edit probe FAILS against `verifyChain`; erase scrubs value + episodeText
   + derived + embedding atomically + vacuum policy documented; quarantine filter
   proven; redact-and-retry never throws through.
4. G: no write path without manifest PoP (attempt one — prove refusal); memory cannot
   reach `self-modify`/apply lane; `CLOUD_DENY`+loopback on the WRITE client; invariant
   test rewritten and green; ring re-pin in same commit.
5. M4: 77/77 atoms migrated with binding receipts; old head committed into genesis;
   recall parity test green; brain.json frozen.
6. C6: off-record exclusion proven; speaker attribution proven; workflow resume proven.
7. Throughout: #99 fence bytes unchanged (gate integrity file), or re-pinned in the
  same commit if D4-adjacent hardening lands.

## 9. Risks (named)

- **Components-on-self-hosted is unverified officially** → S0 smoke first; if a
  component fails, fallback is scheduler+cron patterns (the kernel already has
  `crons.ts`) — slower, not blocking.
- **Version skew** (CLI vs backend) → pin both, upgrade together, export first.
- **SQLite page-retention after erasure** → vacuum policy + documented export-wipe.
- **Vendor divergence from aukora-os** → aukora-os is frozen as reference; the
  symbiote copy is THE copy; no dual-maintenance.
- **Scale**: O(n) Merkle root recompute per receipt is lab-ceiling documented in the
  kernel — fine at thousands of atoms; watermark + revisit past ~50k.
- **Egress creep** (CLI Sentry, dashboard CDN) → CI=1, Monaco-internal, outbound
  monitor in S0 acceptance; probe script in the gate.

## 10a. Adversarial review ledger (v1 → v1.1)

**Confirmed and folded in (17):** 40-not-34 tables; embedder is all-MiniLM-L6-v2 (Opus
doc's "bge-small" is wrong — fix upstream); **BLOCKER: admin key is a raw write path**
→ Law-2 honesty clause + custody/0600 + basename fence + guarantee re-scoped;
**BLOCKER: `aumlokMemoryWrite` is a PUBLIC mutation** → V1 converts all write
endpoints to `internalMutation` + gate test; token/seed same-env trust boundary
disclosed + external verifier with M4; migration provenance laundering → content
re-derivation + honest-limit receipt; erasure vs document-retention/exports → 3
retention clauses; old backend REALLY bound 0.0.0.0 → bind proof in S0 acceptance;
canonical pin (#11) never scheduled → S0 sets it; browser Convex client would bypass
guards → door-relayed SSE only; kernelAdapter silent-null + hardcoded paths + topology
registry + `mintHostApplyReceipt` → W3 exact-file list; V1 closure is ~18-20 modules
with an import cycle → cycle-cut step + 2-3 sessions; donor test harness differs
(edge-runtime/convex-test) → deliberate port; per-turn recall vs the 536ms voice
budget → ≤150ms p95 + fail-open; pm2 boot-order/degradation story added; export/spool
policies written down; admin-key basename hardening moved from "optional" to W3.

**Refuted (2):** "PoP is same-process theater" — bounded by atomically-enforced
circuit breakers (maxUses/rate windows/OCC), a real containment property, though the
trust boundary disclosure above stands; "live cloud deploy key" — the panel TESTED it:
revoked/invalid (401), deployment deleted → D4 softens to cleanup + repoint.

## 10. Non-goals (this plan)

- No hosted Convex, no external ingress, no Telegram/WhatsApp.
- No memory-derived authority, ever. No AUMLOK bypass. No session-grant expansion.
- No autonomous writes to anchor/profile.
- No multi-node activation (vendored but parked; design-only).
- No raw-transcript hoarding.

## 11. Convex self-hosted — research-support answers (2026-07-05) and how they steer the bricks

We put ten questions to Convex's research support (full Q&A archived in `docs/INBOX.md` / scratch).
Confirmed answers, and the design consequences we're adopting. Several deep internals are documented
as **OPEN → ask `#self-hosted` Discord** rather than guessed.

- **Exactly-once (C6 write path) — DECIDED.** Scheduled *mutations* are exactly-once + auto-retried;
  scheduled *actions* are at-most-once (not retried). So a workflow step `action(LLM) → mutation(append)`
  can schedule the append more than once if the action replays. **Adopt a caller-supplied idempotency
  key checked inside `memoryAppend` before insert** (a content hash or session-scoped sequence number) —
  the right design for an append-only hash-chained log regardless of the journal. This is a new W3/C6
  acceptance item.
- **Crash-recovery latency (~6 min) — OPEN + mitigated.** The docs confirm workflows resume after a
  restart but do NOT document the lease/timeout or a knob; our observed ~6-min resume (only with
  `retryActionsByDefault:true`) is unexplained. **Ask `#self-hosted`. Until confirmed, C6 keeps an
  idempotent re-drive sweep** (poll for stale in-progress workflows and nudge) rather than trusting the
  journal alone. Matches the S0 finding already in this doc.
- **Erasure vs storage bytes (M2/M4) — OPEN, and load-bearing.** `DOCUMENT_RETENTION_DELAY`, SQLite
  `VACUUM`/`secure_delete`, WAL scrubbing, and any "purge now" path are **not documented**. For a
  right-to-be-forgotten obligation we **cannot rely on Convex-level deletes alone** — M2's retention
  clauses must include an EXTERNAL SQLite-reclamation step, and this is a `#self-hosted` question before
  M4 migrates real content.
- **Backup on a sleeping laptop (nightly export) — DECIDED.** Cron/scheduled-timer behavior across host
  sleep is undocumented. **Drive nightly `convex export` from `launchd`/pm2, NOT a Convex cron.** Export
  excludes code/config, pending scheduled functions, and env vars; search/vector indexes rebuild from
  documents on import. Treat export/import as a DATA restore, not a full-state restore — **in-flight
  workflows will NOT resume after a restore; re-drive them.**
- **Programmatic invocation (retire the CLI-spawn) — VERIFY-THEN-ADOPT.** There IS a documented stable
  HTTP API — `POST /api/{query,mutation,action}` with body `{path, args, format:"json"}` and header
  `Authorization: Convex <admin-key>`; the CLI uses these under the hood. Whether internal-function
  paths are reachable this way with the admin key on self-hosted is **not explicitly confirmed** →
  empirically verify against the pinned backend, then `memoryKernelTransport` can graduate from
  `npx convex run` (per-call process spawn) to a persistent HTTP client. Big latency + trust-surface win.
- **Scoped credentials — NONE today.** No read-only/per-function keys on self-hosted; no offline-OIDC
  path documented. The door holding the admin key stays the trust boundary; keep it tightly scoped
  (the W3b transport already allows exactly one function path).
- **Vector recall (R5) — bounded.** Vector search is consistent within an action, but results passed
  to a later query/mutation may be stale (separate transactions). At 10k–50k 384-d vectors on SQLite,
  the ≤150 ms p95 budget is plausible but **must be benchmarked**. Model swap = redefine the index
  (optionally `staged:true`) → rebuilds from documents, other tables untouched. NOTE the two-round-trip
  shape: full-text search is query-side (sync) while vector search is action-side — structure recall as
  vector-in-action → ids → reactive query, exactly as R5 already specifies.
- **Version skew (ops) — DISCIPLINE.** No documented backend↔npm compatibility window; a newer binary
  may migrate the SQLite dir such that rolling BACK is unsafe. **Export before every upgrade; pin both;
  never `:latest`.** Already our rule — now sourced.
- **Door as single writer (noted).** All writes serialize through one door process (OCC). Fine at
  thousands of docs; if ever parallelized, the hash-chain append must handle OCC retry-on-conflict.
