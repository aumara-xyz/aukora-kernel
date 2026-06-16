// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/**
 * B1 increment 2 — tests for the centralized PQC signing adapter (convex/aukoraPqcSigner.ts), per the tests-first
 * law. The adapter is the SINGLE place ML-DSA-65 is touched: deterministic signing (extraEntropy:false) and seeded
 * keygen are enforced there (proven below with a throwing-randomness probe, not asserted by comment), and callers
 * name immutable string DOMAINS instead of holding context bytes — so there is nothing for in-process code to
 * mutate or mint (adversarial review B1.2). Sign fails CLOSED by throwing (a misconfigured signer must error);
 * verify fails CLOSED by returning false (malformed input is a refusal, never an exception). The differential
 * tests assert adapter output is byte-identical to the raw library under every domain — no shared pinned literal
 * to drift; the canonical KAT pin lives in pqcSmoke.test.ts.
 */
import { describe, it, expect } from "vitest";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import {
  PQC_ALG_ML_DSA_65,
  PQC_DOMAINS,
  PQC_SIZES,
  pqcAlgInfo,
  mlDsa65PublicKeyFromSeed,
  pqcSign,
  pqcVerify,
  type PqcDomain,
} from "../convex/aukoraPqcSigner";

const hex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
const SEED = "42".repeat(32); // disposable test seed — same fixtures as pqcSmoke so the suites cross-check
const OTHER_SEED = "43".repeat(32);
const MSG = new TextEncoder().encode("aukora-pqc-smoke:fixed-payload-v1");
// ALL registered domains (derived, not hardcoded) so new domains auto-enter the cross-domain refusal matrix and the
// differential KATs — closes old→new AND new→old without a per-domain edit (review B2.0b fix #4).
const DOMAINS = Object.keys(PQC_DOMAINS) as PqcDomain[];

describe("aukoraPqcSigner — key derivation (always seeded, fail-closed)", () => {
  it("derives a deterministic ML-DSA-65 public key from a 64-hex seed (exact size, lowercase out, case-tolerant in)", async () => {
    const a = await mlDsa65PublicKeyFromSeed(SEED);
    const b = await mlDsa65PublicKeyFromSeed(SEED);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]+$/); // canonical lowercase out
    expect(a.length).toBe(PQC_SIZES.publicKeyBytes * 2); // 3904 hex chars
    expect(await mlDsa65PublicKeyFromSeed(SEED.toUpperCase())).toBe(a); // seed input is operator config: case-normalized
  });

  it("THROWS aukora_pqc_seed_invalid on malformed seeds (fail closed — misconfiguration must error)", async () => {
    for (const bad of ["", "42", "42".repeat(31), "42".repeat(33), "zz".repeat(32), SEED.slice(0, 63) + "g"]) {
      await expect(mlDsa65PublicKeyFromSeed(bad)).rejects.toThrow("aukora_pqc_seed_invalid");
      await expect(pqcSign(bad, MSG, "chainHead")).rejects.toThrow("aukora_pqc_seed_invalid");
    }
  });
});

describe("aukoraPqcSigner — deterministic signing, centralized", () => {
  it("two signs of one payload are byte-identical (the reproducible-evidence law lives at this chokepoint)", async () => {
    const s1 = await pqcSign(SEED, MSG, "chainHead");
    const s2 = await pqcSign(SEED, MSG, "chainHead");
    expect(s1).toBe(s2);
    expect(s1.length).toBe(PQC_SIZES.signatureBytes * 2); // 6618 hex chars
  });

  it("DIFFERENTIAL: adapter output is byte-identical to the raw library under EVERY domain (zero divergence)", async () => {
    const { secretKey } = ml_dsa65.keygen(new Uint8Array(32).fill(0x42));
    for (const d of DOMAINS) {
      const raw = ml_dsa65.sign(MSG, secretKey, { extraEntropy: false, context: new TextEncoder().encode(PQC_DOMAINS[d]) });
      expect(await pqcSign(SEED, MSG, d)).toBe(hex(raw));
    }
  });

  it("round-trips under every domain", async () => {
    const pub = await mlDsa65PublicKeyFromSeed(SEED);
    for (const d of DOMAINS) {
      expect(await pqcVerify(pub, MSG, await pqcSign(SEED, MSG, d), d)).toBe(true);
    }
  });

  it("never reaches platform randomness: all adapter ops succeed with getRandomValues stubbed to THROW", async () => {
    const c: any = globalThis.crypto;
    const orig = c.getRandomValues;
    const stub = () => { throw new Error("randomness_reached"); };
    try { c.getRandomValues = stub; } catch { /* fall through to defineProperty */ }
    if (c.getRandomValues !== stub) Object.defineProperty(c, "getRandomValues", { value: stub, configurable: true, writable: true });
    try {
      expect(globalThis.crypto.getRandomValues).toBe(stub); // the probe is armed
      expect(() => ml_dsa65.keygen()).toThrow(); // sanity leg: SEEDLESS keygen DOES reach randomness — the probe detects the guarded surface
      const pub = await mlDsa65PublicKeyFromSeed(SEED); // seeded keygen: no randomness
      const sig = await pqcSign(SEED, MSG, "chainHead"); // deterministic sign: no randomness
      expect(await pqcVerify(pub, MSG, sig, "chainHead")).toBe(true); // verify: no randomness
    } finally {
      try { c.getRandomValues = orig; } catch { Object.defineProperty(c, "getRandomValues", { value: orig, configurable: true, writable: true }); }
    }
  });
});

describe("aukoraPqcSigner — named-domain separation (anti-lifting; callers never hold context bytes)", () => {
  it("every cross-domain pair fails closed (a cap sig never verifies as a chainhead sig, etc.)", async () => {
    const pub = await mlDsa65PublicKeyFromSeed(SEED);
    for (let i = 0; i < DOMAINS.length; i++) {
      const sig = await pqcSign(SEED, MSG, DOMAINS[i]);
      for (let j = 0; j < DOMAINS.length; j++) {
        expect(await pqcVerify(pub, MSG, sig, DOMAINS[j])).toBe(i === j);
      }
    }
  });

  it("REFUSES unknown domains — including raw labels, prototype keys, and non-strings", async () => {
    const pub = await mlDsa65PublicKeyFromSeed(SEED);
    const sig = await pqcSign(SEED, MSG, "chainHead");
    for (const bad of ["aukora-chainhead-v3", "chainhead", "CAP", "", "toString", "__proto__", "constructor", 42 as any, null as any, undefined as any]) {
      await expect(pqcSign(SEED, MSG, bad as PqcDomain)).rejects.toThrow("aukora_pqc_context_unregistered");
      expect(await pqcVerify(pub, MSG, sig, bad as PqcDomain)).toBe(false); // verify refuses, never throws
    }
  });

  it("the domain table is frozen immutable strings within the FIPS 204 255-byte bound", () => {
    expect(Object.isFrozen(PQC_DOMAINS)).toBe(true);
    for (const label of Object.values(PQC_DOMAINS)) {
      expect(typeof label).toBe("string"); // strings are immutable — nothing to mutate in place
      const n = new TextEncoder().encode(label).length;
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThanOrEqual(255);
    }
    expect(() => { (PQC_DOMAINS as any).chainHead = "evil"; }).toThrow(); // strict-mode write to frozen object
    expect(() => { (PQC_DOMAINS as any).extra = "x"; }).toThrow();
  });
});

describe("aukoraPqcSigner — fail-closed verification (refusals, never exceptions)", () => {
  it("returns false on tampered signature, tampered message, wrong key, wrong signer", async () => {
    const pub = await mlDsa65PublicKeyFromSeed(SEED);
    const sig = await pqcSign(SEED, MSG, "chainHead");
    const tamperedSig = (sig[0] === "0" ? "1" : "0") + sig.slice(1);
    expect(await pqcVerify(pub, MSG, tamperedSig, "chainHead")).toBe(false);
    const tamperedMsg = MSG.slice(); tamperedMsg[0] ^= 0x01;
    expect(await pqcVerify(pub, tamperedMsg, sig, "chainHead")).toBe(false);
    const otherPub = await mlDsa65PublicKeyFromSeed(OTHER_SEED);
    expect(await pqcVerify(otherPub, MSG, sig, "chainHead")).toBe(false);
    const otherSig = await pqcSign(OTHER_SEED, MSG, "chainHead");
    expect(await pqcVerify(pub, MSG, otherSig, "chainHead")).toBe(false);
  });

  it("returns false (never throws) on structurally malformed input — length + canonical-case pre-checks before any crypto", async () => {
    const pub = await mlDsa65PublicKeyFromSeed(SEED);
    const sig = await pqcSign(SEED, MSG, "chainHead");
    const cases: Array<[any, any]> = [
      ["", sig],                          // empty pubkey
      [pub.slice(0, 100), sig],           // truncated pubkey
      [pub + "00", sig],                  // oversized pubkey
      [pub, ""],                          // empty sig
      [pub, sig.slice(0, 6616)],          // truncated sig
      [pub, sig + "00"],                  // oversized sig
      [pub, "zz" + sig.slice(2)],         // non-hex sig
      ["zz" + pub.slice(2), sig],         // non-hex pubkey
      [pub.toUpperCase(), sig],           // NON-CANONICAL case: exactly one accepted representation per artifact
      [pub, sig.toUpperCase()],           // NON-CANONICAL case
      [null, sig], [pub, null], [42, sig], [pub, 42], [undefined, undefined], // type confusion
    ];
    for (const [p, s] of cases) {
      expect(await pqcVerify(p as any, MSG, s as any, "chainHead")).toBe(false);
    }
  });
});

describe("aukoraPqcSigner — algorithm-id table (the anti-downgrade nucleus for SignedChainHeadV3)", () => {
  it("0x04 maps to frozen ml-dsa-65 parameters; unknown/non-integer alg-ids THROW (no silent acceptance)", () => {
    expect(PQC_ALG_ML_DSA_65).toBe(0x04);
    const info = pqcAlgInfo(PQC_ALG_ML_DSA_65);
    expect(info.name).toBe("ml-dsa-65");
    expect(info.headAlg).toBe("ml-dsa-65-chainhead-v3");
    expect(info.signatureBytes).toBe(3309);
    expect(info.publicKeyBytes).toBe(1952);
    expect(Object.isFrozen(info)).toBe(true); // entries are frozen — a caller cannot retune the table
    for (const unknown of [0x00, 0x01, 0x02, 0x03, 0x05, 0x06, 0xff, -1, 4.5, NaN, "toString" as any, "4" as any]) {
      expect(() => pqcAlgInfo(unknown as number)).toThrow("aukora_pqc_alg_unknown");
    }
  });
});
