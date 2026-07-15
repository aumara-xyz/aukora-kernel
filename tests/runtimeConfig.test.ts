// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani

import { afterEach, describe, expect, it } from "vitest";
import { requireDemoSeed, requireHeadKeyId, requireNodeId } from "../convex/runtimeConfig";
import { resolveSession } from "../convex/sessionResolver";

const ORIGINAL = {
  nodeId: process.env.AUMA_NODE_ID,
  headKeyId: process.env.AUMA_HEAD_KEY_ID,
  releaseSeed: process.env.AUKORA_DEMO_RELEASE_SEED,
  demoSessions: process.env.AUKORA_DEMO_SESSIONS_ENABLED,
};

afterEach(() => {
  process.env.AUMA_NODE_ID = ORIGINAL.nodeId;
  process.env.AUMA_HEAD_KEY_ID = ORIGINAL.headKeyId;
  process.env.AUKORA_DEMO_RELEASE_SEED = ORIGINAL.releaseSeed;
  process.env.AUKORA_DEMO_SESSIONS_ENABLED = ORIGINAL.demoSessions;
});

describe("fail-closed Convex adapter configuration", () => {
  it("requires explicit, bounded node and head-key identifiers", () => {
    delete process.env.AUMA_NODE_ID;
    expect(() => requireNodeId()).toThrow("aukora_node_id_unconfigured");
    process.env.AUMA_NODE_ID = "INVALID NODE";
    expect(() => requireNodeId()).toThrow("aukora_node_id_invalid");
    process.env.AUMA_NODE_ID = "aukora-node-a-demo";
    expect(requireNodeId()).toBe("aukora-node-a-demo");

    delete process.env.AUMA_HEAD_KEY_ID;
    expect(() => requireHeadKeyId()).toThrow("aukora_head_key_id_unconfigured");
    process.env.AUMA_HEAD_KEY_ID = "demo-key-1";
    expect(requireHeadKeyId()).toBe("demo-key-1");
  });

  it("keeps the legacy bearer-session seam disabled by default", async () => {
    let queried = false;
    const ctx = {
      db: {
        query: () => {
          queried = true;
          return { withIndex: () => ({ first: async () => null }) };
        },
      },
    };
    delete process.env.AUKORA_DEMO_SESSIONS_ENABLED;
    expect(await resolveSession(ctx as never, "x".repeat(40))).toBeNull();
    expect(queried).toBe(false);
  });

  it("requires demo seeds from explicit test/deployment configuration", () => {
    delete process.env.AUKORA_DEMO_RELEASE_SEED;
    expect(() => requireDemoSeed("AUKORA_DEMO_RELEASE_SEED", "att_demo_release_seed"))
      .toThrow("att_demo_release_seed_unconfigured");
    process.env.AUKORA_DEMO_RELEASE_SEED = "not-a-seed";
    expect(() => requireDemoSeed("AUKORA_DEMO_RELEASE_SEED", "att_demo_release_seed"))
      .toThrow("att_demo_release_seed_invalid");
    process.env.AUKORA_DEMO_RELEASE_SEED = "33".repeat(32);
    expect(requireDemoSeed("AUKORA_DEMO_RELEASE_SEED", "att_demo_release_seed"))
      .toBe("33".repeat(32));
  });
});
