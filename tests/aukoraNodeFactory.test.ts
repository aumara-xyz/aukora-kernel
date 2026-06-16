// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/// <reference types="vite/client" />
/**
 * B3.2 — NODE FACTORY, proven against the REAL deployed mutations via convex-test. Proves: `initNode` stamps a
 * deterministic, byte-identical, re-verifiable node identity (idempotent re-stamp; immutable; tier "lab"/"dev" only,
 * "production" refused; the signing SEED never persisted — only its fingerprint); the per-node ceremony rate-limit is
 * anti-spam and NOT authority (a rate-exceeded mint is a distinct error from a PoP failure, and the PoP is still the
 * gate); and indicative substrate benchmarks (receipt append/sec, chain-verify cost, op latency) for the B3.3 witness
 * cadence. The B2.4 manifest→grant→token→receipt path is untouched; no B0 delegation resurrection.
 */
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { mlDsa65PublicKeyFromSeed } from "../convex/aukoraPqcSigner";
import { buildPoPEnvelope, POP_FRESHNESS_MS } from "../convex/popResolver";
import { signChainHeadV3 } from "../convex/aukoraSignedHead";
import { rootKeyFingerprint } from "../convex/aumlokRootRegistry";
import { manifestRootHead, manifestPopHead, consumeHead } from "../convex/aumlokManifests";
import { ceremonyHead, serializeSummaryV1 } from "../convex/aumlokCeremony";
import { nodeStampHash, verifyNodeStamp } from "../convex/aukoraNodeFactory";
import { sha256Hex } from "../convex/aukoraCore";

const modules = import.meta.glob("../convex/**/*.*s");
const NODE = "aukora-node-a-demo";
const FP_A = "aa".repeat(32), FP_B = "bb".repeat(32);

// ── ceremony helper (self-sovereign mint, signed under the dedicated aumlokGenesis domain) ──
async function buildCeremony(seed: string, rootId: string, ceremonyId: string) {
  const pub = await mlDsa65PublicKeyFromSeed(seed);
  const fingerprint = rootKeyFingerprint(pub), keyId = "rk-1";
  const summary = { v: 1, rootId, keyId, nodeId: NODE, fingerprint, noRecovery: true, phraseTransitsServer: false, statement: `Mint ${rootId}.` };
  const summaryHash = await sha256Hex(serializeSummaryV1(summary));
  const challenge = { v: 1, ceremonyId, rootId, keyId, nodeId: NODE, fingerprint, summaryHash, timestamp: Date.now() };
  const rootSig = await signChainHeadV3(seed, await ceremonyHead(challenge), "aumlokGenesis");
  return { publicKey: pub, challenge, rootSig, summary, confirmedFingerprint: fingerprint };
}

describe("B3.2 — node factory: deterministic byte-identity stamp", () => {
  it("initNode stamps a node; the stamp is deterministic + re-verifiable; a tampered field breaks it", async () => {
    const t = convexTest(schema, modules);
    const r: any = await t.mutation(api.aukoraNodeFactory.initNode, { deploymentLabel: "aukora-node-a-lab", tier: "lab", rootPins: [FP_A] });
    expect([r.ok, r.stamped, r.nodeId, r.tier]).toEqual([true, true, NODE, "lab"]);
    expect(r.signingKeyFingerprint).toMatch(/^[0-9a-f]{64}$/); // public fingerprint only
    const id: any = await t.query(api.aukoraNodeFactory.nodeIdentity, {});
    expect([id.ok, id.tier, id.rootPins]).toEqual([true, "lab", [FP_A]]);
    // BYTE-IDENTITY: the same config re-derives the same stamp; a tampered row fails verification
    const row = await t.run(async (ctx: any) => ctx.db.query("aukora_node_identity").withIndex("by_nodeId", (q: any) => q.eq("nodeId", NODE)).first());
    expect(await verifyNodeStamp(row)).toBe(true);
    expect(await verifyNodeStamp({ ...row, tier: "dev" })).toBe(false);        // tampered tier
    expect(await verifyNodeStamp({ ...row, rootPinsJson: JSON.stringify([FP_B]) })).toBe(false); // tampered pins
    expect(r.stampHash).toBe(await nodeStampHash({ nodeId: NODE, deploymentLabel: "aukora-node-a-lab", tier: "lab", signingKeyFingerprint: r.signingKeyFingerprint, rootPins: [FP_A] }));
  });
  it("re-stamp is idempotent for the same config; a DIFFERENT config is refused (identity immutable)", async () => {
    const t = convexTest(schema, modules);
    const first: any = await t.mutation(api.aukoraNodeFactory.initNode, { deploymentLabel: "node-a", tier: "lab" });
    const again: any = await t.mutation(api.aukoraNodeFactory.initNode, { deploymentLabel: "node-a", tier: "lab" });
    expect([again.stamped, again.stampHash]).toEqual([false, first.stampHash]); // idempotent
    await expect(t.mutation(api.aukoraNodeFactory.initNode, { deploymentLabel: "node-a", tier: "dev" })).rejects.toThrow("aukora_node_already_stamped");
    await expect(t.mutation(api.aukoraNodeFactory.initNode, { deploymentLabel: "renamed", tier: "lab" })).rejects.toThrow("aukora_node_already_stamped");
  });
  it("tier discipline: only lab/dev stampable; production refused; malformed label/rootPin refused", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.aukoraNodeFactory.initNode, { deploymentLabel: "n", tier: "production" })).rejects.toThrow("aukora_node_tier_invalid");
    await expect(t.mutation(api.aukoraNodeFactory.initNode, { deploymentLabel: "Bad Label!", tier: "lab" })).rejects.toThrow("aukora_node_label_invalid");
    await expect(t.mutation(api.aukoraNodeFactory.initNode, { deploymentLabel: "n", tier: "lab", rootPins: ["not-a-fingerprint"] })).rejects.toThrow("aukora_node_rootpin_invalid");
    expect((await t.mutation(api.aukoraNodeFactory.initNode, { deploymentLabel: "n", tier: "dev" })).tier).toBe("dev"); // dev ok
  });
  it("secrets discipline: the signing SEED is never persisted — the stamp row holds only the public fingerprint", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.aukoraNodeFactory.initNode, { deploymentLabel: "node-a", tier: "lab" });
    const row = await t.run(async (ctx: any) => ctx.db.query("aukora_node_identity").withIndex("by_nodeId", (q: any) => q.eq("nodeId", NODE)).first());
    const blob = JSON.stringify(row).toLowerCase();
    for (const banned of ["seed", "private", "secret", process.env.AUKORA_CHAIN_SIGNING_SEED!.toLowerCase()]) expect(blob.includes(banned)).toBe(false);
  });
});

describe("B3.2 — per-node ceremony rate-limit (ANTI-SPAM, NOT AUTHORITY)", () => {
  it("caps successful mints per deployment per window; a rate-exceeded mint is refused with a RATE error (not an authority denial)", async () => {
    const prev = process.env.AUKORA_CEREMONY_RATE_CAP;
    process.env.AUKORA_CEREMONY_RATE_CAP = "2";
    try {
      const t = convexTest(schema, modules);
      const mint = (c: any) => t.mutation(api.aumlokCeremony.aumlokCeremonyMint, c);
      expect((await mint(await buildCeremony("11".repeat(32), "echo.one", "cer-1"))).ok).toBe(true);
      expect((await mint(await buildCeremony("22".repeat(32), "echo.two", "cer-2"))).ok).toBe(true);
      // 3rd valid, distinct mint — refused by the rate limit, NOT by authority (the PoP is valid)
      await expect(mint(await buildCeremony("33".repeat(32), "echo.three", "cer-3"))).rejects.toThrow("aumlok_ceremony_rate_exceeded");
      // the limit is anti-spam, not authority: a BAD-PoP mint still fails on AUTHORITY (a different error class), proving
      // the rate gate did not replace the authority gate
      const bad = await buildCeremony("44".repeat(32), "echo.four", "cer-4");
      await expect(mint({ ...bad, rootSig: await signChainHeadV3("ee".repeat(32), await ceremonyHead(bad.challenge), "aumlokGenesis") })).rejects.toThrow("aumlok_ceremony_root_pop_invalid");
    } finally {
      if (prev === undefined) delete process.env.AUKORA_CEREMONY_RATE_CAP; else process.env.AUKORA_CEREMONY_RATE_CAP = prev;
    }
  });
});

describe("B3.2 — substrate benchmarks (indicative, for the B3.3 witness cadence)", () => {
  it("measures receipt append/sec, chain-verify cost, and op latency (lab-indicative; not production latency)", async () => {
    const t = convexTest(schema, modules);
    // setup: an operator-born root + a memory-write manifest (root-a → agent-echo), maxUses high
    const opPub = await mlDsa65PublicKeyFromSeed("ab".repeat(32)), founderUserId = "demo.operator:bench", now = Date.now();
    await t.mutation(internal.popResolver.seedFounderKey, { founderUserId, keyId: "op-1", publicKey: opPub });
    const cav = (capId: string, methods: string[]) => ({ v: 1, capId, founderUserId, founderKeyId: "op-1", nodeId: NODE, methods, ring: "local-write", action: "aumlok", resource: "aumlok:root", principalId: founderUserId, roles: ["operator"], notBefore: now - 1000, expiresAt: now + POP_FRESHNESS_MS, maxUses: 1 });
    const rootPub = await mlDsa65PublicKeyFromSeed("11".repeat(32)), gArgs = { rootId: "root-a", keyId: "rk-1", publicKey: rootPub };
    const gEnv = await buildPoPEnvelope("ab".repeat(32), cav("cap-g", ["aumlokGenesisMint"]), { methodId: "aumlokGenesisMint", actualArgs: gArgs, timestamp: Date.now(), nonce: "g-bench" });
    await t.mutation(api.aumlokRootRegistry.aumlokGenesisMint, { env: gEnv, actualArgs: gArgs, nodeId: NODE });
    const subjectPub = await mlDsa65PublicKeyFromSeed("55".repeat(32)), N = 20;
    const m = { v: 1, manifestId: "mft-bench", rootId: "root-a", rootKeyId: "rk-1", nodeId: NODE, subjectId: "agent-echo", subjectKind: "agent", subjectPubKey: subjectPub, permissions: [{ ring: "local-write", action: "memory.write", resource: "mem:root-a" }], allowedIntentCodecs: ["json_action_v1"], notBefore: now - 1000, expiresAt: now + 3_600_000, maxUses: N + 5, maxPerWindow: null, createdAt: now };
    await t.mutation(api.aumlokManifests.aumlokMintManifest, { manifest: m, rootSig: await signChainHeadV3("11".repeat(32), await manifestRootHead(m), "aumlokManifest"), subjectPopSig: await signChainHeadV3("55".repeat(32), await manifestPopHead(m), "aumlokSubjectPop") });

    // (1) APPEND throughput: N memory writes to ONE chain (mem:root-a:diary) = N receipts, each a full
    //     manifest→consume→grant→token→receipt effect (the B2.4 path, intact).
    const tA = Date.now();
    for (let i = 0; i < N; i++) {
      const r = { v: 1, manifestId: "mft-bench", subjectId: "agent-echo", ring: "local-write", action: "memory.write", resource: "mem:root-a", intentCodec: "json_action_v1", useSeq: i, timestamp: Date.now(), key: "diary" };
      const subjectSig = await signChainHeadV3("55".repeat(32), await consumeHead(r), "aumlokSubjectPop");
      const w: any = await t.mutation(api.aumlokMemory.aumlokMemoryWrite, { req: r, subjectSig, value: `v${i}` });
      expect(w.ok).toBe(true);
    }
    const appendMs = Date.now() - tA, appendPerSec = Math.round((N / appendMs) * 1000);

    // (2) VERIFY cost: re-verify the N-receipt chain (recompute-and-compare audit).
    const tV = Date.now();
    const v: any = await t.run(async (ctx: any) => (await import("../convex/aukoraReceipts")).verifyReceiptChainCore(ctx, "mem:root-a:diary", 1000));
    const verifyMs = Date.now() - tV;
    expect([v.ok, v.status, v.headCount]).toEqual([true, "verified", N]);

    // (3) LATENCY: one ceremony mint (self-sovereign birth: PoP + mint + receipt).
    const tL = Date.now();
    expect((await t.mutation(api.aumlokCeremony.aumlokCeremonyMint, await buildCeremony("99".repeat(32), "echo.late", "cer-late"))).ok).toBe(true);
    const ceremonyMs = Date.now() - tL;

    // record (logged for the evidence doc; NOT asserted on timing — convex-test in-memory numbers are indicative only)
    console.log(`[B3.2 BENCH] append: ${N} receipts in ${appendMs}ms (~${appendPerSec}/s) · verify ${N}-chain: ${verifyMs}ms · ceremony latency: ${ceremonyMs}ms`);
    expect(appendPerSec).toBeGreaterThan(0); // sanity only
  });
});
