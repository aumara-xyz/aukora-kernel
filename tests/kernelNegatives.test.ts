// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/// <reference types="vite/client" />
/**
 * Brick 3 — KERNEL NEGATIVE tests that were previously inspection-only, now executing against the deployed node-a
 * kernel via convex-test: decision-token expiry, cross-actor binding, action/resource/ring mismatch, the empty/wildcard
 * grant matching NOTHING (F5-grant fail-closed), and a SACRED Ring-0 refusal that actually FIRES (not via no-grant).
 */
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../convex/schema";
import { submitIntentCore } from "../convex/aukoraRuntime";
import { verifyAndConsumeDecisionToken } from "../convex/aukoraToken";
import { AUKORA_DECISION_TOKEN_TTL_MS } from "../convex/aukoraCore";

const modules = import.meta.glob("../convex/**/*.*s");

async function mint(t: any, actor: string, action: string, resource: string, ring: string, sk: string) {
  return await t.run(async (ctx: any) => {
    const now = Date.now();
    await ctx.db.insert("aukora_grants", { grantKey: `g_${sk}`, status: "active", actorId: actor, actorRole: "operator", ring, action, resource, issuedBy: "test", issuedAt: now, expiresAt: now + 60_000, maxUses: 1, usedCount: 0, updatedAt: now });
    const s = await submitIntentCore(ctx, { actorId: actor, actorRole: "operator", ring, claim: "moga", action, resource, requiresAuthorization: true, stateKey: sk });
    return { token: s.decisionToken, logId: s.logId };
  });
}
const consume = (t: any, args: any) => t.run((ctx: any) => verifyAndConsumeDecisionToken(ctx, args));

describe("Kernel negatives — REAL kernel (demo runnable suite)", () => {
  it("decision token past TTL -> rejected", async () => {
    const t = convexTest(schema, modules);
    const m = await mint(t, "alice", "echo", "echo:demo", "local-write", "k-exp");
    await t.run(async (ctx: any) => { const r = await ctx.db.query("aukora_intent_logs").withIndex("by_logId", (q: any) => q.eq("logId", m.logId)).first(); await ctx.db.patch(r._id, { ts: Date.now() - AUKORA_DECISION_TOKEN_TTL_MS - 5000 }); });
    await expect(consume(t, { token: m.token, action: "echo", resource: "echo:demo", ring: "local-write" })).rejects.toThrow("aukora_decision_token_expired");
  });
  it("cross-actor token use -> rejected", async () => {
    const t = convexTest(schema, modules);
    const m = await mint(t, "alice", "echo", "echo:demo", "local-write", "k-actor");
    await expect(consume(t, { token: m.token, action: "echo", resource: "echo:demo", ring: "local-write", expectedActorId: "bob" })).rejects.toThrow("aukora_decision_actor_mismatch");
  });
  it("token action mismatch -> rejected", async () => {
    const t = convexTest(schema, modules);
    const m = await mint(t, "alice", "echo", "echo:demo", "local-write", "k-mm");
    await expect(consume(t, { token: m.token, action: "delete", resource: "echo:demo", ring: "local-write" })).rejects.toThrow("aukora_decision_action_mismatch");
  });
  it("token ring mismatch -> rejected", async () => {
    const t = convexTest(schema, modules);
    const m = await mint(t, "alice", "echo", "echo:demo", "local-write", "k-ring");
    await expect(consume(t, { token: m.token, action: "echo", resource: "echo:demo", ring: "observe" })).rejects.toThrow("aukora_decision_ring_mismatch");
  });
  it("empty/wildcard grant matches NOTHING (F5-grant fail-closed) -> no token", async () => {
    const t = convexTest(schema, modules);
    const r: any = await t.run(async (ctx: any) => {
      const now = Date.now();
      await ctx.db.insert("aukora_grants", { grantKey: "g_wild", status: "active", actorId: "alice", actorRole: "operator", ring: "local-write", action: "", resource: "", issuedBy: "test", issuedAt: now, expiresAt: now + 60_000, maxUses: 1, usedCount: 0, updatedAt: now });
      return await submitIntentCore(ctx, { actorId: "alice", actorRole: "operator", ring: "local-write", claim: "moga", action: "echo", resource: "echo:demo", requiresAuthorization: true, stateKey: "k-wild" });
    });
    expect(r.decisionToken).toBeFalsy();
  });
  it("SACRED Ring-0 target refused EVEN with a matching grant — the sacred gate FIRES (not no-grant)", async () => {
    const t = convexTest(schema, modules);
    const out: any = await t.run(async (ctx: any) => {
      const now = Date.now();
      await ctx.db.insert("aukora_grants", { grantKey: "g_sacred", status: "active", actorId: "alice", actorRole: "operator", ring: "self-modify", action: "kill_switch", resource: "x", issuedBy: "test", issuedAt: now, expiresAt: now + 60_000, maxUses: 1, usedCount: 0, updatedAt: now });
      const s = await submitIntentCore(ctx, { actorId: "alice", actorRole: "operator", ring: "self-modify", claim: "moga", action: "kill_switch", resource: "x", requiresAuthorization: true, stateKey: "k-sacred" });
      const log = await ctx.db.query("aukora_intent_logs").withIndex("by_state_ts", (q: any) => q.eq("stateKey", "k-sacred")).order("desc").first();
      return { token: s.decisionToken, status: log?.status, errorCode: log?.errorCode };
    });
    expect(out.token).toBeFalsy();          // refused despite a matching grant...
    expect(out.errorCode).toBe("sacred");    // ...because the SACRED gate fired (not no-grant)
  });
});

describe("Kernel ceilings — self-modify clearance + rate limit (ULTRON_PASS Bricks 4+5)", () => {
  it("self-modify refused EVEN with a directly-inserted matching grant — kernel ceiling, not the probe", async () => {
    const t = convexTest(schema, modules);
    const out: any = await t.run(async (ctx: any) => {
      const now = Date.now();
      // a NON-sacred self-modify grant inserted directly (the bypass scenario) — would authorize if not for the ceiling
      await ctx.db.insert("aukora_grants", { grantKey: "g_sm", status: "active", actorId: "alice", actorRole: "operator", ring: "self-modify", action: "studio.write", resource: "studio_surface:x", issuedBy: "test", issuedAt: now, expiresAt: now + 60_000, maxUses: 1, usedCount: 0, updatedAt: now });
      const s = await submitIntentCore(ctx, { actorId: "alice", actorRole: "operator", ring: "self-modify", claim: "moga", action: "studio.write", resource: "studio_surface:x", requiresAuthorization: true, stateKey: "k-sm" });
      const log = await ctx.db.query("aukora_intent_logs").withIndex("by_state_ts", (q: any) => q.eq("stateKey", "k-sm")).order("desc").first();
      return { token: s.decisionToken, errorCode: log?.errorCode };
    });
    expect(out.token).toBeFalsy();
    expect(out.errorCode).toBe("self_modify_requires_clearance");
  });
  it("self-modify WITH explicit humanClearance is allowed (clearance-gated ceiling, not a hard wall)", async () => {
    const t = convexTest(schema, modules);
    const ok: any = await t.run(async (ctx: any) => {
      const now = Date.now();
      await ctx.db.insert("aukora_grants", { grantKey: "g_sm2", status: "active", actorId: "alice", actorRole: "operator", ring: "self-modify", action: "studio.write", resource: "studio_surface:y", issuedBy: "test", issuedAt: now, expiresAt: now + 60_000, maxUses: 1, usedCount: 0, updatedAt: now });
      return await submitIntentCore(ctx, { actorId: "alice", actorRole: "operator", ring: "self-modify", claim: "moga", action: "studio.write", resource: "studio_surface:y", requiresAuthorization: true, humanClearance: true, stateKey: "k-sm2" });
    });
    expect(ok.decisionToken).toBeTruthy();
  });
  it("rate limit: capacity exhausted -> refused with NO intent-log dirty write", async () => {
    const t = convexTest(schema, modules);
    const rl = { key: "rl:alice", capacity: 2, windowMs: 60_000 };
    const res: any = await t.run(async (ctx: any) => {
      const out: any[] = [];
      for (let i = 0; i < 4; i++) out.push(await submitIntentCore(ctx, { actorId: "alice", actorRole: "operator", ring: "observe", claim: "moga", action: "echo", resource: "echo:demo", requiresAuthorization: false, rateLimit: rl, stateKey: `rl-${i}` }));
      const logs = (await ctx.db.query("aukora_intent_logs").collect()).length;
      return { tokens: out.map((o) => !!o.decisionToken), rateLimited: out.map((o) => !!o.rateLimited), logs };
    });
    expect(res.tokens).toEqual([true, true, false, false]);     // first 2 allowed, then exhausted
    expect(res.rateLimited).toEqual([false, false, true, true]);
    expect(res.logs).toBe(2);                                    // rate-limited spam wrote NO intent log (no dirty state)
  });
});