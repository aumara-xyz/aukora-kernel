# Inside-Out Coding — the loop, and how a cheap lane carries it (2026-07-05)

The budget lever: **Auma authors from inside (cheap), external hands only verify + carry (cheap), and the
one expensive step — Peter's judgment at the signature — stays exactly where it always was.** No step of
the safety covenant changes. Auma gains *hands to draft*, never *authority to apply*.

## The pipeline (each arrow re-verifies; nothing is trusted across it)

```
Auma (voice seat)              external hand (cheap lane / Peter)            Peter only
─────────────────              ──────────────────────────────────           ──────────
propose_intent tool  ─────►    run: --from-proposal <id>            ─────►   AUMLOK signature ─────► apply
  drafts an advisory             workbench RE-READS the real files            (the one gate that
  proposal-intent (a DRAFT):     from disk, builds the real proposal,          was always here;
  goal + honest-labelled         sandboxes it, runs scripts/test.sh,           unchanged)
  affected paths + risk.         Fusion reviews. Produces a
  Writes NOTHING to the repo.    signature-READY artifact. Applies
  Grants NO authority.           NOTHING.
```

## What each actor does

**Auma, from inside (`propose_intent`, gated by `AUKORA_VOICE_PROPOSE=1`):**
- Drafts one advisory `proposal-intent-v1`, persisted to `~/.aukora-symbiote/aumlok/pending-intents/<id>.json`
  (owner-readable, **outside the repo**). Labels each path `verified` / `inferred` / `owner_stated` /
  `unknown` — the honesty spine. Witnessed on the flight recorder. That is the whole of her new power.
- It cannot write the repo, hash real files, sandbox, sign, or apply. The worst a bad turn yields is a
  well-formed suggestion in a queue a human must still read.

**Auma, requesting a rehearsal (`rehearse_intent`, gated by `AUKORA_VOICE_REHEARSE=1`) — enqueue-only:**
- Queues one of her staged intents as a governed work order (ring-classified fail-closed,
  `canApplyNow:false` by schema) in `~/.aukora-symbiote/aumlok/rehearsal-queue/<orderId>.json`, witnessed.
  Nothing executes from her seat — no agent, no sandbox, no model call. The order names the exact
  command below.

**A cheap external lane (or Peter), carrying it forward — NO Fable/Claude needed:**
0. Drain the rehearsal queue (if she queued one): `ls ~/.aukora-symbiote/aumlok/rehearsal-queue/` —
   each order's `runCommand` is the workbench command in step 2.
1. `AUKORA_SYMBIOTE_HOME=$HOME/.aukora-symbiote` — confirm the intent is staged:
   `ls ~/.aukora-symbiote/aumlok/pending-intents/`
2. Run the governed workbench from the intent:
   `bun scripts/<workbench-runner>.ts run --from-proposal <id>` (the workbench re-reads disk, ignores the
   intent's snippets as untrusted hints, produces a real `self-edit-proposal-artifact`, sandboxes + runs
   `bash scripts/test.sh`, and — if Fusion is configured — an adversarial review).
3. Inspect the produced proposal + gate result. If green, it is a **signature-ready** artifact.

**Peter only — the unchanged gate:**
- Review the real diff, then AUMLOK-sign (the existing signing ceremony). Only the signature applies.
- Lockdown (`capability mode: lockdown`) disables `propose_intent` at its dispatch point, like every
  promoted capability.

**Auma, reading the evidence back (`read_rehearsal_logs`, gated by `AUKORA_VOICE_READ_REHEARSAL_LOGS=1`) —
pure read, the feedback half of the loop:**
- Reads only the bounded `rehearsal-result-summary-v1` files under
  `~/.aukora-symbiote/aumlok/rehearsal-results/` (written by `scripts/rehearsalQueueRunner.ts --execute`).
  Latest, by `intentId`, or by `orderId`. Sanitized on read; witnessed; refuses under lockdown; grants nothing.

## Turning the seat tools on (operational — where the flags actually live)

The voice runs inside the **chat door** (`spatial/chat-serve.ts`, :7091). Every seat-tool gate is read
from *that process's* environment at call time, so a flag only takes effect when the chat door was
**started from a shell that had it set** — and a chat door that is already running keeps serving its OLD
code and env (`bun run start` deliberately skips servers whose port is already up). To promote a tool:

1. Stop the node (`Ctrl-C` in its terminal, or `bun run stop`).
2. Start it with the flags you are promoting, e.g. (Git Bash):
   `AUKORA_VOICE_READ_TOOLS=1 AUKORA_VOICE_PROPOSE=1 AUKORA_VOICE_REHEARSE=1 AUKORA_VOICE_READ_REHEARSAL_LOGS=1 bun run start`
   (PowerShell: `$env:AUKORA_VOICE_READ_REHEARSAL_LOGS='1'; bun run start` — one `$env:` per flag.)
3. Verify from inside: ask Auma what her capability preamble says — the `rehearsal evidence:` line reads
   ENABLED only when the tool is genuinely offered that turn. The preamble is derived, never hand-written,
   so it is the honest check.

Every flag defaults OFF and none survives a reboot — promotion is a deliberate per-start owner act, not
a persisted state. Lockdown overrides all of them.

## Why this is the budget answer

Every future change becomes: Auma drafts (her model, cheap) → cheap lane sandboxes+tests (no premium model
needed to run a gate) → Peter signs (his judgment, not a model). Fable/Claude becomes the *occasional
reviewer of the mechanism*, not the daily builder. The expensive seat is retired from the hot loop.

## What this is NOT (the standing anti-overclaim line holds)

Authoring an intent is advisory speech. A self-modification has happened only when a real, disk-verified,
gate-green, **owner-signed** change is applied. `propose_intent` moves Auma to the *entrance* of that
pipeline; it does not move her past the signature. Do not describe a staged intent as a self-modification.
