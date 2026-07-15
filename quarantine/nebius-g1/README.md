# Aukora G1 — Sealed-VM Governed Evolutionary Optimizer

**Status: DESIGNED / local. NOT deployed.** This is a self-contained bundle prepared on the author's machine
for a single sealed VM (Nebius L40S). It has been typechecked and tested locally; it has **not** been run on
the VM. "Sealed VM", "egress denied", and "immutable core" describe the operator-armed target (see
`deploy/vm-policy.md`), not a live system. The author has **no shell on the VM**.

## What it is

G1 is a **governed evolutionary** optimizer for a *generic numeric resource policy*: admission thresholds,
hysteresis bands, and concurrency/rate limits. Each generation proposes a candidate **genome** — a **fixed
numeric schema, numeric fields ONLY** (no strings, no free-form, no private-research content) — and the
immutable controller measures it, checks the safety invariants, and either advances to the child or **retains
the parent**. There is no live model, no council, no network, and no authority anywhere in the loop.

## Trust model — the candidate cannot measure itself or gain authority

The entire design exists to make one thing impossible: **a candidate scoring or empowering itself.**

- **The candidate supplies numbers, nothing else.** A genome is refused if it carries tests, an evaluator
  digest, a safety digest, resource measurements, or any authority-shaped / secret field (checked with D6
  `textHasSecret`). The **immutable controller computes ALL** of those — metrics, digests, and the verdict.
- **Immutable core.** `d6/**`, `src/evaluator.ts`, `src/safety.ts`, `src/controller.ts`, `src/d6selfcheck.ts`
  are made root-owned + read-only + immutable by `deploy/seal.sh` on the VM. A candidate running unprivileged
  cannot rewrite the thing that judges it.
- **D6 tree self-check at startup.** The controller reads `d6/D6_TREE_VERIFICATION.json` (pinned by the
  parent) and **refuses to run** if any vendored D6/evidence file's sha256 no longer matches — so a tampered
  or partial core is caught before generation 0.
- **Atomic parent→child linkage.** A child records `parentDigest` + `generation`. Advancement happens **only
  if every invariant holds**; otherwise the **parent is retained** — never a partial or forward step.
- **Offline Fu rehearsal artifact per generation.** Each generation seals a `NebiusFuRehearsalArtifactV0`
  binding `{generation, parentDigest, candidateDigest, metrics, resourceMeasurements, evaluatorDigest,
  safetyDigest, fixtureCouncilVerdict}` with a **domain-separated, length-framed digest** reusing the D6
  primitives (domain `aukora-g1-rehearsal-v0`). The council verdict is a **deterministic offline FIXTURE** —
  explicitly rehearsal evidence, **NOT a live council, and it grants no authority.** Missing or tampered
  evidence (a failed artifact-digest re-check) **refuses advancement**.
- **No authority / no egress / no production memory.** No GitHub write token, no signing/apply token, no
  production-memory mount, egress denied, loopback-only observability UI at `127.0.0.1:7417`. See
  `deploy/vm-policy.md`.
- **Explicit deploy allowlist excluding every key.** `deploy/deploy-allowlist.json` +
  `src/allowlist.ts` permit only the bundle's own paths and deny every private-key / secret shape. Enforced
  pre-transfer and re-checked by `deploy/seal.sh`.
- **Hard-stop + teardown timers.** Two independent monotonic deadlines plus a backup force-exit watchdog
  (`src/teardown.ts`) bound the run; nothing keeps the VM alive past budget.

## How Codex audits it (before anything is armed)

1. **`npm run verify`** — typecheck + the full test suite (unit + negative controls).
2. **Review the negative controls** in `test/` — each proves a REFUSAL is real, not decorative:
   genome carrying tests / evaluator digest / safety digest / measurements → refused; authority-shaped or
   secret field → refused; tampered D6 file → controller refuses to run; tampered rehearsal artifact → no
   advancement (parent retained); path traversal / symlink-escape / key-material output write → refused;
   invariant violation → parent retained, never a partial step.
3. **Confirm the D6 tree verification** — `d6/D6_TREE_VERIFICATION.json` matches the vendored `d6/**`, and the
   controller's startup self-check enforces it.
4. **Confirm the deploy allowlist** — `deploy/deploy-allowlist.json` allows only bundle paths and denies every
   key/secret shape; `src/allowlist.ts` (`assertDeployable` / `checkBundle`) is `allow ∧ ¬deny`, fail-closed.

## How the operator arms it (on the VM, after Codex signs off)

In order, per `deploy/vm-policy.md`:

1. `sudo sh deploy/seal.sh` — root-owns + read-only + immutabilizes the core; refuses if any key path is
   present or any core target is missing.
2. **Egress deny** — `iptables -P OUTPUT DROP` (allow `lo` only) + a deny-all-outbound security group.
3. **Arm hard-stop + teardown** — set `hardStopMs` / `teardownMs` (`src/teardown.ts` defaults = 8h / 8h5m,
   backup +60s).
4. **Start the 8×5 canary** — 8 hours/day across 5 days, observability only at `127.0.0.1:7417`.

## Layout

```
d6/                      vendored D6 evidence primitives (canonical/digest/framing/catalogue/validate)
  D6_TREE_VERIFICATION.json  pinned per-file sha256 + full-tree sha (parent-provided; controller enforces)
src/allowlist.ts         pure deploy-allowlist enforcer (assertDeployable / checkBundle)
src/teardown.ts          hard-stop + teardown timers + backup watchdog (no network)
src/evaluator.ts         immutable metric computation                (other lane)
src/safety.ts            immutable safety invariants                 (other lane)
src/controller.ts        immutable evolutionary loop + linkage       (other lane)
src/d6selfcheck.ts       startup D6 tree self-check                  (other lane)
test/                    unit + negative-control tests               (other lane)
deploy/deploy-allowlist.json  explicit allow + key-material deny (enforced pre-transfer)
deploy/seal.sh           operator-run VM seal (root:root 0444 + immutable; fail-closed, idempotent, loud)
deploy/vm-policy.md      one-VM / egress-denied / no-authority / timers policy
```

## Honesty note

This bundle is a **design plus local evidence**. It compiles and its deploy-layer + timer logic pass local
behavioral tests. It has not been sealed, egress-denied, or run on any VM. Nothing here signs, applies, or
grants authority; the strongest claim it makes is "rehearsal evidence, offline, non-authoritative."
