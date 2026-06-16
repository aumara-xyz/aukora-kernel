// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/**
 * Brick 6 — AUMLOK PROOF-OF-POSSESSION resolver (demo slice). Replaces the plaintext `node_sessions` seam for
 * operator/Ring-0 surfaces. Authority is no longer a stored token; it is a SIGNATURE the caller proves possession of,
 * per request, verified against a PINNED public key the server never holds.
 *
 * Two signatures against ONE pinned key (founder_key_registry):
 *   capSig — founder signs scoped CAVEATS once at issuance (binds founder authority INTO the grant).
 *   reqSig — holder signs each REQUEST over {capId, methodId, argsHash, nodeId, principalId, timestamp, nonce} (PoP).
 * Both reuse SignedChainHeadV3 (ML-DSA-65 via the aukoraPqcSigner chokepoint) by mapping the canonical payload's
 * SHA-256 into ChainHeadFields.chainHeadHash with a domain-separated chainKey — and, since B1.3, DISTINCT FIPS 204
 * domains ("cap" for issuance, "req" for per-request PoP) so neither signature can be lifted onto the other or onto
 * a chain head at the primitive level. Returns the same {principalId,nodeId,roles} shape as
 * resolveSession, so callers are untouched. THROWS pop_* on ANY failure (fail-closed; a throw rolls back the mutation).
 *
 * DEMO-ONLY (NOT production): disposable demo founder seed in the seed/harness (prod = AUMLOK device key in an
 * enclave, swapped behind this identical payload/caveat/nonce contract). Deferred to prod: receipt co-signing, key
 * custody, founder_key_registry write authority. See docs/AUKORA_BRICK6_AUMLOK_POP_RESOLVER.md.
 */
import { mutation, internalMutation, action } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { stableStringify, sha256Hex } from "./aukoraCore";
import { signChainHeadV3, verifyChainHeadV3, type ChainHeadFields } from "./aukoraSignedHead";
import { mlDsa65PublicKeyFromSeed, isPqcPublicKeyHex } from "./aukoraPqcSigner";
import { consumeRateLimit } from "./aukoraRateLimit";

export const POP_FRESHNESS_MS = 60_000; // operator-action freshness window
// Demo operator capability seed (PoP). The PRIVATE seed is a disposable demo constant the orchestrator signs with; only
// the PUBLIC key is pinned on the node (admin-provisioned via seedOperatorKey). Prod = AUMLOK device key, same contract.
export const DEMO_OPERATOR_SEED = process.env.AUMA_OPERATOR_SEED ?? "77".repeat(32);
const POP_RATE = () => ({ capacity: Number(process.env.AUKORA_POP_RATE_CAP ?? 30), windowMs: 60_000 });

// ── Canonical serializers (domain-prefixed + version byte; byte-identical across signer/verifier/kit) ──
const CAP_FIELDS = ["v", "capId", "founderUserId", "founderKeyId", "nodeId", "methods", "ring", "action", "resource", "principalId", "roles", "notBefore", "expiresAt", "maxUses"] as const;
const REQ_FIELDS = ["v", "capId", "methodId", "argsHash", "nodeId", "principalId", "timestamp", "nonce"] as const;
const pick = (obj: any, fields: readonly string[]) => { const o: any = {}; for (const f of fields) o[f] = obj?.[f]; return o; };
export function serializeCapV1(caveats: any): string { return "aukora-cap-v1|" + stableStringify(pick(caveats, CAP_FIELDS)); }
export function serializeRequestV1(req: any): string { return "aukora-req-v1|" + stableStringify(pick(req, REQ_FIELDS)); }
// Map a canonical payload into the ChainHeadFields shape so we reuse the V3 head signer/verifier unchanged,
// under the distinct "cap"/"req" domains (the PQC library's audit status is the §7.1 accepted risk — never call it audited).
async function capHead(cav: any): Promise<ChainHeadFields> { return { chainKey: `aukora-cap-v1:${cav?.capId}`, timestamp: Number(cav?.notBefore ?? 0), chainLength: 1, chainHeadHash: await sha256Hex(serializeCapV1(cav)) }; }
async function reqHead(req: any): Promise<ChainHeadFields> { return { chainKey: `aukora-req-v1:${req?.capId}`, timestamp: Number(req?.timestamp ?? 0), chainLength: 1, chainHeadHash: await sha256Hex(serializeRequestV1(req)) }; }

// Signing helper (DEMO: founder private seed lives in the harness). Returns the wire envelope.
export async function buildPoPEnvelope(seedHex: string, caveats: any, opts: { methodId: string; actualArgs: any; timestamp: number; nonce: string }) {
  const capSig = await signChainHeadV3(seedHex, await capHead(caveats), "cap");
  const argsHash = await sha256Hex(stableStringify(opts.actualArgs ?? {}));
  const reqPayload = { v: 1, capId: caveats.capId, methodId: opts.methodId, argsHash, nodeId: caveats.nodeId, principalId: caveats.principalId, timestamp: opts.timestamp, nonce: opts.nonce };
  const reqSig = await signChainHeadV3(seedHex, await reqHead(reqPayload), "req");
  return { caveats, capSig, reqSig, timestamp: opts.timestamp, nonce: opts.nonce };
}

// ── THE RESOLVER (fail-closed). Throws pop_* on failure; returns the session on success. ──
export async function resolvePoPSession(ctx: any, env: any, methodId: string, actualArgs: any, thisNodeId: string): Promise<{ principalId: string; nodeId: string; roles: string[]; ring?: string; action?: string; resource?: string; keyId?: string }> {
  const cav = env?.caveats;
  if (!cav || typeof cav !== "object") throw new Error("pop_no_capability");
  // 0. RATE LIMIT before any crypto — caps verification cost per founder (DoS guard).
  if (!(await consumeRateLimit(ctx, `pop:${cav.founderUserId ?? "?"}`, POP_RATE()))) throw new Error("pop_rate_limited");
  // 1. Pinned key lookup — by (founderUserId, founderKeyId), NEVER a key carried in the blob.
  const pin = await ctx.db.query("founder_key_registry").withIndex("by_founder_kid", (q: any) => q.eq("founderUserId", cav.founderUserId).eq("keyId", cav.founderKeyId)).first();
  if (!pin) throw new Error("pop_key_unknown");
  if (pin.status === "revoked") throw new Error("pop_key_revoked"); // compromise kill — nothing under this key verifies
  // Rotation: a RETIRED key still verifies caps it issued WHILE ACTIVE (cav.notBefore < retiredAt) — old authority is
  // grandfathered — but cannot issue NEW caps (cav.notBefore >= retiredAt). New authority requires the rotated-in key.
  if (pin.status === "retired" && Number(cav.notBefore) >= Number(pin.retiredAt ?? 0)) throw new Error("pop_key_retired");
  // 2. capSig over the pinned key.
  if (!(await verifyChainHeadV3(pin.publicKey, await capHead(cav), env.capSig, "cap"))) throw new Error("pop_cap_sig_invalid");
  // 3. Caveat checks (node binding, time window, method allow-list).
  const now = Date.now();
  if (cav.nodeId !== thisNodeId) throw new Error("pop_node_mismatch");
  if (!(Number(cav.notBefore) <= now && now < Number(cav.expiresAt))) throw new Error("pop_cap_expired");
  if (!Array.isArray(cav.methods) || !cav.methods.includes(methodId)) throw new Error("pop_method_not_allowed");
  // 4. Revocation (reuse node_revocations: sourceNodeId=founderUserId, delegationId=capId).
  const rev = await ctx.db.query("node_revocations").withIndex("by_src_del", (q: any) => q.eq("sourceNodeId", cav.founderUserId).eq("delegationId", cav.capId)).first();
  if (rev) throw new Error("pop_revoked");
  // 5. Freshness + SERVER-recomputed argsHash (client cannot self-assert the digest).
  if (typeof env.timestamp !== "number" || Math.abs(now - env.timestamp) > POP_FRESHNESS_MS) throw new Error("pop_expired");
  const argsHash = await sha256Hex(stableStringify(actualArgs ?? {}));
  // 6. reqSig over the SAME pinned key — binds capId+methodId+argsHash+nodeId+principalId+timestamp+nonce.
  const reqPayload = { v: 1, capId: cav.capId, methodId, argsHash, nodeId: thisNodeId, principalId: cav.principalId, timestamp: env.timestamp, nonce: env.nonce };
  if (!(await verifyChainHeadV3(pin.publicKey, await reqHead(reqPayload), env.reqSig, "req"))) throw new Error("pop_req_sig_invalid");
  // 7. Replay: claim the nonce LAST (verified-then-claimed → bogus sigs never burn a nonce; commits only on success).
  if (typeof env.nonce !== "string" || !env.nonce) throw new Error("pop_nonce_missing");
  const dup = await ctx.db.query("pop_nonce_registry").withIndex("by_node_nonce", (q: any) => q.eq("nodeId", thisNodeId).eq("nonce", env.nonce)).first();
  if (dup) throw new Error("pop_replay");
  await ctx.db.insert("pop_nonce_registry", { nodeId: thisNodeId, founderUserId: cav.founderUserId, keyId: cav.founderKeyId, capId: cav.capId, nonce: env.nonce, methodId, argsHash, consumedAt: now, expiresAt: now + POP_FRESHNESS_MS });
  // Return the SIGNED caveat scope + the authorizing keyId so callers can bind their effect + record WHICH key authorized.
  return { principalId: cav.principalId, nodeId: cav.nodeId, roles: Array.isArray(cav.roles) ? cav.roles : ["operator"], ring: cav.ring, action: cav.action, resource: cav.resource, keyId: cav.founderKeyId };
}

// ── Demo gated surface: a representative operator mutation guarded by PoP (stands in for issueGrant). ──
export const popGatedAct = mutation({
  args: { env: v.any(), methodId: v.string(), actualArgs: v.any(), nodeId: v.string() },
  handler: async (ctx, a): Promise<any> => {
    const session = await resolvePoPSession(ctx, a.env, a.methodId, a.actualArgs, a.nodeId); // throws pop_* -> rolls back
    // Representative gated effect (only reachable AFTER proof-of-possession). The grant's scope is DERIVED from the
    // SIGNED caveats (session.ring/action/resource), never hardcoded — so the effect is provably within the founder-
    // signed capability (defense-in-depth: a cap cannot mint a grant broader than its signed scope).
    await ctx.db.insert("aukora_grants", { grantKey: `pop_${a.nodeId}_${a.env.nonce}`, status: "active", actorId: session.principalId, actorRole: "operator", ring: (session.ring ?? "local-write") as any, action: session.action ?? "echo", resource: session.resource ?? "echo:demo", issuedBy: session.principalId, issuedAt: Date.now(), expiresAt: Date.now() + 60_000, maxUses: 1, usedCount: 0, updatedAt: Date.now() }); // runtime schema validation enforces a valid ring (fail-closed)
    return { ok: true, session };
  },
});

// ── Seed / admin (DEMO: pin a disposable founder pubkey; revoke a cap). NOT the real AUMLOK ceremony. ──
export const seedFounderKey = internalMutation({
  args: { founderUserId: v.string(), keyId: v.string(), publicKey: v.string(), status: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const existing = await ctx.db.query("founder_key_registry").withIndex("by_founder_kid", (q: any) => q.eq("founderUserId", a.founderUserId).eq("keyId", a.keyId)).first();
    if (existing) {
      // Defense-in-depth (ULTRON core-PoP review): an ACTIVE pinned key's publicKey is IMMUTABLE here — silently
      // replacing it would let a registry write hijack the trust root for emit/revoke. Rotation goes through
      // rotateFounderKey; status flips (active->revoked) keep the SAME key.
      if (existing.status === "active" && a.publicKey !== existing.publicKey) throw new Error("pop_key_immutable_active");
      await ctx.db.patch(existing._id, { publicKey: a.publicKey, status: a.status ?? "active" }); return { updated: true };
    }
    // Shape-gate FRESH pins (B1.3b): a legacy 64-hex/garbage founder key would never verify and, once active,
    // is immutable — refuse it at the door.
    if (!isPqcPublicKeyHex(a.publicKey)) throw new Error("pop_pubkey_invalid");
    await ctx.db.insert("founder_key_registry", { founderUserId: a.founderUserId, keyId: a.keyId, publicKey: a.publicKey, status: a.status ?? "active", pinnedAt: Date.now() });
    return { seeded: true };
  },
});

// Operator-key provisioning. SAFE to expose because it takes NO caller-supplied key — it DERIVES the operator public key
// from the server-side seed constant and pins it idempotently; an active key is IMMUTABLE (rotation via rotateFounderKey).
// So the original hijack (caller POSTs their own pubkey) is structurally impossible: a caller can only ever (re)pin the
// one legitimate key. Demo: the operator seed is a known constant; prod: the node holds only the pubkey, provisioned OOB.
export const seedOperatorKey = mutation({
  args: {},
  handler: async (ctx): Promise<any> => {
    const publicKey = await mlDsa65PublicKeyFromSeed(DEMO_OPERATOR_SEED);
    const existing = await ctx.db.query("founder_key_registry").withIndex("by_founder_kid", (q: any) => q.eq("founderUserId", "aukora.operator").eq("keyId", "op-1")).first();
    if (existing) { if (existing.status === "active" && existing.publicKey !== publicKey) throw new Error("pop_key_immutable_active"); await ctx.db.patch(existing._id, { publicKey, status: "active" }); return { updated: true }; }
    await ctx.db.insert("founder_key_registry", { founderUserId: "aukora.operator", keyId: "op-1", publicKey, status: "active", pinnedAt: Date.now() });
    return { seeded: true };
  },
});
export const revokePopCap = internalMutation({
  args: { founderUserId: v.string(), capId: v.string() },
  handler: async (ctx, a) => { await ctx.db.insert("node_revocations", { sourceNodeId: a.founderUserId, delegationId: a.capId, revokedAt: Date.now() }); return { revoked: true }; },
});
// Brick 7 — KEY ROTATION: retire the old key (grandfathers caps it issued; cannot issue new) + pin the new key active.
export const rotateFounderKey = internalMutation({
  args: { founderUserId: v.string(), oldKeyId: v.string(), newKeyId: v.string(), newPublicKey: v.string() },
  handler: async (ctx, a) => {
    if (!isPqcPublicKeyHex(a.newPublicKey)) throw new Error("pop_pubkey_invalid"); // B1.3b: rotation can't install a legacy/garbage key
    const now = Date.now();
    const old = await ctx.db.query("founder_key_registry").withIndex("by_founder_kid", (q: any) => q.eq("founderUserId", a.founderUserId).eq("keyId", a.oldKeyId)).first();
    if (old) await ctx.db.patch(old._id, { status: "retired", retiredAt: now });
    const existingNew = await ctx.db.query("founder_key_registry").withIndex("by_founder_kid", (q: any) => q.eq("founderUserId", a.founderUserId).eq("keyId", a.newKeyId)).first();
    if (existingNew) await ctx.db.patch(existingNew._id, { publicKey: a.newPublicKey, status: "active" });
    else await ctx.db.insert("founder_key_registry", { founderUserId: a.founderUserId, keyId: a.newKeyId, publicKey: a.newPublicKey, status: "active", pinnedAt: now });
    return { rotated: true, retiredAt: now };
  },
});

// ── Live proof: fire the named attacks through the deployed resolver (DEMO founder key held in this action). ──
// DEMO-ONLY disposable founder seed (env-overridable for hygiene; NEVER a real key). Prod = AUMLOK P-256 enclave key.
const DEMO_FOUNDER_SEED = process.env.DEMO_FOUNDER_SEED ?? "dd".repeat(32);
export const runPopCrash = action({
  args: {},
  handler: async (ctx): Promise<any> => {
    const run = crypto.randomUUID().slice(0, 8);
    const founderUserId = `demo.founder:${run}`, keyId = "fk-1", nodeId = process.env.AUMA_NODE_ID ?? "aukora-node-a-demo";
    const pub = await mlDsa65PublicKeyFromSeed(DEMO_FOUNDER_SEED);
    await ctx.runMutation(internal.popResolver.seedFounderKey, { founderUserId, keyId, publicKey: pub });
    const ATTACKER_SEED = "ee".repeat(32);
    const now = Date.now();
    const baseCav = (capId: string, over: any = {}) => ({ v: 1, capId, founderUserId, founderKeyId: keyId, nodeId, methods: ["popIssueGrant"], ring: "local-write", action: "echo", resource: "echo:demo", principalId: founderUserId, roles: ["operator"], notBefore: now - 1000, expiresAt: now + POP_FRESHNESS_MS, maxUses: 1, ...over });
    const fire = async (label: string, seed: string, cav: any, o: { methodId?: string; actualArgs?: any; ts?: number; nonce?: string; callMethodId?: string; callArgs?: any; preRevoke?: boolean } = {}) => {
      const nonce = o.nonce ?? `n-${run}-${crypto.randomUUID().slice(0, 8)}`;
      const env = await buildPoPEnvelope(seed, cav, { methodId: o.methodId ?? "popIssueGrant", actualArgs: o.actualArgs ?? { grant: "echo" }, timestamp: o.ts ?? now, nonce });
      if (o.preRevoke) await ctx.runMutation(internal.popResolver.revokePopCap, { founderUserId, capId: cav.capId });
      try {
        await ctx.runMutation(api.popResolver.popGatedAct, { env, methodId: o.callMethodId ?? o.methodId ?? "popIssueGrant", actualArgs: o.callArgs ?? o.actualArgs ?? { grant: "echo" }, nodeId });
        return { label, outcome: "ALLOWED" };
      } catch (e: any) { return { label, outcome: "refused", reason: String(e?.message ?? e).replace(/^.*?(pop_[a-z_]+).*$/s, "$1") }; }
    };
    const results: any[] = [];
    results.push(await fire("1_happy_valid", DEMO_FOUNDER_SEED, baseCav("cap-happy")));
    results.push(await fire("2_no_bearer_garbage_cap", DEMO_FOUNDER_SEED, baseCav("cap-x", { founderKeyId: "nope" })));
    results.push(await fire("3_forged_cap_attacker_key", ATTACKER_SEED, baseCav("cap-forge")));
    const replayNonce = `n-${run}-REPLAY`;
    results.push(await fire("4a_replay_first", DEMO_FOUNDER_SEED, baseCav("cap-replay"), { nonce: replayNonce }));
    results.push(await fire("4b_replay_again", DEMO_FOUNDER_SEED, baseCav("cap-replay2"), { nonce: replayNonce }));
    results.push(await fire("5_cross_function_lift", DEMO_FOUNDER_SEED, baseCav("cap-fn"), { callMethodId: "popKillSwitch" }));
    results.push(await fire("6_args_tamper", DEMO_FOUNDER_SEED, baseCav("cap-args"), { actualArgs: { grant: "echo" }, callArgs: { grant: "ROOT" } }));
    results.push(await fire("7_expired_timestamp", DEMO_FOUNDER_SEED, baseCav("cap-exp"), { ts: now - 5 * POP_FRESHNESS_MS }));
    results.push(await fire("8_revoked_cap", DEMO_FOUNDER_SEED, baseCav("cap-rev"), { preRevoke: true }));
    results.push(await fire("9_wrong_node", DEMO_FOUNDER_SEED, baseCav("cap-node", { nodeId: "attacker-node" })));
    // legitimate uses (the happy path + the FIRST use before a replay) must be ALLOWED; everything else must be refused.
    const LEGIT = new Set(["1_happy_valid", "4a_replay_first"]);
    const happyOk = results.filter((r) => LEGIT.has(r.label)).every((r) => r.outcome === "ALLOWED");
    const allAttacksRefused = results.filter((r) => !LEGIT.has(r.label)).every((r) => r.outcome === "refused");
    return { run, mode: "LIVE_EMPIRICAL", happyOk, allAttacksRefused, results };
  },
});

// Brick 7 — live KEY ROTATION lifecycle proof (DEMO disposable seeds).
const ROT_SEED_OLD = "11".repeat(32), ROT_SEED_NEW = "22".repeat(32);
export const runKeyRotation = action({
  args: {},
  handler: async (ctx): Promise<any> => {
    const run = crypto.randomUUID().slice(0, 8);
    const founderUserId = `demo.founder.rot:${run}`, nodeId = process.env.AUMA_NODE_ID ?? "aukora-node-a-demo";
    const oldPub = await mlDsa65PublicKeyFromSeed(ROT_SEED_OLD), newPub = await mlDsa65PublicKeyFromSeed(ROT_SEED_NEW);
    await ctx.runMutation(internal.popResolver.seedFounderKey, { founderUserId, keyId: "fk-old", publicKey: oldPub });
    const t0 = Date.now();
    const cav = (capId: string, keyId: string, over: any = {}) => ({ v: 1, capId, founderUserId, founderKeyId: keyId, nodeId, methods: ["popIssueGrant"], ring: "local-write", action: "echo", resource: "echo:demo", principalId: founderUserId, roles: ["operator"], notBefore: t0 - 1000, expiresAt: t0 + POP_FRESHNESS_MS, maxUses: 1, ...over });
    const fire = async (label: string, seed: string, c: any) => {
      const nonce = `n-${run}-${crypto.randomUUID().slice(0, 8)}`;
      const env = await buildPoPEnvelope(seed, c, { methodId: "popIssueGrant", actualArgs: { grant: "echo" }, timestamp: Date.now(), nonce });
      try { await ctx.runMutation(api.popResolver.popGatedAct, { env, methodId: "popIssueGrant", actualArgs: { grant: "echo" }, nodeId }); return { label, outcome: "ALLOWED" }; }
      catch (e: any) { return { label, outcome: "refused", reason: String(e?.message ?? e).match(/pop_[a-z_]+/)?.[0] ?? "err" }; }
    };
    const results: any[] = [];
    results.push(await fire("1_old_key_active", ROT_SEED_OLD, cav("c1", "fk-old")));
    const preRotNotBefore = Date.now() - 500; // a cap issued BEFORE rotation (for the grandfather test)
    await ctx.runMutation(internal.popResolver.rotateFounderKey, { founderUserId, oldKeyId: "fk-old", newKeyId: "fk-new", newPublicKey: newPub });
    results.push(await fire("2_new_key_after_rotation", ROT_SEED_NEW, cav("c2", "fk-new", { notBefore: Date.now() - 100 })));
    results.push(await fire("3_old_key_issue_NEW_cap_after_retire", ROT_SEED_OLD, cav("c3", "fk-old", { notBefore: Date.now() + 5000 })));
    results.push(await fire("4_old_key_grandfathered_inwindow", ROT_SEED_OLD, cav("c4", "fk-old", { notBefore: preRotNotBefore })));
    await ctx.runMutation(internal.popResolver.seedFounderKey, { founderUserId, keyId: "fk-old", publicKey: oldPub, status: "revoked" });
    results.push(await fire("5_old_key_revoked", ROT_SEED_OLD, cav("c5", "fk-old", { notBefore: preRotNotBefore })));
    results.push(await fire("6_unknown_keyId", ROT_SEED_NEW, cav("c6", "fk-ghost")));
    const expect: Record<string, string> = { "1_old_key_active": "ALLOWED", "2_new_key_after_rotation": "ALLOWED", "3_old_key_issue_NEW_cap_after_retire": "refused", "4_old_key_grandfathered_inwindow": "ALLOWED", "5_old_key_revoked": "refused", "6_unknown_keyId": "refused" };
    const allCorrect = results.every((r) => r.outcome === expect[r.label]);
    return { run, mode: "LIVE_EMPIRICAL", allCorrect, results };
  },
});