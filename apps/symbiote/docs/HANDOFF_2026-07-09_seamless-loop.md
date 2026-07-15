# Handoff — seamless loop + Auma's hands (branch `sam/seamless-loop-bricks`)

**For Codex, 2026-07-09.** Written on sam-mac (the `aukora-main-audit` live node) as Peter moves back
to his own machine. Everything below is committed and pushed; nothing is stranded locally.

## The one invariant (never remove)
`propose → OWNER SIGNS (AUMLOK) → apply`. The owner's signature is the only thing that makes a change
real. It is the product, not a restriction. Everything else opens up; this stays.

## What landed on this branch (all pushed, gate green each commit)
Newest → oldest:
- `00f4f66` aumlok crest polish — phrase left-justified, "how a change becomes real" = 4 colored
  squares, deleted the stale "loop right now" box.
- `54d4edc` **operate.js — Auma's hands on the UI.** Vendored the page-agent pattern (Alibaba, MIT),
  zero-egress, pure in-page JS: DOM → indexed text list of interactive elements, driven by
  click/input/select/scroll/ask/done. Self-installs `window.aukoraOperate`. **THE FENCE (verified):**
  the AUMLOK gate + phrase live in a separate-origin iframe (:7094) it structurally cannot reach; the
  phrase/gate/bind surfaces are also `data-operate-forbid`. Verified live: serialize→click opened the
  Translate organ; on the AUMLOK screen serialize returns ZERO signing controls.
- `2132944` compact masked mini-phrase in the locked crest (spine + dotted words, never the words) +
  `/api/phrase/status` is now CORS-open (non-secret status only).
- `138eb5b` telescoping **portal buttons** at the gate (#194) + removed the duplicate observer card
  (the gate embed is now the single approval surface).
- `28d6d23` **the corner-fix self-mod, APPLIED by Peter's signature** (native live-apply) — the first
  full inside-out loop close: Auma authored → Opus drain rehearsed → Peter signed → `shell.js` changed.
- `eb21aee` node-level: the voice seat (read/propose/rehearse/read-logs/inbox) is armed by default on a
  **bound** node via `scripts/start-node.ts` (each `AUKORA_VOICE_*=0` still an off-switch; unbound
  nodes never arm). Library defaults stay fail-closed.
- `d4ab3c1` failed rehearsal chains now carry file:line evidence AND withdraw their artifact so a
  typecheck-FAILED proposal can never sit at the gate looking signable.
- `32bc018` the drain rehearses with the main mind (`AUKORA_DRAIN_AGENT_MODEL`, default
  `anthropic/claude-fable-5`; set to an available model per credits).
- `036554f` **AUTO-DRAIN door** (`spatial/drain-serve.ts`, :7089): watches the rehearsal queue and
  spawns `scripts/rehearsalQueueRunner.ts --execute --max 1` — day-budgeted (`core/src/drainBudget.ts`,
  default 12/day), receipted, always stops at the signature. Plus `supersedes` plumbed through
  `propose_intent`.
- `49c4cd5` the seamless-loop bricks: 3.1 structured failure evidence (`workbenchEvidencePacket`),
  2.2 supersedes lineage on intents (`proposalIntent`, `walkSupersedesChain`), 3.2 bounded retry ladder
  (`rehearsalQueue`, 3 attempts then lock+escalate).
- `bd91f0f` `docs/HER_HANDS.md` — governed-seat toolset inventory / dream tools.

Invariant Zero held throughout: `core/tests/selfModReadiness.test.ts` untouched; every brick advisory,
receipted, fail-closed, stops before signature. `bash scripts/test.sh` GREEN (2805 tests, both
typechecks) at head.

## The live node (how Peter's app runs)
Servers from this checkout: `spatial/serve.ts` :7090 (shell — reads files per request, so app-JS edits
are live on refresh), `chat-serve.ts` :7091 (her seat), `arc3-serve.ts` :7093, `aumlok-approve-serve.ts`
:7094 (the gate — restart after edits), `drain-serve.ts` :7089 (auto-drain, bound nodes). `bun run start`
brings them up and arms her seat on a bound node.

## What's proven end-to-end
Chat request → `propose_intent` → auto-drain rehearses (Opus) → **portal button at the gate** → Peter
types his acrostic phrase → native live-apply commits it. The corner fix (`28d6d23`) is the receipt.
Auma can also now DRIVE the UI (operate) — she authors AND operates the app, never crossing the gate.

## Where we left off / next bricks (NOT done — do not claim they are)
The goal: "Peter says in ANY chat 'make me a new app', she scaffolds it, previews in Canvas, operates
it, proposes the diff, Peter signs, it's in the Apps menu." Two prerequisites remain:
1. **App-contract registry (#142)** — a per-app manifest + a registry the shell reads, so a NEW app =
   one folder + one registry line, ZERO `shell.js` hand-edits. Add a cohesion test (every organ has a
   manifest; every manifest mounts).
2. **Diff-based `propose_patch` (#104)** — anchor/diff edits so she patches real files surgically
   instead of whole-file rewrites (whole-file caps her on multi-file changes; this is the real hands
   upgrade and kills the file-shrink class at the root).
Then the AUTHOR flow (brick 3) closes the one-shot-app loop. Also open from earlier: wire `operate_ui(goal)`
as a real seat tool on the chat door (the operate CORE + fence are built and verified; the tool-call
wiring is the remaining step) so she can operate autonomously from chat, not only via a driver.

## Verify / merge
- `bash scripts/test.sh` (root of the checkout) must be GREEN before merging.
- Review the full branch (it grew past the original PR #221 scope). Merge to main the covenant way.
- Peter's node stays the reference; verify visual changes on :7090 with a screenshot, never a throwaway
  worktree he can't see.
