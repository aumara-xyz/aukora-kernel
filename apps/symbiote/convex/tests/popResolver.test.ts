// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/// <reference types="vite/client" />
/**
 * Brick 6 — AUMLOK proof-of-possession resolver, proven against the REAL deployed resolver via convex-test.
 * Happy path + the 9 named attacks + DoS rate-limit. Authority is a per-request signature verified against a PINNED
 * key the server never holds — no bearer token exists.
 */
process.env.AUKORA_POP_RATE_CAP = "5"; // small cap so the DoS test exhausts quickly (per-founder bucket, fresh per test)
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api"; // S1a: every vendored registration is internal-only (B1)
import { mlDsa65PublicKeyFromSeed } from "../aukoraPqcSigner";
import { buildPoPEnvelope, POP_FRESHNESS_MS, resolvePoPSession } from "../popResolver";

const modules = import.meta.glob(["../*.ts", "../_generated/*.js", "!../vitest.config.ts"]); // S1a: pinned glob (tests live inside convex/)
const FOUNDER_SEED = "dd".repeat(32);
const ATTACKER_SEED = "ee".repeat(32);
const NODE = "aukora-node-a-demo";

async function setup(run: string) {
  const t = convexTest(schema, modules);
  const pub = await mlDsa65PublicKeyFromSeed(FOUNDER_SEED);
  const founderUserId = `demo.founder:${run}`, keyId = "fk-1", now = Date.now();
  await t.mutation(internal.popResolver.seedFounderKey, { founderUserId, keyId, publicKey: pub });
  const cav = (capId: string, over: any = {}) => ({ v: 1, capId, founderUserId, founderKeyId: keyId, nodeId: NODE, methods: ["popIssueGrant"], ring: "local-write", action: "echo", resource: "echo:demo", principalId: founderUserId, roles: ["operator"], notBefore: now - 1000, expiresAt: now + POP_FRESHNESS_MS, maxUses: 1, ...over });
  return { t, founderUserId, keyId, now, cav };
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
const call = (t: any, env: any, methodId = "popIssueGrant", actualArgs: any = { grant: "echo" }) =>
  gatedAct(t, env, methodId, actualArgs);
const mkEnv = (seed: string, cav: any, over: any = {}) =>
  buildPoPEnvelope(seed, cav, { methodId: "popIssueGrant", actualArgs: { grant: "echo" }, timestamp: Date.now(), nonce: `n-${cav.capId}`, ...over });

describe("Brick 6 — AUMLOK proof-of-possession resolver (demo runnable suite)", () => {
  it("HAPPY: valid capSig + reqSig -> resolves; gated effect runs", async () => {
    const s = await setup("h");
    const r: any = await call(s.t, await mkEnv(FOUNDER_SEED, s.cav("cap-h")));
    expect(r.ok).toBe(true); expect(r.session.principalId).toBe(s.founderUserId);
  });
  it("STOLEN TOKEN / no bearer: a row or token buys nothing (unknown pinned key) -> pop_key_unknown", async () => {
    const s = await setup("st");
    await expect(call(s.t, await mkEnv(FOUNDER_SEED, s.cav("cap-st", { founderKeyId: "not-pinned" })))).rejects.toThrow("pop_key_unknown");
  });
  it("DIRECT DB INSERT / forged cap signed by attacker key -> pop_cap_sig_invalid (a write forges a value, not a sig)", async () => {
    const s = await setup("fc");
    await expect(call(s.t, await mkEnv(ATTACKER_SEED, s.cav("cap-fc")))).rejects.toThrow("pop_cap_sig_invalid");
  });
  it("REPLAY: same nonce twice -> 2nd is pop_replay", async () => {
    const s = await setup("rp");
    const env = await mkEnv(FOUNDER_SEED, s.cav("cap-rp"));
    expect((await call(s.t, env)).ok).toBe(true);
    await expect(call(s.t, env)).rejects.toThrow("pop_replay");
  });
  it("CROSS-FUNCTION lift: present a sig for a method not in caveats -> pop_method_not_allowed", async () => {
    const s = await setup("xf");
    await expect(call(s.t, await mkEnv(FOUNDER_SEED, s.cav("cap-xf")), "popKillSwitch")).rejects.toThrow("pop_method_not_allowed");
  });
  it("ARGS TAMPER: server recomputes argsHash -> pop_req_sig_invalid", async () => {
    const s = await setup("at");
    await expect(call(s.t, await mkEnv(FOUNDER_SEED, s.cav("cap-at")), "popIssueGrant", { grant: "ROOT" })).rejects.toThrow("pop_req_sig_invalid");
  });
  it("EXPIRED timestamp -> pop_expired", async () => {
    const s = await setup("ex");
    await expect(call(s.t, await mkEnv(FOUNDER_SEED, s.cav("cap-ex"), { timestamp: s.now - 5 * POP_FRESHNESS_MS }))).rejects.toThrow("pop_expired");
  });
  it("REVOKED cap -> pop_revoked", async () => {
    const s = await setup("rv");
    await s.t.mutation(internal.popResolver.revokePopCap, { founderUserId: s.founderUserId, capId: "cap-rv" });
    await expect(call(s.t, await mkEnv(FOUNDER_SEED, s.cav("cap-rv")))).rejects.toThrow("pop_revoked");
  });
  it("WRONG NODE: cap bound to another node -> pop_node_mismatch", async () => {
    const s = await setup("wn");
    await expect(call(s.t, await mkEnv(FOUNDER_SEED, s.cav("cap-wn", { nodeId: "other-node" })))).rejects.toThrow("pop_node_mismatch");
  });
  it("REVOKED KEY: founder key status=revoked -> pop_key_revoked", async () => {
    const s = await setup("rk");
    await s.t.mutation(internal.popResolver.seedFounderKey, { founderUserId: s.founderUserId, keyId: s.keyId, publicKey: await mlDsa65PublicKeyFromSeed(FOUNDER_SEED), status: "revoked" });
    await expect(call(s.t, await mkEnv(FOUNDER_SEED, s.cav("cap-rk")))).rejects.toThrow("pop_key_revoked");
  });
  it("SCOPE BINDING: the gated effect derives from the SIGNED caveat scope, never hardcoded", async () => {
    const s = await setup("sc");
    const cav = s.cav("cap-sc", { ring: "observe", action: "studio.read", resource: "studio:knvs" });
    const r: any = await call(s.t, await mkEnv(FOUNDER_SEED, cav));
    expect(r.ok).toBe(true);
    const grant: any = await s.t.run(async (ctx: any) => (await ctx.db.query("aukora_grants").collect()).find((g: any) => g.grantKey.startsWith("pop_")));
    expect([grant.ring, grant.action, grant.resource]).toEqual(["observe", "studio.read", "studio:knvs"]);
  });
  it("DoS rate-limit: capacity exhausted BEFORE crypto -> pop_rate_limited", async () => {
    const s = await setup("dos"); // cap=5
    const outcomes: string[] = [];
    for (let i = 0; i < 6; i++) {
      const env = await mkEnv(FOUNDER_SEED, s.cav(`cap-dos-${i}`), { nonce: `n-dos-${i}` });
      try { await call(s.t, env); outcomes.push("ok"); } catch (e: any) { outcomes.push(String(e.message).match(/pop_[a-z_]+/)?.[0] ?? "err"); }
    }
    expect(outcomes.slice(0, 5).every((o) => o === "ok")).toBe(true);
    expect(outcomes[5]).toBe("pop_rate_limited");
  });
});