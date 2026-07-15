// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * R5b CANDIDATE — aumlokMemorySearch boundary tests (convex-test, real deployed functions).
 * The search surface is deliberately narrow: owner-root PoP under the DEDICATED `aumlokMemSearch`
 * domain (query text inside the signed preimage), ranked KEYS ONLY (content stays behind
 * aumlokMemoryRecall's integrity-checked road), erased/quarantined/deleted rows never surface,
 * owner-only (no subject path this brick). Nothing in any lane calls this — it exists for the
 * R5b benchmark; recall cutover remains a separate owner-reviewed brick.
 */
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api";
import { mlDsa65PublicKeyFromSeed } from "../aukoraPqcSigner";
import { buildPoPEnvelope, POP_FRESHNESS_MS } from "../popResolver";
import { signChainHeadV3 } from "../aukoraSignedHead";
import { manifestRootHead, manifestPopHead, consumeHead } from "../aumlokManifests";
import { searchHead, eraseHead } from "../aumlokMemory";

const modules = import.meta.glob(["../*.ts", "../_generated/*.js", "!../vitest.config.ts"]);
const OPERATOR_SEED = "ab".repeat(32), ROOT_SEED = "11".repeat(32), SUBJECT_SEED = "55".repeat(32), ATTACKER_SEED = "ee".repeat(32);
const NODE = "aukora-node-a-demo", OWNER = "root-a", SUBJECT = "agent-echo", MFT = "mft-mem-search";

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
async function write(t: any, key: string, value: string) {
  const useSeq = seqByTest.get(t) ?? 0;
  seqByTest.set(t, useSeq + 1);
  const r = { v: 1, manifestId: MFT, subjectId: SUBJECT, ring: "local-write", action: "memory.write", resource: `mem:${OWNER}`, intentCodec: "json_action_v1", useSeq, timestamp: Date.now(), key };
  const subjectSig = await signChainHeadV3(SUBJECT_SEED, await consumeHead(r), "aumlokSubjectPop");
  const res = await t.mutation(internal.aumlokMemory.aumlokMemoryWrite, { req: r, subjectSig, value });
  expect(res.ok).toBe(true);
}

async function search(t: any, over: any = {}, sign: { seed?: string; domain?: string; forQuery?: string } = {}) {
  const r = { v: 1, ownerRootId: OWNER, query: "teal button demo", readerPrincipalId: OWNER, timestamp: Date.now(), ...over };
  const signed = sign.forQuery !== undefined ? { ...r, query: sign.forQuery } : r;
  const readerSig = await signChainHeadV3(sign.seed ?? ROOT_SEED, await searchHead(signed), (sign.domain ?? "aumlokMemSearch") as never);
  return t.query(internal.aumlokMemory.aumlokMemorySearch, { req: r, readerSig });
}

async function seedRows(t: any) {
  await write(t, "atom-teal", "the send button stays teal for the demo, decided with the owner");
  await write(t, "atom-brain", "convex backend runs loopback only, provisioned by brain setup");
  await write(t, "atom-flight", "the flight recorder chains events by hash so tampering shows");
}

describe("R5b aumlokMemorySearch — owner-signed, keys-only, visibility law", () => {
  it("owner-signed search returns the matching key, KEYS ONLY (no value, no content fields)", async () => {
    const t = await setup("hit");
    await seedRows(t);
    const res: any = await search(t);
    expect(res.ok).toBe(true);
    expect(res.hits.map((h: any) => h.key)).toContain("atom-teal");
    expect(res.advisoryOnly).toBe(true);
    expect(res.grantsAuthority).toBe(false);
    for (const h of res.hits) expect(Object.keys(h)).toEqual(["key"]);
    expect(JSON.stringify(res)).not.toContain("send button"); // content never rides a search result
  });

  it("a signature under the RECALL domain is refused (domain separation is real)", async () => {
    const t = await setup("dom");
    await seedRows(t);
    const res: any = await search(t, {}, { domain: "aumlokMemRecall" });
    expect(res).toMatchObject({ ok: false, reason: "reader_pop_invalid" });
  });

  it("signing query A then sending query B is refused (query text is inside the preimage)", async () => {
    const t = await setup("swap");
    await seedRows(t);
    const res: any = await search(t, { query: "flight recorder hash" }, { forQuery: "teal button demo" });
    expect(res).toMatchObject({ ok: false, reason: "reader_pop_invalid" });
  });

  it("a non-owner principal is refused even with a valid-shaped claim (owner-only brick)", async () => {
    const t = await setup("xp");
    await seedRows(t);
    const res: any = await search(t, { readerPrincipalId: SUBJECT }, { seed: SUBJECT_SEED });
    expect(res).toMatchObject({ ok: false, reason: "cross_principal_refused" });
  });

  it("an attacker key under the right domain is refused", async () => {
    const t = await setup("atk");
    await seedRows(t);
    const res: any = await search(t, {}, { seed: ATTACKER_SEED });
    expect(res).toMatchObject({ ok: false, reason: "reader_pop_invalid" });
  });

  it("a stale timestamp is refused", async () => {
    const t = await setup("stale");
    await seedRows(t);
    const res: any = await search(t, { timestamp: Date.now() - 120_000 });
    expect(res).toMatchObject({ ok: false, reason: "stale" });
  });

  it("empty / overlong / control-byte queries throw the typed refusal", async () => {
    const t = await setup("q");
    await seedRows(t);
    await expect(search(t, { query: "" })).rejects.toThrow("aumlok_mem_search_query_invalid");
    await expect(search(t, { query: "x".repeat(501) })).rejects.toThrow("aumlok_mem_search_query_invalid");
    await expect(search(t, { query: "tea" + String.fromCharCode(0) + "l" })).rejects.toThrow("aumlok_mem_search_query_invalid");
  });

  it("an ERASED row never surfaces in search results (visibility law parity with recall)", async () => {
    const t = await setup("erase");
    await seedRows(t);
    const before: any = await search(t);
    expect(before.hits.map((h: any) => h.key)).toContain("atom-teal");
    const er = { v: 1, ownerRootId: OWNER, key: "atom-teal", eraseReason: "search visibility test", timestamp: Date.now() };
    const ownerSig = await signChainHeadV3(ROOT_SEED, await eraseHead(er), "aumlokMemErase");
    const eres: any = await t.mutation(internal.aumlokMemory.aumlokMemoryErase, { req: er, ownerSig });
    expect(eres.ok).toBe(true);
    const after: any = await search(t);
    expect((after.hits ?? []).map((h: any) => h.key)).not.toContain("atom-teal");
  });

  it("limit is bounded 1..20 (out-of-range falls back to the default, never unbounded)", async () => {
    const t = await setup("lim");
    await seedRows(t);
    const res: any = await search(t, { limit: 9999 });
    expect(res.ok).toBe(true);
    expect(res.hits.length).toBeLessThanOrEqual(8);
  });
});
