// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/**
 * B2.3c — AUMLOK DICTIONARY + ENTROPY QUALIFICATION (PURE, CLIENT-SIDE ONLY — like aukoraAumlokDerive).
 *
 * This is the MACHINERY that qualifies the phrase-strength claim: dictionary provenance verification, the FROZEN
 * canonicalization parse, the CSPRNG-only 7-word acronym generator, and the per-anchor entropy math + floor. It runs
 * client-side only (a guard test forbids any Convex function importing it) — the phrase/seed never transit the server
 * (B2.3b).
 *
 * SCAFFOLD STATUS (B2.3c): the production legally-clean ≥300k dictionary is **NOT vendored** — no clean source with
 * verifiable provenance was available, and faking one is forbidden. So `AUMLOK_PRODUCTION_DICTIONARY` is `null` and the
 * **"a machine-generated phrase cannot be guessed" claim REMAINS BLOCKED.** This module proves the machinery is correct
 * and deterministic; the claim unblocks only when a real clean dictionary is vendored here with a pinned provenance
 * record AND its entropy report shows the floor met. Nothing in the identity path may depend on an unpinned local file.
 *
 * Generation is MACHINE-ONLY: there is no API that accepts user-chosen words as root identity entropy (a structural
 * guarantee — `generateAcronymPhrase` takes a dictionary + an entropy floor + a uniform-int RNG, never words). Default
 * RNG is a CSPRNG with rejection sampling (no modulo bias — the "non-uniform sampler silently collapses entropy" risk).
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { AUMLOK_ANCHOR_LEN, AUMLOK_PHRASE_WORDS, AUMLOK_ENTROPY_FLOOR_BITS, canonicalizePhrase, acronymSpellsAnchor } from "./aukoraAumlokDerive";

/** The FROZEN canonicalization spec (B2.3c ruling on the §15.4g question). A dictionary/phrase word is canonical iff,
 *  after NFKC + lowercase + trim, it matches /^[a-z]+$/ — ASCII a–z ONLY. REJECTED: diacritics (é, ü …), punctuation,
 *  hyphens, apostrophes, internal/zero-width whitespace, digits. NOT folded: plurals/stems (cat ≠ cats — distinct
 *  words). Native Auma terms are already ASCII (the v14.1 canon excludes c/q/x and carries no diacritics). The
 *  no-fold rule is deliberate: folding (e.g. diacritic-strip) would create SILENT ALIASES — two visibly-different
 *  words collapsing to one key-word — so v1 rejects rather than folds. Any future widening may only ADD members. */
export const AUMLOK_CANONICALIZATION_SPEC = "nfkc+lowercase+trim+[a-z]-only;no-fold;no-dup" as const;
const CANON_RE = /^[a-z]+$/;
function canonWord(raw: string): string { return String(raw).normalize("NFKC").toLowerCase().trim(); }

// ── Dictionary provenance (the §15.4f vendor-with-sha256 rule, extended with source/license/version) ──
export type DictionaryProvenance = { name: string; source: string; license: string; version: string; sizeBytes: number; sha256: string };
/** PRODUCTION dictionary: NOT vendored in B2.3c (the "unguessable phrase" claim is BLOCKED until a legally-clean
 *  ≥300k source is vendored here). `null` so nothing in the identity path can depend on an unpinned/local-only file. */
export const AUMLOK_PRODUCTION_DICTIONARY: DictionaryProvenance | null = null;

/** Verify vendored dictionary bytes against a pinned provenance record (size + sha256). FALSE on any mismatch — a
 *  silently-edited / swapped / wrong-type file fails closed before it can seed any generation. */
export function verifyDictionaryBytes(bytes: Uint8Array, expected: DictionaryProvenance): boolean {
  if (!(bytes instanceof Uint8Array)) return false;
  if (!expected || bytes.length !== expected.sizeBytes) return false;
  return bytesToHex(sha256(bytes)) === String(expected.sha256).toLowerCase();
}

// ── Parse (the FROZEN canonicalization, fail-closed) ──
export type ParsedDictionary = { words: string[]; bucket: Map<string, string[]>; byInitial: Map<string, number>; anchors: string[] };
/** Parse a newline-delimited word list into deduped per-initial buckets + the anchor pool (6-letter words). Each word
 *  must be canonical (CANON_RE) — a non-canonical line FAILS CLOSED (no silent drop that would change the committed
 *  set). Dedup is by canonical form, so two visibly-different lines that canonicalize identically collapse to ONE word
 *  (and a duplicate is not double-counted) — there are no aliases. */
export function parseDictionary(text: string): ParsedDictionary {
  if (typeof text !== "string") throw new Error("aumlok_dict_input_invalid");
  const seen = new Set<string>();
  const bucket = new Map<string, string[]>();
  const anchors: string[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    const w = canonWord(lines[i]);
    if (!CANON_RE.test(w)) throw new Error(`aumlok_dict_word_noncanonical:${i}`); // index only — fail closed, no silent drop
    if (seen.has(w)) continue; // canonical dedup (no double count, no alias)
    seen.add(w);
    const init = w[0];
    if (!bucket.has(init)) bucket.set(init, []);
    bucket.get(init)!.push(w);
    if (w.length === AUMLOK_ANCHOR_LEN) anchors.push(w);
  }
  const byInitial = new Map<string, number>();
  for (const [k, arr] of bucket) byInitial.set(k, arr.length);
  return { words: [...seen], bucket, byInitial, anchors };
}

// ── Per-anchor entropy (PRECISE: distinct-word sampling via the falling factorial, so repeated anchor letters are not
//    over-counted — addresses the design-record §14 distinctness note). bits = log2(#anchors) + Σ over distinct anchor
//    letters L (appearing k times) of log2(n·(n-1)···(n-k+1)) where n = #words for L. Returns -Infinity if a bucket
//    cannot supply the required distinct words (anchor unusable). The anchor-vs-words distinctness correction is
//    negligible at scale and ignored (a tiny over-estimate, stated in evidence). ──
export function perAnchorEntropyBits(anchorPoolSize: number, anchor: string, countOf: (letter: string) => number): number {
  if (!Number.isInteger(anchorPoolSize) || anchorPoolSize < 1 || typeof anchor !== "string" || anchor.length !== AUMLOK_ANCHOR_LEN) return -Infinity;
  let bits = Math.log2(anchorPoolSize);
  const groups = new Map<string, number>();
  for (const ch of anchor) groups.set(ch, (groups.get(ch) ?? 0) + 1);
  for (const [letter, k] of groups) {
    const n = countOf(letter);
    if (!Number.isInteger(n) || n < k) return -Infinity; // cannot draw k distinct words for this initial
    for (let j = 0; j < k; j++) bits += Math.log2(n - j);
  }
  return bits;
}

/** Entropy report over every anchor in a parsed dictionary: min/max/median (of usable anchors) + how many meet the
 *  floor. The published claim is ALWAYS scoped: "for a phrase MACHINE-sampled from THIS pinned dictionary under the
 *  frozen canonicalization." */
export function entropyReport(parsed: ParsedDictionary, floorBits: number = AUMLOK_ENTROPY_FLOOR_BITS): {
  anchorCount: number; usableAnchors: number; minBits: number; maxBits: number; medianBits: number; floorBits: number; meetsFloor: number; belowFloor: number;
} {
  const countOf = (L: string) => parsed.byInitial.get(L) ?? 0;
  const ent = parsed.anchors.map((a) => perAnchorEntropyBits(parsed.anchors.length, a, countOf)).filter((e) => Number.isFinite(e)).sort((a, b) => a - b);
  const meetsFloor = ent.filter((e) => e >= floorBits).length;
  return {
    anchorCount: parsed.anchors.length, usableAnchors: ent.length,
    minBits: ent[0] ?? -Infinity, maxBits: ent[ent.length - 1] ?? -Infinity, medianBits: ent.length ? ent[Math.floor(ent.length / 2)] : -Infinity,
    floorBits, meetsFloor, belowFloor: ent.length - meetsFloor,
  };
}

/** The generator's TRUE realized min-entropy = log2(#eligible anchors) + the MINIMUM word-fill bits over the eligible
 *  anchors (word-fill = the per-anchor term WITHOUT the anchor-selection log2). This is the number the eventual
 *  "unguessable" claim MUST gate on — NOT `entropyReport().maxBits` (a per-anchor UPPER bound that credits the full
 *  anchor pool for selection while the generator only samples eligible anchors). At production scale word-fill alone
 *  ≈ floor, so nearly all anchors are eligible and realized ≈ per-anchor; this function makes the gap explicit and
 *  honest at any scale. Returns -Infinity if no anchor is eligible. */
export function generatorMinEntropyBits(parsed: ParsedDictionary, floorBits: number = AUMLOK_ENTROPY_FLOOR_BITS): number {
  const countOf = (L: string) => parsed.byInitial.get(L) ?? 0;
  const wordFillBits = (anchor: string): number => {
    let bits = 0;
    const groups = new Map<string, number>();
    for (const ch of anchor) groups.set(ch, (groups.get(ch) ?? 0) + 1);
    for (const [letter, k] of groups) { const n = countOf(letter); if (!Number.isInteger(n) || n < k) return -Infinity; for (let j = 0; j < k; j++) bits += Math.log2(n - j); }
    return bits;
  };
  const eligible = parsed.anchors.filter((a) => perAnchorEntropyBits(parsed.anchors.length, a, countOf) >= floorBits); // SAME filter the generator uses
  if (eligible.length === 0) return -Infinity;
  return Math.log2(eligible.length) + Math.min(...eligible.map(wordFillBits)); // realized: uniform over eligible × worst-case fill
}

// ── CSPRNG-only generation (machine-only; NO user-word parameter) ──
export type UniformInt = (n: number) => number; // a uniform integer in [0, n)
/** Uniform int in [0,n) via rejection sampling over a 32-bit window — NO modulo bias (a biased sampler silently
 *  collapses entropy: the top crypto risk of the DERIVE path). Real-use default; tests inject a deterministic RNG. */
export function csprngUniformInt(n: number): number {
  if (!Number.isInteger(n) || n <= 0) throw new Error("aumlok_dict_rng_range");
  if (n === 1) return 0;
  const limit = Math.floor(0x1_0000_0000 / n) * n; // largest multiple of n that fits in 32 bits
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

/** Generate ONE valid 7-word acronym phrase: word 0 a 6-letter anchor MEETING the entropy floor (weak anchors are
 *  rejected), words 1–6 distinct words whose initials spell the anchor. MACHINE-ONLY — the only inputs are the parsed
 *  dictionary, the floor, and a uniform-int RNG; there is NO words/free-text parameter, so user-chosen words can never
 *  become root identity entropy. The result is re-validated through the frozen canonicalization + acronym structure. */
export function generateAcronymPhrase(parsed: ParsedDictionary, opts: { floorBits?: number; rng?: UniformInt } = {}): string[] {
  const floorBits = opts.floorBits ?? AUMLOK_ENTROPY_FLOOR_BITS;
  const rng = opts.rng ?? csprngUniformInt;
  const countOf = (L: string) => parsed.byInitial.get(L) ?? 0;
  const eligible = parsed.anchors.filter((a) => perAnchorEntropyBits(parsed.anchors.length, a, countOf) >= floorBits);
  if (eligible.length === 0) throw new Error("aumlok_dict_no_anchor_meets_floor"); // a sub-floor dictionary cannot mint a floor-meeting phrase
  const anchor = eligible[rng(eligible.length)];
  const used = new Set<string>([anchor]);
  const words = [anchor];
  for (const letter of anchor) {
    const arr = parsed.bucket.get(letter) ?? [];
    let pick: string | null = null;
    for (let tries = 0; tries < 10_000; tries++) { // distinct sampling (no word repeats across the phrase)
      const cand = arr[rng(arr.length)];
      if (!used.has(cand)) { pick = cand; break; }
    }
    if (pick === null) throw new Error("aumlok_dict_bucket_exhausted"); // bucket cannot supply a distinct word
    used.add(pick);
    words.push(pick);
  }
  if (words.length !== AUMLOK_PHRASE_WORDS || !acronymSpellsAnchor(words)) throw new Error("aumlok_dict_generated_invalid"); // structural self-check
  canonicalizePhrase(words); // re-validate through the frozen canonicalization (charset + distinctness) — throws on any drift
  return words;
}
