// extractReviewJson robustness — the Fusion Council itself flagged that the naive brace-counter fails when a
// JSON string VALUE contains '{' or '}' (or an escaped quote), turning a real verdict into a FALSE non_vote.
// The bug lives in the PROSE-WRAPPED fallback: when direct JSON.parse fails (leading/trailing prose), the
// brace-scanner runs — and it must be string-aware so braces/quotes inside string values don't break it.
import { describe, it, expect } from 'vitest';
import { extractReviewJson, coerceReview } from '../src/externalReview';

describe('extractReviewJson — string-aware brace matching (no false non-votes)', () => {
  it('clean JSON still parses', () => {
    expect(extractReviewJson('{"verdict":"GREEN","findings":"ok","confidence":8}')?.verdict).toBe('GREEN');
  });

  it('prose-wrapped JSON with an UNbalanced open brace inside a string value', () => {
    // naive counting sees the inner "{" as depth+1 and never returns to 0 → null → false non_vote
    const raw = 'Here is my review: {"verdict":"GREEN","findings":"only an open brace { here","risks":"x"}';
    const o = extractReviewJson(raw);
    expect(o).not.toBeNull();
    expect(o?.verdict).toBe('GREEN');
    expect(o?.findings).toBe('only an open brace { here');
  });

  it('prose-wrapped JSON with a stray close brace inside a string value', () => {
    // naive counting sees the inner "}" as depth 0 → slices a truncated, unparseable block → null
    const raw = 'Review follows: {"verdict":"RED","findings":"closing } brace only","confidence":3}';
    const o = extractReviewJson(raw);
    expect(o).not.toBeNull();
    expect(o?.verdict).toBe('RED');
    expect(o?.confidence).toBe(3);
  });

  it('prose-wrapped JSON with escaped quotes AND a brace inside a string', () => {
    const raw = 'ok: {"verdict":"YELLOW","findings":"the \\"gate\\" and a { brace","risks":"y"}';
    const o = extractReviewJson(raw);
    expect(o).not.toBeNull();
    expect(o?.verdict).toBe('YELLOW');
    expect(o?.findings).toBe('the "gate" and a { brace');
  });

  it('prose-wrapped BALANCED braces-in-string still works (regression)', () => {
    const raw = 'Sure: {"verdict":"GREEN","findings":"use { } and code freely","risks":"none"}\nThanks!';
    expect(extractReviewJson(raw)?.verdict).toBe('GREEN');
  });

  it('markdown-fenced JSON still parses', () => {
    expect(extractReviewJson('```json\n{"verdict":"RED","findings":"x","confidence":2}\n```')?.verdict).toBe('RED');
  });

  it('END-TO-END: a prose-wrapped braces-in-string review coerces to a REAL vote, not a non_vote', () => {
    const raw = 'my review: {"verdict":"YELLOW","findings":"the loop { needs a guard","risks":"r","confidence":6}';
    const review = coerceReview(extractReviewJson(raw));
    expect(review).not.toBeNull();
    expect(review?.verdict).toBe('YELLOW');
    expect(review?.confidence).toBe(6);
  });

  it('genuinely malformed / verdict-less content still returns null (no fabricated vote)', () => {
    expect(extractReviewJson('this is not json at all')).toBeNull();
    expect(coerceReview(extractReviewJson('here: {"notes":"no verdict"}'))).toBeNull();
  });
});
