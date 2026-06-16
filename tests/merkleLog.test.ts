// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/**
 * B1.5a — RFC 6962 / RFC 9162 Merkle log (convex/aukoraMerkleLog.ts), tests-first. Corroboration anchor:
 * the Certificate Transparency reference known-answer vectors (tests/vectors/ct-rfc6962-merkle.json, vendored from
 * transparency-dev/merkle with recorded source hashes). The roots for tree sizes 0..8 are the external truth; a
 * proof system that (a) reproduces those roots, (b) builds inclusion/consistency proofs that round-trip against them
 * across the FULL cross-product, and (c) refuses every tampered input, is correct by construction — the canonical
 * proof for a given (index, size) is uniquely determined by the KAT-pinned tree. Literal proof KATs are pinned too,
 * so a future encoding change fails loudly. The library holds NO authority — it is pure hashing math.
 */
import { describe, it, expect } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import vec from "./vectors/ct-rfc6962-merkle.json";
import {
  leafHash, nodeHash, emptyRootHash, merkleRoot, rootFromLeafHashes,
  inclusionProof, consistencyProof, verifyInclusion, verifyConsistency,
  inclusionProofHex, consistencyProofHex,
} from "../convex/aukoraMerkleLog";

const hx = bytesToHex;
const b = hexToBytes;
const leafInputs = vec.leafInputsHex.map(b);   // raw inputs ("" → empty Uint8Array)
const leafHashes = vec.leafHashesHex.map(b);   // their RFC 6962 leaf hashes
const roots = vec.rootHashesBySize;            // hex root per tree size 0..8
const N = leafHashes.length;                   // 8

describe("RFC 6962 hashing primitives", () => {
  it("emptyRoot = SHA-256(\"\") and equals the size-0 reference root", () => {
    expect(hx(emptyRootHash())).toBe(hx(sha256(new Uint8Array(0))));
    expect(hx(emptyRootHash())).toBe(roots[0]);
  });
  it("leafHash matches the CT reference leaf hashes for every leaf input (0x00 domain prefix)", () => {
    for (let i = 0; i < N; i++) expect(hx(leafHash(leafInputs[i])), `leaf ${i}`).toBe(vec.leafHashesHex[i]);
  });
  it("nodeHash uses the 0x01 prefix — an interior node is never a leaf preimage (second-preimage defence)", () => {
    const l = leafHashes[0], r = leafHashes[1];
    expect(hx(nodeHash(l, r))).toBe(hx(sha256(new Uint8Array([0x01, ...l, ...r]))));
    expect(hx(nodeHash(l, r))).not.toBe(hx(leafHash(new Uint8Array([...l, ...r])))); // 0x01 vs 0x00 prefix
  });
});

describe("Merkle root — CT reference KAT, every tree size 0..8", () => {
  it("rootFromLeafHashes and merkleRoot both byte-match the reference root at each size", () => {
    for (let size = 0; size <= N; size++) {
      expect(hx(rootFromLeafHashes(leafHashes.slice(0, size))), `rootFromLeafHashes size ${size}`).toBe(roots[size]);
      expect(hx(merkleRoot(leafInputs.slice(0, size))), `merkleRoot size ${size}`).toBe(roots[size]);
    }
  });
});

describe("Inclusion proofs — round-trip against KAT roots (full cross-product) + literal KAT", () => {
  it("every (index, size) with 0 ≤ index < size ≤ 8 verifies against the reference root", () => {
    for (let size = 1; size <= N; size++) {
      for (let index = 0; index < size; index++) {
        const proof = inclusionProof(leafHashes.slice(0, size), index);
        expect(verifyInclusion(index, size, leafHashes[index], proof, b(roots[size])), `incl ${index}/${size}`).toBe(true);
      }
    }
  });
  it("literal KAT: inclusion proof for leaf 0 in the size-8 tree is the canonical sibling chain", () => {
    expect(inclusionProofHex(vec.leafHashesHex, 0)).toEqual([
      "96a296d224f285c67bee93c30f8a309157f0daa35dc5b87e410b78630a09cfc7",
      "5f083f0a1a33ca076a95279832580db3e0ef4584bdff1f54c8a360f50de3031e",
      "6b47aaf29ee3c2af9af889bc1fb9254dabd31177f16232dd6aab035ca39bf6e4",
    ]);
  });
  it("tamper negatives all refuse (false, never throw): wrong leaf, flipped sibling, wrong index, wrong root, wrong size", () => {
    const size = 8, index = 3;
    const proof = inclusionProof(leafHashes.slice(0, size), index);
    const root = b(roots[size]);
    expect(verifyInclusion(index, size, leafHashes[index], proof, root)).toBe(true); // baseline
    expect(verifyInclusion(index, size, leafHashes[index + 1], proof, root)).toBe(false);   // wrong leaf
    const bad = proof.map((p) => p.slice()); bad[0][0] ^= 0x01;
    expect(verifyInclusion(index, size, leafHashes[index], bad, root)).toBe(false);          // flipped sibling
    expect(verifyInclusion(index + 1, size, leafHashes[index], proof, root)).toBe(false);    // wrong index
    expect(verifyInclusion(index, size, leafHashes[index], proof, b(roots[7]))).toBe(false); // wrong root
    expect(verifyInclusion(index, size + 1, leafHashes[index], proof, root)).toBe(false);    // wrong size (proof length mismatch)
    expect(verifyInclusion(index, size, leafHashes[index], proof.slice(0, 1), root)).toBe(false); // truncated proof
    expect(verifyInclusion(index, size, leafHashes[index], [...proof, proof[0]], root)).toBe(false); // padded proof
    expect(verifyInclusion(size, size, leafHashes[0], proof, root)).toBe(false);             // index >= size
  });
});

describe("Consistency proofs — round-trip against KAT roots (full cross-product) + literal KATs", () => {
  it("every (size1, size2) with 1 ≤ size1 ≤ size2 ≤ 8 verifies append-only against both reference roots", () => {
    for (let size2 = 1; size2 <= N; size2++) {
      for (let size1 = 1; size1 <= size2; size1++) {
        const proof = consistencyProof(leafHashes.slice(0, size2), size1, size2);
        expect(verifyConsistency(size1, size2, proof, b(roots[size1]), b(roots[size2])), `cons ${size1}->${size2}`).toBe(true);
      }
    }
  });
  it("literal KATs: consistency(1,8) and consistency(6,8) are the canonical proofs", () => {
    expect(consistencyProofHex(vec.leafHashesHex, 1, 8)).toEqual([
      "96a296d224f285c67bee93c30f8a309157f0daa35dc5b87e410b78630a09cfc7",
      "5f083f0a1a33ca076a95279832580db3e0ef4584bdff1f54c8a360f50de3031e",
      "6b47aaf29ee3c2af9af889bc1fb9254dabd31177f16232dd6aab035ca39bf6e4",
    ]);
    expect(consistencyProofHex(vec.leafHashesHex, 6, 8)).toEqual([
      "0ebc5d3437fbe2db158b9f126a1d118e308181031d0a949f8dededebc558ef6a",
      "ca854ea128ed050b41b35ffc1b87b8eb2bde461e9e3b5596ece6b9d5975a0ae0",
      "d37ee418976dd95753c1c73862b9398fa2a2cf9b4ff0fdfe8b30cd95209614b7",
    ]);
  });
  it("size1 == size2 needs an empty proof and matching roots; size1 == 0 is rejected as meaningless", () => {
    expect(verifyConsistency(5, 5, [], b(roots[5]), b(roots[5]))).toBe(true);
    expect(verifyConsistency(5, 5, [leafHashes[0]], b(roots[5]), b(roots[5]))).toBe(false); // nonempty proof at equal size
    expect(verifyConsistency(0, 5, [], b(roots[0]), b(roots[5]))).toBe(false);              // RFC: empty-tree consistency is meaningless
  });
  it("tamper negatives all refuse: flipped proof byte, wrong root1, wrong root2, size2<size1, length mismatch", () => {
    const size1 = 3, size2 = 7;
    const proof = consistencyProof(leafHashes.slice(0, size2), size1, size2);
    expect(verifyConsistency(size1, size2, proof, b(roots[size1]), b(roots[size2]))).toBe(true); // baseline
    const bad = proof.map((p) => p.slice()); bad[0][0] ^= 0x01;
    expect(verifyConsistency(size1, size2, bad, b(roots[size1]), b(roots[size2]))).toBe(false);   // flipped proof byte
    expect(verifyConsistency(size1, size2, proof, b(roots[4]), b(roots[size2]))).toBe(false);     // wrong root1
    expect(verifyConsistency(size1, size2, proof, b(roots[size1]), b(roots[6]))).toBe(false);     // wrong root2
    expect(verifyConsistency(size2, size1, proof, b(roots[size2]), b(roots[size1]))).toBe(false); // size2 < size1
    expect(verifyConsistency(size1, size2, proof.slice(0, 1), b(roots[size1]), b(roots[size2]))).toBe(false); // truncated
  });
});

describe("Larger trees beyond the KAT window — build + round-trip past size 8", () => {
  it("a 50-leaf tree: every leaf's inclusion proof round-trips, and consistency holds across growth", () => {
    const inputs = Array.from({ length: 50 }, (_, i) => sha256(new Uint8Array([i, 0x5a]))); // 50 distinct leaf inputs
    const lh = inputs.map(leafHash);
    const root50 = merkleRoot(inputs);
    for (let index = 0; index < 50; index++) {
      const proof = inclusionProof(lh, index);
      expect(verifyInclusion(index, 50, lh[index], proof, root50), `incl ${index}/50`).toBe(true);
    }
    for (const size1 of [1, 7, 16, 31, 32, 49]) {
      const root1 = rootFromLeafHashes(lh.slice(0, size1));
      const proof = consistencyProof(lh, size1, 50);
      expect(verifyConsistency(size1, 50, proof, root1, root50), `cons ${size1}->50`).toBe(true);
    }
  });
});

describe("No aliasing — builder outputs never share buffers with caller input (B1.5a review)", () => {
  it("inclusion/consistency proof elements are fresh copies; mutating them leaves the input untouched", () => {
    const before = leafHashes.map((h) => hx(h));
    const incl = inclusionProof(leafHashes.slice(0, 8), 3);
    expect(incl[0]).not.toBe(leafHashes[2]);          // not the same object
    expect(hx(incl[0])).toBe(hx(leafHashes[2]));       // but equal value
    incl.forEach((e) => e.fill(0));                    // a defensive consumer zeroizes the proof
    expect(leafHashes.map((h) => hx(h))).toEqual(before); // input leaf set is byte-identical
    const cons = consistencyProof(leafHashes.slice(0, 8), 1, 8);
    cons.forEach((e) => e.fill(0));
    expect(leafHashes.map((h) => hx(h))).toEqual(before);
  });
  it("merkleRoot/rootFromLeafHashes of a single leaf return a fresh buffer, not the input leaf", () => {
    const leaf = leafHashes[0];
    const root = rootFromLeafHashes([leaf]);
    expect(root).not.toBe(leaf);
    root.fill(0);
    expect(hx(leafHashes[0])).toBe(vec.leafHashesHex[0]); // input untouched
  });
});

describe("Verifiers enforce the Uint8Array byte contract fail-closed (B1.5a review)", () => {
  it("a structurally-equal plain Array<number> root is REJECTED (type, not just value)", () => {
    const proof = inclusionProof(leafHashes.slice(0, 8), 0);
    const root = b(roots[8]);
    expect(verifyInclusion(0, 8, leafHashes[0], proof, root)).toBe(true);                  // Uint8Array root: accepted
    expect(verifyInclusion(0, 8, leafHashes[0], proof, Array.from(root) as any)).toBe(false); // Array root: rejected
    expect(verifyInclusion(0, 8, Array.from(leafHashes[0]) as any, proof, root)).toBe(false); // Array leaf hash: rejected
    expect(verifyInclusion(0, 8, leafHashes[0], proof.map((p) => Array.from(p)) as any, root)).toBe(false); // Array proof elems
    const cp = consistencyProof(leafHashes.slice(0, 8), 1, 8);
    expect(verifyConsistency(1, 8, cp, Array.from(b(roots[1])) as any, b(roots[8]))).toBe(false);
    expect(verifyConsistency(1, 8, cp, b(roots[1]), Array.from(b(roots[8])) as any)).toBe(false);
  });
});

describe("Builders fail closed; verifiers never throw on garbage", () => {
  it("inclusionProof / consistencyProof throw on invalid arguments", () => {
    expect(() => inclusionProof(leafHashes.slice(0, 4), 4)).toThrow("aukora_merkle_index_oob");
    expect(() => inclusionProof(leafHashes.slice(0, 4), -1)).toThrow("aukora_merkle_index_oob");
    expect(() => consistencyProof(leafHashes.slice(0, 4), 5, 4)).toThrow("aukora_merkle_consistency_args"); // size1>size2
    expect(() => consistencyProof(leafHashes.slice(0, 4), 2, 5)).toThrow("aukora_merkle_consistency_args"); // size2 != leaves length
  });
  it("verifiers return false (never throw) on malformed input: wrong-length hashes, NaN sizes, junk proofs", () => {
    const proof = inclusionProof(leafHashes.slice(0, 8), 0);
    expect(verifyInclusion(0, 8, new Uint8Array(31), proof, b(roots[8]))).toBe(false);   // short leaf hash
    expect(verifyInclusion(NaN, 8, leafHashes[0], proof, b(roots[8]))).toBe(false);       // NaN index
    expect(verifyInclusion(0, 8, leafHashes[0], [new Uint8Array(31)], b(roots[8]))).toBe(false); // short proof element
    expect(verifyConsistency(1, 8, [new Uint8Array(10)], b(roots[1]), b(roots[8]))).toBe(false); // short proof element
    expect(verifyConsistency(1.5, 8, [], b(roots[1]), b(roots[8]))).toBe(false);          // non-integer size
  });
});
