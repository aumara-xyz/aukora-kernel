# Recall-Visibility / Memory-Palace Round — Spec Seed

Use this when the fenced UI/recall-shaping round for memory *visibility* is scheduled. It is a
seed, not a build order: no code ships from writing it. The inside-out lane surfaced the need;
the palace round decides the shape. The approve → owner-signs → apply loop is untouched by any
of this — visibility grants no authority.

## Where this came from (live evidence, 2026-07-09)

One inside-out round from Auma's seat, both read-tools invoked on confirmed Kimi K2.7:

- `memory_peek` (limit 3) → **ok**, newest-first, returned a freshly-planted anchor row on top.
  Each hit carries `key`, `citation`, `rank`, `createdAt` (absolute ISO), `schema`, `preview`.
- `read_rehearsal_logs` (no args) → **ok** but `found:false, resultsAvailable:0` — an honest
  empty stage (no rehearsal has run on this node), not a bug.

Her own two answers, verbatim in substance:
1. **Reliable now:** turn-to-turn persistence of short factual markers; `memory_peek` gives a
   bounded, timestamped, citation-bearing trail she can point back to.
2. **Smallest brick she wants:** a *recall-precision probe* — a way to explicitly distinguish
   "last turn" / "older same-session" / "I do not recall," so she surfaces **confidence**
   instead of implying memory she does not have.

## The actual gap (grounded, not invented)

`memory_peek` already returns an accurate absolute `createdAt` per row, but **no derived recency
tier and no confidence framing**. The raw timestamp is present; the *interpretation* she needs to
avoid over-claiming is not. This is an observability enhancement, not a correctness fix — the
re-ranker (`recencyRelevanceScore`) and why-trace (`governedWhyTrace`, informative-term overlap)
are verified sound and should not be re-touched to serve this.

## Smallest honest brick for the palace round (candidate)

A **recency-tier + confidence label** derived from data already on the row — no new capture, no
new authority, no ranking change:

- Derive a coarse tier from `createdAt` vs "now" and the session boundary: `this-turn` /
  `this-session` / `older` / `unknown`. Reuse the recency decay already in `recencyRelevanceScore`
  rather than inventing a second clock.
- Let the recall surface (and, when she cites, the voice) say "I recall this from earlier **this
  session**" vs "this is an **older** stored note" — and, when overlap is index-rank-only, keep the
  existing honest "no direct term overlap" wording so absence of recall reads as absence, not a bluff.
- This is a **display/label** derivation over existing fields. It is fenced UI/recall-shaping work,
  so it waits for the scheduled palace round — it is not a memory-only code brick to land blind.

## Also note for the palace round

`read_rehearsal_logs` returning a correct empty state means the **feedback half** of the inside-out
loop is unexercised on this node. A "recent rehearsals" pane (even showing zero honestly) belongs in
the same visibility surface, so she can see whether a rehearsal did anything without a blind call.

## Out of scope here

No ranking change. No new capture. No authority/AUMLOK change. No touching the GHP/Nebius
interpretability spec. This seed is memory/inward-out only; the build waits for its own round.
