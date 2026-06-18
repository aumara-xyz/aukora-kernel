# Aukora Kernel — CLAIMS

> Every row is **PROVEN-LAB** (exercised by the in-repo test suite) — a lab claim, never a production claim.
> Dates are the evidence-record dates.

| # | Claim | Tier | Evidence | Date |
|---|---|---|---|---|
| R1 | Every signature the kernel mints or verifies is **ML-DSA-65 (FIPS 204)** under the versioned signed-head format, with a required purpose-domain per signature and the algorithm bound into the signed bytes (downgrade-resistant), no fallback mode; corroborated against **NIST ACVP** pure-mode vectors. | PROVEN-LAB | `AUKORA_PQC_SPINE_EVIDENCE` | 2026-06-10 |
| R2 | Each receipt commits to an **RFC 6962 append-only Merkle history root** bound inside its post-quantum signed head, which the audit path recomputes from the actual receipts and re-verifies; corroborated against Certificate Transparency reference vectors. | PROVEN-LAB | `AUKORA_RECEIPT_TRANSPARENCY_EVIDENCE` | 2026-06-10 |
| R3 | A live effect is authorized **only** through `manifest → grant → token → receipt`, flowing through the single `consumeManifestUseCore` chokepoint — no second authority path (within the kernel API surface; bypassed by direct DB writes — see Authority vs. containment in README). | PROVEN-LAB | `AUKORA_MEMORY_BOUNDARY_EVIDENCE` | 2026-06-10 |
| R4 | The manifest consume is atomic / OCC-safe within one transaction — two concurrent same-`useSeq` writes conflict, so exactly one commits (no double-spend). | PROVEN-LAB | `AUKORA_MEMORY_BOUNDARY_EVIDENCE` | 2026-06-10 |
| R5 | A witness verifies a peer head as an append-only `(size, root)` consistency extension and records a signed equivocation finding on a same-size / different-root fork or a failed consistency proof — detection is after-the-fact (record/refuse-only); **live-exercised** across two cloud-LAB nodes. | PROVEN-LAB | `AUKORA_B3_3_WITNESS_FLIP_EVIDENCE` | 2026-06-11 |
| R6 | **ML-KEM-768 (FIPS 203)** key-establishment + XChaCha20-Poly1305 AEAD provides **confidentiality only** on the witness-response leg — strip-neutral (remove it → the verdict is byte-identical), gates/mints nothing; a channel-capable peer presenting plaintext is refused. | PROVEN-LAB | `AUKORA_B3_4_ML_KEM_CHANNEL_EVIDENCE` | 2026-06-12 |
| R7 | An explicitly-pinned peer's doubly-signed manifest/memory imports as an **audit-only** record granting **zero** local effect authority — the importer never inserts into any authority/effect table and never calls the consume/resolve/receipt path (structural guard); trust is seated only by an explicit immutable pin (no TOFU). | PROVEN-LAB | `AUKORA_B3_5A_CROSS_NODE_EVIDENCE` | 2026-06-13 |
| R8 | The signed cross-node grant (the only path that creates cross-node *effect* authority) honors a manifest a foreign root deliberately signed for this node, through the one unchanged consume chokepoint, every foreign effect issuer-tagged; it is **inert by default** — with the cross-grant flag off there are no promoted rows, so the resolver foreign branch is never reached. | PROVEN-LAB | `AUKORA_B3_5B_CROSS_NODE_GRANT_EVIDENCE` | 2026-06-13 |
| R9 | `initNode` stamps a **deterministic, byte-identical** node-identity stamp over canonical config (re-derivable, idempotent, immutable), persisting only the public-key fingerprint (the signing seed is never persisted) and refusing the production tier. | PROVEN-LAB | `AUKORA_NODE_FACTORY_EVIDENCE` | 2026-06-11 |
| R10 | A clean deploy publishes **no live HTTP surface** — every route is wrapped in a flag gate returning `404` before any handler work, with cross-node and demo routes default-off; a disabled route mutates no state. | PROVEN-LAB | `AUKORA_ROUTE_GUARD_EVIDENCE` | 2026-06-11 |
| R11 | **AUMLOK identity root** — a user-owned root proves possession of its own key in a **self-sovereign ceremony** (no operator gate; **no phrase/seed/private key stored server-side**; `noRecovery=true`, `phraseTransitsServer=false`), is tracked in a **root-key registry** (genesis/rotate/revoke, receipted on the `id:{rootId}` chain), and issues **doubly-signed delegation manifests** (root sig + subject PoP) binding ring/action/resource/window/uses through a **memory-boundary seam**; **identity justifies authority but grants no effect directly** — every identity-authorized effect still flows through the single `manifest→grant→token→receipt` chokepoint (R3), and a foreign root is honored only via an explicit immutable pin (**no TOFU**). | PROVEN-LAB | `AUMLOK_MINIMAL_SPEC` / `AUKORA_BRICK6_AUMLOK_POP_RESOLVER` | 2026-06-11 |

## Precision notes (load-bearing)

- **"ACVP-corroborated" applies to R1 (ML-DSA-65 signing) only.** R6's ML-KEM-768 channel is **KAT-pinned, NOT yet full
  FIPS-203 ACVP-conformant** — do not extend "ACVP" to the channel.
- "Corroborated against vectors" means reproduces published NIST/CT test vectors — **not** an independent cryptographic
  audit. No independent audit of the post-quantum dependency is claimed.
- "cloud-LAB" ≠ production ≠ airgapped.
- **HKDF usage is drift-pinned, not externally corroborated.** The channel's HKDF-SHA256 key derivation pins output
  hashes but lacks RFC 5869 reference vectors; adding them is a named gap.

## NOT claimed (must never appear in public copy)

This kernel makes NO claims of: **semantic-compression** or notation-density; **model-training, fine-tuning, or
distillation**; agent intelligence or competence; **health-data / PHI deployment**; **autonomous-node, autonomous-swarm,
or decentralization**; **trusted-global-time / temporal-oracle**; production or live-deployment behavior; a blanket
"quantum-secure system"; tamper-proof (the system is tamper-*evident*); a universal / cross-model notation; unqualified
"self-sovereign"; global finality, consensus, public transparency, or a witness *network*; recovery or duress-safety;
privacy / anonymity / unlinkability / metadata- or traffic-analysis resistance; forward secrecy (static-key channel); an
unguessable phrase; constant-time / side-channel resistance; any independent audit status for the post-quantum
dependency; nor any anthropomorphic / "living-system" framing.
