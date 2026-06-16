// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/**
 * B2.3 — self-sovereign AUMLOK CEREMONY. Turns a CLIENT-DERIVED, user-owned root PUBLIC key into an identity root.
 * This is the normal birth path (the operator-born `aumlokGenesisMint` is now LAB/ADMIN only). The defining property:
 * the ROOT proves possession of its OWN key — there is NO operator gate. The client/harness sends ONLY public material
 * (the public key + signatures + a confirmed fingerprint + a plain-language summary). The phrase / root seed / private
 * key NEVER transit Convex (the client derives + signs); a structural-absence test pins it.
 *
 * The mint commits ONLY after the root proof-of-possession verifies: the root key signs a ceremony CHALLENGE binding
 * {v, ceremonyId, rootId, keyId, nodeId, fingerprint, summaryHash, timestamp}, under the DEDICATED single-purpose
 * `aumlokGenesis` FIPS 204 domain (`aukora-aumlok-genesis-v1`, registered in aukoraPqcSigner.ts; chainKey
 * `aumlok:genesis:{rootId}` adds chain_id separation). B2.3/B2.4 originally reused `aumlokRotation` here; B3.1 (P3,
 * Peter §8 sign-off 2026-06-11) gave genesis its own permanent domain so each domain has exactly one purpose
 * (cleaner cross-node audit before real identities exist).
 *
 * GATES, in order: nodeId == this node; ML-DSA-65 pubkey shape; fingerprint CONFIRMATION (the procedural typo-catch —
 * NOT recovery); the summary bound + its claims enforced; freshness; the root PoP verifies; ceremonyId not replayed;
 * the shared root-key birth invariants (`mintRootKeyRow`: once-per-root, cross-root-fingerprint uniqueness). Then a
 * BIRTH RECEIPT on the reserved `id:{rootId}` V4 chain — its HEAD is node-signed (chain integrity), and the root's OWN
 * ceremony signature is EMBEDDED in the payload (a verifiable self-attestation; we do NOT claim the head is "signed as
 * herself").
 *
 * CLAIM DISCIPLINE: PROVEN-LAB only. Identity is now CEREMONY-MINTED IN THE LAB — NOT production/legal identity. NO
 * recovery (phrase loss = identity loss; remedy = re-ceremony under a new rootId). NO claim of privacy, compliance,
 * duress safety, or bare-device recovery (the DERIVE salt-recovery strategy is UNRESOLVED — the server stores nothing
 * about the salt). echo.auma (the agent mirror) is NOT built here — DESIGNED/FUTURE, and it must be an INDEPENDENTLY
 * minted ML-DSA key, never derived from the root phrase.
 */
import { mutation } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { stableStringify, sha256Hex } from "./aukoraCore";
import { verifyChainHeadV3, type ChainHeadFields } from "./aukoraSignedHead";
import { isPqcPublicKeyHex } from "./aukoraPqcSigner";
import { mintRootKeyRow, rootKeyFingerprint } from "./aumlokRootRegistry";
import { appendIdentityLifecycleReceipt, IDENTITY_NAME_RE } from "./aukoraReceipts";
import { consumeRateLimit } from "./aukoraRateLimit";

// B3.2 — per-DEPLOYMENT ceremony rate limit (ANTI-SPAM, NOT AUTHORITY). It caps how many self-sovereign mints a node
// commits per window so a flood of self-signed ceremonies cannot fill the registry with junk roots. It NEVER decides
// WHO may mint — the root proof-of-possession is the only authority, unchanged; a rate-exceeded root may mint after the
// window. Env-tunable (`AUKORA_CEREMONY_RATE_CAP`, default 60 / 60s). A failed mint rolls back its token, so only
// SUCCESSFUL mints count against the budget (registry-growth throttle); invalid-attempt CPU-DoS is a separate
// HTTP/infra concern, not this gate.
const CEREMONY_RATE = (): { capacity: number; windowMs: number } => ({
  capacity: Number(process.env.AUKORA_CEREMONY_RATE_CAP) > 0 ? Number(process.env.AUKORA_CEREMONY_RATE_CAP) : 60,
  windowMs: 60_000,
});

const CEREMONY_FRESHNESS_MS = 60_000;
const THIS_NODE_ID = (): string => process.env.AUMA_NODE_ID ?? "aukora-node-a-demo";
const pick = (o: any, fields: readonly string[]) => { const r: any = {}; for (const f of fields) r[f] = o?.[f]; return r; };
const asName = (x: unknown, f: string): string => { if (typeof x !== "string" || !IDENTITY_NAME_RE.test(x)) throw new Error(`aumlok_ceremony_name_invalid:${f}`); return x; };

// ── The ceremony challenge: canonical serialization → V3 head, signed by the ROOT key under aumlokGenesis (B3.1 P3) ──
const CEREMONY_FIELDS = ["v", "ceremonyId", "rootId", "keyId", "nodeId", "fingerprint", "summaryHash", "timestamp"] as const;
export function serializeCeremonyV1(c: any): string { return "aukora-aumlok-genesis-v1|" + stableStringify(pick(c, CEREMONY_FIELDS)); }
export async function ceremonyHead(c: any): Promise<ChainHeadFields> {
  return { chainKey: `aumlok:genesis:${c?.rootId}`, timestamp: Number(c?.timestamp ?? 0), chainLength: 1, chainHeadHash: await sha256Hex(serializeCeremonyV1(c)) };
}

// ── The plain-language grant summary the user confirmed BEFORE signing (bound via summaryHash into the challenge) ──
const SUMMARY_FIELDS = ["v", "rootId", "keyId", "nodeId", "fingerprint", "noRecovery", "phraseTransitsServer", "statement"] as const;
export function serializeSummaryV1(s: any): string { return "aukora-aumlok-genesis-summary-v1|" + stableStringify(pick(s, SUMMARY_FIELDS)); }

/**
 * Self-sovereign root mint. NO operator: the root PoP is the authority. Args are PUBLIC material only.
 */
export const aumlokCeremonyMint = mutation({
  args: { publicKey: v.string(), challenge: v.any(), rootSig: v.string(), summary: v.any(), confirmedFingerprint: v.string() },
  handler: async (ctx, a): Promise<any> => {
    const c = a.challenge ?? {};
    if (c.v !== 1) throw new Error("aumlok_ceremony_version_unsupported");
    if (typeof a.rootSig !== "string" || !a.rootSig) throw new Error("aumlok_ceremony_signature_missing");
    const ceremonyId = asName(c.ceremonyId, "ceremonyId");
    const rootId = asName(c.rootId, "rootId");
    const keyId = asName(c.keyId, "keyId");
    if (typeof c.nodeId !== "string" || c.nodeId !== THIS_NODE_ID()) throw new Error("aumlok_ceremony_node_mismatch");
    if (!isPqcPublicKeyHex(a.publicKey)) throw new Error("aumlok_ceremony_pubkey_invalid");
    const fingerprint = rootKeyFingerprint(a.publicKey);

    // Fingerprint CONFIRMATION (procedural typo-catch, not recovery): the user-confirmed fingerprint AND the one bound
    // into the signed challenge must both equal sha256(publicKey).
    if (a.confirmedFingerprint !== fingerprint) throw new Error("aumlok_ceremony_fingerprint_mismatch");
    if (c.fingerprint !== fingerprint) throw new Error("aumlok_ceremony_fingerprint_unbound");

    // Timestamp hygiene + freshness (a captured ceremony cannot be replayed outside the window).
    if (!Number.isSafeInteger(c.timestamp) || c.timestamp <= 0) throw new Error("aumlok_ceremony_timestamp_invalid");
    if (Math.abs(Date.now() - Number(c.timestamp)) > CEREMONY_FRESHNESS_MS) throw new Error("aumlok_ceremony_stale");

    // The plain-language summary: bound into the challenge (tamper-evident) AND its structured claims enforced.
    const s = a.summary ?? {};
    if ((await sha256Hex(serializeSummaryV1(s))) !== c.summaryHash) throw new Error("aumlok_ceremony_summary_binding_mismatch");
    if (s.rootId !== rootId || s.keyId !== keyId || s.nodeId !== c.nodeId || s.fingerprint !== fingerprint) throw new Error("aumlok_ceremony_summary_field_mismatch");
    if (s.noRecovery !== true) throw new Error("aumlok_ceremony_summary_no_recovery_required"); // B2 truth: there is no recovery
    if (s.phraseTransitsServer !== false) throw new Error("aumlok_ceremony_summary_phrase_flag_required"); // the phrase never transits

    // ROOT PROOF-OF-POSSESSION: the public key must have signed THIS challenge → it owns the private key (and the
    // signature binds rootId/keyId/nodeId/fingerprint/summaryHash/ceremonyId/timestamp). Wrong key / wrong domain /
    // any tampered field → false (verifyChainHeadV3 never throws). This is the whole authority — no operator.
    if (!(await verifyChainHeadV3(a.publicKey, await ceremonyHead(c), a.rootSig, "aumlokGenesis"))) throw new Error("aumlok_ceremony_root_pop_invalid");

    // Replay: a ceremonyId is used exactly once (globally).
    if (await ctx.db.query("aumlok_ceremonies").withIndex("by_ceremonyId", (q) => q.eq("ceremonyId", ceremonyId)).first()) throw new Error("aumlok_ceremony_replay");

    // ANTI-SPAM (B3.2, NOT AUTHORITY): cap successful mints per deployment per window. The PoP above is the authority;
    // this only throttles registry growth (a rate-exceeded root may mint after the window).
    if (!(await consumeRateLimit(ctx, `ceremony:${c.nodeId}`, CEREMONY_RATE()))) throw new Error("aumlok_ceremony_rate_exceeded");

    // Shared birth invariants (once-per-root, cross-root fingerprint uniqueness, shape-gate) + insert the active root.
    await mintRootKeyRow(ctx, rootId, keyId, a.publicKey);

    await ctx.db.insert("aumlok_ceremonies", { ceremonyId, rootId, keyId, nodeId: c.nodeId, fingerprint, summaryHash: c.summaryHash, rootBirthSig: a.rootSig, createdAt: Date.now() });

    // BIRTH RECEIPT on id:{rootId}: head node-signed (chain integrity); the ROOT's own ceremony signature is EMBEDDED
    // in the payload (verifiable self-attestation). The full challenge is included so a verifier can recompute the head.
    const receiptId = await appendIdentityLifecycleReceipt(ctx, rootId, "aumlok.ceremony.birth", {
      rootId, keyId, fingerprint, nodeId: c.nodeId, ceremonyId, noRecovery: true, mintedBy: "ceremony-self-sovereign",
      challenge: pick(c, CEREMONY_FIELDS), rootBirthSig: a.rootSig,
    });
    return { ok: true, rootId, keyId, fingerprint, ceremonyId, receiptId };
  },
});
