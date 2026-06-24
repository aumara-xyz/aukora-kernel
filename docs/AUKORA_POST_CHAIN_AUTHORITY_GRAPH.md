# Aukora Post-Chain Authority Graph

> Cryptographic trust for AI-mediated state change, without requiring every effect to live on a global blockchain.

## The short version

Blockchain proves transactions happened. Aukora proves authorized effects happened.

That difference matters because AI agents are not just moving tokens. They read memory, write files, edit documents,
call tools, deploy code, generate media, approve workflows, operate infrastructure, and eventually coordinate with other
agents. The hard question becomes:

> Who authorized this intelligence to act, what was it allowed to touch, what state changed, and can the evidence be
> verified later without trusting the model or the original app?

Aukora's answer is a post-quantum receipt spine for governed effects and artifacts. The database is not the ledger. The
signed receipt graph is the ledger.

## The core distinction

Traditional blockchain systems usually start with:

```text
address signs transaction -> network orders transaction -> ledger updates
```

Aukora starts with:

```text
principal grants authority -> agent proposes effect -> kernel gates effect -> state changes -> receipt proves custody
```

The first model is excellent for some forms of adversarial public settlement. The second model is built for delegated
AI action: private, scoped, revocable, auditable, tool-aware, memory-aware, and verifiable after the fact.

## What is proven in this repo now

This repository is still a **PROVEN-LAB** kernel, not a production system. The parts below are exercised by the in-repo
test suite:

- **Post-quantum signed heads:** ML-DSA-65 signed chain heads with algorithm binding and domain separation.
- **Append-only receipt history:** RFC 6962-style Merkle roots committed inside signed heads.
- **Single authority chokepoint:** live effects flow through `manifest -> grant -> token -> receipt`.
- **Witness verification:** a peer can verify a signed history head and record equivocation evidence.
- **Artifact custody receipts:** arbitrary bytes can be hashed, chained, signed, and verified; one-byte tamper,
  metadata rewrite, row reorder, truncation, wrong signer, and type-confusion fail closed.

The artifact custody primitive is the first headless proof that Aukora applies beyond code and agents. It can receipt
documents, media, model outputs, database exports, source files, research notes, and release artifacts.

## The larger architecture

The long-term object is a **causal authority graph**: a graph of effects, artifacts, policies, grants, witnesses,
memory references, state commitments, and revocations.

Each receipt can eventually bind:

- the principal or organization root that granted authority
- the human session or delegation ceremony
- the agent or adapter that proposed the effect
- the exact grant and policy version used
- the tool or workflow invoked
- pre-state and post-state commitments
- the artifact, file, database row, memory entry, model output, or workflow touched
- verifier results and witness signatures
- rollback or revocation evidence

This turns the kernel into a general trust substrate for AI-mediated state change. A coding agent editing a file, a
workflow agent approving a purchase order, a model producing a media asset, and a system archiving a contract can all
emit different receipt types under the same evidence discipline.

## Convex's role

Convex can be the reactive nervous system: live state, subscriptions, workflow coordination, collaboration, and UI
updates. It is a strong fit for making the system feel alive.

But Convex is not the final trust root. A database can index the world; Aukora receipts prove the world. Critical state
should be reconstructable or auditable from portable receipt bundles, signed heads, content hashes, policy hashes,
witness signatures, and state commitments.

The design rule is:

```text
Databases hold state. Aukora receipts hold proof.
```

## Rights before tokens

Aukora does not need to begin with coins or tokens. The deeper primitive is a governed right:

- right to edit a file
- right to access a memory
- right to invoke a model
- right to call a tool
- right to deploy
- right to publish
- right to license an artifact
- right to spend a budget
- right to spawn or delegate to another agent

Tokens or markets can be added later if useful. The kernel begins with authority, capability, receipt, and verification.

## What this can become

If the pattern matures, Aukora can become infrastructure for:

- agentic software development
- document and media provenance
- AI-generated artifact custody
- enterprise automation approvals
- compliance evidence
- software supply-chain events
- agent-to-agent delegation
- machine-to-machine workflows
- rights and license transfer
- optional public witnessing or blockchain anchoring

The key is that Aukora is not trying to be a cryptocurrency. It is trying to make AI-mediated effects accountable.

## What is intentionally not claimed

This repo does **not** claim:

- a coin, token, asset, or financial product
- consensus or global finality
- a public transparency network
- production security
- trusted global time
- truth of content
- anonymity or metadata privacy
- a blanket quantum-secure system
- autonomous swarm behavior
- universal agent intelligence

It proves lab-grade cryptographic custody and authority primitives that can be built into larger systems.

## Roadmap concepts

The following concepts are architectural direction, not current proven claims unless separately implemented and tested:

1. **Receipt DAGs:** receipts form graphs, not only linear chains.
2. **Content-addressed everything:** files, prompts, model outputs, grants, policies, diffs, test results, and receipts.
3. **Policy hash on every effect:** prove exactly which policy authorized the action.
4. **Grant hash on every effect:** prove exact scope, nonce, expiry, and principal.
5. **State commitment adapters:** portable pre-state and post-state hashes for files, databases, memory, artifacts, and
   workflows.
6. **Witness mesh:** local, team, enterprise, public, or blockchain witnesses as policy-defined verifiers.
7. **Proof bundle export:** portable bundles that verify offline without trusting the original app.
8. **Verifiable rollback:** rollback is itself a governed, receipted effect.
9. **Adapter certification:** each adapter declares capabilities, risk, rollback support, secret access, and receipt
   behavior.
10. **Selective disclosure:** prove authorization or custody facts without revealing private payloads.

## The sentence

> Aukora is post-chain infrastructure: a post-quantum authority graph for delegated AI action, verifiable artifacts, and
> governed state change.
