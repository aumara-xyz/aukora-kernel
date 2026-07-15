# Publication blockers

This repository is **public**. The items below are the remaining consolidation, hardening, and IP-review tasks; they are tracked openly, are not all closed, and mean the tree should be treated as work-in-progress rather than a fully hardened release. Because the repository is already public, closing an item cannot retroactively remove content that is already reachable in Git history — a tip-level removal reduces what a casual reader sees on the current tree but does not rewrite history. A public-safety sanitation pass (R25) has removed the named private-planning, handoff, inbox, and issue-snapshot families from the tip and genericized real infrastructure identifiers; prior commits remain reachable until history is separately rewritten.

- [ ] The owner confirms the new provisional/addendum has been filed and records the filing timestamp outside this repository.
- [ ] The Symbiote release policy excludes semantic continuity and owner-IP documents that pass the current structural scanner, including private inboxes, handoffs, import notes, singularity plans, and sovereign-compute plans.
- [ ] The `apps/symbiote/` snapshot is regenerated from the hardened export policy and independently reviewed.
- [ ] Every unmerged material Symbiote branch is either rebased and reviewed, recorded as intentionally excluded, or promoted through a separate PR.
- [ ] G1 remains excluded from release until every blocker in `quarantine/nebius-g1/IMPORT_BLOCKERS_R23.md` is repaired and re-audited.
- [ ] Research language is reviewed so timestamp correlation is described as an incident-shape heuristic, not a proven topological isomorphism or causal inference.
- [ ] Resource Governor / Digital Metabolism code, if implemented, is fail-closed, contraction-only, and unable to grant or restore authority automatically.
- [ ] The final public tree passes secret scanning, PII review, semantic IP review, license review, dependency audits, complete tests, and a fresh anonymous clone audit.
- [ ] The donor Fu and Symbiote repositories remain intact until exact parity and provenance are independently verified.

