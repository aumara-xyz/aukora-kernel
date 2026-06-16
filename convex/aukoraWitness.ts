// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/**
 * B3.3 — WITNESS MESH (records only; NEVER authority). This node OBSERVES a PINNED peer's receipt-history head
 * (consumed as a B3.1 `env-v1` bodies-absent export) and maintains a high-water mark of `(size, root)` plus the peer's
 * signed head. Trust model:
 *   - FIRST observation = BASELINE — accepted on signature + version + pin ONLY. It NEVER claims append-only.
 *   - LATER observations must prove RFC 6962 CONSISTENCY from the current HWM to advance; an ATTESTATION carries the
 *     baseline (`baselineSize`/`baselineRoot`/`baselineHeadHash`/`observedAt`).
 *   - A validly-signed but INCONSISTENT head (size regression, same-size different root, or a failed consistency proof)
 *     is an EQUIVOCATION: a signed, non-repudiable finding pairs the two conflicting signed heads. B3.3 policy is
 *     RECORD / REFUSE only — no quarantine, unpin, import rejection, or revocation propagation (that is B3.5).
 * Records are signed under the single `aukora-witness-v1` domain (§10.2 Option B): the `recordType`
 * (`baseline` | `attestation` | `equivocation`) is MANDATORY inside the signed preimage, so a record signed as one type
 * can never verify as another. Live flags stay OFF; the scheduler is dormant until `AUKORA_B3_WITNESS_ENABLED`.
 */
import { internalMutation, internalQuery, internalAction, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { pqcSign, pqcVerify } from "./aukoraPqcSigner";
import { verifyChainHeadV4, deriveChainId, resolveChainSigningSeed, type ChainHeadFields } from "./aukoraSignedHead";
import { verifyConsistency } from "./aukoraMerkleLog";
import { verifyExportEnvelope } from "./aukoraWireFormat";
import { verifyChannelBinding, channelTranscript, openFrame, sealFrame, channelEncapsulate, channelProofDigest, CHANNEL_DIR_I2R } from "./aukoraChannel";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

const NODE_ID = (): string => process.env.AUMA_NODE_ID ?? "aukora-node-a-demo";
const WITNESS_FLAG = "AUKORA_B3_WITNESS_ENABLED";
const CHANNEL_FLAG = "AUKORA_B3_CHANNEL_ENABLED"; // B3.4 — gates the channel transport (default OFF; the driver self-gates here too)
const flagOn = (name: string): boolean => ["1", "true", "on", "yes"].includes((process.env[name] ?? "").toLowerCase());
const isHex64 = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);

/** Canonical, key-sorted JSON — deterministic bytes for signing/verify (insertion order can never drift the preimage). */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
}
const recordBytes = (record: Record<string, unknown>): Uint8Array => utf8ToBytes(stableStringify(record));
/** Sign a witness record under `aukora-witness-v1`. `record.recordType` is bound into the preimage (§10.2 Option B). */
export const signWitnessRecord = (seedHex: string, record: Record<string, unknown>): Promise<string> => pqcSign(seedHex, recordBytes(record), "aukoraWitness");
export const verifyWitnessRecord = (pubKeyHex: string, record: Record<string, unknown>, sigHex: string): Promise<boolean> => pqcVerify(pubKeyHex, recordBytes(record), sigHex, "aukoraWitness");

type ObserveResult =
  | { ok: true; recordType: "baseline" | "attestation"; kind?: string; size: number; root: string }
  | { ok: false; reason?: string; recordType?: "equivocation"; kind?: string; findingId?: string };

/**
 * Observe one env-v1 receipt-head export from a pinned peer. FAIL CLOSED on: malformed envelope, wrong surface/version,
 * unpinned peer, bad head signature, missing/invalid consistency proof, size regression, same-size-different-root.
 * Advance the HWM ONLY on a valid consistency proof. Internal — driven by the scheduler (or a test), never a route.
 */
async function observeCore(ctx: MutationCtx, envelope: any, consistencyProof?: string[], channelProofDigest?: string): Promise<ObserveResult> {
    // channelProofDigest, when present, is durable audit evidence that this observation arrived via the ML-KEM channel.
    // It is added to the SIGNED witness record preimage (non-repudiable) AND a queryable HWM column. ABSENT (undefined)
    // for plaintext → the record + HWM are byte-identical to the pre-channel path (strip-neutral).
    const cpRec = channelProofDigest !== undefined ? { channelProofDigest } : {};
    const cpHwm = channelProofDigest !== undefined ? { channelProof: channelProofDigest } : {};
    const env: any = envelope;
    // 1. ENVELOPE STRUCTURE — env-v1 receipt-head only (the witness needs the V4 root); fail closed otherwise.
    if (!env || typeof env !== "object" || typeof env.head !== "object" || env.head === null) return { ok: false, reason: "malformed_envelope" };
    if (env.envelopeVersion !== "env-v1" || env.surface !== "receipt-head" || env.headVersion !== "v4") return { ok: false, reason: "wrong_surface_or_version" };
    if (!verifyExportEnvelope(env).ok) return { ok: false, reason: "envelope_invalid" };
    const head = env.head;
    const peerNodeId = head.sourceNodeId, headKeyId = head.headKeyId, chainKey = head.chainKey;
    if (typeof peerNodeId !== "string" || typeof headKeyId !== "string" || typeof chainKey !== "string") return { ok: false, reason: "malformed_head" };

    // 2. PIN — only a peer key explicitly pinned out-of-band is witnessed (no TOFU).
    const pin = await ctx.db.query("node_trust_registry").withIndex("by_src_kid", (q) => q.eq("sourceNodeId", peerNodeId).eq("headKeyId", headKeyId)).first();
    if (!pin) return { ok: false, reason: "unpinned_peer" };

    // 3. SIGNED HEAD — verify the peer's V4 head sig over the CLAIMED root (a forged root needs a forged sig the
    //    pinned key never made). Only past this gate is a head genuinely peer-signed → eligible to be a finding.
    const size = head.count, root = head.receiptLogRoot, headHash = head.lastChainHash;
    if (!Number.isSafeInteger(size) || size < 0 || !isHex64(root) || !isHex64(headHash)) return { ok: false, reason: "malformed_head" };
    const hf: ChainHeadFields = { chainKey, timestamp: head.headSignedAt, chainLength: size, chainHeadHash: headHash };
    if (typeof head.headSig !== "string" || !(await verifyChainHeadV4(pin.publicKey, hf, root, head.headSig, "chainHead"))) return { ok: false, reason: "head_sig_invalid" };

    const seed = resolveChainSigningSeed();
    if (!seed) return { ok: false, reason: "witness_seed_unset" }; // the witness must SIGN its records (non-repudiable)
    const witnessNodeId = NODE_ID(), now = Date.now(), chainId = bytesToHex(deriveChainId(chainKey));
    const signedHead = { chainKey, timestamp: head.headSignedAt, chainLength: size, chainHeadHash: headHash, merkleRoot: root, headSig: head.headSig, headSigAlg: head.headSigAlg };
    const signedHeadJson = stableStringify(signedHead);
    const hwm = await ctx.db.query("node_witness_hwm").withIndex("by_peer_kid_chain", (q) => q.eq("peerNodeId", peerNodeId).eq("headKeyId", headKeyId).eq("chainId", chainId)).first();

    // record + store a signed equivocation finding (the two conflicting peer-signed heads). Does NOT advance the HWM.
    const recordEquivocation = async (kind: string, headBJson: string): Promise<string> => {
      const record = { recordType: "equivocation", witnessNodeId, peerNodeId, headKeyId, chainId, chainKey, kind, headAHash: hwm!.headHash, headBHash: headHash, ...cpRec, observedAt: now };
      const witnessSig = await signWitnessRecord(seed, record);
      const id = await ctx.db.insert("node_witness_findings", { witnessNodeId, peerNodeId, headKeyId, chainId, chainKey, kind, headAJson: hwm!.signedHeadJson, headBJson, recordJson: stableStringify(record), witnessSig, ...cpHwm, observedAt: now });
      return id as unknown as string;
    };

    // 4a. BASELINE — first observation. Accept on sig + version + pin ONLY; NEVER claim append-only here.
    if (!hwm) {
      const record = { recordType: "baseline", witnessNodeId, peerNodeId, headKeyId, chainId, chainKey, baselineSize: size, baselineRoot: root, baselineHeadHash: headHash, ...cpRec, observedAt: now };
      const sig = await signWitnessRecord(seed, record);
      await ctx.db.insert("node_witness_hwm", {
        witnessNodeId, peerNodeId, headKeyId, chainId, chainKey, size, root, headHash, signedHeadJson,
        baselineSize: size, baselineRoot: root, baselineHeadHash: headHash, baselineObservedAt: now,
        lastRecordType: "baseline", lastRecordJson: stableStringify(record), lastRecordSig: sig, ...cpHwm, observedAt: now, updatedAt: now,
      });
      return { ok: true, recordType: "baseline", size, root };
    }

    // 4b. REGRESSION — a validly-signed head SHORTER than the HWM is equivocation; refuse to advance.
    if (size < hwm.size) { const findingId = await recordEquivocation("regression", signedHeadJson); return { ok: false, recordType: "equivocation", kind: "regression", findingId }; }

    // 4c. SAME SIZE — identical (root+headHash) is a consistent re-observation; any divergence is a FORK.
    if (size === hwm.size) {
      if (root === hwm.root && headHash === hwm.headHash) {
        const record = { recordType: "attestation", witnessNodeId, peerNodeId, headKeyId, chainId, chainKey, size, root, headHash, baselineSize: hwm.baselineSize, baselineRoot: hwm.baselineRoot, baselineHeadHash: hwm.baselineHeadHash, ...cpRec, observedAt: now };
        const sig = await signWitnessRecord(seed, record);
        await ctx.db.patch(hwm._id, { signedHeadJson, lastRecordType: "attestation", lastRecordJson: stableStringify(record), lastRecordSig: sig, ...cpHwm, observedAt: now, updatedAt: now });
        return { ok: true, recordType: "attestation", kind: "stable", size, root };
      }
      const findingId = await recordEquivocation("fork", signedHeadJson);
      return { ok: false, recordType: "equivocation", kind: "fork", findingId };
    }

    // 4d. GROWTH — require an RFC 6962 consistency proof HWM(size,root) → observed(size,root). Advance only if it holds.
    if (!consistencyProof || consistencyProof.length === 0) return { ok: false, reason: "missing_consistency_proof" };
    // A MALFORMED proof (non-array, or any element not 64-hex) is a FORMAT/transport error, NOT evidence of equivocation —
    // refuse without recording a (false) rewrite finding against an honest peer. Only a WELL-FORMED proof that fails the
    // RFC 6962 consistency check becomes a rewrite finding.
    if (!Array.isArray(consistencyProof) || !consistencyProof.every((e) => isHex64(e))) return { ok: false, reason: "malformed_consistency_proof" };
    let consistent = false;
    try { consistent = verifyConsistency(hwm.size, size, consistencyProof.map(hexToBytes), hexToBytes(hwm.root), hexToBytes(root)); } catch { consistent = false; }
    if (!consistent) { const findingId = await recordEquivocation("rewrite", signedHeadJson); return { ok: false, recordType: "equivocation", kind: "rewrite", findingId }; }
    const record = { recordType: "attestation", witnessNodeId, peerNodeId, headKeyId, chainId, chainKey, size, root, headHash, baselineSize: hwm.baselineSize, baselineRoot: hwm.baselineRoot, baselineHeadHash: hwm.baselineHeadHash, ...cpRec, observedAt: now };
    const sig = await signWitnessRecord(seed, record);
    await ctx.db.patch(hwm._id, { size, root, headHash, signedHeadJson, lastRecordType: "attestation", lastRecordJson: stableStringify(record), lastRecordSig: sig, ...cpHwm, observedAt: now, updatedAt: now });
    return { ok: true, recordType: "attestation", kind: "extension", size, root };
}

/** A channel pin for (peerNodeId, headKeyId) means the peer is CHANNEL-CAPABLE → no plaintext path may process it. */
async function channelPinFor(ctx: MutationCtx, peerNodeId: string, headKeyId: string) {
  return ctx.db.query("node_channel_pins").withIndex("by_peer_kid", (q) => q.eq("peerNodeId", peerNodeId).eq("headKeyId", headKeyId)).first();
}

/** The envelope's head identity MUST equal the caller-claimed (peerNodeId, headKeyId) — binds the channel-authenticated /
 *  caller-claimed peer to the peer whose head is actually witnessed (no processing one peer's envelope as another). */
function headIdMatches(envelope: any, peerNodeId: string, headKeyId: string): boolean {
  const h = envelope?.head;
  return !!h && h.sourceNodeId === peerNodeId && h.headKeyId === headKeyId;
}

/** The PLAINTEXT observation entry — fed an env-v1 envelope + optional proof directly by tests or a non-channel transport.
 *  DOOR 1 (fail-closed everywhere): if the envelope's peer is CHANNEL-CAPABLE, even a DIRECT call to this path is refused
 *  (`channel_required`) — there is no plaintext-processing path for a channel-capable peer. Otherwise STRIP-NEUTRAL: this
 *  is exactly what `witnessIngest` calls after it OPENS a channel frame, so removing the channel leaves the same verdict. */
export const witnessObserve = internalMutation({
  args: { envelope: v.any(), consistencyProof: v.optional(v.array(v.string())) },
  handler: async (ctx, a): Promise<ObserveResult> => {
    const h = a.envelope?.head;
    if (h && typeof h.sourceNodeId === "string" && typeof h.headKeyId === "string" && (await channelPinFor(ctx, h.sourceNodeId, h.headKeyId))) {
      return { ok: false, reason: "channel_required" };
    }
    return observeCore(ctx, a.envelope, a.consistencyProof);
  },
});

// ── B3.4 ML-KEM channel: pin a peer's channel capability + the fail-closed ingest. Confidentiality only; B2.4 holds. ──

/**
 * Pin a peer as CHANNEL-CAPABLE: verify its signed channel-key binding against the SAME identity public key already in
 * the trust registry (no TOFU — the head pin must exist first), then store its ML-KEM channel public key + epoch. A
 * binding not signed by the pinned identity key fails closed. Re-pinning REFUSES an epoch regression (DOOR 2 forward-only
 * rotation). No KEM secret is stored — only the public key + the signed binding. Records nothing of authority (B2.4).
 */
export const pinChannel = internalMutation({
  args: { binding: v.any(), sig: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean; reason?: string; epoch?: number }> => {
    const b: any = a.binding;
    if (!b || typeof b !== "object" || typeof b.nodeId !== "string" || typeof b.headKeyId !== "string") return { ok: false, reason: "malformed_binding" };
    const headPin = await ctx.db.query("node_trust_registry").withIndex("by_src_kid", (q) => q.eq("sourceNodeId", b.nodeId).eq("headKeyId", b.headKeyId)).first();
    if (!headPin) return { ok: false, reason: "no_head_pin" }; // the identity must be pinned out-of-band FIRST (no TOFU)
    if (!(await verifyChannelBinding(headPin.publicKey, b, a.sig))) return { ok: false, reason: "binding_invalid" };
    const existing = await ctx.db.query("node_channel_pins").withIndex("by_peer_kid", (q) => q.eq("peerNodeId", b.nodeId).eq("headKeyId", b.headKeyId)).first();
    const row = { peerNodeId: b.nodeId, headKeyId: b.headKeyId, channelPublicKey: b.channelPublicKey, epoch: b.epoch, kemAlg: b.kemAlg, bindingSig: a.sig, pinnedAt: Date.now() };
    if (existing) {
      if (b.epoch < existing.epoch) return { ok: false, reason: "epoch_regression" }; // DOOR 2: rotation is forward-only
      // Same epoch MUST NOT silently overwrite a DIFFERENT channel key — that is a channel-key conflict (two keys claimed
      // for one epoch, equivocation-shaped). Refuse fail-closed. Same epoch + same key = a harmless idempotent re-pin.
      if (b.epoch === existing.epoch && b.channelPublicKey !== existing.channelPublicKey) return { ok: false, reason: "epoch_key_conflict" };
      await ctx.db.patch(existing._id, row);
    } else {
      await ctx.db.insert("node_channel_pins", row);
    }
    return { ok: true, epoch: b.epoch };
  },
});

/**
 * The CHANNEL-AWARE front door for an observation. Enforces DOOR 1 fail-closed:
 *   - If the peer is CHANNEL-CAPABLE (a channel pin exists), a plaintext observation is REFUSED (`channel_required`) —
 *     never a silent downgrade. The sealed frame is OPENED here (the cryptographic gate): the transcript is rebuilt from
 *     the PINNED (channel pubkey, epoch) + the initiator's OWN ciphertext, and `openFrame` returns ONE uniform
 *     `channel_refused` on ANY failure (bad version, tamper, ML-KEM implicit-rejection mismatch) — no decrypt oracle.
 *   - If the peer is NOT channel-capable (optional rollout phase), a plaintext observation is accepted.
 * Either way the opened/plaintext envelope is handed to the SAME `observeCore` → byte-identical verdict (strip-neutral).
 *
 * `sharedSecret`/`ctHex` are the initiator's OWN ephemeral per-request values (never persisted, never cross-node transit;
 * zeroized after use). The wire-facing fail-closed guarantee is `openFrame`; this mutation is the defense-in-depth policy
 * that no code path feeds a channel-capable peer's observation without a successful channel open.
 */
export const witnessIngest = internalMutation({
  args: {
    peerNodeId: v.string(), headKeyId: v.string(),
    plaintext: v.optional(v.object({ envelope: v.any(), consistencyProof: v.optional(v.array(v.string())) })),
    channel: v.optional(v.object({ ctHex: v.string(), sharedSecretHex: v.string(), frame: v.any() })),
  },
  handler: async (ctx, a): Promise<ObserveResult> => {
    const cpin = await ctx.db.query("node_channel_pins").withIndex("by_peer_kid", (q) => q.eq("peerNodeId", a.peerNodeId).eq("headKeyId", a.headKeyId)).first();
    if (cpin) {
      // CHANNEL-CAPABLE → plaintext fallback FAILS CLOSED (DOOR 1). No `channel` payload = a stripped/plaintext response.
      if (!a.channel) return { ok: false, reason: "channel_required" };
      const ssHex = a.channel.sharedSecretHex;
      let openedBytes: Uint8Array;
      try {
        if (typeof ssHex !== "string" || !/^[0-9a-f]{64}$/.test(ssHex)) throw new Error("x");
        const transcript = channelTranscript({ nodeId: a.peerNodeId, headKeyId: a.headKeyId, epoch: cpin.epoch, channelPublicKeyHex: cpin.channelPublicKey, ctHex: a.channel.ctHex });
        const ss = hexToBytes(ssHex);
        try { openedBytes = openFrame(ss, transcript, a.channel.frame); } finally { ss.fill(0); }
      } catch {
        return { ok: false, reason: "channel_refused" }; // uniform — no oracle
      }
      let parsed: any;
      try { parsed = JSON.parse(new TextDecoder().decode(openedBytes)); } catch { return { ok: false, reason: "channel_refused" }; }
      if (!parsed || typeof parsed !== "object") return { ok: false, reason: "channel_refused" };
      // The CHANNEL-authenticated peer (a.peerNodeId/a.headKeyId — drove the pin + decryption) MUST equal the peer whose
      // head this envelope carries. Else a caller could open peer B's channel and feed peer C's envelope (process one
      // peer's envelope as another). Fail closed.
      if (!headIdMatches(parsed.envelope, a.peerNodeId, a.headKeyId)) return { ok: false, reason: "peer_identity_mismatch" };
      const digest = channelProofDigest({ peerNodeId: a.peerNodeId, headKeyId: a.headKeyId, epoch: cpin.epoch, ctHex: a.channel.ctHex, saltHex: a.channel.frame?.saltHex, wireVersion: a.channel.frame?.wireVersion });
      return observeCore(ctx, parsed.envelope, Array.isArray(parsed.consistencyProof) ? parsed.consistencyProof : undefined, digest);
    }
    // NOT channel-capable (optional phase) → plaintext permitted.
    if (!a.plaintext) return { ok: false, reason: "no_observation" };
    if (!headIdMatches(a.plaintext.envelope, a.peerNodeId, a.headKeyId)) return { ok: false, reason: "peer_identity_mismatch" };
    return observeCore(ctx, a.plaintext.envelope, a.plaintext.consistencyProof);
  },
});

/** Read-only view of a peer's channel pin (evidence/tests). No authority; never gates anything. */
export const channelPin = query({ args: { peerNodeId: v.string(), headKeyId: v.string() }, handler: async (ctx, a) => ctx.db.query("node_channel_pins").withIndex("by_peer_kid", (q) => q.eq("peerNodeId", a.peerNodeId).eq("headKeyId", a.headKeyId)).first() });

// ── B3.4 LIVE-PATH (DORMANT until `AUKORA_B3_CHANNEL_ENABLED`; no route exposes a mutation; flags OFF). ──

/** The node's OWN current channel epoch (default 0). Read by the responder routes to derive which key to publish/use. */
export const channelSelfEpoch = query({ args: {}, handler: async (ctx): Promise<number> => {
  const row = await ctx.db.query("node_channel_self").withIndex("by_node", (q) => q.eq("nodeId", NODE_ID())).first();
  return row?.epoch ?? 0;
} });

/** Advance the node's own channel epoch — MONOTONE (DOOR 2 forward-only rotation; a counter, never wall-clock). A
 *  rotation ceremony: bump the epoch → the published binding + derived keypair change. Refuses any non-increase. */
export const advanceChannelEpoch = internalMutation({
  args: { toEpoch: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ ok: boolean; reason?: string; epoch?: number }> => {
    const nodeId = NODE_ID();
    const row = await ctx.db.query("node_channel_self").withIndex("by_node", (q) => q.eq("nodeId", nodeId)).first();
    const current = row?.epoch ?? 0;
    const target = a.toEpoch ?? current + 1;
    if (!Number.isSafeInteger(target) || target <= current) return { ok: false, reason: "epoch_not_monotone" };
    if (row) await ctx.db.patch(row._id, { epoch: target, updatedAt: Date.now() });
    else await ctx.db.insert("node_channel_self", { nodeId, epoch: target, updatedAt: Date.now() });
    return { ok: true, epoch: target };
  },
});

/** ROLLBACK: unpin a peer's channel capability → it reverts to the plaintext optional phase. SAFE + reversible: the
 *  channel is confidentiality-only (strip-neutral), so unpinning changes NO witness verdict, HWM, or finding. Idempotent. */
export const unpinChannel = internalMutation({
  args: { peerNodeId: v.string(), headKeyId: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean; unpinned: boolean }> => {
    const cpin = await channelPinFor(ctx, a.peerNodeId, a.headKeyId);
    if (!cpin) return { ok: true, unpinned: false };
    await ctx.db.delete(cpin._id);
    return { ok: true, unpinned: true };
  },
});

/**
 * The LIVE channel-delivery record path. The initiator's ACTION (`channelPollPeer`) has ALREADY opened the frame — the
 * wire-facing crypto gate is `openFrame`, performed IN THE ACTION, so the shared secret NEVER reaches this mutation (no
 * log/dashboard-visible secret). **The action layer is part of the witness TCB** (it asserts channel-delivery by calling
 * here with the public channelProof); this mutation records that assertion as a durable, non-repudiable audit digest, and
 * re-checks epoch + peer identity as defense-in-depth. It does NOT re-open (it has no secret) — that is the honest
 * trust-boundary scope. observeCore then produces the byte-identical verdict (strip-neutral; the only addition is the
 * audit digest).
 */
export const witnessRecordOpened = internalMutation({
  args: {
    peerNodeId: v.string(), headKeyId: v.string(),
    envelope: v.any(), consistencyProof: v.optional(v.array(v.string())),
    channelProof: v.object({ ctHex: v.string(), epoch: v.number(), saltHex: v.string(), wireVersion: v.string() }),
  },
  handler: async (ctx, a): Promise<ObserveResult> => {
    const cpin = await channelPinFor(ctx, a.peerNodeId, a.headKeyId);
    if (!cpin) return { ok: false, reason: "not_channel_capable" };                         // only for channel-capable peers
    if (a.channelProof.epoch !== cpin.epoch) return { ok: false, reason: "epoch_mismatch" }; // must be the current pinned epoch
    if (!headIdMatches(a.envelope, a.peerNodeId, a.headKeyId)) return { ok: false, reason: "peer_identity_mismatch" };
    const digest = channelProofDigest({ peerNodeId: a.peerNodeId, headKeyId: a.headKeyId, epoch: cpin.epoch, ctHex: a.channelProof.ctHex, saltHex: a.channelProof.saltHex, wireVersion: a.channelProof.wireVersion });
    return observeCore(ctx, a.envelope, a.consistencyProof, digest);
  },
});

/**
 * The INITIATOR DRIVER (internalAction, DORMANT until `AUKORA_B3_CHANNEL_ENABLED`). Encapsulates to a pinned peer's
 * channel key, SEALS the request `{ chainKey }` under the i2r leg, fetches the sealed export, OPENS it IN THE ACTION (the
 * shared secret never leaves this action scope — zeroized, never a mutation arg), then records via `witnessRecordOpened`.
 * Not run live here. B3.5c: the REQUEST leg is now sealed too (same ML-KEM shared secret, domain-separated i2r AEAD key) —
 * the chainKey no longer rides the wire in cleartext, closing the chain-existence oracle. Only the KEM ciphertext (inside
 * the request frame) is public. `peerBaseUrl` is operator-supplied at exercise time (URLs are never persisted in the DB).
 */
export const channelPollPeer = internalAction({
  args: { peerNodeId: v.string(), headKeyId: v.string(), chainKey: v.string(), peerBaseUrl: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean; reason?: string; result?: ObserveResult; channelMeta?: { ctHex: string; saltHex: string; wireVersion: string; epoch: number } }> => {
    if (!flagOn(CHANNEL_FLAG)) return { ok: false, reason: "channel_disabled" };
    const pin: any = await ctx.runQuery(api.aukoraWitness.channelPin, { peerNodeId: a.peerNodeId, headKeyId: a.headKeyId });
    if (!pin) return { ok: false, reason: "not_channel_capable" };
    const { ctHex, sharedSecret } = channelEncapsulate({ channelPublicKey: pin.channelPublicKey });
    try {
      const transcript = channelTranscript({ nodeId: a.peerNodeId, headKeyId: a.headKeyId, epoch: pin.epoch, channelPublicKeyHex: pin.channelPublicKey, ctHex });
      // B3.5c — SEAL the request leg (i2r): the chainKey is AEAD-sealed under the SAME shared secret with a distinct
      // direction key, so the wire carries only the request frame (KEM ctHex + salt + sealed body), never the chainKey.
      const requestFrame = sealFrame(sharedSecret, transcript, utf8ToBytes(JSON.stringify({ chainKey: a.chainKey })), CHANNEL_DIR_I2R);
      const res = await fetch(`${a.peerBaseUrl}/channel-export`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestFrame }) });
      const body: any = await res.json();
      const frame = body?.frame; // the r2i RESPONSE frame
      let openedBytes: Uint8Array;
      try { openedBytes = openFrame(sharedSecret, transcript, frame); } catch { return { ok: false, reason: "channel_refused" }; } // fail closed; no plaintext fallback
      let parsed: any;
      try { parsed = JSON.parse(new TextDecoder().decode(openedBytes)); } catch { return { ok: false, reason: "channel_refused" }; }
      const result: ObserveResult = await ctx.runMutation(internal.aukoraWitness.witnessRecordOpened, {
        peerNodeId: a.peerNodeId, headKeyId: a.headKeyId, envelope: parsed.envelope,
        consistencyProof: Array.isArray(parsed.consistencyProof) ? parsed.consistencyProof : undefined,
        channelProof: { ctHex, epoch: pin.epoch, saltHex: frame?.saltHex, wireVersion: frame?.wireVersion },
      });
      // Return PUBLIC frame metadata for the evidence template — NO secret (the shared secret stays in this action).
      return { ok: true, result, channelMeta: { ctHex, saltHex: frame?.saltHex, wireVersion: frame?.wireVersion, epoch: pin.epoch } };
    } finally {
      sharedSecret.fill(0); // zeroize the ephemeral secret regardless of outcome — it never left this action
    }
  },
});

/** A missed/failed poll is LIVENESS, never equivocation (which requires two validly-signed conflicting heads). */
export const witnessNoteLiveness = internalMutation({
  args: { peerNodeId: v.string(), headKeyId: v.string(), chainKey: v.string(), reason: v.string() },
  handler: async (ctx, a): Promise<void> => {
    await ctx.db.insert("node_witness_liveness", { witnessNodeId: NODE_ID(), peerNodeId: a.peerNodeId, headKeyId: a.headKeyId, chainKey: a.chainKey, reason: a.reason, observedAt: Date.now() });
  },
});

export const witnessPeers = internalQuery({ args: {}, handler: async (ctx) => ctx.db.query("node_trust_registry").collect() });

/**
 * The scheduler — DORMANT until `AUKORA_B3_WITNESS_ENABLED`. LAB cadence only; the cron interval is the witness's LOCAL
 * poll rhythm, NOT a trusted global clock. Cross-node TRANSPORT (fetching each peer's `/export` + requesting a
 * consistency proof) is the networking layer, deferred — so each scheduled poll is currently a MISS, recorded as
 * LIVENESS (never equivocation). The verified observation core is `witnessObserve` (fed envelopes directly by tests).
 */
export const witnessTick = internalAction({
  args: {},
  handler: async (ctx): Promise<{ skipped: string | false; polled?: number }> => {
    if (!flagOn(WITNESS_FLAG)) return { skipped: "witness_disabled" };
    const peers = await ctx.runQuery(internal.aukoraWitness.witnessPeers, {});
    let polled = 0;
    for (const p of peers) {
      await ctx.runMutation(internal.aukoraWitness.witnessNoteLiveness, { peerNodeId: p.sourceNodeId, headKeyId: p.headKeyId, chainKey: "", reason: "poll_no_transport" });
      polled++;
    }
    return { skipped: false, polled };
  },
});

// Read-only views (evidence / tests). No authority; never gate anything.
export const witnessHwm = query({ args: { peerNodeId: v.string(), headKeyId: v.string(), chainId: v.string() }, handler: async (ctx, a) => ctx.db.query("node_witness_hwm").withIndex("by_peer_kid_chain", (q) => q.eq("peerNodeId", a.peerNodeId).eq("headKeyId", a.headKeyId).eq("chainId", a.chainId)).first() });
export const witnessFindings = query({ args: { peerNodeId: v.string(), chainId: v.string() }, handler: async (ctx, a) => ctx.db.query("node_witness_findings").withIndex("by_peer_chain", (q) => q.eq("peerNodeId", a.peerNodeId).eq("chainId", a.chainId)).collect() });
export const witnessLiveness = query({ args: { peerNodeId: v.string(), headKeyId: v.string() }, handler: async (ctx, a) => ctx.db.query("node_witness_liveness").withIndex("by_peer", (q) => q.eq("peerNodeId", a.peerNodeId).eq("headKeyId", a.headKeyId)).collect() });

// ── B3.5a §8 — CHANNEL-LIVENESS (mirror of witness liveness). A failed channel open is a TRANSPORT fact, recorded
//    distinctly so it can NEVER be read as an equivocation finding (the B3.3 liveness/equivocation distinction holds). ──
export const noteChannelLiveness = internalMutation({
  args: { peerNodeId: v.string(), headKeyId: v.string(), chainKey: v.string(), reason: v.string() },
  handler: async (ctx, a): Promise<void> => {
    await ctx.db.insert("node_channel_liveness", { witnessNodeId: NODE_ID(), peerNodeId: a.peerNodeId, headKeyId: a.headKeyId, chainKey: a.chainKey, reason: a.reason, observedAt: Date.now() });
  },
});
export const channelLiveness = query({ args: { peerNodeId: v.string(), headKeyId: v.string() }, handler: async (ctx, a) => ctx.db.query("node_channel_liveness").withIndex("by_peer", (q) => q.eq("peerNodeId", a.peerNodeId).eq("headKeyId", a.headKeyId)).collect() });

// ── B3.5a §6 (D3 graded) — LOCAL, REVERSIBLE post-finding consequences. Self-verifying (fork/regression) → an
//    import-rejection a peer must re-pin out of; a weaker rewrite → rewrite_suspected (re-request-once digest; NO
//    auto-reject). Reads node_witness_findings. NEVER grants anything — it only ever BLOCKS an import. ──
export const applyConsequence = internalMutation({
  args: { findingId: v.id("node_witness_findings") },
  handler: async (ctx, a): Promise<any> => {
    const finding = await ctx.db.get(a.findingId);
    if (!finding) return { ok: false, reason: "no_finding" };
    const selfVerifying = finding.kind === "fork" || finding.kind === "regression";
    const state = selfVerifying ? "import_rejected" : "rewrite_suspected";
    const reason = selfVerifying ? "self_verifying_finding" : "rewrite_suspected";
    const ex = await ctx.db.query("node_peer_consequence").withIndex("by_peer", (q) => q.eq("peerNodeId", finding.peerNodeId).eq("headKeyId", finding.headKeyId)).first();
    if (ex && !ex.clearedAt) {
      if (ex.state === "import_rejected") return { ok: true, state: ex.state, alreadySet: true };           // strongest already set — no change
      // a STRONGER (self-verifying) finding SUPERSEDES a weaker rewrite_suspected → upgrade to import_rejected.
      if (ex.state === "rewrite_suspected" && selfVerifying) {
        await ctx.db.patch(ex._id, { state: "import_rejected", reason: "self_verifying_finding", findingId: String(a.findingId) });
        return { ok: true, state: "import_rejected", superseded: true };
      }
      return { ok: true, state: ex.state, alreadySet: true };                                                // rewrite over rewrite — no downgrade, no churn
    }
    const id = await ctx.db.insert("node_peer_consequence", { peerNodeId: finding.peerNodeId, headKeyId: finding.headKeyId, state, reason, findingId: String(a.findingId), setAt: Date.now() });
    return { ok: true, state, consequenceId: id };
  },
});
/** Re-pin clears a local consequence (the §6 reversibility — a consequence is a refusal, never a permanent kill). */
export const clearConsequence = internalMutation({
  args: { peerNodeId: v.string(), headKeyId: v.string() },
  handler: async (ctx, a): Promise<any> => {
    const rows = await ctx.db.query("node_peer_consequence").withIndex("by_peer", (q) => q.eq("peerNodeId", a.peerNodeId).eq("headKeyId", a.headKeyId)).collect();
    let cleared = 0;
    for (const r of rows) if (!r.clearedAt) { await ctx.db.patch(r._id, { clearedAt: Date.now() }); cleared++; }
    return { ok: true, cleared };
  },
});
/** §6 (small) — store the failed-proof digest from a ONE-TIME rewrite re-request. The live HTTP re-request transport is
 *  DORMANT (it would fetch the consistency proof once from the benign peer); B3.5a records only the consequence STATE. */
export const recordRewriteReRequest = internalMutation({
  args: { peerNodeId: v.string(), headKeyId: v.string(), failedProofDigest: v.string() },
  handler: async (ctx, a): Promise<any> => {
    const r = await ctx.db.query("node_peer_consequence").withIndex("by_peer", (q) => q.eq("peerNodeId", a.peerNodeId).eq("headKeyId", a.headKeyId)).first();
    if (!r) return { ok: false, reason: "no_consequence" };
    await ctx.db.patch(r._id, { failedProofDigest: a.failedProofDigest });
    return { ok: true };
  },
});
export const peerConsequences = query({ args: { peerNodeId: v.string(), headKeyId: v.string() }, handler: async (ctx, a) => ctx.db.query("node_peer_consequence").withIndex("by_peer", (q) => q.eq("peerNodeId", a.peerNodeId).eq("headKeyId", a.headKeyId)).collect() });
