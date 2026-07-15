// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// PRE-EXISTING CONTRACT (kept verbatim per Brick S1a rule 6 — merged, not clobbered):
//
// Convex durable table sketch for Kira.
// This is intentionally kept as a small contract until the live Convex deployment is wired.
// Source of truth for the running seed-native brain: core/src/kiraBrain.ts.
//
// Intended tables:
// - kira_receipts: append-only receipt chain
// - kira_atoms: public/advisory memory atoms
// - kira_head: public head / high-water summary
//
// Hard law: every row carries advisoryOnly:true and grantsAuthority:false.
// Convex persistence does not grant authority.

export const KIRA_CONVEX_TABLES = {
  receipts: 'kira_receipts',
  atoms: 'kira_atoms',
  head: 'kira_head',
} as const;

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// VENDORED from aukora-os/node-template/convex@b399db1 on 2026-07-05 (Brick S1a, Option A — owner-ratified). Changes from donor are marked S1a:.
//
// S1a: this schema vendors ONLY the tables the vendored kernel modules actually touch (field definitions
// copied EXACTLY from the donor schema; ALL donor indexes preserved). The kira_* tables above remain a
// CONTRACT (they land as real tables in the M2 memory-safety brick, not here). Deviations from the task's
// nominal table list, each deliberate:
//   - node_revocations ADDED: popResolver.resolvePoPSession step 4 + revokePopCap read/write it.
//   - aumlok_ceremonies OMITTED: aumlokCeremony.ts is not vendored and no vendored module touches it
//     (task said "if touched" — it is not).
//   - node_sessions OMITTED: the donor demo-session table; the sessionResolver rewrite resolves the owner
//     from founder_key_registry instead (demo lane removed).
//   - node_cross_grants / node_trust_registry / node_revocation_view ADDED EMPTY: aumlokManifests'
//     cross-grant resolution path (aumlokManifests.ts:143-181) queries exactly these three; empty tables
//     keep the vendored code faithful while multi-node stays parked.
//   - aukora_node_identity + ide_memory: vendored per the S1a schema list (ide_memory keeps its 384-d
//     vectorIndex); no vendored module queries them yet — they are landing zones for W3/R5.
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // ── Aukora kernel spine ──
  aukora_intent_logs: defineTable({
    logId: v.string(),
    stateKey: v.string(),
    intentId: v.string(),
    ring: v.union(v.literal("observe"), v.literal("local-write"), v.literal("external"), v.literal("self-modify")),
    action: v.optional(v.string()),
    resource: v.optional(v.string()),
    claim: v.string(),
    status: v.union(v.literal("accepted"), v.literal("downgraded"), v.literal("refused"), v.literal("halted")),
    acceptedClaim: v.string(),
    errorCode: v.optional(v.string()),
    message: v.string(),
    proofRefs: v.array(v.string()),
    requiresAuthorization: v.boolean(),
    authorizationGranted: v.boolean(),
    authorizationRef: v.optional(v.string()),
    humanClearance: v.boolean(),
    clearanceRef: v.optional(v.string()),
    triggerSalama: v.boolean(),
    clearSalama: v.boolean(),
    prevHash: v.optional(v.string()),
    hash: v.string(),
    nonce: v.optional(v.string()),
    executionStatus: v.optional(v.union(v.literal("allowed"), v.literal("blocked"))),
    tokenConsumedAt: v.optional(v.number()),
    tokenConsumedAction: v.optional(v.string()),
    tokenConsumedResource: v.optional(v.string()),
    actorId: v.string(),
    actorRole: v.union(v.literal("operator"), v.literal("system"), v.literal("test")),
    tsIso: v.string(),
    ts: v.number(),
  })
    .index("by_logId", ["logId"])
    .index("by_ts", ["ts"])
    .index("by_state_ts", ["stateKey", "ts"])
    .index("by_actor_ts", ["actorId", "ts"])
    .index("by_status_ts", ["status", "ts"]),

  aukora_runtime_state: defineTable({
    stateKey: v.string(),
    salamaActive: v.boolean(),
    salamaReason: v.optional(v.union(v.string(), v.null())),
    lastHash: v.optional(v.string()),
    lastLogId: v.optional(v.string()),
    killSwitch: v.optional(v.boolean()),
    updatedBy: v.string(),
    updatedAt: v.number(),
    createdAt: v.number(),
  }).index("by_stateKey", ["stateKey"]),

  aukora_grants: defineTable({
    grantKey: v.string(),
    status: v.union(v.literal("active"), v.literal("revoked"), v.literal("expired"), v.literal("used")),
    actorId: v.string(),
    actorRole: v.union(v.literal("operator"), v.literal("system"), v.literal("test")),
    ring: v.union(v.literal("observe"), v.literal("local-write"), v.literal("external"), v.literal("self-modify")),
    action: v.optional(v.string()),
    resource: v.optional(v.string()),
    reason: v.optional(v.string()),
    proofRef: v.optional(v.string()),
    issuedBy: v.string(),
    issuedAt: v.number(),
    expiresAt: v.number(),
    maxUses: v.optional(v.number()),
    usedCount: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
    revokedBy: v.optional(v.string()),
    revokedAt: v.optional(v.number()),
    revokeReason: v.optional(v.string()),
    updatedAt: v.number(),
    // B3.5b: AUDIT-ONLY issuer tag (NO check ever branches on these) — "local" | "foreign", + the foreign source node.
    issuer: v.optional(v.string()),
    issuerSourceNodeId: v.optional(v.string()),
  })
    .index("by_grantKey", ["grantKey"])
    .index("by_actor_status", ["actorId", "status"])
    .index("by_status_expiresAt", ["status", "expiresAt"]),

  aukora_rate_limits: defineTable({
    bucketKey: v.string(),
    tokens: v.number(),
    updatedAt: v.number(),
  }).index("by_bucketKey", ["bucketKey"]),

  // ── Receipt spine (V4-signed heads, RFC 6962 roots, rollback high-water) ──
  auma_receipt_chain_head: defineTable({
    key: v.string(),
    lastChainHash: v.string(),
    count: v.number(),
    updatedAt: v.number(),
    headSig: v.optional(v.string()),
    headSigAlg: v.optional(v.string()),
    headSignedAt: v.optional(v.number()),
    receiptLogRoot: v.optional(v.string()), // B1.5b2: RFC 6962 append-only history root over the chain's receipt leaves, bound into the V4 signed head
  }).index("by_key", ["key"]),

  auma_chain_high_water: defineTable({
    chainKey: v.string(),
    maxCount: v.number(),
    headHash: v.string(),
    signedAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_chainKey", ["chainKey"]),

  auma_receipts: defineTable({
    receiptId: v.string(),
    ts: v.number(),
    actorModel: v.string(),
    lane: v.union(v.literal("local"), v.literal("hosted"), v.literal("hybrid")),
    goal: v.string(),
    risk: v.union(v.literal("critical"), v.literal("high"), v.literal("medium"), v.literal("low")),
    grade: v.union(v.literal("A"), v.literal("B"), v.literal("C"), v.literal("F")),
    verdict: v.union(v.literal("kept"), v.literal("warning"), v.literal("failed"), v.literal("reverted")),
    actionsJson: v.string(),
    proofJson: v.string(),
    chainKey: v.optional(v.string()),
    prevHash: v.optional(v.string()),
    chainHash: v.optional(v.string()),
    seq: v.optional(v.number()), // B1.5b2: 1-based append position (= head.count at write). The Merkle log orders leaves by seq — append order, independent of any wall clock.
    threadId: v.optional(v.string()),
    notes: v.optional(v.string()),
  })
    .index("by_receiptId", ["receiptId"])
    .index("by_ts", ["ts"])
    .index("by_chainKey_ts", ["chainKey", "ts"]),

  // ── AUMLOK identity + delegation ──
  // Brick 6/7 — AUMLOK proof-of-possession resolver. Pinned founder PUBLIC keys (never private; never from the blob).
  // status: "active" (issue+verify) | "retired" (verify caps issued before retiredAt; CANNOT issue new) | "revoked" (dead).
  founder_key_registry: defineTable({ founderUserId: v.string(), keyId: v.string(), publicKey: v.string(), status: v.string(), pinnedAt: v.number(), retiredAt: v.optional(v.number()) })
    .index("by_founder_kid", ["founderUserId", "keyId"]),
  // B2.1 — AUMLOK identity ROOT-key registry. Pinned ML-DSA-65 root PUBLIC keys ONLY (never seeds/phrases).
  aumlok_root_keys: defineTable({ rootId: v.string(), keyId: v.string(), publicKey: v.string(), fingerprint: v.string(), status: v.string(), pinnedAt: v.number(), retiredAt: v.optional(v.number()) })
    .index("by_root_kid", ["rootId", "keyId"])
    .index("by_root", ["rootId"])
    .index("by_fingerprint", ["fingerprint"]), // global pubkey uniqueness: one root key = one root identity (no cross-root sharing)
  // B2.2 — AUMLOK delegation MANIFESTS (doubly-signed root→subject delegation; every signed field enforced).
  aumlok_manifests: defineTable({
    manifestId: v.string(), rootId: v.string(), rootKeyId: v.string(), nodeId: v.string(), // nodeId is signed: anti cross-node lift (B3)
    subjectId: v.string(), subjectKind: v.string(), subjectPubKey: v.string(), subjectFingerprint: v.string(),
    permissionsJson: v.string(), allowedIntentCodecsJson: v.string(),
    notBefore: v.number(), expiresAt: v.number(),
    maxUses: v.optional(v.number()), maxPerWindowJson: v.optional(v.string()),
    usedCount: v.number(), status: v.string(),
    manifestHash: v.string(), rootSig: v.string(), subjectPopSig: v.string(), createdAt: v.number(),
    revokedAt: v.optional(v.number()), revokedBy: v.optional(v.string()), pausedAt: v.optional(v.number()),
  })
    .index("by_manifestId", ["manifestId"])
    .index("by_subject", ["subjectId"])
    .index("by_root", ["rootId"])
    .index("by_subject_fingerprint", ["subjectFingerprint"]),
  // Single-use request nonces (replay defense). keyId = audit: which key authorized.
  pop_nonce_registry: defineTable({ nodeId: v.string(), founderUserId: v.string(), keyId: v.optional(v.string()), capId: v.string(), nonce: v.string(), methodId: v.string(), argsHash: v.string(), consumedAt: v.number(), expiresAt: v.number() })
    .index("by_node_nonce", ["nodeId", "nonce"]),

  // ── Governed memory effect tables ──
  // Aukora Memory: a private memory row owned by a root, written by a subject under delegation, coupled to a
  // governed receipt.
  aukora_memory: defineTable({
    ownerRootId: v.string(), writerPrincipalId: v.string(), readerScope: v.string(), delegationId: v.string(),
    receiptHash: v.string(), memoryHash: v.string(), sourceNodeId: v.string(), visibility: v.string(),
    key: v.string(), value: v.string(), deletedAt: v.optional(v.number()),
    // M2: quarantine containment marks (ONE_BRAIN Brick 0d ported) — optional, so existing rows stay valid.
    // Set ONLY by the evidence-gated aumlokMemoryQuarantine; recall refuses quarantined rows; verify counts them.
    quarantined: v.optional(v.boolean()), quarantinedAt: v.optional(v.number()), quarantineReason: v.optional(v.string()),
    // M2b (owner-ratified, GH #103): erasure marks — the row REMAINS as a COUNTABLE STUB (Auma's condition:
    // never an invisible hole). value is scrubbed to ""; memoryHash/receiptHash keep the original binding
    // (disclosed oracle limit — the immutable ingest receipt holds them anyway); erasureReceiptHash binds the
    // stub to its owner-signed erasure receipt on the same mem: chain.
    erased: v.optional(v.boolean()), erasedAt: v.optional(v.number()), eraseReason: v.optional(v.string()),
    erasureReceiptHash: v.optional(v.string()),
    // R5c CONTENDER (Great Merge round 3, #178): OPTIONAL semantic vector (384-d, the vendored
    // LOCAL embedder — zero egress). DERIVED + REBUILDABLE index data, deliberately OUTSIDE the
    // integrity chain (memoryHash binds owner:key:value only). Written optionally at
    // aumlokMemoryWrite or by the absent-only owner-signed backfill; erased stubs never carry or
    // regrow one. Additive — existing rows stay valid.
    embedding: v.optional(v.array(v.float64())),
  }).index("by_owner_key", ["ownerRootId", "key"]).index("by_owner", ["ownerRootId"])
    // R5b CANDIDATE (2026-07-07): full-text index over the stored value, owner-scoped. Read-only
    // surface for aumlokMemorySearch (owner-root PoP required; KEYS ONLY in results). Additive —
    // deploy backfills it; no existing row changes shape. Live recall is NOT cut over; the lanes
    // still serve from Kira JSON until this candidate beats the R5b benchmark and an explicit
    // owner-reviewed cutover brick lands (docs/R5_RECALL_STATUS.md).
    .searchIndex("search_value", { searchField: "value", filterFields: ["ownerRootId"] })
    // R5c: vector index over the optional embedding, owner-scoped — read ONLY by the PoP-gated
    // aumlokMemoryVectorSearch action (KEYS ONLY results). Benchmark contender surface; no lane
    // calls it; ranking cutover stays an owner-reviewed brick on a winning report.
    .vectorIndex("by_owner_embedding", { vectorField: "embedding", dimensions: 384, filterFields: ["ownerRootId"] }),

  // 24Z.74-R — IDE MEMORY (durable cross-session memory on the local kernel). NEVER a secret store.
  ide_memory: defineTable({
    ownerRootId: v.string(), key: v.string(), value: v.string(),
    episodeText: v.optional(v.string()), receiptHash: v.string(), contentHash: v.string(),
    createdAt: v.number(), authoritySource: v.optional(v.string()), paladinToken: v.optional(v.string()),
    embedding: v.optional(v.array(v.float64())), // 24Z.85 — semantic vector (384-d, LOCAL embedder); optional → backwards-compatible
  }).index("by_owner_key", ["ownerRootId", "key"]).index("by_owner", ["ownerRootId"])
    .vectorIndex("by_owner_embedding", { vectorField: "embedding", dimensions: 384, filterFields: ["ownerRootId"] }),

  // B3.2 — Node factory: a STAMPED node identity (PUBLIC material only; the seed stays env-custodied).
  aukora_node_identity: defineTable({
    nodeId: v.string(), deploymentLabel: v.string(), tier: v.string(),
    signingKeyFingerprint: v.string(), rootPinsJson: v.string(), stampHash: v.string(),
    status: v.string(), stampedAt: v.number(),
  }).index("by_nodeId", ["nodeId"]),

  // ── Minimal node_* tables (multi-node PARKED — vendored EMPTY so aumlokManifests' cross-grant path stays
  //    faithful; nothing populates them in the local organism) ──
  // B3.5b: `rootId` BINDS a foreign ROOT pin to the namespace it may authorize; OPTIONAL for back-compat —
  // a legacy pin without rootId authorizes ZERO foreign effects (fail-closed).
  node_trust_registry: defineTable({ sourceNodeId: v.string(), headKeyId: v.string(), publicKey: v.string(), pinnedAt: v.number(), rootId: v.optional(v.string()) })
    .index("by_src_kid", ["sourceNodeId", "headKeyId"])
    .index("by_src_root_kid", ["sourceNodeId", "rootId", "headKeyId"]),
  node_revocations: defineTable({ sourceNodeId: v.string(), delegationId: v.string(), revokedAt: v.number() })
    .index("by_src_del", ["sourceNodeId", "delegationId"]),
  // Pull-origin revocation freshness (fail-closed GATE that can only REFUSE — never grant).
  node_revocation_view: defineTable({
    sourceNodeId: v.string(), rootId: v.string(), epoch: v.number(),
    revokedManifestIdsJson: v.string(), viewSig: v.string(),
    verifiedAtLocal: v.number(), updatedAt: v.number(),
  }).index("by_src_root", ["sourceNodeId", "rootId"]),
  // B3.5b SIGNED CROSS-NODE GRANT — the isolated cross-node EFFECT-authority surface. The resolver reads
  // aumlok_manifests + THIS table, and NEVER node_foreign_manifests (which stays audit-only, not vendored).
  node_cross_grants: defineTable({
    manifestId: v.string(), sourceNodeId: v.string(), rootId: v.string(), rootKeyId: v.string(), nodeId: v.string(),
    subjectId: v.string(), subjectKind: v.string(), subjectPubKey: v.string(), subjectFingerprint: v.string(),
    permissionsJson: v.string(), allowedIntentCodecsJson: v.string(),
    notBefore: v.number(), expiresAt: v.number(),
    maxUses: v.optional(v.number()), maxPerWindowJson: v.optional(v.string()),
    usedCount: v.number(), status: v.string(),
    manifestHash: v.string(), rootSig: v.string(), subjectPopSig: v.string(),
    promotedBy: v.string(), promotedByKeyId: v.string(), promotedAt: v.number(), createdAt: v.number(),
  })
    .index("by_manifestId", ["manifestId"])
    .index("by_src_root", ["sourceNodeId", "rootId"]),

  // ── Nebius dojo lab (shadow-only, advisory-only, internal-only) ──
  dojo_messages: defineTable({
    from: v.string(),
    name: v.string(),
    text: v.string(),
    ts: v.number(),
    drandRound: v.optional(v.number()),
    advisoryOnly: v.boolean(),
    grantsAuthority: v.boolean(),
  }).index("by_ts", ["ts"]),

  dojo_lexicon: defineTable({
    glyph: v.string(),
    meaning: v.string(),
    coinedBy: v.string(),
    coinedRound: v.number(),
    uses: v.number(),
    updatedAt: v.number(),
    advisoryOnly: v.boolean(),
    grantsAuthority: v.boolean(),
  })
    .index("by_glyph", ["glyph"])
    .index("by_updatedAt", ["updatedAt"]),

  dojo_proposals: defineTable({
    title: v.string(),
    body: v.string(),
    capturedAt: v.number(),
    proposer: v.optional(v.string()),
    source: v.optional(v.string()),
    status: v.optional(v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
    )),
    evidenceJson: v.optional(v.string()),
    decidedAt: v.optional(v.number()),
    decisionNote: v.optional(v.string()),
    dupeCount: v.optional(v.number()),
    lastSeenAt: v.optional(v.number()),
    advisoryOnly: v.boolean(),
    grantsAuthority: v.boolean(),
  }).index("by_capturedAt", ["capturedAt"]),

  dojo_memory_drills: defineTable({
    kind: v.union(
      v.literal("drill"),
      v.literal("answer"),
      v.literal("score"),
      v.literal("fix"),
    ),
    by: v.string(),
    text: v.string(),
    capturedAt: v.number(),
    drandRound: v.optional(v.number()),
    advisoryOnly: v.boolean(),
    grantsAuthority: v.boolean(),
  })
    .index("by_capturedAt", ["capturedAt"])
    .index("by_kind_capturedAt", ["kind", "capturedAt"]),

  dojo_lab_runs: defineTable({
    kind: v.union(
      v.literal("mapping"),
      v.literal("benchmark"),
      v.literal("distill"),
    ),
    label: v.string(),
    reportJson: v.string(),
    capturedAt: v.number(),
    advisoryOnly: v.boolean(),
    grantsAuthority: v.boolean(),
  })
    .index("by_capturedAt", ["capturedAt"])
    .index("by_kind_capturedAt", ["kind", "capturedAt"]),
});
