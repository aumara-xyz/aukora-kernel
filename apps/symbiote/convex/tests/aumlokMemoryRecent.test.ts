// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * R5d — aumlokMemoryRecent boundary tests (convex-test, real deployed functions).
 * Narrow surface: owner-root PoP under the dedicated `aumlokMemRecent` domain, newest-first
 * KEYS + createdAt only, erased/quarantined/deleted rows never surface, owner-only (no subject path).
 * Content still stays behind aumlokMemoryRecall.
 */
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api";
import { mlDsa65PublicKeyFromSeed } from "../aukoraPqcSigner";
import { buildPoPEnvelope, POP_FRESHNESS_MS } from "../popResolver";
import { signChainHeadV3 } from "../aukoraSignedHead";
import { manifestRootHead, manifestPopHead, consumeHead } from "../aumlokManifests";
import { recentHead, eraseHead } from "../aumlokMemory";

const modules = import.meta.glob(["../*.ts", "../_generated/*.js", "!../vitest.config.ts"]);
const OPERATOR_SEED = "ab".repeat(32), ROOT_SEED = "11".repeat(32), SUBJECT_SEED = "55".repeat(32), ATTACKER_SEED = "ee".repeat(32);
const NODE = "aukora-node-a-demo", OWNER = "root-a", SUBJECT = "agent-echo", MFT = "mft-mem-recent";

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

async function recent(t: any, over: any = {}, sign: { seed?: string; domain?: string; forLimit?: number } = {}) {
  const r = { v: 1, ownerRootId: OWNER, readerPrincipalId: OWNER, timestamp: Date.now(), limit: 5, ...over };
  const signed = sign.forLimit !== undefined ? { ...r, limit: sign.forLimit } : r;
  const readerSig = await signChainHeadV3(sign.seed ?? ROOT_SEED, await recentHead(signed), (sign.domain ?? "aumlokMemRecent") as never);
  return t.query(internal.aumlokMemory.aumlokMemoryRecent, { req: r, readerSig });
}

describe("R5d aumlokMemoryRecent — owner-signed, newest-first metadata only", () => {
  it("owner-signed recent returns newest-first keys + createdAt only", async () => {
    const t = await setup("hit");
    await write(t, "atom-old", "first row");
    await write(t, "atom-new", "second row");
    const res: any = await recent(t);
    expect(res.ok).toBe(true);
    expect(res.hits.map((h: any) => h.key)).toEqual(["atom-new", "atom-old"]);
    for (const h of res.hits) {
      expect(Object.keys(h).sort()).toEqual(["createdAt", "key"]);
      expect(typeof h.createdAt).toBe("number");
    }
    expect(res.advisoryOnly).toBe(true);
    expect(res.grantsAuthority).toBe(false);
  });

  it("a signature under the RECALL domain is refused (domain separation is real)", async () => {
    const t = await setup("dom");
    await write(t, "atom", "row");
    const res: any = await recent(t, {}, { domain: "aumlokMemRecall" });
    expect(res).toMatchObject({ ok: false, reason: "reader_pop_invalid" });
  });

  it("signing limit A then sending limit B is refused (limit rides inside the preimage)", async () => {
    const t = await setup("swap");
    await write(t, "atom", "row");
    const res: any = await recent(t, { limit: 3 }, { forLimit: 5 });
    expect(res).toMatchObject({ ok: false, reason: "reader_pop_invalid" });
  });

  it("a non-owner principal is refused even with a valid-shaped claim (owner-only brick)", async () => {
    const t = await setup("xp");
    await write(t, "atom", "row");
    const res: any = await recent(t, { readerPrincipalId: SUBJECT }, { seed: SUBJECT_SEED });
    expect(res).toMatchObject({ ok: false, reason: "cross_principal_refused" });
  });

  it("an attacker key under the right domain is refused", async () => {
    const t = await setup("atk");
    await write(t, "atom", "row");
    const res: any = await recent(t, {}, { seed: ATTACKER_SEED });
    expect(res).toMatchObject({ ok: false, reason: "reader_pop_invalid" });
  });

  it("an ERASED row never surfaces in recent results", async () => {
    const t = await setup("erase");
    await write(t, "atom-live", "still here");
    await write(t, "atom-gone", "erase me");
    const er = { v: 1, ownerRootId: OWNER, key: "atom-gone", eraseReason: "recent visibility test", timestamp: Date.now() };
    const ownerSig = await signChainHeadV3(ROOT_SEED, await eraseHead(er), "aumlokMemErase");
    expect((await t.mutation(internal.aumlokMemory.aumlokMemoryErase, { req: er, ownerSig }) as any).ok).toBe(true);
    const res: any = await recent(t);
    expect((res.hits ?? []).map((h: any) => h.key)).toEqual(["atom-live"]);
  });
});
