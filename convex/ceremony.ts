// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
// AUKORA CEREMONY REHEARSAL (disposable demo identity — NOT the real founder/AUMLOK ceremony).
// Proves the Carbon/Silicon identity model mechanically: a carbon root SIGNS a scoped delegation to a silicon
// mirror; the silicon acts only inside that scope via the real kernel; a second node independently verifies the
// carbon->silicon delegation chain; revocation by the carbon root blocks future silicon action; forged delegation
// metadata fails; re-runs use fresh ids and stay green. Grounded language only.
import { mutation, action, internalMutation } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { submitIntentCore } from "./aukoraRuntime";
import { verifyAndConsumeDecisionToken } from "./aukoraToken";
import { writeReceiptRow, receiptPayload } from "./aukoraReceipts";
import { buildReceiptChainHash } from "./aukoraCore";
import { signChainHeadV3, verifyChainHeadV3, verifyChainHeadV4, SIGNED_HEAD_V4_ALG, resolveChainSigningSeed, type ChainHeadFields } from "./aukoraSignedHead";
import { mlDsa65PublicKeyFromSeed } from "./aukoraPqcSigner";
import { receiptHistoryRootHex } from "./aukoraMerkleLog";
import { buildPoPEnvelope, DEMO_OPERATOR_SEED } from "./popResolver";

const delPayloadOf = (d: any) => ({ delegationId: d.delegationId, carbonRoot: d.carbonRoot, siliconPrincipal: d.siliconPrincipal, action: d.action, resource: d.resource, ring: d.ring, nodeId: d.nodeId, issuedAt: d.issuedAt });
const delHead = (delegationId: string, issuedAt: number, delHash: string): ChainHeadFields => ({ chainKey: `del:${delegationId}`, timestamp: issuedAt, chainLength: 1, chainHeadHash: delHash });

// Node A: store a carbon-signed delegation.
export const createDelegation = mutation({
  args: { delegationId: v.string(), carbonRoot: v.string(), carbonPubkey: v.string(), siliconPrincipal: v.string(), action: v.string(), resource: v.string(), ring: v.string(), nodeId: v.string(), issuedAt: v.number(), delHash: v.string(), sig: v.string() },
  handler: async (ctx, a) => {
    // ":rev" is RESERVED: a delegationId ending in it would make `del:<id>` collide with another delegation's
    // revocation chainKey `del:<other>:rev` inside the shared "delegation" domain (B1.3b defense-in-depth).
    if (a.delegationId.endsWith(":rev")) throw new Error("aukora_delegation_id_reserved_suffix");
    await ctx.db.insert("aukora_delegations", { ...a, revoked: false });
    return { ok: true };
  },
});
export const markRevoked = mutation({
  args: { delegationId: v.string() },
  handler: async (ctx, { delegationId }) => {
    const d = await ctx.db.query("aukora_delegations").withIndex("by_delegationId", (q) => q.eq("delegationId", delegationId)).first();
    if (d) await ctx.db.patch(d._id, { revoked: true });
    return { ok: true };
  },
});

// Node A: the silicon mirror acts UNDER the delegation (real kernel path). Grant is scoped to the DELEGATION's
// capability, so a requested action outside scope finds no grant -> refused. Returns the delegated envelope.
export const siliconAct = mutation({
  args: { delegationId: v.string(), chainKey: v.string(), action: v.string(), resource: v.string(), ring: v.string() },
  handler: async (ctx, a): Promise<any> => {
    const del = await ctx.db.query("aukora_delegations").withIndex("by_delegationId", (q) => q.eq("delegationId", a.delegationId)).first();
    if (!del) return { ok: false, reason: "no_delegation" };
    if (del.revoked) return { ok: false, reason: "delegation_revoked" };
    const now = Date.now();
    await ctx.db.insert("aukora_grants", { grantKey: `pg_cer_${a.chainKey}`, status: "active", actorId: del.siliconPrincipal, actorRole: "operator", ring: del.ring as any, action: del.action, resource: del.resource, issuedBy: del.carbonRoot, issuedAt: now, expiresAt: now + 60_000, maxUses: 1, usedCount: 0, updatedAt: now });
    const s = await submitIntentCore(ctx, { actorId: del.siliconPrincipal, actorRole: "operator", ring: a.ring as any, claim: "moga", action: a.action, resource: a.resource, requiresAuthorization: true, stateKey: a.chainKey });
    if (!s.decisionToken) return { ok: false, reason: "scope_violation" };
    const consumed = await verifyAndConsumeDecisionToken(ctx, { token: s.decisionToken, action: a.action, resource: a.resource, ring: a.ring as any, expectedActorId: del.siliconPrincipal });
    const proofJson = JSON.stringify({ sourceNodeId: del.nodeId, delegationId: del.delegationId, carbonRoot: del.carbonRoot, siliconPrincipal: del.siliconPrincipal, action: del.action, resource: del.resource, ring: del.ring, revocationPointer: `rev:${del.carbonRoot}:${del.delegationId}` });
    await writeReceiptRow(ctx, { chainKey: a.chainKey, decisionLogId: consumed.logId, goal: "silicon mirror governed action", actorModel: del.siliconPrincipal, lane: "local", risk: "low", grade: "A", verdict: "kept", actionsJson: "[]", proofJson });
    const r = await ctx.db.query("auma_receipts").withIndex("by_chainKey_ts", (q) => q.eq("chainKey", a.chainKey)).order("desc").first();
    const h = await ctx.db.query("auma_receipt_chain_head").withIndex("by_key", (q) => q.eq("key", a.chainKey)).first();
    return { ok: true, envelope: {
      sourceNodeId: del.nodeId, headKeyId: "demo-key-1", chainKey: a.chainKey, envelopeId: `env_${r!.receiptId}`,
      receipt: { receiptId: r!.receiptId, ts: r!.ts, actorModel: r!.actorModel, lane: r!.lane, goal: r!.goal, risk: r!.risk, grade: r!.grade, verdict: r!.verdict, actionsJson: r!.actionsJson, proofJson: r!.proofJson, prevHash: r!.prevHash, chainHash: r!.chainHash, threadId: r!.threadId, notes: r!.notes },
      head: { lastChainHash: h!.lastChainHash, count: h!.count, updatedAt: h!.updatedAt, headSig: h!.headSig, headSigAlg: h!.headSigAlg, headSignedAt: h!.headSignedAt, receiptLogRoot: h!.receiptLogRoot },
      delegation: { ...delPayloadOf(del), carbonPubkey: del.carbonPubkey, delHash: del.delHash, sig: del.sig },
    } };
  },
});

// Node B: verify the FULL carbon->silicon chain before committing the silicon's receipt.
export const importDelegated = internalMutation({
  args: { env: v.any() },
  handler: async (ctx, { env }): Promise<any> => {
    const d = env?.delegation;
    if (!d) return { ok: false, reason: "no_delegation" };
    // 1. Carbon delegation signature. B3.5a (Peter D1–D10): NO TOFU. The carbon key must be EXPLICITLY pinned out-of-band
    //    BEFORE any import (verify fingerprint, then pin via /pin-trust → pinTrust) — a first-sight key is a REFUSAL, never
    //    an auto-pin. Verification uses the PINNED value ONLY (never the envelope's `carbonPubkey`), so an attacker can
    //    neither pre-empt-pin nor forge receipts for a pinned carbon root.
    const ct = await ctx.db.query("node_trust_registry").withIndex("by_src_kid", (q) => q.eq("sourceNodeId", d.carbonRoot).eq("headKeyId", "carbon")).first();
    if (!ct) return { ok: false, reason: "unpinned_carbon" };
    if (!(await verifyChainHeadV3(ct.publicKey, delHead(d.delegationId, d.issuedAt, d.delHash), d.sig, "delegation"))) return { ok: false, reason: "bad_carbon_signature" };
    if ((await buildReceiptChainHash(delPayloadOf(d), null)) !== d.delHash) return { ok: false, reason: "forged_delegation" };
    // 2. PINNED node key -> receipt head signature + chain recompute
    const nt = await ctx.db.query("node_trust_registry").withIndex("by_src_kid", (q) => q.eq("sourceNodeId", env.sourceNodeId).eq("headKeyId", env.headKeyId)).first();
    if (!nt) return { ok: false, reason: "unknown_node_key" };
    const hf: ChainHeadFields = { chainKey: env.chainKey, timestamp: env.head.headSignedAt, chainLength: env.head.count, chainHeadHash: env.head.lastChainHash };
    // V4 receipt head (B1.5b2): the node signature binds the receipt-history root. Checkpoint heads (carbon delegation
    // above, :rev below) are NOT receipt logs and stay on V3.
    if (!env.head.headSig || !(await verifyChainHeadV4(nt.publicKey, hf, env.head.receiptLogRoot, env.head.headSig, "chainHead"))) return { ok: false, reason: "bad_node_signature" };
    if (env.head.count !== 1 || (env.receipt.prevHash !== undefined && env.receipt.prevHash !== null)) return { ok: false, reason: "not_fresh_chain" };
    const payload = receiptPayload({ chainKey: env.chainKey, receiptId: env.receipt.receiptId, ts: env.receipt.ts, actorModel: env.receipt.actorModel, lane: env.receipt.lane, goal: env.receipt.goal, risk: env.receipt.risk, grade: env.receipt.grade, verdict: env.receipt.verdict, actionsJson: env.receipt.actionsJson, proofJson: env.receipt.proofJson, threadId: env.receipt.threadId, notes: env.receipt.notes });
    if ((await buildReceiptChainHash(payload, env.receipt.prevHash ?? null)) !== env.receipt.chainHash || env.head.lastChainHash !== env.receipt.chainHash) return { ok: false, reason: "forged_chain" };
    if (receiptHistoryRootHex([env.receipt.chainHash]) !== env.head.receiptLogRoot) return { ok: false, reason: "log_root_mismatch" }; // recompute-and-compare (count===1)
    // 3. the receipt's signed proof must BIND the delegation chain
    let proof: any; try { proof = JSON.parse(env.receipt.proofJson || ""); } catch { return { ok: false, reason: "malformed_proof" }; }
    if (proof.delegationId !== d.delegationId || proof.carbonRoot !== d.carbonRoot || proof.siliconPrincipal !== d.siliconPrincipal) return { ok: false, reason: "delegation_binding_mismatch" };
    if (proof.action !== d.action || proof.resource !== d.resource || proof.ring !== d.ring) return { ok: false, reason: "scope_binding_mismatch" };
    if (proof.revocationPointer !== `rev:${d.carbonRoot}:${d.delegationId}`) return { ok: false, reason: "bad_revocation_pointer" };
    // 4. revocation (by carbon root + delegation)
    if (await ctx.db.query("node_revocations").withIndex("by_src_del", (q) => q.eq("sourceNodeId", d.carbonRoot).eq("delegationId", d.delegationId)).first()) return { ok: false, reason: "revoked" };
    // 5. replay + no-overwrite
    if (await ctx.db.query("node_import_registry").withIndex("by_src_env", (q) => q.eq("sourceNodeId", env.sourceNodeId).eq("envelopeId", env.envelopeId)).first()) return { ok: false, reason: "duplicate" };
    if (await ctx.db.query("auma_receipt_chain_head").withIndex("by_key", (q) => q.eq("key", env.chainKey)).first()) return { ok: false, reason: "chain_already_imported" };
    // COMMIT. seq=1 (count===1) for deterministic leaf order; headSigAlg PINNED to the canonical V4 tag, not echoed
    // from the untrusted envelope (the alg is bound inside the verified signature; review B1.5b2).
    await ctx.db.insert("auma_receipts", { ...env.receipt, chainKey: env.chainKey, seq: 1 });
    await ctx.db.insert("auma_receipt_chain_head", { key: env.chainKey, lastChainHash: env.head.lastChainHash, count: env.head.count, updatedAt: env.head.updatedAt, headSig: env.head.headSig, headSigAlg: SIGNED_HEAD_V4_ALG, headSignedAt: env.head.headSignedAt, receiptLogRoot: env.head.receiptLogRoot });
    await ctx.db.insert("node_import_registry", { sourceNodeId: env.sourceNodeId, chainKey: env.chainKey, envelopeId: env.envelopeId, receiptHash: env.receipt.chainHash, importedAt: env.head.updatedAt });
    return { ok: true, carbonRoot: d.carbonRoot, siliconPrincipal: d.siliconPrincipal };
  },
});

// Node B: record a carbon-signed delegation revocation.
export const importDelegatedRevocation = internalMutation({
  args: { rev: v.any() },
  handler: async (ctx, { rev }): Promise<any> => {
    const ct = await ctx.db.query("node_trust_registry").withIndex("by_src_kid", (q) => q.eq("sourceNodeId", rev.carbonRoot).eq("headKeyId", "carbon")).first();
    if (!ct) return { ok: false, reason: "unknown_carbon_key" };
    const revHash = await buildReceiptChainHash({ type: "delegation_revocation", carbonRoot: rev.carbonRoot, delegationId: rev.delegationId, revokedAt: rev.revokedAt }, null);
    if (!(await verifyChainHeadV3(ct.publicKey, { chainKey: `del:${rev.delegationId}:rev`, timestamp: rev.revokedAt, chainLength: 1, chainHeadHash: revHash }, rev.sig, "delegation"))) return { ok: false, reason: "bad_carbon_signature" };
    await ctx.db.insert("node_revocations", { sourceNodeId: rev.carbonRoot, delegationId: rev.delegationId, revokedAt: rev.revokedAt });
    return { ok: true };
  },
});

// Node A: full ceremony rehearsal orchestrator (POST /run-ceremony). Carbon seed stays in memory; never stored.
export const runCeremony = action({
  args: {},
  handler: async (ctx): Promise<any> => {
    const NB = process.env.AUMA_NODE_B_URL;
    if (!NB) return { error: "AUMA_NODE_B_URL unset on Node A" };
    const seed = resolveChainSigningSeed();
    if (!seed) return { error: "Node A signing seed unset" };
    const post = async (p: string, body: any) => (await fetch(`${NB}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
    const get = async (p: string) => (await fetch(`${NB}${p}`)).json();
    const hex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const run = crypto.randomUUID().slice(0, 8);
    const carbonRoot = `demo.peter.carbon:${run}`, silicon = `demo.auma.silicon:${run}`, delId = `del:${run}`;
    const nodeId = process.env.AUMA_NODE_ID ?? "aukora-node-a-demo";
    const out: any = { run, carbonRoot, silicon, delegationId: delId };
    // carbon keypair (fresh per run; seed in-memory only)
    const carbonSeed = hex(32);
    const carbonPubkey = await mlDsa65PublicKeyFromSeed(carbonSeed);
    const nodeAPubkey = await mlDsa65PublicKeyFromSeed(seed);
    out.carbonPubkey = `present(${carbonPubkey.slice(0, 10)}…)`;
    // carbon signs the scoped delegation -> stored on Node A
    const issuedAt = Date.now();
    const delPayload = { delegationId: delId, carbonRoot, siliconPrincipal: silicon, action: "studio.write", resource: "studio_surface:knvs", ring: "local-write", nodeId, issuedAt };
    const delHash = await buildReceiptChainHash(delPayload, null);
    const delSig = await signChainHeadV3(carbonSeed, delHead(delId, issuedAt, delHash), "delegation");
    await ctx.runMutation(api.ceremony.createDelegation, { ...delPayload, carbonPubkey, delHash, sig: delSig });
    // B3.5a EXPLICIT PIN (no TOFU) + Db9 OPERATOR-PoP: Node B pins the carbon key + Node A's signing key out-of-band
    // BEFORE import. A pin is an effect-authority input (B3.5b), so /pin-trust now requires an operator PoP — provision the
    // operator on Node B, then sign each pin (the cav is bound to Node B's nodeId). Import verifies against PINNED values.
    await post("/provision-operator", {});
    const nbNode = (await get("/node-pubkey").catch(() => ({})))?.sourceNodeId ?? "aukora-node-b-demo";
    const pinEnv = async (args: any, tag: string) => {
      const now = Date.now();
      const cav = { v: 1, capId: `cer-pin-${run}-${tag}`, founderUserId: "aukora.operator", founderKeyId: "op-1", nodeId: nbNode, methods: ["pinTrust"], ring: "local-write", action: "operator", resource: "node:operator", principalId: "demo.operator", roles: ["operator"], notBefore: now - 2000, expiresAt: now + 60_000, maxUses: 1 };
      return buildPoPEnvelope(DEMO_OPERATOR_SEED, cav, { methodId: "pinTrust", actualArgs: args, timestamp: now, nonce: `n-cer-pin-${run}-${tag}` });
    };
    const carbonArgs = { sourceNodeId: carbonRoot, headKeyId: "carbon", publicKey: carbonPubkey, rootId: null };
    await post("/pin-trust", { env: await pinEnv(carbonArgs, "carbon"), ...carbonArgs });
    const nodeArgs = { sourceNodeId: nodeId, headKeyId: "demo-key-1", publicKey: nodeAPubkey, rootId: null };
    await post("/pin-trust", { env: await pinEnv(nodeArgs, "node"), ...nodeArgs });
    // CASE 1: valid — silicon acts in scope -> Node B verifies the carbon->silicon chain
    const a1 = await ctx.runMutation(api.ceremony.siliconAct, { delegationId: delId, chainKey: `cer:${run}:1`, action: "studio.write", resource: "studio_surface:knvs", ring: "local-write" });
    out.case1_valid = a1.ok ? await post("/import-delegated", { env: a1.envelope }) : { ok: false, reason: `act:${a1.reason}` };
    // CASE 2: scope violation — silicon attempts an action outside the delegated scope
    const a2 = await ctx.runMutation(api.ceremony.siliconAct, { delegationId: delId, chainKey: `cer:${run}:2`, action: "studio.delete", resource: "studio_surface:knvs", ring: "local-write" });
    out.case2_scope_violation = a2.ok ? { silicon: "EMITTED(bad)" } : { silicon_refused: a2.reason };
    // CASE 3: forged delegation metadata -> Node B refuses
    const a3 = await ctx.runMutation(api.ceremony.siliconAct, { delegationId: delId, chainKey: `cer:${run}:3`, action: "studio.write", resource: "studio_surface:knvs", ring: "local-write" });
    let forged: any = { ok: false, reason: "act_failed" };
    if (a3.ok) { const e = JSON.parse(JSON.stringify(a3.envelope)); e.delegation.siliconPrincipal = "demo.attacker.silicon"; forged = await post("/import-delegated", { env: e }); }
    out.case3_forged_delegation = forged;
    // CASE 4: revocation. Pre-mint a receipt, then carbon revokes; Node B refuses the pre-minted receipt (cross-node)
    //          AND Node A refuses to mint anything new under the revoked delegation (local).
    const aPre = await ctx.runMutation(api.ceremony.siliconAct, { delegationId: delId, chainKey: `cer:${run}:4`, action: "studio.write", resource: "studio_surface:knvs", ring: "local-write" });
    const revokedAt = Date.now();
    const revHash = await buildReceiptChainHash({ type: "delegation_revocation", carbonRoot, delegationId: delId, revokedAt }, null);
    const revSig = await signChainHeadV3(carbonSeed, { chainKey: `del:${delId}:rev`, timestamp: revokedAt, chainLength: 1, chainHeadHash: revHash }, "delegation");
    await ctx.runMutation(api.ceremony.markRevoked, { delegationId: delId });
    out.revImport = await post("/import-delegated-revocation", { rev: { carbonRoot, delegationId: delId, revokedAt, sig: revSig } });
    out.case4_crossnode_revoked = aPre.ok ? await post("/import-delegated", { env: aPre.envelope }) : { ok: false, reason: `act:${aPre.reason}` };
    const aPost = await ctx.runMutation(api.ceremony.siliconAct, { delegationId: delId, chainKey: `cer:${run}:5`, action: "studio.write", resource: "studio_surface:knvs", ring: "local-write" });
    out.case4_local_refusal = aPost.ok ? { minted: "bad" } : { node_a_refused: aPost.reason };
    return out;
  },
});