# KERNEL_HOMEOSTASIS_CONTROL_FRAME

Status: implementation control record, 2026-07-14. Peter's explicit go has
activated the first directive below. This record does not authorize publishing,
signing, merging, license changes, cloud operations, or work in a dirty primary
checkout.

## 1. Verified pins and repository status

- Public kernel canonical base and `origin/main`:
  `2dd96f26d34c9e07649c2210ba1cbf64f6c026af`.
- Symbiote canonical remote base:
  `a2ffa30c836a7da8b5190824a77f1e9bf51546ad`.
- The public primary checkout is clean and untouched.
- The Symbiote primary checkout contains pre-existing work on another branch
  and is read-only for this lane.
- Kernel implementation is isolated in a clean worktree on
  `codex/kernel-v0-boundary`, based on the public kernel pin above.
- Verified baseline gates: public suite 35 files / 404 tests; Symbiote main CI
  green at the recorded remote pin.

## 2. Capability ownership ledger

| Classification | Canonical owner |
| --- | --- |
| `KERNEL_CANONICAL` | Closed schemas, canonical bytes, version/domain registries, policy/ring decisions, public-key authority verification, replay reduction, receipt drafts, receipt/Merkle/artifact evidence verification, and frozen conformance vectors. |
| `SYMBIOTE_CANONICAL` | AUMLOK private-key custody and ceremony, proposals, rehearsal/apply, memory, Fusion, self-model, runtime, UI, effect execution, and rollback. |
| `ADAPTER` | Loading explicit policy/time/roots/state, platform persistence and transactions, finalizing receipts, release pinning, compatibility checks, and executing effects only after durable consumption. |
| `INTENTIONAL_DIVERGENCE` | Convex application trees need not be byte-identical. AUMLOK authority is mandatory Ed25519 + ML-DSA-65; the frozen receipt-head V4 evidence profile is ML-DSA-65-only. Private OS/lab and transport code do not flow into the base kernel. |

## 3. Exact v0.1 boundary

The v0.1 base package is `@aukora/kernel`:

```ts
decide(request, trustedState, policyBytes, nowMs)
  -> { decision, nextState, receiptDraft }
```

It includes closed data schemas, canonical JSON, typed policy/ring reduction,
purpose-bound public-key verification, single-consumption replay state, chained
receipt drafts, RFC 6962 Merkle verification, artifact evidence verification,
and external JSON vectors.

Source under `packages/kernel/src` forbids Convex and generated APIs; private
repository imports; filesystem, process, environment, subprocess, Git, OS,
network and DOM capabilities; ambient time and randomness; signing, key
generation and custody; ML-KEM/AEAD transport; witnesses/federation; models,
Fusion, memory and UI; and direct execution/live apply.

## 4. Security-hardening order before public promotion

1. Preserve a private disclosure path for known demo/lab defaults; remove or
   fail closed on them before broader promotion without publishing exploit
   details first.
2. Enforce the portable import/capability boundary and closed schemas.
3. Freeze purpose-specific crypto profiles and negative downgrade vectors.
4. Verify future/expiry/revocation rules, replay, receipt chains, Merkle proofs,
   and artifact tamper/reorder failures.
5. Build, inspect, audit, and install the actual package tarball in an empty
   project without Convex.
6. Put Convex transaction and crash-boundary work in the adapter; do not place
   live execution in the portable package.
7. Obtain independent conformance review, then narrow public claims to the
   tested PROVEN-LAB evidence.

## 5. Small PR sequence

1. Portable v0.1 core: package boundary, reducer, verification, evidence,
   external vectors, and repeatable tarball gate.
2. Public-repository hardening: privately coordinated removal of disclosed
   demo defaults and isolation of remaining ambient capabilities.
3. `@aukora/kernel-convex`: explicit-input storage/transaction adapter with no
   alternative authority path.
4. Symbiote consumer: pin the reviewed kernel artifact and replace duplicated
   decision verification behind one compatibility adapter.
5. Release/claims pass: minimal example, migration notes, independent results,
   and counsel-approved licensing language.

## 6. Cross-repository conformance gates

- Symbiote pins an exact reviewed kernel release and lockfile integrity, never a
  floating range or private source copy.
- Kernel external vector bytes and their digest are frozen at the release pin.
- Kernel, Convex adapter, and Symbiote consumer all replay the same reducer,
  hybrid-negative, replay, receipt, Merkle, and artifact vectors.
- The adapter atomically persists next state plus receipt, or neither; no effect
  executes before durable single consumption.
- Symbiote has one kernel adapter and no competing local authority verifier.
- A compatibility manifest declares the accepted kernel version and vector
  digest. Both repository suites and clean-package installation must be green.
- A candidate authority-semantics release requires the accepted kernel, frozen
  external tests, independent review, and Peter's explicit approval.

## 7. Four-chat role and lease model

| Lane | Lease |
| --- | --- |
| Local Codex | Lead controller and sole writer for the clean kernel worktree until review handoff; reconciles reports and owns verification evidence. |
| Local Opus | Adversarial source, provenance, semantic-fork, and claims audit; read-only against canonical repositories; returns pin-bound findings. |
| Nebius Codex | Later clean-room package/conformance validator in a disposable environment; never canonical source; no credentials, spending, signing, or merges. |
| Nebius Opus | Independent adversarial architecture and claim review; read-only report lane, not an implementation authority. |

One path has one writer lease. Reports identify repository pins and evidence.
Expired or completed leases return to the lead before another lane writes the
same surface. Cross-lane agreement is evidence, not permission to self-merge.

## 8. Decisions requiring Peter and counsel

- Exact copyright owner/legal entity, title chain, and commercial-license
  grantor.
- OS to kernel to Symbiote provenance and whether any private history must
  remain undisclosed.
- Contributor and AI-assisted-code ownership records.
- DCO versus CLA/assignment needed for future commercial relicensing.
- AGPL network obligations, patent posture, trademark rules, and compatibility
  of all included dependencies and notices.
- Final commercial agreement, contributor terms, patent language, copyright
  notices, and release claims. None are changed by this lane.

## 9. First implementation directive

From public kernel
`2dd96f26d34c9e07649c2210ba1cbf64f6c026af`, create a clean
`codex/kernel-v0-boundary` worktree; add `@aukora/kernel` implementing only
`decide(request, trustedState, policyBytes, nowMs)` plus deterministic
verification/evidence helpers; enforce the forbidden-capability scan; freeze
external vectors; build and install the allowlisted tarball in an empty project;
and rerun the 404-test legacy suite. Do not modify dirty primary checkouts,
publish, push main, merge, sign, spend, or use owner credentials.

Authorization state: activated by Peter's explicit “clear to go” on 2026-07-14.

## 10. Five-line owner update

The public kernel is becoming a small verifier, not another copy of Symbiote.
It takes policy, trusted state, and time explicitly, then returns a decision and receipt draft.
Private keys, AI runtime, memory, UI, and live execution stay in Symbiote.
Both repositories meet through a pinned package, frozen vectors, and one adapter.
We will show investors something they can install and verify without exposing the private OS.
