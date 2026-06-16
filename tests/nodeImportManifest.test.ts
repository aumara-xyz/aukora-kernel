// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/// <reference types="vite/client" />
/**
 * B3.5a — AUDIT-ONLY cross-node MANIFEST propagation (honor-as-record). Proves: a doubly-signed foreign manifest from an
 * EXPLICITLY-pinned peer is verified and stored as a ZERO-AUTHORITY record (the imported manifest NEVER lands in
 * aumlok_manifests — the conservation law); fail-closed on unpinned-root / forged-hash / bad-root-sig / bad-subject-pop /
 * stale-revocation-view / duplicate / unratified-version; a manifest bound to THIS node (the B3.5b grant case) is refused
 * (not_foreign); demo/B0-origin is quarantined; an import-rejected peer is refused.
 */
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../convex/schema";
import { internal, api } from "../convex/_generated/api";
import { mlDsa65PublicKeyFromSeed, pqcSign } from "../convex/aukoraPqcSigner";
import { signChainHeadV3 } from "../convex/aukoraSignedHead";
import { manifestHash, manifestRootHead, manifestPopHead } from "../convex/aumlokManifests";
import { serializeRevocationViewV1 } from "../convex/nodeImport";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { readFileSync } from "node:fs";

const modules = import.meta.glob("../convex/**/*.*s");
const ROOT_SEED = "c1".repeat(32), SUBJ_SEED = "d2".repeat(32);
const SRC = "aukora-node-b-real";   // the PEER (source) node — foreign to THIS node (aukora-node-a-demo)
const ROOT_KID = "rk-1", ROOT_ID = "root.peerB";
const clone = (x: any) => JSON.parse(JSON.stringify(x));

async function buildManifest(over: any = {}) {
  const rootPub = await mlDsa65PublicKeyFromSeed(ROOT_SEED);
  const subjPub = await mlDsa65PublicKeyFromSeed(SUBJ_SEED);
  const m: any = {
    manifestId: over.manifestId ?? "mft-b-1", rootId: over.rootId ?? ROOT_ID, rootKeyId: ROOT_KID,
    nodeId: over.nodeId ?? "aukora-node-b-real",
    subjectId: over.subjectId ?? "subject.echo", subjectKind: "agent", subjectPubKey: subjPub,
    permissions: [{ ring: "local-write", action: "memory.write", resource: `mem:${over.rootId ?? ROOT_ID}` }],
    allowedIntentCodecs: ["moga"], notBefore: 1, expiresAt: 9_999_999_999_999,
    maxUses: null, maxPerWindow: null, createdAt: 1,
  };
  const mh = await manifestHash(m);
  const rootSig = await signChainHeadV3(ROOT_SEED, await manifestRootHead(m), "aumlokManifest");
  const subjectPopSig = await signChainHeadV3(SUBJ_SEED, await manifestPopHead(m), "aumlokSubjectPop");
  return { rootPub, manifest: { ...m, manifestHash: mh, rootSig, subjectPopSig } };
}
const pinRoot = (t: any, rootPub: string) => t.mutation(internal.nodeB.pinTrust, { sourceNodeId: SRC, headKeyId: `root:${ROOT_KID}`, publicKey: rootPub });
async function recordView(t: any, { epoch = 1, revoked = [] as string[], rootId = ROOT_ID } = {}) {
  const timestamp = 1;
  const sig = await pqcSign(ROOT_SEED, utf8ToBytes(serializeRevocationViewV1({ sourceNodeId: SRC, rootId, epoch, revokedManifestIds: revoked, timestamp })), "aukoraNodeImport");
  return t.mutation(internal.nodeImport.recordRevocationView, { view: { sourceNodeId: SRC, rootId, rootKeyId: ROOT_KID, epoch, revokedManifestIds: revoked, timestamp, sig } });
}
const importM = (t: any, manifest: any) => t.mutation(internal.nodeImport.importForeignManifest, { env: { envelopeVersion: "node-import-v1", sourceNodeId: SRC, manifest } });

describe("B3.5a — foreign manifest import (audit-only, conservation-safe)", () => {
  it("HAPPY: a pinned, fresh, doubly-signed foreign manifest imports as a ZERO-AUTHORITY record (NOT in aumlok_manifests)", async () => {
    const t = convexTest(schema, modules);
    const { rootPub, manifest } = await buildManifest();
    await pinRoot(t, rootPub); await recordView(t);
    expect(await importM(t, manifest)).toMatchObject({ ok: true, lastLifecycleStatus: "active", foreignNodeId: "aukora-node-b-real" });
    // CONSERVATION: the imported manifest is a record only — it NEVER entered the authority table.
    expect((await t.run((ctx: any) => ctx.db.query("aumlok_manifests").collect())).length).toBe(0);
    const fm = await t.query(internal.nodeImport.foreignManifest, { sourceNodeId: SRC, manifestId: "mft-b-1" });
    expect(fm?.foreignNodeId).toBe("aukora-node-b-real");   // foreign nodeId preserved VERBATIM, never rewritten to THIS node
  });
  it("DYNAMIC conservation: after import, the LIVE resolver REFUSES the foreign manifestId (zero authority at runtime)", async () => {
    const t = convexTest(schema, modules);
    const { rootPub, manifest } = await buildManifest();
    await pinRoot(t, rootPub); await recordView(t);
    expect(await importM(t, manifest)).toMatchObject({ ok: true });
    // not just structurally absent: a LIVE resolve of the imported manifestId fails closed (no aumlok_manifests row exists).
    const res = await t.query(api.aumlokManifests.aumlokManifestResolve, { manifestId: "mft-b-1", ring: "local-write", action: "memory.write", resource: "mem:root.peerB", intentCodec: "moga" });
    expect(res.ok).toBe(false); // the imported record grants NO authority — the resolver never sees it
  });
  it("unpinned root → unpinned_root (NO TOFU)", async () => {
    const t = convexTest(schema, modules); const { manifest } = await buildManifest();
    await recordView(t); // view alone, root not pinned
    expect((await importM(t, manifest)).reason).toBe("unpinned_root");
  });
  it("forged manifest hash → forged_manifest", async () => {
    const t = convexTest(schema, modules); const { rootPub, manifest } = await buildManifest();
    await pinRoot(t, rootPub); await recordView(t);
    const e = clone(manifest); e.manifestHash = "00".repeat(32);
    expect((await importM(t, e)).reason).toBe("forged_manifest");
  });
  it("bad root signature → bad_root_sig; bad subject PoP → bad_subject_pop", async () => {
    const t = convexTest(schema, modules); const { rootPub, manifest } = await buildManifest();
    await pinRoot(t, rootPub); await recordView(t);
    const badRoot = clone(manifest); badRoot.rootSig = await signChainHeadV3("ee".repeat(32), await manifestRootHead(manifest), "aumlokManifest");
    expect((await importM(t, badRoot)).reason).toBe("bad_root_sig");
    const badSub = clone(manifest); badSub.subjectPopSig = await signChainHeadV3("ff".repeat(32), await manifestPopHead(manifest), "aumlokSubjectPop");
    expect((await importM(t, badSub)).reason).toBe("bad_subject_pop");
  });
  it("no fresh revocation view → stale_revocation_view (fail-closed on UNKNOWN)", async () => {
    const t = convexTest(schema, modules); const { rootPub, manifest } = await buildManifest();
    await pinRoot(t, rootPub); // pinned but NO view recorded
    expect((await importM(t, manifest)).reason).toBe("stale_revocation_view");
  });
  it("revoked-in-view manifest imports with lastLifecycleStatus=revoked; re-import → duplicate", async () => {
    const t = convexTest(schema, modules); const { rootPub, manifest } = await buildManifest();
    await pinRoot(t, rootPub); await recordView(t, { epoch: 2, revoked: ["mft-b-1"] });
    expect(await importM(t, manifest)).toMatchObject({ ok: true, lastLifecycleStatus: "revoked" });
    expect((await importM(t, manifest)).reason).toBe("duplicate");
  });
  it("a manifest bound to THIS node (the B3.5b grant case) → not_foreign (out of 5a scope)", async () => {
    const t = convexTest(schema, modules); const { rootPub, manifest } = await buildManifest({ nodeId: "aukora-node-a-demo" });
    await pinRoot(t, rootPub); await recordView(t);
    expect((await importM(t, manifest)).reason).toBe("not_foreign");
  });
  it("demo/B0-origin manifest → demo_origin_quarantined (§10)", async () => {
    const t = convexTest(schema, modules); const { rootPub, manifest } = await buildManifest({ rootId: "demo.peter.carbon:x", manifestId: "mft-demo" });
    await pinRoot(t, rootPub); await recordView(t, { rootId: "demo.peter.carbon:x" });
    expect((await importM(t, manifest)).reason).toBe("demo_origin_quarantined");
    expect((await t.run((ctx: any) => ctx.db.query("node_foreign_manifests").collect())).length).toBe(0);
  });
  it("unratified envelope version → envelope_version_refused", async () => {
    const t = convexTest(schema, modules); const { rootPub, manifest } = await buildManifest();
    await pinRoot(t, rootPub); await recordView(t);
    expect((await t.mutation(internal.nodeImport.importForeignManifest, { env: { envelopeVersion: "node-import-v9", sourceNodeId: SRC, manifest } })).reason).toBe("envelope_version_refused");
  });
  it("a peer with an OPEN self-verifying finding is import-rejected (§6)", async () => {
    const t = convexTest(schema, modules); const { rootPub, manifest } = await buildManifest();
    await pinRoot(t, rootPub); await recordView(t);
    await t.run((ctx: any) => ctx.db.insert("node_peer_consequence", { peerNodeId: SRC, headKeyId: `root:${ROOT_KID}`, state: "import_rejected", reason: "self_verifying_finding", findingId: "f1", setAt: 1 }));
    expect((await importM(t, manifest)).reason).toBe("peer_import_rejected");
  });
});

describe("B3.5a — STRUCTURAL conservation guard: nodeImport.ts is not an authority path (§5/§10)", () => {
  // strip comments so the guard tests actual CODE references, not the doc-comment that names what it must never do.
  const src = readFileSync(new URL("../convex/nodeImport.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  it("never INSERTS into any authority/effect table (only its own audit tables)", () => {
    for (const table of ["aumlok_manifests", "aukora_grants", "aukora_memory", "auma_receipts", "aukora_delegations"]) {
      expect(src.includes(`insert("${table}"`)).toBe(false); // an import can never mint authority or write an effect
    }
    // it only ever writes its OWN audit-only tables
    expect(src.includes('insert("node_foreign_manifests"')).toBe(true);
    expect(src.includes('insert("node_foreign_memory"')).toBe(true);
  });
  it("never calls the consume / resolve / receipt-write chokepoints (no second authority path)", () => {
    for (const fn of ["consumeManifestUseCore", "resolveManifestAuthority", "writeReceiptRow", "submitIntentCore", "verifyAndConsumeDecisionToken"]) {
      expect(src.includes(fn)).toBe(false);
    }
  });
});
