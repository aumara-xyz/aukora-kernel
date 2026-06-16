// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/**
 * B1.5b2 — the LIVE receipt path commits to its history. Drives the real kernel flow (grant → submitIntent →
 * consume token → writeReceiptRow) via convex-test t.run, then checks the V4 receipt-log behavior end-to-end:
 * a live write mints a V4 head bound to the recomputed receiptLogRoot; the root advances per append; size == count
 * (no phantom leaves); the audit path recomputes-and-compares and catches a forged root (log_root_mismatch); and
 * a V3 receipt head refuses through the V4 audit path (no silent downgrade). Checkpoint heads (:rev / del:) staying
 * on V3 is covered by ceremonyCrucible (its delegation + revocation lanes still verify V3 and pass).
 */
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../convex/schema";
import { writeReceiptRow, verifyReceiptChainCore, computeReceiptLogRoot } from "../convex/aukoraReceipts";
import { submitIntentCore } from "../convex/aukoraRuntime";
import { verifyAndConsumeDecisionToken } from "../convex/aukoraToken";
import { signChainHeadV3, signChainHeadV4, SIGNED_HEAD_V3_ALG, SIGNED_HEAD_V4_ALG } from "../convex/aukoraSignedHead";
import { receiptHistoryRootHex } from "../convex/aukoraMerkleLog";

const modules = import.meta.glob("../convex/**/*.*s");
const ACTOR = "agent:logtest";
const SEED = () => process.env.AUKORA_CHAIN_SIGNING_SEED!; // the documented disposable test seed (vitest.config)

// One authorized receipt through the REAL kernel path (mirrors nodeA.emit internals).
async function appendReceipt(t: any, chainKey: string, i: number): Promise<void> {
  await t.run(async (ctx: any) => {
    const now = Date.now();
    await ctx.db.insert("aukora_grants", { grantKey: `g_${chainKey}_${i}_${now}`, status: "active", actorId: ACTOR, actorRole: "operator", ring: "local-write", action: "echo", resource: "echo:demo", issuedBy: "node", issuedAt: now, expiresAt: now + 60_000, maxUses: 1, usedCount: 0, updatedAt: now });
    const s = await submitIntentCore(ctx, { actorId: ACTOR, actorRole: "operator", ring: "local-write", claim: "moga", action: "echo", resource: "echo:demo", requiresAuthorization: true, stateKey: `${chainKey}#${i}` });
    if (!s.decisionToken) throw new Error("test setup: intent not authorized");
    const consumed = await verifyAndConsumeDecisionToken(ctx, { token: s.decisionToken, action: "echo", resource: "echo:demo", ring: "local-write", expectedActorId: ACTOR });
    await writeReceiptRow(ctx, { chainKey, decisionLogId: consumed.logId, goal: "g", actorModel: "m", lane: "local", risk: "low", grade: "A", verdict: "kept", actionsJson: "[]", proofJson: "{}" });
  });
}
const readHead = (t: any, ck: string) => t.run((ctx: any) => ctx.db.query("auma_receipt_chain_head").withIndex("by_key", (q: any) => q.eq("key", ck)).first());
const readReceipts = (t: any, ck: string) => t.run((ctx: any) => ctx.db.query("auma_receipts").withIndex("by_chainKey_ts", (q: any) => q.eq("chainKey", ck)).order("asc").collect());
const audit = (t: any, ck: string) => t.run((ctx: any) => verifyReceiptChainCore(ctx, ck, 500));

describe("B1.5b2 — live receipt write mints a V4 head bound to the recomputed receipt-log root", () => {
  it("a single live write creates a V4-signed head whose receiptLogRoot is the root over the actual receipt", async () => {
    const t = convexTest(schema, modules);
    await appendReceipt(t, "log:1", 0);
    const head = await readHead(t, "log:1");
    const rcpts = await readReceipts(t, "log:1");
    expect(head.headSigAlg).toBe(SIGNED_HEAD_V4_ALG);                                   // V4, not V3
    expect(head.receiptLogRoot).toBeTruthy();
    expect(head.count).toBe(1);
    expect(rcpts.length).toBe(1);                                                       // size == count
    expect(head.receiptLogRoot).toBe(receiptHistoryRootHex(rcpts.map((r: any) => r.chainHash)));
    expect((await audit(t, "log:1")).status).toBe("verified");
  });

  it("the log root advances on every append; size stays == count (no phantom leaves); the chain audits clean", async () => {
    const t = convexTest(schema, modules);
    const roots = new Set<string>();
    for (let i = 0; i < 4; i++) { await appendReceipt(t, "log:2", i); roots.add((await readHead(t, "log:2")).receiptLogRoot); }
    expect(roots.size).toBe(4);                                                         // a distinct committed root per append
    const head = await readHead(t, "log:2");
    const rcpts = await readReceipts(t, "log:2");
    expect(head.count).toBe(4);
    expect(rcpts.length).toBe(4);
    expect(head.receiptLogRoot).toBe(receiptHistoryRootHex(rcpts.map((r: any) => r.chainHash)));
    const a = await audit(t, "log:2");
    expect(a.ok).toBe(true);
    expect(a.status).toBe("verified");
  });
});

describe("B1.5b2 — the audit path recomputes-and-compares (catches a forged root) and refuses V3 downgrade", () => {
  it("a head re-signed over a WRONG root (valid signature, wrong value) is caught as log_root_mismatch", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 3; i++) await appendReceipt(t, "log:3", i);
    expect((await audit(t, "log:3")).status).toBe("verified");
    // forge: sign a syntactically-valid V4 head over a root that does NOT match the receipts (the signature passes,
    // so only the recompute-and-compare can catch it)
    await t.run(async (ctx: any) => {
      const head = await ctx.db.query("auma_receipt_chain_head").withIndex("by_key", (q: any) => q.eq("key", "log:3")).first();
      const wrongRoot = "99".repeat(32);
      const sig = await signChainHeadV4(SEED(), { chainKey: "log:3", timestamp: head.headSignedAt, chainLength: head.count, chainHeadHash: head.lastChainHash }, wrongRoot, "chainHead");
      await ctx.db.patch(head._id, { receiptLogRoot: wrongRoot, headSig: sig });
    });
    const a = await audit(t, "log:3");
    expect(a.ok).toBe(false);
    expect(a.status).toBe("log_root_mismatch");
  });

  it("a V3-signed receipt head refuses through the V4 audit path (alg_mismatch — no silent downgrade)", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 2; i++) await appendReceipt(t, "log:4", i);
    await t.run(async (ctx: any) => {
      const head = await ctx.db.query("auma_receipt_chain_head").withIndex("by_key", (q: any) => q.eq("key", "log:4")).first();
      const v3sig = await signChainHeadV3(SEED(), { chainKey: "log:4", timestamp: head.headSignedAt, chainLength: head.count, chainHeadHash: head.lastChainHash }, "chainHead");
      await ctx.db.patch(head._id, { headSig: v3sig, headSigAlg: SIGNED_HEAD_V3_ALG }); // a genuine V3 head wearing the V3 tag
    });
    const a = await audit(t, "log:4");
    expect(a.ok).toBe(false);
    expect(a.status).toBe("head_signature_invalid");
    expect(a.headSignatureReason).toBe(`alg_mismatch:${SIGNED_HEAD_V3_ALG}`);
  });

  it("the receipt-log ROOT orders by seq, not ts — a backward clock does not change the recomputed root", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 3; i++) await appendReceipt(t, "log:6", i);
    const committedRoot = (await readHead(t, "log:6")).receiptLogRoot;
    expect((await t.run((ctx: any) => computeReceiptLogRoot(ctx, "log:6"))).root).toBe(committedRoot); // baseline
    // simulate a non-monotonic host clock: rewrite the receipts' ts in DECREASING order vs their true append seq
    await t.run(async (ctx: any) => {
      const rows = await ctx.db.query("auma_receipts").withIndex("by_chainKey_ts", (q: any) => q.eq("chainKey", "log:6")).collect();
      rows.sort((a: any, b: any) => (a.seq ?? 0) - (b.seq ?? 0));
      const tsVals = [3_000_000, 2_000_000, 1_000_000]; // strictly decreasing as seq increases (backward clock)
      for (let i = 0; i < rows.length; i++) await ctx.db.patch(rows[i]._id, { ts: tsVals[i] });
    });
    // the recompute orders by seq, so the ts flip does NOT change the root (ts is not the ordering authority)
    const after = await t.run((ctx: any) => computeReceiptLogRoot(ctx, "log:6"));
    expect(after.root).toBe(committedRoot);
    expect(after.size).toBe(3);
  });

  it("missing receiptLogRoot on a signed head refuses (missing_log_root via head_signature_invalid)", async () => {
    const t = convexTest(schema, modules);
    await appendReceipt(t, "log:5", 0);
    await t.run(async (ctx: any) => {
      const head = await ctx.db.query("auma_receipt_chain_head").withIndex("by_key", (q: any) => q.eq("key", "log:5")).first();
      await ctx.db.patch(head._id, { receiptLogRoot: undefined }); // strip the root but keep sig/tag
    });
    const a = await audit(t, "log:5");
    expect(a.ok).toBe(false);
    expect(a.status).toBe("head_signature_invalid");
    expect(a.headSignatureReason).toBe("missing_log_root");
  });
});
