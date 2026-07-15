# `@aukora/kernel`

Portable deterministic authority verification and state reduction for Aukora.

From a repository checkout:

```sh
npm ci
npm run test:kernel
node packages/kernel/examples/observe.mjs
```

This package is being extracted from the PROVEN-LAB Convex application. Its
normative boundary is documented in
[`docs/KERNEL_V0_BOUNDARY.md`](https://github.com/aumara-xyz/aukora-kernel/blob/main/docs/KERNEL_V0_BOUNDARY.md).

The base package does not hold private keys, read environment or wall-clock
state, access storage or networks, or execute an allowed decision.

```ts
import { canonicalBytes, decide } from "@aukora/kernel";

const policy = {
  schema: "aukora-policy-v1",
  rules: [{
    action: { namespace: "example", kind: "record", verb: "observe" },
    resourceNamespace: "artifact",
    maxRing: "observe",
    requiresAuthorization: false,
  }],
  sacred: [],
};
const trustedState = {
  schema: "aukora-trusted-state-v1",
  salama: { active: false, reason: null },
  trustedRoots: [],
  consumedIds: [],
  receiptHead: { count: 0, headHash: null },
};
const request = {
  schema: "aukora-kernel-request-v1",
  requestId: "observe-1",
  action: { namespace: "example", kind: "record", verb: "observe" },
  resource: { namespace: "artifact", id: "sample" },
  ring: "observe",
  payloadHash: null,
  consumptionId: null,
  humanClearance: false,
  authorization: null,
  evidenceRefs: [],
};

const nowMs = 1_735_689_600_000; // supplied by the caller
const result = decide(request, trustedState, canonicalBytes(policy), nowMs);
if (result.decision.status === "allowed") {
  // Atomically persist result.nextState and a finalized receipt before an
  // adapter executes any effect. Execution is deliberately outside the kernel.
}
```

Every authority-bearing input is explicit. Policy bytes must already be in the
package's canonical JSON form, public schemas reject unknown fields, and replay
state is advanced only for an allowed consumption. Every attempt still produces
a chained, unsigned receipt draft.

Verification profiles are purpose-specific:

- AUMLOK promotion/lifecycle authority requires both Ed25519 and ML-DSA-65 over
  the same canonical payload.
- Existing receipt-head V4 evidence verifies under its frozen ML-DSA-65-only
  format and purpose domain.

Neither profile is a fallback for the other. This package verifies public-key
evidence only; it exports no key generation, signing, custody, transport, or
live-apply capability.

Frozen portable vectors are exported as
`@aukora/kernel/conformance/v1.json` and
`@aukora/kernel/conformance/hybrid-v1.json`. The complete package boundary
and adapter obligations are documented in
[`docs/KERNEL_V0_BOUNDARY.md`](https://github.com/aumara-xyz/aukora-kernel/blob/main/docs/KERNEL_V0_BOUNDARY.md).
