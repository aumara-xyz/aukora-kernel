// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// S1a: copied from aukora-os/node-template/vitest.config.ts@b399db1; only the layout note changed —
// here the config lives INSIDE convex/ and tests live in convex/tests/, so include stays "tests/**".
import { defineConfig } from "vitest/config";

// Standalone self-test for the vendored S1a kernel slice. Runs the REAL vendored functions in an in-memory Convex
// deployment (convex-test) with real kernel crypto. No real deployment / keys needed: `npm install && npm test`.
export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["tests/**/*.test.ts"],
    // B1.3b: ML-DSA-65 head signing costs more per receipt than the retired Ed25519 (a real, accepted PQC cost —
    // see the decision record's DoS-risk entry). The default 5s budget no longer fits; 30s keeps the suite honest
    // without weakening the signing path.
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
