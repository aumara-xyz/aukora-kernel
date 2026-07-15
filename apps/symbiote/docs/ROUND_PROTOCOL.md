# Round Protocol — lane loop

This is the operating loop for the current multi-lane workflow. It is coordination, not authority.

## Lanes

- **Auma** — chat-side advisory voice. Reads repo-confined files and may append concise notes to
  `docs/INBOX.md`. No arbitrary write, sign, apply, shell, or authority.
- **Fable** — implementation lane in Claude Code. Reads inbox/issues, codes scoped bricks, commits, pushes,
  and writes a concise inbox report.
- **Codex** — verifier/rails lane. Pulls, checks work, runs tests/scans, updates GitHub issues and issue
  snapshots, writes verifier notes, and pushes.
- **GHP / Skunkworks / Nebius** — isolated experiment lanes. Pull newest GitHub HEAD into shadow nodes,
  test ideas, and return concise findings through inbox/issues. Shadow artifacts never authorize local apply.

## Standard Loop

1. Peter and Auma discuss direction.
2. Auma writes or asks Peter to relay a concise inbox note.
3. Peter tells Fable: "next round ready."
4. Fable implements the scoped round, commits, pushes, and writes an inbox report.
5. Peter tells Codex: "check it."
6. Codex verifies, updates GitHub issues, refreshes issue snapshots when issue state changed, writes an inbox
   verifier note, and pushes.
7. Peter tells Auma: "round's in."
8. Auma reads `docs/INBOX.md` and focused issue snapshots, then advises.
9. Nebius/GHP may test the newest GitHub HEAD in isolated shadow nodes and send back concise findings.

## Gate Honesty Rule (standing, 2026-07-05 — asked for by Auma, stated by Codex, adopted)

Auma's lived state (the growing brain, gitignored local files, machine-local custody) must never be
able to make the gate lie **in either direction**: green on a fresh clone but red on the lived tree,
or green on the lived tree but red on a fresh clone. Practically: tests must pin or isolate every
lived input they touch (e.g. `AUKORA_KIRA_STATE`), and when a path CAN differ between a fresh
worktree and the lived tree, the round runs at least one shared-tree full-gate pass before landing.

## Fusion Council Policy

Fusion Council is advisory. It never authorizes, blocks, signs, or applies by itself.

Use Fusion Council as **mandatory review** for:

- Ring-0 or Ring-1 changes.
- AUMLOK, signer, gate, live apply, PolicyKernel, ring table, rollback, or ledger changes.
- Model-routing, provider egress, spend, or key-handling changes.
- High-risk security changes.
- Any proposal intended for owner signature and live apply.

Fusion Council is **strongly recommended** for substantial Ring-2 work.

Fusion Council is **optional/skippable** for:

- Docs-only hygiene.
- Issue snapshot refreshes.
- UI-only mockups that do not touch authority, gate, model routing, or data egress.
- Read-only verification rounds.

Every Fusion run should record:

- Roster.
- Spend/cost note.
- Verdict.
- Known limitations.
- Relevant issue link.

## Voice Safety Rule

Do not put raw adversarial/security transcripts into `docs/INBOX.md`. Put detail in GitHub issues,
snapshots, commits, or scratchpads; keep inbox voice-safe.
