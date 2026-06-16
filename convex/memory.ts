// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
// AUKORA MEMORY BOUNDARY (disposable demo — NOT real user memory).
// Proves: a silicon mirror can have memory UNDER a carbon root, but only inside the owned/delegated boundary.
// Memory writes are coupled to a governed kernel receipt; recall is authority-SHAPED (demo: reader principal is a harness input, not an authenticated session); cross-principal read fails;
// revocation severs future write/read; forget tombstones; export lets the carbon root inspect what its mirror remembers.
import { mutation } from "./_generated/server";
import { submitIntentCore } from "./aukoraRuntime";
import { verifyAndConsumeDecisionToken } from "./aukoraToken";
import { writeReceiptRow } from "./aukoraReceipts";
import { sha256Hex } from "./aukoraCore";

export const runMemory = mutation({
  args: {},
  handler: async (ctx): Promise<any> => {
    const run = crypto.randomUUID().slice(0, 8);
    const carbon = `demo.peter.carbon:${run}`, silicon = `demo.auma.silicon:${run}`;
    const eve = `demo.eve.silicon:${run}`, eveCarbon = `demo.eve.carbon:${run}`;
    const node = process.env.AUMA_NODE_ID ?? "aukora-node-a-demo";
    const delegationId = `memdel:${run}`;
    const out: any = { run };

    // memWrite — delegation-gated + receipt-coupled. A memory row only exists if a governed receipt was minted.
    const memWrite = async (writer: string, owner: string, key: string, value: string, o: { claimedOwner?: string; revoked?: boolean; skipReceipt?: boolean } = {}) => {
      if (o.claimedOwner && o.claimedOwner !== owner) return { ok: false, reason: "owner_mismatch" };      // forged owner
      if (o.revoked) return { ok: false, reason: "delegation_revoked" };                                   // revoked delegation
      if (o.skipReceipt) return { ok: false, reason: "no_receipt" };                                       // must couple to a receipt
      const now = Date.now();
      const ck = `memchain:${run}:${writer}:${key}`;
      await ctx.db.insert("aukora_grants", { grantKey: `pg_mem_${run}_${key}_${writer}`, status: "active", actorId: writer, actorRole: "operator", ring: "local-write", action: "memory.write", resource: `mem:${owner}`, issuedBy: owner, issuedAt: now, expiresAt: now + 60_000, maxUses: 1, usedCount: 0, updatedAt: now });
      const s = await submitIntentCore(ctx, { actorId: writer, actorRole: "operator", ring: "local-write", claim: "moga", action: "memory.write", resource: `mem:${owner}`, requiresAuthorization: true, stateKey: ck });
      if (!s.decisionToken) return { ok: false, reason: "no_authority" };
      const consumed = await verifyAndConsumeDecisionToken(ctx, { token: s.decisionToken, action: "memory.write", resource: `mem:${owner}`, ring: "local-write", expectedActorId: writer });
      await writeReceiptRow(ctx, { chainKey: ck, decisionLogId: consumed.logId, goal: "memory.write", actorModel: writer, lane: "local", risk: "low", grade: "A", verdict: "kept", actionsJson: "[]", proofJson: JSON.stringify({ memory: true, owner, writer, key, delegationId }) });
      const r = await ctx.db.query("auma_receipts").withIndex("by_chainKey_ts", (q) => q.eq("chainKey", ck)).order("desc").first();
      const memoryHash = await sha256Hex(`${owner}:${key}:${value}`);
      await ctx.db.insert("aukora_memory", { ownerRootId: owner, writerPrincipalId: writer, readerScope: "owner+writer", delegationId, receiptHash: r!.chainHash ?? "", memoryHash, sourceNodeId: node, visibility: "private", key, value });
      return { ok: true, receiptHash: r!.chainHash, memoryHash };
    };

    // memRecall — authority-SHAPED (demo: reader is a harness-supplied principal, not an authenticated session). Owner root always reads; the delegated writer reads only under a valid delegation.
    const memRecall = async (reader: string, owner: string, key: string, o: { revoked?: boolean } = {}) => {
      const row = await ctx.db.query("aukora_memory").withIndex("by_owner_key", (q) => q.eq("ownerRootId", owner).eq("key", key)).first();
      if (!row || row.deletedAt) return { ok: false, reason: "not_found" };
      if (reader === owner) return { ok: true, value: row.value };                                          // carbon owner
      if (reader === row.writerPrincipalId && !o.revoked) return { ok: true, value: row.value };            // delegated writer
      return { ok: false, reason: "cross_principal_refused" };
    };
    const memForget = async (owner: string, key: string) => {
      const row = await ctx.db.query("aukora_memory").withIndex("by_owner_key", (q) => q.eq("ownerRootId", owner).eq("key", key)).first();
      if (row) await ctx.db.patch(row._id, { deletedAt: Date.now() });
      return { ok: true };
    };
    const memExport = async (owner: string) => {
      const rows = (await ctx.db.query("aukora_memory").withIndex("by_owner", (q) => q.eq("ownerRootId", owner)).collect()).filter((r) => !r.deletedAt);
      return { count: rows.length, keys: rows.map((r) => r.key).sort() };
    };

    // CASES (carbon delegates memory write/read to silicon; eve is an unrelated principal/root)
    out.c1_write           = await memWrite(silicon, carbon, "diary", "alice's private note");
    out.c1b_write_prefs    = await memWrite(silicon, carbon, "prefs", "dark mode");
    out.c1c_write_eve      = await memWrite(eve, eveCarbon, "evenote", "eve's own note");          // different owner
    out.c2_recall_silicon  = await memRecall(silicon, carbon, "diary");                            // delegated writer -> ok
    out.c3_recall_owner    = await memRecall(carbon, carbon, "diary");                             // owner root -> ok
    out.c4_cross_silicon   = await memRecall(eve, carbon, "diary");                                // other principal -> refused
    out.c5_node_read       = await memRecall(node, carbon, "diary");                               // node principal -> refused
    out.c6_forged_owner    = await memWrite(silicon, carbon, "x", "y", { claimedOwner: "demo.attacker.carbon" });
    out.c7_no_receipt      = await memWrite(silicon, carbon, "z", "v", { skipReceipt: true });
    out.c8_revoked_write   = await memWrite(silicon, carbon, "diary3", "v", { revoked: true });
    out.c9_revoked_read    = await memRecall(silicon, carbon, "diary", { revoked: true });          // revoked writer -> refused
    out.c10_owner_after_rev = await memRecall(carbon, carbon, "diary", { revoked: true });          // owner still reads
    out.c11_forget         = await memForget(carbon, "diary");
    out.c11b_recall_forgot = await memRecall(carbon, carbon, "diary");                             // -> not_found
    out.c12_export         = await memExport(carbon);                                              // owner inspects -> ["prefs"] only
    out.carbonRowsLive     = (await ctx.db.query("aukora_memory").withIndex("by_owner", (q) => q.eq("ownerRootId", carbon)).collect()).filter((r) => !r.deletedAt).length;
    return out;
  },
});