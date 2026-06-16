// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/// <reference types="vite/client" />
/**
 * Brick 6 — AUMLOK proof-of-possession resolver, proven against the REAL deployed resolver via convex-test.
 * Happy path + the 9 named attacks + DoS rate-limit. Authority is a per-request signature verified against a PINNED
 * key the server never holds — no bearer token exists.
 */
process.env.AUKORA_POP_RATE_CAP = "5"; // small cap so the DoS test exhausts quickly (per-founder bucket, fresh per test)
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { mlDsa65PublicKeyFromSeed } from "../convex/aukoraPqcSigner";
import { buildPoPEnvelope, POP_FRESHNESS_MS } from "../convex/popResolver";

const modules = import.meta.glob("../convex/**/*.*s");
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
const call = (t: any, env: any, methodId = "popIssueGrant", actualArgs: any = { grant: "echo" }) =>
  t.mutation(api.popResolver.popGatedAct, { env, methodId, actualArgs, nodeId: NODE });
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