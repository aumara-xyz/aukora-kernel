# Technical Provenance

This document records build provenance. It is not a legal title-chain opinion,
an independent audit, or a production-security certification.

- The portable package was created in a clean worktree from public kernel commit
  `2dd96f26d34c9e07649c2210ba1cbf64f6c026af`.
- Its boundary is a new deterministic package surface. No private OS history,
  private keys, credentials, operational evidence, or live-apply code is
  included.
- `npm run test:kernel` verifies source restrictions, types, unit and
  conformance vectors, compatibility/SBOM freshness, Node package installation,
  Edge Runtime execution, browser bundling, and Bun execution when available.
- The hybrid conformance file contains public deterministic test material only.
  Its fixture seeds remain outside the distributed package and must never be
  used for custody or deployment.
- Independent primitive corroboration is intentionally narrow: the repository
  test suite executes one accepting and one refusing ML-DSA-65 case extracted
  from NIST ACVP-Server FIPS 204 data at a pinned source commit with whole-file
  hashes. Other generated crypto fixtures are labeled implementation regression,
  not external evidence or certification.
- `conformance/manifest.json` records the public source base and compatibility
  digests. A reviewed release commit and tarball integrity are intentionally
  unset until an immutable release candidate exists.

Contributor, AI-assisted-code, copyright-entity, donor provenance, patent,
trademark, and dual-licensing decisions remain subject to Peter's records and
counsel review. The package remains AGPL-3.0-or-later unless that process
authorizes something else.
