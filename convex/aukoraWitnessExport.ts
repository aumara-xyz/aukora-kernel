// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/**
 * B3.3 — env-v1 WITNESS EXPORT. The `/export` route (gated `AUKORA_B3_WITNESS_ENABLED`, OFF in
 * live cloud) emits the B3.1 `env-v1` export envelope: a signed/summary HEAD + per-field DIGESTS —
 * **bodies ABSENT** (B3.1 P1: heads + digests/proofs cross, raw row bodies stay local). A witness
 * receives the head + the proof material, never the receipt contents. No new authority: read-only,
 * no grant (B2.4 untouched).
 */
import { query } from "./_generated/server";
import { v } from "convex/values";
import { buildExportEnvelope } from "./aukoraWireFormat";

const NODE_ID = (): string => process.env.AUMA_NODE_ID ?? "aukora-node-a-demo";
const HEAD_KEY_ID = (): string => process.env.AUMA_HEAD_KEY_ID ?? "demo-key-1";

/** `/export` — the receipt-history HEAD as a B3.1 env-v1 envelope: the V4 signed head (public) + per-field digests of
 *  the latest receipt; bodies ABSENT. The witness verifies head + digests against a consistency proof, never the rows. */
export const exportReceiptHeadEnvelope = query({
  args: { chainKey: v.string() },
  handler: async (ctx, a): Promise<any> => {
    const h = await ctx.db.query("auma_receipt_chain_head").withIndex("by_key", (q) => q.eq("key", a.chainKey)).first();
    const r = await ctx.db.query("auma_receipts").withIndex("by_chainKey_ts", (q) => q.eq("chainKey", a.chainKey)).order("desc").first();
    if (!h || !r) return null;
    // HEAD = public signed receipt-history head + the routing material a witness needs to pin/verify (no bodies).
    const head = {
      sourceNodeId: NODE_ID(), headKeyId: HEAD_KEY_ID(), chainKey: a.chainKey,
      lastChainHash: h.lastChainHash, count: h.count, updatedAt: h.updatedAt,
      headSig: h.headSig, headSigAlg: h.headSigAlg, headSignedAt: h.headSignedAt, receiptLogRoot: h.receiptLogRoot,
    };
    // PAYLOAD = the latest receipt's fields → per-field DIGESTS only; `buildExportEnvelope` omits bodies by default.
    const payload: Record<string, unknown> = {
      receiptId: r.receiptId, ts: r.ts, actorModel: r.actorModel, lane: r.lane, goal: r.goal, risk: r.risk,
      grade: r.grade, verdict: r.verdict, actionsJson: r.actionsJson, proofJson: r.proofJson,
      prevHash: r.prevHash, chainHash: r.chainHash, threadId: r.threadId, notes: r.notes,
    };
    return buildExportEnvelope({ surface: "receipt-head", headVersion: "v4", head, payload }); // env-v1, bodies ABSENT
  },
});
