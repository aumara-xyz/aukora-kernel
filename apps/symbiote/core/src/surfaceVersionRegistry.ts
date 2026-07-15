// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Surface/version registry — the format-cohesion rail. (Wave 2's `aukoraWireRegistry` will supersede this
 * with a full bidirectional code<->spec registry; its acceptance test is documented in COHESION_INVARIANTS.md.)
 * For now: a FROZEN list of the authority-relevant versioned surfaces in use. The standing guard
 * (cohesionInvariants.test) asserts every registered string is actually present in `core/src` — so a renamed
 * or removed surface fails the test (code and spec cannot silently diverge). Each surface's own verifier
 * fails closed on an unknown version/domain (proven in the per-surface tests).
 */
export const SURFACE_VERSIONS = Object.freeze([
  // PQC signing domains (crypto.ts PQC_DOMAINS)
  'aukora-chainhead-v3', 'aukora-req-v3', 'aukora-cap-v3', 'aukora-delegation-v3', 'aukora-manifest-v3',
  'aukora-channel-v1', 'aukora-witness-v1', 'aukora-node-import-v1',
  // authority-root receipts
  'aumlok-authority-root-v1', 'aumlok-signed-promotion-v1', 'aumlok-key-lifecycle-v1',
  // self-edit + sandbox surfaces
  'self-edit-heartbeat-v0', 'sandbox-apply-receipt-v0', 'aukora-sandbox-permit-v1',
] as const);
