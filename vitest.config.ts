// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
import { defineConfig } from "vitest/config";

// Standalone self-test for the Aukora eval slice. Runs the REAL deployed functions in an in-memory Convex deployment
// (convex-test) with real kernel crypto. No real deployment / keys needed: `npm install && npm test`.
// (The cross-node lanes — /run-demo, /run-handshake, /run-ceremony — use real HTTP between two deployments and are
//  exercised live + by the source-repo itests; the local lanes below run fully standalone.)
export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["tests/**/*.test.ts"],
    // B1.3b: ML-DSA-65 head signing costs more per receipt than the retired Ed25519 (a real, accepted PQC cost —
    // see the decision record's DoS-risk entry). Some tests mint many signed heads per run,
    // so the default 5s budget no longer fits; 30s keeps the suite honest without weakening the signing path.
    testTimeout: 30_000,
    server: { deps: { inline: ["convex-test"] } },
    env: {
      // Throwaway test values ONLY — never real secrets. The signing seed is a documented disposable 64-hex seed.
      AUKORA_TOKEN_SECRET: "slice-itest-secret-do-not-use-in-prod",
      AUKORA_CHAIN_SIGNING_SEED: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
      AUMA_NODE_ID: "aukora-node-a-demo",
    },
  },
});