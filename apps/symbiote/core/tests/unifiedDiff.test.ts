// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff, applyUnifiedDiff, diffStats } from '../src/unifiedDiff';

// A helper so the tests read as literal file bytes, not escaped noise. Lines are joined with '\n' and a
// trailing newline is added only when `trailing` is true — matching how real files differ on their final byte.
function file(lines: string[], trailing = true): string {
  if (lines.length === 0) return trailing ? '\n' : '';
  return lines.join('\n') + (trailing ? '\n' : '');
}

describe('parseUnifiedDiff: happy path', () => {
  it('parses a single hunk with context/add/remove and skips ---/+++ headers', () => {
    const diff = [
      '--- a/foo.txt',
      '+++ b/foo.txt',
      '@@ -1,3 +1,3 @@',
      ' line one',
      '-line two',
      '+LINE TWO',
      ' line three',
    ].join('\n') + '\n';
    const r = parseUnifiedDiff(diff);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hunks).toHaveLength(1);
    const h = r.hunks[0];
    expect(h).toMatchObject({ oldStart: 1, oldLen: 3, newStart: 1, newLen: 3 });
    expect(h.lines.map((l) => l.marker)).toEqual([' ', '-', '+', ' ']);
  });

  it('parses multiple hunks', () => {
    const diff = [
      '@@ -1,1 +1,1 @@',
      '-a',
      '+A',
      '@@ -3,1 +3,1 @@',
      '-c',
      '+C',
    ].join('\n');
    const r = parseUnifiedDiff(diff);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hunks).toHaveLength(2);
  });

  it('an empty (or whitespace-only) diff is the legitimate no-op case: zero hunks, ok', () => {
    expect(parseUnifiedDiff('')).toEqual({ ok: true, hunks: [] });
    expect(parseUnifiedDiff('   \n  ')).toEqual({ ok: true, hunks: [] });
  });

  it('defaults an omitted hunk length to 1', () => {
    const r = parseUnifiedDiff('@@ -2 +2 @@\n-b\n+B\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hunks[0]).toMatchObject({ oldStart: 2, oldLen: 1, newStart: 2, newLen: 1 });
  });
});

describe('parseUnifiedDiff: fail-closed on malformed input', () => {
  it('refuses a non-string', () => {
    // @ts-expect-error deliberately wrong type — the guard must fail closed, not throw
    expect(parseUnifiedDiff(null)).toEqual({ ok: false, reason: 'diff must be a string' });
  });

  it('refuses a body line whose count disagrees with the header', () => {
    // header claims 3 old lines, body only supplies 2
    const r = parseUnifiedDiff('@@ -1,3 +1,2 @@\n a\n-b\n');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/old lines/);
  });

  it('refuses a body line with no valid marker', () => {
    const r = parseUnifiedDiff('@@ -1,1 +1,1 @@\nZgarbage\n');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/unparseable diff line/);
  });

  it('refuses junk before the first hunk header', () => {
    const r = parseUnifiedDiff('not a header\n@@ -1,1 +1,1 @@\n-a\n+A\n');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/unexpected line before first hunk/);
  });

  it('refuses a non-empty diff with no hunk header at all', () => {
    const r = parseUnifiedDiff('--- a\n+++ b\n');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/no hunk header/);
  });
});

describe('applyUnifiedDiff: happy path (exact reconstruction)', () => {
  it('applies a single-line replacement', () => {
    const original = file(['line one', 'line two', 'line three']);
    const diff = '@@ -1,3 +1,3 @@\n line one\n-line two\n+LINE TWO\n line three\n';
    const r = applyUnifiedDiff(original, diff);
    expect(r).toEqual({ ok: true, content: file(['line one', 'LINE TWO', 'line three']) });
  });

  it('applies multiple, in-order, non-overlapping hunks', () => {
    const original = file(['a', 'b', 'c', 'd', 'e']);
    const diff = ['@@ -1,1 +1,1 @@', '-a', '+A', '@@ -5,1 +5,1 @@', '-e', '+E'].join('\n') + '\n';
    const r = applyUnifiedDiff(original, diff);
    expect(r).toEqual({ ok: true, content: file(['A', 'b', 'c', 'd', 'E']) });
  });

  it('an empty diff applied to X returns X byte-for-byte', () => {
    const original = file(['unchanged', 'content'], false);
    expect(applyUnifiedDiff(original, '')).toEqual({ ok: true, content: original });
  });

  it('pure insertion (oldLen 0) adds lines at a location', () => {
    const original = file(['keep', 'keep2']);
    const diff = '@@ -1,2 +1,3 @@\n keep\n+inserted\n keep2\n';
    const r = applyUnifiedDiff(original, diff);
    expect(r).toEqual({ ok: true, content: file(['keep', 'inserted', 'keep2']) });
  });

  it('pure deletion removes lines', () => {
    const original = file(['x', 'drop me', 'y']);
    const diff = '@@ -1,3 +1,2 @@\n x\n-drop me\n y\n';
    const r = applyUnifiedDiff(original, diff);
    expect(r).toEqual({ ok: true, content: file(['x', 'y']) });
  });
});

describe('applyUnifiedDiff: trailing-newline and CRLF are preserved exactly', () => {
  it('a file with NO trailing newline stays that way', () => {
    const original = file(['a', 'b'], false); // 'a\nb'
    const diff = '@@ -1,2 +1,2 @@\n a\n-b\n+B\n';
    const r = applyUnifiedDiff(original, diff);
    expect(r).toEqual({ ok: true, content: file(['a', 'B'], false) }); // 'a\nB', no trailing \n
  });

  it('a CRLF file round-trips: \\r stays on each line, exact match still holds', () => {
    // Lines carry a trailing '\r'; the engine splits on '\n' only, so '\r' is part of the line text.
    const original = 'alpha\r\nbeta\r\ngamma\r\n';
    const diff = '@@ -2,1 +2,1 @@\n-beta\r\n+BETA\r\n';
    const r = applyUnifiedDiff(original, diff);
    expect(r).toEqual({ ok: true, content: 'alpha\r\nBETA\r\ngamma\r\n' });
  });
});

describe('applyUnifiedDiff: fail-closed — refuse, never guess or fuzzy-match (the safety property)', () => {
  it('refuses when a context line does not match the original', () => {
    const original = file(['line one', 'DIFFERENT', 'line three']);
    const diff = '@@ -1,3 +1,3 @@\n line one\n-line two\n+LINE TWO\n line three\n';
    const r = applyUnifiedDiff(original, diff);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/context mismatch at original line 2/);
  });

  it('refuses when a removed line does not match the original (no fuzzy delete)', () => {
    const original = file(['keep', 'actual', 'keep2']);
    const diff = '@@ -1,3 +1,2 @@\n keep\n-expected-but-wrong\n keep2\n';
    const r = applyUnifiedDiff(original, diff);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/context mismatch/);
  });

  it('refuses out-of-order / overlapping hunks (never re-orders)', () => {
    const original = file(['a', 'b', 'c', 'd']);
    // second hunk targets line 1, before the first hunk (line 3) — overlap/out-of-order
    const diff = ['@@ -3,1 +3,1 @@', '-c', '+C', '@@ -1,1 +1,1 @@', '-a', '+A'].join('\n') + '\n';
    const r = applyUnifiedDiff(original, diff);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/out-of-order/);
  });

  it('refuses a hunk that starts past the end of the file', () => {
    const original = file(['only', 'two']);
    const diff = '@@ -9,1 +9,1 @@\n-ghost\n+GHOST\n';
    const r = applyUnifiedDiff(original, diff);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/past end of file/);
  });

  it('refuses a hunk that needs more original lines than exist', () => {
    const original = file(['a']);
    const diff = '@@ -1,2 +1,1 @@\n a\n-b\n';
    const r = applyUnifiedDiff(original, diff);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/expects more original lines|old lines/);
  });

  it('propagates a parse refusal instead of applying garbage', () => {
    const r = applyUnifiedDiff('anything', 'Zgarbage without a header\n');
    expect(r.ok).toBe(false);
  });

  it('refuses a non-string original', () => {
    // @ts-expect-error deliberately wrong type
    expect(applyUnifiedDiff(123, '').ok).toBe(false);
  });
});

describe('applyUnifiedDiff: adversarial — a substituted context line cannot smuggle an edit through', () => {
  it('a diff hand-built to REMOVE a line it did not actually see is refused, so downstream never re-hashes forged bytes', () => {
    // The attacker knows the file has 'secret = old' at line 2 but crafts the diff against a GUESSED line.
    // Because the removed-line text must match byte-for-byte, the guess fails closed — the reconstruction the
    // owner would sign is never produced from a diff that didn't truly see the disk bytes.
    const onDisk = file(['header', 'secret = old', 'footer']);
    const forgedDiff = '@@ -1,3 +1,3 @@\n header\n-secret = OLD\n+secret = evil\n footer\n';
    const r = applyUnifiedDiff(onDisk, forgedDiff);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/context mismatch/);
  });

  it('is deterministic: the same original+diff always yields the identical result', () => {
    const original = file(['a', 'b', 'c']);
    const diff = '@@ -2,1 +2,1 @@\n-b\n+B\n';
    const first = applyUnifiedDiff(original, diff);
    const second = applyUnifiedDiff(original, diff);
    expect(first).toEqual(second);
  });
});

describe('diffStats: pure counting helper', () => {
  it('counts added/removed/hunks', () => {
    const diff = ['@@ -1,2 +1,2 @@', ' ctx', '-old', '+new', '@@ -5,1 +5,2 @@', ' ctx2', '+extra'].join('\n') + '\n';
    expect(diffStats(diff)).toEqual({ ok: true, added: 2, removed: 1, hunks: 2 });
  });

  it('an empty diff has zero stats', () => {
    expect(diffStats('')).toEqual({ ok: true, added: 0, removed: 0, hunks: 0 });
  });

  it('propagates a refusal on a malformed diff (no silent zeros off garbage)', () => {
    expect(diffStats('garbage\n').ok).toBe(false);
  });
});
