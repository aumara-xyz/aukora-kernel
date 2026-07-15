// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
import { describe, expect, it } from "vitest";
import {
  challengeStalenessGate,
  DEFAULT_DRAFT_HORIZON_MS,
  EXPIRING_SOON_WINDOW_MS,
  stampExpiresBy,
  stalenessGrantsAuthority,
  stalenessVerdict,
} from "../src/staleness.js";

const T0 = Date.parse("2026-07-08T00:00:00.000Z");
const iso = (ms: number): string => new Date(ms).toISOString();

describe("portable staleness law", () => {
  it("moves from fresh to expiring-soon to stale at the stamped boundary", () => {
    const artifact = { createdAt: iso(T0), expiresBy: iso(T0 + 24 * 3_600_000) };
    expect(stalenessVerdict(artifact, T0 + 3_600_000)).toMatchObject({
      state: "fresh",
      flagged: false,
      ageLabel: "1h old",
      horizon: "stamped",
      expiringSoon: false,
    });
    expect(stalenessVerdict(
      artifact,
      T0 + 24 * 3_600_000 - EXPIRING_SOON_WINDOW_MS + 60_000,
    )).toMatchObject({ state: "fresh", expiringSoon: true });
    expect(stalenessVerdict(artifact, T0 + 25 * 3_600_000)).toMatchObject({
      state: "stale",
      flagged: true,
      ageLabel: "25h old",
    });
  });

  it("applies the default 72-hour horizon to unstamped legacy artifacts", () => {
    const artifact = { createdAt: iso(T0) };
    expect(stalenessVerdict(artifact, T0 + 71 * 3_600_000)).toMatchObject({
      state: "fresh",
      horizon: "default-draft-72h",
    });
    expect(stalenessVerdict(artifact, T0 + DEFAULT_DRAFT_HORIZON_MS + 1)).toMatchObject({
      state: "stale",
      flagged: true,
    });
  });

  it("flags unknown or malformed age instead of presenting it as current", () => {
    for (const artifact of [{}, { createdAt: 42 }, { createdAt: "not-a-date" }, null]) {
      expect(stalenessVerdict(artifact, T0)).toMatchObject({
        state: "stale",
        flagged: true,
        ageLabel: "age unknown",
        ageMs: null,
        horizon: "unknown-age",
      });
    }
  });

  it("stamps explicit horizons and rejects invalid timestamp inputs", () => {
    expect(stampExpiresBy(iso(T0), 3_600_000)).toBe(iso(T0 + 3_600_000));
    expect(() => stampExpiresBy("invalid")).toThrow(/created_at_invalid/);
    expect(() => stampExpiresBy(iso(T0), -1)).toThrow(/horizon_invalid/);
  });

  it("requires explicit revive for stale and unknown-age challenge creation", () => {
    const fresh = stalenessVerdict({ createdAt: iso(T0), expiresBy: iso(T0 + 3_600_000) }, T0 + 60_000);
    const stale = stalenessVerdict({ createdAt: iso(T0) }, T0 + DEFAULT_DRAFT_HORIZON_MS + 60_000);
    const unknown = stalenessVerdict({}, T0);
    expect(challengeStalenessGate(fresh, false)).toMatchObject({ allow: true, revived: false });
    expect(challengeStalenessGate(stale, false)).toMatchObject({ allow: false, reason: "proposal_stale" });
    expect(challengeStalenessGate(stale, true)).toMatchObject({ allow: true, revived: true });
    expect(challengeStalenessGate(unknown, false)).toMatchObject({ allow: false, reason: "proposal_stale" });
  });

  it("cannot grant authority", () => {
    expect(stalenessGrantsAuthority()).toBe(false);
  });
});
