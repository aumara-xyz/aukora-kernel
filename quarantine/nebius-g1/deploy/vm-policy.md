# G1 Sealed-VM Policy

Status: **DESIGNED / prepared locally.** Not deployed. This document states the policy the operator arms on
the VM; the author of this bundle has **no shell on the VM** and cannot change anything after handoff.

G1 is a *governed evolutionary* resource-policy optimizer. The candidate genome carries **numeric fields
only** (admission thresholds, hysteresis bands, concurrency/rate limits). The whole point of the sealed VM
is that **the candidate cannot measure itself and cannot gain authority**: the immutable controller computes
every metric, digest, and verdict; the genome supplies none of them.

## One VM, egress DENIED

- **Exactly one VM** (Nebius L40S). No horizontal fan-out, no worker pool, no second host.
- **No outbound network.** Egress is denied at the host and at the cloud security group:
  - Host: default-DROP on `OUTPUT`, e.g. `iptables -P OUTPUT DROP` with only `lo` allowed
    (`iptables -A OUTPUT -o lo -j ACCEPT`). No DNS, no HTTP(S), no package installs at runtime.
  - Cloud: the security group has **no egress rule** (deny-all outbound). Ingress limited to the operator's
    admin path only.
  - Rationale: the candidate cannot exfiltrate, cannot phone home, cannot fetch code or tests, cannot reach a
    live council. Every input it sees is what the operator staged and sealed.
- **Loopback-only UI** at `127.0.0.1:7417`, observability ONLY. It renders generation/metrics/verdicts; it
  exposes no mutate/apply/sign control and binds to loopback so it is unreachable off-box (egress is denied
  regardless).

## No authority on the box

- **No GitHub write token.** The bundle cannot push, open PRs, or write to any repo.
- **No signing / apply token.** No Ed25519 authority key, no apply capability, no ratification path. G1
  produces *rehearsal evidence*, never a signed or applied change.
- **No production-memory mount.** The production Aukora brain / memory is never mounted, copied, or reachable.
  G1 runs against staged fixtures only.
- **No key material at all.** `deploy/deploy-allowlist.json` explicitly denies every private-key / secret
  shape (`*.key`, `id_rsa*`, `id_ed25519*`, `.ssh/**`, `*.pem`, `.env*`, `*secret*`, `authority-*.key`), and
  `deploy/seal.sh` refuses to seal if any such path is present.

## Immutable core (sealed by the operator)

`deploy/seal.sh`, run as root on the VM, makes the following **root-owned (0:0), read-only (0444), and
immutable** (`chattr +i` on Linux; `chflags uchg` on macOS for local dry-runs):

- `d6/**` — the vendored D6 evidence primitives (canonical/digest/framing/catalogue/validate).
- `src/evaluator.ts`, `src/safety.ts`, `src/controller.ts`, `src/d6selfcheck.ts` — the immutable measurement
  + governance core.

The candidate genome is **data**, not code, and is never part of the immutable core. Because the controller
is immutable and root-owned, a candidate running unprivileged cannot rewrite the thing that measures it.

## Startup self-check (belt AND suspenders)

Even with the OS-level seal, the controller **re-verifies the D6 tracked tree at startup** against
`d6/D6_TREE_VERIFICATION.json` (per-file sha256 + full-tree ls-sha) and **refuses to run** if any vendored
D6/evidence file no longer matches. Tampering with the immutable core (or an incomplete seal) is caught before
the first generation.

## Hard-stop + teardown timers

Two **independent** deadlines plus a backup watchdog (`src/teardown.ts`):

1. **Hard-stop deadline** — monotonic (`performance.now`, immune to wall-clock steps). The controller loop
   calls `shouldStop(now)` before each generation and stops advancing once passed.
2. **Teardown deadline** — an independent timer that aborts and tears down the process regardless of the loop.
3. **Local teardown backup** — a separate watchdog that force-exits (exit 137) if the primary teardown did not
   complete (threw, hung, or never fired). No single failure keeps the VM alive past budget.

Suggested canary budget: **8×5** — 8 hours of run per day across 5 days, hard-stop per session with teardown 5
minutes after, backup 60 seconds after teardown. The operator sets the exact `hardStopMs` / `teardownMs`; the
defaults live in `src/teardown.ts` (`DEFAULT_HARD_STOP_MS`, `DEFAULT_TEARDOWN_MS`, `DEFAULT_BACKUP_GRACE_MS`).

## Chain of custody

1. Bundle is **prepared LOCALLY** (this repo) — designed, typechecked, unit + negative-control tested.
2. **Codex audits** it before anything is armed (see `README.md` → "How Codex audits it"): `npm run verify`,
   review the negative controls, confirm the D6 tree verification + deploy allowlist.
3. The **operator** stages the audited bundle on the VM and runs, in order:
   `deploy/seal.sh` → egress-deny (iptables + security group) → arm hard-stop/teardown → start the 8×5 canary.

The author cannot perform step 3 and does not claim to have. This bundle is a *design + local evidence*
artifact; "sealed VM" describes the operator-armed target, not a running system.
