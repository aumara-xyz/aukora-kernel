// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/**
 * B3.2 — NODE FACTORY. `initNode` STAMPS a node identity: a deterministic, re-derivable, byte-identical commitment
 * over the canonical node config. The same config → the same `stampHash`, so a second node stamped from the same
 * source produces an identical stamp (the lab foundation for cross-node pinning, B3.5 — NOT wired here).
 *
 * Secrets discipline: the node SIGNING key (`AUKORA_CHAIN_SIGNING_SEED`) is PLATFORM/env-custodied and NEVER persisted
 * — the stamp stores only its public FINGERPRINT. The `tier` is "lab" / "dev" ONLY — "production" is refused (claim
 * discipline; no production / HSM / self-host custody claim). Identity is stamped ONCE per nodeId (immutable).
 *
 * This is NOT cross-node networking (B3.5), NOT a witness mesh (B3.3), NOT ML-KEM (B3.4). It touches no authority path:
 * the B2.4 manifest→grant→token→receipt law is unchanged, and the B0 `aukora_delegations` lane is not resurrected.
 */
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { stableStringify, sha256Hex } from "./aukoraCore";
import { mlDsa65PublicKeyFromSeed } from "./aukoraPqcSigner";
import { resolveChainSigningSeed } from "./aukoraSignedHead";

const THIS_NODE_ID = (): string => process.env.AUMA_NODE_ID ?? "aukora-node-a-demo";
const NODE_TIERS = Object.freeze(["lab", "dev"] as const); // "production" is deliberately NOT a stampable tier
const LABEL_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/; // deployment label grammar (bounded, no exotic chars)
const FP_RE = /^[0-9a-f]{64}$/;                 // a root-pin fingerprint = 64 hex (sha256)

export type NodeStampConfig = { nodeId: string; deploymentLabel: string; tier: string; signingKeyFingerprint: string; rootPins: string[] };

/** The canonical, sorted commitment object — the ONLY bytes the stamp hash covers (deterministic across nodes). */
export function canonicalNodeStamp(c: NodeStampConfig) {
  return { v: 1, nodeId: c.nodeId, deploymentLabel: c.deploymentLabel, tier: c.tier, signingKeyFingerprint: c.signingKeyFingerprint, rootPins: [...c.rootPins].sort() };
}
/** Deterministic byte-identity stamp hash. Same config → same hash; any tampered field → a different hash. */
export async function nodeStampHash(c: NodeStampConfig): Promise<string> {
  return sha256Hex("aukora-node-stamp-v1|" + stableStringify(canonicalNodeStamp(c)));
}

/** This deployment's node signing-key FINGERPRINT (sha256 of the ML-DSA-65 public key derived from the env seed). The
 *  seed itself is never returned or stored. THROWS if no signing seed is configured (a node must be able to sign). */
async function nodeSigningKeyFingerprint(): Promise<string> {
  const seed = resolveChainSigningSeed();
  if (!seed) throw new Error("aukora_node_no_signing_key");
  return sha256Hex(await mlDsa65PublicKeyFromSeed(seed));
}

function normalizeRootPins(x: unknown): string[] {
  if (x == null) return [];
  if (!Array.isArray(x)) throw new Error("aukora_node_rootpins_invalid");
  const out = new Set<string>();
  for (const p of x) { if (typeof p !== "string" || !FP_RE.test(p)) throw new Error("aukora_node_rootpin_invalid"); out.add(p); }
  return [...out].sort();
}

/** STAMP this deployment's node identity. Idempotent: re-stamping with the SAME config returns the existing stamp; a
 *  DIFFERENT config for the same nodeId is REFUSED (`aukora_node_already_stamped` — identity is immutable). */
export const initNode = mutation({
  args: { deploymentLabel: v.string(), tier: v.string(), rootPins: v.optional(v.array(v.string())) },
  handler: async (ctx, a): Promise<any> => {
    if (typeof a.deploymentLabel !== "string" || !LABEL_RE.test(a.deploymentLabel)) throw new Error("aukora_node_label_invalid");
    if (!(NODE_TIERS as readonly string[]).includes(a.tier)) throw new Error("aukora_node_tier_invalid"); // refuses "production"
    const nodeId = THIS_NODE_ID();
    const signingKeyFingerprint = await nodeSigningKeyFingerprint();
    const rootPins = normalizeRootPins(a.rootPins);
    const cfg: NodeStampConfig = { nodeId, deploymentLabel: a.deploymentLabel, tier: a.tier, signingKeyFingerprint, rootPins };
    const stampHash = await nodeStampHash(cfg);

    const existing = await ctx.db.query("aukora_node_identity").withIndex("by_nodeId", (q) => q.eq("nodeId", nodeId)).first();
    if (existing) {
      if (existing.stampHash === stampHash) return { ok: true, stamped: false, nodeId, tier: a.tier, stampHash, signingKeyFingerprint }; // idempotent re-stamp
      throw new Error("aukora_node_already_stamped"); // a different config can never overwrite a stamped identity
    }
    await ctx.db.insert("aukora_node_identity", { nodeId, deploymentLabel: a.deploymentLabel, tier: a.tier, signingKeyFingerprint, rootPinsJson: JSON.stringify(rootPins), stampHash, status: "active", stampedAt: Date.now() });
    return { ok: true, stamped: true, nodeId, tier: a.tier, stampHash, signingKeyFingerprint };
  },
});

/** Read this deployment's node stamp (public material only). */
export const nodeIdentity = query({
  args: {},
  handler: async (ctx): Promise<any> => {
    const row = await ctx.db.query("aukora_node_identity").withIndex("by_nodeId", (q) => q.eq("nodeId", THIS_NODE_ID())).first();
    if (!row) return { ok: false, reason: "not_stamped" };
    return { ok: true, nodeId: row.nodeId, deploymentLabel: row.deploymentLabel, tier: row.tier, signingKeyFingerprint: row.signingKeyFingerprint, rootPins: JSON.parse(row.rootPinsJson), stampHash: row.stampHash, stampedAt: row.stampedAt };
  },
});

/** BYTE-IDENTITY verification: recompute the stamp hash from a stored row's fields and confirm it matches — a tampered
 *  row (any field edited) fails. Returns false, never throws. */
export async function verifyNodeStamp(row: { nodeId: string; deploymentLabel: string; tier: string; signingKeyFingerprint: string; rootPinsJson: string; stampHash: string }): Promise<boolean> {
  try {
    const recomputed = await nodeStampHash({ nodeId: row.nodeId, deploymentLabel: row.deploymentLabel, tier: row.tier, signingKeyFingerprint: row.signingKeyFingerprint, rootPins: JSON.parse(row.rootPinsJson) });
    return recomputed === row.stampHash;
  } catch { return false; }
}
