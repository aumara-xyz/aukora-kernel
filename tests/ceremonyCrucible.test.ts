// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/// <reference types="vite/client" />
/**
 * Brick 2 — CEREMONY / CROSS-NODE attacks ported INTO the demo's runnable suite, exercising the REAL slice functions
 * (api.ceremony.createDelegation / siliconAct / importDelegated / importDelegatedRevocation) against the deployed
 * node-a code via convex-test. This turns the previously PARTIAL ("proven only in the eval-dist snapshot") cross-node
 * + chain-tamper claims into honestly PROVEN-in-the-demo. Two instances = Node A (creates) + Node B (imports).
 */
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { buildReceiptChainHash } from "../convex/aukoraCore";
import { signChainHeadV3, resolveChainSigningSeed, type ChainHeadFields } from "../convex/aukoraSignedHead";
import { mlDsa65PublicKeyFromSeed } from "../convex/aukoraPqcSigner";

const modules = import.meta.glob("../convex/**/*.*s");
const CARBON_SEED = "bb".repeat(32);
const NODE_ID = "aukora-node-a-demo";
const SCOPE = { action: "studio.write", resource: "studio_surface:knvs", ring: "local-write" };
const delHead = (id: string, issuedAt: number, delHash: string): ChainHeadFields => ({ chainKey: `del:${id}`, timestamp: issuedAt, chainLength: 1, chainHeadHash: delHash });

async function setup(run: string) {
  const tA = convexTest(schema, modules), tB = convexTest(schema, modules);
  const carbonPub = await mlDsa65PublicKeyFromSeed(CARBON_SEED);
  const nodePub = await mlDsa65PublicKeyFromSeed(resolveChainSigningSeed()!);
  const carbonRoot = `demo.peter.carbon:${run}`, silicon = `demo.auma.silicon:${run}`, delegationId = `del:${run}`, issuedAt = 1;
  const payload = { delegationId, carbonRoot, siliconPrincipal: silicon, ...SCOPE, nodeId: NODE_ID, issuedAt };
  const delHash = await buildReceiptChainHash(payload, null);
  const sig = await signChainHeadV3(CARBON_SEED, delHead(delegationId, issuedAt, delHash), "delegation");
  await tA.mutation(api.ceremony.createDelegation, { ...payload, carbonPubkey: carbonPub, delHash, sig });
  const a: any = await tA.mutation(api.ceremony.siliconAct, { delegationId, chainKey: `cer:${run}:1`, ...SCOPE });
  await tB.mutation(internal.nodeB.pinTrust, { sourceNodeId: carbonRoot, headKeyId: "carbon", publicKey: carbonPub });
  await tB.mutation(internal.nodeB.pinTrust, { sourceNodeId: NODE_ID, headKeyId: "demo-key-1", publicKey: nodePub });
  return { tA, tB, carbonRoot, silicon, delegationId, env: a.envelope };
}
const imp = (s: any, env: any) => s.tB.mutation(internal.ceremony.importDelegated, { env });
const clone = (x: any) => JSON.parse(JSON.stringify(x));

describe("Ceremony Crucible — REAL slice importDelegated (demo runnable suite)", () => {
  it("VALID carbon->silicon import accepted", async () => {
    const s = await setup("v1");
    expect(await imp(s, s.env)).toMatchObject({ ok: true });
  });
  it("forged delegation (swapped silicon principal) -> forged_delegation", async () => {
    const s = await setup("v2"); const e = clone(s.env); e.delegation.siliconPrincipal = "demo.attacker.silicon";
    expect((await imp(s, e)).reason).toBe("forged_delegation");
  });
  it("forged receipt (tampered payload) -> forged_chain", async () => {
    const s = await setup("v3"); const e = clone(s.env); e.receipt.goal = "node-a DRAINED the account";
    expect((await imp(s, e)).reason).toBe("forged_chain");
  });
  it("wrong node signature (tampered head sig) -> bad_node_signature", async () => {
    const s = await setup("v3b"); const e = clone(s.env);
    e.head.headSig = await signChainHeadV3("cc".repeat(32), { chainKey: e.chainKey, timestamp: e.head.headSignedAt, chainLength: e.head.count, chainHeadHash: e.head.lastChainHash }, "chainHead");
    expect((await imp(s, e)).reason).toBe("bad_node_signature");
  });
  it("envelope replay -> refused (duplicate / chain_already_imported)", async () => {
    const s = await setup("v4");
    expect((await imp(s, s.env)).ok).toBe(true);
    expect((await imp(s, s.env)).reason).toMatch(/duplicate|chain_already_imported/);
  });
  it("revoked delegation -> import refused (revoked); historical envelope no longer actionable", async () => {
    const s = await setup("v5"); const revokedAt = 2;
    const revHash = await buildReceiptChainHash({ type: "delegation_revocation", carbonRoot: s.carbonRoot, delegationId: s.delegationId, revokedAt }, null);
    const revSig = await signChainHeadV3(CARBON_SEED, { chainKey: `del:${s.delegationId}:rev`, timestamp: revokedAt, chainLength: 1, chainHeadHash: revHash }, "delegation");
    await s.tB.mutation(internal.ceremony.importDelegatedRevocation, { rev: { carbonRoot: s.carbonRoot, delegationId: s.delegationId, revokedAt, sig: revSig } });
    expect((await imp(s, s.env)).reason).toBe("revoked");
  });
  it("rebinding a delegation to a DIFFERENT (unpinned) carbon root -> unpinned_carbon (no TOFU)", async () => {
    const s = await setup("v6"); const e = clone(s.env); e.delegation.carbonRoot = "demo.attacker.carbon:v6";
    // B3.5a: the substituted carbon root is NOT pinned -> refused BEFORE any signature/binding check (explicit-pin gate).
    expect((await imp(s, e)).reason).toBe("unpinned_carbon");
  });
  it("fresh pins refuse legacy/garbage keys (pin_pubkey_invalid) — a malformed pin can never brick peer trust", async () => {
    const s = await setup("v6c");
    await expect(s.tB.mutation(internal.nodeB.pinTrust, { sourceNodeId: "fresh.node:v6c", headKeyId: "k1", publicKey: "ab".repeat(32) })).rejects.toThrow("pin_pubkey_invalid"); // Ed25519-sized
    await expect(s.tB.mutation(internal.nodeB.pinTrust, { sourceNodeId: "fresh.node:v6c", headKeyId: "k1", publicKey: "GARBAGE" })).rejects.toThrow("pin_pubkey_invalid");
  });
  it("reserved ':rev' suffix refused: delegationId at creation, chainKey at receipt-write (B1.3b defense-in-depth)", async () => {
    const s = await setup("v6d");
    await expect(s.tA.mutation(api.ceremony.createDelegation, { delegationId: "del:v6d:rev", carbonRoot: "c", carbonPubkey: "x", siliconPrincipal: "sp", ...SCOPE, nodeId: NODE_ID, issuedAt: 1, delHash: "h", sig: "g" })).rejects.toThrow("aukora_delegation_id_reserved_suffix");
    await expect(s.tA.mutation(api.ceremony.siliconAct, { delegationId: s.delegationId, chainKey: "cer:v6d:rev", ...SCOPE })).rejects.toThrow("aukora_receipt_chainkey_reserved_suffix");
  });
  it("EXPLICIT PIN (no TOFU): an UNPINNED carbon root is REFUSED; after an explicit pin it imports + is IMMUTABLE", async () => {
    const s = await setup("v6b"); // tB has the node key pinned; we use a FRESH carbon root that is NOT pre-pinned
    const FRESH = "a1".repeat(32), freshPub = await mlDsa65PublicKeyFromSeed(FRESH);
    const cr = "demo.fresh.carbon:v6bf", del = "del:v6bf", issued = 1; // unique ids (avoid collision with setup's del/chainKey)
    const pl = { delegationId: del, carbonRoot: cr, siliconPrincipal: "demo.auma.silicon:v6bf", ...SCOPE, nodeId: NODE_ID, issuedAt: issued };
    const dh = await buildReceiptChainHash(pl, null);
    const sg = await signChainHeadV3(FRESH, delHead(del, issued, dh), "delegation");
    await s.tA.mutation(api.ceremony.createDelegation, { ...pl, carbonPubkey: freshPub, delHash: dh, sig: sg });
    const act: any = await s.tA.mutation(api.ceremony.siliconAct, { delegationId: del, chainKey: "cer:v6bf:1", ...SCOPE });
    // B3.5a — NO TOFU: a first-sight (unpinned) carbon root is REFUSED, never auto-pinned.
    expect((await imp(s, act.envelope)).reason).toBe("unpinned_carbon");
    // explicit out-of-band pin, THEN import is accepted (verified against the PINNED value only).
    await s.tB.mutation(internal.nodeB.pinTrust, { sourceNodeId: cr, headKeyId: "carbon", publicKey: freshPub });
    expect((await imp(s, act.envelope)).ok).toBe(true);
    // the explicit pin is IMMUTABLE: an attacker cannot overwrite it (conflict-first, before the shape gate).
    await expect(s.tB.mutation(internal.nodeB.pinTrust, { sourceNodeId: cr, headKeyId: "carbon", publicKey: "ATTACKER_CARBON_KEY" })).rejects.toThrow("pin_immutable_conflict");
  });
});