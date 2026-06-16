// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Two-node demo slice schema = the Aukora kernel tables (exact copies from AUMA.one) + the node tables.
// NOT the AUMA.one prod schema. Fake data only.
export default defineSchema({
  // ── Aukora kernel (copied verbatim from convex/schema.ts) ──
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

  auma_aukora_test_notes: defineTable({
    note: v.string(),
    logId: v.string(),
    receiptId: v.string(),
    actorId: v.string(),
    createdAt: v.number(),
  })
    .index("by_logId", ["logId"])
    .index("by_createdAt", ["createdAt"]),

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

  // ── Node tables (the two-node importer; proven in twoNodeLiveDb.itest.ts) ──
  node_sessions: defineTable({ token: v.string(), principalId: v.string(), nodeId: v.string(), roles: v.array(v.string()) })
    .index("by_token", ["token"]),
  // B3.5b: `rootId` BINDS a foreign ROOT pin to the namespace it may authorize (effect authority — a pin keyed only by
  // (sourceNodeId, headKeyId) could otherwise claim any namespace, incl. a local one). It is OPTIONAL for back-compat:
  // B3.5a audit pins (no rootId) keep working for IMPORT only; the B3.5b resolver foreign branch REQUIRES a non-null,
  // rootId-bound pin (`by_src_root_kid`) — a legacy pin without rootId authorizes ZERO foreign effects (fail-closed).
  node_trust_registry: defineTable({ sourceNodeId: v.string(), headKeyId: v.string(), publicKey: v.string(), pinnedAt: v.number(), rootId: v.optional(v.string()) })
    .index("by_src_kid", ["sourceNodeId", "headKeyId"])
    .index("by_src_root_kid", ["sourceNodeId", "rootId", "headKeyId"]),
  node_import_registry: defineTable({ sourceNodeId: v.string(), chainKey: v.string(), envelopeId: v.string(), receiptHash: v.string(), importedAt: v.number() })
    .index("by_src_env", ["sourceNodeId", "envelopeId"])
    .index("by_src_hash", ["sourceNodeId", "receiptHash"]),

  // ── B3.3 witness mesh (records only; no authority) ──
  // This node WITNESSING a pinned peer's receipt-history head. The high-water mark is (size, root) + the peer's signed
  // head, extending the B1.5 (maxCount, headHash) deferral. The first observation is the BASELINE (sig+version+pin
  // only — NEVER claims append-only); later observations must prove RFC 6962 consistency from the baseline to advance.
  node_witness_hwm: defineTable({
    witnessNodeId: v.string(), peerNodeId: v.string(), headKeyId: v.string(), chainId: v.string(), chainKey: v.string(),
    size: v.number(), root: v.string(), headHash: v.string(),
    signedHeadJson: v.string(),                 // the peer's CURRENT signed head (fields + sig) — for non-repudiable findings
    baselineSize: v.number(), baselineRoot: v.string(), baselineHeadHash: v.string(), baselineObservedAt: v.number(),
    lastRecordType: v.string(), lastRecordJson: v.string(), lastRecordSig: v.string(), // the latest witness-signed baseline/attestation
    channelProof: v.optional(v.string()), // B3.4: a digest proving the latest observation arrived via the ML-KEM channel (audit; ABSENT for plaintext)
    observedAt: v.number(), updatedAt: v.number(),
  }).index("by_peer_kid_chain", ["peerNodeId", "headKeyId", "chainId"]),
  // A signed, non-repudiable EQUIVOCATION finding: the TWO conflicting signed heads from the SAME peer key.
  // B3.3 policy = RECORD/REFUSE only — no quarantine, unpin, import rejection, or revocation propagation (that is B3.5).
  node_witness_findings: defineTable({
    witnessNodeId: v.string(), peerNodeId: v.string(), headKeyId: v.string(), chainId: v.string(), chainKey: v.string(),
    kind: v.string(),                           // "fork" | "regression" | "rewrite"
    headAJson: v.string(), headBJson: v.string(), // the two conflicting signed heads (each: fields + the peer's sig)
    recordJson: v.string(), witnessSig: v.string(), // the witness's signed equivocation record (recordType in preimage)
    channelProof: v.optional(v.string()), // B3.4: a digest if this finding arrived via the ML-KEM channel (audit; ABSENT for plaintext)
    observedAt: v.number(),
  }).index("by_peer_chain", ["peerNodeId", "chainId"]),
  // A missed/failed poll is LIVENESS, not equivocation — recorded distinctly so it can never be read as a fault finding.
  node_witness_liveness: defineTable({
    witnessNodeId: v.string(), peerNodeId: v.string(), headKeyId: v.string(), chainKey: v.string(),
    reason: v.string(), observedAt: v.number(),
  }).index("by_peer", ["peerNodeId", "headKeyId"]),
  // ── B3.4 ML-KEM channel (confidentiality only; no authority) ──
  // A pinned peer's CHANNEL CAPABILITY: its ML-KEM-768 channel public key + epoch, bound to its node identity by an
  // ML-DSA-65 signature (verified against the SAME identity pubkey in node_trust_registry — no TOFU). A row's PRESENCE
  // = the peer is channel-capable → witnessIngest then REFUSES a plaintext observation (DOOR 1 fail-closed). The epoch
  // is a monotone counter (DOOR 2, no wall-clock); re-pinning refuses an epoch regression. No KEM secret is ever stored.
  node_channel_pins: defineTable({
    peerNodeId: v.string(), headKeyId: v.string(), channelPublicKey: v.string(), epoch: v.number(),
    kemAlg: v.string(), bindingSig: v.string(), pinnedAt: v.number(),
  }).index("by_peer_kid", ["peerNodeId", "headKeyId"]),
  // The node's OWN channel epoch source-of-truth: a single monotone counter per nodeId (DOOR 2 — a counter, never
  // wall-clock). Default 0 (no row); advanced only by `advanceChannelEpoch` with a strict-increase guard. The KEM
  // keypair is re-derivable from (signing seed, epoch) — no secret is stored here, only the public epoch number.
  node_channel_self: defineTable({ nodeId: v.string(), epoch: v.number(), updatedAt: v.number() })
    .index("by_node", ["nodeId"]),
  node_revocations: defineTable({ sourceNodeId: v.string(), delegationId: v.string(), revokedAt: v.number() })
    .index("by_src_del", ["sourceNodeId", "delegationId"]),

  // ── B3.5a cross-node propagation (AUDIT-ONLY; honor-as-record — NEVER authority) ──
  // The hard invariant (B2.4): NONE of these tables is ever read by resolveManifestAuthority / consumeManifestUseCore /
  // writeReceiptRow. An imported foreign manifest/memory row is a VERIFIABLE RECORD a node can audit — it grants ZERO
  // local effect authority (the resolver's nodeId refusal at aumlokManifests.ts:138 is the backstop). Cross-node EFFECT
  // authority is B3.5b only (signed cross-node grant). Imported from an EXPLICITLY-pinned peer (no TOFU).
  //
  // An imported foreign manifest ROW + its two signatures, verified against the PINNED root key. `foreignNodeId` is the
  // manifest's OWN signed nodeId, stored VERBATIM (never rewritten to THIS_NODE) — so even a future bug feeding it to the
  // resolver still hits the node_mismatch refusal. `lastLifecycleStatus` is derived from the fresh revocation view.
  node_foreign_manifests: defineTable({
    sourceNodeId: v.string(), manifestId: v.string(), rootId: v.string(), rootKeyId: v.string(),
    foreignNodeId: v.string(),
    subjectId: v.string(), subjectKind: v.string(), subjectPubKey: v.string(),
    manifestHash: v.string(), rootSig: v.string(), subjectPopSig: v.string(),
    lastLifecycleStatus: v.string(),  // "active" | "revoked" — from the fresh revocation view at import
    epochAtImport: v.number(),        // the revocation-epoch counter verified at import (provenance)
    attestationSig: v.string(),       // THIS node's signature over the import attestation (aukora-node-import-v1 domain)
    importedAt: v.number(),
  }).index("by_src_mft", ["sourceNodeId", "manifestId"]).index("by_src_root", ["sourceNodeId", "rootId"]),
  // An imported foreign mem: receipt — the receiptHash + memoryHash only (the VALUE stays at the home node, B3.1
  // redaction). Verified-receipt-before-accept; NEVER writes aukora_memory (the structural guarantee §10.3 wants).
  node_foreign_memory: defineTable({
    sourceNodeId: v.string(), ownerRootId: v.string(), key: v.string(), manifestId: v.string(),
    receiptHash: v.string(), memoryHash: v.string(), importedAt: v.number(),
  }).index("by_src_owner_key", ["sourceNodeId", "ownerRootId", "key"]).index("by_src_hash", ["sourceNodeId", "receiptHash"]),
  // Pull-origin revocation freshness (§4(A), D2). One row per (sourceNodeId, rootId): the highest monotone
  // revocation-epoch counter B has VERIFIED for that root, the signed revoked-manifestId set, and B's OWN local clock at
  // the last verified pull. A fail-closed GATE that can only REFUSE (never grant). No shared/global clock.
  node_revocation_view: defineTable({
    sourceNodeId: v.string(), rootId: v.string(), epoch: v.number(),
    revokedManifestIdsJson: v.string(), viewSig: v.string(),
    verifiedAtLocal: v.number(), updatedAt: v.number(),
  }).index("by_src_root", ["sourceNodeId", "rootId"]),
  // Channel-liveness (§8, D5) — a failed channel open is a TRANSPORT fact, recorded distinctly so it can NEVER be read
  // as an equivocation finding (the B3.3 liveness/equivocation distinction holds). Exact mirror of node_witness_liveness.
  node_channel_liveness: defineTable({
    witnessNodeId: v.string(), peerNodeId: v.string(), headKeyId: v.string(), chainKey: v.string(),
    reason: v.string(), observedAt: v.number(),
  }).index("by_peer", ["peerNodeId", "headKeyId"]),
  // Graded local consequence state (§6, D3). A self-verifying finding (fork/regression) → "import_rejected" (a refusal,
  // reversible by re-pin via clearedAt); a weaker rewrite finding → "rewrite_suspected" (re-request-once digest stored,
  // NO auto-reject). It only ever BLOCKS an import — never grants anything.
  node_peer_consequence: defineTable({
    peerNodeId: v.string(), headKeyId: v.string(), state: v.string(), reason: v.string(),
    findingId: v.string(), failedProofDigest: v.optional(v.string()),
    setAt: v.number(), clearedAt: v.optional(v.number()),
  }).index("by_peer", ["peerNodeId", "headKeyId"]),

  // ── B3.5b SIGNED CROSS-NODE GRANT — the ISOLATED cross-node EFFECT-authority surface (Db4) ──
  // A manifest a foreign root deliberately signed FOR this node (nodeId == THIS), verified at PROMOTE against the
  // rootId-bound pinned foreign root, then promoted here by a deliberate flag+PoP-gated op (NO auto-promotion from
  // import). The resolver reads aumlok_manifests + THIS table, and NEVER node_foreign_manifests (which stays audit-only).
  // Mirrors aumlok_manifests field-for-field where the consume path reads, so consumeManifestUseCore treats either row
  // identically (ONE OCC chokepoint, Db5). `usedCount` is the PER-GRANT OCC counter. No onward delegation field (Db8).
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
  // Brick 6/7 — AUMLOK proof-of-possession resolver. Pinned founder PUBLIC keys (never private; never from the blob).
  // status: "active" (issue+verify) | "retired" (verify caps issued before retiredAt; CANNOT issue new) | "revoked" (dead).
  founder_key_registry: defineTable({ founderUserId: v.string(), keyId: v.string(), publicKey: v.string(), status: v.string(), pinnedAt: v.number(), retiredAt: v.optional(v.number()) })
    .index("by_founder_kid", ["founderUserId", "keyId"]),
  // B2.1 — AUMLOK identity ROOT-key registry. Pinned ML-DSA-65 root PUBLIC keys ONLY (never seeds/phrases; the phrase
  // never transits the server). Mirrors founder_key_registry's lifecycle: status "active" (can author a rotation +
  // verify) | "retired" (grandfathered — historical statements still verify, but CANNOT authorize a NEW rotation) |
  // "revoked" (dead — kills future authority). fingerprint = sha256(publicKey-bytes) hex, the short identity reference.
  // A root's lifecycle (genesis mint → rotations → revoke) is operator-PoP-gated in B2.1 (operator-born, interim until
  // the B2.3 self-sovereign ceremony) and receipted on the reserved `id:{rootId}` V4 chain.
  aumlok_root_keys: defineTable({ rootId: v.string(), keyId: v.string(), publicKey: v.string(), fingerprint: v.string(), status: v.string(), pinnedAt: v.number(), retiredAt: v.optional(v.number()) })
    .index("by_root_kid", ["rootId", "keyId"])
    .index("by_root", ["rootId"])
    .index("by_fingerprint", ["fingerprint"]), // global pubkey uniqueness: one root key = one root identity (no cross-root sharing)
  // B2.2 — AUMLOK delegation MANIFESTS. A doubly-signed root→subject delegation: the root signs the manifest under
  // aukora-aumlok-manifest-v1, the subject counter-signs PoP under aukora-aumlok-subjectpop-v1; both verify before
  // active. Every SIGNED field is enforced (permissions/codecs/time/maxUses/maxPerWindow) or bound identity metadata.
  // status: active | paused (subject) | revoked (root superior / subject). usedCount is the OCC circuit-breaker counter.
  // Lifecycle receipted on the reserved mft:{manifestId} V4 chain. Immutable v1 (amend = revoke + re-mint).
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
  // B2.3 — self-sovereign AUMLOK ceremony audit + replay defense. One row per ceremony: the root proved possession of
  // its OWN key (no operator). PUBLIC material only — no phrase/seed/private key (those never transit Convex). The
  // embedded rootBirthSig is the root's own ceremony PoP (its birth attestation); ceremonyId is globally unique
  // (replay defense). summaryHash binds the plain-language grant summary the user confirmed before signing.
  aumlok_ceremonies: defineTable({
    ceremonyId: v.string(), rootId: v.string(), keyId: v.string(), nodeId: v.string(),
    fingerprint: v.string(), summaryHash: v.string(), rootBirthSig: v.string(), createdAt: v.number(),
  })
    .index("by_ceremonyId", ["ceremonyId"])
    .index("by_root", ["rootId"]),
  // Single-use request nonces (replay defense), modeled on node_import_registry.by_src_env. keyId = audit: which key authorized.
  pop_nonce_registry: defineTable({ nodeId: v.string(), founderUserId: v.string(), keyId: v.optional(v.string()), capId: v.string(), nonce: v.string(), methodId: v.string(), argsHash: v.string(), consumedAt: v.number(), expiresAt: v.number() })
    .index("by_node_nonce", ["nodeId", "nonce"]),
  // Code attestation (design note: AUKORA_CODE_ATTESTATION_DESIGN.md). Founder-release-key-signed release manifests
  // binding {version, gitSHA, bundleHash}. DEMO bundleHash = reproducible slice-tarball hash (NOT opaque Convex bundle).
  aukora_release_manifests: defineTable({ manifestId: v.string(), version: v.number(), gitSHA: v.string(), bundleHash: v.string(), bundleHashAlg: v.string(), createdAt: v.number(), releaseKeyId: v.string(), signature: v.string(), status: v.string() })
    .index("by_manifestId", ["manifestId"]),
  // Per-source version high-water mark — refuses rollback/downgrade to an older blessed release.
  node_manifest_hwm: defineTable({ sourceNodeId: v.string(), maxVersion: v.number(), updatedAt: v.number() })
    .index("by_node", ["sourceNodeId"]),
  // Release Spine (threat model: AUKORA_RELEASE_SPINE_THREAT_MODEL.md). Apply-time "what's running" pointer — flipped
  // ATOMICALLY with the apply receipt (no pointer without a receipt; no half-apply).
  node_applied_release: defineTable({ nodeId: v.string(), manifestId: v.string(), version: v.number(), bundleHash: v.string(), appliedReceiptId: v.string(), appliedAt: v.number(), status: v.string() })
    .index("by_node", ["nodeId"]),
  // Migration dry-run results — the committing apply REQUIRES a fresh ok:true preflight matching {from,to,bundleHash}.
  aukora_preflight_results: defineTable({ preflightId: v.string(), manifestId: v.string(), fromVersion: v.number(), toVersion: v.number(), bundleHash: v.string(), ok: v.boolean(), diagnosticsJson: v.string(), createdAt: v.number(), expiresAt: v.number() })
    .index("by_preflightId", ["preflightId"]),

  // Aukora Capability Ledger (NEW Aukora-named layer): records every capability granted to a delegation, so
  // cumulative authority is auditable + a ceiling wall can refuse composition that sums to too much.
  aukora_capability_ledger: defineTable({ delegationId: v.string(), action: v.string(), resource: v.string(), ring: v.string(), grantedAt: v.number() })
    .index("by_delegation", ["delegationId"]),

  // Aukora Delegation (ceremony rehearsal): a carbon root authorizes a silicon mirror with a scoped capability,
  // signed by the carbon root's key. Disposable demo identity — NOT the real founder/AUMLOK identity.
  aukora_delegations: defineTable({
    delegationId: v.string(), carbonRoot: v.string(), carbonPubkey: v.string(), siliconPrincipal: v.string(),
    action: v.string(), resource: v.string(), ring: v.string(), nodeId: v.string(), issuedAt: v.number(),
    delHash: v.string(), sig: v.string(), revoked: v.boolean(),
  }).index("by_delegationId", ["delegationId"]),

  // Aukora Memory: a private memory row owned by a carbon root, written by a silicon
  // mirror under delegation, coupled to a governed receipt. Disposable demo.
  aukora_memory: defineTable({
    ownerRootId: v.string(), writerPrincipalId: v.string(), readerScope: v.string(), delegationId: v.string(),
    receiptHash: v.string(), memoryHash: v.string(), sourceNodeId: v.string(), visibility: v.string(),
    key: v.string(), value: v.string(), deletedAt: v.optional(v.number()),
  }).index("by_owner_key", ["ownerRootId", "key"]).index("by_owner", ["ownerRootId"]),

  // Aukora structured trace rows: governance outcome records for governed events (ids, hashes, triage labels only —
  // no raw payloads, no private memory values). A trace row is only written when a real receipt was minted.
  aukora_traces: defineTable({
    traceId: v.string(), runId: v.string(), sourceRoute: v.string(), actorPrincipalId: v.string(),
    ownerRootId: v.optional(v.string()), delegationId: v.optional(v.string()),
    action: v.string(), resource: v.string(), ring: v.string(), intentHash: v.string(),
    governanceResult: v.string(), refusalReason: v.optional(v.string()), mechanicalOutcome: v.string(),
    receiptId: v.optional(v.string()), receiptHash: v.optional(v.string()), memoryHash: v.optional(v.string()),
    importDecision: v.optional(v.string()), revocationState: v.string(),
    schemaVersion: v.string(), triage: v.string(), createdAt: v.number(),
  }).index("by_traceId", ["traceId"]).index("by_triage", ["triage"]).index("by_run", ["runId"]),

  // B3.2 — Node factory: a STAMPED node identity. `stampHash` is a deterministic (byte-identical) commitment over the
  // canonical node config — same config → same stamp, so a second node from the same source re-derives it. Stores only
  // PUBLIC material: the node signing key's FINGERPRINT (the seed stays env-custodied, never persisted), the honored
  // root pins, the deployment label, and the tier ("lab"/"dev" — NEVER "production"; claim discipline). Identity is
  // stamped once per nodeId (immutable).
  aukora_node_identity: defineTable({
    nodeId: v.string(), deploymentLabel: v.string(), tier: v.string(),
    signingKeyFingerprint: v.string(), rootPinsJson: v.string(), stampHash: v.string(),
    status: v.string(), stampedAt: v.number(),
  }).index("by_nodeId", ["nodeId"]),
});