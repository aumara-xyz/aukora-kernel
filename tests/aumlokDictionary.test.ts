// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/// <reference types="vite/client" />
/**
 * B2.3c — AUMLOK dictionary + entropy qualification MACHINERY (PURE, client-side). Proves the scaffold is correct and
 * deterministic: provenance fail-closed, the frozen canonicalization, the CSPRNG-only machine-generator (no user-word
 * path), and the precise per-anchor entropy + floor. It DOES NOT unblock the "phrase cannot be guessed" claim — no
 * legally-clean ≥300k dictionary is vendored (`AUMLOK_PRODUCTION_DICTIONARY === null`), and the tests pin that v14.1-
 * scale dictionaries FAIL the floor while the math reaches the floor only GIVEN real ≥300k counts (synthetic-count
 * test, not a real dictionary). The claim stays BLOCKED until a real clean source is vendored.
 */
import { describe, it, expect } from "vitest";
import {
  AUMLOK_PRODUCTION_DICTIONARY, AUMLOK_CANONICALIZATION_SPEC, verifyDictionaryBytes,
  parseDictionary, perAnchorEntropyBits, entropyReport, generatorMinEntropyBits, generateAcronymPhrase, csprngUniformInt,
} from "../convex/aukoraAumlokDictionary";
import { acronymSpellsAnchor, AUMLOK_ENTROPY_FLOOR_BITS } from "../convex/aukoraAumlokDerive";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

// Deterministic synthetic dictionary (NOT a real wordlist — only to exercise the machinery): `perInitial` distinct
// 5-letter words per initial a–z + `anchorCount` distinct 6-letter anchor words (initials cycled so buckets stay even).
const toBase26 = (n: number, len: number) => { let s = ""; for (let i = 0; i < len; i++) { s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); } return s; };
function synthDict(perInitial: number, anchorCount: number): string {
  const lines: string[] = [];
  for (let li = 0; li < 26; li++) { const L = String.fromCharCode(97 + li); for (let j = 0; j < perInitial; j++) lines.push(L + toBase26(j, 4)); }
  for (let a = 0; a < anchorCount; a++) lines.push(String.fromCharCode(97 + (a % 26)) + toBase26(Math.floor(a / 26), 5));
  return lines.join("\n");
}
// A deterministic (NON-crypto) RNG for reproducibility tests only — real use is csprngUniformInt.
function lcg(seed: number): (n: number) => number { let s = seed >>> 0; return (n: number) => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s % n; }; }

describe("B2.3c — claim status: the production dictionary is NOT vendored; 'unguessable' stays BLOCKED", () => {
  it("AUMLOK_PRODUCTION_DICTIONARY is null (no unpinned/local file in the identity path)", () => {
    expect(AUMLOK_PRODUCTION_DICTIONARY).toBeNull();
  });
});

describe("B2.3c — dictionary provenance (fail-closed)", () => {
  it("verifies matching bytes; FAILS on content / size / type mismatch", () => {
    const bytes = new TextEncoder().encode("alpha\nbravo\ncharlie\n");
    const prov = { name: "t", source: "synthetic", license: "test", version: "0", sizeBytes: bytes.length, sha256: bytesToHex(sha256(bytes)) };
    expect(verifyDictionaryBytes(bytes, prov)).toBe(true);
    const tampered = bytes.slice(); tampered[0] ^= 0x01;
    expect(verifyDictionaryBytes(tampered, prov)).toBe(false);                       // content drift
    expect(verifyDictionaryBytes(bytes.slice(0, bytes.length - 1), prov)).toBe(false); // size drift
    expect(verifyDictionaryBytes("alpha\nbravo\ncharlie\n" as any, prov)).toBe(false); // type
  });
});

describe("B2.3c — frozen canonicalization (no silent aliases)", () => {
  it("spec is recorded; a non-canonical line FAILS CLOSED; visibly-different aliases dedup to one word", () => {
    expect(AUMLOK_CANONICALIZATION_SPEC).toContain("[a-z]-only");
    expect(() => parseDictionary("alpha\nbra-vo\ncharlie")).toThrow("aumlok_dict_word_noncanonical:1"); // hyphen rejected (index only)
    expect(() => parseDictionary("alpha\ncafé\ncharlie")).toThrow("aumlok_dict_word_noncanonical");      // diacritic rejected
    expect(() => parseDictionary("alpha\nbra vo\ncharlie")).toThrow("aumlok_dict_word_noncanonical");     // internal whitespace
    // "Alpha", " alpha ", "alpha" all canonicalize to "alpha" → ONE word, no alias, no double count
    const p = parseDictionary("Alpha\n alpha \nALPHA\nbravo");
    expect(p.words.sort()).toEqual(["alpha", "bravo"]);
  });
});

describe("B2.3c — per-anchor entropy (precise; distinct-word falling factorial)", () => {
  it("is reproducible and accounts for repeated anchor letters", () => {
    const distinct = perAnchorEntropyBits(30000, "abcdef", () => 12000); // 6 distinct initials
    expect(distinct).toBeCloseTo(Math.log2(30000) + 6 * Math.log2(12000), 6);
    expect(perAnchorEntropyBits(30000, "abcdef", () => 12000)).toBe(distinct); // reproducible
    // repeated initial 'a' (×2) uses the falling factorial n·(n-1), NOT n²
    const rep = perAnchorEntropyBits(100, "aabcde", () => 50);
    expect(rep).toBeCloseTo(Math.log2(100) + Math.log2(50) + Math.log2(49) + 4 * Math.log2(50), 6);
    // a bucket that can't supply the required distinct words → unusable
    expect(perAnchorEntropyBits(100, "aaaaaa", () => 3)).toBe(-Infinity); // need 6 distinct 'a', only 3 exist
  });
});

describe("B2.3c — entropy floor: v14.1-scale FAILS; the floor unblocks only at real ≥300k counts", () => {
  it("a v14.1-scale dictionary does NOT meet the 80-bit floor (the honest current state)", () => {
    const r = entropyReport(parseDictionary(synthDict(39, 166)), 80); // ~v14.1 shape
    expect(r.maxBits).toBeLessThan(80);
    expect(r.meetsFloor).toBe(0);
    expect(r.belowFloor).toBe(r.usableAnchors);
  });
  it("the MATH reaches the floor ONLY GIVEN real ≥300k-scale counts (synthetic counts — NOT a real dictionary)", () => {
    expect(perAnchorEntropyBits(30000, "abcdef", () => 12000)).toBeGreaterThanOrEqual(AUMLOK_ENTROPY_FLOOR_BITS);
    // i.e. the floor is achievable in principle, but ONLY a really-vendored dictionary with these counts could claim it.
  });
  it("generatorMinEntropyBits is the HONEST realized gate: <= the per-anchor upper bound, and -Infinity when nothing is eligible", () => {
    const dict = parseDictionary(synthDict(40, 50));
    const realized = generatorMinEntropyBits(dict, 30);
    const report = entropyReport(dict, 30);
    expect(realized).toBeGreaterThanOrEqual(30);            // every generated phrase clears the (low) floor used here
    expect(realized).toBeLessThanOrEqual(report.maxBits);    // realized never EXCEEDS the per-anchor upper bound
    // the eventual "unguessable" claim gates on THIS, not report.maxBits — at v14.1 scale + an 80-bit floor, nothing qualifies
    expect(generatorMinEntropyBits(parseDictionary(synthDict(39, 166)), 80)).toBe(-Infinity);
  });
});

describe("B2.3c — machine-only generator (CSPRNG, no user words, rejects weak anchors)", () => {
  it("produces a valid 7-word acronym phrase from a floor-meeting dictionary, deterministic under an injected RNG", () => {
    const dict = parseDictionary(synthDict(40, 50));
    const p1 = generateAcronymPhrase(dict, { floorBits: 30, rng: lcg(7) });
    const p2 = generateAcronymPhrase(dict, { floorBits: 30, rng: lcg(7) });
    expect(p1).toEqual(p2);                              // reproducible under a fixed RNG
    expect(p1.length).toBe(7);
    expect(acronymSpellsAnchor(p1)).toBe(true);          // word0 6-letter anchor; words 1–6 initials spell it
    expect(new Set(p1).size).toBe(7);                    // all distinct
  });
  it("REJECTS weak anchors: a sub-floor dictionary cannot mint a floor-meeting phrase", () => {
    const dict = parseDictionary(synthDict(40, 50));
    expect(() => generateAcronymPhrase(dict, { floorBits: 80, rng: lcg(1) })).toThrow("aumlok_dict_no_anchor_meets_floor");
  });
  it("is MACHINE-only — the generator signature has NO words/free-text parameter (no user-chosen root entropy)", () => {
    const src = import.meta.glob("../convex/aukoraAumlokDictionary.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const code = Object.values(src)[0];
    const params = code.match(/generateAcronymPhrase\(([^)]*)\)/)![1].toLowerCase(); // the PARAMETER list only (not the fn name)
    for (const banned of ["words", "phrase", "word:", "userword", "mnemonic"]) expect(params.includes(banned)).toBe(false);
    expect(params.includes("parsed")).toBe(true); // takes a parsed dictionary + opts, never words
  });
});

describe("B2.3c — CSPRNG sampler (rejection sampling; no modulo bias)", () => {
  it("csprngUniformInt returns in-range ints and is ~uniform over many draws (statistical sampler test)", () => {
    expect(csprngUniformInt(1)).toBe(0);
    expect(() => csprngUniformInt(0)).toThrow("aumlok_dict_rng_range");
    const N = 12000, K = 10, counts = new Array(K).fill(0);
    for (let i = 0; i < N; i++) { const v = csprngUniformInt(K); expect(v >= 0 && v < K).toBe(true); counts[v]++; }
    const expected = N / K;
    for (const c of counts) expect(Math.abs(c - expected) / expected).toBeLessThan(0.25); // loose ±25% — catches gross bias, not flaky
  });
  it("the default generator RNG IS the CSPRNG (uses crypto.getRandomValues with rejection, not modulo/Math.random)", () => {
    const src = import.meta.glob("../convex/aukoraAumlokDictionary.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const code = Object.values(src)[0];
    expect(code.includes("opts.rng ?? csprngUniformInt")).toBe(true);
    expect(code.includes("crypto.getRandomValues")).toBe(true);
    expect(code.includes("Math.random")).toBe(false); // banned (and unavailable in the env)
  });
});

describe("B2.3c — structural absence: the dictionary/generator is client-side only", () => {
  it("no Convex function module imports aukoraAumlokDictionary (generation never runs server-side)", () => {
    const sources = import.meta.glob("../convex/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const offenders: string[] = [];
    for (const [path, src] of Object.entries(sources)) {
      if (path.endsWith("aukoraAumlokDictionary.ts")) continue; // the module itself
      if (path.includes("_generated/")) continue; // codegen type stubs, not runtime Convex functions
      if (src.includes("aukoraAumlokDictionary")) offenders.push(path);
    }
    expect(Object.keys(sources).length).toBeGreaterThan(5);
    expect(offenders).toEqual([]);
  });
});
