# Security Policy

> **Draft — owner-fill required.** This policy is prepared for a future public release. The disclosure
> contact below is a placeholder the owner must replace before the repository is shared publicly. No real
> contact, key, or credential is included here by design.

## Reporting a vulnerability

Please **do not** open a public issue, discussion, or pull request for a suspected vulnerability, and
**never paste a secret value, key, token, or personal data** into any public channel.

Report privately to: `<OWNER-FILL: security disclosure contact — e.g. a private email or GitHub private
advisory link>`

If a private channel is not yet published, open a minimal public issue that requests a private contact
route **without** any exploit detail or sensitive value.

Please include, without sensitive values:
- affected component or feature and the exact version/commit,
- OS, runtime, and how the node was run,
- reproduction steps or a proof of concept,
- expected impact.

## Supported versions

This project is pre-release and moves quickly. Security fixes are provided on a best-effort basis for the
current `main` branch only. Older commits and forks are not supported.

## Response expectations (best-effort, pre-release)

| Severity | Meaning | Target first response |
|---|---|---|
| Critical | authority/gate bypass, key exposure, remote compromise | `<OWNER-FILL: e.g. 48h>` |
| High | privilege/scope escalation, PII exposure by default | `<OWNER-FILL: e.g. 5 days>` |
| Medium/Low | limited-impact or hardening issues | best-effort |

## Scope

**In scope** (a real security-boundary failure):
- bypassing the AUMLOK signature boundary or making an effect land without a human signature,
- causing an advisory input (memory, glyph, timing, tool output, web content) to change a gate verdict,
- exposing secrets, keys, tokens, or personal/visitor data through default behavior,
- reaching loopback control surfaces (the local brain or the signing gate) from an untrusted origin.

**Out of scope:**
- an owner's own local node state, private keys, or memory contents (these live outside the repo, by design),
- private research/lab lanes and internal coordination, which are not part of any public artifact,
- issues that require the reporter to already hold the owner's private signing key.

## Our commitments

- We prioritize reports that show a real security-boundary failure.
- We do not pursue good-faith researchers who follow this policy.
- We will not include your sensitive proof-of-concept values in any public write-up.
