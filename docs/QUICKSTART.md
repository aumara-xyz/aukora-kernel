# Aukora Kernel Quickstart

The portable kernel is a deterministic authority verifier. It receives a
request, trusted state, canonical policy bytes, and caller-supplied time. It
returns a decision, next replay state, and an unsigned chained receipt draft.
It never executes the decision.

## Verify the repository

```sh
npm ci
npm run test:kernel
npm test -- --reporter=dot
node packages/kernel/examples/observe.mjs
```

`test:kernel` enforces the no-Convex/no-ambient boundary, typechecks and tests
the package, builds it, inspects the tarball allowlist, installs the tarball in
an empty project, imports every documented export, and executes a frozen vector.
The second command runs the unchanged Convex reference-application suite.

## What to inspect

- `packages/kernel/src/reducer.ts`: the pure `decide(...)` transition.
- `packages/kernel/src/authority.ts`: purpose-specific verify-only profiles.
- `packages/kernel/conformance/`: executable cross-runtime JSON vectors.
- `docs/KERNEL_V0_BOUNDARY.md`: included and forbidden capabilities.

## Integration rule

An adapter supplies policy, time, roots, and prior state explicitly. It must
atomically persist the returned next state and finalized receipt, or neither.
Only after an allowed decision has been durably consumed may the adapter execute
an effect. The portable reducer defines the transition; the adapter provides
transactional enforcement.
