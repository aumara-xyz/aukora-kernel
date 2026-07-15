# Fusion seat-accuracy ledger — design (Great Merge round 1, Fusion lane)

**Status: DESIGN ONLY — nothing here is built or armed by this document.** Ordered by the
round-1 brief (issue #178, Fusion section): "the smallest auto-review-stage brick + a
per-seat accuracy ledger design." The brick shipped separately (proposal-fusion-advisory-v1
sidecars); this is the ledger design for review before any code exists.

**The line that never moves applies here twice over.** The ledger is evidence about
advisors, produced by advisors. It never gates, never authorizes, and — see §5 — even its
own conclusions ("seat X is unreliable") only ever become *proposals* the owner signs.

## 1. What question the ledger answers

Today every council run tells us what the seats said; nothing tells us **who tends to be
right**. Per-seat weights in `aukoraFuEngine.defaultCouncil()` are hand-set constants
(`weight: 1.0 / 1.15`), adjusted in-memory per reasoning run and then forgotten. The
ledger is the persistent evidence base that lets weight changes — and eventually the
fugu-style distilled default-proposer (research lane) — be **earned from receipts instead
of vibes**, the way the R5b recall cutover earned its way in via benchmarks.

## 2. What already exists to build on (grounded, on main today)

- `SelfEditReviewSummary.results: AdvisoryResult[]` — per-seat verdicts for every proposal
  review (`selfEditReviewCouncil.ts`).
- `fusion-run-v1` artifacts + `fusionSelfReview.ts` — per-run reliability/cost/non-vote
  analysis (single-run horizon only; no cross-run memory).
- `proposal-fusion-advisory-v1` sidecars (this round) — council verdict keyed by
  `proposalHash`, sitting beside `pending-proposals/`.
- Signed promotion receipts (`nativeLiveApply.ts`) — the owner's actual decision per
  `proposalHash`, replay-ledgered.
- The Convex memory organ, live on both proven nodes, with ONE governed write lane
  (`memoryAppend`, manifest → PoP → one-shot grant → V4 receipt).

The ledger is therefore mostly a **join**, not a new instrument.

## 3. The row (fusion-seat-ledger-row-v1)

One row per seat per council event, append-only:

```
schema:        'fusion-seat-ledger-row-v1'
createdAt:     ISO timestamp
runKind:       'proposal-review' | 'repo-audit' | 'chat-reading'
key:           proposalHash (64-hex) | runId          — what was reviewed
seat:          model slug (e.g. 'deepseek/deepseek-v4-pro')
stance:        the seat's glyph stance (⊕⊖⊙⊘⊚) and mapped verdict (GREEN/YELLOW/RED)
confidence:    the seat's own confidence glyph, mapped to [0,1]
quorumOutcome: the round's final quorum status
phaseLocked:   boolean — whether the perceiver flagged the round
advisoryOnly:  true    — pinned
grantsAuthority: false — pinned
// joined later, when the fact becomes known (append a NEW row version, never mutate):
ownerDecision: 'signed' | 'not-signed' | null          — from promotion receipts
outcome:       'applied-clean' | 'post-apply-test-red' | 'reverted' | null
```

Bounded like every artifact (caps on string fields), validated fail-closed on write AND
read, same discipline as `proposalFusionAdvisory.ts`.

## 4. Accuracy is three columns, never one score

1. **Agreement-with-quorum** — immediate, cheap, and *groupthink-biased*: a seat that
   always parrots the room scores perfectly. Reported, but explicitly labeled; rounds the
   perceiver flagged `phaseLocked` are EXCLUDED from this column (phase-lock is the failure
   mode, not the ground truth — our own council's RED-with-phase-lock on the omnibus vision
   is the canonical example of the quorum being the signal, not the seats' agreement).
2. **Agreement-with-owner** — did the seat's verdict match what the owner signed or
   declined? Available within days, via the promotion-receipt join.
3. **Agreement-with-outcome** — the real one, and the slowest: did applied proposals the
   seat green-lit stay applied and green? Requires the outcome join (revert detection +
   post-apply gate results), which lands last.

A contrarian seat that is *right against the room* only shows up in columns 2–3 — which is
exactly why column 1 alone must never drive anything.

## 5. Storage and consumption (two phases, both governed)

- **Phase 1 (local):** append-only JSONL under gitignored `core/evidence/seat-ledger/`,
  written best-effort at the same call sites that already emit fusion artifacts. No new
  network, no new authority surface, nothing in git.
- **Phase 2 (organ):** rows flow into Convex through the EXISTING governed write lane —
  advisory rows, receipted, loopback-only, same as chat capture. No new mutation is
  registered for this.
- **Consumption:** `fusionSelfReview` grows a ledger-reading section that may RECOMMEND
  roster/weight changes. A recommendation becomes a normal proposal (diff to
  `defaultCouncil()` weights) → sandbox → tests → council review → **owner signs**. The
  ledger shrinks the owner's checking WORK (the evidence is pre-assembled); it never
  touches their AUTHORITY.

## 6. Explicit non-goals

- No automatic weight application, seat eviction, or roster mutation — ever, at any phase.
- No single "accuracy score" headline; the three horizons stay separate columns.
- No benchmark claims from toy volumes: below a floor (proposed: 30 owner-decided
  proposals per seat), the ledger reports "insufficient evidence," not numbers.
- The distilled-small-model default-proposer (fugu-style) is a RESEARCH LANE gated on this
  ledger's phase-2 data — it is not scheduled by this design and does not block any merge.

## 7. Proposed build order (each its own brick, own PR)

1. Row schema module + validators + JSONL writer (pure, tested, gitignored output).
2. Emit rows from `selfEditReviewCouncil` (proposal-review kind) — the richest source.
3. The promotion-receipt join (ownerDecision backfill rows).
4. `fusionSelfReview` ledger section (read + recommend, advisory).
5. Phase-2 Convex flow + the outcome join (last; needs revert detection design).

*Round-3 note (2026-07-08): phase 1 is recording — every completed review appends one evidence row per seat (quorum column live, phase-lock-excluded; owner/outcome joins pending).*
