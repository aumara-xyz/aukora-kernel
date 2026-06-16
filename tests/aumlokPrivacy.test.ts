// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/// <reference types="vite/client" />
/**
 * B2.3b — PRIVACY HALF-REQUALIFICATION. Proves the ONE thing provable now: the user's identity SECRET (phrase / root
 * seed / root private key) never crosses the server boundary — not in the ceremony args, not in any persisted row, not
 * in any receipt, and the identity modules cannot even derive a key from a seed (no derive-module / Argon2id import).
 *
 * EXPLICITLY NOT CLAIMED here (blocked on B2.3c): "the phrase cannot be GUESSED." And NOT claimed anywhere: full
 * privacy, production identity, or UNQUALIFIED self-sovereignty (lifecycle is operator-custodied — G3). This suite is
 * scoped to the USER identity secret; the node's own chain-signing seed (AUKORA_CHAIN_SIGNING_SEED) and the lab
 * operator demo seed are node infrastructure, and only their SIGNATURES (never the seeds) ever persist.
 *
 * Also pins the five ceremony-robustness tests parked from the B2.3 review.
 */
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { sha256Hex } from "../convex/aukoraCore";
import { mlDsa65PublicKeyFromSeed } from "../convex/aukoraPqcSigner";
import { signChainHeadV3 } from "../convex/aukoraSignedHead";
import { buildPoPEnvelope, POP_FRESHNESS_MS } from "../convex/popResolver";
import { rootKeyFingerprint } from "../convex/aumlokRootRegistry";
import { ceremonyHead, serializeSummaryV1 } from "../convex/aumlokCeremony";

const modules = import.meta.glob("../convex/**/*.*s");
const ROOT_SEED = "11".repeat(32);     // the USER's client-derived root seed — the secret that must NEVER cross the boundary
const OTHER_SEED = "22".repeat(32);
const OPERATOR_SEED = "ab".repeat(32);
const NODE = "aukora-node-a-demo";

async function buildCeremony(seed = ROOT_SEED, over: any = {}) {
  const pub = await mlDsa65PublicKeyFromSeed(seed);
  const fingerprint = rootKeyFingerprint(pub);
  const rootId = over.rootId ?? "echo.carbon", keyId = over.keyId ?? "rk-1", ceremonyId = over.ceremonyId ?? "cer-1", nodeId = over.nodeId ?? NODE;
  const summary = { v: 1, rootId, keyId, nodeId, fingerprint, noRecovery: true, phraseTransitsServer: false, statement: `Mint AUMLOK root ${rootId}.`, ...over.summary };
  const summaryHash = await sha256Hex(serializeSummaryV1(summary));
  const challenge = { v: 1, ceremonyId, rootId, keyId, nodeId, fingerprint, summaryHash, timestamp: Date.now(), ...over.challenge };
  const rootSig = await signChainHeadV3(seed, await ceremonyHead(challenge), "aumlokGenesis");
  return { pub, fingerprint, rootId, keyId, ceremonyId, summary, challenge, rootSig };
}
const mintCeremony = (t: any, c: any, over: any = {}) =>
  t.mutation(api.aumlokCeremony.aumlokCeremonyMint, { publicKey: c.pub, challenge: c.challenge, rootSig: c.rootSig, summary: c.summary, confirmedFingerprint: c.fingerprint, ...over });

// LAB/ADMIN operator-born genesis (B2.1) — used only to prove the cross-PATH duplicate invariant.
async function labGenesis(t: any, rootId: string, keyId: string, publicKey: string, run: string) {
  const opPub = await mlDsa65PublicKeyFromSeed(OPERATOR_SEED), founderUserId = `demo.operator:${run}`, now = Date.now();
  await t.mutation(internal.popResolver.seedFounderKey, { founderUserId, keyId: "op-1", publicKey: opPub });
  const cav = { v: 1, capId: `cap-${run}`, founderUserId, founderKeyId: "op-1", nodeId: NODE, methods: ["aumlokGenesisMint"], ring: "local-write", action: "aumlok", resource: "aumlok:root", principalId: founderUserId, roles: ["operator"], notBefore: now - 1000, expiresAt: now + POP_FRESHNESS_MS, maxUses: 1 };
  const actualArgs = { rootId, keyId, publicKey };
  const env = await buildPoPEnvelope(OPERATOR_SEED, cav, { methodId: "aumlokGenesisMint", actualArgs, timestamp: Date.now(), nonce: `n-${run}` });
  return t.mutation(api.aumlokRootRegistry.aumlokGenesisMint, { env, actualArgs, nodeId: NODE });
}

// Every convex/ source file (?raw) — for boundary scans across the whole server surface.
const SOURCES = import.meta.glob("../convex/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const idSrc = (name: string) => Object.entries(SOURCES).find(([p]) => p.endsWith(name))![1];

describe("B2.3b — privacy half-requalification: the user identity secret never crosses the server boundary", () => {
  it("after a full self-sovereign ceremony, the root SEED appears in NO persisted row or receipt (only public material does)", async () => {
    const t = convexTest(schema, modules);
    const c = await buildCeremony();
    expect((await mintCeremony(t, c)).ok).toBe(true);
    const dump = await t.run(async (ctx: any) => {
      const tables = ["aumlok_root_keys", "aumlok_ceremonies", "auma_receipts", "auma_receipt_chain_head"];
      const out: any = {};
      for (const tb of tables) out[tb] = await ctx.db.query(tb as any).collect();
      return out;
    });
    const blob = JSON.stringify(dump);
    // the SECRET is absent everywhere...
    for (const secret of [ROOT_SEED, "seed", "phrase", "private", "mnemonic"]) expect(blob.toLowerCase().includes(secret.toLowerCase())).toBe(false);
    // ...and the expected PUBLIC material IS present (the public key pinned in the registry).
    expect(blob.includes(c.pub)).toBe(true);
    expect(dump.aumlok_root_keys[0].publicKey).toBe(c.pub);
    expect(dump.aumlok_root_keys[0].fingerprint).toBe(c.fingerprint);
  });
  it("the ceremony mutation accepts only public-material args — no seed/phrase/private/mnemonic input field", () => {
    const code = idSrc("aumlokCeremony.ts");
    const args = code.match(/args:\s*\{[^}]*\}/)![0].toLowerCase();
    for (const banned of ["seed", "phrase", "private", "mnemonic"]) expect(args.includes(banned)).toBe(false);
    expect(args.includes("publickey")).toBe(true); // public key in, never a secret
  });
  it("the AUMLOK identity modules cannot derive an identity key from a seed (no derive module, no Argon2id, no seed→key)", () => {
    for (const name of ["aumlokCeremony.ts", "aumlokRootRegistry.ts", "aumlokManifests.ts"]) {
      const code = idSrc(name);
      expect(code.includes("aukoraAumlokDerive")).toBe(false);       // never the phrase-derivation module
      expect(code.includes("@noble/hashes/argon2")).toBe(false);     // the memory-hard KDF never runs in the identity path
      expect(code.includes("mlDsa65PublicKeyFromSeed")).toBe(false); // identity modules take PUBLIC keys; they never turn a seed into a key
    }
  });
  it("phraseTransitsServer negative: a ceremony asserting the phrase DOES transit the server refuses", async () => {
    const t = convexTest(schema, modules);
    const c = await buildCeremony(ROOT_SEED, { summary: { phraseTransitsServer: true } });
    await expect(mintCeremony(t, c)).rejects.toThrow("aumlok_ceremony_summary_phrase_flag_required");
  });
});

describe("B2.3b — ceremony robustness (parked from the B2.3 review)", () => {
  it("malformed ceremonyId refuses (grammar — no ambiguous chain material)", async () => {
    const t = convexTest(schema, modules);
    await expect(mintCeremony(t, await buildCeremony(ROOT_SEED, { ceremonyId: "cer:1" }))).rejects.toThrow("aumlok_ceremony_name_invalid:ceremonyId");
    await expect(mintCeremony(t, await buildCeremony(ROOT_SEED, { ceremonyId: "Cer 1" }))).rejects.toThrow("aumlok_ceremony_name_invalid:ceremonyId");
  });
  it("cross-PATH duplicate: a self-sovereign ceremony cannot re-mint a root already born via lab/admin genesis", async () => {
    const t = convexTest(schema, modules);
    expect((await labGenesis(t, "echo.carbon", "rk-1", await mlDsa65PublicKeyFromSeed(OTHER_SEED), "xp")).ok).toBe(true);
    // the shared mintRootKeyRow chokepoint spans both birth paths → once-per-root holds across them
    await expect(mintCeremony(t, await buildCeremony())).rejects.toThrow("aumlok_root_already_exists");
  });
  it("a FAILED ceremony rolls back atomically — the ceremonyId is not burned and the same ceremony retries clean", async () => {
    const t = convexTest(schema, modules);
    const c = await buildCeremony(); // ceremonyId cer-1
    await expect(mintCeremony(t, c, { confirmedFingerprint: "00".repeat(32) })).rejects.toThrow("aumlok_ceremony_fingerprint_mismatch");
    // the failed attempt recorded nothing (no ceremony row, no root) → retry the SAME ceremonyId succeeds
    expect(await t.run(async (ctx: any) => ctx.db.query("aumlok_ceremonies").withIndex("by_ceremonyId", (q: any) => q.eq("ceremonyId", "cer-1")).first())).toBeNull();
    expect((await mintCeremony(t, c)).ok).toBe(true);
  });
  it("timestamp freshness window: just-inside passes, just-outside refuses", async () => {
    const t = convexTest(schema, modules);
    expect((await mintCeremony(t, await buildCeremony(ROOT_SEED, { challenge: { timestamp: Date.now() - 59_000 }, ceremonyId: "cer-in" }))).ok).toBe(true);
    await expect(mintCeremony(t, await buildCeremony(ROOT_SEED, { challenge: { timestamp: Date.now() - 61_000 }, ceremonyId: "cer-out", rootId: "echo.other" }))).rejects.toThrow("aumlok_ceremony_stale");
  });
});
