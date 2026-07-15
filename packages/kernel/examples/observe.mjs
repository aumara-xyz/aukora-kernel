// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani

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
  requestId: "quickstart-observe-1",
  action: { namespace: "example", kind: "record", verb: "observe" },
  resource: { namespace: "artifact", id: "sample" },
  ring: "observe",
  payloadHash: null,
  consumptionId: null,
  humanClearance: false,
  authorization: null,
  evidenceRefs: [],
};

const result = decide(request, trustedState, canonicalBytes(policy), 1_735_689_600_000);
console.log(JSON.stringify(result, null, 2));
