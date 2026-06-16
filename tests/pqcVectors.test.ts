// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/**
 * B1.3c — INDEPENDENT CORROBORATION of the PQC primitive (decision record §6 graduation tests #2 and #4, §7.1
 * standing mitigation). @noble/post-quantum has no independent third-party audit; these tests check the exact
 * primitive the kernel chokepoint wraps against NIST's official ACVP known-answer vectors (FIPS 204, final), inside
 * THIS suite's edge-runtime environment:
 *   - keyGen: NIST seed -> our keygen must produce NIST's pk AND sk
 *   - sigGen (deterministic, external interface = pure ML-DSA with context): NIST {sk, message, context} -> our
 *     deterministic signature must be byte-identical to NIST's
 *   - sigVer: NIST {pk, message, context, signature} -> our verify must agree with NIST's verdict, INCLUDING the
 *     negative cases (corrupted material must refuse)
 * Vectors: tests/vectors/acvp-ml-dsa-65.json — a curated ML-DSA-65 subset vendored from usnistgov/ACVP-Server with
 * recorded source hashes and retrieval date (data files only; no NIST code executed).
 *
 * Plus the MUTATED-HINT MALLEABILITY NEGATIVE (§6 test #2): FIPS 204's final HintBitUnpack requires canonical
 * (strictly ascending, zero-padded) hint encoding — the IPD draft omitted this and a verifier without the check
 * accepts re-encoded (semantically identical, byte-different) signatures, breaking strong unforgeability. We
 * construct that exact non-canonical re-encoding and require refusal.
 */
import { describe, it, expect } from "vitest";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils.js";
import vectors from "./vectors/acvp-ml-dsa-65.json";
import { pqcVerify, mlDsa65PublicKeyFromSeed, pqcSign, PQC_SIZES } from "../convex/aukoraPqcSigner";

describe("NIST ACVP ML-DSA-65 known-answer vectors (FIPS 204 final, external interface)", () => {
  it(`keyGen: NIST seeds produce NIST's exact keypairs (${vectors.keyGen.length} cases)`, () => {
    for (const tc of vectors.keyGen) {
      const { publicKey, secretKey } = ml_dsa65.keygen(hexToBytes(tc.seed));
      expect(bytesToHex(publicKey), `tc${tc.tcId} pk`).toBe(tc.pk.toLowerCase());
      expect(bytesToHex(secretKey), `tc${tc.tcId} sk`).toBe(tc.sk.toLowerCase());
    }
  });

  it(`sigGen deterministic: NIST {sk, message, context} produce NIST's exact signatures (${vectors.sigGen.length} cases)`, () => {
    for (const tc of vectors.sigGen) {
      const sig = ml_dsa65.sign(hexToBytes(tc.message), hexToBytes(tc.sk), {
        extraEntropy: false, // ACVP deterministic groups: rnd = 32 zero bytes — exactly the kernel's signing mode
        context: hexToBytes(tc.context),
      });
      expect(bytesToHex(sig), `tg${tc.tgId} tc${tc.tcId}`).toBe(tc.signature.toLowerCase());
    }
  });

  it(`sigVer: our verify agrees with NIST's verdict on every case, negatives included (${vectors.sigVer.length} cases)`, () => {
    for (const tc of vectors.sigVer) {
      const ok = ml_dsa65.verify(hexToBytes(tc.signature), hexToBytes(tc.message), hexToBytes(tc.pk), {
        context: hexToBytes(tc.context),
      });
      expect(ok, `tg${tc.tgId} tc${tc.tcId} expected testPassed=${tc.testPassed}`).toBe(tc.testPassed);
    }
  });
});

describe("Signature-malleability negative — non-canonical hint encoding refuses (FIPS 204 final HintBitUnpack)", () => {
  // ML-DSA-65 (FIPS 204 Table 1): omega = 55, k = 6. The hint h is the LAST omega+k = 61 signature bytes:
  // bytes [end-61 .. end-7) hold the concatenated per-block index lists; the final k bytes are nondecreasing
  // cumulative counts. Within each block the indices MUST be strictly ascending — swapping two of them encodes the
  // SAME hint set non-canonically. A verifier missing the final-standard order check accepts the mutant.
  const OMEGA = 55, K = 6;

  it("swapping two in-block hint indices (same semantic hint set) must refuse — at the raw primitive AND the kernel verifier", async () => {
    const SEED = "42".repeat(32);
    const msg = new TextEncoder().encode("aukora-malleability-probe");
    const sigHex = await pqcSign(SEED, msg, "chainHead");
    const pub = await mlDsa65PublicKeyFromSeed(SEED);
    expect(await pqcVerify(pub, msg, sigHex, "chainHead")).toBe(true); // baseline

    const sig = hexToBytes(sigHex);
    const sigLen = PQC_SIZES.signatureBytes;
    const idxBase = sigLen - OMEGA - K; // start of the hint index area
    const cntBase = sigLen - K;         // start of the cumulative-count area
    // find a block with >= 2 hint indices and swap its first two (ascending -> out-of-order, set unchanged)
    let mutated: Uint8Array | null = null;
    let prev = 0;
    for (let block = 0; block < K; block++) {
      const upto = sig[cntBase + block];
      if (upto - prev >= 2) {
        mutated = sig.slice();
        const a = idxBase + prev, b = idxBase + prev + 1;
        [mutated[a], mutated[b]] = [mutated[b], mutated[a]];
        expect(mutated[a]).not.toBe(mutated[b]); // strictly ascending in canonical form, so the swap changed bytes
        break;
      }
      prev = upto;
    }
    expect(mutated, "no block carried >=2 hints for this fixed payload — choose a different probe message").not.toBeNull();

    // raw primitive refuses the non-canonical re-encoding…
    expect(ml_dsa65.verify(mutated!, msg, hexToBytes(pub), { context: new TextEncoder().encode("aukora-chainhead-v3") })).toBe(false);
    // …and so does the kernel verifier path (refusal, never an exception)
    expect(await pqcVerify(pub, msg, bytesToHex(mutated!), "chainHead")).toBe(false);
  });
});
