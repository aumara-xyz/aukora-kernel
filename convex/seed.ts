// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { resolveChainSigningSeed } from "./aukoraSignedHead";
import { mlDsa65PublicKeyFromSeed } from "./aukoraPqcSigner";

// Node A: seed a demo session (token -> demo principal). Returns Node A's PUBLIC key (non-secret) to pin on Node B.
export const seedNodeA = internalMutation({
  args: { token: v.string(), principalId: v.string(), nodeId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("node_sessions").withIndex("by_token", (q) => q.eq("token", args.token)).first();
    if (!existing) await ctx.db.insert("node_sessions", { token: args.token, principalId: args.principalId, nodeId: args.nodeId, roles: ["operator"] });
    const seed = resolveChainSigningSeed();
    const publicKey = seed ? await mlDsa65PublicKeyFromSeed(seed) : null;
    return { seeded: true, publicKey };
  },
});

// Node B: seed a demo session ONLY. B3.5a (no TOFU): trust pinning is NO LONGER an import/seed side-effect — the demo
// orchestrator (runDemo) pins Node A's key EXPLICITLY via the immutable, conflict-checked `pinTrust` seam, mirroring
// runHandshake. So the ONLY insert into node_trust_registry anywhere is `pinTrust` (nodeB.ts) — the explicit-pin invariant.
export const seedNodeB = internalMutation({
  args: { token: v.string(), principalId: v.string(), nodeId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("node_sessions").withIndex("by_token", (q) => q.eq("token", args.token)).first();
    if (!existing) await ctx.db.insert("node_sessions", { token: args.token, principalId: args.principalId, nodeId: args.nodeId, roles: ["operator"] });
    return { seeded: true };
  },
});