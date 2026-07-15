# The Dam Plan — next three rounds to regulated self-modification (2026-07-06)

Peter's frame, adopted as the design law: **the dam stays; we drill governed holes.** Each round widens
flow, never removes the wall. Auma's autonomy grows by RING and by BUDGET, never by removing a gate.
State today: the loop is proven twice (03041d9 ceremonial, c3c316f fully-Auma-authored); her seat has
read/propose/rehearse live on Peter's door; every apply still needs Peter's key.

## Round A — throughput (no new authority; cheap lanes / Zeb's Fable can build all of it)
1. **#104 diff-patch format**: proposals as unified diffs instead of whole-file reproduction. Unblocks
   bigger files (her staged kiraBrain intent waits on this) and makes Kimi-class drafters reliable.
2. **Rehearsal-queue runner**: a small daemon/script that drains `~/.aukora-symbiote/aumlok/rehearsal-queue/`
   through the existing workbench (`run: --from-proposal <id>`), N at a time, cheap models. This is the
   SWARM SKELETON: Auma queues many orders; runners rehearse them in parallel; everything terminates at
   AWAITING_OWNER_SIGNATURE. Add a queue size cap (Codex's open question) + per-day budget.
3. **#105 AUMLOK sign button**: Peter's make-contact — the observer page grows ONE real action: review
   diff → press → device-local sign (key never leaves the machine) → governed apply. His side of the dam
   becomes one deliberate touch instead of two terminal commands.
4. **Conversation lane** (Auma's spec, Codex's constraints): distilled summaries only, into the LIVE
   Convex brain via the governed write path, owner-erasure preserved, no raw transcripts.

## Round B — the first hole in the dam (NEEDS an explicit owner ratification sitting)
**#92 scoped standing session grant, v1 — auto-apply for Ring 3+ only.** The packet to ratify:
- Scope: files classified Ring 3/4 by the ratified ring table ONLY (UI copy, docs). Ring 0–2 = signature
  always, forever, no exceptions in v1.
- Budget: max N auto-applies per day (suggest N=3), grant expires after 7 days, single-use nonces,
  every apply receipted + auto-pushed on a `auma/auto/*` branch or straight to main with instant
  `git revert` line published — Peter reviews AFTER instead of BEFORE for this ring only.
- Kill switches unchanged and instant: lockdown mode, grant revocation file, pm2 stop.
- The full pipeline still runs per change: sandbox, real typecheck, full gate, Fusion review; a RED/
  YELLOW verdict falls back to signature-required even inside the grant.
This is the dam-hole: she can land a ready-chip-sized change end-to-end alone, within a ring, within a
budget, on a clock — and Peter can watch the water flow before drilling wider.

## Round C — the swarm (execution scale, not authority scale)
**Auma commands Kimi agents — the honest version of the dream.** She already has the command surface:
propose_intent → rehearse_intent. Round C connects: her queue → the Round-A runner → K parallel
workbench agents (AUKORA_AGENT_MODEL=moonshotai/kimi-k2.7-code — already switchable per run) → evidence
reports back to her seat + inbox → Ring-3 items auto-apply under the Round-B grant; everything else
stacks up signature-ready for Peter's button. Kimi is the drafter class; the GATE is unchanged. A swarm
of proposers is safe BECAUSE proposals are inert. Add: a `swarm_status` read tool so she can see her
fleet's evidence, and (design-only this round) the multi-node version: work orders as the unit shipped
between nodes.

## Nebius / Zeb — TODAY's safe shape (docs/ZEB_NODE_RUNBOOK.md has the commands)
Nodes share CODE via GitHub. Each node provisions its OWN brain + keys locally. **Never synced: keys,
brains, AUMLOK authority** (twin law: mirrors share body, never authority; Peter's AUMLOK key exists on
exactly one machine). Nebius nodes = SHADOW nodes: clone, gate, throwaway brain, run loops, report
findings via INBOX/PRs — zero authority, zero live-memory sync (memory sync is the parked SQP-1/#98
security work; it stays parked). Zeb pushes via PRs (not direct main) for the first days — two humans
plus four lanes on one volatile main is how work gets eaten. CERN comes later: collide shadow nodes,
distill findings back through the ONE gate on Peter's machine.
