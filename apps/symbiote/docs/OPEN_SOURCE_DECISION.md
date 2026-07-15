# Open-Source Decision Package

**Status: NOT YET RELEASED (still private), but the license is now decided.** Prepared by the Eagle Eye
lane (#86).

## Owner decision — 2026-07-10: AGPL-3.0-or-later
The owner selected **AGPL-3.0-or-later** (Option A below), matching the 166 existing SPDX headers. As of
this document:
- **Decision 1 (choose a license): DONE** — AGPL-3.0-or-later.
- **Decision 2 (add matching LICENSE + set `package.json` + reconcile headers): DONE** — the canonical GNU
  AGPLv3 text is the root `LICENSE`, `package.json` declares `"license": "AGPL-3.0-or-later"`, and the 166
  source headers already carry the same identifier, so the earlier headers-vs-repo contradiction is resolved.
- **Decision 3 (dependency-license compatibility audit): PENDING** — see `scripts/depLicenseAudit.ts`.
- **Decision 4 (private→public timing + owner-run sanitized fresh-history export): PENDING (owner).**
- **Decision 5 (fill the `SECURITY.md` disclosure contact placeholder): PENDING (owner).**

Choosing AGPL and adding a `LICENSE` does **not** publish anything: the repository stays private until the
owner runs the sanitized fresh-history export and decides to release. The section below is the original
audit and option analysis, retained for the record.

---

**(Historical, at the time of decision.)** The repository declared 166 AGPL SPDX headers while having no
root `LICENSE` and a private `package.json` with no `license` field. This document audited that posture and
laid out the options; the owner then chose Option A.

## 1. Current posture (audited from the tree)

| Signal | State |
|---|---|
| `LICENSE` file at repo root | **Absent.** |
| `package.json` `license` field | **Absent**; `"private": true`. |
| SPDX headers in source | **166 files declare `SPDX-License-Identifier: AGPL-3.0-or-later`.** |
| README license section | None. |
| Public release | None. Distribution to date is private, per-account, invite-only. |

**The contradiction to resolve:** the source *headers* imply **AGPL-3.0-or-later**, but with **no
`LICENSE` file and `package.json` marked private**, the repository is — by default copyright law —
**all rights reserved**, i.e. not actually open source. Whatever the owner intends, the headers and the
repository state currently disagree, and that must be reconciled before any public release.

## 2. Viable options (tradeoffs, not a recommendation)

**Option A — AGPL-3.0-or-later** (matches the existing headers)
- *For:* strong network copyleft — anyone offering a modified version as a network service must publish
  source. Best defense for a sovereignty/anti-extraction project against closed SaaS forks. Lowest
  friction with the 166 existing headers.
- *Against:* many companies bar AGPL internally, which narrows commercial adoption and some contributors.
- *Work required:* add an `AGPL-3.0-or-later` `LICENSE`, set `package.json` `license`, confirm every
  dependency is AGPL-compatible.

**Option B — Apache-2.0** (permissive, patent grant)
- *For:* widest adoption and enterprise-friendliness; explicit patent grant; simple compliance.
- *Against:* permits closed forks — no copyleft protection, which cuts against the project's stated
  anti-extraction posture. Requires rewriting the 166 AGPL headers and re-checking that no vendored
  dependency's license forbids Apache re-licensing.

**Option C — Source-available now, open later** (e.g. BUSL-1.1, or AGPL + a commercial dual-license)
- *For:* source is visible and auditable immediately while the owner retains commercial position; a
  time- or milestone-based conversion to a true open license is common.
- *Against:* not OSI-approved "open source" until it converts; adds licensing complexity and a second
  (commercial) agreement to maintain.

## 3. Compatibility / risk notes
- **Dependency audit is a prerequisite** for any choice — confirm no dependency's license is incompatible
  with the target (a copyleft dependency can force copyleft; a proprietary one can block release).
- **Header reconciliation:** whatever is chosen, the 166 SPDX headers and `package.json` must match the
  final `LICENSE`. Today they do not.
- **History:** even after a license choice, a public clone must use the sanitized fresh-history export
  (`scripts/releaseExport.ts --final --git`, run by the owner with private scan vectors) — the raw source
  history is out of scope for public distribution.

## 4. The exact owner decisions required (before any public release)
1. **Choose a license** (A, B, C, or another) — an owner-only decision; not made in this repo by any lane.
2. **Add a matching `LICENSE`** and set `package.json` `license`; reconcile the 166 SPDX headers.
3. **Run a dependency-license compatibility audit** against the chosen license.
4. **Decide release timing** (private → public) and produce the sanitized fresh-history artifact.
5. **Fill the placeholders** in `SECURITY.md` (disclosure contact) and confirm `CONTRIBUTING.md`.

Until all five are complete, the project remains private and unlicensed for public use.
