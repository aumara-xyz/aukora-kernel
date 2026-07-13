// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
// Generates public deterministic conformance material only. Never use these
// fixed seeds or derived keys for custody, deployment, or production authority.

import { ed25519 } from "@noble/curves/ed25519.js";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  PURPOSE_DOMAINS,
  aumlokRootId,
  aumlokRootIntegrity,
  canonicalAumlokPromotion,
  canonicalBytes,
  canonicalHash,
  canonicalJson,
  decide,
} from "../packages/kernel/dist/index.js";

const nowMs = 1_735_689_600_000;
const payloadHash = canonicalHash("proposal-v1");
const edSeed = hexToBytes("11".repeat(32));
const mlSeed = hexToBytes("22".repeat(32));
const mlKeys = ml_dsa65.keygen(mlSeed);
const publicKeys = {
  ed25519: bytesToHex(ed25519.getPublicKey(edSeed)),
  mlDsa65: bytesToHex(mlKeys.publicKey),
};
const rootId = aumlokRootId(publicKeys);
const rootBase = {
  schema: "aumlok-authority-root-v2",
  suite: "aumlok-ed25519-ml-dsa-65-v1",
  rootId,
  publicKeys,
  mode: "software_hybrid",
  createdAt: "2024-01-01T00:00:00.000Z",
  expiresAt: "2099-01-01T00:00:00.000Z",
  revoked: false,
};
const root = { ...rootBase, integrity: aumlokRootIntegrity(rootBase) };
const authorization = {
  rootId,
  proposalHash: payloadHash,
  draftHash: payloadHash,
  nonce: "promotion-1",
  issuedAt: "2024-12-31T00:00:00.000Z",
  expiresAt: "2099-01-01T00:00:00.000Z",
};
const message = canonicalAumlokPromotion(authorization);
const signed = {
  schema: "aumlok-signed-promotion-v2",
  suite: "aumlok-ed25519-ml-dsa-65-v1",
  authorization,
  signatures: {
    ed25519: bytesToHex(ed25519.sign(message, edSeed)),
    mlDsa65: bytesToHex(ml_dsa65.sign(message, mlKeys.secretKey, {
      extraEntropy: false,
      context: utf8ToBytes(PURPOSE_DOMAINS.aumlokPromotion),
    })),
  },
  mode: "software_hybrid",
};
const policy = {
  schema: "aukora-policy-v1",
  rules: [{
    action: { namespace: "symbiote", kind: "source", verb: "promote" },
    resourceNamespace: "repo",
    maxRing: "self-modify",
    requiresAuthorization: true,
  }],
  sacred: [{ actionNamespace: "kernel", actionKind: "authority", resourceNamespace: "kernel" }],
};
const trustedState = {
  schema: "aukora-trusted-state-v1",
  salama: { active: false, reason: null },
  trustedRoots: [root],
  consumedIds: [],
  receiptHead: { count: 0, headHash: null },
};
const request = {
  schema: "aukora-kernel-request-v1",
  requestId: "request-1",
  action: { namespace: "symbiote", kind: "source", verb: "promote" },
  resource: { namespace: "repo", id: "aukora-symbiote" },
  ring: "self-modify",
  payloadHash,
  consumptionId: "proposal-1",
  humanClearance: true,
  authorization: signed,
  evidenceRefs: ["tests-green"],
};
const policyBytes = canonicalBytes(policy);
const expected = decide(request, trustedState, policyBytes, nowMs);

process.stdout.write(`${JSON.stringify({
  schema: "aukora-kernel-hybrid-conformance-v1",
  fixtureWarning: "PUBLIC DETERMINISTIC TEST MATERIAL — NEVER USE FOR CUSTODY OR DEPLOYMENT",
  name: "self-modify-allowed-mandatory-ed25519-plus-ml-dsa-65",
  nowMs,
  policyCanonicalJson: canonicalJson(policy),
  request,
  trustedState,
  expected,
  negativeMutations: [
    {
      name: "refuses-ed25519-only",
      signatureField: "mlDsa65",
      operation: "flip-first-hex",
      expectedDecisionCode: "authority_invalid",
    },
    {
      name: "refuses-ml-dsa-65-only",
      signatureField: "ed25519",
      operation: "flip-first-hex",
      expectedDecisionCode: "authority_invalid",
    },
  ],
}, null, 2)}\n`);
