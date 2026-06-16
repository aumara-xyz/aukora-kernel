// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/// <reference types="vite/client" />
/**
 * B2.2 — AUMLOK delegation MANIFESTS, proven against the REAL deployed mutations/query via convex-test. A manifest is
 * a doubly-signed root→subject delegation: ROOT signs under aumlokManifest, SUBJECT counter-signs PoP under
 * aumlokSubjectPop; both verify before active. Proven here: mint activation + V4 lifecycle receipt; missing/forged/
 * wrong-domain/tampered signatures refuse; unknown unsigned fields grant nothing; duplicate/malformed refuse; the
 * resolver (permission match, intent-codec membership, time window, root-revoked kills authority, retired-root
 * grandfathers); root-revoke (superior) + subject self-revoke/pause (own manifest only); and the ENFORCED circuit
 * breakers (maxUses OCC counter, maxPerWindow rate limit) with no replay/bypass.
 */
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { mlDsa65PublicKeyFromSeed } from "../convex/aukoraPqcSigner";
import { buildPoPEnvelope, POP_FRESHNESS_MS } from "../convex/popResolver";
import { signChainHeadV3, SIGNED_HEAD_V4_ALG } from "../convex/aukoraSignedHead";
import { rootKeyFingerprint, rotationHead } from "../convex/aumlokRootRegistry";
import { manifestRootHead, manifestPopHead, rootRevokeHead, subjectRevokeHead, consumeHead, resolveManifestAuthority } from "../convex/aumlokManifests";
import { verifyReceiptChainCore } from "../convex/aukoraReceipts";

const modules = import.meta.glob("../convex/**/*.*s");
const OPERATOR_SEED = "ab".repeat(32);
const ROOT_SEED = "11".repeat(32), ROOT2_SEED = "44".repeat(32);
const SUBJECT_SEED = "55".repeat(32), ATTACKER_SEED = "ee".repeat(32);
const NODE = "aukora-node-a-demo";

async function setup(run: string) {
  const t = convexTest(schema, modules);
  const opPub = await mlDsa65PublicKeyFromSeed(OPERATOR_SEED);
  const founderUserId = `demo.operator:${run}`, opKeyId = "op-1", now = Date.now();
  await t.mutation(internal.popResolver.seedFounderKey, { founderUserId, keyId: opKeyId, publicKey: opPub });
  const cav = (capId: string, methods: string[], over: any = {}) => ({
    v: 1, capId, founderUserId, founderKeyId: opKeyId, nodeId: NODE, methods, ring: "local-write", action: "aumlok",
    resource: "aumlok:root", principalId: founderUserId, roles: ["operator"], notBefore: now - 1000, expiresAt: now + POP_FRESHNESS_MS, maxUses: 1, ...over,
  });
  // genesis root-a/rk-1 (B2.1, operator-PoP-gated)
  const rootPub = await mlDsa65PublicKeyFromSeed(ROOT_SEED);
  const gArgs = { rootId: "root-a", keyId: "rk-1", publicKey: rootPub };
  const gEnv = await buildPoPEnvelope(OPERATOR_SEED, cav("cap-g", ["aumlokGenesisMint"]), { methodId: "aumlokGenesisMint", actualArgs: gArgs, timestamp: Date.now(), nonce: `g-${run}` });
  await t.mutation(api.aumlokRootRegistry.aumlokGenesisMint, { env: gEnv, actualArgs: gArgs, nodeId: NODE });
  const subjectPub = await mlDsa65PublicKeyFromSeed(SUBJECT_SEED);
  return { t, cav, subjectPub };
}

function mkManifest(subjectPub: string, over: any = {}) {
  const now = Date.now();
  return {
    v: 1, manifestId: "mft-1", rootId: "root-a", rootKeyId: "rk-1", nodeId: "aukora-node-a-demo", // matches AUMA_NODE_ID (vitest.config)
    subjectId: "agent-echo", subjectKind: "agent", subjectPubKey: subjectPub,
    permissions: [{ ring: "local-write", action: "echo", resource: "echo:demo" }],
    allowedIntentCodecs: ["json_action_v1"],
    notBefore: now - 1000, expiresAt: now + 3_600_000, maxUses: null, maxPerWindow: null, createdAt: now, ...over,
  };
}
async function mint(t: any, m: any, opts: { rootSeed?: string; subjectSeed?: string; rootDomain?: any; subjectDomain?: any; rootSig?: string; subjectPopSig?: string; sendManifest?: any } = {}) {
  const rootSig = opts.rootSig ?? (await signChainHeadV3(opts.rootSeed ?? ROOT_SEED, await manifestRootHead(m), opts.rootDomain ?? "aumlokManifest"));
  const subjectPopSig = opts.subjectPopSig ?? (await signChainHeadV3(opts.subjectSeed ?? SUBJECT_SEED, await manifestPopHead(m), opts.subjectDomain ?? "aumlokSubjectPop"));
  return t.mutation(api.aumlokManifests.aumlokMintManifest, { manifest: opts.sendManifest ?? m, rootSig, subjectPopSig });
}
const resolve = (t: any, manifestId: string, over: any = {}) =>
  t.query(api.aumlokManifests.aumlokManifestResolve, { manifestId, ring: "local-write", action: "echo", resource: "echo:demo", intentCodec: "json_action_v1", ...over });
const mrow = (t: any, manifestId: string) => t.run(async (ctx: any) => ctx.db.query("aumlok_manifests").withIndex("by_manifestId", (q: any) => q.eq("manifestId", manifestId)).first());
async function rotateRoot(t: any, cav: any, oldSeed: string, newKeyId: string, newPub: string, nonce: string) {
  const stmt = { v: 1, rootId: "root-a", oldKeyId: "rk-1", newKeyId, newPublicKey: newPub, newFingerprint: rootKeyFingerprint(newPub), reason: "scheduled", timestamp: Date.now() };
  const rotationSig = await signChainHeadV3(oldSeed, await rotationHead(stmt), "aumlokRotation");
  const actualArgs = { statement: stmt, rotationSig };
  const env = await buildPoPEnvelope(OPERATOR_SEED, cav(`cap-${nonce}`, ["aumlokRotateRoot"]), { methodId: "aumlokRotateRoot", actualArgs, timestamp: Date.now(), nonce });
  return t.mutation(api.aumlokRootRegistry.aumlokRotateRoot, { env, actualArgs, nodeId: NODE });
}
async function revokeRoot(t: any, cav: any, keyId: string, nonce: string) {
  const actualArgs = { rootId: "root-a", keyId, reason: "compromise" };
  const env = await buildPoPEnvelope(OPERATOR_SEED, cav(`cap-${nonce}`, ["aumlokRevokeRoot"]), { methodId: "aumlokRevokeRoot", actualArgs, timestamp: Date.now(), nonce });
  return t.mutation(api.aumlokRootRegistry.aumlokRevokeRoot, { env, actualArgs, nodeId: NODE });
}
async function consume(t: any, manifestId: string, useSeq: number, over: any = {}, subjectSeed = SUBJECT_SEED) {
  const r = { v: 1, manifestId, subjectId: "agent-echo", action: "echo", resource: "echo:demo", ring: "local-write", intentCodec: "json_action_v1", useSeq, timestamp: Date.now(), ...over };
  const subjectSig = await signChainHeadV3(subjectSeed, await consumeHead(r), "aumlokSubjectPop");
  return t.mutation(api.aumlokManifests.aumlokManifestConsume, { req: over.sendReq ?? r, subjectSig });
}

describe("B2.2 — manifest mint (doubly-signed; both verify before active)", () => {
  it("valid manifest activates + a V4 mft: lifecycle receipt verifies; resolve grants the signed permission", async () => {
    const { t, subjectPub } = await setup("m1");
    const r: any = await mint(t, mkManifest(subjectPub));
    expect(r.ok).toBe(true);
    expect(r.subjectFingerprint).toBe(rootKeyFingerprint(subjectPub));
    expect((await mrow(t, "mft-1")).status).toBe("active");
    const v: any = await t.run(async (ctx: any) => verifyReceiptChainCore(ctx, "mft:mft-1", 1000));
    expect([v.ok, v.status, v.headCount]).toEqual([true, "verified", 1]);
    const head = await t.run(async (ctx: any) => ctx.db.query("auma_receipt_chain_head").withIndex("by_key", (q: any) => q.eq("key", "mft:mft-1")).first());
    expect(head.headSigAlg).toBe(SIGNED_HEAD_V4_ALG);
    expect((await resolve(t, "mft-1")).ok).toBe(true);
  });
  it("missing rootSig or missing subjectPopSig refuses (both required)", async () => {
    const { t, subjectPub } = await setup("m2");
    await expect(mint(t, mkManifest(subjectPub), { rootSig: "" })).rejects.toThrow("aumlok_mft_signature_missing");
    await expect(mint(t, mkManifest(subjectPub), { subjectPopSig: "" })).rejects.toThrow("aumlok_mft_signature_missing");
    expect(await mrow(t, "mft-1")).toBeNull();
  });
  it("wrong FIPS 204 domain refuses (root sig under 'manifest', subject sig under 'cap')", async () => {
    const { t, subjectPub } = await setup("m3");
    await expect(mint(t, mkManifest(subjectPub), { rootDomain: "manifest" })).rejects.toThrow("aumlok_mft_root_sig_invalid");
    await expect(mint(t, mkManifest(subjectPub), { subjectDomain: "cap" })).rejects.toThrow("aumlok_mft_subject_pop_invalid");
  });
  it("a tampered field after signing refuses (the commitment no longer matches the signature)", async () => {
    const { t, subjectPub } = await setup("m4");
    const m = mkManifest(subjectPub);
    // change a VALID-but-different field after signing (extend expiry) — passes validation, breaks the signature
    const tampered = { ...m, expiresAt: m.expiresAt + 999_999 };
    await expect(mint(t, m, { sendManifest: tampered })).rejects.toThrow("aumlok_mft_root_sig_invalid");
    expect(await mrow(t, "mft-1")).toBeNull();
  });
  it("a forged signature refuses (attacker root seed → root_sig; attacker subject seed → subject_pop)", async () => {
    const { t, subjectPub } = await setup("m5");
    await expect(mint(t, mkManifest(subjectPub), { rootSeed: ATTACKER_SEED })).rejects.toThrow("aumlok_mft_root_sig_invalid");
    await expect(mint(t, mkManifest(subjectPub), { subjectSeed: ATTACKER_SEED })).rejects.toThrow("aumlok_mft_subject_pop_invalid");
  });
  it("an unknown unsigned field grants NOTHING (dropped before hashing+storage; sig still verifies)", async () => {
    const { t, subjectPub } = await setup("m6");
    const m = mkManifest(subjectPub);
    // sign the canonical manifest; SEND it with an extra top-level field that purports to grant admin
    const r: any = await mint(t, m, { sendManifest: { ...m, extraPermissions: [{ ring: "core", action: "admin", resource: "*" }], evil: true } });
    expect(r.ok).toBe(true); // the extra fields are dropped by canonicalManifest, so the sig over the canonical bytes still verifies
    const row = await mrow(t, "mft-1");
    expect(row.extraPermissions).toBeUndefined();
    expect(row.evil).toBeUndefined();
    expect((await resolve(t, "mft-1", { action: "admin", resource: "*", ring: "core" })).reason).toBe("permission_denied"); // the smuggled grant is inert
  });
  it("duplicate manifestId refuses (immutable v1: amend = revoke + re-mint)", async () => {
    const { t, subjectPub } = await setup("m7");
    expect((await mint(t, mkManifest(subjectPub))).ok).toBe(true);
    await expect(mint(t, mkManifest(subjectPub))).rejects.toThrow("aumlok_mft_manifestid_exists");
  });
  it("malformed ids / subjectKind / subject pubkey refuse", async () => {
    const { t, subjectPub } = await setup("m8");
    await expect(mint(t, mkManifest(subjectPub, { manifestId: "mft:1" }))).rejects.toThrow("aumlok_mft_name_invalid:manifestId");
    await expect(mint(t, mkManifest(subjectPub, { subjectId: "Bad Subject" }))).rejects.toThrow("aumlok_mft_name_invalid:subjectId");
    await expect(mint(t, mkManifest(subjectPub, { subjectKind: "overlord" }))).rejects.toThrow("aumlok_mft_subjectkind_invalid");
    await expect(mint(t, mkManifest(subjectPub, { subjectPubKey: ROOT_SEED /* 64-hex seed, not a pubkey */ }))).rejects.toThrow("aumlok_mft_subject_pubkey_invalid");
  });
  it("a RETIRED root key cannot mint a NEW manifest (only an active key may delegate)", async () => {
    const { t, cav, subjectPub } = await setup("m9");
    await rotateRoot(t, cav, ROOT_SEED, "rk-2", await mlDsa65PublicKeyFromSeed(ROOT2_SEED), "m9-rot"); // rk-1 → retired
    await expect(mint(t, mkManifest(subjectPub))).rejects.toThrow("aumlok_mft_root_key_retired");
  });
  it("FIX 1 — a manifest is bound to its NODE: a foreign nodeId refuses at mint, and tampering nodeId refuses", async () => {
    const { t, subjectPub } = await setup("m10");
    // minted for another node → refused on this node (this node = aukora-node-a-demo via AUMA_NODE_ID)
    await expect(mint(t, mkManifest(subjectPub, { nodeId: "aukora-node-b-demo" }))).rejects.toThrow("aumlok_mft_node_mismatch");
    // sign for THIS node, then swap nodeId to another node before sending → refused (the swapped node isn't this node)
    const m = mkManifest(subjectPub);
    await expect(mint(t, m, { sendManifest: { ...m, nodeId: "aukora-node-b-demo" } })).rejects.toThrow("aumlok_mft_node_mismatch");
    expect(await mrow(t, "mft-1")).toBeNull();
  });
  it("FIX 2 — ring ceiling at mint: self-modify refused (its own error); unknown/typo rings refused", async () => {
    const { t, subjectPub } = await setup("m11");
    const perm = (ring: string) => ({ permissions: [{ ring, action: "echo", resource: "echo:demo" }] });
    await expect(mint(t, mkManifest(subjectPub, perm("self-modify")))).rejects.toThrow("aumlok_mft_ring_self_modify");
    await expect(mint(t, mkManifest(subjectPub, perm("local-wrlte")))).rejects.toThrow("aumlok_mft_ring_invalid"); // typo
    await expect(mint(t, mkManifest(subjectPub, perm("core")))).rejects.toThrow("aumlok_mft_ring_invalid");        // unknown
    // the three whitelisted rings all mint
    for (const ring of ["observe", "local-write", "external"]) {
      const { t: t2, subjectPub: sp } = await setup(`m11-${ring}`);
      expect((await mint(t2, mkManifest(sp, perm(ring)))).ok).toBe(true);
    }
  });
  it("multiple manifests per subject fingerprint are intended (the manifest-is-a-device/role-record model)", async () => {
    const { t, subjectPub } = await setup("m12");
    expect((await mint(t, mkManifest(subjectPub, { manifestId: "mft-1" }))).ok).toBe(true);
    expect((await mint(t, mkManifest(subjectPub, { manifestId: "mft-2", permissions: [{ ring: "observe", action: "read", resource: "studio:x" }] }))).ok).toBe(true);
    const fp = rootKeyFingerprint(subjectPub);
    const rows = await t.run(async (ctx: any) => ctx.db.query("aumlok_manifests").withIndex("by_subject_fingerprint", (q: any) => q.eq("subjectFingerprint", fp)).collect());
    expect(rows.length).toBe(2); // one subject key, two distinct delegations — BY DESIGN
  });
});

describe("B2.2 — resolver (fail-closed authority pipeline)", () => {
  it("permission match: a non-granted ring/action/resource is denied", async () => {
    const { t, subjectPub } = await setup("r1");
    await mint(t, mkManifest(subjectPub));
    expect((await resolve(t, "mft-1")).ok).toBe(true);
    expect((await resolve(t, "mft-1", { action: "delete" })).reason).toBe("permission_denied");
    expect((await resolve(t, "mft-1", { resource: "echo:other" })).reason).toBe("permission_denied");
    expect((await resolve(t, "mft-1", { ring: "core" })).reason).toBe("permission_denied");
  });
  it("intent-codec policy: only a codec listed in the signed allowedIntentCodecs resolves", async () => {
    const { t, subjectPub } = await setup("r2");
    await mint(t, mkManifest(subjectPub)); // allows json_action_v1 only
    expect((await resolve(t, "mft-1", { intentCodec: "json_action_v1" })).ok).toBe(true);
    expect((await resolve(t, "mft-1", { intentCodec: "vk_v1" })).reason).toBe("codec_not_allowed"); // vk_v1 is FUTURE, not granted
  });
  it("time window: before notBefore → not_yet_valid; at/after expiresAt → expired", async () => {
    const { t, subjectPub } = await setup("r3");
    const now = Date.now();
    await mint(t, mkManifest(subjectPub, { notBefore: now + 10_000, expiresAt: now + 20_000 }));
    // injected `now` is test-only (the deployed query uses server time); drive the resolver function directly
    const at = (nowArg: number) => t.run(async (ctx: any) => resolveManifestAuthority(ctx, { manifestId: "mft-1", ring: "local-write", action: "echo", resource: "echo:demo", intentCodec: "json_action_v1", now: nowArg }));
    expect((await at(now)).reason).toBe("manifest_not_yet_valid");
    expect((await at(now + 15_000)).ok).toBe(true);
    expect((await at(now + 25_000)).reason).toBe("manifest_expired");
  });
  it("FIX 1 — cross-node replay: a manifest bound to another node grants NOTHING here (the B3 import scenario)", async () => {
    const { t, subjectPub } = await setup("r-node");
    await mint(t, mkManifest(subjectPub));
    expect((await resolve(t, "mft-1")).ok).toBe(true);
    // simulate the row arriving from node B (a future mesh import): its signed nodeId is not this node's
    await t.run(async (ctx: any) => { const m = await ctx.db.query("aumlok_manifests").withIndex("by_manifestId", (q: any) => q.eq("manifestId", "mft-1")).first(); await ctx.db.patch(m._id, { nodeId: "aukora-node-b-demo" }); });
    expect((await resolve(t, "mft-1")).reason).toBe("node_mismatch");
  });
  it("a REVOKED root key kills manifest authority (B2.1 root revoke → resolve refuses)", async () => {
    const { t, cav, subjectPub } = await setup("r4");
    await mint(t, mkManifest(subjectPub));
    expect((await resolve(t, "mft-1")).ok).toBe(true);
    await revokeRoot(t, cav, "rk-1", "r4-rev");
    expect((await resolve(t, "mft-1")).reason).toBe("root_revoked");
  });
  it("a RETIRED root grandfathers an existing manifest (it still resolves after rotation)", async () => {
    const { t, cav, subjectPub } = await setup("r5");
    await mint(t, mkManifest(subjectPub)); // minted while rk-1 active
    await rotateRoot(t, cav, ROOT_SEED, "rk-2", await mlDsa65PublicKeyFromSeed(ROOT2_SEED), "r5-rot"); // rk-1 → retired
    expect((await resolve(t, "mft-1")).ok).toBe(true); // retired (not revoked) → grandfathered
  });
});

describe("B2.2 — revocation (root superior; subject self-revoke/pause, own manifest only)", () => {
  async function rootRevoke(t: any, manifestId: string, seed = ROOT_SEED, domain: any = "aumlokManifest") {
    const s = { v: 1, manifestId, action: "revoke", reason: "policy", timestamp: Date.now() };
    const rootSig = await signChainHeadV3(seed, await rootRevokeHead(s), domain);
    return t.mutation(api.aumlokManifests.aumlokRevokeManifest, { statement: s, rootSig });
  }
  async function selfAction(t: any, manifestId: string, action: string, seed = SUBJECT_SEED) {
    const s = { v: 1, manifestId, action, reason: "subject", timestamp: Date.now() };
    const subjectSig = await signChainHeadV3(seed, await subjectRevokeHead(s), "aumlokSubjectPop");
    return t.mutation(api.aumlokManifests.aumlokManifestSelfRevoke, { statement: s, subjectSig });
  }
  it("root revoke (superior) → manifest revoked; resolve refuses; receipt appended", async () => {
    const { t, subjectPub } = await setup("v1");
    await mint(t, mkManifest(subjectPub));
    const r: any = await rootRevoke(t, "mft-1");
    expect([r.ok, r.by]).toEqual([true, "root"]);
    expect((await mrow(t, "mft-1")).status).toBe("revoked");
    expect((await resolve(t, "mft-1")).reason).toBe("manifest_revoked");
    const v: any = await t.run(async (ctx: any) => verifyReceiptChainCore(ctx, "mft:mft-1", 1000));
    expect([v.ok, v.headCount]).toEqual([true, 2]); // mint + revoke
  });
  it("subject self-revoke / pause affects only its OWN manifest (root + other manifests untouched)", async () => {
    const { t, subjectPub } = await setup("v2");
    await mint(t, mkManifest(subjectPub, { manifestId: "mft-1" }));
    await mint(t, mkManifest(subjectPub, { manifestId: "mft-2" }));
    expect((await selfAction(t, "mft-1", "pause")).ok).toBe(true);
    expect((await mrow(t, "mft-1")).status).toBe("paused");
    expect((await resolve(t, "mft-1")).reason).toBe("manifest_paused");
    expect((await mrow(t, "mft-2")).status).toBe("active");                  // sibling untouched
    expect((await resolve(t, "mft-2")).ok).toBe(true);
    expect((await t.run(async (ctx: any) => ctx.db.query("aumlok_root_keys").withIndex("by_root", (q: any) => q.eq("rootId", "root-a")).collect())).every((k: any) => k.status === "active")).toBe(true); // root untouched
    expect((await selfAction(t, "mft-1", "revoke")).ok).toBe(true);          // paused → self-revoke
    expect((await mrow(t, "mft-1")).status).toBe("revoked");
  });
  it("subject self-revoke needs the subject's OWN key; root-revoked is terminal (subject can't un-revoke)", async () => {
    const { t, subjectPub } = await setup("v3");
    await mint(t, mkManifest(subjectPub));
    await expect(selfAction(t, "mft-1", "revoke", ATTACKER_SEED)).rejects.toThrow("aumlok_mft_subject_sig_invalid");
    await rootRevoke(t, "mft-1"); // root revokes (superior)
    await expect(selfAction(t, "mft-1", "pause")).rejects.toThrow("aumlok_mft_already_revoked"); // terminal — subject can't override root
  });
  it("root revoke refuses a wrong-domain / forged root signature", async () => {
    const { t, subjectPub } = await setup("v4");
    await mint(t, mkManifest(subjectPub));
    await expect(rootRevoke(t, "mft-1", ROOT_SEED, "manifest")).rejects.toThrow("aumlok_mft_root_sig_invalid"); // wrong domain
    await expect(rootRevoke(t, "mft-1", ATTACKER_SEED)).rejects.toThrow("aumlok_mft_root_sig_invalid");         // forged
    expect((await mrow(t, "mft-1")).status).toBe("active");
  });
  it("revoke authority follows the CURRENT active key: a retired (minting) key can't revoke; the new active key can", async () => {
    const { t, cav, subjectPub } = await setup("v5");
    await mint(t, mkManifest(subjectPub)); // minted by rk-1 (active)
    await rotateRoot(t, cav, ROOT_SEED, "rk-2", await mlDsa65PublicKeyFromSeed(ROOT2_SEED), "v5-rot"); // rk-1 → retired, rk-2 active
    // rk-1 (now retired, the MINTING key) can no longer revoke — only active keys author new actions
    await expect(rootRevoke(t, "mft-1", ROOT_SEED)).rejects.toThrow("aumlok_mft_root_sig_invalid");
    expect((await mrow(t, "mft-1")).status).toBe("active"); // still active (resolver grandfathers the retired-minted manifest)
    expect((await resolve(t, "mft-1")).ok).toBe(true);
    // the CURRENT active key rk-2 governs the identity's delegations → it CAN revoke the old manifest
    expect((await rootRevoke(t, "mft-1", ROOT2_SEED)).ok).toBe(true);
    expect((await mrow(t, "mft-1")).status).toBe("revoked");
  });
});

describe("B2.2 — circuit breakers (signed AND enforced; no bypass)", () => {
  it("maxUses is enforced by an OCC counter; the cap refuses and a replayed useSeq cannot bypass it", async () => {
    const { t, subjectPub } = await setup("c1");
    await mint(t, mkManifest(subjectPub, { maxUses: 2 }));
    expect((await consume(t, "mft-1", 0)).useSeq).toBe(0); // usedCount 0 → 1
    expect((await consume(t, "mft-1", 1)).usedCount).toBe(2); // usedCount 1 → 2
    await expect(consume(t, "mft-1", 2)).rejects.toThrow("aumlok_mft_max_uses_exceeded"); // at the cap
    await expect(consume(t, "mft-1", 0)).rejects.toThrow("aumlok_mft_useseq_mismatch");   // replay an old useSeq → refused
    expect((await mrow(t, "mft-1")).usedCount).toBe(2); // counter never exceeded the cap
  });
  it("maxPerWindow is enforced by the token-bucket rate limiter", async () => {
    const { t, subjectPub } = await setup("c2");
    await mint(t, mkManifest(subjectPub, { maxPerWindow: { capacity: 1, windowMs: 60_000 } }));
    expect((await consume(t, "mft-1", 0)).ok).toBe(true);                                  // first use spends the only token
    await expect(consume(t, "mft-1", 1)).rejects.toThrow("aumlok_mft_rate_exceeded");      // second within the window → refused
  });
  it("consume requires a valid, fresh, correctly-ordered subject PoP", async () => {
    const { t, subjectPub } = await setup("c3");
    await mint(t, mkManifest(subjectPub));
    await expect(consume(t, "mft-1", 0, {}, ATTACKER_SEED)).rejects.toThrow("aumlok_mft_subject_pop_invalid"); // wrong key
    await expect(consume(t, "mft-1", 0, { timestamp: Date.now() - 5 * 60_000 })).rejects.toThrow("aumlok_mft_stale"); // stale
    await expect(consume(t, "mft-1", 5)).rejects.toThrow("aumlok_mft_useseq_mismatch"); // out-of-order useSeq
    await expect(consume(t, "mft-1", 0, { action: "delete" })).rejects.toThrow("aumlok_mft_permission_denied"); // resolver still gates
  });
  it("the signed subjectId is enforced at consume (a request claiming a different subjectId refuses)", async () => {
    const { t, subjectPub } = await setup("c4");
    await mint(t, mkManifest(subjectPub)); // subjectId = "agent-echo"
    // sign a consume with the REAL subject key but claiming a different subjectId → PoP verifies, but subjectId mismatches
    await expect(consume(t, "mft-1", 0, { subjectId: "impostor" })).rejects.toThrow("aumlok_mft_subject_mismatch");
    expect((await consume(t, "mft-1", 0)).ok).toBe(true); // the correct subjectId still works
  });
});

describe("B2.2 — manifest receipt reservation", () => {
  it("general receipt writers cannot write mft:* (writeReceiptRow refuses the reserved prefix)", async () => {
    const { t } = await setup("res");
    const base = { goal: "g", actorModel: "m", lane: "local" as const, risk: "low" as const, grade: "A" as const, verdict: "kept" as const, actionsJson: "{}", proofJson: "{}", decisionLogId: "x" };
    const { writeReceiptRow } = await import("../convex/aukoraReceipts");
    await expect(t.run(async (ctx: any) => writeReceiptRow(ctx, { chainKey: "mft:mft-1", ...base }))).rejects.toThrow("aukora_receipt_chainkey_reserved_prefix_mft");
  });
});

describe("B2.2 — input boundary validation (scope / codec / array bounds at mint)", () => {
  it("permission scope fields reject empty, oversized, control-char, and non-ASCII", async () => {
    const { t, subjectPub } = await setup("b1");
    const perm = (over: any) => ({ permissions: [{ ring: "local-write", action: "echo", resource: "echo:demo", ...over }] });
    await expect(mint(t, mkManifest(subjectPub, perm({ ring: "" })))).rejects.toThrow("aumlok_mft_ring_invalid"); // ring is whitelisted (FIX 2), not a free scope
    await expect(mint(t, mkManifest(subjectPub, perm({ action: "a".repeat(129) })))).rejects.toThrow("aumlok_mft_scope_invalid:action");
    await expect(mint(t, mkManifest(subjectPub, perm({ resource: "echo\x00demo" })))).rejects.toThrow("aumlok_mft_scope_invalid:resource"); // control char (not printable ASCII)
    await expect(mint(t, mkManifest(subjectPub, perm({ resource: "café" })))).rejects.toThrow("aumlok_mft_scope_invalid:resource"); // non-ASCII
  });
  it("permissions array bounds: empty array and >64 entries refuse", async () => {
    const { t, subjectPub } = await setup("b2");
    await expect(mint(t, mkManifest(subjectPub, { permissions: [] }))).rejects.toThrow("aumlok_mft_permissions_invalid");
    const many = Array.from({ length: 65 }, () => ({ ring: "r", action: "a", resource: "res" }));
    await expect(mint(t, mkManifest(subjectPub, { permissions: many }))).rejects.toThrow("aumlok_mft_permissions_invalid");
  });
  it("intent-codec bounds: empty list, >16 entries, empty/oversized/invalid codec names refuse", async () => {
    const { t, subjectPub } = await setup("b3");
    await expect(mint(t, mkManifest(subjectPub, { allowedIntentCodecs: [] }))).rejects.toThrow("aumlok_mft_codecs_invalid");
    await expect(mint(t, mkManifest(subjectPub, { allowedIntentCodecs: Array.from({ length: 17 }, (_, i) => `codec_${i}`) }))).rejects.toThrow("aumlok_mft_codecs_invalid");
    await expect(mint(t, mkManifest(subjectPub, { allowedIntentCodecs: [""] }))).rejects.toThrow("aumlok_mft_codec_invalid");
    await expect(mint(t, mkManifest(subjectPub, { allowedIntentCodecs: ["a".repeat(33)] }))).rejects.toThrow("aumlok_mft_codec_invalid");
    await expect(mint(t, mkManifest(subjectPub, { allowedIntentCodecs: ["JSON_ACTION_V1"] }))).rejects.toThrow("aumlok_mft_codec_invalid"); // uppercase not allowed
  });
  it("circuit-breaker limits reject non-positive / non-integer values (no zero/NaN maxUses or window)", async () => {
    const { t, subjectPub } = await setup("b4");
    await expect(mint(t, mkManifest(subjectPub, { maxUses: 0 }))).rejects.toThrow("aumlok_mft_int_invalid:maxUses");
    await expect(mint(t, mkManifest(subjectPub, { maxUses: 1.5 }))).rejects.toThrow("aumlok_mft_int_invalid:maxUses");
    await expect(mint(t, mkManifest(subjectPub, { maxPerWindow: { capacity: 0, windowMs: 1000 } }))).rejects.toThrow("aumlok_mft_int_invalid:maxPerWindow.capacity");
    await expect(mint(t, mkManifest(subjectPub, { notBefore: NaN }))).rejects.toThrow("aumlok_mft_int_invalid:notBefore");
  });
});
