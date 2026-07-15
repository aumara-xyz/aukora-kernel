# LOCAL CONVEX S0 — spike results (2026-07-05)

**Verdict: GO for S1 (vendor brick)** — with two carried caveats (below).
Run by Fable in a throwaway dir (`scratchpad/s0/`, fresh SQLite, NOT the old
`~/aukora-convex-backend` demo data). Nothing canonical was touched; no laws changed.

## Setup (exact)
- Release pinned: **`precompiled-2026-06-09-b6aaa1a`** (GitHub API "latest" on
  2026-07-05; note the research had seen a 07-03 tag — releases move; we pin by tag).
  Binary: `convex-local-backend-aarch64-apple-darwin.zip` (~165 MB).
- Boot: `DISABLE_BEACON=true ./convex-local-backend --interface 127.0.0.1
  --instance-name aukora-s0 --instance-secret $(openssl rand -hex 32)` in a
  throwaway data dir. CLI: npm `convex@1.42.1`, `.env.local` with
  `CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210` + admin key, `CI=1` on every call.

## PROVEN (each empirically, this machine)
1. **No account, no login, no cloud.** Full lifecycle (boot → keygen → deploy →
   run → kill → restart) with zero Convex-account interaction.
2. **Loopback-only bind works.** `lsof`: `127.0.0.1:3210` + `127.0.0.1:3211` only.
   (The flag is mandatory — default is 0.0.0.0, and the OLD backend's log proves it
   really bound 0.0.0.0 when unset.)
3. **Admin key generation is LOCAL and needs no cargo/docker:** the binary has a
   `keygen admin-key --instance-name … --instance-secret …` subcommand →
   `aukora-s0|<hex>` format. (Plan/foundation docs had assumed a from-source
   keybroker step — simpler in reality.)
4. **Components DEPLOY AND RUN self-hosted** (the one officially-undocumented claim):
   `@convex-dev/workpool` (instantiated `maxParallelism: 1` — the pen) and
   `@convex-dev/workflow` both installed via `convex.config.ts` and executed. The
   `/api/deploy2/evaluate_push` component endpoint exists on this release; CLI
   1.42.1 vs backend 2026-06-09 showed no skew failure.
5. **Serializable mutations:** sequential appends produced seq 1,2 via index reads
   inside mutations — the single-writer property M2 relies on.
6. **Scheduler works:** `ctx.scheduler.runAfter(0, …)` fired (`scheduled-fired` row).
7. **Workpool works:** 3 enqueued jobs all executed in order through the
   maxParallelism:1 pool.
8. **Vector search works self-hosted:** 384-d `vectorIndex` accepted at deploy;
   `ctx.vectorSearch` in an action returned nearest rows correctly.
9. **Zero observed egress:** with `DISABLE_BEACON=true` + `CI=1`, `lsof` sampling of
   the backend process across the whole spike showed **no non-loopback TCP
   connection at any point**. (Method: point-in-time sampling, not a packet capture
   — a pf/Little Snitch audit remains a nice-to-have for Brick G.)
10. **Kill -9 / restart / durable resume:** a workflow killed mid-action (8s sleep
    step) **RESUMED and completed after restart** — but see caveat 1.

## CAVEATS / FINDINGS (carried into the plan)
1. **Crash-resume works on a MINUTES timescale, not seconds.** With
   `retryActionsByDefault + maxAttempts:5`, the killed workflow did NOT resume within
   ~60s; it completed when re-checked at ~6 minutes (recovery/lease timers). Without
   retry config, the killed action never resumed at all (default is at-most-once —
   correct behavior, but it means **C6 capture MUST set explicit retry behavior AND
   keep an idempotent re-drive sweep**; "crash-safe" is real but lazy, and session
   flushes should tolerate a multi-minute recovery gap).
2. **First deploy error worth knowing:** top-level `await` in a function file is
   rejected at push analysis (`InvalidModules`). Fine — but it means vendored kernel
   files get analyzed strictly at deploy; V1 should expect push-analysis to catch
   donor-repo idioms.

## Probe + gate wiring
- `scripts/check_no_cloud_convex.sh` run: **green** (no hosted Convex reference in
  the brain path; loopback URLs only).
- Wiring it into the gate: **documented, not done** — `scripts/test.sh` is the
  Fusion-Council-amended truth gate; adding steps to it is core-lane/Codex territory.
  The wiring point is one line after the typecheck block:
  `bash "$REPO/scripts/check_no_cloud_convex.sh" || exit 1`. Codex lands it.

## Go/no-go
**GO for S1** (vendor brick), per plan v1.2 order: S1 starts only now that this doc
exists. The spike dir is throwaway; the backend process was stopped after the run.
Nothing here granted authority, wrote canonical memory, or touched Law 2.
