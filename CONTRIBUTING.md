# Contributing to the Aukora Kernel

Thank you for your interest. This kernel guards one invariant above all else; contributions are reviewed against it first.

## The one invariant (non-negotiable)

**Authority is minted only by signature and spent at most once, through the single consume chokepoint.** A contribution
must not, directly or indirectly, create a *second authority path*. Concretely:

- A live effect is authorized only via `manifest → grant → token → receipt`; there is exactly one consume chokepoint
  (`consumeManifestUseCore`). Do not add a parallel consume, a second use-counter, or a bypass.
- No decision may branch on free-text / human-language input to *grant* authority — authorization reads typed canonical
  fields (ids, keys, the `{ring, action, resource}` tuple, codecs, signatures, hashes, expiries, pins, counters) only.
- New surfaces are flag-gated and default-off; a clean deploy must publish no live route.

PRs that touch the authority path should add or update a **structural guard test** demonstrating the invariant still
holds (e.g. "this module never inserts into an authority table", "exactly one use-counter increment site").

## Build & test

```bash
npm ci
npx vitest run        # the full kernel suite must stay green
```

- Match the surrounding code's style; every new source file needs the `SPDX-License-Identifier: AGPL-3.0-or-later` header.
- Keep claims honest: this is a PROVEN-LAB artifact. Do not introduce production / "quantum-secure system" /
  tamper-proof / consensus / anonymity language (see `CLAIMS.md` for the claim boundary).

## Sign-off

Contributions require a `Signed-off-by` line (DCO 1.1). By submitting a PR you certify you have the right to
contribute the code under AGPL-3.0-or-later.

## Security

Do **not** open public issues for security vulnerabilities. Report privately via
[GitHub Security Advisories](../../security/advisories/new) or email **auma@aumara.xyz**.
See [`SECURITY.md`](SECURITY.md) for the full policy.
