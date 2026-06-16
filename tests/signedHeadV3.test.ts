// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/**
 * B1.3a — SignedChainHeadV3 format + fail-closed verification, tested adversarially BEFORE any live call site
 * migrates (the B1.3b cutover). What must hold: the 66-byte layout with version (0x03) and algorithm id (0x04)
 * BOUND INTO THE SIGNED BYTES (tag stripping / alg swapping / version confusion all refuse); chain_id cross-chain
 * separation preserved byte-for-byte from V2; purpose separation via FIPS 204 domains; deterministic signatures;
 * and — critically — NO silent dual-mode: V2/Ed25519 material refuses through every V3 path. The V2 functions used
 * below to MINT legacy material are explicit test fixtures, permitted for negative controls only.
 */
import { describe, it, expect } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  SIGNED_HEAD_V3_VERSION,
  SIGNED_HEAD_V3_ALG,
  serializeSignedChainHeadV3,
  signChainHeadV3,
  verifyChainHeadV3,
  verifyHeadRowSignatureV3,
  resolveChainVerifyingPublicKey,
  resolveChainSigningSeed,
  deriveChainId,
  type ChainHeadFields,
} from "../convex/aukoraSignedHead";
// Retired-V2 material is minted by the TEST-ONLY fixture (the kernel carries zero Ed25519 since the B1.3b cutover):
import { SIGNED_HEAD_V2_ALG, signChainHeadV2, verifyChainHeadV2, ed25519PublicKeyFromSeedV2 } from "./legacyV2Fixture";
import { mlDsa65PublicKeyFromSeed, pqcVerify, PQC_SIZES } from "../convex/aukoraPqcSigner";

const SEED = "42".repeat(32); // disposable test seed
const OTHER_SEED = "43".repeat(32);
const HEAD: ChainHeadFields = {
  chainKey: "demo:v3:1",
  timestamp: 1765432100000,
  chainLength: 7,
  chainHeadHash: "ab".repeat(32),
};

describe("SignedChainHeadV3 — serialization shape (version + alg-id in the signed preimage)", () => {
  it("emits exactly 66 bytes: version 0x03, alg 0x04, chain_id, BE u64s, head hash — layout byte-precise", () => {
    const buf = serializeSignedChainHeadV3(HEAD);
    expect(buf.length).toBe(66);
    expect(buf[0]).toBe(SIGNED_HEAD_V3_VERSION); // 0x03
    expect(buf[1]).toBe(0x04); // ml-dsa-65 alg id
    // chain_id: SHA-256("aukora-chain" || chainKey)[:16] — recomputed independently, not via deriveChainId
    const enc = new TextEncoder();
    const pre = new Uint8Array([...enc.encode("aukora-chain"), ...enc.encode(HEAD.chainKey)]);
    const expectedChainId = sha256(pre).slice(0, 16);
    expect(Array.from(buf.slice(2, 18))).toEqual(Array.from(expectedChainId));
    expect(Array.from(buf.slice(2, 18))).toEqual(Array.from(deriveChainId(HEAD.chainKey))); // and matches the shared helper
    // big-endian u64s at fixed offsets
    const ts = buf.slice(18, 26), len = buf.slice(26, 34);
    expect(((ts[4] << 24 >>> 0) + (ts[5] << 16) + (ts[6] << 8) + ts[7]) >>> 0).toBe(HEAD.timestamp % 0x100000000);
    expect(len[7]).toBe(7);
    expect(Array.from(buf.slice(34))).toEqual(Array.from(new Uint8Array(32).fill(0xab)));
  });

  it("FAILS CLOSED at mint: unknown alg-id, malformed head hash, out-of-range u64 fields all throw", () => {
    for (const badAlg of [0x00, 0x01, 0x02, 0x03, 0x05, 0xff]) {
      expect(() => serializeSignedChainHeadV3(HEAD, badAlg)).toThrow("aukora_pqc_alg_unknown");
    }
    expect(() => serializeSignedChainHeadV3({ ...HEAD, chainHeadHash: "abcd" })).toThrow("aukora_signed_head_chain_hash_len");
    expect(() => serializeSignedChainHeadV3({ ...HEAD, timestamp: -1 })).toThrow("aukora_signed_head_u64_range");
    expect(() => serializeSignedChainHeadV3({ ...HEAD, timestamp: NaN })).toThrow("aukora_signed_head_u64_range");
    expect(() => serializeSignedChainHeadV3({ ...HEAD, chainLength: 2 ** 53 })).toThrow("aukora_signed_head_u64_range");
  });
});

describe("SignedChainHeadV3 — sign/verify (deterministic, field-bound, chain-bound, domain-bound)", () => {
  it("round-trips and is deterministic (byte-identical signatures)", async () => {
    const pub = await mlDsa65PublicKeyFromSeed(SEED);
    const s1 = await signChainHeadV3(SEED, HEAD, "chainHead");
    const s2 = await signChainHeadV3(SEED, HEAD, "chainHead");
    expect(s1).toBe(s2);
    expect(s1.length).toBe(PQC_SIZES.signatureBytes * 2);
    expect(await verifyChainHeadV3(pub, HEAD, s1, "chainHead")).toBe(true);
  });

  it("every field is bound: any tampered field refuses", async () => {
    const pub = await mlDsa65PublicKeyFromSeed(SEED);
    const sig = await signChainHeadV3(SEED, HEAD, "chainHead");
    const mutations: ChainHeadFields[] = [
      { ...HEAD, chainKey: "demo:v3:2" },                       // cross-chain replay (chain_id binding, PAL-3)
      { ...HEAD, timestamp: HEAD.timestamp + 1 },
      { ...HEAD, chainLength: HEAD.chainLength + 1 },           // truncation/extension forgery
      { ...HEAD, chainHeadHash: "cd".repeat(32) },              // different head
    ];
    for (const m of mutations) expect(await verifyChainHeadV3(pub, m, sig, "chainHead")).toBe(false);
  });

  it("version and algorithm bytes have TEETH: a sig does not verify over a preimage with flipped [0] or [1]", async () => {
    const pub = await mlDsa65PublicKeyFromSeed(SEED);
    const sig = await signChainHeadV3(SEED, HEAD, "chainHead");
    const preimage = serializeSignedChainHeadV3(HEAD);
    expect(await pqcVerify(pub, preimage, sig, "chainHead")).toBe(true); // baseline: the exact signed bytes
    const v2Version = preimage.slice(); v2Version[0] = 0x00; // masquerade as V2's version byte
    expect(await pqcVerify(pub, v2Version, sig, "chainHead")).toBe(false);
    const v2SigType = preimage.slice(); v2SigType[1] = 0x02; // masquerade as V2's chain_hash sig_type
    expect(await pqcVerify(pub, v2SigType, sig, "chainHead")).toBe(false);
    const algSwap = preimage.slice(); algSwap[1] = 0x05;     // future/unknown algorithm id
    expect(await pqcVerify(pub, algSwap, sig, "chainHead")).toBe(false);
  });

  it("purpose domains separate: a chainHead-domain head sig refuses under cap/req/delegation/manifest and vice versa", async () => {
    const pub = await mlDsa65PublicKeyFromSeed(SEED);
    const headSig = await signChainHeadV3(SEED, HEAD, "chainHead");
    for (const d of ["cap", "req", "delegation", "manifest"] as const) {
      expect(await verifyChainHeadV3(pub, HEAD, headSig, d)).toBe(false);
      const dSig = await signChainHeadV3(SEED, HEAD, d);
      expect(await verifyChainHeadV3(pub, HEAD, dSig, d)).toBe(true);
      expect(await verifyChainHeadV3(pub, HEAD, dSig, "chainHead")).toBe(false);
    }
  });

  it("refuses swapped public key, truncated signature, non-canonical case, and malformed fields (false, never throw)", async () => {
    const pub = await mlDsa65PublicKeyFromSeed(SEED);
    const otherPub = await mlDsa65PublicKeyFromSeed(OTHER_SEED);
    const sig = await signChainHeadV3(SEED, HEAD, "chainHead");
    expect(await verifyChainHeadV3(otherPub, HEAD, sig, "chainHead")).toBe(false);
    expect(await verifyChainHeadV3(pub, HEAD, sig.slice(0, 6616), "chainHead")).toBe(false);
    expect(await verifyChainHeadV3(pub, HEAD, sig.toUpperCase(), "chainHead")).toBe(false);
    expect(await verifyChainHeadV3(pub, { ...HEAD, chainHeadHash: "nope" }, sig, "chainHead")).toBe(false); // serialize throws -> caught -> false
    expect(await verifyChainHeadV3(pub, { ...HEAD, timestamp: NaN }, sig, "chainHead")).toBe(false);
  });
});

describe("SignedChainHeadV3 — NO silent dual-mode (V2/Ed25519 material refuses everywhere)", () => {
  it("row verdict: a genuine V2-signed row refuses with alg_mismatch (never re-verified via Ed25519)", async () => {
    const v2Sig = await signChainHeadV2(SEED, HEAD); // legacy fixture: mint real V2 material
    const v3Pub = await mlDsa65PublicKeyFromSeed(SEED);
    const verdict = await verifyHeadRowSignatureV3(v3Pub, {
      lastChainHash: HEAD.chainHeadHash, count: HEAD.chainLength,
      headSig: v2Sig, headSigAlg: SIGNED_HEAD_V2_ALG, headSignedAt: HEAD.timestamp,
    }, HEAD.chainKey);
    expect(verdict).toEqual({ ok: false, reason: `alg_mismatch:${SIGNED_HEAD_V2_ALG}` });
  });

  it("row verdict: tag-forged V2 material (V3 tag, Ed25519 sig) refuses as signature_invalid — the tag is a hint, not truth", async () => {
    const v2Sig = await signChainHeadV2(SEED, HEAD); // 128-hex Ed25519 sig wearing a V3 tag
    const v3Pub = await mlDsa65PublicKeyFromSeed(SEED);
    const verdict = await verifyHeadRowSignatureV3(v3Pub, {
      lastChainHash: HEAD.chainHeadHash, count: HEAD.chainLength,
      headSig: v2Sig, headSigAlg: SIGNED_HEAD_V3_ALG, headSignedAt: HEAD.timestamp,
    }, HEAD.chainKey);
    expect(verdict).toEqual({ ok: false, reason: "signature_invalid" });
  });

  it("row verdict: stripped tag, missing sig, missing signed-at each refuse with their distinct reason", async () => {
    const v3Pub = await mlDsa65PublicKeyFromSeed(SEED);
    const sig = await signChainHeadV3(SEED, HEAD, "chainHead");
    const base = { lastChainHash: HEAD.chainHeadHash, count: HEAD.chainLength, headSig: sig, headSigAlg: SIGNED_HEAD_V3_ALG, headSignedAt: HEAD.timestamp };
    expect((await verifyHeadRowSignatureV3(v3Pub, { ...base, headSig: null }, HEAD.chainKey)).reason).toBe("unsigned_head");
    expect((await verifyHeadRowSignatureV3(v3Pub, { ...base, headSigAlg: null }, HEAD.chainKey)).reason).toBe("alg_mismatch:none");
    expect((await verifyHeadRowSignatureV3(v3Pub, { ...base, headSignedAt: null }, HEAD.chainKey)).reason).toBe("missing_signed_at");
    expect(await verifyHeadRowSignatureV3(v3Pub, base, HEAD.chainKey)).toEqual({ ok: true, reason: null }); // happy path
  });

  it("negative control both directions: V3 sig refuses through the V2 verifier; V2 sig refuses through V3", async () => {
    const v3Sig = await signChainHeadV3(SEED, HEAD, "chainHead");
    const v2Sig = await signChainHeadV2(SEED, HEAD);
    const edPub = await ed25519PublicKeyFromSeedV2(SEED);
    const mlPub = await mlDsa65PublicKeyFromSeed(SEED);
    expect(await verifyChainHeadV2(edPub, HEAD, v3Sig)).toBe(false); // 3309-byte sig into Ed25519 verify -> refusal
    expect(await verifyChainHeadV3(mlPub, HEAD, v2Sig, "chainHead")).toBe(false); // 64-byte sig into V3 verify -> refusal
    expect(await verifyChainHeadV3(edPub, HEAD, v3Sig, "chainHead")).toBe(false); // V3 sig with an Ed25519-sized pubkey -> refusal
  });
});

describe("resolveChainVerifyingPublicKey — env contract fails closed (B1.3b adversarial-review HIGH)", () => {
  it("a stale 64-hex (legacy Ed25519) or malformed AUKORA_CHAIN_PUBLIC_KEY THROWS — never silently disables the audit", async () => {
    const prev = process.env.AUKORA_CHAIN_PUBLIC_KEY;
    try {
      process.env.AUKORA_CHAIN_PUBLIC_KEY = "ab".repeat(32); // pre-cutover Ed25519-sized value
      await expect(resolveChainVerifyingPublicKey()).rejects.toThrow("aukora_chain_public_key_invalid");
      process.env.AUKORA_CHAIN_PUBLIC_KEY = "zz".repeat(1952); // right length, non-hex
      await expect(resolveChainVerifyingPublicKey()).rejects.toThrow("aukora_chain_public_key_invalid");
      const valid = await mlDsa65PublicKeyFromSeed(SEED);
      process.env.AUKORA_CHAIN_PUBLIC_KEY = valid.toUpperCase(); // operator config: case-normalized in
      expect(await resolveChainVerifyingPublicKey()).toBe(valid);
      delete process.env.AUKORA_CHAIN_PUBLIC_KEY; // unset -> falls through to the signing seed (set in vitest env)
      expect(await resolveChainVerifyingPublicKey()).toBe(await mlDsa65PublicKeyFromSeed(resolveChainSigningSeed()!));
    } finally {
      if (prev === undefined) delete process.env.AUKORA_CHAIN_PUBLIC_KEY;
      else process.env.AUKORA_CHAIN_PUBLIC_KEY = prev;
    }
  });
});
