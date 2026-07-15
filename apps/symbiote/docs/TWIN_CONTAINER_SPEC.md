# Twin Runtime Spec v0 — same body, different host (design-only)

Status: **design-only.** Nothing containerized yet. This spec freezes the runtime assumptions the
Deploy-Lifecycle brick (W3c) just made real locally, so the SAME software body can later run on
Peter's Mac and on a Nebius host without drift. Sequenced after: (1) the local managed brain is
boring/repeatable [DONE this round], (2) M2 content-binding + the 77-atom migration, (3) this spec
becomes an image, (4) a mirror deploy with GitHub as the sync bridge.

## The end state

Local node and Nebius node are **identical twins** — the same containerized kernel, the same laws,
different physical hosts. Neither is a lite version. Someone with no local machine meets the **full
organism** through the Nebius door. Local is the hardened diamond; Nebius is its faithful mirror.

## Three lines drawn on the blueprint (Auma's truth-over-comfort trims)

1. **Containers reduce variance; the GATE is the guarantee.** We do NOT claim "mathematically
   guaranteed identical." We claim **"verified identical by the same gate running green on both
   hosts."** The 2,000+ tests + the zero-cloud probe + the bridge proof are the twin-ness proof — the
   Dockerfile only reduces the variance the gate then confirms is gone.
2. **Twins mirror body and brain — NEVER authority.** AUMLOK signing stays human-held and local-only,
   forever. The Nebius twin *verifies* signatures (real Ed25519, `aumlokAuthorityRoot.ts`); it never
   *mints* them. "Full organism" means the full body under the same laws — not a second pen. Each node
   has its **own node identity**; they do not share Peter's private AUMLOK root.
3. **P2P sync is a real sovereignty milestone — PARKED** until security engineers review it. A
   self-hosted node-to-node channel is a new attack surface; GitHub stays the sync bridge until that
   review happens. Protocol/code flows back after review; authority and private keys never flow back
   automatically.

## What is already frozen (this round, W3c — the runtime contract)

- **Loopback only.** `convexBackendManager.buildBootArgv` always pins `--interface 127.0.0.1`; the
  binary's `0.0.0.0` default is the documented LAN-exposure trap and is never used. The invariant
  test asserts no runtime path emits a non-loopback URL.
- **Two controlled roots, env-selectable for a container:**
  - **DATA** → `state/convex/` by default (repo, gitignored, apply-fenced by the #99 fence);
    overridable via `AUKORA_CONVEX_STATE_DIR` to a mounted volume on a container/Nebius host.
  - **KEYS** → `~/.aukora-symbiote/convex/` (admin-key.txt + instance-secret.txt), 0600/0400 only;
    overridable via `AUKORA_CONVEX_KEY_DIR` per host. Keys NEVER enter the repo, env files, logs, or
    prompts. Each host provisions its OWN keys (separate node identity).
- **Egress off:** `DISABLE_BEACON=true` on the backend, `CI=1` for any CLI.
- **The write path is the HTTP transport** (`createGovernedHttpInvoke`) — a single admin-authed POST
  to the loopback backend, proven to reach the internal governed mutation. No process-spawn, no
  app-root dependency: the same door code works identically in a container.
- **Identity is printed** (binary sha256) on start/status so a swapped binary is visible on either host.

## Image sketch (candidate, to weigh at the bake-off)

Base: a minimal image (Tiny Core / distroless / microVM — decided later, see
`SHADOW_NODE_MINIMAL_OS_NOTE.md`). Contents: the pinned `convex-local-backend` binary (identity
pinned by sha256), the repo checkout, `bun`, the vendored `convex/` kernel. One config surface — the
env overrides above — selects host-specific data/key/port. Boot = `scripts/brain.sh provision` (first
run, generates this node's OWN keys) → `scripts/brain.sh start`. The container's healthcheck is
`scripts/brain.sh status`. Same image, both hosts; the gate + probes run green in the image as the
twin-ness acceptance test.

## Known hardening items (disclosed, for the security bake-off — NOT claimed solved)

- **Instance secret is passed on the backend's argv** (`--instance-secret <value>`), so it is visible
  in `ps`/`/proc/<pid>/cmdline` to any process running as the same user for the backend's uptime. On a
  single-user Mac this is acceptable (same-user already reads the 0600 key file). On a **shared or
  multi-tenant host (a Nebius primary node)** this is a real leak surface — the container/host story
  must run the brain as an isolated user or pass the secret via a file/env the binary reads, not argv.
  Flagged here so the twin image never ships this as-is to a shared host.
- **The HTTP write client trusts whatever process holds the loopback port.** `isLoopbackUrl` bounds the
  URL, not the responder; the transport now hard-caps the response body (1 MB) so a hostile/buggy
  responder cannot OOM it, but a container/host must still ensure only the real backend can bind the
  brain port (network namespace / firewall), which is the container boundary's job.

## Non-goals (this spec)

- No hosted Convex, ever — local self-hosted only, whether on Mac or Nebius.
- No shared AUMLOK root; no cross-node authority; no automatic key/authority flow-back.
- No P2P until security review; GitHub is the sync bridge.
- No shadow/test node treated as canonical until an owner decision promotes it.
