# R5b recall benchmark — evidence report

Generated 2026-07-08T07:08:02.726Z · corpus: **brain.json @ state/kira/brain.json**
(96 live atoms of 97 total; erased/quarantined excluded by recall law)
· 50 deterministic probe queries · advisoryOnly: true · grantsAuthority: false

| engine | n | hit@1 | hit@3 | hit@5 | MRR | mean latency |
|---|---|---|---|---|---|---|
| kira.recall (baseline) | 50 | 94.0% | 100.0% | 100.0% | 0.967 | 3.6 ms |
| convex recall (R5b candidate) | 50 | 100.0% | 100.0% | 100.0% | 1.000 | 48.7 ms |
| convex vector (R5c contender) | 50 | 58.0% | 78.0% | 86.0% | 0.685 | 64.2 ms |


## Boundary (unchanged by this report)

Since the R5b step-4 cutover, live fuzzy recall serves from the governed Convex brain —
`recall.source: 'convex'` by default; the archived Kira JSON brain serves ONLY under the
explicit `kira-json-legacy` hatch on nodes that have not run the M4 migration yet. This
report is evidence, NOT authority: numbers here re-score engines on a corpus, and any future
source change still requires a candidate scored by THIS harness, on the same corpus and query
set, demonstrably beating the incumbent — then an owner-reviewed brick, in that order.
