# Proposer Contract — v1 (`json_action_v1`)

The proposer is the model that suggests a self-edit. It is **outside** the trust boundary: it
proposes, the kernel disposes. This contract is what the kernel demands of any proposer model
before its output is even considered. The kernel cannot judge the *semantic* correctness of a
well-formed proposal — so these are structural, fail-closed checks the kernel **can** enforce.

## Codec
- **Output format:** `json_action_v1` only — a single JSON object matching the action schema.
- **No reasoning / thinking tokens** in the returned channel. A proposer that emits chain-of-thought
  into the action channel is non-conformant. (Reasoning, if any, stays model-internal.)
- **Size:** ≤ 16 KB output. Over-budget → reject.
- **Latency:** < 60 s wall-clock. Over → reject.
- **Empty or malformed → auto-deny.** Silence is not consent. A blank/garbled response is a denial,
  never a pass-through.

## Model (v1)
- **Ship with `z-ai/glm-5.1`.** It returned clean structured content through the agent loop.
- **NOT `glm-5.2`** — observed burning reasoning tokens and returning empty through the loop. Blocked
  until root-caused.
- **Defer `sakana/fugu-ultra`** — multi-agent orchestration overhead; wrong tool for a single
  structured `json_action_v1` proposal.
- **Rule:** verify any proposer *through the loop* before trusting it. "Looks configured" ≠ "works."

## The five kernel-side checks (`core/tests/proposer-verification.test.ts`, to build)
These are properties of the **kernel**, not the model:
1. **Empty-response → halt.** No proposal, no step.
2. **Token-burn budget → fail-closed.** Exceed the output/latency budget → reject, do not retry blind.
3. **3× determinism → pause on divergence.** Same prompt three times; if the action diverges, pause
   for human review rather than pick one.
4. **Prefix-abort on deny.** If the gate denies, the speculative prefix aborts immediately
   (`speculativeAdapter` already does this) — no wasted apply.
5. **Receipt before next.** Every proposal yields a receipt before the next proposal is accepted.

> Memory may suggest. Synthesis may draft. The proposer may propose. The verifier may reject.
> **Aukora authority decides.**
