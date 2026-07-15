// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
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
import schema from "../schema";
import { internal } from "../_generated/api"; // S1a: every vendored registration is internal-only (B1)
import { mlDsa65PublicKeyFromSeed } from "../aukoraPqcSigner";
import { buildPoPEnvelope, POP_FRESHNESS_MS } from "../popResolver";
import { signChainHeadV3 } from "../aukoraSignedHead";
import { manifestRootHead, manifestPopHead, consumeHead, rootRevokeHead } from "../aumlokManifests";
import { recallHead, eraseHead } from "../aumlokMemory";
import { verifyReceiptChainCore } from "../aukoraReceipts";
import { sha256Hex } from "../aukoraCore"; // M2: the consistent-forgery probe recomputes the binding


const modules = import.meta.glob(["../*.ts", "../_generated/*.js", "!../vitest.config.ts"]); // S1a: pinned glob (tests live inside convex/)
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
  await t.mutation(internal.aumlokRootRegistry.aumlokGenesisMint, { env: gEnv, actualArgs: gArgs, nodeId: NODE });
  const subjectPub = await mlDsa65PublicKeyFromSeed(SUBJECT_SEED);
  const m = { v: 1, manifestId: MFT, rootId: OWNER, rootKeyId: "rk-1", nodeId: NODE, subjectId: SUBJECT, subjectKind: "agent", subjectPubKey: subjectPub, permissions: perms ?? [{ ring: "local-write", action: "memory.write", resource: `mem:${OWNER}` }], allowedIntentCodecs: ["json_action_v1"], notBefore: now - 1000, expiresAt: now + 3_600_000, maxUses: null, maxPerWindow: null, createdAt: now, ...mOver };
  const rootSig = await signChainHeadV3(ROOT_SEED, await manifestRootHead(m), "aumlokManifest");
  const subjectPopSig = await signChainHeadV3(SUBJECT_SEED, await manifestPopHead(m), "aumlokSubjectPop");
  await t.mutation(internal.aumlokManifests.aumlokMintManifest, { manifest: m, rootSig, subjectPopSig });
  return { t, cav };
}
async function memReq(rOver: any = {}, sign: { seed?: string; domain?: any } = {}) {
  const r = { v: 1, manifestId: MFT, subjectId: SUBJECT, ring: "local-write", action: "memory.write", resource: `mem:${OWNER}`, intentCodec: "json_action_v1", useSeq: 0, timestamp: Date.now(), key: "diary", ...rOver };
  const subjectSig = await signChainHeadV3(sign.seed ?? SUBJECT_SEED, await consumeHead(r), sign.domain ?? "aumlokSubjectPop");
  return { r, subjectSig };
}
const write = async (t: any, rOver: any = {}, value = "alice private note", sign: any = {}) => { const { r, subjectSig } = await memReq(rOver, sign); return t.mutation(internal.aumlokMemory.aumlokMemoryWrite, { req: r, subjectSig, value }); };
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
    await t.mutation(internal.aumlokRootRegistry.aumlokRevokeRoot, { env, actualArgs: args, nodeId: NODE });
    await expect(write(t, { useSeq: 0 })).rejects.toThrow("aumlok_mft_root_revoked");
    expect(await memRow(t)).toBeNull();
  });

  it("revoked / paused / expired manifest → memory write refused", async () => {
    const { t } = await setup("rp");
    // root-revoke the manifest (current active key) — superior revocation
    const stmt = { v: 1, manifestId: MFT, action: "revoke", reason: "compromise", timestamp: Date.now() };
    const rootSig = await signChainHeadV3(ROOT_SEED, await rootRevokeHead(stmt), "aumlokManifest");
    await t.mutation(internal.aumlokManifests.aumlokRevokeManifest, { statement: stmt, rootSig });
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
    return t.query(internal.aumlokMemory.aumlokMemoryRecall, { req: r, readerSig });
  };
  it("owner (root-key PoP) reads; subject (subject-key PoP) reads while valid; revocation severs the subject; owner unaffected", async () => {
    const { t } = await setup("recall");
    await write(t, { useSeq: 0 }, "the secret");
    expect((await recall(t, OWNER, { seed: ROOT_SEED, domain: "aumlokMemRecall" })).value).toBe("the secret");      // owner root, proven
    expect((await recall(t, SUBJECT, { seed: SUBJECT_SEED, domain: "aumlokMemRecall" })).value).toBe("the secret"); // delegated subject, proven + manifest live
    expect((await recall(t, "demo.eve", { seed: ATTACKER_SEED, domain: "aumlokMemRecall" })).ok).toBe(false);     // unrelated principal
    const stmt = { v: 1, manifestId: MFT, action: "revoke", reason: "x", timestamp: Date.now() };
    await t.mutation(internal.aumlokManifests.aumlokRevokeManifest, { statement: stmt, rootSig: await signChainHeadV3(ROOT_SEED, await rootRevokeHead(stmt), "aumlokManifest") });
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
    const src = import.meta.glob("../aumlokMemory.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    expect(/\.(query|insert|patch)\(\s*"aukora_delegations"/.test(Object.values(src)[0])).toBe(false); // the live boundary never ACCESSES the B0 lane (the docstring may name it)
  });
  it("the live module writes aukora_memory ONLY through the manifest consume chokepoint", () => {
    const src = import.meta.glob("../aumlokMemory.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const code = Object.values(src)[0];
    expect(code.includes("consumeManifestUseCore")).toBe(true);                 // authority chokepoint present
    expect((code.match(/ctx\.db\.insert\("aukora_memory"/g) ?? []).length).toBe(1); // exactly one memory-write site
  });
});

// ── M2 — content binding: the store cannot silently lie (ONE_BRAIN Brick 0b/0d ported) ──────────────
// The plan of record's MANDATORY acceptance test lives here: the silent-edit probe that passes green
// against brain.json today MUST FAIL against this store, or M2 does not ship.
describe("M2 — content binding + quarantine on the governed memory store", () => {
  const ownerRecall = async (t: any, key = "diary") => {
    const r = { v: 1, ownerRootId: OWNER, key, readerPrincipalId: OWNER, timestamp: Date.now() };
    const readerSig = await signChainHeadV3(ROOT_SEED, await recallHead(r), "aumlokMemRecall");
    return t.query(internal.aumlokMemory.aumlokMemoryRecall, { req: r, readerSig });
  };
  const verify = (t: any) => t.query(internal.aumlokMemory.aumlokMemoryVerify, {});
  const quarantine = (t: any, key = "diary") => t.mutation(internal.aumlokMemory.aumlokMemoryQuarantine, { ownerRootId: OWNER, key });
  const patchRow = async (t: any, key: string, patch: any) => t.run(async (ctx: any) => {
    const row = await ctx.db.query("aukora_memory").withIndex("by_owner_key", (q: any) => q.eq("ownerRootId", OWNER).eq("key", key)).first();
    await ctx.db.patch(row._id, patch);
  });

  it("MANDATORY silent-edit probe: a direct DB edit of a stored value is CAUGHT by verify and never served by recall", async () => {
    const { t } = await setup("m2-probe");
    await write(t, { useSeq: 0 }, "the true memory");
    expect(await verify(t)).toMatchObject({ ok: true, checked: 1, flagged: [], quarantinedCount: 0 });
    expect((await ownerRecall(t)).value).toBe("the true memory"); // healthy row serves normally

    await patchRow(t, "diary", { value: "the silently edited lie" }); // the probe: sqlite-in-hand edit
    const v: any = await verify(t);
    expect(v.ok).toBe(false); // green-on-silent-edit is the failure mode M2 exists to kill
    expect(v.flagged).toEqual([{ ownerRootId: OWNER, key: "diary", reason: "content_hash_mismatch" }]);
    const rec: any = await ownerRecall(t); // VALID owner PoP — authentication is not the question, integrity is
    expect([rec.ok, rec.reason, rec.detail]).toEqual([false, "integrity_failed", "content_hash_mismatch"]);
    expect(rec.value).toBeUndefined(); // tampered bytes are never served, marked or otherwise
  });

  it("a CONSISTENT forgery (value + recomputed row.memoryHash) is still caught — the receipt chain binds the original content", async () => {
    const { t } = await setup("m2-forge");
    await write(t, { useSeq: 0 }, "original");
    const forged = "forged but self-consistent";
    await patchRow(t, "diary", { value: forged, memoryHash: await sha256Hex(`${OWNER}:diary:${forged}`) });
    const v: any = await verify(t);
    expect(v.flagged).toEqual([{ ownerRootId: OWNER, key: "diary", reason: "receipt_binds_different_content" }]);
    expect((await ownerRecall(t)).reason).toBe("integrity_failed");
  });

  it("a swapped/unknown receiptHash is caught (the row must point at a real receipt on its OWN chain)", async () => {
    const { t } = await setup("m2-rcpt");
    await write(t, { useSeq: 0 }, "original");
    await patchRow(t, "diary", { receiptHash: "f".repeat(64) });
    const v: any = await verify(t);
    expect(v.flagged).toEqual([{ ownerRootId: OWNER, key: "diary", reason: "receipt_not_on_chain" }]);
  });

  it("quarantine is EVIDENCE-GATED: refuses a healthy row, jails a tampered one, recall says so, verify counts it visibly", async () => {
    const { t } = await setup("m2-jail");
    await write(t, { useSeq: 0 }, "healthy");
    await expect(quarantine(t)).rejects.toThrow("aumlok_mem_quarantine_refused_healthy"); // cannot silence a good memory

    await patchRow(t, "diary", { value: "tampered" });
    expect((await quarantine(t)).ok).toBe(true);                        // evidence present → contained
    expect((await quarantine(t)).alreadyQuarantined).toBe(true);        // idempotent
    expect((await ownerRecall(t)).reason).toBe("quarantined");          // refused, not thrown — the store stays online
    const v: any = await verify(t);
    // contained ≠ hidden: verify is green (no UN-jailed corruption) but the jail count is on the report
    expect(v).toMatchObject({ ok: true, checked: 0, flagged: [], quarantinedCount: 1 });

    await write(t, { useSeq: 1, key: "second" }, "later, unrelated memory"); // one jailed row never bricks the organ
    expect((await ownerRecall(t, "second")).value).toBe("later, unrelated memory");
    expect(await verify(t)).toMatchObject({ ok: true, checked: 1, quarantinedCount: 1 });
  });

  // M4 prep (Codex ask): duplicate-key / long-history semantics PINNED as they ARE today, so the
  // migration design reasons from fact, not assumption. This is documentation-by-test, not an
  // endorsement — changing the semantic (e.g. newest-wins recall) would be its own reviewed brick.
  it("M4-prep PIN: a second write to the SAME key inserts a SECOND row; recall serves the FIRST-written; verify checks both", async () => {
    const { t } = await setup("m4-dup");
    await write(t, { useSeq: 0 }, "first value");
    await write(t, { useSeq: 1 }, "second value"); // same key "diary", both writes fully receipted
    const rows = await t.run(async (ctx: any) =>
      ctx.db.query("aukora_memory").withIndex("by_owner_key", (q: any) => q.eq("ownerRootId", OWNER).eq("key", "diary")).collect());
    expect(rows.length).toBe(2); // history accumulates as rows — nothing is overwritten in place
    expect((await ownerRecall(t)).value).toBe("first value"); // .first() on the index = OLDEST row wins today
    // every history row carries its own binding and its own receipt — long history never rots verify
    expect(await verify(t)).toMatchObject({ ok: true, checked: 2, flagged: [] });
    // consequence pinned for M4: the migration MUST use unique keys (atom ids) and refuse duplicates,
    // because a duplicate key would make the newer memory unreachable through recall.
  });
});

// ── M2b — owner-only erasure (owner-ratified via GH #103, chat approval 2026-07-05) ─────────────────
// The contract: ONLY the owner's active root key, signing under the DEDICATED aumlokMemErase domain,
// can make the store forget. The erased row remains a COUNTABLE STUB (Auma: never an invisible hole),
// the erasure is receipted on the same mem: chain, and a stub that grows content back is tampering.
describe("M2b — owner-only erasure: the store can forget, but only for the owner's pen, and never invisibly", () => {
  const ownerRecall = async (t: any, key = "diary") => {
    const r = { v: 1, ownerRootId: OWNER, key, readerPrincipalId: OWNER, timestamp: Date.now() };
    const readerSig = await signChainHeadV3(ROOT_SEED, await recallHead(r), "aumlokMemRecall");
    return t.query(internal.aumlokMemory.aumlokMemoryRecall, { req: r, readerSig });
  };
  const verify = (t: any) => t.query(internal.aumlokMemory.aumlokMemoryVerify, {});
  const memRowOf = (t: any, key = "diary") => t.run(async (ctx: any) =>
    ctx.db.query("aukora_memory").withIndex("by_owner_key", (q: any) => q.eq("ownerRootId", OWNER).eq("key", key)).first());
  const erase = async (t: any, opts: { key?: string; reason?: string; signReason?: string; seed?: string; domain?: any; tsOffset?: number } = {}) => {
    const reason = opts.reason ?? "owner chose to forget this";
    const r = { v: 1, ownerRootId: OWNER, key: opts.key ?? "diary", eraseReason: reason, timestamp: Date.now() + (opts.tsOffset ?? 0) };
    // signReason lets a test sign one reason and SEND another (the substitution attack)
    const signed = opts.signReason === undefined ? r : { ...r, eraseReason: opts.signReason };
    const ownerSig = await signChainHeadV3(opts.seed ?? ROOT_SEED, await eraseHead(signed), opts.domain ?? "aumlokMemErase");
    return t.mutation(internal.aumlokMemory.aumlokMemoryErase, { req: r, ownerSig });
  };

  it("the owner erases: value scrubbed, stub REMAINS and is counted, erasure receipted on the chain, recall says 'erased'", async () => {
    const { t } = await setup("m2b-erase");
    await write(t, { useSeq: 0 }, "the content to be forgotten");
    const res: any = await erase(t, { reason: "peter said forget it" });
    expect(res.ok).toBe(true);
    const stub: any = await memRowOf(t);
    expect([stub.value, stub.erased, stub.eraseReason]).toEqual(["", true, "peter said forget it"]); // scrubbed, marked, owner's words
    expect(stub.memoryHash).toHaveLength(64); // the original binding stays (disclosed oracle limit — stated, not hidden)
    expect(stub.erasureReceiptHash).toBe(res.erasureReceiptHash);
    expect((await ownerRecall(t)).reason).toBe("erased"); // countable, boring — never not_found, never served
    expect(await verify(t)).toMatchObject({ ok: true, erasedCount: 1, flagged: [] }); // the stub is visible on every report
    // the erasure receipt is REAL on the same mem: chain and binds key + owner's reason + original content hash
    const v: any = await t.run(async (ctx: any) => verifyReceiptChainCore(ctx, `mem:${OWNER}:diary`, 1000));
    expect([v.ok, v.status]).toEqual([true, "verified"]);
    const newest = await t.run(async (ctx: any) => ctx.db.query("auma_receipts").withIndex("by_chainKey_ts", (q: any) => q.eq("chainKey", `mem:${OWNER}:diary`)).order("desc").first());
    const proof = JSON.parse(newest.proofJson);
    expect([proof.erasure, proof.erasedAtomKey, proof.eraseReason, proof.originalMemoryHash]).toEqual([true, "diary", "peter said forget it", stub.memoryHash]);
  });

  it("NO ONE but the owner: subject key, attacker key, and even the RIGHT key under the RECALL domain all refuse", async () => {
    const { t } = await setup("m2b-owner-only");
    await write(t, { useSeq: 0 }, "not yours to forget");
    await expect(erase(t, { seed: SUBJECT_SEED })).rejects.toThrow("aumlok_mem_erase_pop_invalid");   // delegated writer: NO erase path exists
    await expect(erase(t, { seed: ATTACKER_SEED })).rejects.toThrow("aumlok_mem_erase_pop_invalid");  // stranger
    await expect(erase(t, { domain: "aumlokMemRecall" })).rejects.toThrow("aumlok_mem_erase_pop_invalid"); // a captured recall PoP can NEVER erase — the domain separation working
    await expect(erase(t, { signReason: "innocent reason" })).rejects.toThrow("aumlok_mem_erase_pop_invalid"); // reason substitution: the reason is inside the signed preimage
    expect((await memRowOf(t)).value).toBe("not yours to forget"); // nothing was forgotten
  });

  it("typed refusals: stale timestamp, unknown key, double-erase, malformed reason", async () => {
    const { t } = await setup("m2b-refusals");
    await write(t, { useSeq: 0 }, "v");
    await expect(erase(t, { tsOffset: -120_000 })).rejects.toThrow("aumlok_mem_erase_stale");
    await expect(erase(t, { key: "ghost" })).rejects.toThrow("aumlok_mem_erase_not_found");
    await expect(erase(t, { reason: "x".repeat(201) })).rejects.toThrow("aumlok_mem_erase_reason_invalid");
    await expect(erase(t, { reason: "bad" + String.fromCharCode(0) + "reason" })).rejects.toThrow("aumlok_mem_erase_reason_invalid");
    expect((await erase(t)).ok).toBe(true);
    await expect(erase(t)).rejects.toThrow("aumlok_mem_erase_already_erased");
  });

  it("refuses to erase a row whose pre-erase content binding is already bad (no laundering a prior inconsistency)", async () => {
    const { t } = await setup("m2b-pre-tamper");
    await write(t, { useSeq: 0 }, "original");
    await t.run(async (ctx: any) => {
      const row = await ctx.db.query("aukora_memory").withIndex("by_owner_key", (q: any) => q.eq("ownerRootId", OWNER).eq("key", "diary")).first();
      await ctx.db.patch(row._id, { value: "tampered before erase" });
    });
    await expect(erase(t)).rejects.toThrow("aumlok_mem_erase_integrity_failed");
    expect((await ownerRecall(t)).reason).toBe("integrity_failed");
  });

  it("post-erase tamper: a stub that grows its content back is CAUGHT, never served, and jailable", async () => {
    const { t } = await setup("m2b-resurrect");
    await write(t, { useSeq: 0 }, "forget me");
    await erase(t);
    await t.run(async (ctx: any) => {
      const row = await ctx.db.query("aukora_memory").withIndex("by_owner_key", (q: any) => q.eq("ownerRootId", OWNER).eq("key", "diary")).first();
      await ctx.db.patch(row._id, { value: "resurrected content" }); // tampering wearing a tombstone
    });
    const v: any = await verify(t);
    expect(v.ok).toBe(false);
    expect(v.flagged).toEqual([{ ownerRootId: OWNER, key: "diary", reason: "erased_row_still_carries_content" }]);
    expect((await ownerRecall(t)).reason).toBe("erased"); // still refused — resurrected bytes are never served
    const jailed: any = await t.mutation(internal.aumlokMemory.aumlokMemoryQuarantine, { ownerRootId: OWNER, key: "diary" });
    expect(jailed.ok).toBe(true); // evidence-gated containment works on tampered stubs too
    expect((await ownerRecall(t)).reason).toBe("quarantined");
  });

  it("post-erase tamper: changing the visible stub metadata is caught against the erasure receipt", async () => {
    const { t } = await setup("m2b-stub-metadata");
    await write(t, { useSeq: 0 }, "forget me");
    await erase(t, { reason: "owner-signed reason" });
    await t.run(async (ctx: any) => {
      const row = await ctx.db.query("aukora_memory").withIndex("by_owner_key", (q: any) => q.eq("ownerRootId", OWNER).eq("key", "diary")).first();
      await ctx.db.patch(row._id, { eraseReason: "edited after signature" });
    });
    const v: any = await verify(t);
    expect(v.ok).toBe(false);
    expect(v.flagged).toEqual([{ ownerRootId: OWNER, key: "diary", reason: "erasure_receipt_binds_different_erasure" }]);
    expect((await ownerRecall(t)).reason).toBe("erased"); // still boring, still no content
  });
});
