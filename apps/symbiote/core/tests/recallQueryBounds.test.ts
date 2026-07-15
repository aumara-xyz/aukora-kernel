// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Issue #274 — bounded search queries at the recall adapter boundary. The strict Convex search kernel
// refuses any control byte or >500 chars with `aumlok_mem_search_query_invalid`, so a long or
// multiline owner prompt used to lose recall entirely. The repair derives ONE normalized query BEFORE
// the reader signature is produced, so the signed preimage covers exactly the string the kernel
// receives. Kernel validation is untouched; there is no fallback path; the owner's original text
// never changes. These tests mirror the kernel's own predicate verbatim and pin the signature law.
import { describe, it, expect } from 'vitest';
import { normalizeSearchQuery, searchMemoryKeys, SEARCH_QUERY_MAX } from '../src/memoryRecall';

/** VERBATIM mirror of the kernel's search-query validation (convex/aumlokMemory.ts:198). If the kernel
 *  law ever changes, this predicate — and SEARCH_QUERY_MAX — must change with it. */
const kernelAccepts = (q: unknown): boolean =>
  typeof q === 'string' && q.length > 0 && q.length <= 500 && !/[\u0000-\u001f\u007f]/.test(q);

describe('normalizeSearchQuery — control bytes, whitespace, and the 500-char cap', () => {
  it('a multiline owner prompt becomes ONE kernel-acceptable line, words and order preserved', () => {
    const q = normalizeSearchQuery('remember the plan:\r\n  1. fix recall\n\t2. keep the kernel strict\n');
    expect(q).toBe('remember the plan: 1. fix recall 2. keep the kernel strict');
    expect(kernelAccepts(q)).toBe(true);
  });

  it('every control byte the kernel refuses is neutralized (NUL, unit separators, DEL)', () => {
    const q = normalizeSearchQuery('alpha\u0000beta\u001fgamma\u007fdelta');
    expect(q).toBe('alpha beta gamma delta');
    expect(kernelAccepts(q)).toBe(true);
  });

  it('caps at SEARCH_QUERY_MAX (=500, the kernel mirror) with no trailing space', () => {
    const q = normalizeSearchQuery('word '.repeat(200)); // 1000 chars raw
    expect(q.length).toBeLessThanOrEqual(SEARCH_QUERY_MAX);
    expect(q.length).toBeGreaterThan(0);
    expect(q.endsWith(' ')).toBe(false);
    expect(kernelAccepts(q)).toBe(true);
    expect(SEARCH_QUERY_MAX).toBe(500);
  });

  it('the cap never tears a surrogate pair (an emoji at the boundary is dropped whole)', () => {
    const q = normalizeSearchQuery('a'.repeat(499) + '🜁🜁🜁'); // pair would straddle position 500
    expect(q.length).toBeLessThanOrEqual(SEARCH_QUERY_MAX);
    expect(/[\ud800-\udbff]$/.test(q)).toBe(false); // no lone high surrogate at the end
    expect(() => encodeURIComponent(q)).not.toThrow(); // well-formed UTF-16 end to end
    expect(kernelAccepts(q)).toBe(true);
  });

  it('is idempotent and honest about emptiness (whitespace-only stays empty — the kernel still refuses it)', () => {
    for (const s of ['  \n\t ', '', 'plain words', 'a\u0000b']) {
      expect(normalizeSearchQuery(normalizeSearchQuery(s))).toBe(normalizeSearchQuery(s));
    }
    expect(normalizeSearchQuery(' \r\n \t ')).toBe('');
    expect(kernelAccepts('')).toBe(false); // no fallback: an empty query still refuses at the kernel
  });
});

describe('searchMemoryKeys — the signature covers the EXACT normalized query that travels', () => {
  const OWNER = 'aumara.root';
  const RAW = 'find the marker\r\nCOBALTHERON\n\tand the plan we discussed\n';

  function fakeCfg(capture: { signedQuery?: string; sentBody?: string }) {
    return {
      url: 'http://127.0.0.1:3210',
      ownerRootId: OWNER,
      adminKeyProvider: () => 'fake-admin-key',
      signSearch: async (req: { query: string }) => {
        capture.signedQuery = req.query; // what the signature preimage covered
        return 'fake-reader-sig';
      },
      fetchImpl: async (_url: string, init: { body: string }) => {
        capture.sentBody = init.body; // what actually traveled to the kernel
        return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'success', value: { ok: true, hits: [{ key: 'turn.x.1' }] } }) };
      },
    };
  }

  it('signed query === sent query === normalizeSearchQuery(raw); the raw multiline text never travels', async () => {
    const capture: { signedQuery?: string; sentBody?: string } = {};
    const res = await searchMemoryKeys(RAW, 5, fakeCfg(capture) as never);
    expect(res.ok).toBe(true);
    const expected = normalizeSearchQuery(RAW);
    expect(capture.signedQuery).toBe(expected);
    const sentReq = JSON.parse(capture.sentBody!).args.req as { query: string; readerPrincipalId: string };
    expect(sentReq.query).toBe(expected); // signature preimage and wire bytes agree
    expect(kernelAccepts(sentReq.query)).toBe(true);
    expect(sentReq.query.includes('\n')).toBe(false);
    expect(capture.sentBody!.includes('\\n')).toBe(false); // no escaped newline smuggled inside the query JSON
  });

  it('a >500-char owner prompt now reaches the kernel as a capped, acceptable query', async () => {
    const capture: { signedQuery?: string; sentBody?: string } = {};
    const res = await searchMemoryKeys('context '.repeat(120), 5, fakeCfg(capture) as never); // 960 chars raw
    expect(res.ok).toBe(true);
    expect(capture.signedQuery!.length).toBeLessThanOrEqual(SEARCH_QUERY_MAX);
    expect(kernelAccepts(capture.signedQuery)).toBe(true);
  });
});
