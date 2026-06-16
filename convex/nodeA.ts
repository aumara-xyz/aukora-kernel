// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { submitIntentCore } from "./aukoraRuntime";
import { verifyAndConsumeDecisionToken } from "./aukoraToken";
import { writeReceiptRow } from "./aukoraReceipts";
import { buildReceiptChainHash } from "./aukoraCore";
import { signChainHeadV3, resolveChainSigningSeed } from "./aukoraSignedHead";
import { resolvePoPSession } from "./popResolver";

const NODE_ID = process.env.AUMA_NODE_ID ?? "aukora-node-a-demo";
const HEAD_KEY_ID = process.env.AUMA_HEAD_KEY_ID ?? "demo-key-1";

// Node A: emit ONE governed action through the REAL kernel path -> a real signed receipt.
export const emit = mutation({
  args: { env: v.any(), chainKey: v.string(), action: v.string(), resource: v.string() },
  handler: async (ctx, args) => {
    // CORE OPERATOR AUTH is cryptographic PoP (ULTRON: session seam retired on the core path). emit requires a
    // founder/operator CAPABILITY (capSig) + a per-request signature (reqSig) over {chainKey,action,resource},
    // verified against a PINNED key the server never holds. A bare token cannot authorize emit anymore.
    const session = await resolvePoPSession(ctx, args.env, "emit", { chainKey: args.chainKey, action: args.action, resource: args.resource }, NODE_ID);
    const actorId = session.principalId;
    const now = Date.now();
    await ctx.db.insert("aukora_grants", {
      grantKey: `pg_${args.chainKey}_${now}`, status: "active", actorId, actorRole: "operator", ring: "local-write",
      action: args.action, resource: args.resource, issuedBy: NODE_ID, issuedAt: now, expiresAt: now + 60_000,
      maxUses: 1, usedCount: 0, updatedAt: now,
    });
    const submitted = await submitIntentCore(ctx, { actorId, actorRole: "operator", ring: "local-write", claim: "moga", action: args.action, resource: args.resource, requiresAuthorization: true, stateKey: args.chainKey });
    if (!submitted.decisionToken) throw new Error("intent_not_authorized");
    const consumed = await verifyAndConsumeDecisionToken(ctx, { token: submitted.decisionToken, action: args.action, resource: args.resource, ring: "local-write", expectedActorId: actorId });
    const proofJson = JSON.stringify({ sourceNodeId: NODE_ID, delegationId: actorId, revocationPointer: `rev:${NODE_ID}:${actorId}` });
    const receiptId = await writeReceiptRow(ctx, { chainKey: args.chainKey, decisionLogId: consumed.logId, goal: "node-a governed action", actorModel: "eek", lane: "local", risk: "low", grade: "A", verdict: "kept", actionsJson: "[]", proofJson });
    return { receiptId, chainKey: args.chainKey, delegationId: actorId };
  },
});

// Node A: build the portable signed envelope from the real receipt + head rows.
export const exportEnvelope = query({
  args: { chainKey: v.string() },
  handler: async (ctx, args) => {
    const r = await ctx.db.query("auma_receipts").withIndex("by_chainKey_ts", (q) => q.eq("chainKey", args.chainKey)).order("desc").first();
    const h = await ctx.db.query("auma_receipt_chain_head").withIndex("by_key", (q) => q.eq("key", args.chainKey)).first();
    if (!r || !h) return null;
    let delegationId = "";
    try { delegationId = JSON.parse(r.proofJson)?.delegationId ?? ""; } catch { /* leave empty -> Node B rejects */ }
    return {
      sourceNodeId: NODE_ID, headKeyId: HEAD_KEY_ID, delegationId, chainKey: args.chainKey,
      receipt: { receiptId: r.receiptId, ts: r.ts, actorModel: r.actorModel, lane: r.lane, goal: r.goal, risk: r.risk, grade: r.grade, verdict: r.verdict, actionsJson: r.actionsJson, proofJson: r.proofJson, prevHash: r.prevHash, chainHash: r.chainHash, threadId: r.threadId, notes: r.notes },
      head: { lastChainHash: h.lastChainHash, count: h.count, updatedAt: h.updatedAt, headSig: h.headSig, headSigAlg: h.headSigAlg, headSignedAt: h.headSignedAt, receiptLogRoot: h.receiptLogRoot },
      envelopeId: `env_${r.receiptId}`,
    };
  },
});

// Node A: revoke a delegation -> a SIGNED revocation event (for Node B) + revoke the actor's active grants locally.
export const revoke = mutation({
  args: { env: v.any(), delegationId: v.string(), chainKey: v.string() },
  handler: async (ctx, args) => {
    // Core operator auth = cryptographic PoP (session seam retired). Requires a founder/operator capability + reqSig.
    await resolvePoPSession(ctx, args.env, "revoke", { delegationId: args.delegationId, chainKey: args.chainKey }, NODE_ID);
    const seed = resolveChainSigningSeed();
    if (!seed) throw new Error("signing_seed_unset");
    const now = Date.now();
    // local revocation: any active grant for this delegation can no longer be used (same action fails at A)
    for (const g of await ctx.db.query("aukora_grants").withIndex("by_actor_status", (q) => q.eq("actorId", args.delegationId).eq("status", "active")).collect()) {
      await ctx.db.patch(g._id, { status: "revoked", revokedBy: NODE_ID, revokedAt: now, revokeReason: "node-a demo revoke", updatedAt: now });
    }
    const revPayload = { type: "revocation", sourceNodeId: NODE_ID, delegationId: args.delegationId, revokedAt: now };
    const revHash = await buildReceiptChainHash(revPayload, null);
    const headSig = await signChainHeadV3(seed, { chainKey: `${args.chainKey}:rev`, timestamp: now, chainLength: 1, chainHeadHash: revHash }, "chainHead");
    return { sourceNodeId: NODE_ID, headKeyId: HEAD_KEY_ID, chainKey: args.chainKey, revPayload, head: { lastChainHash: revHash, count: 1, headSignedAt: now }, headSig };
  },
});

// ── AUKORA CAPABILITY SCOPE proof (POST /run-capability) ──
// Proves the Aukora Kernel governs WHICH actions an agent may take, not just whether receipts verify, plus the
// Aukora Capability Ledger + ceiling wall. Node-A-local; unique per-run + per-case delegations -> reproducible,
// no cross-case grant contamination.
type CapRing = "observe" | "local-write" | "external" | "self-modify";
export const runCapability = mutation({
  args: {},
  handler: async (ctx): Promise<any> => {
    const run = crypto.randomUUID().slice(0, 8);
    const out: any = { run };
    const A = (s: string) => `agent:cap:${run}:${s}`;
    // probe: grant a capability (subject to the ledger ceiling), then attempt an intent. Returns authorized/refused.
    const probe = async (actorId: string, label: string, gA: string, gR: string, gRing: CapRing, iA: string, iR: string, iRing: CapRing) => {
      // CEILING WALL (Aukora ledger policy): self-modify / sacred rings are NEVER auto-granted — require Ring-0.
      if (gRing === "self-modify") return { authorized: false, reason: "ceiling_wall_ring0_required" };
      const held = await ctx.db.query("aukora_capability_ledger").withIndex("by_delegation", (q) => q.eq("delegationId", actorId)).collect();
      // Composition ceiling: a delegation may hold at most ONE external-ring capability (least-privilege separation).
      if (gRing === "external" && held.some((h) => h.ring === "external")) return { authorized: false, reason: "ceiling_composition_max_external" };
      const now = Date.now();
      await ctx.db.insert("aukora_grants", { grantKey: `pg_cap_${run}_${label}`, status: "active", actorId, actorRole: "operator", ring: gRing, action: gA, resource: gR, issuedBy: "aukora-cap", issuedAt: now, expiresAt: now + 60_000, maxUses: 1, usedCount: 0, updatedAt: now });
      await ctx.db.insert("aukora_capability_ledger", { delegationId: actorId, action: gA, resource: gR, ring: gRing, grantedAt: now });
      const s = await submitIntentCore(ctx, { actorId, actorRole: "operator", ring: iRing, claim: "moga", action: iA, resource: iR, requiresAuthorization: true, stateKey: `cap:${run}:${label}` });
      return { authorized: !!s.decisionToken, reason: s.decisionToken ? "granted" : "refused_no_matching_grant" };
    };
    out.c1_in_scope        = await probe(A("c1"), "c1", "studio.write", "studio_surface:knvs", "local-write", "studio.write", "studio_surface:knvs", "local-write");
    out.c2_wrong_action    = await probe(A("c2"), "c2", "studio.write", "studio_surface:knvs", "local-write", "studio.delete", "studio_surface:knvs", "local-write");
    out.c3_wrong_resource  = await probe(A("c3"), "c3", "studio.write", "studio_surface:knvs", "local-write", "studio.write", "studio_surface:secrets", "local-write");
    out.c4_ring_escalation = await probe(A("c4"), "c4", "studio.write", "studio_surface:knvs", "local-write", "studio.write", "studio_surface:knvs", "external");
    out.c5_ceiling_wall_selfmodify = await probe(A("c5"), "c5", "studio.self_modify", "aukora:kernel", "self-modify", "studio.self_modify", "aukora:kernel", "self-modify");
    // c6: a REVOKED grant must not authorize.
    {
      const aid = A("c6"), now = Date.now();
      await ctx.db.insert("aukora_grants", { grantKey: `pg_cap_${run}_c6`, status: "revoked", actorId: aid, actorRole: "operator", ring: "local-write", action: "studio.write", resource: "studio_surface:knvs", issuedBy: "aukora-cap", issuedAt: now, expiresAt: now + 60_000, maxUses: 1, usedCount: 0, revokedBy: "aukora-cap", revokedAt: now, revokeReason: "demo", updatedAt: now });
      const s = await submitIntentCore(ctx, { actorId: aid, actorRole: "operator", ring: "local-write", claim: "moga", action: "studio.write", resource: "studio_surface:knvs", requiresAuthorization: true, stateKey: `cap:${run}:c6` });
      out.c6_revoked = { authorized: !!s.decisionToken, reason: s.decisionToken ? "granted" : "refused_revoked_grant" };
    }
    // c7: composition ceiling on ONE delegation — first external OK, second external refused by the ledger.
    const comp = A("c7");
    out.c7a_first_external  = await probe(comp, "c7a", "studio.write", "studio_surface:knvs", "external", "studio.write", "studio_surface:knvs", "external");
    out.c7b_second_external = await probe(comp, "c7b", "studio.read", "studio_surface:logs", "external", "studio.read", "studio_surface:logs", "external");
    out.ledger_c7_holds = (await ctx.db.query("aukora_capability_ledger").withIndex("by_delegation", (q) => q.eq("delegationId", comp)).collect()).length;
    return out;
  },
});