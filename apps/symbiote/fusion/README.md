# fusion/ — archived legacy Fusion notes

This folder is **not** the active Fusion console and should not be used as the
run target.

Current source of truth:

- Internal governed Fusion organ: [`core/src/aukoraFuEngine.ts`](../core/src/aukoraFuEngine.ts)
  wired through [`core/src/selfEditReviewCouncil.ts`](../core/src/selfEditReviewCouncil.ts).
- Browser observer / standalone lab console: [`dashboard/fu/`](../dashboard/fu/).
- Import / ownership notes: [`docs/FUSION_IMPORT_NOTES.md`](../docs/FUSION_IMPORT_NOTES.md).

Legacy modules still present in `core/src` (`fractalFusion.ts`,
`fractalFusionEvidence.ts`, `fusionSwarm.ts`, `fusionOpsHealth.ts`) are retained
only because older tests and helper surfaces still reference them. They are not
the primary self-edit review engine.

**Law:** the council may review and advise; it never authorizes. A Fusion verdict (GREEN/YELLOW/RED) therefore never blocks or unblocks a workbench run; it only informs the owner, who remains the sole authority to sign and apply. Raw council verdicts with confidence
scores stay in `lab_only/` (gitignored) — no benchmark numbers ship in defaults. (SAFETY_LAWS 5.)
