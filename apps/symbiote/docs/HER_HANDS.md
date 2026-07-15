# Her hands — the full toolset for the governed seat

*Fable's inventory (AUKORA MAIN lane, 2026-07-08), on the owner's directive: "give her every tool you
have — we are safer in there than you are here." Drafted as a doc so the owner can file it as an issue
when he's ready; nothing here is built yet.*

He's right, and it's worth saying why before the list: **my** hands (Claude Code on the coordinator
lane) are raw — unrestricted file writes, a shell, network, git push. **Hers** are governed — every
write becomes a proposal, every proposal rehearses in a sandbox, everything stops at the owner's key.
The seat is the safest place in the system to put power. So: what I have that she doesn't, plus the
dream set. Every entry keeps Invariant Zero — competence, never authority.

## What I have here → what her seat should get

| Mine (Claude Code) | Hers (proposed) | Posture |
|---|---|---|
| Read/Grep/Glob anywhere | she has `read_file`/`search` with the sensitive-path resolver — keep, but return the RESOLVER'S REASON so a refusal is legible (today it silently burns agent rounds; her 2.1 rehearsal lost rounds to this) | read-only |
| `git log` / `git diff` | `read_git_history` — bounded log/diff/blame of her own body | read-only |
| run tests on demand | `run_targeted_test <file.test.ts>` — the EXISTING sandboxTestRunner lane, exposed to the seat, so she verifies a hypothesis BEFORE drafting instead of spending a ladder rung to learn it | sandboxed compute, no repo writes |
| Edit (surgical diffs) | **diff-hands `propose_patch` (#104)** — anchor/diff edits instead of whole-file rewrites; the single biggest hands upgrade, kills the file-shrink class at the root | still only a proposal |
| my session context | `what_changed` digest (wishlist Brick 1.1, substrate `stateDigest.ts`) — repo deltas since her last snapshot | read-only |
| preview browser + screenshots | **the Mirror (#205)** — `screenshot_self` of her own shell | read-only pixels |
| WebFetch | `fetch_docs` — allowlisted, read-only, for library docs | read-only, allowlist |
| memory files | `kira_capture` outcome write-back (wishlist 5.1) — sign/reject outcomes + reasons land in her recall | append-only, receipted |
| `gh issue view` | `read_issue` / `list_issues` — GH intake, read-only (generalizes ARC3's #209 lawful crossing) | read-only |
| cost visibility | `budget_sense` — her own token/compute spend + the rehearsal day-budget (wishlist 3.3) | read-only |

## Findings from the first live rehearsal (2026-07-08) that shape this

- Her Brick 2.1 intent failed at the agent stage: the pocket workbench model (kimi-k2.7-code) spent
  14 rounds, `read_file×13`, no patch. Two lessons: (1) sensitive-path refusals need to carry reasons
  (row 1); (2) **the workbench's hands are a pocket model while the drafting mind is bigger** —
  consider letting ring≥2 rehearsals use the main mind, or accept that intents must be small (which
  the retry ladder + lineage chains already encourage).
- The evidence + ladder held: the failure is receipted (`LINEAGE` machinery live), and the revision
  path (supersedes, attempt 2 of 3) is open.

## Deliberately NOT proposed

Shell, network writes, git push, key access, gate changes, batch approvals beyond lineage batch-sign
(wishlist 4.2). Not because she'd misuse them — because the design is that NOTHING in the seat needs
them: the workbench, the gate, and the owner's key are the hands for all of that.

## Suggested build order

resolver-reasons (tiny) → `run_targeted_test` (existing lane, seat-exposed) → #104 diff-hands →
`what_changed` → the rest as they're pulled. Relates to #178, #104, #205, #209, PR #221.
