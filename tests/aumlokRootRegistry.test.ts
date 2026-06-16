// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/// <reference types="vite/client" />
/**
 * B2.1 — AUMLOK identity ROOT-key registry + lifecycle, proven against the REAL deployed mutations via convex-test.
 * Two authority layers: OPERATOR PoP gates each mutation (operator-born, interim until the B2.3 ceremony); the OLD
 * root key's signature (aumlokRotation domain) gates the registry FLIP. Proven here: genesis (active key + a V4
 * `id:{rootId}` lifecycle receipt); grandfathering (retired key can't author a new rotation, but its historical
 * statement still verifies); revocation kills live use; rotation requires a valid old-key signature (wrong key /
 * wrong domain / tampered / garbage all refuse); cross-rotation lineage; replay/dup/malformed refusal; the `id:`
 * chainKey reservation (general writers refused); and the structural absence of any seed/phrase/derivation server-side.
 * The server pins PUBLIC keys ONLY — no seed or phrase ever transits a mutation.
 */
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { mlDsa65PublicKeyFromSeed } from "../convex/aukoraPqcSigner";
import { buildPoPEnvelope, POP_FRESHNESS_MS } from "../convex/popResolver";
import { signChainHeadV3, verifyChainHeadV3, SIGNED_HEAD_V4_ALG } from "../convex/aukoraSignedHead";
import { rotationHead, rootKeyFingerprint } from "../convex/aumlokRootRegistry";
import { verifyReceiptChainCore, writeReceiptRow, appendIdentityLifecycleReceipt } from "../convex/aukoraReceipts";

const modules = import.meta.glob("../convex/**/*.*s");
const OPERATOR_SEED = "ab".repeat(32);  // operator key (PoP gate) — pinned as a founder key in setup
const ATTACKER_SEED = "ee".repeat(32);
const ROOT1 = "11".repeat(32), ROOT2 = "22".repeat(32), ROOT3 = "33".repeat(32);
const NODE = "aukora-node-a-demo";       // matches AUMA_NODE_ID (vitest.config) so the PoP node-binding holds

async function setup(run: string) {
  const t = convexTest(schema, modules);
  const opPub = await mlDsa65PublicKeyFromSeed(OPERATOR_SEED);
  const founderUserId = `demo.operator:${run}`, opKeyId = "op-1", now = Date.now();
  await t.mutation(internal.popResolver.seedFounderKey, { founderUserId, keyId: opKeyId, publicKey: opPub });
  const cav = (capId: string, methods: string[], over: any = {}) => ({
    v: 1, capId, founderUserId, founderKeyId: opKeyId, nodeId: NODE, methods, ring: "local-write", action: "aumlok",
    resource: "aumlok:root", principalId: founderUserId, roles: ["operator"], notBefore: now - 1000, expiresAt: now + POP_FRESHNESS_MS, maxUses: 1, ...over,
  });
  return { t, cav };
}

// Operator-PoP-gated mutation drivers. `signSeed` defaults to the real operator seed; pass an attacker seed to forge.
async function genesis(t: any, cav: any, rootId: string, keyId: string, publicKey: string, nonce: string, signSeed = OPERATOR_SEED) {
  const actualArgs = { rootId, keyId, publicKey };
  const env = await buildPoPEnvelope(signSeed, cav(`cap-${nonce}`, ["aumlokGenesisMint"]), { methodId: "aumlokGenesisMint", actualArgs, timestamp: Date.now(), nonce });
  return t.mutation(api.aumlokRootRegistry.aumlokGenesisMint, { env, actualArgs, nodeId: NODE });
}
function mkStatement(rootId: string, oldKeyId: string, newKeyId: string, newPublicKey: string, over: any = {}) {
  return { v: 1, rootId, oldKeyId, newKeyId, newPublicKey, newFingerprint: rootKeyFingerprint(newPublicKey), reason: "scheduled", timestamp: Date.now(), ...over };
}
// Sign `statement` with the old root seed under `sigDomain`, then SEND `sendStatement ?? statement` (so a tampered
// send-vs-signed pair, a wrong signer, or a wrong domain can each be exercised against the real verifier).
async function rotate(t: any, cav: any, oldRootSeed: string, statement: any, nonce: string, opts: { sigDomain?: any; sendStatement?: any; rotationSig?: string } = {}) {
  const rotationSig = opts.rotationSig ?? (await signChainHeadV3(oldRootSeed, await rotationHead(statement), opts.sigDomain ?? "aumlokRotation"));
  const actualArgs = { statement: opts.sendStatement ?? statement, rotationSig };
  const env = await buildPoPEnvelope(OPERATOR_SEED, cav(`cap-${nonce}`, ["aumlokRotateRoot"]), { methodId: "aumlokRotateRoot", actualArgs, timestamp: Date.now(), nonce });
  return t.mutation(api.aumlokRootRegistry.aumlokRotateRoot, { env, actualArgs, nodeId: NODE });
}
async function revoke(t: any, cav: any, rootId: string, keyId: string, nonce: string) {
  const actualArgs = { rootId, keyId, reason: "compromise" };
  const env = await buildPoPEnvelope(OPERATOR_SEED, cav(`cap-${nonce}`, ["aumlokRevokeRoot"]), { methodId: "aumlokRevokeRoot", actualArgs, timestamp: Date.now(), nonce });
  return t.mutation(api.aumlokRootRegistry.aumlokRevokeRoot, { env, actualArgs, nodeId: NODE });
}
const rows = (t: any, rootId: string) => t.run(async (ctx: any) => ctx.db.query("aumlok_root_keys").withIndex("by_root", (q: any) => q.eq("rootId", rootId)).collect());
const statusOf = async (t: any, rootId: string, keyId: string) => (await rows(t, rootId)).find((r: any) => r.keyId === keyId)?.status;
const verifyId = (t: any, rootId: string) => t.run(async (ctx: any) => verifyReceiptChainCore(ctx, `id:${rootId}`, 1000));

describe("B2.1 — AUMLOK root registry: genesis (operator-PoP-gated, operator-born)", () => {
  it("mints an active root key + a V4 id: lifecycle receipt", async () => {
    const { t, cav } = await setup("g1");
    const pub = await mlDsa65PublicKeyFromSeed(ROOT1);
    const r: any = await genesis(t, cav, "root-a", "rk-1", pub, "g1");
    expect(r.ok).toBe(true);
    expect(r.fingerprint).toBe(rootKeyFingerprint(pub));
    expect(await statusOf(t, "root-a", "rk-1")).toBe("active");
    // the lifecycle event is receipted on the reserved id: chain, V4-signed and fully verifiable
    const v: any = await verifyId(t, "root-a");
    expect([v.ok, v.status, v.headCount]).toEqual([true, "verified", 1]);
    const head = await t.run(async (ctx: any) => ctx.db.query("auma_receipt_chain_head").withIndex("by_key", (q: any) => q.eq("key", "id:root-a")).first());
    expect(head.headSigAlg).toBe(SIGNED_HEAD_V4_ALG);
    expect(typeof head.receiptLogRoot).toBe("string");
  });
  it("is operator-PoP-gated: a forged operator signature refuses (no registry write)", async () => {
    const { t, cav } = await setup("g2");
    const pub = await mlDsa65PublicKeyFromSeed(ROOT1);
    await expect(genesis(t, cav, "root-a", "rk-1", pub, "g2", ATTACKER_SEED)).rejects.toThrow("pop_cap_sig_invalid");
    expect(await rows(t, "root-a")).toHaveLength(0);
  });
  it("is once-per-root: a second genesis refuses", async () => {
    const { t, cav } = await setup("g3");
    const pub = await mlDsa65PublicKeyFromSeed(ROOT1);
    expect((await genesis(t, cav, "root-a", "rk-1", pub, "g3a")).ok).toBe(true);
    await expect(genesis(t, cav, "root-a", "rk-2", await mlDsa65PublicKeyFromSeed(ROOT2), "g3b")).rejects.toThrow("aumlok_root_already_exists");
  });
  it("a 64-hex seed cannot masquerade as a public key (shape gate)", async () => {
    const { t, cav } = await setup("g4");
    await expect(genesis(t, cav, "root-a", "rk-1", ROOT1 /* 64-hex seed, not a 3904-hex pubkey */, "g4")).rejects.toThrow("aumlok_root_pubkey_invalid");
  });
  it("the operator authorizes the SPECIFIC mint: swapping the public key after signing refuses (PoP binds actualArgs)", async () => {
    const { t, cav } = await setup("g5");
    const pub = await mlDsa65PublicKeyFromSeed(ROOT1), otherPub = await mlDsa65PublicKeyFromSeed(ROOT2);
    const signed = { rootId: "root-a", keyId: "rk-1", publicKey: pub };
    const env = await buildPoPEnvelope(OPERATOR_SEED, cav("cap-g5", ["aumlokGenesisMint"]), { methodId: "aumlokGenesisMint", actualArgs: signed, timestamp: Date.now(), nonce: "g5" });
    // the operator signed for `pub`; calling with a DIFFERENT publicKey breaks the reqSig argsHash binding → refuse
    await expect(t.mutation(api.aumlokRootRegistry.aumlokGenesisMint, { env, actualArgs: { ...signed, publicKey: otherPub }, nodeId: NODE })).rejects.toThrow("pop_req_sig_invalid");
    expect(await rows(t, "root-a")).toHaveLength(0);
  });
  it("confused-deputy refused: an operator envelope signed for a DIFFERENT method can't drive genesis", async () => {
    const { t, cav } = await setup("g6");
    const pub = await mlDsa65PublicKeyFromSeed(ROOT1);
    const actualArgs = { rootId: "root-a", keyId: "rk-1", publicKey: pub };
    // operator signs an envelope for the REVOKE method, then we redirect it to genesisMint. genesisMint passes its
    // OWN hard-coded method to the PoP gate, so the operator's revoke-scoped caveat does not authorize it.
    const env = await buildPoPEnvelope(OPERATOR_SEED, cav("cap-g6", ["aumlokRevokeRoot"]), { methodId: "aumlokRevokeRoot", actualArgs, timestamp: Date.now(), nonce: "g6" });
    await expect(t.mutation(api.aumlokRootRegistry.aumlokGenesisMint, { env, actualArgs, nodeId: NODE })).rejects.toThrow("pop_method_not_allowed");
    expect(await rows(t, "root-a")).toHaveLength(0);
  });
});

describe("B2.1 — rotation (old-root-signed, atomic flip)", () => {
  async function born(run: string) {
    const s = await setup(run);
    const pub1 = await mlDsa65PublicKeyFromSeed(ROOT1);
    await genesis(s.t, s.cav, "root-a", "rk-1", pub1, `${run}-born`);
    return { ...s, pub1 };
  }
  it("active key authors a rotation; new key active, old key retired; lifecycle receipt appended", async () => {
    const { t, cav } = await born("r1");
    const pub2 = await mlDsa65PublicKeyFromSeed(ROOT2);
    const r: any = await rotate(t, cav, ROOT1, mkStatement("root-a", "rk-1", "rk-2", pub2), "r1-rot");
    expect(r.ok).toBe(true);
    expect(await statusOf(t, "root-a", "rk-1")).toBe("retired");
    expect(await statusOf(t, "root-a", "rk-2")).toBe("active");
    const v: any = await verifyId(t, "root-a");
    expect([v.ok, v.status, v.headCount]).toEqual([true, "verified", 2]); // genesis + rotate
  });
  it("REFUSES unless the old root key signed the statement: wrong key, wrong domain, tampered field, garbage sig", async () => {
    const { t, cav } = await born("r2");
    const pub2 = await mlDsa65PublicKeyFromSeed(ROOT2);
    const stmt = mkStatement("root-a", "rk-1", "rk-2", pub2);
    // wrong signer (attacker seed, not the old root)
    await expect(rotate(t, cav, ATTACKER_SEED, stmt, "r2-wrongkey")).rejects.toThrow("aumlok_rotation_sig_invalid");
    // wrong FIPS 204 domain (signed under "cap", verified under "aumlokRotation")
    await expect(rotate(t, cav, ROOT1, stmt, "r2-wrongdom", { sigDomain: "cap" })).rejects.toThrow("aumlok_rotation_sig_invalid");
    // tampered AFTER signing (reason changed; the signed digest no longer matches)
    await expect(rotate(t, cav, ROOT1, stmt, "r2-tamper", { sendStatement: { ...stmt, reason: "evil" } })).rejects.toThrow("aumlok_rotation_sig_invalid");
    // garbage signature (correct length, not a real signature) → fail-closed verify → refuse
    await expect(rotate(t, cav, ROOT1, stmt, "r2-garbage", { rotationSig: "00".repeat(3309) })).rejects.toThrow("aumlok_rotation_sig_invalid");
    // and none of those mutated the registry
    expect(await statusOf(t, "root-a", "rk-1")).toBe("active");
    expect(await rows(t, "root-a")).toHaveLength(1);
  });
  it("retired key cannot author a NEW rotation, but its historical statement still verifies (grandfathering)", async () => {
    const { t, cav } = await born("r3");
    const pub2 = await mlDsa65PublicKeyFromSeed(ROOT2);
    const stmt1 = mkStatement("root-a", "rk-1", "rk-2", pub2);
    expect((await rotate(t, cav, ROOT1, stmt1, "r3-a")).ok).toBe(true); // rk-1 → retired
    // rk-1 (now retired) cannot author another rotation
    const stmt2 = mkStatement("root-a", "rk-1", "rk-9", await mlDsa65PublicKeyFromSeed(ROOT3));
    await expect(rotate(t, cav, ROOT1, stmt2, "r3-b")).rejects.toThrow("aumlok_root_key_retired");
    // but the statement rk-1 ALREADY signed still verifies cryptographically (historical authority preserved)
    const pub1 = await mlDsa65PublicKeyFromSeed(ROOT1);
    const sig1 = await signChainHeadV3(ROOT1, await rotationHead(stmt1), "aumlokRotation");
    expect(await verifyChainHeadV3(pub1, await rotationHead(stmt1), sig1, "aumlokRotation")).toBe(true);
  });
  it("revoked key fails live use (cannot author a rotation)", async () => {
    const { t, cav } = await born("r4");
    expect((await revoke(t, cav, "root-a", "rk-1", "r4-rev")).ok).toBe(true);
    expect(await statusOf(t, "root-a", "rk-1")).toBe("revoked");
    const stmt = mkStatement("root-a", "rk-1", "rk-2", await mlDsa65PublicKeyFromSeed(ROOT2));
    await expect(rotate(t, cav, ROOT1, stmt, "r4-rot")).rejects.toThrow("aumlok_root_key_revoked");
  });
  it("a RETIRED key can be revoked (intended lifecycle: active OR retired → revoked); a revoked key refuses re-revoke", async () => {
    const { t, cav } = await born("r4b");
    expect((await rotate(t, cav, ROOT1, mkStatement("root-a", "rk-1", "rk-2", await mlDsa65PublicKeyFromSeed(ROOT2)), "r4b-rot")).ok).toBe(true);
    expect(await statusOf(t, "root-a", "rk-1")).toBe("retired");
    expect((await revoke(t, cav, "root-a", "rk-1", "r4b-rev")).ok).toBe(true); // retired → revoked allowed
    expect(await statusOf(t, "root-a", "rk-1")).toBe("revoked");
    await expect(revoke(t, cav, "root-a", "rk-1", "r4b-re")).rejects.toThrow("aumlok_root_key_revoked"); // terminal: idempotent-refuse
  });
  it("cross-rotation lineage rk-1→rk-2→rk-3: each statement verifies under its signer; id: chain verifies V4", async () => {
    const { t, cav } = await born("r5");
    const pub2 = await mlDsa65PublicKeyFromSeed(ROOT2), pub3 = await mlDsa65PublicKeyFromSeed(ROOT3);
    const s12 = mkStatement("root-a", "rk-1", "rk-2", pub2);
    const s23 = mkStatement("root-a", "rk-2", "rk-3", pub3);
    expect((await rotate(t, cav, ROOT1, s12, "r5-12")).ok).toBe(true);
    expect((await rotate(t, cav, ROOT2, s23, "r5-23")).ok).toBe(true);
    expect(await statusOf(t, "root-a", "rk-1")).toBe("retired");
    expect(await statusOf(t, "root-a", "rk-2")).toBe("retired");
    expect(await statusOf(t, "root-a", "rk-3")).toBe("active");
    // historical lineage: each rotation statement verifies under the (now-retired) key that signed it
    const pub1 = await mlDsa65PublicKeyFromSeed(ROOT1);
    expect(await verifyChainHeadV3(pub1, await rotationHead(s12), await signChainHeadV3(ROOT1, await rotationHead(s12), "aumlokRotation"), "aumlokRotation")).toBe(true);
    expect(await verifyChainHeadV3(pub2, await rotationHead(s23), await signChainHeadV3(ROOT2, await rotationHead(s23), "aumlokRotation"), "aumlokRotation")).toBe(true);
    const v: any = await verifyId(t, "root-a");
    expect([v.ok, v.status, v.headCount]).toEqual([true, "verified", 3]); // genesis + 2 rotations
  });
  it("refuses replay, duplicate keyId, reused pubkey, fingerprint mismatch, and malformed new key", async () => {
    const { t, cav } = await born("r6");
    const pub1 = await mlDsa65PublicKeyFromSeed(ROOT1), pub2 = await mlDsa65PublicKeyFromSeed(ROOT2);
    // reused pubkey: rotate rk-1 → a key whose pubkey equals the already-pinned rk-1 key
    await expect(rotate(t, cav, ROOT1, mkStatement("root-a", "rk-1", "rk-2", pub1), "r6-reuse")).rejects.toThrow("aumlok_root_pubkey_reused");
    // fingerprint mismatch (statement claims a fingerprint that isn't sha256(newPublicKey))
    await expect(rotate(t, cav, ROOT1, mkStatement("root-a", "rk-1", "rk-2", pub2, { newFingerprint: "00".repeat(32) }), "r6-fp")).rejects.toThrow("aumlok_rotation_fingerprint_mismatch");
    // malformed new public key (a 64-hex seed, not a 3904-hex key)
    await expect(rotate(t, cav, ROOT1, mkStatement("root-a", "rk-1", "rk-2", ROOT2), "r6-bad")).rejects.toThrow("aumlok_root_pubkey_invalid");
    // a real rotation succeeds...
    expect((await rotate(t, cav, ROOT1, mkStatement("root-a", "rk-1", "rk-2", pub2), "r6-ok")).ok).toBe(true);
    // ...then REPLAY the same (rk-1 → rk-2): rk-1 is retired now → refused
    await expect(rotate(t, cav, ROOT1, mkStatement("root-a", "rk-1", "rk-2", pub2), "r6-replay")).rejects.toThrow("aumlok_root_key_retired");
    // duplicate keyId: rotate rk-2 → an EXISTING keyId ("rk-1")
    await expect(rotate(t, cav, ROOT2, mkStatement("root-a", "rk-2", "rk-1", await mlDsa65PublicKeyFromSeed(ROOT3)), "r6-dupkid")).rejects.toThrow("aumlok_root_keyid_exists");
  });
});

describe("B2.1 — input hardening (identity-name grammar, statement version/timestamp, cross-root uniqueness)", () => {
  it("rootId/keyId grammar: colon (reserved-grammar collision), embedded colon, too-long, uppercase, and non-string refuse", async () => {
    const { t, cav } = await setup("n1");
    const pub = await mlDsa65PublicKeyFromSeed(ROOT1);
    await expect(genesis(t, cav, "foo:rev", "rk-1", pub, "n1a")).rejects.toThrow("aumlok_name_invalid:rootId"); // would mint id:foo:rev
    await expect(genesis(t, cav, "foo:bar", "rk-1", pub, "n1b")).rejects.toThrow("aumlok_name_invalid:rootId");
    await expect(genesis(t, cav, "a".repeat(65), "rk-1", pub, "n1c")).rejects.toThrow("aumlok_name_invalid:rootId"); // >64
    await expect(genesis(t, cav, "Root-A", "rk-1", pub, "n1d")).rejects.toThrow("aumlok_name_invalid:rootId");      // uppercase
    await expect(genesis(t, cav, "", "rk-1", pub, "n1e")).rejects.toThrow("aumlok_name_invalid:rootId");            // empty
    await expect(genesis(t, cav, "root-a", "key:1", pub, "n1f")).rejects.toThrow("aumlok_name_invalid:keyId");      // keyId colon
    expect(await rows(t, "root-a")).toHaveLength(0);
  });
  it("defense-in-depth: appendIdentityLifecycleReceipt itself refuses an ambiguous rootId (independent of the registry)", async () => {
    const { t } = await setup("n2");
    await expect(t.run(async (ctx: any) => appendIdentityLifecycleReceipt(ctx, "foo:rev", "aumlok.genesis", {}))).rejects.toThrow("aukora_identity_rootid_invalid");
    await expect(t.run(async (ctx: any) => appendIdentityLifecycleReceipt(ctx, "bad space", "aumlok.genesis", {}))).rejects.toThrow("aukora_identity_rootid_invalid");
  });
  it("rotation statement version is enforced: v !== 1 refuses (unknown versions are not honored)", async () => {
    const { t, cav } = await setup("n3");
    await genesis(t, cav, "root-a", "rk-1", await mlDsa65PublicKeyFromSeed(ROOT1), "n3-born");
    const stmtV2 = mkStatement("root-a", "rk-1", "rk-2", await mlDsa65PublicKeyFromSeed(ROOT2), { v: 2 });
    await expect(rotate(t, cav, ROOT1, stmtV2, "n3-rot")).rejects.toThrow("aumlok_rotation_version_unsupported");
  });
  it("rotation timestamp hygiene: NaN / Infinity / negative / non-integer refuse with a clear error (not a sig error)", async () => {
    const { t, cav } = await setup("n4");
    await genesis(t, cav, "root-a", "rk-1", await mlDsa65PublicKeyFromSeed(ROOT1), "n4-born");
    const good = mkStatement("root-a", "rk-1", "rk-2", await mlDsa65PublicKeyFromSeed(ROOT2));
    // sign a valid statement, then SEND a corrupted-timestamp copy (the signer can't even serialize NaN, so this is
    // the realistic attack surface: a malformed timestamp arriving with some signature)
    for (const [tag, bad] of [["nan", NaN], ["inf", Infinity], ["neg", -1], ["frac", 1.5], ["zero", 0]] as const) {
      await expect(rotate(t, cav, ROOT1, good, `n4-${tag}`, { sendStatement: { ...good, timestamp: bad } })).rejects.toThrow("aumlok_rotation_timestamp_invalid");
    }
  });
  it("cross-root uniqueness: the SAME public key cannot be pinned to two different roots (one key = one identity)", async () => {
    const { t, cav } = await setup("n5");
    const pub = await mlDsa65PublicKeyFromSeed(ROOT1);
    expect((await genesis(t, cav, "root-a", "rk-1", pub, "n5-a")).ok).toBe(true);
    await expect(genesis(t, cav, "root-b", "rk-1", pub, "n5-b")).rejects.toThrow("aumlok_root_pubkey_reused"); // same key, different root
    // and a rotation cannot adopt a key already pinned to ANOTHER root
    const pub2 = await mlDsa65PublicKeyFromSeed(ROOT2);
    await genesis(t, cav, "root-c", "rk-1", pub2, "n5-c");
    await expect(rotate(t, cav, ROOT1, mkStatement("root-a", "rk-1", "rk-2", pub2), "n5-rot")).rejects.toThrow("aumlok_root_pubkey_reused");
    // REVOKED keys keep their rows → a compromised key can never be re-pinned ANYWHERE, ever (revoke patches, never deletes)
    expect((await revoke(t, cav, "root-a", "rk-1", "n5-rev")).ok).toBe(true);
    await expect(genesis(t, cav, "root-d", "rk-1", pub, "n5-d")).rejects.toThrow("aumlok_root_pubkey_reused");
  });
});

describe("B2.1 — id: chainKey reservation + structural absence of phrase/seed", () => {
  it("general receipt writers cannot write id:* (writeReceiptRow refuses the reserved prefix)", async () => {
    const { t } = await setup("res");
    const base = { goal: "g", actorModel: "m", lane: "local" as const, risk: "low" as const, grade: "A" as const, verdict: "kept" as const, actionsJson: "{}", proofJson: "{}", decisionLogId: "x" };
    await expect(t.run(async (ctx: any) => writeReceiptRow(ctx, { chainKey: "id:root-a", ...base }))).rejects.toThrow("aukora_receipt_chainkey_reserved_prefix_id");
    await expect(t.run(async (ctx: any) => writeReceiptRow(ctx, { chainKey: "id:anything:else", ...base }))).rejects.toThrow("aukora_receipt_chainkey_reserved_prefix_id");
    // the pre-existing :rev suffix reservation still holds (no regression from the refactor)
    await expect(t.run(async (ctx: any) => writeReceiptRow(ctx, { chainKey: "grid:run:rev", ...base }))).rejects.toThrow("aukora_receipt_chainkey_reserved_suffix");
  });
  it("the identity registry handles ONLY public keys: no derive module, no Argon2id, no server-side seed derivation", () => {
    const src = import.meta.glob("../convex/aumlokRootRegistry.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const code = Object.values(src)[0];
    expect(code).toBeTruthy();
    expect(code.includes("aukoraAumlokDerive")).toBe(false);        // never imports the phrase-derivation module
    expect(code.includes("@noble/hashes/argon2")).toBe(false);      // the memory-hard KDF never runs server-side
    expect(code.includes("mlDsa65PublicKeyFromSeed")).toBe(false);  // never derives a key from a seed in a mutation
    expect(code.includes("isPqcPublicKeyHex")).toBe(true);          // it ONLY shape-gates public keys...
    expect(code.includes("verifyChainHeadV3")).toBe(true);          // ...and VERIFIES signatures (never signs/derives)
  });
  it("import guard: ONLY the authorized identity modules reference appendIdentityLifecycleReceipt", () => {
    // closes the fake-lifecycle-receipt seam: no UNauthorized module can append plausible id: events without a
    // registry state change. aukoraReceipts.ts defines+exports it; the authorized writers are the root registry
    // (genesis/rotate/revoke) and the B2.3 ceremony (birth receipt). Any new name here is a deliberate addition.
    const all = import.meta.glob("../convex/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const refs = Object.entries(all).filter(([, c]) => c.includes("appendIdentityLifecycleReceipt")).map(([p]) => p.split("/").pop()!).sort();
    expect(Object.keys(all).length).toBeGreaterThan(5); // sanity: the glob loaded the convex modules
    expect(refs).toEqual(["aukoraReceipts.ts", "aumlokCeremony.ts", "aumlokRootRegistry.ts"]);
  });
});
