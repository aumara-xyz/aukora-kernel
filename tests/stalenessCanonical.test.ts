// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as canonical from "../packages/kernel/src/staleness.js";

describe("staleness single-source boundary", () => {
  it("the Symbiote compatibility file can only re-export the canonical package subpath", () => {
    const source = readFileSync(
      new URL("../apps/symbiote/core/src/stalenessCore.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("export * from '@aukora/kernel/staleness';");
    expect(source).not.toMatch(/function\s+(stampExpiresBy|stalenessVerdict|challengeStalenessGate)/);
  });

  it("the canonical primitive cannot grant authority", () => {
    expect(canonical.stalenessGrantsAuthority()).toBe(false);
  });
});
