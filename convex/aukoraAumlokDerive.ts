// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/**
 * AUKORA AUMLOK — identity derivation primitives (B2.0b). PURE, CLIENT-SIDE ONLY.
 *
 * These helpers turn a sovereign 7-word acronym phrase into the root identity key seed (the DERIVE path, Peter's
 * §15.4 ruling). They MUST NEVER run inside a Convex mutation, and the phrase MUST NEVER transit a Convex function —
 * a GUARD TEST (tests/aumlokDerive.test.ts) statically asserts that no Convex-function module imports this file or
 * Argon2id. This module lives in convex/ only to share the repo's pure-crypto convention; it is never imported by a
 * kernel function.
 *
 * SCOPE (B2.0b — primitives only; NO identity registry / manifests / ceremony / memory enforcement, those are
 * B2.1–B2.4): canonicalization, the 7-word acronym-structure validator, phrase → Argon2id → 32-byte root seed,
 * entropy estimation, and dictionary-provenance scaffolding. **DERIVE-GRADE entropy is BLOCKED** until the ≥300k
 * merged dictionary is vendored (§3/§11/§15.4) — v14.1 alone is ~39.5 realistic bits.
 *
 * ARCHITECTURE (Peter §15.4, DESIGNED): DERIVE preferred. 7 words; word 0 is the six-letter anchor; words 1–6
 * initials spell the anchor; the FULL canonical 7-word phrase is the KDF password. Argon2id slows guessing but adds
 * ZERO entropy — strength comes from the expanded dictionary + the per-anchor floor (≥80–90 bits). ML-DSA-65 only,
 * no hybrid. Design record: canon/AUKORA_IDENTITY_ROOT_DESIGN.md.
 *
 * ENTROPY SCOPE: the entropy estimates here assume UNIFORM MACHINE GENERATION of phrases. User-authored phrases are
 * NOT derive-grade and MUST NEVER seed a root identity (B2.1+ enforces this structurally — the generator takes no
 * caller wordlist; this module's validator only RE-VALIDATES structure, it never mints). And the "ask the user for
 * 3 of the 7 words" idea can only ever be LOCAL on-device human-presence UX — never sent to a server (that is the
 * Wave1/Wave2 per-word-disclosure class B2 killed for cause).
 *
 * PURE: @noble/hashes argon2id + sha256 only; no Convex, no Node APIs, NO platform randomness on the derive path
 * (the salt is a caller argument). Argon2id is memory-hard and synchronous.
 */
import { argon2id } from "@noble/hashes/argon2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export type Argon2idParams = { m: number; t: number; p: number; dkLen: number };
/** PROPOSED Argon2id floor (Peter §15.4e — subject to the browser wall-time measurement, for which NO harness exists
 *  yet; edge-runtime numbers are indicative only). m=65536 KiB (64 MiB) / t=2 / p=1 exceeds the OWASP Argon2id
 *  minimums; t may rise to 3 once browser wall-time is measured. dkLen=32 = the ML-DSA-65 seed length. */
export const ARGON2ID_PARAMS: Argon2idParams = { m: 65536, t: 2, p: 1, dkLen: 32 };

export const AUMLOK_ANCHOR_LEN = 6;     // word 0 is a six-letter anchor
export const AUMLOK_PHRASE_WORDS = 7;   // 1 anchor + 6 acronym words

const LETTERS_ONLY = /^[a-z]+$/; // every canonicalized word must be pure ASCII lowercase letters (v14.1 scope)

/** NFKC + lowercase + trim each of exactly 7 words. Internal whitespace is NOT collapsed — it is left intact so the
 *  charset check rejects it, which closes the whitespace-aliasing class (two different arrays can never collapse to
 *  the same password). THROWS on a wrong word count / non-array. */
function normalizedWords(words: string[]): string[] {
  if (!Array.isArray(words) || words.length !== AUMLOK_PHRASE_WORDS) throw new Error(`aukora_aumlok_phrase_word_count:${(words as unknown[])?.length}`);
  return words.map((w) => String(w).normalize("NFKC").toLowerCase().trim());
}

/** Canonicalize a 7-word phrase to the EXACT KDF password string, joined by a single U+0020. FAILS CLOSED on:
 *  wrong count; any word not matching /^[a-z]+$/ (rejects digits, punctuation, internal AND zero-width/invisible
 *  whitespace, diacritics — the silent-identity-loss traps); and duplicate canonical words (exact, case-variant, or
 *  the anchor reused as a key word). NOTE (open canonicalization sub-decision, §15.4g — ratify BEFORE the dictionary
 *  is frozen and any identity is minted): the English-merge charset/diacritic/plural extension may only ever ADD
 *  members to [a-z]; Auma words carry no diacritics. */
export function canonicalizePhrase(words: string[]): string {
  const c = normalizedWords(words);
  // INDEX-ONLY error (never the word itself): secret phrase material must NEVER appear in an exception message,
  // which can be logged or surfaced. The position is enough to act on; the offending word is not disclosed.
  for (let i = 0; i < c.length; i++) if (!LETTERS_ONLY.test(c[i])) throw new Error(`aukora_aumlok_word_charset:${i}`);
  if (new Set(c).size !== c.length) throw new Error("aukora_aumlok_phrase_duplicate_word"); // exact/case-variant dup OR anchor reused
  return c.join(" ");
}

/** True iff the phrase obeys the acronym structure: word 0 is a 6-letter [a-z] anchor and words 1–6 are [a-z] words
 *  whose first letters spell it. Operates on the canonicalized words so case/whitespace cannot smuggle a mismatch. */
export function acronymSpellsAnchor(words: string[]): boolean {
  let c: string[];
  try { c = normalizedWords(words); } catch { return false; }
  const anchor = c[0];
  if (anchor.length !== AUMLOK_ANCHOR_LEN || !LETTERS_ONLY.test(anchor)) return false;
  for (let i = 0; i < AUMLOK_ANCHOR_LEN; i++) {
    const w = c[i + 1];
    if (!w || !LETTERS_ONLY.test(w) || w[0] !== anchor[i]) return false;
  }
  return true;
}

/** Validate structure; THROW on violation (fail closed at the generator/validator boundary). Covers count, per-word
 *  charset, duplicate words (via canonicalizePhrase), and the acronym structure. */
export function validatePhraseStructure(words: string[]): void {
  canonicalizePhrase(words); // count + per-word [a-z] charset + distinctness (throws)
  if (!acronymSpellsAnchor(words)) throw new Error("aukora_aumlok_acronym_mismatch");
}

/** DERIVE: canonical phrase + caller-supplied salt → Argon2id → 32-byte root seed. PURE; memory-hard; NEVER call
 *  from a Convex mutation (guard-tested). Salt management (per-user uniqueness vs reproducibility) is a B2.1 ceremony
 *  concern — here the salt is an explicit argument. Returns the raw 32-byte seed (feed to ml_dsa65.keygen). */
export function phraseToRootSeed(words: string[], salt: Uint8Array, params: Argon2idParams = ARGON2ID_PARAMS): Uint8Array {
  validatePhraseStructure(words);
  if (!(salt instanceof Uint8Array) || salt.length < 16) throw new Error("aukora_aumlok_salt_invalid"); // RFC 9106 recommends >= 16-byte salt
  const enc = new TextEncoder();
  return argon2id(enc.encode(canonicalizePhrase(words)), salt, { t: params.t, m: params.m, p: params.p, dkLen: params.dkLen });
}
export function phraseToRootSeedHex(words: string[], salt: Uint8Array, params: Argon2idParams = ARGON2ID_PARAMS): string {
  return bytesToHex(phraseToRootSeed(words, salt, params));
}

// ── Entropy estimation (§15.4d floor). v14.1-alone is ~39.5 realistic bits; DERIVE-GRADE is BLOCKED until a ≥300k
//    merged dictionary is vendored (§3/§11). The generator REJECTS anchors below the floor. ──
export const DERIVE_GRADE_ENTROPY = "BLOCKED_ON_VENDORED_DICTIONARY" as const;
export const AUMLOK_ENTROPY_FLOOR_BITS = 80; // §15.4d target floor (80–90)

/** Bits of entropy for ONE generated phrase: log2(anchorPoolSize) + Σ log2(wordsAvailablePerInitial[i]) over the 6
 *  acronym positions. Pure arithmetic — the input counts come from the ratified dictionary, per-anchor (§15.4). */
export function phraseEntropyBits(anchorPoolSize: number, perInitialWordCounts: number[]): number {
  if (!Number.isInteger(anchorPoolSize) || anchorPoolSize < 1) throw new Error("aukora_aumlok_entropy_anchorpool");
  if (!Array.isArray(perInitialWordCounts) || perInitialWordCounts.length !== AUMLOK_ANCHOR_LEN) throw new Error("aukora_aumlok_entropy_initials");
  let bits = Math.log2(anchorPoolSize);
  for (const c of perInitialWordCounts) {
    if (!Number.isInteger(c) || c < 1) throw new Error(`aukora_aumlok_entropy_count:${c}`);
    bits += Math.log2(c);
  }
  return bits;
}
export function meetsEntropyFloor(bits: number, floor: number = AUMLOK_ENTROPY_FLOOR_BITS): boolean {
  return Number.isFinite(bits) && bits >= floor;
}

// ── Dictionary provenance scaffolding (§15.4f vendor-with-sha256 rule). NO dictionary file ships in B2.0b — only the
//    verifier + the v14.1 reference, so when B2.0b/B2.1 vendors a dictionary, silent drift fails closed. ──
export type DictionaryProvenance = { name: string; sha256: string; sizeBytes: number; exportDate: string };
/** The EXACT v14.1 file Peter ruled on (decision-day iCloud copy) — the drift-detection reference. v14.1 is the
 *  canon source-of-truth but is NOT derive-grade alone (~39.5 bits); the ≥300k merged dictionary is still required. */
export const AUMLOK_V14_1_PROVENANCE: DictionaryProvenance = Object.freeze({
  name: "auma-canon-v14.1.json",
  sha256: "215de53e28287b43bebb771600375f4d4ebea4ca343bc6b56415be6b1c6d61f3",
  sizeBytes: 935768,
  exportDate: "2026-05-16",
});

/** Verify vendored dictionary bytes against a pinned provenance record (size + sha256). FALSE on any mismatch — so a
 *  silently-edited or swapped dictionary file fails closed before it can be used for phrase generation. */
export function verifyDictionaryProvenance(bytes: Uint8Array, expected: DictionaryProvenance): boolean {
  if (!(bytes instanceof Uint8Array)) return false;
  if (bytes.length !== expected.sizeBytes) return false;
  return bytesToHex(sha256(bytes)) === expected.sha256.toLowerCase();
}
