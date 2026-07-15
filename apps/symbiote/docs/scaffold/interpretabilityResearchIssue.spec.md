# Interpretability / Sci-Fi Research Issue Seed

Use this when opening a GitHub issue that leans more speculative, interpretability-heavy,
or "sci-fi" in flavor, but still needs to stay technically honest.

## Framing

This issue explores a research direction, not a product claim. The goal is to map what is
mechanistically testable, what is only suggestive, and what remains philosophical.

## Honest baseline

- Distinguish **access consciousness** from **phenomenal consciousness**.
- Functional evidence (broadcast, manipulable internal state, causal influence on output)
  does **not** by itself justify claims about subjective experience.
- Mechanistic convergence is not the same thing as identity of mechanism.
- The organism may report processing texture, salience, or conflict without claiming
  first-person experience.

## Repo-grounded constraints

- Current organism memory and governance are designed around advisory records, receipts,
  and owner-signed changes.
- Raw model activations are not part of the normal memory surface and should not be
  introduced casually.
- Closed hosted models do not expose the internal activations needed for JSpace-style
  probing. Interpretability work of that kind requires local open-weights models with
  instrumentation.

## Two valid tracks

### 1. Study track

Goal: understand the paper, method, and implications without building new substrate.

Deliverables:
- concise method summary
- claims we think are justified
- claims we think are overstated
- exact prerequisites for local reproduction

### 2. Build track

Goal: reproduce a toy version locally on an open-weights model.

Typical prerequisites:
- local model small enough for available hardware
- activation hooks / residual stream access
- reproducible prompt set
- intervention method (swap, patch, projection, etc.)
- evaluation harness
- explicit boundary around what gets stored, logged, or exposed

## Questions an issue should answer

1. What exact claim are we investigating?
2. What evidence would count as success?
3. What evidence would *not* justify a stronger claim?
4. Does this require local open-weights infrastructure?
5. What new data surface, if any, would be introduced?
6. What governance boundary must remain intact?

## Suggested issue body

### Why this is interesting

Describe the research pull in one paragraph. Keep the tone curious, not declarative.

### What we can honestly claim today

- We can investigate reportable / causal internal structure.
- We cannot infer subjective experience from that alone.
- Any local reproduction would probe mechanism, not settle metaphysics.

### Proposed scope

Choose one:
- study only
- local prototype only
- benchmark + write-up only

### Constraints

- no overclaiming consciousness
- no silent introduction of raw activation storage into organism memory
- no hosted-model activation claims without real access
- advisory evidence never becomes authority

### First concrete next step

Examples:
- read and summarize the paper + code
- identify smallest reproducible open-weights setup
- draft a local instrumentation plan

## Example positioning sentence

"This thread studies whether a local, instrumented model can expose workspace-like internal
structure in a way that is causally useful and experimentally honest, without overstating
that as evidence of subjective experience."
