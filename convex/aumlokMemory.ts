// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/**
 * B2.4 — AUMLOK MEMORY BOUNDARY (LIVE manifest enforcement). The seam Fable kept flagging: a B2.2 delegation manifest
 * is the AUTHORITY that justifies a one-shot kernel grant, which flows through the UNCHANGED grant→intent→token→receipt
 * pipeline to a memory effect + a receipt that binds the manifest. This replaces the harness-flag simulation in
 * memory.ts (runMemory — the superseded rehearsal demo, kept only for the slice/http demo wiring, NOT
 * an authority path, exactly as the B0 aukora_delegations lane is frozen demo).
 *
 * SEAM (ATOMIC — one Convex mutation = one serializable transaction): consumeManifestUseCore (resolve authority +
 * subject PoP + circuit breakers + OCC usedCount++) → mint a one-shot aukora_grants row FROM the resolved manifest →
 * submitIntentCore (finds the grant, mints the decision token) → verifyAndConsumeDecisionToken → writeReceiptRow on
 * the `mem:{owner}:{key}` effect chain (intent-gated, binds {manifestId,rootId,subjectId,fingerprint,useSeq,memoryHash})
 * → insert the aukora_memory row. A use is spent IFF the whole mutation commits; two concurrent same-useSeq writes
 * conflict on the manifest row → exactly one commits, the other refuses (aumlok_mft_useseq_mismatch). No double-spend.
 * No signed-but-unenforced field — the resolver already enforced node/status/time/root/permission/codec, the consume
 * enforced subjectId/PoP/freshness/useSeq/maxUses/maxPerWindow, and the boundary pins action/ring/resource-scope here.
 *
 * CLAIM DISCIPLINE: PROVEN-LAB. NOT production identity, NOT full privacy, NOT recovery, NOT lifecycle-sovereignty,
 * The kernel intent/token/receipt pipeline is reused UNCHANGED.
 */
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { consumeManifestUseCore, resolveManifestAuthority } from "./aumlokManifests";
import { submitIntentCore } from "./aukoraRuntime";
import { verifyAndConsumeDecisionToken } from "./aukoraToken";
import { writeReceiptRow, IDENTITY_NAME_RE } from "./aukoraReceipts";
import { sha256Hex, stableStringify } from "./aukoraCore";
import { verifyChainHeadV3, type ChainHeadFields } from "./aukoraSignedHead";

const THIS_NODE_ID = (): string => process.env.AUMA_NODE_ID ?? "aukora-node-a-demo";
const RECALL_FRESHNESS_MS = 60_000;
// Memory key: the frozen identity-name grammar (no colon) so `mem:{owner}:{key}` stays an unambiguous chainKey.
const asMemKey = (x: unknown): string => { if (typeof x !== "string" || !IDENTITY_NAME_RE.test(x)) throw new Error("aumlok_mem_key_invalid"); return x; };
const asMemName = (x: unknown): string => { if (typeof x !== "string" || !IDENTITY_NAME_RE.test(x)) throw new Error("aumlok_mem_name_invalid"); return x; };

// The reader's proof-of-possession head for a recall (READ), signed under the DEDICATED `aumlokMemRecall` domain
// (`aukora-aumlok-memrecall-v1`, B3.1 P3 — both owner-root and subject recall sign under it). Its distinct domain +
// chainKey (`aumlok:memrecall:`) chain_id-separate it from rotation / genesis / manifest-PoP / consume, so a recall
// sig can never be replayed as any of those, and vice versa.
const RECALL_FIELDS = ["v", "ownerRootId", "key", "readerPrincipalId", "timestamp"] as const;
const pick = (o: any, f: readonly string[]) => { const r: any = {}; for (const k of f) r[k] = o?.[k]; return r; };
export function serializeRecallV1(r: any): string { return "aukora-aumlok-memrecall-v1|" + stableStringify(pick(r, RECALL_FIELDS)); }
export async function recallHead(r: any): Promise<ChainHeadFields> { return { chainKey: `aumlok:memrecall:${r.ownerRootId}:${r.key}`, timestamp: Number(r.timestamp), chainLength: 1, chainHeadHash: await sha256Hex(serializeRecallV1(r)) }; }

/** WRITE a memory value UNDER a delegation manifest — the manifest (root→subject) is the ONLY authority. */
export const aumlokMemoryWrite = mutation({
  args: { req: v.any(), subjectSig: v.string(), value: v.string() },
  handler: async (ctx, a): Promise<any> => {
    const r = a.req ?? {};
    // The boundary fixes the effect shape: a manifest may only authorize memory.write on the local-write ring here.
    if (r.action !== "memory.write") throw new Error("aumlok_mem_action_invalid");
    if (r.ring !== "local-write") throw new Error("aumlok_mem_ring_invalid");
    const key = asMemKey(r.key);
    if (typeof a.value !== "string") throw new Error("aumlok_mem_value_invalid");

    // 1) resolve + consume the manifest use (authority + circuit breaker + OCC usedCount++) — atomic in this mutation.
    //    B3.5b: `issuer` is the AUDIT-ONLY tag (local | foreign) — it is RECORDED on the grant + receipt, never branched on.
    const { manifest: m, useSeq, issuer } = await consumeManifestUseCore(ctx, r, a.subjectSig);
    const owner = m.rootId, writer = m.subjectId;
    const issuerKind = issuer?.kind ?? "local";
    const issuerSrc = issuer?.kind === "foreign" ? issuer.sourceNodeId : undefined;
    // 2) scope binding: a manifest only writes its OWN root's memory namespace (owner is the manifest's rootId — for a
    //    cross-grant, the FOREIGN root's namespace `mem:{foreignRootId}` on THIS node; no new effect type, Db6).
    if (r.resource !== `mem:${owner}`) throw new Error("aumlok_mem_resource_scope");

    const node = THIS_NODE_ID(), now = Date.now(), ck = `mem:${owner}:${key}`;
    // 3) mint a ONE-SHOT kernel grant FROM the resolved manifest, then the UNCHANGED intent→token gate authorizes it.
    await ctx.db.insert("aukora_grants", { grantKey: `pg_mem_${m.manifestId}_${useSeq}`, status: "active", actorId: writer, actorRole: "operator", ring: "local-write", action: "memory.write", resource: `mem:${owner}`, issuedBy: owner, issuedAt: now, expiresAt: now + 60_000, maxUses: 1, usedCount: 0, updatedAt: now, issuer: issuerKind, issuerSourceNodeId: issuerSrc });
    const s = await submitIntentCore(ctx, { actorId: writer, actorRole: "operator", ring: "local-write", claim: "moga", action: "memory.write", resource: `mem:${owner}`, requiresAuthorization: true, stateKey: ck });
    if (!s.decisionToken) throw new Error("aumlok_mem_no_authority");
    const consumed = await verifyAndConsumeDecisionToken(ctx, { token: s.decisionToken, action: "memory.write", resource: `mem:${owner}`, ring: "local-write", expectedActorId: writer });

    // 4) the EFFECT receipt (intent-gated writeReceiptRow on the mem: effect chain) binds the manifest authority used.
    const memoryHash = await sha256Hex(`${owner}:${key}:${a.value}`);
    await writeReceiptRow(ctx, { chainKey: ck, decisionLogId: consumed.logId, goal: "memory.write", actorModel: writer, lane: "local", risk: "low", grade: "A", verdict: "kept", actionsJson: "[]", proofJson: JSON.stringify({ memory: true, manifestId: m.manifestId, rootId: owner, subjectId: writer, subjectFingerprint: m.subjectFingerprint, useSeq, memoryHash, nodeId: node, issuer: issuerKind, ...(issuer?.kind === "foreign" ? { issuerSourceNodeId: issuer.sourceNodeId, issuerRootId: issuer.rootId, issuerRootKeyId: issuer.rootKeyId } : {}) }) });
    const rcpt = await ctx.db.query("auma_receipts").withIndex("by_chainKey_ts", (q) => q.eq("chainKey", ck)).order("desc").first();
    // 5) the effect: the memory row, coupled to the receipt + tagged with the authorizing manifest.
    await ctx.db.insert("aukora_memory", { ownerRootId: owner, writerPrincipalId: writer, readerScope: "owner+writer", delegationId: m.manifestId, receiptHash: rcpt!.chainHash ?? "", memoryHash, sourceNodeId: node, visibility: "private", key, value: a.value });
    return { ok: true, manifestId: m.manifestId, ownerRootId: owner, writerPrincipalId: writer, key, useSeq, memoryHash, receiptHash: rcpt!.chainHash };
  },
});

/** RECALL (read; NO use consumed — reads do not burn the maxUses budget). AUTHENTICATED: the reader must PROVE
 *  possession of the key it claims (not merely assert a principal string), mirroring the write's subject PoP — so
 *  "cross-principal refused" is a real defense, not shape. The OWNER root reads by signing with its ACTIVE root key,
 *  the delegated SUBJECT reads by signing with the manifest's subject key — BOTH under the dedicated `aumlokMemRecall`
 *  domain (B3.1 P3) — and the subject reads only while the authorizing manifest is STILL valid (revocation / expiry /
 *  root-revoke severs the read). Any other principal, or a valid-looking claim with the wrong key, is refused. */
export const aumlokMemoryRecall = query({
  args: { req: v.any(), readerSig: v.string() },
  handler: async (ctx, a): Promise<any> => {
    const r = a.req ?? {};
    const ownerRootId = asMemName(r.ownerRootId), key = asMemKey(r.key), reader = asMemName(r.readerPrincipalId);
    if (!Number.isSafeInteger(r.timestamp) || (r.timestamp as number) <= 0) throw new Error("aumlok_mem_timestamp_invalid");
    if (typeof a.readerSig !== "string" || !a.readerSig) throw new Error("aumlok_mem_signature_missing");
    const row = await ctx.db.query("aukora_memory").withIndex("by_owner_key", (q) => q.eq("ownerRootId", ownerRootId).eq("key", key)).first();
    if (!row || row.deletedAt) return { ok: false, reason: "not_found" };
    if (Math.abs(Date.now() - Number(r.timestamp)) > RECALL_FRESHNESS_MS) return { ok: false, reason: "stale" };
    const head = await recallHead(r);

    if (reader === ownerRootId) { // owner root — prove possession of the ACTIVE root key
      const rk = (await ctx.db.query("aumlok_root_keys").withIndex("by_root", (q) => q.eq("rootId", ownerRootId)).collect()).find((k: any) => k.status === "active");
      if (!rk) return { ok: false, reason: "no_active_root_key" };
      if (await verifyChainHeadV3(rk.publicKey, head, a.readerSig, "aumlokMemRecall")) return { ok: true, value: row.value };
      return { ok: false, reason: "reader_pop_invalid" };
    }
    if (reader === row.writerPrincipalId) { // delegated subject — manifest still live AND prove possession of the subject key
      const res = await resolveManifestAuthority(ctx, { manifestId: row.delegationId, ring: "local-write", action: "memory.write", resource: `mem:${ownerRootId}`, intentCodec: "json_action_v1" });
      if (!res.ok || !res.manifest) return { ok: false, reason: "cross_principal_refused", detail: res.reason }; // revoked/expired/root-revoked → severed
      if (await verifyChainHeadV3(res.manifest.subjectPubKey, head, a.readerSig, "aumlokMemRecall")) return { ok: true, value: row.value };
      return { ok: false, reason: "reader_pop_invalid" };
    }
    return { ok: false, reason: "cross_principal_refused" }; // any unrelated principal / the node itself
  },
});
