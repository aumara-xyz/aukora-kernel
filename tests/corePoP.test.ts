// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/// <reference types="vite/client" />
/**
 * Session-seam → core PoP wiring (ULTRON top residual): nodeA.emit (the core operator action) now requires a
 * founder/operator CAPABILITY + per-request proof-of-possession, verified against a PINNED key — the plaintext session
 * seam is retired on the core path. These 9 cases prove a bare token can't authorize emit and every forgery is refused.
 */
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { mlDsa65PublicKeyFromSeed } from "../convex/aukoraPqcSigner";
import { buildPoPEnvelope, POP_FRESHNESS_MS } from "../convex/popResolver";

const modules = import.meta.glob("../convex/**/*.*s");
const OP = "77".repeat(32), ATTACKER = "88".repeat(32);
const AUTH = "aukora.operator", NODE = process.env.AUMA_NODE_ID ?? "aukora-node-a-demo";

async function setup() {
  const t = convexTest(schema, modules);
  await t.mutation(internal.popResolver.seedFounderKey, { founderUserId: AUTH, keyId: "op-1", publicKey: await mlDsa65PublicKeyFromSeed(OP) });
  const now = Date.now();
  const cav = (over: any = {}) => ({ v: 1, capId: `cap-emit-${over.capId ?? "x"}`, founderUserId: AUTH, founderKeyId: "op-1", nodeId: NODE, methods: ["emit", "revoke"], ring: "local-write", action: "studio.write", resource: "studio_surface:knvs", principalId: "demo.operator", roles: ["operator"], notBefore: now - 1000, expiresAt: now + POP_FRESHNESS_MS, maxUses: 1, ...over });
  const env = (cav: any, opts: any = {}) => buildPoPEnvelope(opts.seed ?? OP, cav, { methodId: opts.methodId ?? "emit", actualArgs: opts.actualArgs ?? { chainKey: "ck", action: "studio.write", resource: "studio_surface:knvs" }, timestamp: opts.timestamp ?? Date.now(), nonce: opts.nonce ?? `n-${cav.capId}` });
  const emit = (t: any, e: any, args: any = {}) => t.mutation(api.nodeA.emit, { env: e, chainKey: "ck", action: "studio.write", resource: "studio_surface:knvs", ...args });
  return { t, cav, env, emit };
}

describe("Core PoP — nodeA.emit requires founder/operator proof-of-possession (session seam retired)", () => {
  it("8. VALID cap + reqSig -> emit succeeds (real receipt)", async () => {
    const s = await setup();
    const r: any = await s.emit(s.t, await s.env(s.cav({ capId: "ok" })));
    expect(r.receiptId).toBeTruthy(); expect(r.delegationId).toBe("demo.operator");
  });
  it("1. MISSING capability (empty env) -> refused", async () => {
    const s = await setup();
    await expect(s.emit(s.t, {})).rejects.toThrow(/pop_no_capability|pop_/);
  });
  it("9. SESSION TOKEN alone cannot bypass (old {token} shape) -> refused", async () => {
    const s = await setup();
    await expect(s.emit(s.t, { token: "demo-operator-session" })).rejects.toThrow(/pop_no_capability|pop_/);
  });
  it("2. BAD reqSig (tampered) -> pop_req_sig_invalid", async () => {
    const s = await setup(); const e = await s.env(s.cav({ capId: "bad" })); e.reqSig = e.reqSig.slice(0, -4) + "0000";
    await expect(s.emit(s.t, e)).rejects.toThrow("pop_req_sig_invalid");
  });
  it("3. WRONG key (signed by attacker) -> pop_cap_sig_invalid", async () => {
    const s = await setup();
    await expect(s.emit(s.t, await s.env(s.cav({ capId: "wk" }), { seed: ATTACKER }))).rejects.toThrow("pop_cap_sig_invalid");
  });
  it("4. REPLAY (same nonce twice) -> 2nd pop_replay", async () => {
    const s = await setup(); const e = await s.env(s.cav({ capId: "rp" }), { nonce: "n-replay" });
    expect((await s.emit(s.t, e)).receiptId).toBeTruthy();
    await expect(s.emit(s.t, e)).rejects.toThrow("pop_replay");
  });
  it("5. CAP for WRONG METHOD (methods:['revoke']) -> pop_method_not_allowed", async () => {
    const s = await setup();
    await expect(s.emit(s.t, await s.env(s.cav({ capId: "wm", methods: ["revoke"] })))).rejects.toThrow("pop_method_not_allowed");
  });
  it("6. WRONG argsHash (signed for studio.write, called with studio.delete) -> pop_req_sig_invalid", async () => {
    const s = await setup(); const e = await s.env(s.cav({ capId: "wa" }), { actualArgs: { chainKey: "ck", action: "studio.write", resource: "studio_surface:knvs" } });
    await expect(s.emit(s.t, e, { action: "studio.delete" })).rejects.toThrow("pop_req_sig_invalid");
  });
  it("7. EXPIRED cap -> pop_cap_expired", async () => {
    const s = await setup(); const now = Date.now();
    await expect(s.emit(s.t, await s.env(s.cav({ capId: "ex", notBefore: now - 5 * POP_FRESHNESS_MS, expiresAt: now - 2 * POP_FRESHNESS_MS })))).rejects.toThrow("pop_cap_expired");
  });
  it("NODE TRUST ROOT: a pinned cross-node key cannot be overwritten with a different key (no /pin hijack)", async () => {
    const t = convexTest(schema, modules);
    const legitPub = await mlDsa65PublicKeyFromSeed("a7".repeat(32)); // validly-shaped fixtures (fresh pins are shape-gated since B1.3b)
    const attackerPub = await mlDsa65PublicKeyFromSeed("a8".repeat(32));
    await t.mutation(internal.nodeB.pinTrust, { sourceNodeId: "node-a", headKeyId: "demo-key-1", publicKey: legitPub });
    // idempotent same-key re-pin is allowed (the ceremony re-pins the stable node key each run)
    expect((await t.mutation(internal.nodeB.pinTrust, { sourceNodeId: "node-a", headKeyId: "demo-key-1", publicKey: legitPub })).idempotent).toBe(true);
    // overwrite with an attacker key -> refused (would otherwise let Node B verify forged Node A receipts)
    await expect(t.mutation(internal.nodeB.pinTrust, { sourceNodeId: "node-a", headKeyId: "demo-key-1", publicKey: attackerPub })).rejects.toThrow("pin_immutable_conflict");
  });
  it("TRUST ROOT: an ACTIVE operator key cannot be overwritten with a different pubkey (no public hijack of the gate)", async () => {
    const s = await setup(); // operator key already pinned with OP's pubkey
    // attempt to re-pin aukora.operator/op-1 with the ATTACKER pubkey -> refused (immutable while active)
    await expect(s.t.mutation(internal.popResolver.seedFounderKey, { founderUserId: AUTH, keyId: "op-1", publicKey: await mlDsa65PublicKeyFromSeed(ATTACKER) })).rejects.toThrow("pop_key_immutable_active");
    // and an attacker-signed emit still fails because the pinned key is unchanged
    await expect(s.emit(s.t, await s.env(s.cav({ capId: "hj" }), { seed: ATTACKER }))).rejects.toThrow("pop_cap_sig_invalid");
  });
});