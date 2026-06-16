// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/// <reference types="vite/client" />
/**
 * B3.3 — WITNESS MESH. Real ML-DSA-65 signed peer heads + real RFC 6962 consistency proofs. Proves: the
 * `aukora-witness-v1` domain is minted; first observation = BASELINE (sig+version+pin only, no append-only claim);
 * a valid consistency proof ADVANCES the (size,root) HWM and the ATTESTATION carries the baseline; the three
 * EQUIVOCATIONS (regression / fork / rewrite) each record a signed non-repudiable finding with BOTH conflicting heads
 * and never advance; fail-closed on unpinned peer, wrong surface/version, bad head sig, and growth-without-proof; the
 * recordType is bound into the signed preimage (a baseline sig can't verify as an attestation); and the scheduler is
 * flag-gated (a missed poll is liveness, never equivocation).
 */
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { signChainHeadV4, deriveChainId, type ChainHeadFields } from "../convex/aukoraSignedHead";
import { mlDsa65PublicKeyFromSeed, PQC_DOMAINS } from "../convex/aukoraPqcSigner";
import { RESERVED_MESH_DOMAINS } from "../convex/aukoraWireRegistry";
import { leafHash, merkleRootHex, consistencyProofHex } from "../convex/aukoraMerkleLog";
import { buildExportEnvelope } from "../convex/aukoraWireFormat";
import { signWitnessRecord, verifyWitnessRecord } from "../convex/aukoraWitness";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

const modules = import.meta.glob("../convex/**/*.*s");
const PEER_SEED = "22".repeat(32);                 // peer's distinct signing seed (≠ the witness seed in vitest.config)
const WITNESS_SEED = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"; // == vitest.config seed
const PEER = "aukora-lab-beta", KID = "beta-key-1", CK = "mem:peer:diary";
const CHAIN_ID = bytesToHex(deriveChainId(CK));
// distinct 64-hex receipt chain-hashes for two DIVERGENT chains (A = honest, B = forked)
const rawA = Array.from({ length: 6 }, (_, i) => (`a${i}`).padEnd(2, "0").repeat(32).slice(0, 64));
const rawB = Array.from({ length: 6 }, (_, i) => (`b${i}`).padEnd(2, "0").repeat(32).slice(0, 64));
const leafHex = (raw: string[]) => raw.map((r) => bytesToHex(leafHash(hexToBytes(r))));

/** Build a real env-v1 receipt-head export for a peer chain at `size`, signed by `seed`. */
async function makeExport(seed: string, raw: string[], size: number) {
  const root = merkleRootHex(raw.slice(0, size));
  const headHash = raw[size - 1];
  const ts = 1000 + size;
  const hf: ChainHeadFields = { chainKey: CK, timestamp: ts, chainLength: size, chainHeadHash: headHash };
  const headSig = await signChainHeadV4(seed, hf, root, "chainHead");
  const head = { sourceNodeId: PEER, headKeyId: KID, chainKey: CK, lastChainHash: headHash, count: size, updatedAt: ts, headSig, headSigAlg: "ml-dsa-65-chainhead-v4", headSignedAt: ts, receiptLogRoot: root };
  return { env: buildExportEnvelope({ surface: "receipt-head", headVersion: "v4", head, payload: { n: String(size) } }), root, headHash };
}
const proofHex = (raw: string[], s1: number, s2: number) => consistencyProofHex(leafHex(raw).slice(0, s2), s1, s2);
async function pinPeer(t: any) {
  const publicKey = await mlDsa65PublicKeyFromSeed(PEER_SEED);
  await t.run(async (ctx: any) => ctx.db.insert("node_trust_registry", { sourceNodeId: PEER, headKeyId: KID, publicKey, pinnedAt: 1 }));
}
const hwm = (t: any) => t.query(api.aukoraWitness.witnessHwm, { peerNodeId: PEER, headKeyId: KID, chainId: CHAIN_ID });
const findings = (t: any) => t.query(api.aukoraWitness.witnessFindings, { peerNodeId: PEER, chainId: CHAIN_ID });

describe("B3.3 — domain mint (§10.2 Option B)", () => {
  it("aukora-witness-v1 is MINTED into PQC_DOMAINS and no longer reserved", () => {
    expect(Object.values(PQC_DOMAINS)).toContain("aukora-witness-v1");
    expect((RESERVED_MESH_DOMAINS as readonly string[]).includes("aukora-witness-v1")).toBe(false);
    expect(Object.values(PQC_DOMAINS)).toContain("aukora-node-import-v1");                              // B3.5a: MINTED
    expect((RESERVED_MESH_DOMAINS as readonly string[]).includes("aukora-node-import-v1")).toBe(false); // no longer reserved
  });
});

describe("B3.3 — baseline + consistent advance", () => {
  it("first observation is BASELINE (no consistency proof); a valid proof ADVANCES the HWM; attestation carries baseline", async () => {
    const t = convexTest(schema, modules);
    await pinPeer(t);
    const b = await makeExport(PEER_SEED, rawA, 3);
    expect(await t.mutation(internal.aukoraWitness.witnessObserve, { envelope: b.env })).toMatchObject({ ok: true, recordType: "baseline", size: 3 });
    let h: any = await hwm(t);
    expect([h.size, h.root, h.baselineSize, h.baselineRoot]).toEqual([3, b.root, 3, b.root]);

    const g = await makeExport(PEER_SEED, rawA, 5);
    const res: any = await t.mutation(internal.aukoraWitness.witnessObserve, { envelope: g.env, consistencyProof: proofHex(rawA, 3, 5) });
    expect(res).toMatchObject({ ok: true, recordType: "attestation", kind: "extension", size: 5 });
    h = await hwm(t);
    expect([h.size, h.root, h.baselineSize]).toEqual([5, g.root, 3]); // advanced; baseline preserved
    const rec = JSON.parse(h.lastRecordJson);
    expect([rec.recordType, rec.baselineSize, rec.baselineRoot, rec.baselineHeadHash, typeof rec.observedAt]).toEqual(["attestation", 3, b.root, rawA[2], "number"]);
    expect((await findings(t)).length).toBe(0);
  });

  it("a same-(size,root) re-observation is a STABLE attestation, no finding", async () => {
    const t = convexTest(schema, modules);
    await pinPeer(t);
    const b = await makeExport(PEER_SEED, rawA, 4);
    await t.mutation(internal.aukoraWitness.witnessObserve, { envelope: b.env });
    expect(await t.mutation(internal.aukoraWitness.witnessObserve, { envelope: b.env })).toMatchObject({ ok: true, recordType: "attestation", kind: "stable" });
    expect((await findings(t)).length).toBe(0);
  });
});

describe("B3.3 — equivocation findings (record/refuse only; HWM never advances)", () => {
  it("REGRESSION: a validly-signed shorter head → finding with both heads; HWM unchanged", async () => {
    const t = convexTest(schema, modules);
    await pinPeer(t);
    await t.mutation(internal.aukoraWitness.witnessObserve, { envelope: (await makeExport(PEER_SEED, rawA, 5)).env });
    const res: any = await t.mutation(internal.aukoraWitness.witnessObserve, { envelope: (await makeExport(PEER_SEED, rawA, 3)).env });
    expect(res).toMatchObject({ ok: false, recordType: "equivocation", kind: "regression" });
    expect((await hwm(t)).size).toBe(5);
    const f: any[] = await findings(t);
    expect(f.length).toBe(1);
    expect([f[0].kind, JSON.parse(f[0].headAJson).chainLength, JSON.parse(f[0].headBJson).chainLength]).toEqual(["regression", 5, 3]);
  });

  it("FORK: same size, different root → finding; HWM unchanged", async () => {
    const t = convexTest(schema, modules);
    await pinPeer(t);
    const a = await makeExport(PEER_SEED, rawA, 4);
    await t.mutation(internal.aukoraWitness.witnessObserve, { envelope: a.env });
    const fork = await makeExport(PEER_SEED, rawB, 4); // SAME size, DIFFERENT chain (both signed by the peer)
    const res: any = await t.mutation(internal.aukoraWitness.witnessObserve, { envelope: fork.env });
    expect(res).toMatchObject({ ok: false, kind: "fork" });
    expect((await hwm(t)).root).toBe(a.root);          // unchanged
    expect((await findings(t))[0].kind).toBe("fork");
  });

  it("REWRITE: growth whose consistency proof FAILS → finding; HWM unchanged", async () => {
    const t = convexTest(schema, modules);
    await pinPeer(t);
    const base = await makeExport(PEER_SEED, rawA, 3);
    await t.mutation(internal.aukoraWitness.witnessObserve, { envelope: base.env });
    // observe a DIFFERENT chain at size 5 with ITS OWN (internally valid) proof — inconsistent with rawA's root@3
    const g = await makeExport(PEER_SEED, rawB, 5);
    const res: any = await t.mutation(internal.aukoraWitness.witnessObserve, { envelope: g.env, consistencyProof: proofHex(rawB, 3, 5) });
    expect(res).toMatchObject({ ok: false, kind: "rewrite" });
    expect((await hwm(t)).size).toBe(3);
    expect((await findings(t))[0].kind).toBe("rewrite");
  });
});

describe("B3.3 — fail closed", () => {
  it("unpinned peer is refused (no TOFU)", async () => {
    const t = convexTest(schema, modules);
    const b = await makeExport(PEER_SEED, rawA, 3);
    expect(await t.mutation(internal.aukoraWitness.witnessObserve, { envelope: b.env })).toMatchObject({ ok: false, reason: "unpinned_peer" });
  });
  it("wrong surface/version is refused", async () => {
    const t = convexTest(schema, modules);
    await pinPeer(t);
    const b = await makeExport(PEER_SEED, rawA, 3);
    expect(await t.mutation(internal.aukoraWitness.witnessObserve, { envelope: { ...b.env, surface: "checkpoint-head" } })).toMatchObject({ ok: false, reason: "wrong_surface_or_version" });
  });
  it("a bad head signature is refused (no finding — only validly-signed heads can be findings)", async () => {
    const t = convexTest(schema, modules);
    await pinPeer(t);
    const b = await makeExport(PEER_SEED, rawA, 3);
    const realSig = b.env.head.headSig as string;
    const badSig = realSig.slice(0, -1) + (realSig.slice(-1) === "a" ? "b" : "a"); // valid hex+length, wrong sig
    const env = { ...b.env, head: { ...b.env.head, headSig: badSig } };
    expect(await t.mutation(internal.aukoraWitness.witnessObserve, { envelope: env })).toMatchObject({ ok: false, reason: "head_sig_invalid" });
    expect((await findings(t)).length).toBe(0);
  });
  it("growth WITHOUT a consistency proof does not advance", async () => {
    const t = convexTest(schema, modules);
    await pinPeer(t);
    await t.mutation(internal.aukoraWitness.witnessObserve, { envelope: (await makeExport(PEER_SEED, rawA, 3)).env });
    const res: any = await t.mutation(internal.aukoraWitness.witnessObserve, { envelope: (await makeExport(PEER_SEED, rawA, 5)).env });
    expect(res).toMatchObject({ ok: false, reason: "missing_consistency_proof" });
    expect((await hwm(t)).size).toBe(3);
  });
});

describe("B3.3 — recordType is bound into the signed preimage (§10.2 Option B)", () => {
  it("a baseline-typed record's signature does NOT verify as an attestation", async () => {
    const pub = await mlDsa65PublicKeyFromSeed(WITNESS_SEED);
    const base = { recordType: "baseline", peerNodeId: PEER, chainId: CHAIN_ID, baselineSize: 3, observedAt: 7 };
    const sig = await signWitnessRecord(WITNESS_SEED, base);
    expect(await verifyWitnessRecord(pub, base, sig)).toBe(true);
    expect(await verifyWitnessRecord(pub, { ...base, recordType: "attestation" }, sig)).toBe(false);
  });
});

describe("B3.3 — scheduler is flag-gated; a missed poll is liveness, not equivocation", () => {
  it("witnessTick is DORMANT with the flag off", async () => {
    const t = convexTest(schema, modules);
    expect(await t.action(internal.aukoraWitness.witnessTick, {})).toMatchObject({ skipped: "witness_disabled" });
  });
  it("with the flag on, a poll with no transport records LIVENESS and NO equivocation finding", async () => {
    const t = convexTest(schema, modules);
    await pinPeer(t);
    process.env.AUKORA_B3_WITNESS_ENABLED = "1";
    try {
      const res: any = await t.action(internal.aukoraWitness.witnessTick, {});
      expect(res).toMatchObject({ skipped: false, polled: 1 });
    } finally { delete process.env.AUKORA_B3_WITNESS_ENABLED; }
    const live: any[] = await t.query(api.aukoraWitness.witnessLiveness, { peerNodeId: PEER, headKeyId: KID });
    expect([live.length, live[0].reason]).toEqual([1, "poll_no_transport"]);
    expect((await findings(t)).length).toBe(0); // never an equivocation
  });
});
