# Deploy ledger — Nebius nodes

Append-only. One row per deploy **attempt** — failures, rollbacks, and refusals logged with the same ceremony as successes. Rows opened *before* deploy with the acceptance criteria; verdict filled after the fail-closed run. Retroactive rows are allowed only when marked **RETROACTIVE** and never carry a verdict above what was actually verified at the time. Practice: [`NEBIUS_DEPLOY_PRACTICE.md`](NEBIUS_DEPLOY_PRACTICE.md).

Tiers: DEPLOYED < BOOTED < VERIFIED < DURABLE. Verdicts: VERIFIED / DEGRADED / FAILED / REFUSED.

| # | UTC | Node | Branch @ commit | Artifact sha256 (build / node) | Config hash | Prereg criteria | Verdict | Gates | Adversarial probe | Notes |
|---|-----|------|-----------------|-------------------------------|-------------|-----------------|---------|-------|-------------------|-------|
| 0 | 2026-07-07 | dojo10 | *(none — founding incident)* | *(hand-built July-5 tar, no digest recorded)* | — | — | **FAILED (process)** | — | — | Backend enhancements ran uncommitted from a stale local branch; deployed node disconnected from GitHub. Root cause of this ledger. Fixed by `nebius/agora-organism` carrying the diff forward from current main. |
| 1 | 2026-07-07 [FILL utc] | dojo10 | nebius/agora-organism @ [FILL commit] | [FILL] / [FILL] | [FILL] | boot-restore: lexicon + last-40 messages survive kill-restart; anti-waste rejects degenerate fixture; drift audit fires on schedule; convex pinned 1.40.0 | **RETROACTIVE — BOOTED, restore verified by hand** | G2 by hand (kill-and-restart, pass) | Nyx degenerate glyph spam (live, caught by guard) | Anti-waste fix verified live over 50s sample: varied glyphs, clean apex reading, drift audit fired on ⟦⌇⟧. Not VERIFIED: G1 impossible (no version stamp yet), G3–G5 unscripted. |
| 2 | *(open before next deploy)* | dojo10 | nebius/agora-organism @ [pin at build] | | | G1 identity; G2 scripted kill/restore; G3 both fixtures; G4 schema boundary; G5 rollback artifact present | | | *(schedule within 7 days of VERIFIED)* | First fully-pinned deploy — this is the row to show at the Lift call. |
| 3 | 2026-07-08 (opened pre-run; verdict filled post-run) | private compute job (BUBBLE-0 appliance) | ghp/bubble0-appliance (contract frozen at 2910a16; run at the CODE_COMMIT in job env) | image `pytorch/pytorch@sha256:14611869…e014` (run by digest) · model rev `7cfb30d…` pinned | env: offline gates + strips sha `1a6e267e…40bd7` | reproduce burn3 three-arm verdict byte-exact (`{"base":{"menlo":10,"serif":11},"v4":{"menlo":24,"serif":25},"v5":{"menlo":27,"serif":27}}`) with HF/transformers OFFLINE after dep phase; pixel-manifest stimulus gate; REFUSED on any absent pin or drift | **VERIFIED — BUBBLE0_REPRODUCED byte-exact** (job `private-job-bubble0-repro`; infrastructure identifier withheld) | offline-mode assert PASS · pins-present PASS · pixel manifest 27/27 · byte-compare PASS | — | BUBBLE-0 v1 (#178 rounds 3–4). Private object storage at its capacity limit forced read-only mount + net-phase model fetch (disclosed); cleanup of this lane's partial staging dirs + quota decision → owner/conductor. v2: baked registry image. Contract+results: `docs/BUBBLE0_APPLIANCE.md`. |

## Known issues / pins

| Issue | Pin | Date | Unpin condition |
|---|---|---|---|
| Convex CLI 1.42.1 esbuild fails resolving `convex/server` (1.40.0 clean) | convex client → 1.40.0 | 2026-07-07 | upstream release verified against the kept repro case |
