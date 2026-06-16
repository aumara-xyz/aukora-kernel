// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/**
 * B3.5a — CROSS-NODE PROPAGATION (AUDIT-TRAIL-ONLY; honor-as-record). A node imports a PINNED peer's manifest / mem:
 * receipt / revocation view as a VERIFIABLE RECORD — it grants ZERO local effect authority (the B2.4 conservation law,
 * §1 option 1). The hard invariant: nothing here ever calls resolveManifestAuthority / consumeManifestUseCore /
 * writeReceiptRow, and nothing here ever inserts into aumlok_manifests / aukora_grants / aukora_memory / auma_receipts.
 * Imported foreign manifests keep their OWN signed nodeId verbatim (never rewritten to THIS_NODE), so the resolver's
 * nodeId refusal (aumlokManifests.ts:138) is the backstop even against a future bug.
 *
 * Trust = EXPLICIT PIN only (no TOFU): the peer's root key (headKeyId `root:{rootKeyId}`) and node signing key must be
 * in node_trust_registry, pinned out-of-band. Revocation freshness is pull-origin (§4): a monotone revocation-epoch
 * COUNTER signed by the peer root (clock-free), with B's OWN local clock a secondary cache bound — fail-closed on
 * stale/unknown. Demo/B0-origin records are QUARANTINED (§10). All routes stay behind AUKORA_B3_MESH_ENABLED (OFF).
 */
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { pqcSign, pqcVerify } from "./aukoraPqcSigner";
import { verifyChainHeadV3, verifyChainHeadV4, resolveChainSigningSeed, type ChainHeadFields } from "./aukoraSignedHead";
import { manifestHash, manifestRootHead, manifestPopHead } from "./aumlokManifests";
import { stableStringify } from "./aukoraWitness";
import { buildReceiptChainHash } from "./aukoraCore";
import { receiptPayload } from "./aukoraReceipts";
import { receiptHistoryRootHex } from "./aukoraMerkleLog";
import { isAcceptedVersion } from "./aukoraWireRegistry";
import { resolvePoPSession } from "./popResolver";
import { utf8ToBytes } from "@noble/hashes/utils.js";

const flagOn = (name: string): boolean => ["1", "true", "on", "yes"].includes((process.env[name] ?? "").toLowerCase());

const THIS_NODE_ID = (): string => process.env.AUMA_NODE_ID ?? "aukora-node-a-demo";

// ── FROZEN one-way-door constants (B3.5a) ──
/** The cross-node import envelope surface/version (registered in aukoraWireRegistry; fail-closed on any other). */
export const NODE_IMPORT_SURFACE = "node-import-v1";
/** B's OWN local-clock cache TTL — the SECONDARY freshness bound (counter-gap is primary). B's local risk choice; A
 *  cannot widen it. NOT a trusted global clock (B compares its own now() to its own last-verified-pull stamp). */
export const FRESHNESS_WINDOW_MS = 15 * 60_000;
/** Demo / B0 (aukora_delegations + runMemory) lineage discriminator (§10) — a FROZEN security boundary, not heuristic
 *  drift. The id-regex is anchored to the ACTUAL demo grammar (`demo.{peter,auma,fresh,attacker}.*` / `agent:*`) so a
 *  legit root merely PREFIXED `demo` is not falsely caught; the prefixes cover every demo/B0 chainKey lane. */
const DEMO_LINEAGE_ID_RE = /^(demo\.[a-z]+\.|agent:)/;
const DEMO_LINEAGE_PREFIXES = ["del:", "cer:", "demo:", "hs:", "memchain:", "memdel:"]; // ceremony / demo / handshake / B0 runMemory

/** Canonical signed preimage for a pulled revocation VIEW (the peer ROOT signs this under aukora-node-import-v1). The
 *  `kind` is bound in so a view signature can never be replayed as an import attestation. */
export function serializeRevocationViewV1(view: any): string {
  return "aukora-node-import-v1|" + stableStringify({
    kind: "revocation-view", v: 1,
    sourceNodeId: view.sourceNodeId, rootId: view.rootId, epoch: view.epoch,
    revokedManifestIds: (view.revokedManifestIds ?? []).slice().sort(), timestamp: view.timestamp,
  });
}
/** Canonical preimage for THIS node's import attestation (the domain's real use — an audit record, never authority). */
function serializeImportAttestation(att: any): string {
  return "aukora-node-import-v1|" + stableStringify({
    kind: "import-attestation", v: 1,
    importerNodeId: att.importerNodeId, sourceNodeId: att.sourceNodeId,
    manifestId: att.manifestId, manifestHash: att.manifestHash, epochAtImport: att.epochAtImport, importedAt: att.importedAt,
  });
}

/** Does a record trace to the demo / B0 `aukora_delegations` lane? (§10 quarantine — DEFAULT refuse.) */
export function tracesToDemoLineage(ids: (string | undefined | null)[], proof?: any): boolean {
  for (const id of ids) {
    if (typeof id !== "string") continue;
    if (DEMO_LINEAGE_ID_RE.test(id)) return true;
    if (DEMO_LINEAGE_PREFIXES.some((p) => id.startsWith(p))) return true;
  }
  if (proof && typeof proof === "object") {
    // the aukora_delegations receipt proof shape (ceremony.ts siliconAct) — delegationId + carbonRoot + revocationPointer.
    if (typeof proof.delegationId === "string" && typeof proof.carbonRoot === "string" && typeof proof.revocationPointer === "string") return true;
    // the B0 runMemory proof shape — { memory:true, ..., delegationId }. A REAL AUMLOK memory proof carries `manifestId`
    // (NOT `delegationId`), so a memory proof bearing a delegationId is unambiguously the demo lane.
    if (proof.memory === true && typeof proof.delegationId === "string") return true;
  }
  return false;
}

/** Fail-closed revocation-freshness gate (§4). Unknown view OR stale-by-B's-own-clock → REFUSE (never "probably valid"). */
async function checkRevocationFreshness(ctx: MutationCtx, sourceNodeId: string, rootId: string): Promise<{ ok: true; view: any } | { ok: false; reason: string }> {
  const view = await ctx.db.query("node_revocation_view").withIndex("by_src_root", (q) => q.eq("sourceNodeId", sourceNodeId).eq("rootId", rootId)).first();
  if (!view) return { ok: false, reason: "stale_revocation_view" };               // unknown → fail closed
  if (Date.now() - view.verifiedAtLocal > FRESHNESS_WINDOW_MS) return { ok: false, reason: "stale_revocation_view" };
  return { ok: true, view };
}

/** Does the peer have an OPEN (uncleared) self-verifying-finding import-rejection? (§6 consequence gate.) */
async function peerImportRejected(ctx: MutationCtx, peerNodeId: string): Promise<boolean> {
  const rows = await ctx.db.query("node_peer_consequence").withIndex("by_peer", (q) => q.eq("peerNodeId", peerNodeId)).collect();
  return rows.some((r) => r.state === "import_rejected" && !r.clearedAt);
}

/** §4(A) — record a PULLED, peer-root-signed revocation view. Monotone epoch (no rollback); verified before stored. */
export const recordRevocationView = internalMutation({
  args: { view: v.any() },
  handler: async (ctx, { view }): Promise<any> => {
    if (!view || typeof view !== "object") return { ok: false, reason: "malformed" };
    const { sourceNodeId, rootId, rootKeyId, epoch, revokedManifestIds, timestamp, sig } = view;
    if (typeof sourceNodeId !== "string" || typeof rootId !== "string" || typeof rootKeyId !== "string") return { ok: false, reason: "malformed" };
    if (typeof epoch !== "number" || !Number.isInteger(epoch) || epoch < 0 || typeof sig !== "string") return { ok: false, reason: "malformed" };
    // EXPLICIT PIN (no TOFU): the peer ROOT key (the revocation authority) must already be pinned.
    const pin = await ctx.db.query("node_trust_registry").withIndex("by_src_kid", (q) => q.eq("sourceNodeId", sourceNodeId).eq("headKeyId", `root:${rootKeyId}`)).first();
    if (!pin) return { ok: false, reason: "unpinned_root" };
    if (!(await pqcVerify(pin.publicKey, utf8ToBytes(serializeRevocationViewV1({ sourceNodeId, rootId, epoch, revokedManifestIds, timestamp })), sig, "aukoraNodeImport"))) return { ok: false, reason: "bad_view_sig" };
    const newRevokedJson = JSON.stringify((revokedManifestIds ?? []).slice().sort());
    const existing = await ctx.db.query("node_revocation_view").withIndex("by_src_root", (q) => q.eq("sourceNodeId", sourceNodeId).eq("rootId", rootId)).first();
    if (existing) {
      if (epoch < existing.epoch) return { ok: false, reason: "epoch_regression" }; // monotone counter (no stale rollback)
      // A same-epoch view MUST carry the same revoked set: the origin bumps the counter WHENEVER its revocation set
      // changes, so a same-epoch DIFFERENT set is the origin equivocating on its revocation state — REFUSE (never
      // silently overwrite the prior verified view). Same-epoch identical set is a benign re-pull → refresh the stamp.
      if (epoch === existing.epoch && newRevokedJson !== existing.revokedManifestIdsJson) return { ok: false, reason: "epoch_conflict" };
    }
    const now = Date.now();
    const row = { sourceNodeId, rootId, epoch, revokedManifestIdsJson: newRevokedJson, viewSig: sig, verifiedAtLocal: now, updatedAt: now };
    if (existing) await ctx.db.patch(existing._id, row); else await ctx.db.insert("node_revocation_view", row);
    return { ok: true, epoch };
  },
});

/** §1/§2 — import a foreign MANIFEST as an AUDIT record (honor-as-record). Verifies doubly-signed manifest against the
 *  PINNED root key; stores ZERO-authority. Every refusal returns BEFORE any write (the nodeB.ts fail-closed discipline). */
export const importForeignManifest = internalMutation({
  args: { env: v.any() },
  handler: async (ctx, { env }): Promise<any> => {
    if (!env || typeof env !== "object") return { ok: false, reason: "malformed" };
    if (env.envelopeVersion !== NODE_IMPORT_SURFACE || !isAcceptedVersion(NODE_IMPORT_SURFACE, env.envelopeVersion)) return { ok: false, reason: "envelope_version_refused" };
    const m = env.manifest, sourceNodeId = env.sourceNodeId;
    if (!m || typeof m !== "object" || typeof sourceNodeId !== "string") return { ok: false, reason: "malformed" };
    if (typeof m.manifestId !== "string" || typeof m.rootId !== "string" || typeof m.rootKeyId !== "string" || typeof m.nodeId !== "string") return { ok: false, reason: "malformed" };
    if (typeof m.subjectPubKey !== "string" || typeof m.manifestHash !== "string" || typeof m.rootSig !== "string" || typeof m.subjectPopSig !== "string") return { ok: false, reason: "malformed" };
    // §10 demo/B0 quarantine — refuse anything tracing to the demo lane (DEFAULT refuse).
    if (tracesToDemoLineage([m.manifestId, m.rootId, m.subjectId, m.nodeId])) return { ok: false, reason: "demo_origin_quarantined" };
    // §1 audit-only: a manifest bound to THIS node is the B3.5b cross-node-GRANT case → OUT OF SCOPE for 5a (refuse).
    if (m.nodeId === THIS_NODE_ID()) return { ok: false, reason: "not_foreign" };
    // EXPLICIT PIN (no TOFU): the peer's ROOT key must already be pinned out-of-band.
    const rootPin = await ctx.db.query("node_trust_registry").withIndex("by_src_kid", (q) => q.eq("sourceNodeId", sourceNodeId).eq("headKeyId", `root:${m.rootKeyId}`)).first();
    if (!rootPin) return { ok: false, reason: "unpinned_root" };
    // §6 consequence gate: a peer with an OPEN self-verifying finding is import-rejected until re-pinned.
    if (await peerImportRejected(ctx, sourceNodeId)) return { ok: false, reason: "peer_import_rejected" };
    // doubly-signed manifest: recompute hash, then verify the root sig (vs PINNED root) + subject PoP (vs carried pubkey).
    if ((await manifestHash(m)) !== m.manifestHash) return { ok: false, reason: "forged_manifest" };
    if (!(await verifyChainHeadV3(rootPin.publicKey, await manifestRootHead(m), m.rootSig, "aumlokManifest"))) return { ok: false, reason: "bad_root_sig" };
    if (!(await verifyChainHeadV3(m.subjectPubKey, await manifestPopHead(m), m.subjectPopSig, "aumlokSubjectPop"))) return { ok: false, reason: "bad_subject_pop" };
    // §4 freshness gate (fail-closed on stale/unknown revocation view).
    const fr = await checkRevocationFreshness(ctx, sourceNodeId, m.rootId);
    if (!fr.ok) return { ok: false, reason: fr.reason };
    // dedup (immutable-once-imported per (sourceNodeId, manifestId)).
    if (await ctx.db.query("node_foreign_manifests").withIndex("by_src_mft", (q) => q.eq("sourceNodeId", sourceNodeId).eq("manifestId", m.manifestId)).first()) return { ok: false, reason: "duplicate" };
    const revoked: string[] = JSON.parse(fr.view.revokedManifestIdsJson || "[]");
    const lastLifecycleStatus = revoked.includes(m.manifestId) ? "revoked" : "active";
    const importedAt = Date.now();
    // the domain's real use: THIS node attests it verified-and-recorded the foreign manifest (best-effort; "" if no seed).
    const seed = resolveChainSigningSeed();
    const attestationSig = seed ? await pqcSign(seed, utf8ToBytes(serializeImportAttestation({ importerNodeId: THIS_NODE_ID(), sourceNodeId, manifestId: m.manifestId, manifestHash: m.manifestHash, epochAtImport: fr.view.epoch, importedAt })), "aukoraNodeImport") : "";
    await ctx.db.insert("node_foreign_manifests", {
      sourceNodeId, manifestId: m.manifestId, rootId: m.rootId, rootKeyId: m.rootKeyId,
      foreignNodeId: m.nodeId, // VERBATIM — never rewritten to THIS_NODE (the resolver :138 refusal is the backstop)
      subjectId: m.subjectId, subjectKind: m.subjectKind, subjectPubKey: m.subjectPubKey,
      manifestHash: m.manifestHash, rootSig: m.rootSig, subjectPopSig: m.subjectPopSig,
      lastLifecycleStatus, epochAtImport: fr.view.epoch, attestationSig, importedAt,
    });
    return { ok: true, manifestId: m.manifestId, lastLifecycleStatus, foreignNodeId: m.nodeId };
  },
});

/** §3 — import a foreign mem: receipt as an AUDIT record. Verify-receipt-before-accept; NEVER writes aukora_memory. */
export const importForeignMemory = internalMutation({
  args: { env: v.any() },
  handler: async (ctx, { env }): Promise<any> => {
    if (!env || typeof env !== "object") return { ok: false, reason: "malformed" };
    if (env.envelopeVersion !== NODE_IMPORT_SURFACE || !isAcceptedVersion(NODE_IMPORT_SURFACE, env.envelopeVersion)) return { ok: false, reason: "envelope_version_refused" };
    const { sourceNodeId, headKeyId, chainKey, receipt, head } = env;
    if (typeof sourceNodeId !== "string" || typeof headKeyId !== "string" || typeof chainKey !== "string" || !receipt || !head) return { ok: false, reason: "malformed" };
    // EXPLICIT PIN (no TOFU): the peer NODE signing key must already be pinned.
    const pin = await ctx.db.query("node_trust_registry").withIndex("by_src_kid", (q) => q.eq("sourceNodeId", sourceNodeId).eq("headKeyId", headKeyId)).first();
    if (!pin) return { ok: false, reason: "unpinned_peer" };
    if (await peerImportRejected(ctx, sourceNodeId)) return { ok: false, reason: "peer_import_rejected" };
    // verify the receipt: V4 head sig (binds the receipt-history root) + chain recompute (NO-ORPHAN → the home node ran
    // the full manifest→grant→token→receipt chain). Mirrors nodeB.importEnvelope.
    const hf: ChainHeadFields = { chainKey, timestamp: head.headSignedAt, chainLength: head.count, chainHeadHash: head.lastChainHash };
    if (!head.headSig || !(await verifyChainHeadV4(pin.publicKey, hf, head.receiptLogRoot, head.headSig, "chainHead"))) return { ok: false, reason: "bad_signature" };
    if (head.count !== 1 || (receipt.prevHash !== undefined && receipt.prevHash !== null)) return { ok: false, reason: "not_fresh_chain" };
    if (head.lastChainHash !== receipt.chainHash) return { ok: false, reason: "head_mismatch" };
    const payload = receiptPayload({ chainKey, receiptId: receipt.receiptId, ts: receipt.ts, actorModel: receipt.actorModel, lane: receipt.lane, goal: receipt.goal, risk: receipt.risk, grade: receipt.grade, verdict: receipt.verdict, actionsJson: receipt.actionsJson, proofJson: receipt.proofJson, threadId: receipt.threadId, notes: receipt.notes });
    if ((await buildReceiptChainHash(payload, receipt.prevHash ?? null)) !== receipt.chainHash) return { ok: false, reason: "forged_receipt" };
    if (receiptHistoryRootHex([receipt.chainHash]) !== head.receiptLogRoot) return { ok: false, reason: "log_root_mismatch" };
    let proof: any; try { proof = JSON.parse(receipt.proofJson || ""); } catch { return { ok: false, reason: "malformed_proof" }; }
    // §10 quarantine (demo grammars/prefixes OR the aukora_delegations proof shape).
    if (tracesToDemoLineage([chainKey, proof?.rootId, proof?.subjectId, proof?.manifestId], proof)) return { ok: false, reason: "demo_origin_quarantined" };
    if (proof?.memory !== true || typeof proof.manifestId !== "string" || typeof proof.rootId !== "string") return { ok: false, reason: "not_memory_receipt" };
    if (!chainKey.startsWith(`mem:${proof.rootId}:`)) return { ok: false, reason: "bad_mem_chainkey" };
    const key = chainKey.slice(`mem:${proof.rootId}:`.length);
    // the referenced foreign manifest must already be imported (verify-before-accept).
    const fm = await ctx.db.query("node_foreign_manifests").withIndex("by_src_mft", (q) => q.eq("sourceNodeId", sourceNodeId).eq("manifestId", proof.manifestId)).first();
    if (!fm) return { ok: false, reason: "manifest_not_imported" };
    // §4 freshness gate, then check the FRESH view's revoked set (not the manifest-import snapshot).
    const fr = await checkRevocationFreshness(ctx, sourceNodeId, proof.rootId);
    if (!fr.ok) return { ok: false, reason: fr.reason };
    if ((JSON.parse(fr.view.revokedManifestIdsJson || "[]") as string[]).includes(proof.manifestId)) return { ok: false, reason: "manifest_revoked" };
    if (await ctx.db.query("node_foreign_memory").withIndex("by_src_hash", (q) => q.eq("sourceNodeId", sourceNodeId).eq("receiptHash", receipt.chainHash)).first()) return { ok: false, reason: "duplicate" };
    await ctx.db.insert("node_foreign_memory", { sourceNodeId, ownerRootId: proof.rootId, key, manifestId: proof.manifestId, receiptHash: receipt.chainHash, memoryHash: typeof proof.memoryHash === "string" ? proof.memoryHash : "", importedAt: Date.now() });
    return { ok: true, ownerRootId: proof.rootId, key, manifestId: proof.manifestId };
  },
});

/** §2 import-attestation preimage helper — re-used by promote to verify the manifest's two signatures vs the pinned root. */
// (manifestRootHead / manifestPopHead / verifyChainHeadV3 are imported above.)

/** Db7 — PROMOTE a foreign manifest (one A's root signed FOR this node) into the ISOLATED `node_cross_grants` EFFECT
 *  surface. Deliberate, flag-gated (AUKORA_B3_CROSSGRANT_ENABLED, default OFF) + operator-PoP-gated (Db9). Verifies the
 *  doubly-signed manifest against the rootId-BOUND pinned foreign root, refuses manifestId collisions, and records
 *  promotion metadata. NO auto-promotion (import never inserts here). The resolver reads node_cross_grants but NEVER
 *  node_foreign_manifests, so this is the ONLY door from a foreign manifest to live effect authority. */
export const promoteCrossGrant = internalMutation({
  args: { env: v.any(), promotionEnv: v.any() },
  handler: async (ctx, { env, promotionEnv }): Promise<any> => {
    if (!flagOn("AUKORA_B3_CROSSGRANT_ENABLED")) return { ok: false, reason: "crossgrant_disabled" }; // gate OFF by default
    if (!env || typeof env !== "object") return { ok: false, reason: "malformed" };
    const m = env.manifest, sourceNodeId = env.sourceNodeId;
    if (!m || typeof m !== "object" || typeof sourceNodeId !== "string") return { ok: false, reason: "malformed" };
    if (typeof m.manifestId !== "string" || typeof m.rootId !== "string" || typeof m.rootKeyId !== "string" || typeof m.nodeId !== "string") return { ok: false, reason: "malformed" };
    if (typeof m.subjectPubKey !== "string" || typeof m.manifestHash !== "string" || typeof m.rootSig !== "string" || typeof m.subjectPopSig !== "string") return { ok: false, reason: "malformed" };
    // Db7 — operator/root PoP over { sourceNodeId, manifestId, manifestHash } (binds the promotion to THIS manifest).
    // Called EXACTLY ONCE (it claims a single-use nonce); the session is captured for the promotion metadata below.
    const session = await resolvePoPSession(ctx, promotionEnv, "promoteCrossGrant", { sourceNodeId, manifestId: m.manifestId, manifestHash: m.manifestHash }, THIS_NODE_ID());
    // §10 demo/B0 quarantine — a demo-lane manifest is never promotable to authority.
    if (tracesToDemoLineage([m.manifestId, m.rootId, m.subjectId, m.nodeId])) return { ok: false, reason: "demo_origin_quarantined" };
    // a cross-grant is a manifest A signed FOR THIS node (nodeId == THIS) — the resolver's node_mismatch gate then accepts it.
    if (m.nodeId !== THIS_NODE_ID()) return { ok: false, reason: "not_this_node" };
    // the rootId must be FOREIGN (absent from aumlok_root_keys entirely) — a local rootId is local authority, not a cross-grant.
    if (await ctx.db.query("aumlok_root_keys").withIndex("by_root", (q) => q.eq("rootId", m.rootId)).first()) return { ok: false, reason: "rootid_is_local" };
    // the rootId-BOUND pinned foreign root must exist (no rootId-bound pin → no authority).
    const pin = await ctx.db.query("node_trust_registry").withIndex("by_src_root_kid", (q) => q.eq("sourceNodeId", sourceNodeId).eq("rootId", m.rootId).eq("headKeyId", `root:${m.rootKeyId}`)).first();
    if (!pin || pin.rootId !== m.rootId) return { ok: false, reason: "unpinned_foreign_root" };
    // re-verify the doubly-signed manifest against the PINNED key (don't trust the envelope blindly).
    if ((await manifestHash(m)) !== m.manifestHash) return { ok: false, reason: "forged_manifest" };
    if (!(await verifyChainHeadV3(pin.publicKey, await manifestRootHead(m), m.rootSig, "aumlokManifest"))) return { ok: false, reason: "bad_root_sig" };
    if (!(await verifyChainHeadV3(m.subjectPubKey, await manifestPopHead(m), m.subjectPopSig, "aumlokSubjectPop"))) return { ok: false, reason: "bad_subject_pop" };
    // manifestId collisions: local authority takes deterministic precedence; an existing cross-grant is immutable.
    if (await ctx.db.query("aumlok_manifests").withIndex("by_manifestId", (q) => q.eq("manifestId", m.manifestId)).first()) return { ok: false, reason: "collision_local_authority" };
    if (await ctx.db.query("node_cross_grants").withIndex("by_manifestId", (q) => q.eq("manifestId", m.manifestId)).first()) return { ok: false, reason: "already_promoted" };
    const now = Date.now();
    await ctx.db.insert("node_cross_grants", {
      manifestId: m.manifestId, sourceNodeId, rootId: m.rootId, rootKeyId: m.rootKeyId, nodeId: m.nodeId,
      subjectId: m.subjectId, subjectKind: m.subjectKind, subjectPubKey: m.subjectPubKey, subjectFingerprint: m.subjectFingerprint ?? "",
      permissionsJson: typeof m.permissionsJson === "string" ? m.permissionsJson : JSON.stringify(m.permissions ?? []),
      allowedIntentCodecsJson: typeof m.allowedIntentCodecsJson === "string" ? m.allowedIntentCodecsJson : JSON.stringify(m.allowedIntentCodecs ?? []),
      notBefore: Number(m.notBefore), expiresAt: Number(m.expiresAt),
      maxUses: m.maxUses ?? undefined, maxPerWindowJson: m.maxPerWindow ? JSON.stringify(m.maxPerWindow) : undefined,
      usedCount: 0, status: "active",
      manifestHash: m.manifestHash, rootSig: m.rootSig, subjectPopSig: m.subjectPopSig,
      promotedBy: session.principalId, promotedByKeyId: session.keyId ?? "op-1", promotedAt: now, createdAt: now,
    });
    return { ok: true, manifestId: m.manifestId, sourceNodeId, rootId: m.rootId };
  },
});

// ── Read-only views (evidence / tests). No authority; never gate anything. ──
export const foreignManifest = internalQuery({ args: { sourceNodeId: v.string(), manifestId: v.string() }, handler: async (ctx, a) => ctx.db.query("node_foreign_manifests").withIndex("by_src_mft", (q) => q.eq("sourceNodeId", a.sourceNodeId).eq("manifestId", a.manifestId)).first() });
export const crossGrant = internalQuery({ args: { manifestId: v.string() }, handler: async (ctx, a) => ctx.db.query("node_cross_grants").withIndex("by_manifestId", (q) => q.eq("manifestId", a.manifestId)).first() });
export const revocationView = internalQuery({ args: { sourceNodeId: v.string(), rootId: v.string() }, handler: async (ctx, a) => ctx.db.query("node_revocation_view").withIndex("by_src_root", (q) => q.eq("sourceNodeId", a.sourceNodeId).eq("rootId", a.rootId)).first() });
