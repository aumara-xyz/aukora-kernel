# Aukora organism workspace

This private consolidation checkpoint brings the recent Aukora work into one inspectable repository without pretending that every donor has already been deduplicated or promoted to canonical status.

## Authority and ownership

- `packages/kernel/` is the portable deterministic authority verifier and reducer.
- `src/evidence/` is the accepted D6 EvidencePack implementation, byte-pinned to the Fu donor.
- `src/council/` is the portable advisory council core. It grants no authority.
- `apps/fu/` is the complete Fu harness and Portal snapshot. It is an application wrapper, not a second authority source.
- `apps/symbiote/` is a sanitized organism snapshot containing the integrated product surface. Where it duplicates Kernel or Fu primitives, the duplicate is historical donor material until a parity-preserving rebase removes it.
- `quarantine/` preserves blocked work and is outside every build, deployment, and authority graph.
- `docs/design/` contains implementation proposals, not deployed features.
- `research/` contains research provenance and hypotheses, not engineering proof.

Model output, Fu output, metabolic telemetry, and research classifications remain advisory. They cannot sign, apply, expand a ring, or grant authority.

## Current implementation truth

- The Kernel v0 boundary and its hybrid Ed25519 + ML-DSA-65 verification path are implemented and tested.
- EvidencePack D6 and the hardened advisory council core are implemented and tested in this workspace.
- The Fu Portal exists in `apps/fu/`; a live-eligible artifact still requires actual provider contact, paid calls, verified served identities, and quorum.
- The Symbiote snapshot is a continuity import, not yet a clean dependency rebase onto Kernel.
- Digital Metabolism, the Resource Governor, incident-shape classification, and the Borromean synthesis are design/research work. They are not deployed Kernel gates.
- Nebius G1 is quarantined and unarmed. Its negative-control bundle has reproduced blockers documented beside it.

## Consolidation rule

Preserve first, prove parity second, remove duplicates third. Never delete a donor repository or branch until the consolidated copy has exact provenance, passing tests, and an independently reproduced parity receipt.

