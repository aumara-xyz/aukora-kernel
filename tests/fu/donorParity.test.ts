// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..", "..");

const pairs = [
  ...["canonical.ts", "catalogue.ts", "digest.ts", "framing.ts", "index.ts", "types.ts", "validate.ts"]
    .map((name) => [`src/evidence/${name}`, `apps/fu/src/evidence/${name}`] as const),
  ...["aukoraFuCouncil.ts", "aukoraFuGlyph.ts", "aukoraFuSpendLedger.ts"]
    .map((name) => [`src/council/${name}`, `apps/fu/src/${name}`] as const),
];

describe("Fu donor parity", () => {
  for (const [canonical, donor] of pairs) {
    it(`${canonical} is byte-identical to ${donor}`, () => {
      expect(fs.readFileSync(path.join(root, canonical))).toEqual(fs.readFileSync(path.join(root, donor)));
    });
  }
});

