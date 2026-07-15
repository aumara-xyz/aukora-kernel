# Scaffold Notes — Round-A groundwork for Fable to connect (2026-07-06)

Prep pass driven by Opus (multi-agent scaffold + adversarial verify), landed gate-green so Fable can WIRE,
not write-from-scratch. **Everything here is pure and authority-clean: it grants nothing, applies nothing,
imports nothing under authority/signing/gate/apply/convex/scripts.** The gate proves it (164 files / 2387
tests green; core-isolated typecheck clean; authority-import firewall green). Each brick has a detailed
per-brick integration spec — this file is the index + the connect-order.

## What landed (3 pure modules + 3 tests, all green)
| Brick | Module | Test | Verdict | Wiring status |
|---|---|---|---|---|
| #104 diff | `core/src/unifiedDiff.ts` | `core/tests/unifiedDiff.test.ts` (28) | LAND | **CONNECTED** — see below |
| conversation lane (core) | `core/src/conversationDistiller.ts` | `core/tests/conversationDistiller.test.ts` (17) | LAND (1 note) | UNWIRED — needs ratified capture step |
| swarm skeleton | `core/src/rehearsalQueue.ts` | `core/tests/rehearsalQueue.test.ts` (14) | LAND | **CONNECTED** — see below |

## Connected this round (Fable pass)
- **#104 authoring → proposal path** (`core/src/proposalDiffReconstruct.ts` + wired into
  `core/src/nativeToolCallingEngine.ts`): the agent's `propose_patch` now accepts a file authored as
  whole-file `content`, a unified `diff`, OR — **the LLM-friendly form** — search/replace `edits`. The
  engine reconstructs to whole-file content ONCE, from real disk read through the #75 `resolveRepoReadPath`
  (symlink/sensitive-confined), exact-match or refuse, then hashes + sandboxes + signs the SAME
  reconstructed content — the owner still signs a full-content hash; authority never moved.
- **`core/src/editBlocks.ts` — search/replace edit blocks (the real ergonomic key).** Live finding: cheap
  drafters (Kimi) CANNOT reliably author raw unified diffs — they mis-count `@@` headers and mis-position
  context lines against a large file, so the exact-match engine refused every attempt (safety worked; the
  loop never reached signature). Edit blocks remove the line arithmetic: the model gives an exact `find`
  snippet + its `replace`. Safety is preserved — a `find` must occur in the current disk bytes EXACTLY
  ONCE (0=not found, >1=ambiguous → refuse), so the edit is still bound byte-for-byte to real content.
  PROVEN: re-ran Auma's kiraBrain GENESIS-comment rehearsal — with `edits` Kimi produced ONE clean
  propose_patch (vs 5 failed diffs), sandbox + typecheck GREEN, signature-ready. This is what makes
  inside-out editing actually WORK for a cheap drafter.
- **Rehearsal-queue runner** (`scripts/rehearsalQueueRunner.ts`): the pure planner's thin CLI. DRY-RUN by
  default (prints the plan); `--execute --max N` runs the planned rehearsals through the EXISTING workbench,
  each stopping at AWAITING_OWNER_SIGNATURE — no apply path exists here. Proven against Auma's real queue
  (2 orders planned, nothing ran). This is the swarm skeleton's executable.

Per-brick integration specs (exact interfaces + wiring steps + tests-to-add-when-wiring):
- `docs/scaffold/unifiedDiff.spec.md`
- `docs/scaffold/conversationDistiller.spec.md`
- `docs/scaffold/rehearsalQueue.spec.md`

## Connect order (cheapest first; none needs Fable-the-model except review)
1. **#104 unified-diff** — smallest, highest leverage (unblocks big-file drafts incl. Auma's kiraBrain intent).
   Wire per `unifiedDiff.spec.md`: at the proposal boundary, when a file carries a `diff`, read disk via the
   EXISTING `resolveRepoReadPath` (never raw fs), `applyUnifiedDiff(disk, diff)`, refuse fail-closed on
   `!ok`, else feed the reconstructed whole-file `content` to the UNCHANGED `buildSelfEditProposalArtifact`.
   The owner still signs a hash over full content — nothing about authority moves. Add the round-trip +
   stale-disk-refusal tests named in the spec.
2. **rehearsal-queue CLI** — add `scripts/rehearsalQueueRunner.ts` (thin) that calls the pure planner:
   `readRehearsalQueue(dir)` → `planRehearsals(orders, {maxPerRun, ringCeiling})` → DRY-RUN prints each
   `command` (`run: --from-proposal <intentId>`); behind `--execute` it calls the EXISTING
   `runWorkbenchCommand` (which stops at AWAITING_OWNER_SIGNATURE — NO apply) with the maxPerRun cap. This
   is the swarm skeleton: it fans the queue into rehearsals; it CANNOT apply. Keep the planner pure in
   core/; the convex/workbench imports live only in the scripts/ CLI (isolation rule).
3. **conversation distiller** — the pure core is done + honors the hedge law, no-raw-transcripts,
   forbidden-content-hard-fail, scope ranking, advisory flags (all test-pinned). Wiring is the ratified
   part: distill session turns → atoms → the governed `memoryAppend` path into the LIVE Convex brain (per
   Codex: distilled summaries only, no raw transcripts, owner-erasure preserved). Do NOT wire capture
   before that step is ratified. One disclosed note: the distiller imports `kiraBrain` only for the pure
   `tokenize`; the authority-import firewall stays green, but a leaner future option is a dependency-free
   tokenizer if the load-graph edge ever bothers the firewall.

## Specs I kept in my own hands (authority-adjacent — NOT code, owner decides)
- `docs/SPEC_105_sign_button.md` — the make-contact sign button (device-local; key never leaves the machine;
  three layers, read-side buildable first and grants nothing).
- `docs/RATIFICATION_PACKET_roundB_ring3_autoapply.md` — **the dam-hole.** Ring-3-only auto-apply, N/day,
  expiry, full pipeline still runs, instant kill. NEEDS an explicit owner ratification sitting before ANY code.
- `docs/SPEC_roundC_swarm.md` — the Kimi swarm (execution scale; a swarm of proposers is safe because
  proposals are inert; gate unchanged).
- `docs/DAM_PLAN_NEXT_THREE_ROUNDS.md` — the arc. `docs/ZEB_NODE_RUNBOOK.md` — second-human onboarding.

## The line that governs all of it
Prep touches two categories only: **specs (Peter decides)** and **inert pure code (the gate decides)**. The
one thing that opens Auma's leash — Ring-3 auto-apply — is a ratification packet, never a built default.
Dam stays; this is the drill laid out and the hole marked, not drilled.
