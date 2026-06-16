// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/**
 * Code attestation (DEMO) — binds receipts to a founder-release-key-signed RELEASE MANIFEST so a reviewer can check
 * "which blessed release authorized this", and a rolled-back/forged/downgraded release is refused. Design + the HONEST
 * residual: docs/AUKORA_CODE_ATTESTATION_DESIGN.md.
 *
 * HONEST SCOPE: this proves *provenance* (a founder-blessed manifest binding {version, gitSHA, bundleHash} + version
 * high-water), NOT that a node is *actually executing* that bundle. With no TEE/platform attestation in Convex, a
 * compromised host can still run swapped code while advertising a blessed manifestId. bundleHash is the REPRODUCIBLE
 * slice-tarball hash (scripts/compute-bundle-hash.sh), not the opaque deployed Convex bundle. External witness = deferred.
 */
import { internalMutation, action } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { stableStringify, sha256Hex } from "./aukoraCore";
import { signChainHeadV3, verifyChainHeadV3, type ChainHeadFields } from "./aukoraSignedHead";
import { mlDsa65PublicKeyFromSeed } from "./aukoraPqcSigner";

const RELEASE_AUTHORITY = "aukora.release"; // the release-key authority id in founder_key_registry (distinct from PoP)
const MANIFEST_FIELDS = ["manifestId", "version", "gitSHA", "bundleHash", "bundleHashAlg"] as const;
const pick = (m: any, fields: readonly string[]) => { const o: any = {}; for (const f of fields) o[f] = m?.[f]; return o; };
export function serializeManifestV1(m: any): string { return "aukora-manifest-v1|" + stableStringify(pick(m, MANIFEST_FIELDS)); }
async function manifestHead(m: any): Promise<ChainHeadFields> { return { chainKey: `aukora-manifest-v1:${m?.manifestId}`, timestamp: Number(m?.version ?? 0), chainLength: 1, chainHeadHash: await sha256Hex(serializeManifestV1(m)) }; }
export async function signReleaseManifest(seedHex: string, m: any): Promise<string> { return signChainHeadV3(seedHex, await manifestHead(m), "manifest"); }

// ── verifyManifest: the IMPORT-side check Node B runs. THROWS att_* on failure; updates version HWM on accept. ──
export async function verifyManifest(ctx: any, manifestId: string, sourceNodeId: string): Promise<{ manifestId: string; version: number; gitSHA: string; bundleHash: string }> {
  const row = await ctx.db.query("aukora_release_manifests").withIndex("by_manifestId", (q: any) => q.eq("manifestId", manifestId)).first();
  if (!row) throw new Error("att_unknown_manifest");                         // not a known/blessed release
  if (row.status === "revoked") throw new Error("att_revoked_manifest");      // release pulled
  if (row.status !== "active") throw new Error("att_manifest_not_active");     // ALLOW-LIST (fail-closed): only "active" accepted — rejects draft/pending/garbage/undefined, not just "revoked"
  const relKey = await ctx.db.query("founder_key_registry").withIndex("by_founder_kid", (q: any) => q.eq("founderUserId", RELEASE_AUTHORITY).eq("keyId", row.releaseKeyId)).first();
  if (!relKey) throw new Error("att_release_key_unknown");
  if (relKey.status === "revoked") throw new Error("att_release_key_revoked");
  if (relKey.status !== "active" && relKey.status !== "retired") throw new Error("att_release_key_invalid"); // ALLOW-LIST: active + retired (retired grandfathers past manifests, Brick 7); rejects garbage
  // Signature covers {manifestId,version,gitSHA,bundleHash,bundleHashAlg} — a tampered gitSHA/bundleHash fails here.
  if (!(await verifyChainHeadV3(relKey.publicKey, await manifestHead(row), row.signature, "manifest"))) throw new Error("att_bad_signature");
  // Version high-water: refuse rollback/downgrade (and stale older-release replay) for this source.
  const hwm = await ctx.db.query("node_manifest_hwm").withIndex("by_node", (q: any) => q.eq("sourceNodeId", sourceNodeId)).first();
  if (hwm && Number(row.version) < Number(hwm.maxVersion)) throw new Error("att_downgraded");
  const now = Date.now();
  if (hwm) { if (Number(row.version) > Number(hwm.maxVersion)) await ctx.db.patch(hwm._id, { maxVersion: row.version, updatedAt: now }); }
  else await ctx.db.insert("node_manifest_hwm", { sourceNodeId, maxVersion: row.version, updatedAt: now });
  return { manifestId, version: row.version, gitSHA: row.gitSHA, bundleHash: row.bundleHash };
}

// ── Seed a release manifest (founder release key signs it). DEMO seed; prod = real release-key custody. ──
export const seedReleaseManifest = internalMutation({
  args: { manifestId: v.string(), version: v.number(), gitSHA: v.string(), bundleHash: v.string(), bundleHashAlg: v.optional(v.string()), releaseKeyId: v.string(), signature: v.string(), status: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const m = { manifestId: a.manifestId, version: a.version, gitSHA: a.gitSHA, bundleHash: a.bundleHash, bundleHashAlg: a.bundleHashAlg ?? "sha256-slice-tarball", createdAt: Date.now(), releaseKeyId: a.releaseKeyId, signature: a.signature, status: a.status ?? "active" };
    const existing = await ctx.db.query("aukora_release_manifests").withIndex("by_manifestId", (q: any) => q.eq("manifestId", a.manifestId)).first();
    if (existing) { await ctx.db.patch(existing._id, m); return { updated: true }; }
    await ctx.db.insert("aukora_release_manifests", m); return { seeded: true };
  },
});
// Tamper a stored manifest's bound fields WITHOUT re-signing (to prove the signature binds gitSHA/bundleHash).
export const tamperManifestField = internalMutation({
  args: { manifestId: v.string(), bundleHash: v.optional(v.string()), gitSHA: v.optional(v.string()), status: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const row = await ctx.db.query("aukora_release_manifests").withIndex("by_manifestId", (q: any) => q.eq("manifestId", a.manifestId)).first();
    if (row) await ctx.db.patch(row._id, { ...(a.bundleHash ? { bundleHash: a.bundleHash } : {}), ...(a.gitSHA ? { gitSHA: a.gitSHA } : {}), ...(a.status ? { status: a.status } : {}) });
    return { tampered: true };
  },
});
// The import-side gated check as a callable mutation (so the action/tests can drive it). THROWS att_* -> rolls back.
export const attestImport = internalMutation({
  args: { manifestId: v.string(), sourceNodeId: v.string() },
  handler: async (ctx, a): Promise<any> => ({ ok: true, attested: await verifyManifest(ctx, a.manifestId, a.sourceNodeId) }),
});

// ── Live proof: fire the attestation attack matrix (DEMO release key held in this action). ──
const DEMO_RELEASE_SEED = "33".repeat(32), ATTACKER_RELEASE_SEED = "44".repeat(32);
export const runCodeAttestation = action({
  args: { gitSHA: v.optional(v.string()), bundleHash: v.optional(v.string()) },
  handler: async (ctx, a): Promise<any> => {
    const run = crypto.randomUUID().slice(0, 8);
    const gitSHA = a.gitSHA ?? "DEMO_GITSHA_unverified", bundleHash = a.bundleHash ?? "DEMO_BUNDLEHASH_run_compute-bundle-hash.sh";
    const relPub = await mlDsa65PublicKeyFromSeed(DEMO_RELEASE_SEED);
    await ctx.runMutation(internal.popResolver.seedFounderKey, { founderUserId: RELEASE_AUTHORITY, keyId: "rk-1", publicKey: relPub });
    const seed = async (mid: string, version: number, signSeed: string, over: any = {}) => {
      const m = { manifestId: mid, version, gitSHA, bundleHash, bundleHashAlg: "sha256-slice-tarball", releaseKeyId: "rk-1", ...over };
      const signature = await signReleaseManifest(signSeed, m);
      await ctx.runMutation(internal.codeAttestation.seedReleaseManifest, { ...m, signature, status: over.status });
    };
    const fire = async (label: string, manifestId: string, sourceNodeId: string) => {
      try { await ctx.runMutation(internal.codeAttestation.attestImport, { manifestId, sourceNodeId }); return { label, outcome: "ALLOWED" }; }
      catch (e: any) { return { label, outcome: "refused", reason: String(e?.message ?? e).match(/att_[a-z_]+/)?.[0] ?? "err" }; }
    };
    const results: any[] = [];
    // 1 happy (blessed manifest, fresh source)
    await seed(`rel-ok-${run}`, 1, DEMO_RELEASE_SEED);
    results.push(await fire("1_valid_blessed_manifest", `rel-ok-${run}`, `srcA-${run}`));
    // 2 forged (signed by attacker release key, but claims rk-1)
    await seed(`rel-forge-${run}`, 1, ATTACKER_RELEASE_SEED);
    results.push(await fire("2_forged_signature", `rel-forge-${run}`, `srcB-${run}`));
    // 3 unknown manifestId
    results.push(await fire("3_unknown_manifest", `rel-ghost-${run}`, `srcC-${run}`));
    // 4 gitSHA/bundleHash mismatch (tamper after signing)
    await seed(`rel-mm-${run}`, 1, DEMO_RELEASE_SEED);
    await ctx.runMutation(internal.codeAttestation.tamperManifestField, { manifestId: `rel-mm-${run}`, bundleHash: "TAMPERED_BUNDLE" });
    results.push(await fire("4_gitsha_bundle_mismatch", `rel-mm-${run}`, `srcD-${run}`));
    // 5 rollback/downgrade (v2 then v1 on same source)
    await seed(`rel-v2-${run}`, 2, DEMO_RELEASE_SEED); await seed(`rel-v1-${run}`, 1, DEMO_RELEASE_SEED);
    results.push(await fire("5a_accept_v2", `rel-v2-${run}`, `srcE-${run}`));
    results.push(await fire("5b_rollback_v1", `rel-v1-${run}`, `srcE-${run}`));
    // 6 revoked release (status pulled)
    await seed(`rel-rev-${run}`, 1, DEMO_RELEASE_SEED, { status: "revoked" });
    results.push(await fire("6_revoked_manifest", `rel-rev-${run}`, `srcF-${run}`));
    const LEGIT = new Set(["1_valid_blessed_manifest", "5a_accept_v2"]);
    const happyOk = results.filter((r) => LEGIT.has(r.label)).every((r) => r.outcome === "ALLOWED");
    const allAttacksRefused = results.filter((r) => !LEGIT.has(r.label)).every((r) => r.outcome === "refused");
    return { run, mode: "LIVE_EMPIRICAL", gitSHA, bundleHash, happyOk, allAttacksRefused, results };
  },
});