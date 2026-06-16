// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/// <reference types="vite/client" />
/**
 * B2.3 — self-sovereign AUMLOK ceremony, proven against the REAL deployed mutation via convex-test. The ROOT proves
 * possession of its OWN key (no operator); only PUBLIC material reaches the server. Proven here: a valid ceremony
 * mints an active root + a V4 birth receipt whose payload carries the root's OWN verifiable attestation; missing /
 * wrong-key / wrong-domain root proofs refuse; fingerprint-confirmation, nodeId, freshness, replay, summary-tamper,
 * duplicate-root, and malformed-input all refuse; the system refuses to mint a recovery-claiming identity; and NO
 * phrase / root seed / private key appears in the args, the schema row, or the birth receipt (structural absence).
 */
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { sha256Hex } from "../convex/aukoraCore";
import { mlDsa65PublicKeyFromSeed } from "../convex/aukoraPqcSigner";
import { signChainHeadV3, verifyChainHeadV3, SIGNED_HEAD_V4_ALG } from "../convex/aukoraSignedHead";
import { rootKeyFingerprint } from "../convex/aumlokRootRegistry";
import { ceremonyHead, serializeSummaryV1 } from "../convex/aumlokCeremony";
import { verifyReceiptChainCore } from "../convex/aukoraReceipts";

const modules = import.meta.glob("../convex/**/*.*s");
const ROOT_SEED = "11".repeat(32);     // the CLIENT-derived root seed — never sent to the server
const ATTACKER_SEED = "ee".repeat(32);
const NODE = "aukora-node-a-demo";     // matches AUMA_NODE_ID (vitest.config)

/** Build a fully-signed valid ceremony (client-side); `over` lets a test corrupt one piece before it reaches the server. */
async function build(seed = ROOT_SEED, over: any = {}) {
  const pub = await mlDsa65PublicKeyFromSeed(seed);
  const fingerprint = rootKeyFingerprint(pub);
  const rootId = over.rootId ?? "echo.carbon", keyId = over.keyId ?? "rk-1", ceremonyId = over.ceremonyId ?? "cer-1";
  const nodeId = over.nodeId ?? NODE;
  const summary = { v: 1, rootId, keyId, nodeId, fingerprint, noRecovery: true, phraseTransitsServer: false, statement: `Mint AUMLOK identity root ${rootId} — no recovery; the phrase never leaves this device.`, ...over.summary };
  const summaryHash = await sha256Hex(serializeSummaryV1(summary));
  const challenge = { v: 1, ceremonyId, rootId, keyId, nodeId, fingerprint, summaryHash, timestamp: Date.now(), ...over.challenge };
  const rootSig = await signChainHeadV3(seed, await ceremonyHead(challenge), over.sigDomain ?? "aumlokGenesis");
  return { pub, fingerprint, rootId, keyId, ceremonyId, summary, challenge, rootSig };
}
const mint = (t: any, c: any, over: any = {}) =>
  t.mutation(api.aumlokCeremony.aumlokCeremonyMint, { publicKey: c.pub, challenge: c.challenge, rootSig: c.rootSig, summary: c.summary, confirmedFingerprint: c.fingerprint, ...over });
const rootRow = (t: any, rootId: string) => t.run(async (ctx: any) => ctx.db.query("aumlok_root_keys").withIndex("by_root", (q: any) => q.eq("rootId", rootId)).first());

describe("B2.3 — self-sovereign ceremony mint (root proves itself; no operator)", () => {
  it("a valid ceremony mints an active root + a V4 birth receipt carrying the root's OWN verifiable attestation", async () => {
    const t = convexTest(schema, modules);
    const c = await build();
    const r: any = await mint(t, c);
    expect([r.ok, r.rootId, r.fingerprint]).toEqual([true, "echo.carbon", c.fingerprint]);
    const row: any = await rootRow(t, "echo.carbon");
    expect([row.status, row.keyId, row.publicKey]).toEqual(["active", "rk-1", c.pub]);
    // birth receipt on id:{rootId}: head node-signed (V4), payload carries the root's own ceremony signature
    const v: any = await t.run(async (ctx: any) => verifyReceiptChainCore(ctx, "id:echo.carbon", 1000));
    expect([v.ok, v.status, v.headCount]).toEqual([true, "verified", 1]);
    const head = await t.run(async (ctx: any) => ctx.db.query("auma_receipt_chain_head").withIndex("by_key", (q: any) => q.eq("key", "id:echo.carbon")).first());
    expect(head.headSigAlg).toBe(SIGNED_HEAD_V4_ALG); // HEAD is node-signed — NOT "signed as herself"
    const receipt = await t.run(async (ctx: any) => ctx.db.query("auma_receipts").withIndex("by_chainKey_ts", (q: any) => q.eq("chainKey", "id:echo.carbon")).first());
    const proof = JSON.parse(receipt.proofJson);
    // the EMBEDDED root attestation verifies (recompute the head from the embedded challenge → verify the root's sig)
    expect(await verifyChainHeadV3(c.pub, await ceremonyHead(proof.challenge), proof.rootBirthSig, "aumlokGenesis")).toBe(true);
    expect(proof.noRecovery).toBe(true);
  });
  it("the root proof-of-possession is the authority: missing / wrong-key / wrong-domain all refuse", async () => {
    const t = convexTest(schema, modules);
    const c = await build();
    await expect(mint(t, c, { rootSig: "" })).rejects.toThrow("aumlok_ceremony_signature_missing");
    const attackerSig = await signChainHeadV3(ATTACKER_SEED, await ceremonyHead(c.challenge), "aumlokGenesis");
    await expect(mint(t, c, { rootSig: attackerSig })).rejects.toThrow("aumlok_ceremony_root_pop_invalid"); // pubkey doesn't own that sig
    const wrongDomainSig = await signChainHeadV3(ROOT_SEED, await ceremonyHead(c.challenge), "cap");
    await expect(mint(t, c, { rootSig: wrongDomainSig })).rejects.toThrow("aumlok_ceremony_root_pop_invalid"); // wrong FIPS 204 domain
    expect(await rootRow(t, "echo.carbon")).toBeNull();
  });
  it("fingerprint confirmation is required (mismatch refuses) — the procedural typo-catch", async () => {
    const t = convexTest(schema, modules);
    const c = await build();
    await expect(mint(t, c, { confirmedFingerprint: "00".repeat(32) })).rejects.toThrow("aumlok_ceremony_fingerprint_mismatch");
  });
  it("nodeId binding: a ceremony for another node refuses (cross-node)", async () => {
    const t = convexTest(schema, modules);
    const c = await build(ROOT_SEED, { nodeId: "aukora-node-b-demo" });
    await expect(mint(t, c)).rejects.toThrow("aumlok_ceremony_node_mismatch");
  });
  it("freshness + replay: a stale challenge refuses; a re-used ceremonyId refuses", async () => {
    const t = convexTest(schema, modules);
    const stale = await build(ROOT_SEED, { challenge: { timestamp: Date.now() - 5 * 60_000 }, ceremonyId: "cer-stale" });
    await expect(mint(t, stale)).rejects.toThrow("aumlok_ceremony_stale");
    const c = await build();
    expect((await mint(t, c)).ok).toBe(true);
    await expect(mint(t, c)).rejects.toThrow("aumlok_ceremony_replay"); // same ceremonyId, second time
  });
  it("a tampered ceremony summary refuses (it is bound into the signed challenge)", async () => {
    const t = convexTest(schema, modules);
    const c = await build();
    await expect(mint(t, c, { summary: { ...c.summary, statement: "EVIL — grants admin forever" } })).rejects.toThrow("aumlok_ceremony_summary_binding_mismatch");
  });
  it("the system refuses to mint a RECOVERY-claiming identity (noRecovery must be true)", async () => {
    const t = convexTest(schema, modules);
    const c = await build(ROOT_SEED, { summary: { noRecovery: false } }); // a summary asserting recoverability, properly signed
    await expect(mint(t, c)).rejects.toThrow("aumlok_ceremony_summary_no_recovery_required");
    expect(await rootRow(t, "echo.carbon")).toBeNull(); // no recovery path exists or can be minted
  });
  it("duplicate rootId refuses (born once); malformed rootId / keyId / publicKey refuse", async () => {
    const t = convexTest(schema, modules);
    expect((await mint(t, await build())).ok).toBe(true);
    await expect(mint(t, await build(ROOT_SEED, { ceremonyId: "cer-2" }))).rejects.toThrow("aumlok_root_already_exists"); // same root, fresh ceremony
    await expect(mint(t, await build(ROOT_SEED, { rootId: "echo:carbon", ceremonyId: "cer-3" }))).rejects.toThrow("aumlok_ceremony_name_invalid:rootId"); // colon
    await expect(mint(t, await build(ROOT_SEED, { keyId: "RK 1", ceremonyId: "cer-4" }))).rejects.toThrow("aumlok_ceremony_name_invalid:keyId");
    await expect(mint(t, await build(ROOT_SEED, { ceremonyId: "cer-5" }), { publicKey: ROOT_SEED /* 64-hex seed, not a pubkey */ })).rejects.toThrow("aumlok_ceremony_pubkey_invalid");
  });
});

describe("B2.3 — structural absence: no phrase / root seed / private key reaches Convex", () => {
  it("the ceremony module handles ONLY public material (no derive module, no Argon2id, no seed-derivation, no seed/phrase arg)", () => {
    const src = import.meta.glob("../convex/aumlokCeremony.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const code = Object.values(src)[0];
    expect(code).toBeTruthy();
    expect(code.includes("aukoraAumlokDerive")).toBe(false);       // never the phrase-derivation module
    expect(code.includes("@noble/hashes/argon2")).toBe(false);     // the memory-hard KDF never runs server-side
    expect(code.includes("mlDsa65PublicKeyFromSeed")).toBe(false); // never derives a key from a seed in a mutation
    // the mutation's args are public-only — no seed/phrase/privateKey input
    expect(/args:\s*\{[^}]*\}/.test(code)).toBe(true);
    const args = code.match(/args:\s*\{[^}]*\}/)![0];
    for (const banned of ["seed", "phrase", "privateKey", "mnemonic"]) expect(args.toLowerCase().includes(banned)).toBe(false);
  });
  it("the stored ceremony row + the birth receipt payload contain no seed/phrase/private material", async () => {
    const t = convexTest(schema, modules);
    await mint(t, await build());
    const cer = await t.run(async (ctx: any) => ctx.db.query("aumlok_ceremonies").withIndex("by_root", (q: any) => q.eq("rootId", "echo.carbon")).first());
    const receipt = await t.run(async (ctx: any) => ctx.db.query("auma_receipts").withIndex("by_chainKey_ts", (q: any) => q.eq("chainKey", "id:echo.carbon")).first());
    const blobs = [JSON.stringify(cer), receipt.proofJson, receipt.actionsJson];
    for (const blob of blobs) for (const banned of ["seed", "phrase", "private", "mnemonic", ROOT_SEED]) {
      expect(blob.toLowerCase().includes(banned.toLowerCase())).toBe(false);
    }
  });
  it("no recovery mutation exists in the ceremony surface", () => {
    const src = import.meta.glob("../convex/aumlokCeremony.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const code = Object.values(src)[0].toLowerCase();
    for (const banned of ["export const recover", "export const restore", "export const aumlokrecover", "backupseed"]) expect(code.includes(banned)).toBe(false);
  });
});
