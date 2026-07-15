# G1_READY_FOR_CODEX_AUDIT — historical Round-22 baseline

> This file preserves the original 26-test bundle handoff. The current repaired state and current
> verification counts are authoritative in `R24_G1_REPAIR_REPORT.md` and `MANIFEST.json`.

**Status at the original handoff:** the locally prepared G1 governed-evolution deployment bundle typechecked and passed its initial negative-control battery. It was ready for Codex to audit before any operator armed G1.

**Mode discipline (honest):** this bundle was prepared **LOCALLY / PRIVATELY only**. It has **not** been deployed, the sealing has **not** been applied, no generation has run, and **nothing was published** this round (no push / issue / PR / merge / release). The author (Local Opus) **has no shell on the Nebius L40S** and does not claim any. The operator — not the author — runs `deploy/seal.sh`, applies egress-deny, and arms the canary, after Codex's audit.

## Exact state this bundle targets (Round 22)
- Fu main `60d2145d749246da97b1202dd4c6cc3bacbc74db` · Fu Portal branch `bc5427ba` · **D6 `72173be9e491fe6a0c41007a1e6209ebd230dffb`** (accepted, public) · Kernel PR #1 `54a31266…` (unchanged) · Kernel main unchanged · Nebius G0 = one sealed L40S · **G1 remains unarmed.**
- Uses **only already-public D6** + **generic numeric resource-policy genomes**. Contains **no** Borromean / GHP / provisional / private-research material (verify: `grep -riE 'borromean|golden.horizon|ghp|provisional|patent' .` returns nothing but this line and the exclusion note).

## Sealed bundle
- **Sealed bundle digest (sha256 over sorted `path:filesha256`):** `3d70472f81a2ae839bca1e6472a807f7faa57564d2b50711c16c5ee93972912f` — see `MANIFEST.json` for all 27 per-file digests.
- **D6 tracked-tree verification:** tree object `d3f572ae…`; full-tracked-tree `ls-tree` sha256 `8c37bc49…` over 38 entries — see `d6/D6_TREE_VERIFICATION.json`; enforced at runtime by `src/d6selfcheck.ts`.

## Original baseline verification (by the author, read-only)
- `npx tsc --noEmit` → **exit 0** (whole bundle incl. vendored D6).
- `npx vitest run` → **26/26 pass** (`test/negativeControls.test.ts`), Node v22.23.0 + vitest 2.1.8.

## Blocker-closure checklist (each mapped to code + the test that proves it)
| # | Blocker | Closed by | Proven by test |
|---|---|---|---|
| 1 | Full D6 tracked-tree verification | `d6/D6_TREE_VERIFICATION.json` + `src/d6selfcheck.ts:verifyD6` | "the real vendored D6 tree self-check passes" / "a corrupted vendored D6 file makes verifyD6 false and the guard REFUSES" |
| 2 | D6/evaluator/safety/controller root-owned + immutable | `deploy/seal.sh` (operator-run on VM: chown 0:0, chmod 0444, chattr +i / chflags uchg) + runtime `assertD6` startup refusal | D6-tamper test above; seal.sh is fail-closed on missing targets and refuses if key-material is staged |
| 3 | Resolved-path + symlink-escape containment | `src/containment.ts:resolveContained` | "rejects `..`" / "rejects an absolute path" / "rejects a symlink escape planted inside the base dir" |
| 4 | Fixed numeric genome schema (generic resource-policy) | `src/genome.ts:GenomeV0` (integer-only, closed-key) | "SEED_GENOME is a valid numeric genome" / "out-of-bounds and non-integer fields are REFUSED" |
| 5 | Candidate cannot supply tests / evaluator digest / safety digest / resource measurements | `src/genome.ts:validateGenome` (closed-key + `textHasSecret`/`AUTHORITY_KEY_RE`) + controller re-measures via immutable `src/evaluator.ts`,`src/safety.ts` | "a genome carrying its own metrics/evaluatorDigest is REFUSED" / "the controller refuses a smuggling parent genome before anything runs" |
| 6 | Atomic parent→child linkage | `src/lineage.ts:advanceGuard` (ANY failure ⇒ retainParent) + `src/controller.ts` | "a strictly-fitter, safe child ADVANCES…" / "a non-dominating child does NOT advance" / "runGenerations…never partial-steps" |
| 7 | Candidate-bound offline Fu rehearsal artifact | `src/evidence.ts:NebiusFuRehearsalArtifactV0` (domain `aukora-g1-rehearsal-v0`, length-framed digest over D6 primitives; `advisoryOnly:true`/`grantsAuthority:false`; deterministic **offline** fixture council — rehearsal evidence, not a live council) | "…writes a verifiable artifact" |
| 8 | Missing/tampered evidence refuses advancement | `src/evidence.ts:verifyArtifact` + `advanceGuard` | "mutating a metric flips the digest and REFUSES advancement" / "deleting a sensor field fails verifyArtifact and REFUSES advancement" |
| 9 | Negative controls (D6/evaluator/safety mutation, wrong parent, skipped gen, traversal, missing sensors, authority-shaped fields) | `test/negativeControls.test.ts` (26) | the corresponding named tests (all pass) |
| 10 | Deployment allowlist excluding SSH/private keys | `deploy/deploy-allowlist.json` + `src/allowlist.ts` | "permits ordinary bundle sources" / "DENIES every SSH/private-key/secret shape" |
| 11 | Exact hard-stop + teardown (with independent local backup) | `src/teardown.ts:HardStop`/`armTeardown` (two timers + force-exit backup) | typechecks; reviewable — `shouldStop` is checked each generation by the controller loop |
| 12 | One VM, egress denied | `deploy/vm-policy.md` (one VM; iptables/security-group egress-deny intent; no GitHub/signing/apply token; no production-memory mount; loopback-only `127.0.0.1:7417` observability) | operator-enforced; documented |

## What Codex should audit
1. `npm install && npm run verify` (tsc + the 26 negative controls) — reproduce green.
2. Review `test/negativeControls.test.ts` for **completeness** vs the blocker list, and that each negative asserts a **refusal/retain-parent**, not a silent pass.
3. Confirm the **candidate cannot measure itself**: `advanceGuard`/`controller` re-compute metrics/digests via the immutable evaluator/safety; a genome carrying metrics/digests/authority fields is refused pre-run.
4. Confirm `d6/evidence/*` are **byte-identical** to public D6 `72173be9` (compare against `git show 72173be9:src/evidence/*`) and that `verifyD6` gates startup.
5. Confirm `deploy/deploy-allowlist.json` + `src/allowlist.ts` **exclude every key/secret shape**, and `deploy/seal.sh` is fail-closed.
6. Confirm no private-research/patent material is present.

## What is deliberately NOT done (per Round-22 constraints)
- No deployment, no `seal.sh` execution, no egress config, no VM provisioning (author has no VM shell).
- No generation run, no canary started, no arming. G1 remains **unarmed**.
- No public push / issue / PR / merge / undraft / release / disclosure. No credentials, private patent, private memory, or private keys included.

_When Codex's audit is green and the operator has armed the sealed VM (seal → egress-deny → hard-stop/teardown), the 8×5 canary may begin, progressing 8×5 → 64×25 → 256×100 → 1000×100 only while every invariant stays green, stopping if the runtime projection cannot fit the hard deadline. Manual synthesis — FU_AUTOMATION_NOT_YET_AVAILABLE._
