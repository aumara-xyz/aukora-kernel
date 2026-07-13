// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/// <reference types="vite/client" />
/**
 * B3.4 — ML-KEM-768 (FIPS 203 final) deterministic regression corpus.
 *
 * This checks the pinned dependency against Aukora-generated known inputs and
 * outputs, including implicit rejection and malformed encapsulation keys. The
 * fixture is ACVP-shaped for test readability but is NOT NIST test data,
 * independent corroboration, or an ACVP/CAVP certification claim.
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

describe("ML-KEM-768 FIPS 203 deterministic implementation regression corpus", () => {
  it("the vendored set is ML-KEM-768 and non-empty in every group", () => {
    expect(V.parameterSet).toBe("ML-KEM-768");
    expect([V.keyGenAFT.length, V.encapsulationAFT.length, V.decapsulationVAL.length, V.encapsulationKeyCheck.length].every((n) => n > 0)).toBe(true);
  });

  it("keyGen-AFT-shaped: keygen(d‖z) reproduces pinned (ek, dk)", () => {
    for (const t of V.keyGenAFT) {
      const kp = ml_kem768.keygen(hexToBytes(t.d + t.z));
      expect({ tc: t.tcId, ek: hx(kp.publicKey), dk: hx(kp.secretKey) }).toEqual({ tc: t.tcId, ek: t.ek, dk: t.dk });
    }
  });

  it("encapsulation-AFT-shaped: encapsulate(ek, m) reproduces pinned (c, K)", () => {
    for (const t of V.encapsulationAFT) {
      const e = ml_kem768.encapsulate(hexToBytes(t.ek), hexToBytes(t.m));
      expect({ tc: t.tcId, c: hx(e.cipherText), k: hx(e.sharedSecret) }).toEqual({ tc: t.tcId, c: t.c, k: t.k });
    }
  });

  it("decapsulation-VAL-shaped: decapsulate(c, dk) reproduces pinned K, including implicit rejection", () => {
    expect(V.decapsulationVAL.some((t) => /modif/i.test(t.reason))).toBe(true); // an implicit-rejection case is present
    for (const t of V.decapsulationVAL) {
      expect({ tc: t.tcId, k: hx(ml_kem768.decapsulate(hexToBytes(t.c), hexToBytes(t.dk))) }).toEqual({ tc: t.tcId, k: t.k });
    }
  });

  it("encapsulation key checks cover length refusal plus a derived valid-length modulus refusal", () => {
    // The generated negative cases are encoded at 1600 bytes
    // (oversized coefficients do not pack into 12 bits → a longer byte string), so `ml_kem768` rejects them on LENGTH,
    // BEFORE the modulus check — still a correct FIPS 203 input-validation rejection. This asserts noble's accept/reject
    // The assertion covers the fixture verdict, not which internal check fires.
    let validEk: string | undefined;
    for (const t of V.encapsulationKeyCheck) {
      const tryEncap = () => ml_kem768.encapsulate(hexToBytes(t.ek), new Uint8Array(32));
      if (t.testPassed) { expect(t.ek.length).toBe(2368); expect(tryEncap).not.toThrow(); validEk = t.ek; } // valid (1184 B) → accept
      else expect(tryEncap).toThrow();                                                                       // invalid → reject (on length here)
    }
    // (b) Derived valid-length modulus-check negative. The fixture negatives are over-length (above), so to exercise
    // noble's actual modulus check (FIPS 203 §7.2: ByteEncode12∘ByteDecode12 ≠ ek) we force a valid fixture key's first 12-bit
    // coefficient to 0xFFF (4095 ≥ q=3329), keeping the 1184-byte length.
    const ek = hexToBytes(validEk!);
    const bad = ek.slice(); bad[0] = 0xff; bad[1] = (bad[1] & 0xf0) | 0x0f;
    expect(() => ml_kem768.encapsulate(bad, new Uint8Array(32))).toThrow(/modulus/); // noble's modulus check fires + rejects
  });
});
