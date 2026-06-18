# Security Policy — Aukora Kernel

> This describes the **PROVEN-LAB** kernel, not a production deployment. It is deliberately specific about what the
> kernel does **not** defend against — read "Honest residuals" before relying on anything here.

## Scope
This policy covers the Aukora authorization-and-receipt kernel as shipped in this repository: the signing spine,
the receipt/Merkle history, the manifest→grant→token→receipt authority path, the witness, the optional confidential
channel, and the HTTP route surface. It does **not** cover any deployment you build on top of it.

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

## Out of scope (never claimed)
Anonymity, unlinkability, metadata- or traffic-analysis resistance; consensus, global finality, or a
public-transparency network; trusted global time; health-data / PHI handling. See [`LIMITATIONS.md`](LIMITATIONS.md).

## Reporting a vulnerability
Please do **not** open public issues for security vulnerabilities. Report privately via
[GitHub Security Advisories](../../security/advisories/new) (Security tab → "Report a vulnerability"), or email
**security@aumara.xyz**. We will acknowledge within 72 hours. Defensive review of your own deployment is encouraged;
this is a research/engineering artifact and is offered without warranty.
