/**
 * 24Z.26 — Hidden-Channel Canonicalization Sentinel (the boundary kernel).
 *
 * Every place an UNTRUSTED string crosses into Aukora as context / patch text / receipt text / authority-adjacent
 * material must pass THIS boundary first, so we can prove WHAT WAS ACTUALLY SEEN in human-legible canonical form.
 * Three deterministic passes + a gate + a receipt:
 *   1. NFC normalize, then scan the (post-decode) text for hidden-channel code points;
 *   2. Unicode TR39-style confusables SKELETON (documented deterministic subset) — fold look-alikes to ASCII and
 *      detect homoglyph'd AUTHORITY words ("аpply"/"αdmin") that the surface form hides;
 *   3. human-legibility gate — an authority/apply-bound artifact must be human-legible AFTER canonicalization;
 *      machine-usable-but-human-opaque text is REFUSED (the GLOSSOPETRAE "Decoupling": opacity blinds the human gate).
 * The result carries a canonicalization RECEIPT (hashes + removed categories + action) that NEVER contains the raw
 * payload. Doctrine: hidden channels are EVIDENCE, never authority. This is defensive only — no GLOSSOPETRAE
 * mechanics are ported. It does NOT claim to detect all stego; it proves what the model saw, bounded + auditable.
 */
import * as crypto from 'crypto';

export interface HiddenChannelFinding {
  kind: 'zero_width' | 'bidi_control' | 'private_use' | 'tag_char' | 'control_char' | 'homoglyph_risk' | 'format_char';
  codepoint: number;
  index: number;
}

// Invisible / default-ignorable FORMAT code points usable as covert channels. Variation selectors (the "emoji
// smuggling" class) + VS supplement + Hangul fillers are category Mn/Lo (NOT Cf), so they are enumerated here;
// the general Unicode FORMAT category (Cf — soft hyphen, ALM, deprecated format, zero-width, bidi, …) is caught
// by a \p{Cf} default-deny in scanHiddenChannels. None are needed in plain canonical text / code patches.
// 24Z.26 red-team (LOW): U+061C + U+206A-206F were missed → the \p{Cf} default-deny closes that whole class.
function isFormatChar(cp: number): boolean {
  return (cp >= 0xfe00 && cp <= 0xfe0f) ||          // variation selectors
    cp === 0x3164 || cp === 0xffa0 || cp === 0x115f || cp === 0x1160 || // Hangul fillers
    (cp >= 0xe0100 && cp <= 0xe01ef);              // variation-selector supplement
}
const CF_RE = /\p{Cf}/u; // the full Unicode FORMAT category (default-deny): 00AD, 061C, 200B-200F, 202A-202E, 2060-206F, FEFF, FFF9-FFFB, tag chars, …

// Mathematical Alphanumeric Symbols — the HOLE-FREE style blocks (bold, bold-italic, sans, sans-bold,
// sans-italic, sans-bold-italic, monospace), each 26 upper then 26 lower. Folded algorithmically so 𝗮dmin / 𝐚pply
// collapse to admin / apply. (Italic/script/fraktur/double-struck have reserved holes → not folded here; partial,
// documented coverage — detectsAllStego stays false.)
const MATH_BLOCKS: Array<[number, number]> = [
  [0x1d400, 0x41], [0x1d41a, 0x61], [0x1d468, 0x41], [0x1d482, 0x61], [0x1d5a0, 0x41], [0x1d5ba, 0x61],
  [0x1d5d4, 0x41], [0x1d5ee, 0x61], [0x1d608, 0x41], [0x1d622, 0x61], [0x1d63c, 0x41], [0x1d656, 0x61],
  [0x1d670, 0x41], [0x1d68a, 0x61],
];
function mathAlnumFold(cp: number): string | null {
  for (const [base, ascii] of MATH_BLOCKS) if (cp >= base && cp < base + 26) return String.fromCharCode(ascii + (cp - base));
  return null;
}
/** The skeleton target for a confusable code point (explicit map OR math-alphanumeric fold), else null. */
function confusableTarget(cp: number): string | null {
  return CONFUSABLES[cp] !== undefined ? CONFUSABLES[cp] : mathAlnumFold(cp);
}

// Confusable (homoglyph) code points → their ASCII skeleton. A DOCUMENTED DETERMINISTIC SUBSET of Unicode TR39
// confusables (Cyrillic + Greek look-alikes of Latin letters + a few math letters) — the classes used to smuggle
// "auth"/"apply"/"admin" past a naive ASCII keyword check. Extend as new confusables are observed.
const CONFUSABLES: Record<number, string> = {
  // Cyrillic lower
  0x0430: 'a', 0x0435: 'e', 0x043e: 'o', 0x0440: 'p', 0x0441: 'c', 0x0445: 'x', 0x0443: 'y', 0x0456: 'i', 0x0458: 'j', 0x0455: 's', 0x04bb: 'h', 0x0501: 'd', 0x043d: 'h', 0x0442: 't', 0x0432: 'v', 0x043c: 'm', 0x043a: 'k',
  // Cyrillic upper
  0x0410: 'a', 0x0415: 'e', 0x041e: 'o', 0x0420: 'p', 0x0421: 'c', 0x0425: 'x', 0x0412: 'b', 0x041d: 'h', 0x041c: 'm', 0x0422: 't', 0x041a: 'k',
  // Greek
  0x03b1: 'a', 0x03bf: 'o', 0x03c1: 'p', 0x03c5: 'u', 0x03b9: 'i', 0x03ba: 'k', 0x03bd: 'v', 0x03c7: 'x', 0x0391: 'a', 0x039f: 'o', 0x03a1: 'p', 0x0392: 'b', 0x0395: 'e',
  // Fullwidth Latin (a sample — FF41 'a' .. FF5A 'z')
  0xff41: 'a', 0xff50: 'p', 0xff4c: 'l', 0xff59: 'y', 0xff54: 't', 0xff48: 'h', 0xff55: 'u', 0xff44: 'd', 0xff4d: 'm', 0xff49: 'i', 0xff4e: 'n', 0xff52: 'r', 0xff45: 'e', 0xff53: 's', 0xff4f: 'o', 0xff47: 'g', 0xff43: 'c', 0xff4b: 'k', 0xff56: 'v',
  // 24Z.26 red-team (LOW): Latin/IPA/Cherokee/dotless look-alikes outside the Cyrillic/Greek set (e.g. ɑpply, admın, Ꭺpply)
  0x0251: 'a', 0x0131: 'i', 0x0237: 'j', 0x0261: 'g', 0x0269: 'i', 0x026a: 'i', 0x0280: 'r', 0x1d04: 'c', 0x1d0f: 'o', 0x0274: 'n', 0x1d18: 'p', 0x029c: 'h', 0x0282: 's',
  0x13aa: 'a', 0x13a0: 'd', 0x13ec: 'g', 0x13b3: 'w', 0x13de: 'l', 0x13c6: 'r', 0x13cf: 'b', 0x13ce: 's',
};

// Authority-adjacent words a homoglyph attack would try to smuggle past an ASCII check.
const AUTHORITY_WORDS = ['auth', 'apply', 'admin', 'root', 'grant', 'sudo', 'exec', 'signer', 'aumlok', 'authorize', 'production', 'live', 'permit', 'kernel'];

/** Detect hidden-channel code points (bounded scan; returns every finding). */
export function scanHiddenChannels(s: string): HiddenChannelFinding[] {
  const out: HiddenChannelFinding[] = [];
  if (typeof s !== 'string') return out;
  for (let i = 0; i < s.length; i++) {
    const cp = s.codePointAt(i)!;
    if (cp > 0xffff) i++;
    if (cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0x2060 || cp === 0xfeff) { out.push({ kind: 'zero_width', codepoint: cp, index: i }); continue; }
    if ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069) || cp === 0x200e || cp === 0x200f || cp === 0x061c) { out.push({ kind: 'bidi_control', codepoint: cp, index: i }); continue; } // incl LRM/RLM/ALM
    if (cp >= 0xe0000 && cp <= 0xe007f) { out.push({ kind: 'tag_char', codepoint: cp, index: i }); continue; }
    if ((cp >= 0xe000 && cp <= 0xf8ff) || (cp >= 0xf0000 && cp <= 0xffffd) || (cp >= 0x100000 && cp <= 0x10fffd)) { out.push({ kind: 'private_use', codepoint: cp, index: i }); continue; }
    if ((cp <= 0x1f && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) || (cp >= 0x7f && cp <= 0x9f)) { out.push({ kind: 'control_char', codepoint: cp, index: i }); continue; }
    if (isFormatChar(cp) || CF_RE.test(String.fromCodePoint(cp))) { out.push({ kind: 'format_char', codepoint: cp, index: i }); continue; } // enumerated VS + full Unicode Cf default-deny
    if (confusableTarget(cp) !== null) { out.push({ kind: 'homoglyph_risk', codepoint: cp, index: i }); continue; }
  }
  return out;
}

export interface NormalizedText { normalized: string; findings: HiddenChannelFinding[]; changedByNfc: boolean }
/** NFC-normalize (so NFD/NFC tricks collapse), then scan the NORMALIZED form. */
export function normalizeModelText(s: string): NormalizedText {
  const normalized = typeof s === 'string' ? s.normalize('NFC') : '';
  return { normalized, findings: scanHiddenChannels(normalized), changedByNfc: normalized !== s };
}

const ZERO_WIDTH = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);
const isStrippable = (cp: number) =>
  ZERO_WIDTH.has(cp) || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069) ||
  (cp >= 0xe0000 && cp <= 0xe007f) || (cp >= 0xe000 && cp <= 0xf8ff) || (cp >= 0xf0000 && cp <= 0xffffd) || (cp >= 0x100000 && cp <= 0x10fffd) ||
  ((cp <= 0x1f && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) || (cp >= 0x7f && cp <= 0x9f)) ||
  cp === 0x200e || cp === 0x200f || cp === 0x061c || isFormatChar(cp) || CF_RE.test(String.fromCodePoint(cp));

/** Fold confusables to their ASCII skeleton (explicit map + math-alphanumeric fold). Does NOT strip. */
export function confusablesSkeleton(s: string): string {
  let out = '';
  for (const ch of s) { const cp = ch.codePointAt(0)!; const t = confusableTarget(cp); out += t !== null ? t : ch; }
  return out;
}

/** AUTHORITY words that appear ONLY after un-confusing (i.e. a homoglyph hid them from an ASCII check). */
export function confusableAuthorityHits(s: string): string[] {
  const skel = confusablesSkeleton(s).toLowerCase();
  const asciiOnly = s.toLowerCase().replace(/[^\x00-\x7f]/g, '');
  return AUTHORITY_WORDS.filter((w) => skel.includes(w) && !asciiOnly.includes(w));
}

/** Canonical form for hashing/legibility: strip hidden-channel chars + fold confusables to skeleton. */
export function canonicalForm(s: string): string {
  const nfc = s.normalize('NFC');
  let stripped = '';
  for (const ch of nfc) { const cp = ch.codePointAt(0)!; if (!isStrippable(cp)) stripped += ch; }
  return confusablesSkeleton(stripped);
}

export type SentinelAction = 'allow' | 'sanitize' | 'quarantine' | 'refuse';

export interface CanonicalizationReceipt {
  schema: 'canonicalization-receipt-v0';
  boundary: string;
  rawHash: string;            // sha256(raw) — NEVER the raw text itself
  canonicalHash: string;      // sha256(canonical)
  removed: string[];          // hidden-channel categories found/removed
  flagged: string[];          // e.g. confusable_authority
  legible: boolean;           // human-legible after canonicalization?
  authorityBound: boolean;
  action: SentinelAction;
  grantsAuthority: false;
}

export interface SentinelResult { ok: boolean; action: SentinelAction; canonical?: string; receipt: CanonicalizationReceipt; reason?: string }

function sha256(s: string): string { return crypto.createHash('sha256').update(s).digest('hex'); }
const uniq = (a: string[]) => [...new Set(a)];

/**
 * Canonicalize an untrusted string at a boundary. authorityBound artifacts (patch candidates, apply/authority text)
 * must be human-legible after canonicalization → ANY hidden channel or homoglyph'd authority word ⇒ REFUSE
 * (human-opacity refusal). Non-authority boundaries SANITIZE (strip + flag) and allow with a receipt. The receipt
 * carries only hashes + categories — never the raw payload. grantsAuthority is always false.
 */
export function canonicalizeBoundary(input: string, opts: { boundary: string; authorityBound?: boolean }): SentinelResult {
  // FAIL-SAFE (Fusion GLM): authorityBound DEFAULTS to true — a caller that forgets to label a crossing gets the
  // STRICT (refuse) treatment, never the lax (silent-sanitize) one. A boundary must opt OUT of strict, explicitly.
  const authorityBound = opts.authorityBound !== false;
  const raw = typeof input === 'string' ? input : '';
  const nfc = raw.normalize('NFC');
  const findings = scanHiddenChannels(nfc);
  const confusableHits = confusableAuthorityHits(nfc);
  const canonical = canonicalForm(raw);
  const removed = uniq(findings.map((f) => f.kind));
  const flagged = confusableHits.length ? ['confusable_authority'] : [];
  // 24Z.26 red-team (MEDIUM false-positive): INVISIBLE channels (zero-width/bidi/tag/PUA/control/format) ALWAYS
  // break legibility, but a bare homoglyph code point only breaks it when it FORMS AN AUTHORITY WORD
  // (confusableHits). Otherwise legitimate Cyrillic/Greek/math text (a Russian comment) would be wrongly refused.
  const invisibleFindings = findings.filter((f) => f.kind !== 'homoglyph_risk');
  const legible = invisibleFindings.length === 0 && confusableHits.length === 0;

  let action: SentinelAction;
  if (authorityBound) action = legible ? 'allow' : 'refuse';             // authority/apply-bound must be legible
  else action = legible ? 'allow' : 'sanitize';                          // non-authority: strip + allow

  const ok = action === 'allow' || action === 'sanitize';
  const receipt: CanonicalizationReceipt = {
    schema: 'canonicalization-receipt-v0', boundary: opts.boundary, rawHash: sha256(raw), canonicalHash: sha256(canonical),
    removed, flagged, legible, authorityBound, action, grantsAuthority: false,
  };
  return { ok, action, canonical: ok ? (action === 'sanitize' ? canonical : nfc) : undefined, receipt, reason: ok ? undefined : `${opts.boundary}: refused — not human-legible after canonicalization (${[...removed, ...flagged].join(', ') || 'opaque'})` };
}

export function summarizeSentinel(): string {
  return [
    'Canonicalization Sentinel: every untrusted boundary is NFC-normalized + scanned post-decode for hidden channels',
    '(zero-width/bidi/tag/PUA/control/homoglyph) + confusables-skeleton (authority-word un-hiding). Authority/apply-bound',
    'artifacts must be human-legible after canonicalization or they are REFUSED. Each crossing yields a receipt',
    '(rawHash/canonicalHash/removed categories/action) — never the raw payload. Evidence, never authority; does NOT',
    'claim to detect all stego — it proves what the model saw in canonical form, bounded + auditable.',
  ].join(' ');
}
