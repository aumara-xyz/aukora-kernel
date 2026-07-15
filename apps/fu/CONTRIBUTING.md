# Contributing to Aukora Fu

Thank you for helping improve Aukora Fu. Contributions are reviewed against one boundary first:

> **Fu may produce advice and evidence. It may never produce authority.**

## Non-negotiable invariants

- `advisoryOnly` remains literally `true`.
- `grantsAuthority` remains literally `false`.
- The EvidencePack, council, and glyph pure subset does not import filesystem, network, environment, signing, key custody, Kernel, Convex, Symbiote memory, subprocess, or live-apply capabilities.
- `aukoraFuSpendLedger.ts` is the sole filesystem exception: an explicitly allowlisted, controller-owned accounting adapter. It never belongs to the evidence or authority path.
- Evidence bytes validated, digested, and rendered must be the same inert snapshot.
- Unknown schema fields and authority-shaped fields fail closed.
- Paid/provider behavior remains outside the offline verification gate and explicit when invoked.

Changes to these boundaries require hostile tests and independent exact-head review.

## Build and test

```bash
bun install --frozen-lockfile --ignore-scripts
npm run verify
python3 scripts/pyref/evidence_canonical_ref.py
```

When canonical bytes or the secret catalogue change, update and independently reproduce every affected KAT. Performance-security changes need deterministic adversarial vectors; wall-clock timing alone is not a correctness proof.

## Claims discipline

Use the labels in [CLAIMS.md](CLAIMS.md). Do not describe Fu as production-ready, exhaustive, autonomous, conscious, tamper-proof, quantum-secure, or capable of consensus/authorization. State what was executed, at which exact commit, and what could not be tested.

## Data hygiene

Do not commit:

- API keys, tokens, private keys, `.env` files, or live credentials;
- generated `runs/*.json`, private source captures, prompts, memory, or user data;
- model weights or training corpora;
- absolute personal paths, hostnames, or internal infrastructure details.

## Sign-off

Contributions require a `Signed-off-by` line under [DCO 1.1](https://developercertificate.org). By submitting a contribution, you certify you have the right to license it under AGPL-3.0-or-later.

## Security

Do not report vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md).
