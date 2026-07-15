# Built State — Native Workbench + Signed Live Apply (updated 2026-07-01)

Plain answer to "what is actually real right now." No mythology, no "she self-modified" language.
The code below was written by an external agent (Claude) — same as everything else in this repo so
far. What's real and new: **a two-pane localhost workbench where chat commands flow through Aukora's
own native tool dispatcher, and — for the first time in this project's history — one signed command
can write to the live repo and make a real git commit, gated entirely by the owner's own AUMLOK key.**

## Built

**The tool membrane (round 1 — unchanged, still 100% sandbox/advisory):**
- A fixed 10-tool contract (`core/src/ideToolContract.ts`) + one dispatcher chokepoint
  (`core/src/nativeIdeDispatcher.ts`): `status`, `self_map`, `list_files`, `read_file`, `search`,
  `propose_patch`, `sandbox_apply`, `run_tests`, `write_receipt`, `rollback_sandbox`. Every result is
  bounded, `advisoryOnly:true`, `grantsAuthority:false`. No subprocess, no network, no shared-database
  import, no signing-key import, no donor-fork dependency — verified by tests + source inspection.

**The workbench UI (round 1+2):**
- A two-pane localhost page (`dashboard/workbench.html`, served at `/` by `dashboard/serve.ts`) — left
  is chat, right is an honest AUMLOK status panel. The old docs/anatomy shell and First Contact are
  quarantined behind `/console`, no longer the default landing experience.
- A deterministic (no model, no NLP) command parser (`core/src/workbenchCommandLoop.ts`) maps chat
  text to the 10-tool dispatcher — `status`, `map yourself`, `read file`, `search`, `propose patch`
  (multi-line), `sandbox apply`, `run sandbox tests`, `write receipt`, `rollback sandbox`. Verified
  live in a browser: propose → sandbox apply → test → receipt → rollback, live repo confirmed
  untouched after.

**A real bounded test runner (round 3):**
- `core/src/sandboxTestRunner.ts` — the first real subprocess-execution capability in this codebase,
  deliberately kept OUT of `nativeIdeDispatcher.ts` (which stays subprocess-free). Exactly 3 named
  commands (`typecheck` / `targeted_test` / `full_test_suite`) — no arbitrary command string ever
  reaches a shell. Runs against a fresh temp copy of the WHOLE repo root (tests reach outside `core/`
  into `authority/`, `memory/`, `receiver/`) with `node_modules` reused via symlink and the proposal
  overlaid on top. Chat commands: `run typecheck`, `run targeted test <file>`, `run full test suite`.

**Signed per-proposal live apply (round 4 — the first live-write capability in this project):**
- `core/src/nativeLiveApply.ts` — kept structurally separate from the 10-tool contract (which stays
  100% advisory). A proposal can only be written to the live repo and committed if ALL of: (1) the
  exact content re-hashes to match what was actually signed (`core/src/proposalHash.ts` — one shared
  hash function, no drift possible); (2) the signature verifies against the pinned public AUMLOK
  authority root; (3) this exact proposalHash has never been applied before (a durable,
  disk-persisted, consume-once ledger — `core/src/appliedProposalLedger.ts` — closes a real
  replay/downgrade vulnerability an adversarial review found, since the AUMLOK verifier itself has no
  nonce-replay check); (4) every target file passes the same sacred-path + traversal +
  symlink/realpath escape guard the sandbox writer uses — a valid signature can never override a
  sacred-path refusal. Git via `execFileSync` argv arrays only, a distinct git identity
  (`Aukora Symbiote <aukora@local-dev-shim>`), never sweeps unrelated dirty files into the commit.
  `git revert <sha>` is the rollback. `scripts/aumlok-authority.sh sign` now reads a human-reviewable
  proposal artifact file and re-derives its hash via the same shared function, printing the full
  goal+file list before signing — real informed consent, not a bare hash to trust blindly. Chat
  command: `apply signed proposal <path>` — the only command that can touch the live repo. Two rounds
  of adversarial review (design, then actual code) before this was called done; the second found and
  fixed a real bug (`relPath: "."` bypassed the traversal check and crashed with an uncaught `EISDIR`
  — no write-outside-repo or corruption, but a real crash path, now cleanly refused with a regression
  test).

**Fusion Council as reviewer, never a hand (round 5):**
- `core/src/selfEditReviewCouncil.ts` reviews ONE specific proposal (not the whole codebase — the
  existing 5-shard whole-codebase review machinery is a fixed, incompatible shape for this). Reuses
  the real primitives directly (`performExternalReview`, `evaluateFusionQuorum`) rather than inventing
  a 6th shard inside a shared module. A real, verified-live OpenRouter council review returns
  GREEN/YELLOW/RED (or an honest `NO_QUORUM` — a model timeout is a non-vote, never fabricated as
  RED). Before sending anything to a third-party API, the same secret-content scan the sandbox
  heartbeat uses runs over the proposal; secret-shaped content is refused outright, not redacted.
  Fusion can only ever recommend — it cannot authorize, sign, apply, or mutate anything, and this
  step never blocks the owner from applying regardless of verdict. Kimi is one roster model here if
  reachable, never the engine that drafts anything. Chat command: `run fusion review`.

## Not built (do not claim these)

- **Autonomous/unattended triggering.** Every round still requires a human keystroke — proposing,
  signing (always in the owner's own terminal, never the browser), and applying are three separate,
  deliberate actions. Nothing runs on a timer, a git hook, or a schedule.
- **A blanket live-promotion unlock.** `isLivePromotionUnlocked()` is untouched, still literal
  `false`. What round 4 built is narrower: a signature authorizes ONE exact, already-reviewed
  proposal — never a standing unlock.
- **A real OpenCode replacement.** `self_edit/opencode/` (a vendored donor IDE tool fork, never a
  real runtime dependency) was archived and deleted (2026-07-02, issue #23). The organism's own
  self-editing surface (`core/src/nativeToolCallingEngine.ts`, driven through the workbench's
  `agent: <goal>` command) is a separate, narrow, from-scratch tool surface — not an OpenCode fork.
- **A rich visual dashboard.** The workbench is two panes, deliberately — no fancy IDE chrome, no
  fictional "reasoning engine" visualizations. (A separate Kimi-authored plan proposed a much larger
  browser IDE with a "Fusion Reasoning Engine v5.0" self-recursion/benchmark-arena system — that
  engine does not exist anywhere in this codebase and was explicitly descoped, not built here.)
- **Production key custody, ML-DSA / post-quantum promotion signing, HSM.** AUMLOK stays Ed25519
  "dev_real" — a real algorithm, human-held key, gitignored home directory — not production hardware
  custody.
- **One unified gate.** The kernel's own `evaluateIntent`, the M4 self-edit-loop's risk classifier, and
  the (separate, donor-fork) `aukoraGate.ts` remain three disconnected implementations. This work adds
  a fourth and fifth narrow, purpose-built safety boundary (the 10-tool contract; the live-apply gate)
  — it does not merge or replace the other three.

## The honest claims

- Sandbox-only round (propose → sandbox apply → test → receipt → rollback): **"She completed a native
  recursive IDE rehearsal through her own tool dispatcher, sandbox-only, with receipt, no live
  apply."**
- A signed round that actually lands (propose → sandbox test → Fusion review → owner signs → apply):
  **"Aukora proposed a real change, it was sandbox-tested and Fusion-reviewed, and after the owner
  signed it with their own AUMLOK key, her dispatcher applied it live and committed it — `git revert
  <sha>` undoes it."**
- Never: "she self-modified autonomously." Every live write still requires a fresh human signature,
  produced in the owner's own terminal, for that exact proposal, every single time.
