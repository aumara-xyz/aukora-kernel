# Symbiote branch continuity — Round 23

This private checkpoint imports the sanitized `origin/main` organism snapshot and records material unmerged branches separately. A branch listed here is not automatically canonical, merged, safe to publish, or safe to execute.

| Workstream | Exact tip | Relationship to `41707f91` | Disposition |
|---|---|---|---|
| One-core memory | `54cdc5e39daeabb308bd6dd761735d086b96632d` | merged | Portable envelope and recall contracts are represented in the main snapshot; never import personal atoms or database contents. |
| Fusion chat/council | `9f2afc94aa286cab1566ccb2f4bfd0cf283b568a` | merged | Council primitives are separately pinned from Fu; provider/UI transports remain application adapters. |
| Five self-mod safety rails | `c3cf899eb7910bb3e7d6e7fb31698685681fae7c`, `6fa876a2676c691047c418b067b9b47661ae0a04` | merged | Safety contracts are represented in the main snapshot and require later extraction into canonical Kernel tests. |
| AUMLOK hybrid lifecycle | `985648b82c494a7479592ba5ba6d62f7678c80e2`, `ea1ede44599ab506125ecbada7b881e3229747d1` | merged | Public verification and receipt contracts are portable; signer custody and live apply remain adapters. |
| Kernel sightline | `8ace83e64ae1bafc33812b0862ad1c4ce065115c` | unmerged, 2 ahead | Preserve and rebase the read-only/advisory/no-deploy policy before promotion. |
| Luminara | `dbc23e4b6248eee54e8857d0a06e17e8ed2caac6` | unmerged, divergent | Private cultural/UI organ. Preserve the branch; do not merge blindly into Kernel law. |
| Stop-node/drain safety fix | `15f5e40bff9cda1f434e9dfbd280dbe2996d5e7f` | unmerged | Material operational fix requiring rebase and targeted review. |
| Public lander split | `6bd413c7434c5ddd8b27d7e10d72eb73d39b0a58` | unmerged, 2 ahead | Website layer only. |
| ARC3 preserved WIP | `45d6baf302d0a0978e2dd506b86d43ee513cede1` | unmerged | Quarantined WIP; preserve provenance only. |
| First teal owner-loop evidence | `cfab47314167bf841474a5af67a951bc29fbf829` | unmerged | Private UI/evidence provenance; not Kernel authority. |

The live Symbiote checkout is not a donor: it is a dirty, highly divergent worktree. All imported product bytes come from the exact clean source commit and the owner-final Eagle Eye export recorded in `R23_SOURCE_LOCK.json`.

