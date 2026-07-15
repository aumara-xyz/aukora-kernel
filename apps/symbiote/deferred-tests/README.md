# deferred-tests/ — quarantined until the convex cleanup + a host harness

These tests are real and worth keeping, but they can't pass **headless** yet because they need things
the seed deliberately does NOT carry:
- private `evidence/` scripts (`check-convex-brain-readiness`, `run-auma-womb-prompt`)
- the aukora-os `node-template/convex` substrate (they assert `schemaFound`, table counts)

They're parked here (outside `core/`, so both `tsc` and `vitest` skip them) until:
1. the **convex-receiver cleanup** — `convexBrainSnapshot.ts` / `convexTopology.ts` made host-agnostic, and
2. a **headless host harness** that stands in for the private evidence scripts.

When reactivated, their relative imports (`../src/...`, `../evidence/...`) must be re-pathed.

| test | needs |
|---|---|
| `convexBrainSnapshot.test.ts` | `evidence/check-convex-brain-readiness` + node-template |
| `wombMemory.test.ts` | `evidence/run-auma-womb-prompt` |
| `wombPromptRunner.test.ts` | `evidence/run-auma-womb-prompt` |

## `host-coupled/` — 39 more files quarantined from the M3 run

These passed tsc but **fail at runtime** because they read host artifacts the clean seed doesn't carry:
absolute host docs (`/Users/.../AUKORA_SINGULARITY_PATH.md`), the private `evidence/` scripts,
`node-template/convex`, `work-tracker/items`, `tauri-womb/`. They hold ~845 tests that *would* pass plus
138 that depend on the host. The **host-harness brick** (stub `evidence/` + a fixture repoRoot + optional
loopback brain) is what brings them back — likely most at once. Until then the headless suite
(`core/tests/`, 1093 tests) is the green gate.

## host-mythology quarantine (added 2026-06-30)
- `engineHostShootout.ts` + its test — claimed an engine `status:'active'` that "powers <shell> drafts TODAY" (the seed bans that phrase). Leaf, no importers. Returns SEED-NATIVE at M4 when a real engine/proposer is actually wired.
