// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/**
 * B1 increment 1 — PQC DEPENDENCY SMOKE (no kernel code touched yet). Proves @noble/post-quantum@0.6.1 (exact-pinned)
 * delivers, IN THIS SUITE'S edge-runtime environment, every property the B1 design depends on
 * (canon/AUKORA_PQC_LIBRARY_DECISION.md): exact FIPS 204/203 sizes, deterministic keygen-from-seed, deterministic
 * signing (extraEntropy:false) with byte-reproducibility, fail-closed verification (tamper / truncation / context
 * mismatch), FIPS 204 context-string domain separation, and ML-KEM-768 round-trip. The pinned known-answer hash makes
 * any future library bump that changes signature encoding a LOUD failure, never a silent drift.
 *
 * Seeds below are documented disposable test constants — never real keys.
 */
import { describe, it, expect } from "vitest";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { sha256 } from "@noble/hashes/sha2.js"; // explicit .js subpath — the only form @noble/hashes v2 exports

const hex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
const SEED32 = new Uint8Array(32).fill(0x42); // disposable ML-DSA test seed
const SEED64 = new Uint8Array(64).fill(0x42); // disposable ML-KEM test seed (KEM requires 64 bytes)
const MSG = new TextEncoder().encode("aukora-pqc-smoke:fixed-payload-v1");
const CTX_CHAINHEAD = new TextEncoder().encode("aukora-chainhead-v3"); // the V3 domain-separation context (bytes, <255)
const CTX_OTHER = new TextEncoder().encode("aukora-cap-v3");

// Known-answer regression anchor: SHA-256 of the deterministic ML-DSA-65 signature of MSG under SEED32 with
// CTX_CHAINHEAD, computed at the moment of pinning 0.6.1. A library bump that changes sig encoding MUST trip this.
const PINNED_SIG_SHA256 = "7f1fb551a5c1a06653695bbfd44662c9dc418b7f8ce4a8dd21ac1e37da77d1bb";

describe("B1 PQC dependency smoke — ML-DSA-65 (FIPS 204)", () => {
  it("keygen from a 32-byte seed is deterministic with exact FIPS 204 sizes", () => {
    const a = ml_dsa65.keygen(SEED32);
    const b = ml_dsa65.keygen(SEED32);
    expect(a.publicKey.length).toBe(1952);
    expect(a.secretKey.length).toBe(4032);
    expect(hex(a.publicKey)).toBe(hex(b.publicKey)); // same seed -> same keys (the project's seed-env contract)
    expect(hex(a.secretKey)).toBe(hex(b.secretKey));
  });

  it("deterministic signing (extraEntropy:false) is byte-reproducible at exact size and verifies", () => {
    const { publicKey, secretKey } = ml_dsa65.keygen(SEED32);
    const s1 = ml_dsa65.sign(MSG, secretKey, { extraEntropy: false, context: CTX_CHAINHEAD });
    const s2 = ml_dsa65.sign(MSG, secretKey, { extraEntropy: false, context: CTX_CHAINHEAD });
    expect(s1.length).toBe(3309);
    expect(hex(s1)).toBe(hex(s2)); // the reproducible-seeded-evidence law depends on this
    expect(ml_dsa65.verify(s1, MSG, publicKey, { context: CTX_CHAINHEAD })).toBe(true);
  });

  it("pinned known-answer: sig hash matches the value recorded when 0.6.1 was pinned", () => {
    const { secretKey } = ml_dsa65.keygen(SEED32);
    const sig = ml_dsa65.sign(MSG, secretKey, { extraEntropy: false, context: CTX_CHAINHEAD });
    expect(hex(sha256(sig))).toBe(PINNED_SIG_SHA256);
  });

  it("DEFAULT signing is hedged (randomized) — documents why extraEntropy:false must be pinned at the chokepoint", () => {
    const { publicKey, secretKey } = ml_dsa65.keygen(SEED32);
    const s1 = ml_dsa65.sign(MSG, secretKey, { context: CTX_CHAINHEAD });
    const s2 = ml_dsa65.sign(MSG, secretKey, { context: CTX_CHAINHEAD });
    expect(hex(s1)).not.toBe(hex(s2)); // hedged: differs per call; both still verify
    expect(ml_dsa65.verify(s1, MSG, publicKey, { context: CTX_CHAINHEAD })).toBe(true);
    expect(ml_dsa65.verify(s2, MSG, publicKey, { context: CTX_CHAINHEAD })).toBe(true);
  });

  it("verification fails closed: tampered sig, truncated sig, tampered message, wrong key", () => {
    const { publicKey, secretKey } = ml_dsa65.keygen(SEED32);
    const sig = ml_dsa65.sign(MSG, secretKey, { extraEntropy: false, context: CTX_CHAINHEAD });
    const tampered = sig.slice(); tampered[0] ^= 0x01;
    expect(ml_dsa65.verify(tampered, MSG, publicKey, { context: CTX_CHAINHEAD })).toBe(false);
    const verifyTruncated = () => ml_dsa65.verify(sig.slice(0, 3308), MSG, publicKey, { context: CTX_CHAINHEAD });
    expect(verifyTruncated() === false || (() => { try { verifyTruncated(); return false; } catch { return true; } })()).toBe(true); // false OR throw — never true
    const msg2 = MSG.slice(); msg2[0] ^= 0x01;
    expect(ml_dsa65.verify(sig, msg2, publicKey, { context: CTX_CHAINHEAD })).toBe(false);
    const other = ml_dsa65.keygen(new Uint8Array(32).fill(0x43));
    expect(ml_dsa65.verify(sig, MSG, other.publicKey, { context: CTX_CHAINHEAD })).toBe(false);
  });

  it("FIPS 204 context-string domain separation fails closed on mismatch (the anti-lifting property)", () => {
    const { publicKey, secretKey } = ml_dsa65.keygen(SEED32);
    const sig = ml_dsa65.sign(MSG, secretKey, { extraEntropy: false, context: CTX_CHAINHEAD });
    expect(ml_dsa65.verify(sig, MSG, publicKey, { context: CTX_CHAINHEAD })).toBe(true);  // same context
    expect(ml_dsa65.verify(sig, MSG, publicKey, { context: CTX_OTHER })).toBe(false);     // a cap-context verifier rejects a chainhead sig
    expect(ml_dsa65.verify(sig, MSG, publicKey)).toBe(false);                              // absent context rejects
  });
});

describe("B1 PQC dependency smoke — ML-KEM-768 (FIPS 203; channel lane is DESIGNED, params decided)", () => {
  it("keygen-from-64-byte-seed, exact sizes, encapsulate/decapsulate round-trip agrees", () => {
    const { publicKey, secretKey } = ml_kem768.keygen(SEED64);
    expect(publicKey.length).toBe(1184);
    expect(secretKey.length).toBe(2400);
    const { cipherText, sharedSecret } = ml_kem768.encapsulate(publicKey);
    expect(cipherText.length).toBe(1088);
    expect(sharedSecret.length).toBe(32);
    const recovered = ml_kem768.decapsulate(cipherText, secretKey);
    expect(hex(recovered)).toBe(hex(sharedSecret));
  });

  it("decapsulating a tampered ciphertext yields a DIFFERENT shared secret (implicit rejection), never a crash", () => {
    const { publicKey, secretKey } = ml_kem768.keygen(SEED64);
    const { cipherText, sharedSecret } = ml_kem768.encapsulate(publicKey);
    const bad = cipherText.slice(); bad[0] ^= 0x01;
    const recovered = ml_kem768.decapsulate(bad, secretKey); // FIPS 203 implicit rejection: random-looking, not equal
    expect(hex(recovered)).not.toBe(hex(sharedSecret));
  });
});
