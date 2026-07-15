import { describe, it, expect } from 'vitest';
import { extractReviewJson, coerceReview, performExternalReview } from '../src/externalReview';
import { MODEL_PROFILES } from '../src/fusionConfig';

// 24Z.11.1 — Fusion adapter reliability repair. The Opus/GLM/Kimi non-votes were OUR strict parser: a bare
// JSON.parse(content) that dies on markdown fences / prose, plus an all-fields-required schema. These tests
// prove the repair counts a genuine answer while a true non-answer still fails typed.

const FULL = '{"verdict":"GREEN","findings":"ok","risks":"none","missing_tests":"x","recommended_next_commit":"y","confidence":8}';

describe('24Z.11.1: extractReviewJson tolerates fences + prose', () => {
  it('parses a bare JSON object', () => {
    expect(extractReviewJson(FULL)?.verdict).toBe('GREEN');
  });
  it('strips ```json fences``` (the Opus/GLM failure mode)', () => {
    expect(extractReviewJson('```json\n' + FULL + '\n```')?.verdict).toBe('GREEN');
    expect(extractReviewJson('```\n' + FULL + '\n```')?.verdict).toBe('GREEN');
  });
  it('extracts the object from surrounding prose', () => {
    expect(extractReviewJson('Here is my review:\n' + FULL + '\nHope that helps!')?.verdict).toBe('GREEN');
  });
  it('handles nested braces in string values', () => {
    const nested = '{"verdict":"YELLOW","findings":"use {x} carefully","risks":"","missing_tests":"","recommended_next_commit":"","confidence":5}';
    expect(extractReviewJson(nested)?.findings).toBe('use {x} carefully');
  });
  it('returns null for empty / no-JSON content', () => {
    expect(extractReviewJson('')).toBeNull();
    expect(extractReviewJson('   ')).toBeNull();
    expect(extractReviewJson('no json here at all')).toBeNull();
    expect(extractReviewJson(null)).toBeNull();
  });
});

describe('24Z.11.1: coerceReview — verdict required, other fields defaulted/coerced', () => {
  it('coerces a complete object', () => {
    const r = coerceReview(extractReviewJson(FULL));
    expect(r?.verdict).toBe('GREEN');
    expect(r?.confidence).toBe(8);
  });
  it('defaults a MISSING optional field instead of dropping the vote (the Kimi schema_mismatch mode)', () => {
    const r = coerceReview({ verdict: 'YELLOW', findings: 'f', risks: 'r' }); // no missing_tests/next/confidence
    expect(r?.verdict).toBe('YELLOW');
    expect(r?.missing_tests).toBe('N/A');
    expect(r?.recommended_next_commit).toBe('none');
    expect(r?.confidence).toBe(5);
  });
  it('coerces a string confidence to a number', () => {
    expect(coerceReview({ verdict: 'RED', confidence: '7' })?.confidence).toBe(7);
  });
  it('accepts a lowercase/whitespaced verdict', () => {
    expect(coerceReview({ verdict: ' green ' })?.verdict).toBe('GREEN');
  });
  it('returns null when there is no real verdict (true schema_mismatch)', () => {
    expect(coerceReview({ findings: 'x' })).toBeNull();
    expect(coerceReview({ verdict: 'MAYBE' })).toBeNull();
    expect(coerceReview(null)).toBeNull();
  });
});

describe('24Z.11.1: end-to-end repair of the real failure shapes', () => {
  it('fenced JSON with a missing field → a real GREEN vote (was a non_vote before the repair)', () => {
    const opusish = '```json\n{"verdict":"GREEN","findings":"looks good","risks":"low"}\n```';
    const r = coerceReview(extractReviewJson(opusish));
    expect(r?.verdict).toBe('GREEN');
  });
  it('prose + valid object → counted; pure prose (no object) → still a typed non-answer', () => {
    expect(coerceReview(extractReviewJson('I think: ' + FULL))?.verdict).toBe('GREEN');
    expect(extractReviewJson('I cannot review this.')).toBeNull(); // → invalid_json upstream
  });
});

describe('Fusion adapter timeout covers the response body, not just response headers', () => {
  it('fails closed when a provider returns headers but stalls during response.json()', async () => {
    const oldFetch = globalThis.fetch;
    const oldKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'sk-or-test-timeout-key';
    MODEL_PROFILES['test/headers-then-stall'] = {
      slug: 'test/headers-then-stall',
      fetchTimeoutMs: 25,
      wallClockTimeoutMs: 40,
      maxRetries: 1,
      maxOutputTokens: 16,
      supportsJsonMode: true,
    };

    globalThis.fetch = (async (_url: any, init: any) => ({
      ok: true,
      status: 200,
      json: () => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('body stalled until abort')));
      }),
    })) as any;

    try {
      const started = Date.now();
      const review = await performExternalReview('evidence', [], { modelSlug: 'test/headers-then-stall' });
      expect(Date.now() - started).toBeLessThan(1000);
      expect(review.verdict).toBe('RED');
      expect(review.failureReason).toBe('network_timeout');
      expect(review.provider_contacted).toBe(true);
    } finally {
      globalThis.fetch = oldFetch;
      if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = oldKey;
      delete MODEL_PROFILES['test/headers-then-stall'];
    }
  });
});
