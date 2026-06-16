// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
import { action, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { receiptPayload, verifyReceiptChainCore } from "./aukoraReceipts";
import { buildReceiptChainHash } from "./aukoraCore";
import { verifyChainHeadV3, verifyChainHeadV4, SIGNED_HEAD_V4_ALG, type ChainHeadFields } from "./aukoraSignedHead";
import { isPqcPublicKeyHex } from "./aukoraPqcSigner";
import { receiptHistoryRootHex } from "./aukoraMerkleLog";
import { buildPoPEnvelope, DEMO_OPERATOR_SEED, resolvePoPSession } from "./popResolver";

const THIS_NODE_ID = (): string => process.env.AUMA_NODE_ID ?? "aukora-node-a-demo";

const envelopeValidator = v.any(); // envelope is cross-node JSON; validated structurally by the importer below

// Core operator auth is cryptographic PoP (session seam retired). The orchestrator signs each emit/revoke with the
// disposable demo OPERATOR seed; the node verifies against the operator PUBLIC key. Provisioning is via /provision-operator
// which DERIVES the key server-side (no caller-supplied pubkey) + is immutable-once-active — so it cannot hijack the gate.
const opEnv = async (nodeId: string, methodId: string, actualArgs: any, principalId: string, capId: string) => {
  const now = Date.now();
  const cav = { v: 1, capId, founderUserId: "aukora.operator", founderKeyId: "op-1", nodeId, methods: ["emit", "revoke", "pinTrust", "promoteCrossGrant"], ring: "local-write", action: actualArgs.action ?? "operator", resource: actualArgs.resource ?? "node:operator", principalId, roles: ["operator"], notBefore: now - 2000, expiresAt: now + 60_000, maxUses: 1 };
  return await buildPoPEnvelope(DEMO_OPERATOR_SEED, cav, { methodId, actualArgs, timestamp: now, nonce: `n-${capId}-${crypto.randomUUID().slice(0, 8)}` });
};

// Node B: ONE atomic importer over the REAL node tables + receipt/head tables. Every refusal returns BEFORE any write.
export const importEnvelope = internalMutation({
  args: { env: envelopeValidator },
  handler: async (ctx, { env }): Promise<{ ok: boolean; reason?: string }> => {
    if (!env || typeof env !== "object") return { ok: false, reason: "malformed_envelope" };
    const trust = await ctx.db.query("node_trust_registry").withIndex("by_src_kid", (q) => q.eq("sourceNodeId", env.sourceNodeId).eq("headKeyId", env.headKeyId)).first();
    if (!trust) return { ok: false, reason: "unknown_key" };
    const hf: ChainHeadFields = { chainKey: env.chainKey, timestamp: env.head.headSignedAt, chainLength: env.head.count, chainHeadHash: env.head.lastChainHash };
    // V4 (B1.5b2): the head signature binds the receipt-history root too. Verify over the CLAIMED root (a forged root
    // needs a forged sig, which the trusted key never made); the recompute-and-compare below confirms it against the
    // actual imported receipt.
    if (!env.head.headSig || !(await verifyChainHeadV4(trust.publicKey, hf, env.head.receiptLogRoot, env.head.headSig, "chainHead"))) return { ok: false, reason: "bad_signature" };
    if (env.head.count !== 1) return { ok: false, reason: "not_fresh_chain_count" };
    if (env.receipt.prevHash !== undefined && env.receipt.prevHash !== null) return { ok: false, reason: "not_fresh_chain_prev" };
    if (env.head.lastChainHash !== env.receipt.chainHash) return { ok: false, reason: "head_mismatch" };
    const payload = receiptPayload({ chainKey: env.chainKey, receiptId: env.receipt.receiptId, ts: env.receipt.ts, actorModel: env.receipt.actorModel, lane: env.receipt.lane, goal: env.receipt.goal, risk: env.receipt.risk, grade: env.receipt.grade, verdict: env.receipt.verdict, actionsJson: env.receipt.actionsJson, proofJson: env.receipt.proofJson, threadId: env.receipt.threadId, notes: env.receipt.notes });
    if ((await buildReceiptChainHash(payload, env.receipt.prevHash ?? null)) !== env.receipt.chainHash) return { ok: false, reason: "forged_chain" };
    // RECOMPUTE-AND-COMPARE: the single-receipt history root must equal the signed root (count===1 → one leaf).
    if (receiptHistoryRootHex([env.receipt.chainHash]) !== env.head.receiptLogRoot) return { ok: false, reason: "log_root_mismatch" };
    let proof: any;
    try { proof = JSON.parse(env.receipt.proofJson || ""); } catch { return { ok: false, reason: "malformed_proof" }; }
    if (!proof || typeof proof.sourceNodeId !== "string" || typeof proof.delegationId !== "string") return { ok: false, reason: "malformed_proof" };
    if (proof.sourceNodeId !== env.sourceNodeId) return { ok: false, reason: "metadata_mismatch_source" };
    if (proof.delegationId !== env.delegationId) return { ok: false, reason: "metadata_mismatch_delegation" };
    if (typeof proof.revocationPointer !== "string" || proof.revocationPointer !== `rev:${proof.sourceNodeId}:${proof.delegationId}`) return { ok: false, reason: "bad_revocation_pointer" };
    if (`env_${env.receipt.receiptId}` !== env.envelopeId) return { ok: false, reason: "metadata_mismatch_envelope" };
    const rev = await ctx.db.query("node_revocations").withIndex("by_src_del", (q) => q.eq("sourceNodeId", env.sourceNodeId).eq("delegationId", proof.delegationId)).first();
    if (rev) return { ok: false, reason: "revoked" };
    const dupE = await ctx.db.query("node_import_registry").withIndex("by_src_env", (q) => q.eq("sourceNodeId", env.sourceNodeId).eq("envelopeId", env.envelopeId)).first();
    const dupH = await ctx.db.query("node_import_registry").withIndex("by_src_hash", (q) => q.eq("sourceNodeId", env.sourceNodeId).eq("receiptHash", env.receipt.chainHash)).first();
    if (dupE || dupH) return { ok: false, reason: "duplicate" };
    const existingHead = await ctx.db.query("auma_receipt_chain_head").withIndex("by_key", (q) => q.eq("key", env.chainKey)).first();
    const existingRcpt = await ctx.db.query("auma_receipts").withIndex("by_chainKey_ts", (q) => q.eq("chainKey", env.chainKey)).first();
    if (existingHead || existingRcpt) return { ok: false, reason: "chain_already_imported" };
    // ATOMIC COMMIT. seq=1 (count===1 enforced above) so the imported leaf orders deterministically. headSigAlg is
    // PINNED to the canonical V4 tag (NOT echoed from the untrusted envelope): the alg is already bound INSIDE the
    // verified signature, and echoing a tampered tag would later DoS this node's own audit (review B1.5b2).
    await ctx.db.insert("auma_receipts", { ...env.receipt, chainKey: env.chainKey, seq: 1 });
    await ctx.db.insert("auma_receipt_chain_head", { key: env.chainKey, lastChainHash: env.head.lastChainHash, count: env.head.count, updatedAt: env.head.updatedAt, headSig: env.head.headSig, headSigAlg: SIGNED_HEAD_V4_ALG, headSignedAt: env.head.headSignedAt, receiptLogRoot: env.head.receiptLogRoot });
    await ctx.db.insert("node_import_registry", { sourceNodeId: env.sourceNodeId, chainKey: env.chainKey, envelopeId: env.envelopeId, receiptHash: env.receipt.chainHash, importedAt: env.head.updatedAt });
    return { ok: true };
  },
});

export const importRevocation = internalMutation({
  args: { rev: envelopeValidator },
  handler: async (ctx, { rev }): Promise<{ ok: boolean; reason?: string }> => {
    const trust = await ctx.db.query("node_trust_registry").withIndex("by_src_kid", (q) => q.eq("sourceNodeId", rev.sourceNodeId).eq("headKeyId", rev.headKeyId)).first();
    if (!trust) return { ok: false, reason: "unknown_key" };
    const head: ChainHeadFields = { chainKey: `${rev.chainKey}:rev`, timestamp: rev.head.headSignedAt, chainLength: rev.head.count, chainHeadHash: rev.head.lastChainHash };
    if (!(await verifyChainHeadV3(trust.publicKey, head, rev.headSig, "chainHead"))) return { ok: false, reason: "bad_signature" };
    if (rev.head.count !== 1) return { ok: false, reason: "not_fresh_revocation" };
    if ((await buildReceiptChainHash(rev.revPayload, null)) !== rev.head.lastChainHash) return { ok: false, reason: "forged_revocation" };
    if (rev.revPayload.sourceNodeId !== rev.sourceNodeId) return { ok: false, reason: "revocation_source_mismatch" };
    await ctx.db.insert("node_revocations", { sourceNodeId: rev.revPayload.sourceNodeId, delegationId: rev.revPayload.delegationId, revokedAt: rev.revPayload.revokedAt });
    return { ok: true };
  },
});

// Fetch a peer node's envelope over HTTP, then import atomically. sourceUrl override lets EITHER node pull the OTHER
// (default: AUMA_NODE_A_URL). This is the cross-node transport — symmetric, so it supports the two-way handshake.
export const pullAndImport = action({
  args: { chainKey: v.string(), sourceUrl: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    const base = args.sourceUrl ?? process.env.AUMA_NODE_A_URL;
    if (!base) throw new Error("source url unset");
    const res = await fetch(`${base}/export?chainKey=${encodeURIComponent(args.chainKey)}`);
    if (!res.ok) return { ok: false, reason: `fetch_failed_${res.status}` };
    const env = await res.json();
    return await ctx.runMutation(internal.nodeB.importEnvelope, { env });
  },
});

// The immutable-once-pinned trust write (shared by the internal + PoP-gated entries below).
async function pinTrustCore(ctx: MutationCtx, a: { sourceNodeId: string; headKeyId: string; publicKey: string; rootId?: string | null }): Promise<any> {
  const ex = await ctx.db.query("node_trust_registry").withIndex("by_src_kid", (q) => q.eq("sourceNodeId", a.sourceNodeId).eq("headKeyId", a.headKeyId)).first();
  if (ex) {
    // IMMUTABLE-once-pinned (Gate-6 public-hardening): refuse to OVERWRITE an existing pinned key with a DIFFERENT public
    // key — an overwrite would be a cross-node TRUST-ROOT HIJACK. Same-key re-pin is idempotent.
    if (ex.publicKey !== a.publicKey) throw new Error("pin_immutable_conflict");
    // B3.5b: the rootId BINDING is immutable too — a pinned key cannot be rebound to a different namespace. A same-key
    // re-pin MAY back-fill a rootId onto a B3.5a (audit-only, rootId-absent) pin (the operator binding their own pin).
    if (a.rootId != null && ex.rootId != null && ex.rootId !== a.rootId) throw new Error("pin_rootid_conflict");
    if (a.rootId != null && ex.rootId == null) await ctx.db.patch(ex._id, { rootId: a.rootId });
    return { pinned: true, idempotent: true };
  }
  // Shape-gate FRESH pins (B1.3b): immutable-once-pinned means pinning a legacy/garbage key would brick trust permanently.
  if (!isPqcPublicKeyHex(a.publicKey)) throw new Error("pin_pubkey_invalid");
  await ctx.db.insert("node_trust_registry", { sourceNodeId: a.sourceNodeId, headKeyId: a.headKeyId, publicKey: a.publicKey, pinnedAt: Date.now(), rootId: a.rootId ?? undefined });
  return { pinned: true };
}

// INTERNAL pin (in-process / trusted callers + tests). NOT HTTP-reachable. B3.5b: `rootId` binds a foreign-root pin to
// the namespace it may authorize for EFFECTS (the resolver foreign branch requires it).
export const pinTrust = internalMutation({
  args: { sourceNodeId: v.string(), headKeyId: v.string(), publicKey: v.string(), rootId: v.optional(v.string()) },
  handler: async (ctx, a) => pinTrustCore(ctx, a),
});

// Db9 (B3.5b hard precondition): the HTTP `/pin-trust` path goes through HERE — a pin is now an EFFECT-AUTHORITY input,
// so it requires an OPERATOR PoP (no anonymous pin). resolvePoPSession throws `pop_*` and rolls back the WHOLE mutation
// on any failure (forged/expired/wrong-method/replayed env), so an unauthenticated pin writes NOTHING — and therefore can
// never seat a foreign-root key the resolver would honor for an effect.
export const pinTrustGated = internalMutation({
  args: { env: v.any(), sourceNodeId: v.string(), headKeyId: v.string(), publicKey: v.string(), rootId: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await resolvePoPSession(ctx, a.env, "pinTrust", { sourceNodeId: a.sourceNodeId, headKeyId: a.headKeyId, publicKey: a.publicKey, rootId: a.rootId ?? null }, THIS_NODE_ID());
    return pinTrustCore(ctx, { sourceNodeId: a.sourceNodeId, headKeyId: a.headKeyId, publicKey: a.publicKey, rootId: a.rootId });
  },
});

// Has a peer node-signing key already been pinned? (used by the import route to pull-once from the configured peer)
export const isNodePinned = internalQuery({
  args: { sourceNodeId: v.string(), headKeyId: v.string() },
  handler: async (ctx, a) => !!(await ctx.db.query("node_trust_registry").withIndex("by_src_kid", (q) => q.eq("sourceNodeId", a.sourceNodeId).eq("headKeyId", a.headKeyId)).first()),
});

export const pullAndRevoke = action({
  args: { delegationId: v.string(), chainKey: v.string(), token: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    const base = process.env.AUMA_NODE_A_URL;
    if (!base) throw new Error("AUMA_NODE_A_URL unset");
    const J = { "content-type": "application/json" };
    await fetch(`${base}/provision-operator`, { method: "POST", headers: J, body: "{}" });
    const env = await opEnv("aukora-node-a-demo", "revoke", { delegationId: args.delegationId, chainKey: args.chainKey }, args.delegationId, `par-${args.chainKey}`);
    const res = await fetch(`${base}/revoke`, { method: "POST", headers: J, body: JSON.stringify({ env, delegationId: args.delegationId, chainKey: args.chainKey }) });
    if (!res.ok) return { ok: false, reason: `fetch_failed_${res.status}` };
    const rev = await res.json();
    return await ctx.runMutation(internal.nodeB.importRevocation, { rev });
  },
});

// Read what Node B has imported (evidence).
export const imported = internalQuery({
  args: {},
  handler: async (ctx) => ({
    receipts: (await ctx.db.query("auma_receipts").collect()).length,
    registry: (await ctx.db.query("node_import_registry").collect()).length,
    revocations: (await ctx.db.query("node_revocations").collect()).length,
  }),
});

// Run-scoped evidence: counts only THIS run's rows (so the report is clean + reproducible regardless of prior runs).
export const runState = internalQuery({
  args: { run: v.string() },
  handler: async (ctx, { run }) => ({
    receipts: (await ctx.db.query("auma_receipts").collect()).filter((r) => (r.chainKey ?? "").includes(run)).length,
    registry: (await ctx.db.query("node_import_registry").collect()).filter((r) => r.chainKey.includes(run)).length,
    revocations: (await ctx.db.query("node_revocations").collect()).filter((r) => r.delegationId.includes(run)).length,
  }),
});

// Full cross-node demo orchestrator (run once via POST /run-demo). Returns an evidence report.
export const runDemo = action({
  args: {},
  handler: async (ctx): Promise<any> => {
    const A = process.env.AUMA_NODE_A_URL;
    if (!A) return { error: "AUMA_NODE_A_URL unset on Node B" };
    const post = async (p: string, body: any) => (await fetch(`${A}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
    const get = async (p: string) => (await fetch(`${A}${p}`)).json();
    const run = crypto.randomUUID().slice(0, 8);                                   // unique per run -> reproducible
    const TOKB = `demo-B-${run}`, ALICE = `agent:alice:${run}`;
    const CK1 = `demo:${run}:1`, CK2 = `demo:${run}:2`;                            // fresh chains -> head.count===1
    const out: any = { run };

    const seedA = await get("/node-pubkey"); // read-only pubkey (the anonymous /seedA session route was removed)
    if (!seedA.publicKey) return { error: "Node A signing seed unset (AUKORA_CHAIN_SIGNING_SEED) — set it on node-a", seedA };
    out.nodeAPublicKey = `present(${String(seedA.publicKey).slice(0, 10)}…)`;
    await ctx.runMutation(internal.seed.seedNodeB, { token: TOKB, principalId: ALICE, nodeId: "aukora-node-b-demo" });
    // B3.5a EXPLICIT PIN (no TOFU): pin Node A's key via the immutable, conflict-checked seam (mirrors runHandshake).
    await ctx.runMutation(internal.nodeB.pinTrust, { sourceNodeId: "aukora-node-a-demo", headKeyId: "demo-key-1", publicKey: seedA.publicKey });
    // CORE OPERATOR AUTH = cryptographic PoP (session seam retired). Provision the operator trust root (safe: server-derived, immutable), then sign.
    await post("/provision-operator", {});
    out.emit1 = await post("/emit", { env: await opEnv("aukora-node-a-demo", "emit", { chainKey: CK1, action: "studio.write", resource: "studio_surface:knvs" }, ALICE, `${run}-e1`), chainKey: CK1, action: "studio.write", resource: "studio_surface:knvs" });
    out.case1_valid = await ctx.runAction(api.nodeB.pullAndImport, { chainKey: CK1 });
    out.case2_duplicate = await ctx.runAction(api.nodeB.pullAndImport, { chainKey: CK1 });
    const env = await get(`/export?chainKey=${encodeURIComponent(CK1)}`);
    if (!env || !env.receipt) {
      out.case3_forged = { skipped: "no envelope to tamper (emit failed?)", emit1: out.emit1 };
    } else {
      const tampered = JSON.parse(JSON.stringify(env));
      tampered.receipt.goal = "node-a DRAINED the account";
      out.case3_forged = await ctx.runMutation(internal.nodeB.importEnvelope, { env: tampered });
    }
    const rev = await post("/revoke", { env: await opEnv("aukora-node-a-demo", "revoke", { delegationId: ALICE, chainKey: CK1 }, ALICE, `${run}-rv`), delegationId: ALICE, chainKey: CK1 });
    out.revImport = await ctx.runMutation(internal.nodeB.importRevocation, { rev });
    out.emit2 = await post("/emit", { env: await opEnv("aukora-node-a-demo", "emit", { chainKey: CK2, action: "studio.write", resource: "studio_surface:knvs" }, ALICE, `${run}-e2`), chainKey: CK2, action: "studio.write", resource: "studio_surface:knvs" });
    out.case4_revoked = await ctx.runAction(api.nodeB.pullAndImport, { chainKey: CK2 });
    out.thisRun = await ctx.runQuery(internal.nodeB.runState, { run });           // run-scoped: expect receipts:1, registry:1, revocations:1
    return out;
  },
});

// TWO-WAY HANDSHAKE (run on Node A via POST /run-handshake): the REVERSE direction — Node B mints a governed receipt,
// Node A pins Node B's key and independently verifies it. Proves the kernel is symmetric (mutual verification).
export const runHandshake = action({
  args: {},
  handler: async (ctx): Promise<any> => {
    const B = process.env.AUMA_NODE_B_URL;
    if (!B) return { error: "AUMA_NODE_B_URL unset on Node A" };
    const post = async (p: string, body: any) => (await fetch(`${B}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
    const get = async (p: string) => (await fetch(`${B}${p}`)).json();
    const run = crypto.randomUUID().slice(0, 8);                                   // unique per run -> reproducible
    const BOB = `agent:bob:${run}`, CK1 = `hs:${run}:1`, CK2 = `hs:${run}:2`;
    const out: any = { run };
    const seedB = await get("/node-pubkey"); // read-only pubkey (the anonymous /seedA session route was removed)
    if (!seedB.publicKey) return { error: "Node B signing seed unset (AUKORA_CHAIN_SIGNING_SEED) — set it on node-b", seedB };
    out.nodeBPublicKey = `present(${String(seedB.publicKey).slice(0, 10)}…)`;
    await ctx.runMutation(internal.nodeB.pinTrust, { sourceNodeId: "aukora-node-b-demo", headKeyId: "demo-key-1", publicKey: seedB.publicKey });
    // CORE OPERATOR AUTH = cryptographic PoP on Node B too. Provision the operator trust root (safe: server-derived, immutable), then sign.
    await post("/provision-operator", {});
    out.emitB1 = await post("/emit", { env: await opEnv("aukora-node-b-demo", "emit", { chainKey: CK1, action: "studio.write", resource: "studio_surface:knvs" }, BOB, `${run}-e1`), chainKey: CK1, action: "studio.write", resource: "studio_surface:knvs" });
    out.case1_valid = await ctx.runAction(api.nodeB.pullAndImport, { chainKey: CK1, sourceUrl: B });
    out.case2_duplicate = await ctx.runAction(api.nodeB.pullAndImport, { chainKey: CK1, sourceUrl: B });
    const env = await get(`/export?chainKey=${encodeURIComponent(CK1)}`);
    if (!env || !env.receipt) { out.case3_forged = { skipped: "no envelope (Node B emit failed?)", emitB1: out.emitB1 }; }
    else { const t = JSON.parse(JSON.stringify(env)); t.receipt.goal = "node-b DRAINED the account"; out.case3_forged = await ctx.runMutation(internal.nodeB.importEnvelope, { env: t }); }
    const rev = await post("/revoke", { env: await opEnv("aukora-node-b-demo", "revoke", { delegationId: BOB, chainKey: CK1 }, BOB, `${run}-rv`), delegationId: BOB, chainKey: CK1 });
    out.revImport = await ctx.runMutation(internal.nodeB.importRevocation, { rev });
    out.emitB2 = await post("/emit", { env: await opEnv("aukora-node-b-demo", "emit", { chainKey: CK2, action: "studio.write", resource: "studio_surface:knvs" }, BOB, `${run}-e2`), chainKey: CK2, action: "studio.write", resource: "studio_surface:knvs" });
    out.case4_revoked = await ctx.runAction(api.nodeB.pullAndImport, { chainKey: CK2, sourceUrl: B });
    out.thisRun = await ctx.runQuery(internal.nodeB.runState, { run });
    return out;
  },
});