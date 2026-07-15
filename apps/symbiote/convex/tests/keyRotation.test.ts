// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/// <reference types="vite/client" />
/**
 * Brick 7 — KEY ROTATION / VERSIONING for the AUMLOK PoP resolver, against the REAL deployed resolver via convex-test.
 * Lifecycle: active (issue+verify) -> retired (grandfather caps issued before retiredAt; cannot issue new) -> revoked (dead).
 * Every cap/request carries founderKeyId; the resolver verifies against the PINNED key for that keyId.
 */
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api"; // S1a: every vendored registration is internal-only (B1)
import { mlDsa65PublicKeyFromSeed } from "../aukoraPqcSigner";
import { buildPoPEnvelope, POP_FRESHNESS_MS, resolvePoPSession } from "../popResolver";

const modules = import.meta.glob(["../*.ts", "../_generated/*.js", "!../vitest.config.ts"]); // S1a: pinned glob (tests live inside convex/)
const OLD = "11".repeat(32), NEW = "22".repeat(32);
const NODE = "aukora-node-a-demo";

async function setup(run: string) {
  const t = convexTest(schema, modules);
  const founderUserId = `demo.founder.rot:${run}`, t0 = Date.now();
  await t.mutation(internal.popResolver.seedFounderKey, { founderUserId, keyId: "fk-old", publicKey: await mlDsa65PublicKeyFromSeed(OLD) });
  const cav = (capId: string, keyId: string, over: any = {}) => ({ v: 1, capId, founderUserId, founderKeyId: keyId, nodeId: NODE, methods: ["popIssueGrant"], ring: "local-write", action: "echo", resource: "echo:demo", principalId: founderUserId, roles: ["operator"], notBefore: t0 - 1000, expiresAt: t0 + POP_FRESHNESS_MS, maxUses: 1, ...over });
  return { t, founderUserId, t0, cav };
}
// S1a: the donor's `popGatedAct` demo mutation is intentionally removed from deployed code (no public surface,
// no demo grant-minter). The SAME real resolver + the representative gated effect (grant scope DERIVED from the
// SIGNED caveats, never hardcoded) now run harness-side via t.run — which keeps donor mutation semantics
// (a throw rolls back ALL writes, including rate-limit + nonce consumption).
const gatedAct = (t: any, env: any, methodId: string, actualArgs: any) =>
  t.run(async (ctx: any) => {
    const session = await resolvePoPSession(ctx, env, methodId, actualArgs, NODE); // throws pop_* -> rolls back
    await ctx.db.insert("aukora_grants", { grantKey: `pop_${NODE}_${env.nonce}`, status: "active", actorId: session.principalId, actorRole: "operator", ring: (session.ring ?? "local-write") as any, action: session.action ?? "echo", resource: session.resource ?? "echo:demo", issuedBy: session.principalId, issuedAt: Date.now(), expiresAt: Date.now() + 60_000, maxUses: 1, usedCount: 0, updatedAt: Date.now() });
    return { ok: true, session };
  });
const call = (t: any, env: any) => gatedAct(t, env, "popIssueGrant", { grant: "echo" });
const env = (seed: string, cav: any, nonceTag: string) => buildPoPEnvelope(seed, cav, { methodId: "popIssueGrant", actualArgs: { grant: "echo" }, timestamp: Date.now(), nonce: `n-${cav.capId}-${nonceTag}` });

describe("Brick 7 — key rotation / versioning (demo runnable suite)", () => {
  it("ACTIVE old key works", async () => {
    const s = await setup("a");
    expect((await call(s.t, await env(OLD, s.cav("c1", "fk-old"), "x"))).ok).toBe(true);
  });
  it("ROTATE: new key works after rotation", async () => {
    const s = await setup("b");
    await s.t.mutation(internal.popResolver.rotateFounderKey, { founderUserId: s.founderUserId, oldKeyId: "fk-old", newKeyId: "fk-new", newPublicKey: await mlDsa65PublicKeyFromSeed(NEW) });
    expect((await call(s.t, await env(NEW, s.cav("c2", "fk-new", { notBefore: Date.now() - 100 }), "x"))).ok).toBe(true);
  });
  it("RETIRED old key CANNOT issue a NEW cap (notBefore after retirement) -> pop_key_retired", async () => {
    const s = await setup("c");
    await s.t.mutation(internal.popResolver.rotateFounderKey, { founderUserId: s.founderUserId, oldKeyId: "fk-old", newKeyId: "fk-new", newPublicKey: await mlDsa65PublicKeyFromSeed(NEW) });
    await expect(call(s.t, await env(OLD, s.cav("c3", "fk-old", { notBefore: Date.now() + 5000 }), "x"))).rejects.toThrow("pop_key_retired");
  });
  it("RETIRED old key STILL verifies an in-window cap (issued before retirement) -> grandfathered", async () => {
    const s = await setup("d");
    const before = Date.now() - 500;
    await s.t.mutation(internal.popResolver.rotateFounderKey, { founderUserId: s.founderUserId, oldKeyId: "fk-old", newKeyId: "fk-new", newPublicKey: await mlDsa65PublicKeyFromSeed(NEW) });
    expect((await call(s.t, await env(OLD, s.cav("c4", "fk-old", { notBefore: before }), "x"))).ok).toBe(true);
  });
  it("REVOKED old key fails even for an in-window cap -> pop_key_revoked", async () => {
    const s = await setup("e");
    const before = Date.now() - 500;
    await s.t.mutation(internal.popResolver.seedFounderKey, { founderUserId: s.founderUserId, keyId: "fk-old", publicKey: await mlDsa65PublicKeyFromSeed(OLD), status: "revoked" });
    await expect(call(s.t, await env(OLD, s.cav("c5", "fk-old", { notBefore: before }), "x"))).rejects.toThrow("pop_key_revoked");
  });
  it("UNKNOWN keyId -> pop_key_unknown", async () => {
    const s = await setup("f");
    await expect(call(s.t, await env(NEW, s.cav("c6", "fk-ghost"), "x"))).rejects.toThrow("pop_key_unknown");
  });
  it("WRONG keyId binding: cap claims fk-old but is signed by the NEW seed -> pop_cap_sig_invalid", async () => {
    const s = await setup("g");
    await expect(call(s.t, await env(NEW, s.cav("c7", "fk-old"), "x"))).rejects.toThrow("pop_cap_sig_invalid");
  });
  it("REPLAY still fails after rotation (nonce ledger survives) -> pop_replay", async () => {
    const s = await setup("h");
    const e = await env(OLD, s.cav("c8", "fk-old"), "x");
    expect((await call(s.t, e)).ok).toBe(true);
    await s.t.mutation(internal.popResolver.rotateFounderKey, { founderUserId: s.founderUserId, oldKeyId: "fk-old", newKeyId: "fk-new", newPublicKey: await mlDsa65PublicKeyFromSeed(NEW) });
    await expect(call(s.t, e)).rejects.toThrow("pop_replay");
  });
  it("AUDIT: the nonce ledger records WHICH keyId authorized", async () => {
    const s = await setup("i");
    await call(s.t, await env(OLD, s.cav("c9", "fk-old"), "x"));
    const row: any = await s.t.run(async (ctx: any) => (await ctx.db.query("pop_nonce_registry").collect())[0]);
    expect(row.keyId).toBe("fk-old");
  });
});