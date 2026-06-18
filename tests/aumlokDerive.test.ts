// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/**
 * B2.0b — AUMLOK identity derivation primitives (PURE, client-side only) + the three ratified PQC domains.
 * This is primitives + scaffolding ONLY: NO identity registry / manifests / ceremony / memory enforcement (B2.1+).
 * Proven here: phrase canonicalization KATs; the 7-word acronym-structure validator; phrase → Argon2id → 32-byte
 * root seed determinism (pinned KAT) + the Argon2id edge-runtime callability smoke at the proposed floor; the
 * end-to-end derived ML-DSA-65 root pubkey KAT; entropy estimation + the §15.4d floor (v14.1-alone fails, ≥300k
 * passes); dictionary-provenance drift detection (the v14.1 reference); the three new domains' cross-domain refusal;
 * and the GUARD that Argon2id is unreachable from any Convex function (the phrase never transits the server).
 * DERIVE-GRADE entropy stays BLOCKED on the vendored ≥300k dictionary (design record §3/§11).
 */
import { describe, it, expect } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { argon2id } from "@noble/hashes/argon2.js";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils.js";
import {
  ARGON2ID_PARAMS, AUMLOK_ANCHOR_LEN, AUMLOK_PHRASE_WORDS,
  canonicalizePhrase, acronymSpellsAnchor, validatePhraseStructure,
  phraseToRootSeed, phraseToRootSeedHex,
  phraseEntropyBits, meetsEntropyFloor, AUMLOK_ENTROPY_FLOOR_BITS, DERIVE_GRADE_ENTROPY,
  verifyDictionaryProvenance, AUMLOK_V14_1_PROVENANCE,
} from "../convex/aukoraAumlokDerive";
import { pqcSign, pqcVerify, mlDsa65PublicKeyFromSeed, PQC_DOMAINS, type PqcDomain } from "../convex/aukoraPqcSigner";

// A valid acronym phrase: anchor "pesada" (p,e,s,a,d,a); words 1–6 initials spell it.
const PHRASE = ["pesada", "purna", "esha", "sirin", "auma", "deva", "amira"];
const KAT_SALT = sha256(new TextEncoder().encode("aukora-aumlok-derive-v1:kat-salt")).slice(0, 16);
const SEED_KAT = "05b57d01c899aa1a0a0b8aa505b0b38748e6d525f2737d5ee5ff79c386032d97";      // Argon2id @ ARGON2ID_PARAMS
const ROOT_PUBKEY_SHA256_KAT = "7d19f3b5c1804a2cacd1972ac0caa9386e1a6ef8a4d22a0ad93a071d2be986fe"; // sha256(ml_dsa65 pubkey)

describe("B2.0b — phrase canonicalization (the KDF password spec)", () => {
  it("NFKC + lowercase + trim (leading/trailing only), joined by single space (KAT)", () => {
    expect(canonicalizePhrase(PHRASE)).toBe("pesada purna esha sirin auma deva amira");
    // messy-but-valid input (case, leading/trailing padding, trailing tab) → identical canonical form
    expect(canonicalizePhrase(["  PESADA ", "Purna", "esha\t", "  SiRiN", "auma", "DEVA", "amira  "]))
      .toBe("pesada purna esha sirin auma deva amira");
  });
  it("throws on wrong word count / non-array input (fail closed)", () => {
    expect(() => canonicalizePhrase(["one"])).toThrow("aukora_aumlok_phrase_word_count");
    expect(() => canonicalizePhrase([...PHRASE, "extra"])).toThrow("aukora_aumlok_phrase_word_count");
    expect(() => canonicalizePhrase(null as any)).toThrow("aukora_aumlok_phrase_word_count");
    expect(() => canonicalizePhrase("pesada purna esha sirin auma deva amira" as any)).toThrow("aukora_aumlok_phrase_word_count");
  });
  it("FIX #1/#2 — rejects any non-[a-z] word: digits, punctuation, internal whitespace, zero-width Unicode (index-only error)", () => {
    const sub = (i: number, val: string) => PHRASE.map((w, j) => (j === i ? val : w));
    expect(() => canonicalizePhrase(sub(1, "pur5a"))).toThrow("aukora_aumlok_word_charset:1");        // digit (error carries the INDEX, never the word)
    expect(() => canonicalizePhrase(sub(2, "es-ha"))).toThrow("aukora_aumlok_word_charset:2");        // punctuation
    expect(() => canonicalizePhrase(sub(3, "si rin"))).toThrow("aukora_aumlok_word_charset:3");       // internal whitespace (aliasing trap)
    expect(() => canonicalizePhrase(sub(4, "au" + String.fromCharCode(0x200b) + "ma"))).toThrow("aukora_aumlok_word_charset:4"); // U+200B zero-width space (NFKC-surviving, not \s)
    expect(() => canonicalizePhrase(sub(5, "dévà"))).toThrow("aukora_aumlok_word_charset:5");         // diacritics (v14.1 scope is ASCII a-z)
    // the offending word must NEVER appear in the message (secret material stays out of exceptions)
    try { canonicalizePhrase(sub(1, "pur5a")); } catch (e: any) { expect(String(e.message)).not.toContain("pur5a"); }
  });
  it("FIX #3 — rejects duplicate canonical words (exact, case-variant, and anchor-reused-as-key-word)", () => {
    // exact duplicate (count + charset OK; distinctness fails)
    expect(() => canonicalizePhrase(["alpha", "bravo", "charlie", "delta", "echo", "fox", "alpha"])).toThrow("aukora_aumlok_phrase_duplicate_word");
    // case-variant duplicate ("Bravo" and "bravo" canonicalize to the same word)
    expect(() => canonicalizePhrase(["alpha", "Bravo", "charlie", "delta", "echo", "fox", "bravo"])).toThrow("aukora_aumlok_phrase_duplicate_word");
    // anchor reused as a key word (valid acronym structure, but "pesada" appears twice) — caught by the full gate
    expect(() => validatePhraseStructure(["pesada", "pesada", "esha", "sirin", "auma", "deva", "amira"])).toThrow("aukora_aumlok_phrase_duplicate_word");
  });
});

describe("B2.0b — 7-word acronym structure", () => {
  it("accepts a valid anchor + acronym; constants are as ratified", () => {
    expect(AUMLOK_PHRASE_WORDS).toBe(7);
    expect(AUMLOK_ANCHOR_LEN).toBe(6);
    expect(acronymSpellsAnchor(PHRASE)).toBe(true);
    expect(acronymSpellsAnchor(["  Pesada", "PURNA", "Esha", "sirin", "Auma", "deva", "Amira"])).toBe(true); // case-insensitive
  });
  it("rejects: non-6-letter anchor, initials that don't spell it, wrong count, non-[a-z] anchor", () => {
    expect(acronymSpellsAnchor(["short", "s", "h", "o", "r", "t", "x"])).toBe(false);       // anchor not 6 letters
    expect(acronymSpellsAnchor(["pesada", "xurna", "esha", "sirin", "auma", "deva", "amira"])).toBe(false); // initial mismatch (x≠p)
    expect(acronymSpellsAnchor(PHRASE.slice(0, 6))).toBe(false);                             // wrong count
    expect(acronymSpellsAnchor(["pes4da", "p", "e", "s", "4", "d", "a"])).toBe(false);       // non-letter anchor
    expect(() => validatePhraseStructure(["pesada", "xurna", "esha", "sirin", "auma", "deva", "amira"])).toThrow("aukora_aumlok_acronym_mismatch");
  });
});

describe("B2.0b — DERIVE: phrase → Argon2id → 32-byte root seed (deterministic; edge-runtime callable)", () => {
  it("Argon2id is callable in this (edge-runtime) environment and yields the requested length", () => {
    const out = argon2id(new TextEncoder().encode("smoke"), KAT_SALT, { t: 1, m: 256, p: 1, dkLen: 32 });
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBe(32); // direct primitive smoke (small params for speed)
  });
  it("derives the pinned 32-byte seed at the PROPOSED floor, deterministically (KAT)", () => {
    const s1 = phraseToRootSeedHex(PHRASE, KAT_SALT);              // Argon2id @ ARGON2ID_PARAMS (64 MiB / t=2)
    const s2 = phraseToRootSeedHex(PHRASE, KAT_SALT);              // call-to-call determinism
    expect(s1).toBe(SEED_KAT);
    expect(s2).toBe(s1);
    expect(hexToBytes(s1).length).toBe(ARGON2ID_PARAMS.dkLen);
    // a different salt → a different seed (salt is bound)
    expect(phraseToRootSeedHex(PHRASE, sha256(new TextEncoder().encode("other-salt")).slice(0, 16))).not.toBe(SEED_KAT);
  }, 30_000); // 3 sequential 64-MiB Argon2id derivations (~6s) — explicit timeout so the test is robust even run in isolation
  it("the derived seed produces the pinned ML-DSA-65 root public key (end-to-end KAT)", async () => {
    const pub = await mlDsa65PublicKeyFromSeed(SEED_KAT);          // seed → ML-DSA-65 keygen (no Argon2id)
    expect(pub.length).toBe(1952 * 2);
    expect(bytesToHex(sha256(hexToBytes(pub)))).toBe(ROOT_PUBKEY_SHA256_KAT);
  });
  it("fails closed: structurally-invalid phrase and sub-16-byte salt throw (FIX #5: floor raised 8 → 16)", () => {
    expect(() => phraseToRootSeed(["pesada", "xurna", "esha", "sirin", "auma", "deva", "amira"], KAT_SALT)).toThrow("aukora_aumlok_acronym_mismatch");
    expect(() => phraseToRootSeed(PHRASE, new Uint8Array(15))).toThrow("aukora_aumlok_salt_invalid"); // 15 bytes passed the old 8-byte floor; now rejected
    expect(() => phraseToRootSeed(PHRASE, new Uint8Array(4))).toThrow("aukora_aumlok_salt_invalid");
  });
});

describe("B2.0b — entropy estimation + the §15.4d floor (DERIVE-GRADE blocked on the vendored dictionary)", () => {
  it("computes log2(anchorPool) + Σ log2(perInitial); throws on bad inputs", () => {
    // ~97-bit case (≥300k merged lexicon shape): ~30k anchors, ~12.5k words/initial
    const big = phraseEntropyBits(30000, [12500, 12500, 12500, 12500, 12500, 12500]);
    expect(big).toBeGreaterThan(90);
    // v14.1-alone shape (~166 anchors, ~39 words/initial) → ~39 bits
    const v14 = phraseEntropyBits(166, [39, 39, 39, 39, 39, 39]);
    expect(v14).toBeGreaterThan(38);
    expect(v14).toBeLessThan(41);
    expect(() => phraseEntropyBits(0, [1, 1, 1, 1, 1, 1])).toThrow("aukora_aumlok_entropy_anchorpool");
    expect(() => phraseEntropyBits(166, [39, 39, 39])).toThrow("aukora_aumlok_entropy_initials");
  });
  it("the floor REJECTS v14.1-alone (~39 bits) and ACCEPTS the expanded lexicon (~97 bits)", () => {
    expect(AUMLOK_ENTROPY_FLOOR_BITS).toBeGreaterThanOrEqual(80);
    expect(meetsEntropyFloor(phraseEntropyBits(166, [39, 39, 39, 39, 39, 39]))).toBe(false);
    expect(meetsEntropyFloor(phraseEntropyBits(30000, [12500, 12500, 12500, 12500, 12500, 12500]))).toBe(true);
    expect(meetsEntropyFloor(NaN)).toBe(false);
    expect(DERIVE_GRADE_ENTROPY).toBe("BLOCKED_ON_VENDORED_DICTIONARY"); // explicit: not derive-grade until vendored
  });
});

describe("B2.0b — dictionary provenance scaffolding (vendor-with-sha256, §15.4f)", () => {
  it("the v14.1 decision-day reference is pinned exactly", () => {
    expect(AUMLOK_V14_1_PROVENANCE.sha256).toBe("215de53e28287b43bebb771600375f4d4ebea4ca343bc6b56415be6b1c6d61f3");
    expect(AUMLOK_V14_1_PROVENANCE.sizeBytes).toBe(935768);
    expect(AUMLOK_V14_1_PROVENANCE.exportDate).toBe("2026-05-16");
  });
  it("verifies matching bytes; FAILS CLOSED on a tampered byte or wrong size (drift detection)", () => {
    const bytes = new TextEncoder().encode("hello dictionary");
    const prov = { name: "t", sha256: bytesToHex(sha256(bytes)), sizeBytes: bytes.length, exportDate: "x" };
    expect(verifyDictionaryProvenance(bytes, prov)).toBe(true);
    const tampered = bytes.slice(); tampered[0] ^= 0x01;
    expect(verifyDictionaryProvenance(tampered, prov)).toBe(false);                 // content drift
    expect(verifyDictionaryProvenance(bytes.slice(0, bytes.length - 1), prov)).toBe(false); // size drift
    expect(verifyDictionaryProvenance("not bytes" as any, prov)).toBe(false);        // type
  });
});

describe("B2.0b — the three ratified AUMLOK signing domains (cross-domain refusal)", () => {
  const SEED = "42".repeat(32);
  const MSG = new TextEncoder().encode("aumlok-domain-probe");
  const NEW: PqcDomain[] = ["aumlokManifest", "aumlokSubjectPop", "aumlokRotation"];

  it("the three domains are registered with the exact ratified labels", () => {
    expect(PQC_DOMAINS.aumlokManifest).toBe("aukora-aumlok-manifest-v1");
    expect(PQC_DOMAINS.aumlokSubjectPop).toBe("aukora-aumlok-subjectpop-v1");
    expect(PQC_DOMAINS.aumlokRotation).toBe("aukora-aumlok-rotation-v1");
  });
  it("a signature under one domain round-trips there and REFUSES under every other domain", async () => {
    const pub = await mlDsa65PublicKeyFromSeed(SEED);
    const others: PqcDomain[] = ["chainHead", "cap", "req", "delegation", "manifest"];
    for (const d of NEW) {
      const sig = await pqcSign(SEED, MSG, d);
      expect(await pqcVerify(pub, MSG, sig, d)).toBe(true);                          // own domain
      for (const o of [...NEW, ...others]) {
        if (o !== d) expect(await pqcVerify(pub, MSG, sig, o)).toBe(false);          // anti-lifting across all domains
      }
    }
  });
});

describe("B2.0b — GUARD: Argon2id / the derive path is unreachable from any Convex function", () => {
  // Read every convex/ top-level module's SOURCE (vite ?raw) and assert that none EXCEPT the derive module itself
  // imports Argon2id or the derive module. Convex functions live in these files, so this proves the phrase-derivation
  // (and the memory-hard KDF) can never run inside a Convex mutation/query/action — the phrase never transits the server.
  const sources = import.meta.glob("../convex/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>; // recursive: a future nested function file can't bypass the guard
  // The CLIENT-SIDE-ONLY modules: they may import Argon2id / the derive module because they never run server-side —
  // each is itself guard-tested to be unimportable by any Convex function (aukoraAumlokDictionary in aumlokDictionary.test.ts).
  const CLIENT_SIDE_ONLY = ["aukoraAumlokDerive.ts", "aukoraAumlokDictionary.ts"];
  it("no Convex-function module imports Argon2id or aukoraAumlokDerive", () => {
    const offenders: string[] = [];
    for (const [path, src] of Object.entries(sources)) {
      if (CLIENT_SIDE_ONLY.some((m) => path.endsWith(m))) continue; // client-side-only modules, separately guarded
      if (path.includes("_generated/")) continue; // codegen type stubs, not runtime Convex functions
      if (src.includes("@noble/hashes/argon2")) offenders.push(`${path}: imports Argon2id`);
      if (src.includes("aukoraAumlokDerive")) offenders.push(`${path}: imports the derive module`);
    }
    expect(Object.keys(sources).length).toBeGreaterThan(5); // sanity: the glob actually loaded the convex modules
    expect(offenders).toEqual([]);
  });
});
