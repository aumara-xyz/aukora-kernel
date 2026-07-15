// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * R5c CONTENDER — the vector road's boundary tests (convex-test, real deployed functions).
 * Same narrownesses as R5b search, each pinned: owner-root PoP under the DEDICATED
 * aumlokMemVecSearch domain (query-vector hash inside the signed preimage — a signed question
 * cannot have its vector substituted), ranked KEYS ONLY, erased/quarantined rows never surface
 * from the vector road, embeddings live OUTSIDE the integrity chain (memoryHash law untouched),
 * and the backfill is absent-only + idempotent under its own aumlokMemEmbed domain (no captured
 * PoP crosses surfaces). Nothing in any lane calls any of this — benchmark-first.
 */
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api";
import { mlDsa65PublicKeyFromSeed } from "../aukoraPqcSigner";
import { buildPoPEnvelope, POP_FRESHNESS_MS } from "../popResolver";
import { signChainHeadV3 } from "../aukoraSignedHead";
import { manifestRootHead, manifestPopHead, consumeHead } from "../aumlokManifests";
import { vecSearchHead, embedHead, eraseHead, vectorHashHex, EMBEDDING_DIMS } from "../aumlokMemory";

const modules = import.meta.glob(["../*.ts", "../_generated/*.js", "!../vitest.config.ts"]);
const OPERATOR_SEED = "ab".repeat(32), ROOT_SEED = "11".repeat(32), SUBJECT_SEED = "55".repeat(32), ATTACKER_SEED = "ee".repeat(32);
const NODE = "aukora-node-a-demo", OWNER = "root-a", SUBJECT = "agent-echo", MFT = "mft-mem-vector";

async function setup(run: string) {
  const t = convexTest(schema, modules);
  const opPub = await mlDsa65PublicKeyFromSeed(OPERATOR_SEED), founderUserId = `demo.operator:${run}`, now = Date.now();
  await t.mutation(internal.popResolver.seedFounderKey, { founderUserId, keyId: "op-1", publicKey: opPub });
  const cav = { v: 1, capId: `cap-g-${run}`, founderUserId, founderKeyId: "op-1", nodeId: NODE, methods: ["aumlokGenesisMint"], ring: "local-write", action: "aumlok", resource: "aumlok:root", principalId: founderUserId, roles: ["operator"], notBefore: now - 1000, expiresAt: now + POP_FRESHNESS_MS, maxUses: 1 };
  const rootPub = await mlDsa65PublicKeyFromSeed(ROOT_SEED), gArgs = { rootId: OWNER, keyId: "rk-1", publicKey: rootPub };
  const gEnv = await buildPoPEnvelope(OPERATOR_SEED, cav, { methodId: "aumlokGenesisMint", actualArgs: gArgs, timestamp: Date.now(), nonce: `g-${run}` });
  await t.mutation(internal.aumlokRootRegistry.aumlokGenesisMint, { env: gEnv, actualArgs: gArgs, nodeId: NODE });
  const subjectPub = await mlDsa65PublicKeyFromSeed(SUBJECT_SEED);
  const m = { v: 1, manifestId: MFT, rootId: OWNER, rootKeyId: "rk-1", nodeId: NODE, subjectId: SUBJECT, subjectKind: "agent", subjectPubKey: subjectPub, permissions: [{ ring: "local-write", action: "memory.write", resource: `mem:${OWNER}` }], allowedIntentCodecs: ["json_action_v1"], notBefore: now - 1000, expiresAt: now + 3_600_000, maxUses: null, maxPerWindow: null, createdAt: now };
  const rootSig = await signChainHeadV3(ROOT_SEED, await manifestRootHead(m), "aumlokManifest");
  const subjectPopSig = await signChainHeadV3(SUBJECT_SEED, await manifestPopHead(m), "aumlokSubjectPop");
  await t.mutation(internal.aumlokManifests.aumlokMintManifest, { manifest: m, rootSig, subjectPopSig });
  return t;
}

const seqByTest = new WeakMap<object, number>();
async function write(t: any, key: string, value: string, embedding?: number[]) {
  const useSeq = seqByTest.get(t) ?? 0;
  const r = { v: 1, manifestId: MFT, subjectId: SUBJECT, ring: "local-write", action: "memory.write", resource: `mem:${OWNER}`, intentCodec: "json_action_v1", useSeq, timestamp: Date.now(), key };
  const subjectSig = await signChainHeadV3(SUBJECT_SEED, await consumeHead(r), "aumlokSubjectPop");
  const res = await t.mutation(internal.aumlokMemory.aumlokMemoryWrite, { req: r, subjectSig, value, ...(embedding ? { embedding } : {}) });
  // advance the local seq ONLY on a non-throw: a refused write is transactional in the kernel
  // (nothing consumed), so the counter must not run ahead of the manifest's usedCount.
  seqByTest.set(t, useSeq + 1);
  return res;
}

/** Deterministic unit-ish vector: axis-heavy so nearest-neighbor order is predictable. */
function vec(axis: number, wobble = 0): number[] {
  const e = new Array(EMBEDDING_DIMS).fill(0.001);
  e[axis] = 1;
  if (wobble) e[(axis + 1) % EMBEDDING_DIMS] = wobble;
  return e;
}

async function vecSearch(t: any, vector: number[], opts: { seed?: string; limit?: number; ts?: number; hashOverride?: string } = {}) {
  const req: any = {
    v: 1, ownerRootId: OWNER, readerPrincipalId: OWNER,
    queryVectorHash: opts.hashOverride ?? (await vectorHashHex(vector)),
    timestamp: opts.ts ?? Date.now(), limit: opts.limit ?? 8,
  };
  const readerSig = await signChainHeadV3(opts.seed ?? ROOT_SEED, await vecSearchHead(req), "aumlokMemVecSearch");
  return t.action(internal.aumlokMemory.aumlokMemoryVectorSearch, { req, readerSig, queryVector: vector });
}

async function backfill(t: any, key: string, embedding: number[], opts: { seed?: string; hashOverride?: string; domain?: string } = {}) {
  const req: any = { v: 1, ownerRootId: OWNER, key, embeddingHash: opts.hashOverride ?? (await vectorHashHex(embedding)), timestamp: Date.now() };
  const ownerSig = await signChainHeadV3(opts.seed ?? ROOT_SEED, await embedHead(req), (opts.domain ?? "aumlokMemEmbed") as never);
  return t.mutation(internal.aumlokMemory.aumlokMemoryEmbedBackfill, { req, ownerSig, embedding });
}

describe("write-path embedding — validated hard, outside the integrity chain", () => {
  it("accepts a valid 384-d embedding on write and refuses wrong dims / non-finite", async () => {
    const t = await setup("w1");
    expect((await write(t, "row.a", "alpha content", vec(0))).ok).toBe(true);
    await expect(write(t, "row.bad", "x", [1, 2, 3])).rejects.toThrow(/embedding_invalid/);
    const nan = vec(1); nan[7] = Number.NaN;
    await expect(write(t, "row.nan", "x", nan)).rejects.toThrow(/embedding_invalid/);
  });
});

describe("aumlokMemoryVectorSearch — owner PoP, hash binding, keys-only, visibility law", () => {
  it("ranks by vector nearness, KEYS ONLY, capped by limit", async () => {
    const t = await setup("s1");
    await write(t, "row.axis0", "zero", vec(0));
    await write(t, "row.axis0ish", "near zero", vec(0, 0.6));
    await write(t, "row.axis5", "five", vec(5));
    const r = await vecSearch(t, vec(0), { limit: 2 });
    expect(r.ok).toBe(true);
    expect(r.hits.map((h: any) => h.key)).toEqual(["row.axis0", "row.axis0ish"]);
    expect(Object.keys(r.hits[0])).toEqual(["key"]); // keys only, never content
    expect(r).toMatchObject({ advisoryOnly: true, grantsAuthority: false });
  });

  it("a substituted vector is refused: the hash inside the signed preimage does not match", async () => {
    const t = await setup("s2");
    await write(t, "row.a", "alpha", vec(0));
    const r = await vecSearch(t, vec(0), { hashOverride: await vectorHashHex(vec(9)) });
    expect(r).toMatchObject({ ok: false, reason: "vector_hash_mismatch" });
  });

  it("attacker key, stale timestamp, and cross-domain replay are all refused", async () => {
    const t = await setup("s3");
    await write(t, "row.a", "alpha", vec(0));
    expect((await vecSearch(t, vec(0), { seed: ATTACKER_SEED })).reason).toBe("reader_pop_invalid");
    expect((await vecSearch(t, vec(0), { ts: Date.now() - 3_600_000 })).reason).toBe("stale");
    // a FULL-TEXT search PoP replayed against the vector surface: different domain → invalid.
    const req: any = { v: 1, ownerRootId: OWNER, readerPrincipalId: OWNER, queryVectorHash: await vectorHashHex(vec(0)), timestamp: Date.now(), limit: 8 };
    const wrongDomainSig = await signChainHeadV3(ROOT_SEED, await vecSearchHead(req), "aumlokMemSearch");
    const r = await t.action(internal.aumlokMemory.aumlokMemoryVectorSearch, { req, readerSig: wrongDomainSig, queryVector: vec(0) });
    expect(r).toMatchObject({ ok: false, reason: "reader_pop_invalid" });
  });

  it("an ERASED row never surfaces from the vector road (visibility law holds off-index)", async () => {
    const t = await setup("s4");
    await write(t, "row.keep", "kept", vec(0, 0.4));
    await write(t, "row.gone", "to be erased", vec(0));
    const er: any = { v: 1, ownerRootId: OWNER, key: "row.gone", eraseReason: "test", timestamp: Date.now() };
    const ownerSig = await signChainHeadV3(ROOT_SEED, await eraseHead(er), "aumlokMemErase");
    expect((await t.mutation(internal.aumlokMemory.aumlokMemoryErase, { req: er, ownerSig })).ok).toBe(true);
    const r = await vecSearch(t, vec(0));
    expect(r.ok).toBe(true);
    expect(r.hits.map((h: any) => h.key)).toEqual(["row.keep"]); // the erased nearest neighbor is gone
  });
});

describe("aumlokMemoryEmbedBackfill — absent-only, idempotent, own domain, erasure respected", () => {
  it("backfills a bare row exactly once; identical re-send is ok:already; different is refused", async () => {
    const t = await setup("b1");
    await write(t, "row.bare", "no vector yet");
    expect(await backfill(t, "row.bare", vec(3))).toMatchObject({ ok: true, already: false });
    expect(await backfill(t, "row.bare", vec(3))).toMatchObject({ ok: true, already: true });
    expect(await backfill(t, "row.bare", vec(4))).toMatchObject({ ok: false, reason: "embedding_present" });
    // and the backfilled row is now reachable on the vector road
    const r = await vecSearch(t, vec(3));
    expect(r.hits.map((h: any) => h.key)).toEqual(["row.bare"]);
  });

  it("refuses: hash mismatch, attacker key, cross-domain replay, missing and erased rows", async () => {
    const t = await setup("b2");
    await write(t, "row.a", "alpha");
    expect((await backfill(t, "row.a", vec(1), { hashOverride: await vectorHashHex(vec(2)) })).reason).toBe("embedding_hash_mismatch");
    expect((await backfill(t, "row.a", vec(1), { seed: ATTACKER_SEED })).reason).toBe("owner_pop_invalid");
    expect((await backfill(t, "row.a", vec(1), { domain: "aumlokMemErase" })).reason).toBe("owner_pop_invalid");
    expect((await backfill(t, "row.missing", vec(1))).reason).toBe("not_found");
    const er: any = { v: 1, ownerRootId: OWNER, key: "row.a", eraseReason: "test", timestamp: Date.now() };
    const ownerSig = await signChainHeadV3(ROOT_SEED, await eraseHead(er), "aumlokMemErase");
    await t.mutation(internal.aumlokMemory.aumlokMemoryErase, { req: er, ownerSig });
    expect((await backfill(t, "row.a", vec(1))).reason).toBe("erased"); // a forgotten memory grows no new index
  });

  it("backfill touches ONLY the embedding: value and memoryHash stay byte-identical (chain law)", async () => {
    const t = await setup("b3");
    await write(t, "row.a", "the exact original value");
    const before = await t.run(async (ctx: any) => (await ctx.db.query("aukora_memory").collect()).find((x: any) => x.key === "row.a"));
    expect(await backfill(t, "row.a", vec(6))).toMatchObject({ ok: true });
    const after = await t.run(async (ctx: any) => (await ctx.db.query("aukora_memory").collect()).find((x: any) => x.key === "row.a"));
    expect(after.value).toBe(before.value);
    expect(after.memoryHash).toBe(before.memoryHash);
    expect(after.receiptHash).toBe(before.receiptHash);
    expect(Array.isArray(after.embedding)).toBe(true);
  });
});
