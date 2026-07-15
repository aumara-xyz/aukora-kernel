# Security Policy — Aukora Kernel

> This describes the **PROVEN-LAB** kernel, not a production deployment. It is deliberately specific about what the
> kernel does **not** defend against — read "Honest residuals" before relying on anything here.

## Scope
This policy covers both deliberately separated layers in this repository: the portable `@aukora/kernel` verifier/reducer
and the broader PROVEN-LAB Convex reference application. Signing, persistence, witness, transport, custody experiments,
and HTTP routes belong to the reference application, not the portable package contract. This policy does **not** cover
any deployment you build on top of either layer.

## Trust model (assumptions)
- **Pinned public keys, no TOFU.** A peer is trusted only by an explicit, operator-installed key pin. The kernel never
  trusts a key presented inside an envelope, and never auto-trusts on first contact.
- **Operator-custodied identity, no recovery.** Identity is self-sovereign at birth; the signing seed is never
  persisted (only its public fingerprint is). There is **no built-in account recovery** — loss of the seed is final,
  by design.
- **A single authority root.** Authority is minted only by signature and spent at most once, through one consume
  chokepoint. There is no second authority path; the contribution guard enforces this.

## What the kernel detects / prevents (and how)
| Threat | Mechanism | Detect vs prevent |
|---|---|---|
| Forged effect / signature | ML-DSA-65 (FIPS 204) over a versioned signed head; algorithm bound into the signed bytes | **prevent** (verification fails closed) |
| Algorithm downgrade | purpose-domain + algorithm bound in the signed bytes, no fallback mode | **prevent** |
| Double-spend of an authorization | single `consume` chokepoint with an OCC use-counter | **prevent** (one of two concurrent writes conflicts) |
| Replay of a valid envelope | single-use nonce + import-registry dedup | **prevent** |
| History tampering / rewrite | RFC 6962 append-only Merkle root committed in the signed head; audit recomputes from receipts | **detect** (tamper-evident, after the fact) |
| Peer equivocation (same-size / different-root fork) | witness records a signed, non-repudiable finding | **detect** (record/refuse-only) |
| Unauthorized HTTP surface | every route flag-gated, returns `404` before any handler work; disabled routes mutate nothing | **prevent** |

## Honest residuals (what it does NOT defend against)
- **No execution proof.** The kernel proves provenance, authorization, and rollback-resistance of *receipts* — it does
  **not** prove that the process actually running is the audited code. A compromised host can run swapped code while
  holding a valid signing key and emit valid-looking receipts. Closing this needs reproducible builds + an external
  witness + a trusted execution environment, none of which ship here.
- **Tamper-evident, not tamper-proof.** Detection is after the fact. The kernel records and refuses; it does not roll
  back an effect a compromised operator already authorized.
- **No forward secrecy.** The optional confidential channel uses a static-key establishment; a future key compromise
  exposes past sessions. The channel provides **confidentiality only**, gates nothing, and is **KAT-pinned, not yet
  full FIPS-203 ACVP-conformant**.
- **Single-key custody.** Authority concentrates in one operator key; there is no built-in N-of-M / threshold custody.
- **No side-channel / constant-time guarantee**, and **no independent cryptographic audit** of the post-quantum
  dependency. "Corroborated against NIST/CT vectors" means it reproduces published test vectors — not an audit.
- **Demo operator seed is explicit.** The PoP resolver fails closed when `AUMA_OPERATOR_SEED` is unset or malformed,
  and operator-key provisioning is internal-only. The test suite injects a documented disposable seed; it is never a
  deployment default and must not be reused.
- **Demo session resolver.** Some internal reference-app mutations still route
  through the bearer-session lookup in `sessionResolver.ts`. The resolver and
  its internal seed functions fail closed unless `AUKORA_DEMO_SESSIONS_ENABLED`
  is explicit, and tokens are bounded before lookup. It remains a lab artifact,
  not a production authentication boundary.
- **Test-seam env guard.** The channel's `saltOverride` gate uses a runtime `NODE_ENV`/`VITEST` check; a compromised
  operator who controls env vars could enable it — production should use a build-time dead-code flag.

## Out of scope (never claimed)
Anonymity, unlinkability, metadata- or traffic-analysis resistance; consensus, global finality, or a
public-transparency network; trusted global time; health-data / PHI handling. See [`LIMITATIONS.md`](LIMITATIONS.md).

## Convex callable and authority-seam inventories

HTTP route flags do not control direct Convex client calls. The complete
generated inventory of exported public `query`, `mutation`, and `action`
functions is frozen in `security/convex-public-surface.json`.
Plain exported helpers are not direct Convex callables but can still decide who
is trusted. Those dependencies, their callers, exports, environment inputs, and
`v.any()` counts are frozen separately in
`security/convex-authority-seams.json`. `npm run verify:convex-surface` checks
both artifacts and rejects ambient deployment-identifier fallbacks or embedded
deterministic seed literals in Convex source. Inventory inclusion is not a
security approval; each endpoint still requires its own authorization and
demo/production classification. Initialization, demo-write, and network-driver
functions are additionally pinned internal-only so regenerating the inventory
cannot accidentally approve their return to the public API.

## Reporting a vulnerability
Please do **not** open public issues for security vulnerabilities. Report privately via
[GitHub Security Advisories](../../security/advisories/new) (Security tab → "Report a vulnerability"), or email
**auma@aumara.xyz**. We will acknowledge within 72 hours and target a 90-day coordinated disclosure window from
acknowledgment to public advisory. Defensive review of your own deployment is encouraged; this is a
research/engineering artifact and is offered without warranty.
