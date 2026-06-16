// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/// <reference types="vite/client" />
/**
 * B3.5b — SIGNED CROSS-NODE GRANT (cross-node EFFECT authority). A manifest a foreign root deliberately signed FOR this
 * node, promoted (flag+PoP-gated) into the isolated node_cross_grants surface, then resolved + consumed through the ONE
 * unchanged consume chokepoint — every foreign effect issuer-tagged. Proves the happy path AND every one-way-door guard:
 * unpinned/rootId-bound pin, root_key_unknown (local rootId never foreign-falls-through), manifestId collisions,
 * node_mismatch (no lift), demo quarantine, revocation/stale fail-closed, OCC double-spend, crossgrant flag OFF.
 */
import { convexTest } from "convex-test";
import { describe, it, expect, afterEach } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { mlDsa65PublicKeyFromSeed, pqcSign } from "../convex/aukoraPqcSigner";
import { buildPoPEnvelope, DEMO_OPERATOR_SEED } from "../convex/popResolver";
import { signChainHeadV3 } from "../convex/aukoraSignedHead";
import { manifestHash, manifestRootHead, manifestPopHead, consumeHead } from "../convex/aumlokManifests";
import { serializeRevocationViewV1 } from "../convex/nodeImport";
import { utf8ToBytes } from "@noble/hashes/utils.js";

const modules = import.meta.glob("../convex/**/*.*s");
const NODE = "aukora-node-a-demo";                       // THIS node (vitest pins AUMA_NODE_ID)
const FR_SEED = "c1".repeat(32), SUBJ_SEED = "d2".repeat(32);
const SRC = "peerB", FROOT = "root.peerB", RKID = "rk-1", SUBJECT = "agent-echo", MFT = "mft-xg";

async function buildCrossManifest(over: any = {}) {
  const frPub = await mlDsa65PublicKeyFromSeed(FR_SEED), subjPub = await mlDsa65PublicKeyFromSeed(SUBJ_SEED), now = Date.now();
  const rootId = over.rootId ?? FROOT;
  const m: any = { v: 1, manifestId: over.manifestId ?? MFT, rootId, rootKeyId: over.rootKeyId ?? RKID, nodeId: over.nodeId ?? NODE, subjectId: SUBJECT, subjectKind: "agent", subjectPubKey: subjPub, subjectFingerprint: "fp", permissions: [{ ring: "local-write", action: "memory.write", resource: `mem:${rootId}` }], allowedIntentCodecs: ["json_action_v1"], notBefore: now - 1000, expiresAt: now + 3_600_000, maxUses: over.maxUses ?? null, maxPerWindow: null, createdAt: now };
  return { frPub, manifest: { ...m, manifestHash: await manifestHash(m), rootSig: await signChainHeadV3(FR_SEED, await manifestRootHead(m), "aumlokManifest"), subjectPopSig: await signChainHeadV3(SUBJ_SEED, await manifestPopHead(m), "aumlokSubjectPop") } };
}
async function recordView(t: any, rootId: string, revoked: string[], epoch = 1) {
  const sig = await pqcSign(FR_SEED, utf8ToBytes(serializeRevocationViewV1({ sourceNodeId: SRC, rootId, epoch, revokedManifestIds: revoked, timestamp: 1 })), "aukoraNodeImport");
  return t.mutation(internal.nodeImport.recordRevocationView, { view: { sourceNodeId: SRC, rootId, rootKeyId: RKID, epoch, revokedManifestIds: revoked, timestamp: 1, sig } });
}
async function promoteEnv(manifest: any) {
  const now = Date.now();
  const cav = { v: 1, capId: `cap-pr-${manifest.manifestId}-${Math.random().toString(36).slice(2)}`, founderUserId: "aukora.operator", founderKeyId: "op-1", nodeId: NODE, methods: ["promoteCrossGrant"], ring: "local-write", action: "operator", resource: "node:operator", principalId: "demo.operator", roles: ["operator"], notBefore: now - 2000, expiresAt: now + 60_000, maxUses: 1 };
  return buildPoPEnvelope(DEMO_OPERATOR_SEED, cav, { methodId: "promoteCrossGrant", actualArgs: { sourceNodeId: SRC, manifestId: manifest.manifestId, manifestHash: manifest.manifestHash }, timestamp: now, nonce: `n-${cav.capId}` });
}
const promote = async (t: any, manifest: any) => t.mutation(internal.nodeImport.promoteCrossGrant, { env: { manifest, sourceNodeId: SRC }, promotionEnv: await promoteEnv(manifest) });
const resolveX = (t: any, manifestId = MFT, root = FROOT) => t.query(api.aumlokManifests.aumlokManifestResolve, { manifestId, ring: "local-write", action: "memory.write", resource: `mem:${root}`, intentCodec: "json_action_v1" });

// pin the rootId-bound foreign root + provision the operator + record a fresh revocation view. flag ON for promote.
async function setup(over: any = {}) {
  process.env.AUKORA_B3_CROSSGRANT_ENABLED = "1";
  const t = convexTest(schema, modules);
  const { frPub, manifest } = await buildCrossManifest(over);
  if (!over.skipPin) await t.mutation(internal.nodeB.pinTrust, { sourceNodeId: SRC, headKeyId: `root:${manifest.rootKeyId}`, publicKey: frPub, rootId: manifest.rootId });
  await t.mutation(internal.popResolver.seedFounderKey, { founderUserId: "aukora.operator", keyId: "op-1", publicKey: await mlDsa65PublicKeyFromSeed(DEMO_OPERATOR_SEED) });
  if (!over.skipView) await recordView(t, manifest.rootId, over.revoked ?? []);
  return { t, frPub, manifest };
}
async function xWrite(t: any, useSeq = 0, value = "foreign note") {
  const r = { v: 1, manifestId: MFT, subjectId: SUBJECT, ring: "local-write", action: "memory.write", resource: `mem:${FROOT}`, intentCodec: "json_action_v1", useSeq, timestamp: Date.now(), key: "diary" };
  const subjectSig = await signChainHeadV3(SUBJ_SEED, await consumeHead(r), "aumlokSubjectPop");
  return t.mutation(api.aumlokMemory.aumlokMemoryWrite, { req: r, subjectSig, value });
}

afterEach(() => { delete process.env.AUKORA_B3_CROSSGRANT_ENABLED; });

describe("B3.5b — cross-node grant: happy path (foreign effect, issuer-tagged)", () => {
  it("promote → resolve (issuer foreign) → memory write in the FOREIGN namespace, receipt tagged issuer:foreign", async () => {
    const { t, manifest } = await setup();
    expect(await promote(t, manifest)).toMatchObject({ ok: true, manifestId: MFT, sourceNodeId: SRC, rootId: FROOT });
    const res: any = await resolveX(t);
    expect([res.ok, res.issuer.kind, res.issuer.sourceNodeId]).toEqual([true, "foreign", SRC]);
    const w: any = await xWrite(t);
    expect([w.ok, w.ownerRootId]).toEqual([true, FROOT]);                                     // wrote mem:{foreignRoot}
    const row: any = await t.run((ctx: any) => ctx.db.query("aukora_memory").withIndex("by_owner_key", (q: any) => q.eq("ownerRootId", FROOT).eq("key", "diary")).first());
    expect(row.value).toBe("foreign note");
    const rcpt: any = await t.run((ctx: any) => ctx.db.query("auma_receipts").withIndex("by_chainKey_ts", (q: any) => q.eq("chainKey", `mem:${FROOT}:diary`)).first());
    const proof = JSON.parse(rcpt.proofJson);
    expect([proof.issuer, proof.issuerSourceNodeId, proof.issuerRootId, proof.issuerRootKeyId]).toEqual(["foreign", SRC, FROOT, RKID]);
    const grant: any = await t.run((ctx: any) => ctx.db.query("aukora_grants").withIndex("by_grantKey", (q: any) => q.eq("grantKey", `pg_mem_${MFT}_0`)).first());
    expect([grant.issuer, grant.issuerSourceNodeId]).toEqual(["foreign", SRC]);
    expect((await t.run((ctx: any) => ctx.db.query("node_cross_grants").withIndex("by_manifestId", (q: any) => q.eq("manifestId", MFT)).first())).usedCount).toBe(1); // OCC on the cross-grant row
    // the resolver NEVER seated this in local authority
    expect((await t.run((ctx: any) => ctx.db.query("aumlok_manifests").collect())).length).toBe(0);
  });
  it("OCC double-spend: maxUses:1 → second same-useSeq write refused; cross-grant usedCount stays 1", async () => {
    const { t, manifest } = await setup({ maxUses: 1 });
    await promote(t, manifest);
    expect((await xWrite(t, 0)).ok).toBe(true);
    await expect(xWrite(t, 0)).rejects.toThrow(/aumlok_mft_(useseq_mismatch|max_uses_exceeded)/);
    expect((await t.run((ctx: any) => ctx.db.query("node_cross_grants").first())).usedCount).toBe(1);
  });
});

describe("B3.5b — one-way-door guards (every refusal)", () => {
  it("crossgrant flag OFF → promote refuses crossgrant_disabled", async () => {
    const { t, manifest } = await setup();
    delete process.env.AUKORA_B3_CROSSGRANT_ENABLED;
    expect((await promote(t, manifest)).reason).toBe("crossgrant_disabled");
  });
  it("no rootId-bound pin → promote unpinned_foreign_root", async () => {
    const { t, manifest } = await setup({ skipPin: true });
    expect((await promote(t, manifest)).reason).toBe("unpinned_foreign_root");
  });
  it("a manifest bound to ANOTHER node → promote not_this_node (no lift)", async () => {
    const { t, manifest } = await setup({ nodeId: "aukora-node-b-real" });
    expect((await promote(t, manifest)).reason).toBe("not_this_node");
  });
  it("a demo/B0-origin rootId → promote demo_origin_quarantined", async () => {
    const { t, manifest } = await setup({ rootId: "demo.peter.carbon:x", manifestId: "mft-demo" });
    expect((await promote(t, manifest)).reason).toBe("demo_origin_quarantined");
  });
  it("manifestId already a cross-grant → already_promoted", async () => {
    const { t, manifest } = await setup();
    expect((await promote(t, manifest)).ok).toBe(true);
    expect((await promote(t, manifest)).reason).toBe("already_promoted");
  });
  it("a tampered manifestHash → promote forged_manifest", async () => {
    const { t, manifest } = await setup();
    expect((await promote(t, { ...manifest, manifestHash: "00".repeat(32) })).reason).toBe("forged_manifest");
  });
  it("a non-promoted foreign manifest → resolve manifest_unknown (a non-promoted manifest is not authority)", async () => {
    const { t } = await setup();
    expect((await resolveX(t)).reason).toBe("manifest_unknown");
  });
  it("a promoted cross-grant whose foreign root is NOT rootId-pinned → resolve unpinned_foreign_root", async () => {
    const { t, manifest } = await setup();
    // force-insert a cross-grant row WITHOUT a pin (bypassing promote) to exercise the resolve-time pin gate
    await t.run((ctx: any) => ctx.db.insert("node_cross_grants", { manifestId: "mft-nopin", sourceNodeId: "peerC", rootId: "root.peerC", rootKeyId: "rk-9", nodeId: NODE, subjectId: SUBJECT, subjectKind: "agent", subjectPubKey: "x", subjectFingerprint: "fp", permissionsJson: JSON.stringify([{ ring: "local-write", action: "memory.write", resource: "mem:root.peerC" }]), allowedIntentCodecsJson: JSON.stringify(["json_action_v1"]), notBefore: 1, expiresAt: 9_999_999_999_999, usedCount: 0, status: "active", manifestHash: "h", rootSig: "s", subjectPopSig: "s", promotedBy: "x", promotedByKeyId: "op-1", promotedAt: 1, createdAt: 1 }));
    expect((await resolveX(t, "mft-nopin", "root.peerC")).reason).toBe("unpinned_foreign_root");
  });
  it("a cross-grant whose rootId IS a LOCAL root with an unknown keyId → root_key_unknown (NEVER foreign-fallback)", async () => {
    const { t } = await setup();
    // seed a LOCAL root key for 'root.local' (rk-1), then a cross-grant for (root.local, rk-UNKNOWN)
    await t.run((ctx: any) => ctx.db.insert("aumlok_root_keys", { rootId: "root.local", keyId: "rk-1", publicKey: "p", fingerprint: "f", status: "active", pinnedAt: 1 }));
    await t.run((ctx: any) => ctx.db.insert("node_cross_grants", { manifestId: "mft-localroot", sourceNodeId: SRC, rootId: "root.local", rootKeyId: "rk-UNKNOWN", nodeId: NODE, subjectId: SUBJECT, subjectKind: "agent", subjectPubKey: "x", subjectFingerprint: "fp", permissionsJson: JSON.stringify([{ ring: "local-write", action: "memory.write", resource: "mem:root.local" }]), allowedIntentCodecsJson: JSON.stringify(["json_action_v1"]), notBefore: 1, expiresAt: 9_999_999_999_999, usedCount: 0, status: "active", manifestHash: "h", rootSig: "s", subjectPopSig: "s", promotedBy: "x", promotedByKeyId: "op-1", promotedAt: 1, createdAt: 1 }));
    expect((await resolveX(t, "mft-localroot", "root.local")).reason).toBe("root_key_unknown");
  });
  it("a cross-grant bound to ANOTHER node (force-inserted) → resolve node_mismatch (lift gate preserved)", async () => {
    const { t } = await setup();
    await t.run((ctx: any) => ctx.db.insert("node_cross_grants", { manifestId: "mft-othernode", sourceNodeId: SRC, rootId: "root.peerD", rootKeyId: "rk-1", nodeId: "aukora-node-b-real", subjectId: SUBJECT, subjectKind: "agent", subjectPubKey: "x", subjectFingerprint: "fp", permissionsJson: "[]", allowedIntentCodecsJson: "[]", notBefore: 1, expiresAt: 9_999_999_999_999, usedCount: 0, status: "active", manifestHash: "h", rootSig: "s", subjectPopSig: "s", promotedBy: "x", promotedByKeyId: "op-1", promotedAt: 1, createdAt: 1 }));
    expect((await resolveX(t, "mft-othernode", "root.peerD")).reason).toBe("node_mismatch");
  });
  it("revoked-in-view → resolve cross_grant_revoked; stale view → stale_revocation_view", async () => {
    const { t, manifest } = await setup();
    await promote(t, manifest);
    await recordView(t, FROOT, [MFT], 2);                              // newer epoch revokes the manifest
    expect((await resolveX(t)).reason).toBe("cross_grant_revoked");
    // stale: a separate cross-grant whose view is older than the window
    const stale = Date.now() - 30 * 60_000;
    await t.run((ctx: any) => ctx.db.query("node_revocation_view").withIndex("by_src_root", (q: any) => q.eq("sourceNodeId", SRC).eq("rootId", FROOT)).first().then((v: any) => ctx.db.patch(v._id, { verifiedAtLocal: stale, revokedManifestIdsJson: "[]" })));
    expect((await resolveX(t)).reason).toBe("stale_revocation_view");
  });
  it("a foreign manifestId that COLLIDES with existing LOCAL authority → promote collision_local_authority (local precedence; no shadowing)", async () => {
    const { t, manifest } = await setup();
    // seat a LOCAL manifest under the SAME manifestId the foreign grant claims (MFT) — local authority owns that id.
    await t.run((ctx: any) => ctx.db.insert("aumlok_manifests", { manifestId: MFT, rootId: "root.localOwner", rootKeyId: "lk-1", nodeId: NODE, subjectId: SUBJECT, subjectKind: "agent", subjectPubKey: "p", subjectFingerprint: "f", permissionsJson: "[]", allowedIntentCodecsJson: "[]", notBefore: 1, expiresAt: 9_999_999_999_999, usedCount: 0, status: "active", manifestHash: "h", rootSig: "s", subjectPopSig: "s", createdAt: 1 }));
    expect((await promote(t, manifest)).reason).toBe("collision_local_authority");
    // the foreign manifest was NOT promoted — no node_cross_grants row exists for MFT
    expect(await t.run((ctx: any) => ctx.db.query("node_cross_grants").withIndex("by_manifestId", (q: any) => q.eq("manifestId", MFT)).first())).toBeNull();
  });
  it("a manifestId present in BOTH aumlok_manifests AND node_cross_grants → the resolver reads the LOCAL row (cross-grant never shadows local)", async () => {
    const { t } = await setup();
    const ID = "mft-both";
    // a LOCAL manifest bound to ANOTHER node: if the resolver reads it, the outcome is node_mismatch...
    await t.run((ctx: any) => ctx.db.insert("aumlok_manifests", { manifestId: ID, rootId: "root.localOwner", rootKeyId: "lk-1", nodeId: "aukora-node-b-real", subjectId: SUBJECT, subjectKind: "agent", subjectPubKey: "p", subjectFingerprint: "f", permissionsJson: "[]", allowedIntentCodecsJson: "[]", notBefore: 1, expiresAt: 9_999_999_999_999, usedCount: 0, status: "active", manifestHash: "h", rootSig: "s", subjectPopSig: "s", createdAt: 1 }));
    // ...and a (force-inserted) cross-grant under the SAME id that WOULD resolve (nodeId == THIS) if it were read.
    await t.run((ctx: any) => ctx.db.insert("node_cross_grants", { manifestId: ID, sourceNodeId: SRC, rootId: FROOT, rootKeyId: RKID, nodeId: NODE, subjectId: SUBJECT, subjectKind: "agent", subjectPubKey: "x", subjectFingerprint: "fp", permissionsJson: JSON.stringify([{ ring: "local-write", action: "memory.write", resource: `mem:${FROOT}` }]), allowedIntentCodecsJson: JSON.stringify(["json_action_v1"]), notBefore: 1, expiresAt: 9_999_999_999_999, usedCount: 0, status: "active", manifestHash: "h", rootSig: "s", subjectPopSig: "s", promotedBy: "x", promotedByKeyId: "op-1", promotedAt: 1, createdAt: 1 }));
    // local precedence (`local ?? cross`) → the resolver reads the LOCAL row → node_mismatch, NEVER the foreign branch.
    expect((await resolveX(t, ID, FROOT)).reason).toBe("node_mismatch");
  });
});
