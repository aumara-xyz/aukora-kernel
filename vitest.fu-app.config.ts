// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: path.resolve(import.meta.dirname, "apps/fu"),
  test: {
    environment: "node",
    include: [
      "test/aukoraFuGlyph.test.ts",
      "test/aukoraFuCouncil.test.ts",
      "test/aukoraFuSpendLedger.test.ts",
      "test/boundaryGuard.test.ts",
      "test/legacyTargetSafety.test.ts",
      "test/legacySampleArtifact.test.ts",
      "test/evidencePackV1.test.ts",
      "test/fuRound.test.ts",
    ],
    testTimeout: 30_000,
  },
});
