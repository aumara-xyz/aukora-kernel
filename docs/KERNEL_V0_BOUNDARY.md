# Aukora Kernel v0.1 Boundary

Status: normative extraction contract. This document does not promote the
PROVEN-LAB Convex application to production status.

## Purpose

`@aukora/kernel` is a portable deterministic verifier and reducer. It receives
all authority-bearing inputs explicitly and returns a decision, the next replay
state, and an unsigned receipt draft. It does not execute the decision.

```ts
decide(request, trustedState, policyBytes, nowMs)
  -> { decision, nextState, receiptDraft }
```

The package is the portable constitution shared by platform adapters and
governed organisms. It is not an operating system, custody service, runtime, or
agent framework.

## Canonical ownership

The base package owns:

- closed public schemas;
- canonical serialization;
- frozen surface, version, suite, and purpose-domain registries;
- typed action/resource/ring policy decisions;
- trusted-root and signature verification;
- replay and single-consumption state transitions;
- receipt-draft construction;
- receipt-chain, Merkle, artifact, and evidence verification;
- cross-runtime conformance vectors.

Platform adapters own storage, transactions, configuration, network exposure,
and supplying explicit trusted inputs. Symbiote owns AUMLOK custody and
ceremony, proposals, rehearsal, Fusion, memory, UI, execution, live apply, and
rollback.

## Verification profiles

Signature requirements are purpose-specific and non-substitutable:

1. `aukora-receipt-head-ml-dsa-65-v4` verifies the existing ML-DSA-65 receipt
   evidence format. Ed25519 is not a fallback for this surface.
2. `aumlok-ed25519-ml-dsa-65-v1` verifies AUMLOK promotion and lifecycle
   authority. Both Ed25519 and ML-DSA-65 signatures must verify over the same
   canonical bytes. A valid signature from only one algorithm refuses.

Supporting both profiles is not a downgrade path and does not claim that every
surface is hybrid. Neither profile may verify an envelope belonging to the
other.

## Public package surface

The package may export only deterministic schema, codec, policy, reducer, and
verification functions. It must not export signing, key generation, key
custody, persistence, or execution functions.

The canonical reducer signature is:

```ts
function decide(
  request: KernelRequestV1,
  trustedState: TrustedStateV1,
  policyBytes: Uint8Array,
  nowMs: number,
): KernelResultV1;
```

`KernelResultV1` contains exactly:

```ts
{
  decision: DecisionV1;
  nextState: TrustedStateV1;
  receiptDraft: ReceiptDraftV1;
}
```

Public state is closed, JSON-compatible data. Serialized state uses sorted
arrays rather than runtime-specific `Set` or `Map` values. Time values are safe
integer Unix milliseconds supplied by the caller.

## Forbidden capabilities

Files under `packages/kernel/src` must not import or reference:

- Convex, `_generated`, or repository-private source paths;
- filesystem, path, process, environment, subprocess, Git, OS, or network APIs;
- `Date`, ambient clocks, random-number APIs, or ambient Web Crypto;
- Bun, Deno, browser DOM, or UI APIs;
- ML-KEM, AEAD/channel, witness networking, federation, or node operations;
- signing, private-key generation, phrase ceremony, or custody;
- direct execution, live apply, rollback, models, Fusion, memory, or UI.

Portable hashing and public-key verification use explicitly imported,
version-pinned library entrypoints. Random or private-key APIs from those
libraries are never called or re-exported.

## Adapter contract

An adapter must:

1. load and validate policy bytes and trusted roots;
2. supply `nowMs` explicitly;
3. load the prior `TrustedStateV1`;
4. call `decide` exactly once per attempted transition;
5. atomically persist `nextState` and the finalized receipt, or persist neither;
6. execute effects only after an allowed decision is durably consumed;
7. expose no alternative authority path.

Convex OCC, SQL transactions, filesystem locks, or other persistence mechanics
belong to adapters. The base package makes no platform atomicity claim.

## Evolution law

Accepted kernel `K_n` may govern proposals to Symbiote. It may not certify a
change to its own authority semantics. A candidate `K_n+1` requires frozen
external conformance tests, independent review, verification under `K_n`, and
Peter's explicit approval. Nothing self-signs, self-merges, or self-promotes.

## Release gate

A v0.1 release is blocked unless:

- the forbidden-capability scan is green;
- schemas reject unknown fields and unratified versions;
- canonical bytes and reducer results match frozen vectors;
- hybrid negative vectors prove one-signature downgrade attempts refuse;
- replay vectors prove a second consumption refuses;
- Merkle and artifact tamper vectors fail closed;
- the package tarball contains only declared distribution files;
- the tarball installs and verifies in an empty project without Convex;
- public claims remain limited to tested PROVEN-LAB behavior.
