# Aukora Fu — Fusion Under-the-Hood

**A deterministic, authority-free evidence and council layer for governed AI systems.**

Aukora Fu turns bounded engineering evidence into inspectable advisory analysis. It is deliberately separated from the Aukora Kernel: Fu may review, disagree, and produce evidence, but it cannot sign, authorize, unlock, apply, or mutate a protected system.

> **Status: VERIFIED ENGINEERING / research release.** The offline core and EvidencePack v1 are implemented and tested. This is not a production security product, a live autonomous council, or an authority system.

## The boundary

```text
untrusted files / test evidence
              │
              ▼
       EvidencePack v1
 canonical bytes · digest binding
 secret-shape refusal · hostile-input checks
              │
              ▼
        Aukora Fu council
 quorum · dissent · phase-lock analysis
              │
              ▼
        advisory artifact only
 advisoryOnly: true · grantsAuthority: false
              │
              ╳
      no signing / no apply / no authority
```

Those two literal invariants are validator-enforced. An artifact that claims otherwise is invalid.

## What is implemented

- Hardened offline council orchestration with eight canonical seats.
- Glyph parsing, stance/confidence vectors, quorum, divergence, and phase-lock checks.
- Fail-closed spend accounting for any future observer transport.
- An AST boundary guard excluding network, authority, custody, Kernel, Convex, Symbiote memory, subprocess, and live-apply capabilities. Filesystem access is forbidden except for the explicitly allowlisted, controller-owned spend-ledger adapter.
- EvidencePack v1 with:
  - closed schemas and fail-closed validation;
  - canonical JSON and domain-separated SHA-256 digests;
  - snapshot-first sealing and verification;
  - array-descriptor and prototype hardening;
  - Unicode-aware secret projections;
  - structurally bounded regex patterns and hand-written linear secret-shape scanners;
  - known-answer vectors reproduced by TypeScript and a Python reference.
- **146 tests** at the accepted D6 head.

The full wire contract, limits, and KATs are in [docs/EVIDENCEPACK_V1.md](docs/EVIDENCEPACK_V1.md).

## Verify from a clean checkout

Requirements: Bun 1.3.x, Node.js 20+ and Python 3.

```bash
bun install --frozen-lockfile --ignore-scripts
npm run verify
python3 scripts/pyref/evidence_canonical_ref.py
```

The verification gate checks the capability boundary, TypeScript, and the complete offline test suite. It makes no provider call and requires no API key.

## Repository map

```text
src/
  evidence/                 pure EvidencePack contract and implementation
  aukoraFuCouncil.ts        offline advisory council
  aukoraFuGlyph.ts          glyph and coherence primitives
  aukoraFuSpendLedger.ts    fail-closed filesystem accounting adapter
test/                       positive and hostile conformance tests
scripts/pyref/              independent canonicalization/KAT reference
legacy/                     retained legacy safety helpers
dashboard.html              legacy read-only observer
run-council.ts              legacy opt-in provider runner
```

## Legacy observer and runner

The browser observer remains loopback-only and read-only:

```bash
bun run legacy:observer
# open http://127.0.0.1:9900
```

A deterministic synthetic sample contacts no provider:

```bash
bun run legacy:sample
```

The retained paid runner is **legacy, disabled by default, and not part of the canonical EvidencePack path**. It requires an explicit target and opt-in:

```bash
AUKORA_ALLOW_LEGACY_PAID_RUN=1 \
FUSION_TARGET=/absolute/path/to/project \
COUNCIL_BUDGET=10 \
bun run legacy:council
```

Never point the legacy runner at secrets or private material. Generated `runs/*.json` are local output and gitignored.

## What Fu does not claim

Fu does not prove that evidence is true, detect every possible secret, provide constant-time behavior, resist a compromised host, reach global consensus, or authorize an effect. It contains no signing key custody, filesystem apply, production transport, or autonomous self-modification path. Read [CLAIMS.md](CLAIMS.md) and [LIMITATIONS.md](LIMITATIONS.md) before relying on it.

## Package status

The GitHub repository is public and licensed under AGPL-3.0-or-later. `"private": true` in `package.json` is intentional: it blocks accidental npm publication while the package/export surface is not frozen. It does **not** mean the GitHub repository is private.

## Security and contributions

- Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
- Contributions follow [CONTRIBUTING.md](CONTRIBUTING.md) and require DCO sign-off.
- Do not commit credentials, generated council runs, private source captures, model weights, or absolute personal paths. Weight manifests/checksums/licenses may be reviewed separately; model weights do not belong in this repository by default.

## License

Copyright © 2026 Aukora. Licensed under [AGPL-3.0-or-later](LICENSE). Third-party components retain their own licenses; see [NOTICE](NOTICE).
