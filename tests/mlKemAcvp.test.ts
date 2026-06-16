// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/// <reference types="vite/client" />
/**
 * B3.4 DOOR 5 — ML-KEM-768 (FIPS 203 FINAL) NIST ACVP VECTOR CORROBORATION.
 *
 * Confirms `@noble/post-quantum@0.6.1` `ml_kem768` reproduces NIST's PUBLISHED known answers for the FIPS-203-FINAL
 * ML-KEM-768 parameter set: keyGen-AFT (d‖z → ek, dk), encapsulation-AFT (ek, m → c, K), decapsulation-VAL (dk, c → K,
 * INCLUDING the implicit-rejection "modified ciphertext" case), and the encapsulation-key check (NIST accept/reject
 * verdict; plus a DERIVED valid-length modulus-check rejection — see R1 note in that test).
 *
 * IMPORTANT — this is **vector corroboration, NOT an ACVP lab certification.** It proves our pinned library matches
 * NIST's published outputs on a vendored subset; it is not a formal CAVP/ACVP certificate.
 *
 * Vectors: `tests/vectors/mlkem768-acvp.json`, extracted from the NIST ACVP-Server FIPS-203 vector sets
 * (github.com/usnistgov/ACVP-Server — a US Government work, not subject to domestic copyright). The full source files'
 * SHA-256 are pinned in that JSON's `files` block.
 *
 * NOTE (FIPS 203 IPD vs FINAL): the widely-used C2SP/CCTV vectors implement the FIPS 203 *draft* (i,j-switched) K-PKE
 * keyGen — their keyGen output does NOT match a FINAL implementation. `ml_kem768` is FIPS 203 FINAL and matches the NIST
 * ACVP FINAL vectors here; CCTV would FALSELY fail keyGen. That is why these vectors come from NIST ACVP, not CCTV.
 */
import { describe, it, expect } from "vitest";
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils.js";

// vendored JSON, loaded as raw text (the proven in-repo pattern) then parsed — keeps the edge-runtime happy.
const raw = import.meta.glob("./vectors/mlkem768-acvp.json", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const V = JSON.parse(Object.values(raw)[0]) as {
  parameterSet: string;
  keyGenAFT: { tcId: number; d: string; z: string; ek: string; dk: string }[];
  encapsulationAFT: { tcId: number; ek: string; m: string; c: string; k: string }[];
  decapsulationVAL: { tcId: number; dk: string; c: string; k: string; reason: string }[];
  encapsulationKeyCheck: { tcId: number; ek: string; testPassed: boolean; reason: string }[];
};
const hx = (b: Uint8Array) => bytesToHex(b);

describe("B3.4 DOOR 5 — ML-KEM-768 NIST ACVP (FIPS 203 FINAL) vector corroboration (NOT lab certification)", () => {
  it("the vendored set is ML-KEM-768 and non-empty in every group", () => {
    expect(V.parameterSet).toBe("ML-KEM-768");
    expect([V.keyGenAFT.length, V.encapsulationAFT.length, V.decapsulationVAL.length, V.encapsulationKeyCheck.length].every((n) => n > 0)).toBe(true);
  });

  it("keyGen-AFT: keygen(d‖z) reproduces NIST's (ek, dk)", () => {
    for (const t of V.keyGenAFT) {
      const kp = ml_kem768.keygen(hexToBytes(t.d + t.z));
      expect({ tc: t.tcId, ek: hx(kp.publicKey), dk: hx(kp.secretKey) }).toEqual({ tc: t.tcId, ek: t.ek, dk: t.dk });
    }
  });

  it("encapsulation-AFT: encapsulate(ek, m) reproduces NIST's (c, K)", () => {
    for (const t of V.encapsulationAFT) {
      const e = ml_kem768.encapsulate(hexToBytes(t.ek), hexToBytes(t.m));
      expect({ tc: t.tcId, c: hx(e.cipherText), k: hx(e.sharedSecret) }).toEqual({ tc: t.tcId, c: t.c, k: t.k });
    }
  });

  it("decapsulation-VAL: decapsulate(c, dk) reproduces NIST's K — incl. the implicit-rejection (modified ciphertext) case", () => {
    expect(V.decapsulationVAL.some((t) => /modif/i.test(t.reason))).toBe(true); // an implicit-rejection case is present
    for (const t of V.decapsulationVAL) {
      expect({ tc: t.tcId, k: hx(ml_kem768.decapsulate(hexToBytes(t.c), hexToBytes(t.dk))) }).toEqual({ tc: t.tcId, k: t.k });
    }
  });

  it("encapsulation key check: NIST accept/reject verdict match, PLUS a derived valid-length modulus-check rejection", () => {
    // (a) NIST verdict match. R1 (Fable): NIST's ML-KEM-768 encapsulationKeyCheck NEGATIVES are encoded at 1600 bytes
    // (oversized coefficients do not pack into 12 bits → a longer byte string), so `ml_kem768` rejects them on LENGTH,
    // BEFORE the modulus check — still a correct FIPS 203 input-validation rejection. This asserts noble's accept/reject
    // VERDICT matches NIST's testPassed, NOT that a specific internal check fires.
    let validEk: string | undefined;
    for (const t of V.encapsulationKeyCheck) {
      const tryEncap = () => ml_kem768.encapsulate(hexToBytes(t.ek), new Uint8Array(32));
      if (t.testPassed) { expect(t.ek.length).toBe(2368); expect(tryEncap).not.toThrow(); validEk = t.ek; } // valid (1184 B) → accept
      else expect(tryEncap).toThrow();                                                                       // invalid → reject (on length here)
    }
    // (b) DERIVED valid-LENGTH modulus-check negative. The NIST negatives are over-length (above), so to exercise noble's
    // ACTUAL modulus check (FIPS 203 §7.2: ByteEncode12∘ByteDecode12 ≠ ek) we force a NIST VALID ek's first 12-bit
    // coefficient to 0xFFF (4095 ≥ q=3329), keeping the 1184-byte length. DERIVED from a NIST vector, not a raw NIST case.
    const ek = hexToBytes(validEk!);
    const bad = ek.slice(); bad[0] = 0xff; bad[1] = (bad[1] & 0xf0) | 0x0f;
    expect(() => ml_kem768.encapsulate(bad, new Uint8Array(32))).toThrow(/modulus/); // noble's modulus check fires + rejects
  });
});
