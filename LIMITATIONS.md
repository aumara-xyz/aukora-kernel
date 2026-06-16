# Limitations — Aukora Kernel

> The honest fence-line. This kernel is a **PROVEN-LAB research/engineering artifact**, not a production system, and
> not a "quantum-secure" anything. Everything below is a deliberate boundary, stated plainly so a serious reviewer
> doesn't have to discover it. Read alongside [`CLAIMS.md`](CLAIMS.md) and [`SECURITY.md`](SECURITY.md).

## Maturity
- **PROVEN-LAB, not production.** Properties are exercised by the in-repo suite (and, where noted, a cloud-LAB
  two-node run). "cloud-LAB" ≠ production ≠ airgapped. No uptime, scale, or operational claim is made.

## Cryptography
- **Corroboration, not audit.** The signing spine reproduces NIST ACVP pure-mode vectors; the Merkle history
  reproduces Certificate Transparency reference vectors. This is **not** an independent cryptographic audit, and no
  audit status is claimed for the post-quantum dependency.
- **"ACVP" applies to the ML-DSA-65 signing spine only.** The ML-KEM-768 channel is **KAT-pinned, not yet full
  FIPS-203 ACVP-conformant** — do not read "ACVP" onto the channel.
- **No forward secrecy** (the channel uses static-key establishment), **no metadata/traffic-analysis resistance**, and
  **no constant-time / side-channel guarantee**.
- **Not "quantum-secure."** Post-quantum *primitives* are used; that is not a blanket system-level security claim.

## Trust & identity
- **Tamper-evident, not tamper-proof.** The system *detects* tampering after the fact via receipts; it does not
  prevent an effect a compromised operator already authorized.
- **No execution proof.** Nothing here proves the running process is the audited code (see `SECURITY.md`).
- **No recovery, single-key custody.** Identity is operator-custodied with no built-in recovery and no N-of-M /
  threshold custody. Loss of the seed is final.
- **Trust is by explicit pin only (no TOFU).** Peers are never auto-trusted.

## Scope (explicitly out)
No consensus, global finality, or public-transparency **network** (the witness is point-to-point, detect/record-only,
not a network); no trusted global time / temporal oracle; no anonymity, unlinkability, or privacy guarantee; no
recovery or duress-safety; **no health-data / PHI handling** and no HIPAA posture of any kind; no agent intelligence,
competence, or autonomy claim; no decentralization or autonomous-swarm claim.

## Verification posture
Detection over prevention is a design choice, not an oversight: the kernel's job is to make every authorized effect
**accountable and re-verifiable by an independent peer**, not to be unbreakable. If you need prevention guarantees
(execution attestation, threshold custody, forward secrecy), this kernel is a foundation to build them on, not a
drop-in that provides them.
