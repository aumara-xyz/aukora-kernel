// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/// <reference types="vite/client" />
/**
 * B3.3 PREP — two-node lab print verification, PROVEN IN THE LAB (no cloud deploy). Simulates two fresh lab nodes by
 * stamping each under a DISTINCT node-id + signing seed (env) in its own convex-test instance, and proves the exact
 * checks the real cloud print (`canon/AUKORA_TWO_NODE_PRINT_CHECKLIST.md`) must pass: deterministic byte-identical
 * stampHash per node, DISTINCT signing-key fingerprints + stampHashes across nodes, tier=lab, and ISOLATION (both route
 * flags OFF → cross-node + demo routes return 404 disabled; empty trust/import registries; no B0 demo-lane exposure).
 * This is print-PREP, not witness-mesh semantics: no networking, no cross-node data flow, no second deployment.
 */
import { convexTest } from "convex-test";
import { describe, it, expect, afterEach } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.*s");
const ORIG = { node: process.env.AUMA_NODE_ID, seed: process.env.AUKORA_CHAIN_SIGNING_SEED };
afterEach(() => { process.env.AUMA_NODE_ID = ORIG.node; process.env.AUKORA_CHAIN_SIGNING_SEED = ORIG.seed; });

// stamp one fresh lab node under a distinct (nodeId, signing seed); route flags stay UNSET (default OFF)
async function printNode(nodeId: string, seed: string) {
  process.env.AUMA_NODE_ID = nodeId; process.env.AUKORA_CHAIN_SIGNING_SEED = seed;
  const t = convexTest(schema, modules);
  const stamp: any = await t.mutation(api.aukoraNodeFactory.initNode, { deploymentLabel: nodeId, tier: "lab" });
  const reStamp: any = await t.mutation(api.aukoraNodeFactory.initNode, { deploymentLabel: nodeId, tier: "lab" }); // idempotent re-stamp = determinism
  const exportStatus = (await t.fetch("/export?chainKey=x", { method: "GET" })).status;   // cross-node route (MESH flag OFF)
  const importStatus = (await t.fetch("/import-delegated", { method: "POST" })).status;    // cross-node import (MESH flag OFF)
  const runDemoStatus = (await t.fetch("/run-demo", { method: "POST" })).status;           // B0/demo lane (DEMO flag OFF)
  const trustRows = (await t.run(async (ctx: any) => await ctx.db.query("node_trust_registry").collect())).length;
  const importRows = (await t.run(async (ctx: any) => await ctx.db.query("node_import_registry").collect())).length;
  return { stamp, reStamp, exportStatus, importStatus, runDemoStatus, trustRows, importRows };
}

describe("B3.3 prep — two fresh lab nodes (deterministic stamp, distinct identities, isolated)", () => {
  it("distinct seeds → DISTINCT fingerprints + stampHashes; deterministic re-stamp; tier=lab; isolated (routes OFF, empty registries)", async () => {
    const A = await printNode("aukora-lab-alpha", "a1".repeat(32));
    const B = await printNode("aukora-lab-beta", "b2".repeat(32));

    // distinct identities (distinct signing seeds + node-ids ⇒ distinct fingerprints + stampHashes)
    expect(A.stamp.signingKeyFingerprint).not.toBe(B.stamp.signingKeyFingerprint);
    expect(A.stamp.stampHash).not.toBe(B.stamp.stampHash);
    expect([A.stamp.nodeId, B.stamp.nodeId]).toEqual(["aukora-lab-alpha", "aukora-lab-beta"]);
    expect([A.stamp.tier, B.stamp.tier]).toEqual(["lab", "lab"]);
    expect(A.stamp.signingKeyFingerprint).toMatch(/^[0-9a-f]{64}$/);

    // deterministic re-stamp: same config → no-op, identical stampHash (byte-identity of the stamp)
    expect([A.reStamp.stamped, A.reStamp.stampHash]).toEqual([false, A.stamp.stampHash]);
    expect([B.reStamp.stamped, B.reStamp.stampHash]).toEqual([false, B.stamp.stampHash]);

    // ISOLATION — no cross-node data flow is enabled (both flags default OFF)
    expect([A.exportStatus, A.importStatus, B.exportStatus, B.importStatus]).toEqual([404, 404, 404, 404]); // cross-node routes disabled
    expect([A.runDemoStatus, B.runDemoStatus]).toEqual([404, 404]); // B0/demo lane disabled (no demo-lane exposure)
    expect([A.trustRows, A.importRows, B.trustRows, B.importRows]).toEqual([0, 0, 0, 0]); // no peer pinned, nothing imported

    console.log("[TWO-NODE PREP] " + JSON.stringify({
      alpha: { nodeId: A.stamp.nodeId, tier: A.stamp.tier, fingerprint: A.stamp.signingKeyFingerprint, stampHash: A.stamp.stampHash },
      beta: { nodeId: B.stamp.nodeId, tier: B.stamp.tier, fingerprint: B.stamp.signingKeyFingerprint, stampHash: B.stamp.stampHash },
      isolation: { crossNodeRoutes: "404 disabled", demoLane: "404 disabled", trustRows: 0, importRows: 0 },
    }));
  });

  it("same node + same config across fresh instances → identical stampHash (deterministic / re-runnable print)", async () => {
    const A1 = await printNode("aukora-lab-alpha", "a1".repeat(32));
    const A2 = await printNode("aukora-lab-alpha", "a1".repeat(32));
    expect(A1.stamp.stampHash).toBe(A2.stamp.stampHash);
    expect(A1.stamp.signingKeyFingerprint).toBe(A2.stamp.signingKeyFingerprint);
  });

  it("production tier is refused at stamp (lab/dev only)", async () => {
    process.env.AUMA_NODE_ID = "aukora-lab-alpha"; process.env.AUKORA_CHAIN_SIGNING_SEED = "a1".repeat(32);
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.aukoraNodeFactory.initNode, { deploymentLabel: "aukora-lab-alpha", tier: "production" })).rejects.toThrow("aukora_node_tier_invalid");
  });
});
