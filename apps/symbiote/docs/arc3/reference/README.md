# ARC 3 — reference material (Kimi's 2026-05 campaign)

These two documents are the **source material** this organ descends from —
Kimi's orchestrated ARC-AGI-3 solver campaign, handed to Peter for Auma. They
are kept here verbatim as reference; the living, distilled version is
[`../../ARC3_AGI_ORGAN.md`](../../ARC3_AGI_ORGAN.md).

- **`KIMI_ARC_AGI_3_SOLVER_SPEC.md`** — the full architecture spec (AAA
  pipeline, 25-game table, 11 mechanic types, the Convex vision, the specific
  unsolved problems A–E). Useful for the roadmap.
- **`KIMI_AUMA_ARC_CANONICAL_EXTRACTION.md`** — the *honest* extraction: the
  verification-tier table (T1–T4), the receipt schema, the false-positive
  audit, and Kimi's self-critique. This is where our engine's core law comes
  from: **no observed delta, no lesson; receipts are the only substrate;
  enthusiasm is a bug.**

What we deliberately did NOT carry over: Kimi's *source-aware* solving (reading
each game's Python to derive move sequences). That was ~80% of Kimi's wins, but
it is the opposite of what the benchmark measures. Our engine reasons from
pixels only. The raw solver scripts + `environment_files/` game source live in
the two zips at `Documents/Auma/ARC 3/` on Zeb's machine and are intentionally
not committed.
