// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/// <reference types="vite/client" />
/**
 * B2.4 — AUMLOK MEMORY BOUNDARY (live manifest enforcement), proven against the REAL deployed mutations via
 * convex-test. A B2.2 manifest (root→subject, memory.write on mem:{root}) is the ONLY authority: it justifies a
 * one-shot kernel grant that flows through the UNCHANGED grant→intent→token→receipt pipeline to a memory effect +
 * a receipt binding the manifest. Proven here: valid write mints memory + a verifiable mem: receipt; wrong
 * action/ring/scope, revoked-root, revoked/paused/expired manifest, maxUses-exhausted, double-consume (same useSeq),
 * and wrong-node all refuse; the receipt binds the manifest authority; no write bypasses the manifest; the B0
 * aukora_delegations lane grants nothing here.
 */
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { mlDsa65PublicKeyFromSeed } from "../convex/aukoraPqcSigner";
import { buildPoPEnvelope, POP_FRESHNESS_MS } from "../convex/popResolver";
import { signChainHeadV3 } from "../convex/aukoraSignedHead";
import { manifestRootHead, manifestPopHead, consumeHead, rootRevokeHead } from "../convex/aumlokManifests";
import { recallHead } from "../convex/aumlokMemory";
import { verifyReceiptChainCore } from "../convex/aukoraReceipts";

const modules = import.meta.glob("../convex/**/*.*s");
const OPERATOR_SEED = "ab".repeat(32), ROOT_SEED = "11".repeat(32), SUBJECT_SEED = "55".repeat(32), ATTACKER_SEED = "ee".repeat(32);
const NODE = "aukora-node-a-demo", OWNER = "root-a", SUBJECT = "agent-echo", MFT = "mft-mem";

// Register root-a (operator-born lab genesis, B2.1) + mint a memory-write manifest root-a → agent-echo (B2.2).
async function setup(run: string, mOver: any = {}, perms: any = null) {
  const t = convexTest(schema, modules);
  const opPub = await mlDsa65PublicKeyFromSeed(OPERATOR_SEED), founderUserId = `demo.operator:${run}`, now = Date.now();
  await t.mutation(internal.popResolver.seedFounderKey, { founderUserId, keyId: "op-1", publicKey: opPub });
  const cav = (capId: string, methods: string[], over: any = {}) => ({ v: 1, capId, founderUserId, founderKeyId: "op-1", nodeId: NODE, methods, ring: "local-write", action: "aumlok", resource: "aumlok:root", principalId: founderUserId, roles: ["operator"], notBefore: now - 1000, expiresAt: now + POP_FRESHNESS_MS, maxUses: 1, ...over });
  const rootPub = await mlDsa65PublicKeyFromSeed(ROOT_SEED), gArgs = { rootId: OWNER, keyId: "rk-1", publicKey: rootPub };
  const gEnv = await buildPoPEnvelope(OPERATOR_SEED, cav("cap-g", ["aumlokGenesisMint"]), { methodId: "aumlokGenesisMint", actualArgs: gArgs, timestamp: Date.now(), nonce: `g-${run}` });
  await t.mutation(api.aumlokRootRegistry.aumlokGenesisMint, { env: gEnv, actualArgs: gArgs, nodeId: NODE });
  const subjectPub = await mlDsa65PublicKeyFromSeed(SUBJECT_SEED);
  const m = { v: 1, manifestId: MFT, rootId: OWNER, rootKeyId: "rk-1", nodeId: NODE, subjectId: SUBJECT, subjectKind: "agent", subjectPubKey: subjectPub, permissions: perms ?? [{ ring: "local-write", action: "memory.write", resource: `mem:${OWNER}` }], allowedIntentCodecs: ["json_action_v1"], notBefore: now - 1000, expiresAt: now + 3_600_000, maxUses: null, maxPerWindow: null, createdAt: now, ...mOver };
  const rootSig = await signChainHeadV3(ROOT_SEED, await manifestRootHead(m), "aumlokManifest");
  const subjectPopSig = await signChainHeadV3(SUBJECT_SEED, await manifestPopHead(m), "aumlokSubjectPop");
  await t.mutation(api.aumlokManifests.aumlokMintManifest, { manifest: m, rootSig, subjectPopSig });
  return { t, cav };
}
async function memReq(rOver: any = {}, sign: { seed?: string; domain?: any } = {}) {
  const r = { v: 1, manifestId: MFT, subjectId: SUBJECT, ring: "local-write", action: "memory.write", resource: `mem:${OWNER}`, intentCodec: "json_action_v1", useSeq: 0, timestamp: Date.now(), key: "diary", ...rOver };
  const subjectSig = await signChainHeadV3(sign.seed ?? SUBJECT_SEED, await consumeHead(r), sign.domain ?? "aumlokSubjectPop");
  return { r, subjectSig };
}
const write = async (t: any, rOver: any = {}, value = "alice private note", sign: any = {}) => { const { r, subjectSig } = await memReq(rOver, sign); return t.mutation(api.aumlokMemory.aumlokMemoryWrite, { req: r, subjectSig, value }); };
const memRow = (t: any, key = "diary") => t.run(async (ctx: any) => ctx.db.query("aukora_memory").withIndex("by_owner_key", (q: any) => q.eq("ownerRootId", OWNER).eq("key", key)).first());
const mUsedCount = (t: any) => t.run(async (ctx: any) => (await ctx.db.query("aumlok_manifests").withIndex("by_manifestId", (q: any) => q.eq("manifestId", MFT)).first())?.usedCount);

describe("B2.4 — manifest authority drives the live memory effect", () => {
  it("valid manifest → one authorized memory write → memory row + a verifiable mem: receipt binding the manifest", async () => {
    const { t } = await setup("v");
    const r: any = await write(t, { useSeq: 0 });
    expect([r.ok, r.ownerRootId, r.writerPrincipalId, r.useSeq]).toEqual([true, OWNER, SUBJECT, 0]);
    const row: any = await memRow(t);
    expect([row.ownerRootId, row.writerPrincipalId, row.delegationId, row.value]).toEqual([OWNER, SUBJECT, MFT, "alice private note"]);
    expect(await mUsedCount(t)).toBe(1); // the manifest use was consumed
    // the effect receipt verifies on the reserved-by-convention mem: chain, and binds the manifest authority
    const v: any = await t.run(async (ctx: any) => verifyReceiptChainCore(ctx, `mem:${OWNER}:diary`, 1000));
    expect([v.ok, v.status]).toEqual([true, "verified"]);
    const rcpt = await t.run(async (ctx: any) => ctx.db.query("auma_receipts").withIndex("by_chainKey_ts", (q: any) => q.eq("chainKey", `mem:${OWNER}:diary`)).first());
    const proof = JSON.parse(rcpt.proofJson);
    expect([proof.manifestId, proof.rootId, proof.subjectId, proof.useSeq]).toEqual([MFT, OWNER, SUBJECT, 0]);
    expect(proof.issuer).toBe("local"); // B3.5b: a local manifest's effect is tagged issuer:local (foreign is distinguishable)
    expect(typeof proof.subjectFingerprint).toBe("string");
    expect(proof.memoryHash).toBe(row.memoryHash);
    expect(row.receiptHash).toBe(rcpt.chainHash);
  });

  it("wrong action / ring / resource-scope all refuse (no memory row)", async () => {
    const { t } = await setup("scope");
    await expect(write(t, { action: "memory.delete" })).rejects.toThrow("aumlok_mem_action_invalid");      // boundary fixes the action
    await expect(write(t, { ring: "observe" })).rejects.toThrow("aumlok_mem_ring_invalid");                 // boundary fixes the ring
    await expect(write(t, { resource: "mem:other-root" })).rejects.toThrow("aumlok_mft_permission_denied");  // resolver: no signed permission
    expect(await memRow(t)).toBeNull();
    expect(await mUsedCount(t)).toBe(0); // nothing consumed on any refusal
  });

  it("revoked root key → memory write refused (root revocation kills delegated authority)", async () => {
    const { t, cav } = await setup("rr");
    const args = { rootId: OWNER, keyId: "rk-1", reason: "compromise" };
    const env = await buildPoPEnvelope(OPERATOR_SEED, cav("cap-rv", ["aumlokRevokeRoot"]), { methodId: "aumlokRevokeRoot", actualArgs: args, timestamp: Date.now(), nonce: "rv" });
    await t.mutation(api.aumlokRootRegistry.aumlokRevokeRoot, { env, actualArgs: args, nodeId: NODE });
    await expect(write(t, { useSeq: 0 })).rejects.toThrow("aumlok_mft_root_revoked");
    expect(await memRow(t)).toBeNull();
  });

  it("revoked / paused / expired manifest → memory write refused", async () => {
    const { t } = await setup("rp");
    // root-revoke the manifest (current active key) — superior revocation
    const stmt = { v: 1, manifestId: MFT, action: "revoke", reason: "compromise", timestamp: Date.now() };
    const rootSig = await signChainHeadV3(ROOT_SEED, await rootRevokeHead(stmt), "aumlokManifest");
    await t.mutation(api.aumlokManifests.aumlokRevokeManifest, { statement: stmt, rootSig });
    await expect(write(t, { useSeq: 0 })).rejects.toThrow("aumlok_mft_manifest_revoked");

    const { t: t2 } = await setup("pa");
    await t2.run(async (ctx: any) => { const m = await ctx.db.query("aumlok_manifests").withIndex("by_manifestId", (q: any) => q.eq("manifestId", MFT)).first(); await ctx.db.patch(m._id, { status: "paused", pausedAt: Date.now() }); });
    await expect(write(t2, { useSeq: 0 })).rejects.toThrow("aumlok_mft_manifest_paused");

    const { t: t3 } = await setup("ex");
    await t3.run(async (ctx: any) => { const m = await ctx.db.query("aumlok_manifests").withIndex("by_manifestId", (q: any) => q.eq("manifestId", MFT)).first(); await ctx.db.patch(m._id, { expiresAt: Date.now() - 1 }); }); // time passes
    await expect(write(t3, { useSeq: 0 })).rejects.toThrow("aumlok_mft_manifest_expired");
  });

  it("maxUses exhausted → refused after the budget is spent", async () => {
    const { t } = await setup("mu", { maxUses: 1 });
    expect((await write(t, { useSeq: 0 })).ok).toBe(true);
    await expect(write(t, { useSeq: 1 })).rejects.toThrow("aumlok_mft_max_uses_exceeded"); // next correct seq, but budget gone
    expect(await mUsedCount(t)).toBe(1);
  });

  it("double-consume on the same useSeq is refused (no double-spend; OCC degrades to this monotonic check)", async () => {
    const { t } = await setup("dc");
    expect((await write(t, { useSeq: 0 })).ok).toBe(true);               // usedCount 0 → 1
    await expect(write(t, { useSeq: 0 })).rejects.toThrow("aumlok_mft_useseq_mismatch"); // replay of seq 0 refused
    expect(await mUsedCount(t)).toBe(1);                                  // still exactly one effect
  });

  it("wrong nodeId → refused (a manifest bound to another node grants nothing here)", async () => {
    const { t } = await setup("node");
    await t.run(async (ctx: any) => { const m = await ctx.db.query("aumlok_manifests").withIndex("by_manifestId", (q: any) => q.eq("manifestId", MFT)).first(); await ctx.db.patch(m._id, { nodeId: "aukora-node-b-demo" }); }); // simulate a foreign-node manifest
    await expect(write(t, { useSeq: 0 })).rejects.toThrow("aumlok_mft_node_mismatch");
  });

  it("subject PoP forgery → refused (a wrong key cannot sign the consume request)", async () => {
    const { t } = await setup("pop");
    await expect(write(t, { useSeq: 0 }, "v", { seed: ATTACKER_SEED })).rejects.toThrow("aumlok_mft_subject_pop_invalid");
    await expect(write(t, { useSeq: 0 }, "v", { domain: "aumlokManifest" })).rejects.toThrow("aumlok_mft_subject_pop_invalid"); // wrong domain
  });
});

describe("B2.4 — recall boundary (authenticated read; no use consumed)", () => {
  // a recall is PoP-authenticated under the DEDICATED aumlokMemRecall domain (B3.1 P3): the reader signs recallHead with
  // the key it claims (owner→active root key, subject→manifest subject key), both under aumlokMemRecall. `sign` forges.
  const recall = async (t: any, reader: string, sign: { seed: string; domain: any }, key = "diary") => {
    const r = { v: 1, ownerRootId: OWNER, key, readerPrincipalId: reader, timestamp: Date.now() };
    const readerSig = await signChainHeadV3(sign.seed, await recallHead(r), sign.domain);
    return t.query(api.aumlokMemory.aumlokMemoryRecall, { req: r, readerSig });
  };
  it("owner (root-key PoP) reads; subject (subject-key PoP) reads while valid; revocation severs the subject; owner unaffected", async () => {
    const { t } = await setup("recall");
    await write(t, { useSeq: 0 }, "the secret");
    expect((await recall(t, OWNER, { seed: ROOT_SEED, domain: "aumlokMemRecall" })).value).toBe("the secret");      // owner root, proven
    expect((await recall(t, SUBJECT, { seed: SUBJECT_SEED, domain: "aumlokMemRecall" })).value).toBe("the secret"); // delegated subject, proven + manifest live
    expect((await recall(t, "demo.eve", { seed: ATTACKER_SEED, domain: "aumlokMemRecall" })).ok).toBe(false);     // unrelated principal
    const stmt = { v: 1, manifestId: MFT, action: "revoke", reason: "x", timestamp: Date.now() };
    await t.mutation(api.aumlokManifests.aumlokRevokeManifest, { statement: stmt, rootSig: await signChainHeadV3(ROOT_SEED, await rootRevokeHead(stmt), "aumlokManifest") });
    expect((await recall(t, SUBJECT, { seed: SUBJECT_SEED, domain: "aumlokMemRecall" })).ok).toBe(false);          // severed (manifest revoked)
    expect((await recall(t, OWNER, { seed: ROOT_SEED, domain: "aumlokMemRecall" })).value).toBe("the secret");       // owner unaffected
  });
  it("PoP defense: an attacker claiming the subject principal but signing with the WRONG key is refused", async () => {
    const { t } = await setup("recall-pop");
    await write(t, { useSeq: 0 }, "the secret");
    expect((await recall(t, SUBJECT, { seed: ATTACKER_SEED, domain: "aumlokMemRecall" })).reason).toBe("reader_pop_invalid"); // spoofed principal, no key
    expect((await recall(t, OWNER, { seed: ATTACKER_SEED, domain: "aumlokMemRecall" })).reason).toBe("reader_pop_invalid");     // spoofed owner, no root key
    expect((await recall(t, SUBJECT, { seed: SUBJECT_SEED, domain: "aumlokRotation" })).reason).toBe("reader_pop_invalid");    // right key, WRONG domain (rotation, not memrecall)
  });
});

describe("B2.4 — no bypass: the manifest is the only authority", () => {
  it("a write with an unknown manifest is refused and writes no memory row", async () => {
    const { t } = await setup("bypass");
    await expect(write(t, { manifestId: "mft-ghost", useSeq: 0 })).rejects.toThrow("aumlok_mft_manifest_unknown");
    expect(await memRow(t)).toBeNull();
  });
  it("a permissive B0 aukora_delegations row grants NOTHING on the B2 memory path", async () => {
    const { t } = await setup("b0");
    await t.run(async (ctx: any) => ctx.db.insert("aukora_delegations", { delegationId: "del-evil", carbonRoot: OWNER, carbonPubkey: "00", siliconPrincipal: SUBJECT, action: "memory.write", resource: `mem:${OWNER}`, ring: "local-write", nodeId: NODE, issuedAt: Date.now(), delHash: "00", sig: "00", revoked: false }));
    // even with a wide-open legacy delegation present, the live path still demands a real manifest
    await expect(write(t, { manifestId: "mft-ghost", useSeq: 0 })).rejects.toThrow("aumlok_mft_manifest_unknown");
    const src = import.meta.glob("../convex/aumlokMemory.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    expect(/\.(query|insert|patch)\(\s*"aukora_delegations"/.test(Object.values(src)[0])).toBe(false); // the live boundary never ACCESSES the B0 lane (the docstring may name it)
  });
  it("the live module writes aukora_memory ONLY through the manifest consume chokepoint", () => {
    const src = import.meta.glob("../convex/aumlokMemory.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const code = Object.values(src)[0];
    expect(code.includes("consumeManifestUseCore")).toBe(true);                 // authority chokepoint present
    expect((code.match(/ctx\.db\.insert\("aukora_memory"/g) ?? []).length).toBe(1); // exactly one memory-write site
  });
});
