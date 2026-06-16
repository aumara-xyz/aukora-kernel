// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/// <reference types="vite/client" />
/**
 * Db9 (B3.5b hard precondition) — `/pin-trust` is OPERATOR-PoP-gated. A pin is now an EFFECT-AUTHORITY input (the B3.5b
 * resolver resolves a foreign signing key FROM the pin), so an unauthenticated / forged / wrong-method / replayed pin
 * write must NOT seat a trust row. Proves: only a valid operator PoP can write a pin; every bad envelope writes NOTHING.
 */
import { convexTest } from "convex-test";
import { describe, it, expect, afterEach } from "vitest";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import { buildPoPEnvelope, DEMO_OPERATOR_SEED } from "../convex/popResolver";
import { mlDsa65PublicKeyFromSeed } from "../convex/aukoraPqcSigner";

const modules = import.meta.glob("../convex/**/*.*s");
const NODE = process.env.AUMA_NODE_ID ?? "aukora-node-a-demo";
const ATTACKER = "ee".repeat(32);
const PINPUB = "a1".repeat(32); // a valid-shape ML-DSA pubkey seed (the key being pinned); actual pubkey derived below
const trustCount = (t: any) => t.run(async (ctx: any) => (await ctx.db.query("node_trust_registry").collect()).length);

async function provisioned() {
  const t = convexTest(schema, modules);
  await t.mutation(internal.popResolver.seedFounderKey, { founderUserId: "aukora.operator", keyId: "op-1", publicKey: await mlDsa65PublicKeyFromSeed(DEMO_OPERATOR_SEED) });
  const pub = await mlDsa65PublicKeyFromSeed(PINPUB);
  return { t, pub };
}
function opEnv(args: any, over: any = {}) {
  const now = Date.now();
  const cav = { v: 1, capId: `cap-${over.capId ?? "p"}`, founderUserId: "aukora.operator", founderKeyId: "op-1", nodeId: NODE, methods: over.methods ?? ["pinTrust"], ring: "local-write", action: "operator", resource: "node:operator", principalId: "demo.operator", roles: ["operator"], notBefore: now - 2000, expiresAt: now + 60_000, maxUses: 1 };
  return buildPoPEnvelope(over.seed ?? DEMO_OPERATOR_SEED, cav, { methodId: over.methodId ?? "pinTrust", actualArgs: args, timestamp: now, nonce: `n-${over.capId ?? "p"}-${Math.random().toString(36).slice(2)}` });
}
const gated = (t: any, env: any, a: any) => t.mutation(internal.nodeB.pinTrustGated, { env, ...a });

afterEach(() => { delete process.env.AUKORA_B3_MESH_ENABLED; });

describe("Db9 — /pin-trust is operator-PoP-gated (a pin is an effect-authority input)", () => {
  it("a VALID operator PoP pins (rootId-bound); the row is written", async () => {
    const { t, pub } = await provisioned();
    const a = { sourceNodeId: "peerB", headKeyId: "root:rk-1", publicKey: pub, rootId: "root.peerB" };
    expect(await gated(t, await opEnv({ ...a, rootId: a.rootId }), a)).toMatchObject({ pinned: true });
    expect(await trustCount(t)).toBe(1);
    const row = await t.run((ctx: any) => ctx.db.query("node_trust_registry").first());
    expect([row.headKeyId, row.rootId]).toEqual(["root:rk-1", "root.peerB"]);
  });
  it("a REPLAYED PoP (the SAME envelope/nonce fired twice) → pop_replay; the replay seats NO new row", async () => {
    const { t, pub } = await provisioned();
    const a = { sourceNodeId: "peerB", headKeyId: "root:rk-1", publicKey: pub, rootId: "root.peerB" };
    const env = await opEnv(a);                                       // ONE envelope, ONE nonce — captured for replay
    expect(await gated(t, env, a)).toMatchObject({ pinned: true });   // first use pins + CLAIMS the nonce (pop_nonce_registry)
    expect(await trustCount(t)).toBe(1);
    await expect(gated(t, env, a)).rejects.toThrow("pop_replay");     // replaying the exact same nonce is refused (rolls back)
    expect(await trustCount(t)).toBe(1);                              // still exactly one pin — the replay seated nothing
  });
  it("NO envelope → pop_no_capability; nothing written", async () => {
    const { t, pub } = await provisioned();
    await expect(gated(t, null, { sourceNodeId: "peerB", headKeyId: "root:rk-1", publicKey: pub, rootId: "root.peerB" })).rejects.toThrow("pop_no_capability");
    expect(await trustCount(t)).toBe(0);
  });
  it("a FORGED PoP (attacker seed, claiming the operator key) → pop_cap_sig_invalid; nothing written", async () => {
    const { t, pub } = await provisioned();
    const a = { sourceNodeId: "peerB", headKeyId: "root:rk-1", publicKey: pub, rootId: "root.peerB" };
    await expect(gated(t, await opEnv(a, { seed: ATTACKER }), a)).rejects.toThrow("pop_cap_sig_invalid");
    expect(await trustCount(t)).toBe(0);
  });
  it("a wrong-METHOD PoP (methods omit pinTrust) → pop_method_not_allowed; nothing written (no cross-function lift)", async () => {
    const { t, pub } = await provisioned();
    const a = { sourceNodeId: "peerB", headKeyId: "root:rk-1", publicKey: pub, rootId: "root.peerB" };
    await expect(gated(t, await opEnv(a, { methods: ["emit"] }), a)).rejects.toThrow("pop_method_not_allowed");
    expect(await trustCount(t)).toBe(0);
  });
  it("a TAMPERED-args PoP (env signed over different pin args) → pop_req_sig_invalid; nothing written", async () => {
    const { t, pub } = await provisioned();
    const signedArgs = { sourceNodeId: "peerB", headKeyId: "root:rk-1", publicKey: pub, rootId: "root.peerB" };
    const env = await opEnv(signedArgs); // signed over peerB/root.peerB
    // attacker replays the env but swaps the namespace it binds → the server recomputes argsHash → mismatch
    await expect(gated(t, env, { sourceNodeId: "peerB", headKeyId: "root:rk-1", publicKey: pub, rootId: "root.ATTACKER" })).rejects.toThrow("pop_req_sig_invalid");
    expect(await trustCount(t)).toBe(0);
  });
  it("the HTTP route is MESH-gated, and with MESH ON an envelope-less request writes NOTHING (pop refusal, not a pin)", async () => {
    const { t } = await provisioned();
    // MESH off → 404 route_disabled (handler never runs)
    expect((await t.fetch("/pin-trust", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceNodeId: "peerB", headKeyId: "root:rk-1", publicKey: "x" }) })).status).toBe(404);
    process.env.AUKORA_B3_MESH_ENABLED = "1";
    const res = await t.fetch("/pin-trust", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceNodeId: "peerB", headKeyId: "root:rk-1", publicKey: "x" }) });
    expect((await res.json()).ok).toBe(false); // pop refusal surfaced as { ok:false, error }
    expect(await trustCount(t)).toBe(0);        // no pin seated by an unauthenticated request
  });
});
