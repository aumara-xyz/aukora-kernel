# Aukora Kernel

> **A model proposes. The kernel gates and receipts every effect before it becomes real. Other nodes verify.**

The Aukora kernel is the authorization-and-receipt core of a personal node: every effect an agent realizes is
gated by a signed capability, mediated through a single consume chokepoint, and cryptographically receipted into an
append-only history that any peer can re-verify. The one law it enforces — *authority is minted only by signature and
spent at most once* — holds across nodes, partitions, and format versions.

## What it does

- **Signs every effect** with post-quantum **ML-DSA-65** (FIPS 204) under a versioned, purpose-domain-bound signed-head
  format — the algorithm is bound into the signed bytes (downgrade-resistant), with no fallback mode.
- **Receipts every effect** into an **RFC 6962 append-only Merkle history root** committed inside the signed head, which
  the audit path recomputes from the actual receipts and re-verifies.
- **Conserves authority**: a live effect is authorized only through `manifest → grant → token → receipt`, flowing through
  one shared consume chokepoint with an OCC use-counter — no second authority path, no double-spend.
- **Verifies peers**: a witness checks a peer's history head as an append-only `(size, root)` consistency extension and
  records a signed, non-repudiable finding on an equivocation (a same-size / different-root fork).
- **Confidential transport** (optional, off by default): an **ML-KEM-768** (FIPS 203) key-establishment + AEAD channel
  adds confidentiality to a witness poll — it gates and mints nothing; strip it and every verdict is byte-identical.
- **Ships closed**: a clean deploy publishes no live HTTP surface — every route is flag-gated and returns `404` until
  explicitly enabled.

## What it is — and is not

This is a **PROVEN-LAB** kernel: each property above is exercised by the in-repo test suite (`npx vitest run`). It is a
research/engineering artifact, **not a production system**. Honest fences:

- The system is **tamper-evident** (receipts detect tampering after the fact), **not** tamper-proof.
- The post-quantum **signing spine** is corroborated against NIST ACVP vectors; this is corroboration, **not** an
  independent cryptographic audit, and **not** a blanket "quantum-secure system" claim.
- Identity is **self-sovereign at birth**, with an operator-custodied lifecycle (no built-in recovery — by design).
- No claims of consensus, global finality, public-transparency networks, trusted global time, anonymity, or
  metadata privacy.

See [`CLAIMS.md`](CLAIMS.md) for the exact claim → evidence → tier table.

## Authority vs. containment — what this layer does and doesn't do

A common first reaction: "but what if the agent just bypasses the kernel?" Correct — and intentional. This is the
**authority layer**, not the containment layer. They are different problems:

- **Authority** (this kernel): cryptographically proves *what was authorized, by whom, under what scope, and whether it
  was spent*. Makes every governed effect independently verifiable and tamper-evident. This is the hard part to get
  right — single-path consumption, append-only receipts, post-quantum signatures, cross-node witness verification.
- **Containment** (deployment infrastructure): forces all agent I/O through the authority layer. Sandboxes
  (Firecracker, gVisor), network policies (iptables, security groups), runtime monitors (seccomp, eBPF) — these are
  well-understood, off-the-shelf tools.

Without the kernel, containment is just a sandbox with no accountability — you can trap the agent but you can't
prove what it did or whether it was authorized. Without containment, the kernel is an audit trail — complete and
cryptographically sound, but only over effects routed through it. Together they form the full system.

The kernel is what's hard to *build correctly*. Containment is what's hard to *deploy correctly*. This repo is the
first half.

## Build & test

```bash
npm ci
npx vitest run
```

## License

[AGPL-3.0-or-later](LICENSE). See [`NOTICE`](NOTICE) for third-party attributions and [`CONTRIBUTING.md`](CONTRIBUTING.md)
to contribute.
