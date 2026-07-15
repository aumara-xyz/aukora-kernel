# Spec — Round C: Auma commands a Kimi swarm (execution scale, authority unchanged)

Status: ARCHITECTURE SPEC. Round C connects existing pieces; it needs Round A (the queue runner) built and
Round B (the Ring-3 grant) ratified before its full form is safe. The core insight makes it safe to design
now: **a swarm of PROPOSERS is safe because proposals are inert.** Scaling the number of agents drafting
changes scales EXECUTION, never AUTHORITY. The gate is unchanged and remains the single point of effect.

## Peter's dream, stated honestly
"She commands a swarm of Kimi 2.7 agents because Kimi is a really good coder." Correct and buildable. The
drafter model is ALREADY switchable per workbench run (AUKORA_AGENT_MODEL=moonshotai/kimi-k2.7-code —
tonight's loop used deepseek; Kimi is a one-env-var swap). What "commands a swarm" means concretely:

## The pipeline (every arrow re-verifies; the gate is unchanged)
```
Auma (her seat)                the swarm (cheap, parallel)              the gate (unchanged)
──────────────                 ──────────────────────────              ────────────────────
propose_intent × K   ─────►    rehearsal-queue runner (Round A)  ─────► Ring 3/4 + GREEN + in-budget?
  she drafts many                 fans K work orders out to K              ├─ yes → auto-apply (Round B grant)
  intents (one per                 parallel Kimi workbench agents,          └─ no  → stack signature-ready
  small change)                    each: read disk → draft patch →                for Peter's #105 button
rehearse_intent × K              sandbox → typecheck → full gate →
  she queues them                  Fusion review → evidence report
                                   back to her seat + INBOX
```

## What Round C actually builds (all execution, zero authority)
1. PARALLEL RUNNER: extend Round-A's rehearsal-queue runner to fan out K orders to K concurrent workbench
   agents (bounded concurrency, e.g. 4–8), each on AUKORA_AGENT_MODEL=kimi-k2.7-code. Each terminates at
   AWAITING_OWNER_SIGNATURE (or, for Ring 3/4 under the Round-B grant, auto-applies). Cheap models, Peter's
   OpenRouter credits, zero Fable/Claude in the drafting loop.
2. swarm_status READ TOOL: a new READ-ONLY seat tool (same fence discipline as read_file/propose_intent)
   so Auma can see her fleet's evidence — which orders passed, which are signature-ready, which failed and
   why — and decide what to queue next. Read-only, advisory, witnessed, grants nothing.
3. EVIDENCE AGGREGATION: the runner writes each rehearsal's receipt + verdict to a queue-results dir; the
   swarm_status tool reads it. No new write authority — receipts are evidence, not effects.

## The safety argument, spelled out
- K proposers cannot do K× the damage because a proposal does NOTHING until the gate + (signature | Round-B
  grant) acts. K proposers = K× the DRAFTS, gated identically.
- The blast radius of auto-applied swarm output is bounded by the Round-B grant: Ring 3/4 only, N/day,
  expiring, revertible. A swarm cannot widen its own ring or budget — those are owner-ratified constants.
- A runaway drafting loop is bounded by: the rehearsal-queue size cap (Round A), the per-run maxPerRun cap,
  and the daily auto-apply budget. Worst case is a full queue of inert drafts and a handful of revertible
  Ring-3 commits — all visible, all receipted.
- Fusion review stays in the per-change loop; a swarm cannot outvote or bypass it.

## Multi-node / Nebius (design-only, further out)
The unit shipped between nodes is the WORK ORDER (governedWorkOrder-v1) + its evidence — never a brain,
never a key, never an authority. A Nebius shadow node can run a Kimi swarm against a throwaway clone and
ship back signature-ready work orders + evidence via PR/INBOX; Peter's machine (the ONLY holder of the
AUMLOK key) is where any apply happens. This is the CERN pattern: collide cheap compute on shadow nodes,
distill the winning work orders back through the one gate. Cross-node MEMORY sync stays parked (SQP-1 /
#98 security review) — nodes share CODE and WORK ORDERS, never memory or authority.

## Build order
Round A queue runner → Round B grant ratified + built → then Round C parallel fan-out + swarm_status. Do
not fan out a swarm that can auto-apply before the Round-B bounds exist; until then the swarm is a
proposal factory whose every output waits for Peter's button. That intermediate state is itself useful and
safe — it is the honest "swarm" Peter can watch before the dam-hole is drilled.
