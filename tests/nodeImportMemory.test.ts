// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/// <reference types="vite/client" />
/**
 * B3.5a — AUDIT-ONLY cross-node MEMORY propagation (§3, verify-receipt-before-accept). Proves: a verifiable foreign mem:
 * receipt from a pinned peer is recorded as a ZERO-AUTHORITY audit row and NEVER writes aukora_memory (the structural
 * guarantee §10.3); fail-closed on unpinned-peer / forged-receipt / manifest-not-imported / manifest-revoked /
 * demo-origin / not-a-memory-receipt.
 */
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import { mlDsa65PublicKeyFromSeed, pqcSign } from "../convex/aukoraPqcSigner";
import { signChainHeadV3, signChainHeadV4, resolveChainSigningSeed } from "../convex/aukoraSignedHead";
import { manifestHash, manifestRootHead, manifestPopHead } from "../convex/aumlokManifests";
import { receiptPayload } from "../convex/aukoraReceipts";
import { buildReceiptChainHash } from "../convex/aukoraCore";
import { receiptHistoryRootHex } from "../convex/aukoraMerkleLog";
import { serializeRevocationViewV1, tracesToDemoLineage } from "../convex/nodeImport";
import { utf8ToBytes } from "@noble/hashes/utils.js";

const modules = import.meta.glob("../convex/**/*.*s");
const ROOT_SEED = "c1".repeat(32), SUBJ_SEED = "d2".repeat(32);
const SRC = "aukora-node-b-real", ROOT_KID = "rk-1", ROOT_ID = "root.peerB", NODE_KID = "demo-key-1";
const clone = (x: any) => JSON.parse(JSON.stringify(x));

// import the foreign manifest first (memory import requires it: verify-before-accept), pin both keys, record a fresh view.
async function primed(over: { revoked?: string[] } = {}) {
  const t = convexTest(schema, modules);
  const rootPub = await mlDsa65PublicKeyFromSeed(ROOT_SEED);
  const subjPub = await mlDsa65PublicKeyFromSeed(SUBJ_SEED);
  const nodeSeed = resolveChainSigningSeed()!;
  const nodePub = await mlDsa65PublicKeyFromSeed(nodeSeed);
  const m: any = { manifestId: "mft-b-1", rootId: ROOT_ID, rootKeyId: ROOT_KID, nodeId: "aukora-node-b-real", subjectId: "subject.echo", subjectKind: "agent", subjectPubKey: subjPub, permissions: [{ ring: "local-write", action: "memory.write", resource: `mem:${ROOT_ID}` }], allowedIntentCodecs: ["moga"], notBefore: 1, expiresAt: 9_999_999_999_999, maxUses: null, maxPerWindow: null, createdAt: 1 };
  const manifest = { ...m, manifestHash: await manifestHash(m), rootSig: await signChainHeadV3(ROOT_SEED, await manifestRootHead(m), "aumlokManifest"), subjectPopSig: await signChainHeadV3(SUBJ_SEED, await manifestPopHead(m), "aumlokSubjectPop") };
  await t.mutation(internal.nodeB.pinTrust, { sourceNodeId: SRC, headKeyId: `root:${ROOT_KID}`, publicKey: rootPub });
  await t.mutation(internal.nodeB.pinTrust, { sourceNodeId: SRC, headKeyId: NODE_KID, publicKey: nodePub });
  const revoked = over.revoked ?? [];
  const viewSig = await pqcSign(ROOT_SEED, utf8ToBytes(serializeRevocationViewV1({ sourceNodeId: SRC, rootId: ROOT_ID, epoch: 1, revokedManifestIds: revoked, timestamp: 1 })), "aukoraNodeImport");
  await t.mutation(internal.nodeImport.recordRevocationView, { view: { sourceNodeId: SRC, rootId: ROOT_ID, rootKeyId: ROOT_KID, epoch: 1, revokedManifestIds: revoked, timestamp: 1, sig: viewSig } });
  await t.mutation(internal.nodeImport.importForeignManifest, { env: { envelopeVersion: "node-import-v1", sourceNodeId: SRC, manifest } });
  return { t, nodeSeed };
}

async function buildMemEnv(nodeSeed: string, over: any = {}) {
  const rootId = over.rootId ?? ROOT_ID, key = over.key ?? "note1", manifestId = over.manifestId ?? "mft-b-1";
  const chainKey = over.chainKey ?? `mem:${rootId}:${key}`;
  const proofJson = over.proofJson ?? JSON.stringify({ memory: true, manifestId, rootId, subjectId: "subject.echo", subjectFingerprint: "fp", useSeq: 0, memoryHash: "abc123", nodeId: SRC });
  const base = { chainKey, receiptId: over.receiptId ?? "rcpt-mem-1", ts: 1, actorModel: "subject.echo", lane: "local", goal: "memory.write", risk: "low", grade: "A", verdict: "kept", actionsJson: "[]", proofJson };
  const chainHash = await buildReceiptChainHash(receiptPayload(base), null);
  const receiptLogRoot = receiptHistoryRootHex([chainHash]);
  const headSig = await signChainHeadV4(nodeSeed, { chainKey, timestamp: 1, chainLength: 1, chainHeadHash: chainHash }, receiptLogRoot, "chainHead");
  return { envelopeVersion: "node-import-v1", sourceNodeId: SRC, headKeyId: NODE_KID, chainKey,
    receipt: { ...base, prevHash: null, chainHash },
    head: { count: 1, lastChainHash: chainHash, headSignedAt: 1, updatedAt: 1, receiptLogRoot, headSig } };
}
const importMem = (t: any, env: any) => t.mutation(internal.nodeImport.importForeignMemory, { env });

describe("B3.5a — foreign memory import (audit-only; never writes aukora_memory)", () => {
  it("HAPPY: a verifiable foreign mem: receipt is recorded; aukora_memory stays EMPTY (conservation §10.3)", async () => {
    const { t, nodeSeed } = await primed();
    const env = await buildMemEnv(nodeSeed);
    expect(await importMem(t, env)).toMatchObject({ ok: true, ownerRootId: ROOT_ID, key: "note1", manifestId: "mft-b-1" });
    expect((await t.run((ctx: any) => ctx.db.query("node_foreign_memory").collect())).length).toBe(1);
    expect((await t.run((ctx: any) => ctx.db.query("aukora_memory").collect())).length).toBe(0); // NEVER an effect write
  });
  it("unpinned node key → unpinned_peer", async () => {
    const t = convexTest(schema, modules); const nodeSeed = resolveChainSigningSeed()!;
    const env = await buildMemEnv(nodeSeed);
    expect((await importMem(t, env)).reason).toBe("unpinned_peer");
  });
  it("forged receipt (tampered goal) → forged_receipt", async () => {
    const { t, nodeSeed } = await primed();
    const env = await buildMemEnv(nodeSeed); const e = clone(env); e.receipt.goal = "DRAINED";
    expect((await importMem(t, e)).reason).toBe("forged_receipt");
  });
  it("referenced manifest not imported → manifest_not_imported", async () => {
    const { t, nodeSeed } = await primed();
    const env = await buildMemEnv(nodeSeed, { manifestId: "mft-unknown", proofJson: JSON.stringify({ memory: true, manifestId: "mft-unknown", rootId: ROOT_ID, subjectId: "subject.echo", memoryHash: "x", nodeId: SRC }) });
    expect((await importMem(t, env)).reason).toBe("manifest_not_imported");
  });
  it("manifest revoked in the fresh view → manifest_revoked", async () => {
    const { t, nodeSeed } = await primed({ revoked: ["mft-b-1"] });
    const env = await buildMemEnv(nodeSeed);
    expect((await importMem(t, env)).reason).toBe("manifest_revoked");
  });
  it("a demo/B0-origin memory receipt → demo_origin_quarantined", async () => {
    const { t, nodeSeed } = await primed();
    const env = await buildMemEnv(nodeSeed, { proofJson: JSON.stringify({ delegationId: "del:x", carbonRoot: "demo.peter.carbon:x", revocationPointer: "rev:demo.peter.carbon:x:del:x" }) });
    expect((await importMem(t, env)).reason).toBe("demo_origin_quarantined");
  });
  it("a non-memory receipt (no memory:true) → not_memory_receipt", async () => {
    const { t, nodeSeed } = await primed();
    const env = await buildMemEnv(nodeSeed, { proofJson: JSON.stringify({ manifestId: "mft-b-1", rootId: ROOT_ID, subjectId: "subject.echo" }) });
    expect((await importMem(t, env)).reason).toBe("not_memory_receipt");
  });
  it("a non-fresh chain (prevHash present) → not_fresh_chain", async () => {
    const { t, nodeSeed } = await primed();
    const env = await buildMemEnv(nodeSeed); const e = clone(env); e.receipt.prevHash = "aa".repeat(32);
    expect((await importMem(t, e)).reason).toBe("not_fresh_chain");
  });
  it("a chainKey that is not the mem:{rootId}: grammar → bad_mem_chainkey", async () => {
    const { t, nodeSeed } = await primed();
    const env = await buildMemEnv(nodeSeed, { chainKey: `other:${ROOT_ID}:note1` }); // signed over the bad chainKey, so the head sig still verifies
    expect((await importMem(t, env)).reason).toBe("bad_mem_chainkey");
  });
  it("re-importing the same verified mem: receipt → duplicate", async () => {
    const { t, nodeSeed } = await primed();
    const env = await buildMemEnv(nodeSeed);
    expect(await importMem(t, env)).toMatchObject({ ok: true });
    expect((await importMem(t, env)).reason).toBe("duplicate");
  });
  it("an unratified envelope version → envelope_version_refused", async () => {
    const { t, nodeSeed } = await primed();
    const env = await buildMemEnv(nodeSeed); env.envelopeVersion = "node-import-v9";
    expect((await importMem(t, env)).reason).toBe("envelope_version_refused");
  });
  it("a tampered head signature (wrong key) → bad_signature", async () => {
    const { t, nodeSeed } = await primed();
    const env = await buildMemEnv(nodeSeed); const e = clone(env);
    e.head.headSig = await signChainHeadV4("ee".repeat(32), { chainKey: e.chainKey, timestamp: 1, chainLength: 1, chainHeadHash: e.head.lastChainHash }, e.head.receiptLogRoot, "chainHead");
    expect((await importMem(t, e)).reason).toBe("bad_signature");
  });
  it("head.lastChainHash ≠ receipt.chainHash → head_mismatch", async () => {
    const { t, nodeSeed } = await primed();
    const env = await buildMemEnv(nodeSeed); const e = clone(env); e.receipt.chainHash = "bb".repeat(32);
    expect((await importMem(t, e)).reason).toBe("head_mismatch");
  });
  it("a non-JSON receipt proof → malformed_proof", async () => {
    const { t, nodeSeed } = await primed();
    const env = await buildMemEnv(nodeSeed, { proofJson: "{not valid json" });
    expect((await importMem(t, env)).reason).toBe("malformed_proof");
  });
});

describe("B3.5a — demo-lineage discriminator (§10, frozen boundary; the quarantine IS the boundary)", () => {
  it("catches the B0 runMemory lane (memchain:/memdel: + {memory:true,delegationId}) and the ceremony/demo grammars", () => {
    expect(tracesToDemoLineage(["memchain:run:w:k"])).toBe(true);                                  // runMemory chainKey
    expect(tracesToDemoLineage(["x"], { memory: true, owner: "o", delegationId: "memdel:x" })).toBe(true); // runMemory proof shape
    expect(tracesToDemoLineage(["demo.peter.carbon:1"])).toBe(true);                               // ceremony carbon root
    expect(tracesToDemoLineage(["agent:alice:1"])).toBe(true);                                     // runDemo principal
    expect(tracesToDemoLineage(["x"], { delegationId: "del:1", carbonRoot: "c", revocationPointer: "rev:c:del:1" })).toBe(true);
  });
  it("does NOT false-positive a real AUMLOK record (manifestId, not delegationId) nor a legit 'demo'-prefixed root", () => {
    expect(tracesToDemoLineage(["mft-b-1", "root.peerB", "subject.echo", "aukora-node-b-real"])).toBe(false);
    expect(tracesToDemoLineage(["mem:root.peerB:k"], { memory: true, manifestId: "mft-b-1", rootId: "root.peerB" })).toBe(false);
    expect(tracesToDemoLineage(["democracy.root"])).toBe(false);   // legit root merely prefixed 'demo' (no demo.WORD. grammar)
  });
});
