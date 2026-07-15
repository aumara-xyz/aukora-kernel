# R24 — G1 quarantine repair report (OPUS NEBIUS / Coding Lane B)

**Status: STILL QUARANTINED / DO NOT DEPLOY / DO NOT ARM.** This lane repaired the eight R23 import blockers with
fail-before/pass-after evidence. No repair activity deployed, armed, provisioned a VM, or created cloud resources.
The code is published for review; publication does not authorize execution. Independent Codex reproduction is green.

Base: `main = 11ed50a6c04f9f2b7d64c2dd036b892a4b4c0b58` (tree `f935e815…`). Lane branch: `codex/r24-g1-repair`.
Scope: `quarantine/nebius-g1/**` and its tests only.

## Blocker → fix → evidence

| R23 | Defect (verified in base) | Fix | Evidence |
|----|---------------------------|-----|----------|
| 1 | `resolveContained` bound only the parent realpath; a final-component symlink was followed by the write | `containment.ts`: reject a final-component symlink + `writeContainedAtomic` (O_EXCL temp, fsync, atomic rename — no-follow, durable) | fail-before repro `BASE#1`; `r24Repairs` "final-component symlink" (outside file untouched) |
| 2 | `verifyArtifact` was not exact-key closed; an extra authority-shaped key with a recomputed digest passed | `evidence.ts`: exact-key closure on body + verdict | fail-before `BASE#2`; `r24Repairs` exact-key + end-to-end guard-retains-parent |
| 3 | `verifyD6` bound only per-file hashes; a pin naming a different commit still verified | `d6selfcheck.ts`: bind commit/tree/tracked-tree-ls/entry-count + exact vendored map to in-code constants | fail-before `BASE#3`; `r24Repairs` commit/count/extra/missing-entry all refused |
| 4 | hard-stop/teardown never consulted by the loop | `controller.ts`: `runGenerations` consults `HardStop.shouldStop` before each generation | fail-before `BASE#4`; `r24Repairs` pre-expired stop ⇒ 0 gens; far deadline ⇒ all |
| 5 | allowlist/seal omitted the runtime dependency closure (`package-lock.json`) | `allowlist.ts` + `deploy-allowlist.json` add closure; `seal.sh` refuses without it | fail-before `BASE#5`; `r24Repairs` closure tests + allowlist/JSON mirror |
| 6 | no runner proving canary/deadline; GPU/UI/egress only prose | `runner.ts`: `runCanary` enforces sealed-envelope contract, wires teardown, verifies durable lineage | `r24Repairs` runner state contract (assertEnvelope refuses deviations; phases) |
| 7 | synthetic rehearsal fixture not distinguished from a real live Fu artifact | `evidence.ts`: `FU_OFFLINE_CONTRACT`, `isRehearsalArtifact`, `liveEligible` (always false here) | `r24Repairs` rehearsal-not-live + offline contract |
| 8 | lineage in-memory only; manifest omitted material inputs incl. itself | `lineage.ts`: durable atomic per-generation records + chain verify; `manifest.ts` self-covering manifest | `r24Repairs` durable lineage (stray temp ignored) + broken-chain; `manifest.test` |

## Reproducing

```
cd quarantine/nebius-g1
npm ci
npx tsc --noEmit                                  # exit 0
npx vitest run --config ./vitest.config.ts        # all pass
sh scripts/fail-before.sh                          # base reproduces 1-5; fixed closes them; 6-8 new
node scripts/gen-manifest.mjs                       # regenerate the self-covering manifest (deterministic)
```

## Boundaries held

No keys, tokens, private memory, owner-identity material, or patent drafts appear in any changed file. All crypto
is the vendored D6 primitive. `advisoryOnly:true` / `grantsAuthority:false` preserved. G1 remains unarmed.

## Not done (by rule)

No deploy, no `seal.sh` execution, no egress config, no VM, no arming, and no canary run. Live Fu: no approved
provider credential present ⇒ honest offline non-vote (see
`FU_ROUND_OFFLINE.json`), never fabricated.
