# Limitations

Aukora Fu is intentionally narrow.

1. **Advisory only.** Fu cannot authorize an effect and must remain separated from signing and apply paths.
2. **Evidence is not truth.** Canonical bytes and matching digests prove consistency, not that the input is honest or complete.
3. **Best-effort secret scanning.** The curated catalogue and Unicode projections have documented ceilings and cannot catch every credential, encoding, confusable, or metadata leak.
4. **No execution attestation.** A compromised host may run different code or falsify surrounding evidence.
5. **No independent audit or formal proof.** Tests and KATs are strong engineering evidence, not certification.
6. **No timing/side-channel guarantee.** Deterministic work tests cover named scanner paths, not every runtime behavior.
7. **Runtime and dependency trust.** Node/Bun/Python implementations, SHA-256 libraries, and installed dependencies remain in the trusted computing base.
8. **Legacy provider surface.** The opt-in legacy runner can transmit selected content to third-party models. It is not the canonical EvidencePack transport.
9. **No privacy system.** Fu does not provide anonymity, unlinkability, traffic-analysis resistance, or regulated-data compliance.
10. **No model weights.** This repository ships no local model or training corpus and makes no small-model performance claim.
11. **No package release.** The npm/export surface is not frozen; accidental npm publication is blocked.
12. **No production operations.** Rate limits, distributed coordination, key custody, disaster recovery, and service hardening belong to downstream systems.

For the exact contract ceilings and KATs, see [docs/EVIDENCEPACK_V1.md](docs/EVIDENCEPACK_V1.md).
