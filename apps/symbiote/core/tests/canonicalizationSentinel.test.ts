import { describe, it, expect } from 'vitest';
import { canonicalizeBoundary, confusablesSkeleton, confusableAuthorityHits, canonicalForm, scanHiddenChannels } from '../src/canonicalizationSentinel';

// 24Z.26 — the boundary kernel. Fixtures from explicit CODE POINTS (not invisible literals).
const cp = (n: number) => String.fromCodePoint(n);

describe('24Z.26: confusables skeleton + authority-word un-hiding (Unicode TR39 subset)', () => {
  it('folds Cyrillic/Greek look-alikes to their ASCII skeleton', () => {
    expect(confusablesSkeleton(`${cp(0x0430)}pply`)).toBe('apply');       // Cyrillic а
    expect(confusablesSkeleton(`${cp(0x03b1)}dmin`)).toBe('admin');       // Greek α
    expect(confusablesSkeleton('apply')).toBe('apply');                   // ASCII untouched
  });
  it('detects an AUTHORITY word that only appears AFTER un-confusing (homoglyph attack)', () => {
    expect(confusableAuthorityHits(`${cp(0x0430)}pply`)).toContain('apply'); // Cyrillic а hides "apply"
    expect(confusableAuthorityHits('please apply')).toEqual([]);             // honest ASCII "apply" is not a hit
    expect(confusableAuthorityHits('hello world')).toEqual([]);
  });
});

describe('24Z.26: format/variation-selector invisible vectors are detected (emoji-smuggling class)', () => {
  it('detects variation selectors, soft hyphen, Mongolian vowel sep, interlinear annotation, VS supplement', () => {
    for (const n of [0xfe00, 0xfe0f, 0x00ad, 0x180e, 0xfff9, 0x2061, 0xe0100]) {
      expect(scanHiddenChannels(`a${cp(n)}b`).some((f) => f.kind === 'format_char'), `U+${n.toString(16)}`).toBe(true);
    }
  });
  it('refuses an authority-bound payload hidden in a variation-selector run', () => {
    const r = canonicalizeBoundary(`apply${cp(0xfe01)}${cp(0xfe02)}${cp(0xfe03)}`, { boundary: 'opencode_output', authorityBound: true });
    expect(r.ok).toBe(false);
    expect(r.receipt.removed).toContain('format_char');
  });
});

describe('24Z.26 red-team fixes: format default-deny, broadened homoglyph fold, NO over-refusal', () => {
  it('(LOW) catches the previously-missed Cf format chars (Arabic Letter Mark, deprecated 206A-206F, LRM/RLM)', () => {
    for (const n of [0x061c, 0x206a, 0x206f, 0x200e, 0x200f]) {
      const f = scanHiddenChannels(`a${cp(n)}b`);
      expect(f.length, `U+${n.toString(16)}`).toBeGreaterThan(0);
    }
    expect(canonicalizeBoundary(`apply${cp(0x061c)}now`, { boundary: 'opencode_output', authorityBound: true }).ok).toBe(false);
  });
  it('(LOW) broadened fold catches out-of-map homoglyph authority words (Latin-alpha, dotless, Cherokee, math-bold)', () => {
    expect(confusableAuthorityHits(`${cp(0x0251)}pply`)).toContain('apply');   // ɑ Latin alpha
    expect(confusableAuthorityHits(`adm${cp(0x0131)}n`)).toContain('admin');   // ı dotless i
    expect(confusableAuthorityHits(`${cp(0x1d5ee)}dmin`)).toContain('admin');  // 𝗮 math sans-bold a
    for (const w of [`${cp(0x0251)}pply now`, `the ${cp(0x1d5ee)}dmin`]) {
      expect(canonicalizeBoundary(w, { boundary: 'opencode_output', authorityBound: true }).ok, w).toBe(false);
    }
  });
  it('(MEDIUM) does NOT over-refuse legitimate non-Latin text with no authority word (false-positive fix)', () => {
    // a legitimate Russian code comment — confusable code points present, but NO authority word formed → ALLOW
    expect(canonicalizeBoundary('// автор: Иван. привет мир', { boundary: 'opencode_output', authorityBound: true }).ok).toBe(true);
    expect(canonicalizeBoundary('const σ = 0.5; // Greek sigma label', { boundary: 'opencode_output', authorityBound: true }).ok).toBe(true);
    expect(canonicalizeBoundary('日本語 中文 한국어 — // i18n', { boundary: 'opencode_output', authorityBound: true }).ok).toBe(true);
  });
});

describe('24Z.26: canonicalizeBoundary — authority-bound is fail-closed; non-authority sanitizes', () => {
  it('clean authority-bound text → allow + a receipt with hashes (no raw payload)', () => {
    const r = canonicalizeBoundary('export const x = 1', { boundary: 'opencode_output', authorityBound: true });
    expect(r.ok).toBe(true);
    expect(r.action).toBe('allow');
    expect(r.receipt.legible).toBe(true);
    expect(r.receipt.removed).toEqual([]);
    expect(r.receipt.grantsAuthority).toBe(false);
    expect(r.receipt.rawHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.receipt.canonicalHash).toMatch(/^[0-9a-f]{64}$/);
    // the receipt NEVER carries the raw payload, only hashes/categories
    expect(JSON.stringify(r.receipt)).not.toContain('export const x');
  });
  it('REFUSES authority-bound text with a hidden channel (human-opacity refusal)', () => {
    const r = canonicalizeBoundary(`apply${cp(0x200b)}now`, { boundary: 'opencode_output', authorityBound: true });
    expect(r.ok).toBe(false);
    expect(r.action).toBe('refuse');
    expect(r.receipt.removed).toContain('zero_width');
    expect(r.canonical).toBeUndefined();
  });
  it('REFUSES authority-bound text with a homoglyph-hidden authority word', () => {
    const r = canonicalizeBoundary(`${cp(0x0430)}pply = true`, { boundary: 'opencode_output', authorityBound: true });
    expect(r.ok).toBe(false);
    expect(r.receipt.flagged).toContain('confusable_authority');
  });
  it('NON-authority text sanitizes (strips + allows) with a receipt', () => {
    const r = canonicalizeBoundary(`note${cp(0x200b)}here`, { boundary: 'attachment', authorityBound: false });
    expect(r.ok).toBe(true);
    expect(r.action).toBe('sanitize');
    expect(r.canonical).toBe('notehere');                  // zero-width stripped
    expect(scanHiddenChannels(r.canonical!)).toEqual([]);  // canonical is clean
  });
  it('does NOT false-positive on legitimate accents / normal text (authority-bound)', () => {
    expect(canonicalizeBoundary('café résumé naïve', { boundary: 'opencode_output', authorityBound: true }).ok).toBe(true);
    expect(canonicalizeBoundary('const total = a + b; // ok', { boundary: 'opencode_output', authorityBound: true }).ok).toBe(true);
  });
  it('FAIL-SAFE: authorityBound defaults to true — an unlabeled crossing gets the strict (refuse) treatment', () => {
    const r = canonicalizeBoundary(`x${cp(0x200b)}y`, { boundary: 'unlabeled' }); // authorityBound omitted
    expect(r.receipt.authorityBound).toBe(true);
    expect(r.ok).toBe(false);               // refused, not silently sanitized
    expect(r.action).toBe('refuse');
  });
  it('canonicalForm strips hidden chars + folds confusables; hash differs when changed', () => {
    expect(canonicalForm(`a${cp(0x200b)}${cp(0x0430)}b`)).toBe('aab');  // strip zero-width, fold Cyrillic а→a
    const a = canonicalizeBoundary(`x${cp(0x200b)}y`, { boundary: 'b', authorityBound: false });
    expect(a.receipt.rawHash).not.toBe(a.receipt.canonicalHash);        // canonical differs from raw
  });
});
