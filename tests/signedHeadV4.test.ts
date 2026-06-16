// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/**
 * B1.5b1 — SignedChainHeadV4 format: a signed receipt-head that commits to BOTH the linear chain head AND the
 * RFC 6962 append-only history root. Tested adversarially BEFORE the live receipt-path integration (B1.5b2).
 * What must hold: the 98-byte layout binds version(0x04)+alg(0x04)+chain_id+timestamp+tree_size+chain_head+
 * merkle_root; a tampered root or tree_size refuses; V3 material does not silently verify as V4 (and vice versa);
 * and — the point of the increment — the SIGNED root is exactly the root an inclusion/consistency proof checks
 * against (the two modules connect). Deterministic, fail-closed parsing throughout. Local transparency math only.
 */
import { describe, it, expect } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import {
  SIGNED_HEAD_V4_VERSION, SIGNED_HEAD_V4_ALG,
  serializeSignedChainHeadV4, signChainHeadV4, verifyChainHeadV4,
  signChainHeadV3, verifyChainHeadV3, deriveChainId,
  type ChainHeadFields,
} from "../convex/aukoraSignedHead";
import { mlDsa65PublicKeyFromSeed, PQC_SIZES } from "../convex/aukoraPqcSigner";
import { merkleRootHex, inclusionProof, consistencyProof, verifyInclusion, verifyConsistency, receiptLeafHash, receiptHistoryRootHex } from "../convex/aukoraMerkleLog";

const hx = bytesToHex;
const b = hexToBytes;
const SEED = "42".repeat(32);
const OTHER_SEED = "43".repeat(32);
const ROOT = "ab".repeat(32);   // a stand-in 32-byte history root
const ROOT2 = "cd".repeat(32);
const HEAD: ChainHeadFields = { chainKey: "demo:v4:1", timestamp: 1765432100000, chainLength: 7, chainHeadHash: "11".repeat(32) };

describe("SignedChainHeadV4 — serialization (98 bytes: V3 layout + merkle_root, all fields explicit)", () => {
  it("emits 98 bytes with version 0x04, alg 0x04, chain_id, full BE u64s, chain head, and merkle_root at [66..97]", () => {
    const buf = serializeSignedChainHeadV4(HEAD, ROOT);
    const beU64 = (off: number) => { let v = 0; for (let i = 0; i < 8; i++) v = v * 256 + buf[off + i]; return v; };
    expect(buf.length).toBe(98);
    expect(buf[0]).toBe(SIGNED_HEAD_V4_VERSION); // 0x04
    expect(buf[1]).toBe(0x04);                    // ml-dsa-65 alg id
    expect(Array.from(buf.slice(2, 18))).toEqual(Array.from(deriveChainId(HEAD.chainKey)));
    expect(beU64(18)).toBe(HEAD.timestamp);        // full timestamp u64 BE (high bytes non-zero: > 2^32)
    expect(beU64(26)).toBe(HEAD.chainLength);      // full chain_length / tree_size u64 BE
    expect(hx(buf.slice(34, 66))).toBe(HEAD.chainHeadHash);
    expect(hx(buf.slice(66, 98))).toBe(ROOT);      // the new field
  });
  it("SIGNED_HEAD_V4_ALG is the v4 telemetry tag, distinct from v3", () => {
    expect(SIGNED_HEAD_V4_ALG).toBe("ml-dsa-65-chainhead-v4");
  });
  it("FAILS CLOSED at mint: malformed merkle_root, malformed chain hash, unknown alg, out-of-range u64", () => {
    expect(() => serializeSignedChainHeadV4(HEAD, "abcd")).toThrow("aukora_signed_head_merkle_root_len");
    expect(() => serializeSignedChainHeadV4(HEAD, "ab".repeat(31))).toThrow("aukora_signed_head_merkle_root_len");
    expect(() => serializeSignedChainHeadV4({ ...HEAD, chainHeadHash: "ab" }, ROOT)).toThrow("aukora_signed_head_chain_hash_len");
    expect(() => serializeSignedChainHeadV4(HEAD, ROOT, 0x05)).toThrow("aukora_pqc_alg_unknown");
    expect(() => serializeSignedChainHeadV4({ ...HEAD, chainLength: -1 }, ROOT)).toThrow("aukora_signed_head_u64_range");
  });
});

describe("SignedChainHeadV4 — sign/verify (deterministic; binds every field incl. root + tree_size)", () => {
  it("round-trips and is deterministic", async () => {
    const pub = await mlDsa65PublicKeyFromSeed(SEED);
    const s1 = await signChainHeadV4(SEED, HEAD, ROOT, "chainHead");
    const s2 = await signChainHeadV4(SEED, HEAD, ROOT, "chainHead");
    expect(s1).toBe(s2);
    expect(s1.length).toBe(PQC_SIZES.signatureBytes * 2);
    expect(await verifyChainHeadV4(pub, HEAD, ROOT, s1, "chainHead")).toBe(true);
  });
  it("a tampered MERKLE ROOT refuses (the new binding)", async () => {
    const pub = await mlDsa65PublicKeyFromSeed(SEED);
    const sig = await signChainHeadV4(SEED, HEAD, ROOT, "chainHead");
    expect(await verifyChainHeadV4(pub, HEAD, ROOT2, sig, "chainHead")).toBe(false);
    const flipped = (ROOT[0] === "a" ? "b" : "a") + ROOT.slice(1);
    expect(await verifyChainHeadV4(pub, HEAD, flipped, sig, "chainHead")).toBe(false);
  });
  it("a tampered TREE SIZE (chain_length) refuses; so does any other tampered field", async () => {
    const pub = await mlDsa65PublicKeyFromSeed(SEED);
    const sig = await signChainHeadV4(SEED, HEAD, ROOT, "chainHead");
    for (const m of [
      { ...HEAD, chainLength: HEAD.chainLength + 1 }, // tree size / truncation-extension
      { ...HEAD, chainKey: "demo:v4:2" },              // cross-chain replay
      { ...HEAD, timestamp: HEAD.timestamp + 1 },
      { ...HEAD, chainHeadHash: "22".repeat(32) },
    ]) {
      expect(await verifyChainHeadV4(pub, m, ROOT, sig, "chainHead")).toBe(false);
    }
  });
  it("purpose domains separate (a chainHead V4 sig refuses under cap/req/delegation/manifest)", async () => {
    const pub = await mlDsa65PublicKeyFromSeed(SEED);
    const sig = await signChainHeadV4(SEED, HEAD, ROOT, "chainHead");
    for (const d of ["cap", "req", "delegation", "manifest"] as const) {
      expect(await verifyChainHeadV4(pub, HEAD, ROOT, sig, d)).toBe(false);
    }
  });
  it("refuses wrong key, truncated/non-canonical signature (false, never throws)", async () => {
    const pub = await mlDsa65PublicKeyFromSeed(SEED);
    const other = await mlDsa65PublicKeyFromSeed(OTHER_SEED);
    const sig = await signChainHeadV4(SEED, HEAD, ROOT, "chainHead");
    expect(await verifyChainHeadV4(other, HEAD, ROOT, sig, "chainHead")).toBe(false);
    expect(await verifyChainHeadV4(pub, HEAD, ROOT, sig.slice(0, 6616), "chainHead")).toBe(false);
    expect(await verifyChainHeadV4(pub, HEAD, ROOT, sig.toUpperCase(), "chainHead")).toBe(false);
    expect(await verifyChainHeadV4(pub, HEAD, "zz".repeat(32), sig, "chainHead")).toBe(false); // serialize throws -> false
  });
});

describe("SignedChainHeadV4 — NO silent cross-version (V3 ⇎ V4, both directions)", () => {
  it("a V3 signature does not verify as V4, and a V4 signature does not verify as V3", async () => {
    const pub = await mlDsa65PublicKeyFromSeed(SEED);
    const v3sig = await signChainHeadV3(SEED, HEAD, "chainHead");          // signs the 66-byte V3 preimage
    const v4sig = await signChainHeadV4(SEED, HEAD, ROOT, "chainHead");    // signs the 98-byte V4 preimage
    expect(await verifyChainHeadV4(pub, HEAD, ROOT, v3sig, "chainHead")).toBe(false); // V3 material into V4 verify
    expect(await verifyChainHeadV3(pub, HEAD, v4sig, "chainHead")).toBe(false);       // V4 material into V3 verify
    // sanity: each verifies under its own format
    expect(await verifyChainHeadV4(pub, HEAD, ROOT, v4sig, "chainHead")).toBe(true);
    expect(await verifyChainHeadV3(pub, HEAD, v3sig, "chainHead")).toBe(true);
  });
});

describe("SignedChainHeadV4 — the tie-in: the SIGNED root is the root proofs check against", () => {
  // Build a realistic chain: tree_size receipt leaves (each a 32-byte chainHash), compute the history root, sign a
  // V4 head over it, then verify an inclusion proof for one receipt AGAINST THE SIGNED ROOT.
  const receiptLeaves = (n: number) => Array.from({ length: n }, (_, i) => bytesToHex(sha256(new Uint8Array([i, 0xc1]))));

  it("inclusion proof for a receipt verifies against the head-committed history root (via the canonical helpers)", async () => {
    const pub = await mlDsa65PublicKeyFromSeed(SEED);
    const leavesHex = receiptLeaves(7);                                   // 7 receipts → tree_size 7
    const rootHex = receiptHistoryRootHex(leavesHex);                     // THE canonical receipt-history root
    const head: ChainHeadFields = { ...HEAD, chainLength: 7, chainHeadHash: leavesHex[6] }; // tree_size == chain_length
    const sig = await signChainHeadV4(SEED, head, rootHex, "chainHead");
    expect(await verifyChainHeadV4(pub, head, rootHex, sig, "chainHead")).toBe(true);       // head commits to rootHex

    // a verifier holding only the signed head can now check any receipt's inclusion against that committed root
    const leafHashes = leavesHex.map(receiptLeafHash);
    const idx = 3;
    const proof = inclusionProof(leafHashes, idx);
    expect(verifyInclusion(idx, 7, leafHashes[idx], proof, b(rootHex))).toBe(true);          // proof ↔ signed root
    // a receipt NOT in this tree fails against the same committed root
    const alienLeaf = receiptLeafHash(receiptLeaves(8)[7]);
    expect(verifyInclusion(idx, 7, alienLeaf, proof, b(rootHex))).toBe(false);
  });

  it("consistency proof verifies append-only growth across two SIGNED history roots", async () => {
    const pub = await mlDsa65PublicKeyFromSeed(SEED);
    const leavesHex = receiptLeaves(8);
    const leafHashes = leavesHex.map(receiptLeafHash);
    const root5 = receiptHistoryRootHex(leavesHex.slice(0, 5));
    const root8 = receiptHistoryRootHex(leavesHex);
    const head5: ChainHeadFields = { ...HEAD, chainLength: 5, chainHeadHash: leavesHex[4] };
    const head8: ChainHeadFields = { ...HEAD, chainLength: 8, chainHeadHash: leavesHex[7] };
    const sig5 = await signChainHeadV4(SEED, head5, root5, "chainHead");
    const sig8 = await signChainHeadV4(SEED, head8, root8, "chainHead");
    expect(await verifyChainHeadV4(pub, head5, root5, sig5, "chainHead")).toBe(true);
    expect(await verifyChainHeadV4(pub, head8, root8, sig8, "chainHead")).toBe(true);

    // both roots are signed; a consistency proof shows the size-5 history is an append-only prefix of the size-8 one
    const proof = consistencyProof(leafHashes, 5, 8);
    expect(verifyConsistency(5, 8, proof, b(root5), b(root8))).toBe(true);
    // a forged "later" root (different history) breaks the append-only check
    expect(verifyConsistency(5, 8, proof, b(root5), b(ROOT2))).toBe(false);
  });

  it("GUARDRAIL: the WRONG leaf convention (root over leaf hashes) signs+verifies but no proof matches it (locks B1.5b2)", async () => {
    const pub = await mlDsa65PublicKeyFromSeed(SEED);
    const leavesHex = receiptLeaves(7);
    const correctRoot = receiptHistoryRootHex(leavesHex);                 // raw chainHashes as leaf inputs (CORRECT)
    const leafHashesHex = leavesHex.map((h) => hx(receiptLeafHash(h)));
    const wrongRoot = merkleRootHex(leafHashesHex);                       // double-hashed (WRONG convention)
    expect(wrongRoot).not.toBe(correctRoot);
    const head: ChainHeadFields = { ...HEAD, chainLength: 7, chainHeadHash: leavesHex[6] };
    // the wrong root is a well-formed 32-byte value: it signs and verifies fine (the primitive cannot detect it)...
    const sig = await signChainHeadV4(SEED, head, wrongRoot, "chainHead");
    expect(await verifyChainHeadV4(pub, head, wrongRoot, sig, "chainHead")).toBe(true);
    // ...but NO inclusion proof matches the wrong root — the silent break B1.5b2 avoids by using receiptHistoryRootHex
    const leafHashes = leavesHex.map(receiptLeafHash);
    const proof = inclusionProof(leafHashes, 3);
    expect(verifyInclusion(3, 7, leafHashes[3], proof, b(wrongRoot))).toBe(false);  // proof ⇎ wrong root
    expect(verifyInclusion(3, 7, leafHashes[3], proof, b(correctRoot))).toBe(true); // proof ↔ correct root
  });
});
