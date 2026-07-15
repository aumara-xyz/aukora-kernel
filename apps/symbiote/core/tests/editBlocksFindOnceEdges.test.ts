// RAIL: editblocks-find-once — edge pins for the find-once-or-refuse guard (core/src/editBlocks.ts)
// and its load-bearing wrapper (core/src/proposalDiffReconstruct.ts edits branch).
//
// The safety property: a search/replace edit applies ONLY when its `find` matches the CURRENT working
// text EXACTLY ONCE. Zero matches (the model hallucinated content) and multiple matches (ambiguous —
// never guess which occurrence) both REFUSE fail-closed. This exact rule refused a live 32B candidate
// whose `return {` anchor matched 16 times. These tests exist so that if anyone ever deletes or weakens
// that rule — apply-at-first-index, precompute-counts-against-original, regex matching, whitespace/CRLF
// normalization, loop-until-no-match — this suite goes red.
//
// Everything here is pure/hermetic: applyEditBlocks is a pure function; reconstructProposalFiles gets
// an INJECTED reader (never real disk, never defaultRepoFileReader). No authority is exercised.
import { describe, it, expect } from 'vitest';
import { applyEditBlocks, type EditBlock } from '../src/editBlocks';
import { reconstructProposalFiles, type FileReader } from '../src/proposalDiffReconstruct';

const reader = (files: Record<string, string>): FileReader => (relPath) =>
  relPath in files ? { ok: true, content: files[relPath] } : { ok: false, reason: `not found: ${relPath}` };

describe('applyEditBlocks — the 32B-candidate regression shape', () => {
  it('REFUSES a realistic non-unique code anchor: `return {` occurring 16 times reports the exact count and never applies', () => {
    // Reconstruct the live incident's shape: a file where `return {` is a hopeless anchor because
    // every function body has one (two per function here — early-out + main return).
    const fn = (name: string) =>
      `function get${name}() {\n` +
      `  if (!cache.${name}) {\n` +
      `    return {\n` +
      `      kind: '${name}',\n` +
      `      ok: false,\n` +
      `    };\n` +
      `  }\n` +
      `  return {\n` +
      `    kind: '${name}',\n` +
      `    ok: true,\n` +
      `  };\n` +
      `}\n`;
    const original = ['Alpha', 'Bravo', 'Carol', 'Delta', 'Echos', 'Frank', 'Grape', 'Hotel'].map(fn).join('\n');
    // Self-check the shape before pinning the guard: exactly 16 occurrences of the anchor.
    expect(original.split('return {').length - 1).toBe(16);

    const r = applyEditBlocks(original, [{ find: 'return {', replace: 'return { // patched' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('ambiguous');
      expect(r.reason).toContain('occurs 16 times'); // the reported count, not just "more than one"
    }
  });
});

describe('applyEditBlocks — typed refusals, never throws', () => {
  it('a non-string original refuses typed and never throws (null / undefined / number)', () => {
    for (const bad of [null, undefined, 42, { text: 'x' }]) {
      let r: ReturnType<typeof applyEditBlocks> | undefined;
      expect(() => { r = applyEditBlocks(bad as unknown as string, [{ find: 'a', replace: 'b' }]); }).not.toThrow();
      expect(r).toEqual({ ok: false, reason: 'original must be a string' });
    }
  });

  it('non-array edits and a null edit entry refuse typed, never throw', () => {
    for (const bad of ['not-an-array', { find: 'a', replace: 'b' }, 7]) {
      let r: ReturnType<typeof applyEditBlocks> | undefined;
      expect(() => { r = applyEditBlocks('abc', bad as unknown as EditBlock[]); }).not.toThrow();
      expect(r).toEqual({ ok: false, reason: 'no edits provided' });
    }
    let rNull: ReturnType<typeof applyEditBlocks> | undefined;
    expect(() => { rNull = applyEditBlocks('abc', [null as unknown as EditBlock]); }).not.toThrow();
    expect(rNull!.ok).toBe(false);
    if (!rNull!.ok) expect((rNull as { ok: false; reason: string }).reason).toContain('needs find + replace strings');
  });

  it('an empty find refuses with a reason naming the empty find (the sentinel path is never reached)', () => {
    const r = applyEditBlocks('abc', [{ find: '', replace: 'x' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('empty find');
  });
});

describe('applyEditBlocks — size boundaries pinned from BOTH sides', () => {
  it('REFUSES an oversized find (> 20_000 chars) even when it would match exactly once', () => {
    const find = 'x'.repeat(20_001);
    const original = find + '\n';
    const r = applyEditBlocks(original, [{ find, replace: 'small' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('too large');
  });

  it('a find of exactly 20_000 chars (the cap itself) still applies', () => {
    const find = 'y'.repeat(20_000);
    const original = find + '\n';
    const r = applyEditBlocks(original, [{ find, replace: 'z' }]);
    expect(r).toEqual({ ok: true, content: 'z\n' });
  });

  it('exactly MAX_EDITS (50) distinct edits still apply; 51 refuses "too many edits"', () => {
    // 50 fixed-width distinct tokens — none a substring of another, so each find is unique.
    const tokens = Array.from({ length: 50 }, (_, i) => `tok${String(i).padStart(2, '0')}`);
    const original = tokens.join('\n') + '\n';
    const edits = tokens.map((t) => ({ find: t, replace: t.toUpperCase() }));

    const ok50 = applyEditBlocks(original, edits);
    expect(ok50.ok).toBe(true);
    if (ok50.ok) expect(ok50.content).toBe(tokens.map((t) => t.toUpperCase()).join('\n') + '\n');

    const r51 = applyEditBlocks(original, [...edits, { find: 'TOK00', replace: 'zzz' }]);
    expect(r51.ok).toBe(false);
    if (!r51.ok) expect(r51.reason).toContain('too many edits');
  });
});

describe('applyEditBlocks — sequential semantics: counts run against the WORKING text', () => {
  it('a later edit whose find became AMBIGUOUS via an earlier replacement REFUSES (1 -> 2 direction)', () => {
    // original has exactly one 'A' and one 'B'; edit 0 turns the A into a second B, so edit 1's
    // find 'B' now occurs twice in the working text. A precompute-against-original implementation
    // would see count=1 and silently splice the wrong (first) B.
    const original = 'A\nB\n';
    const r = applyEditBlocks(original, [
      { find: 'A', replace: 'B' },
      { find: 'B', replace: 'C' },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('ambiguous');
      expect(r.reason).toContain('occurs 2 times');
    }
  });

  it('a later edit MAY match text introduced by an earlier replacement (documented sequential order)', () => {
    const original = 'alpha\n';
    expect(original.includes('beta')).toBe(false); // count in ORIGINAL is 0 — only the working text has it
    const r = applyEditBlocks(original, [
      { find: 'alpha', replace: 'beta' },
      { find: 'beta', replace: 'gamma' },
    ]);
    expect(r).toEqual({ ok: true, content: 'gamma\n' });
  });

  it('overlapping edits with DISTINCT finds refuse after the first consumes the shared text', () => {
    const original = 'hello world peace\n';
    const r = applyEditBlocks(original, [
      { find: 'hello world', replace: 'HW' },
      { find: 'world peace', replace: 'WP' }, // 'world' was consumed by edit 0 -> 0 matches now
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('not present');
  });

  it('edits apply in ARRAY order with positions recomputed per edit (reverse file order works)', () => {
    const original = 'one\ntwo\nthree\n';
    const r = applyEditBlocks(original, [
      { find: 'three\n', replace: 'THREE\n' }, // last in file, first in array
      { find: 'one\n', replace: 'ONE\n' },
    ]);
    expect(r).toEqual({ ok: true, content: 'ONE\ntwo\nTHREE\n' });
  });

  it('a replace containing its own find applies exactly once (no re-scan of the replacement)', () => {
    // A loop-until-no-match or global-replace reimplementation would double-apply or hang here.
    const r = applyEditBlocks('aXb\n', [{ find: 'X', replace: 'XX' }]);
    expect(r).toEqual({ ok: true, content: 'aXXb\n' });
  });

  it('an empty replace is a valid pure deletion of the unique find', () => {
    const r = applyEditBlocks('aXb\n', [{ find: 'X', replace: '' }]);
    expect(r).toEqual({ ok: true, content: 'ab\n' });
  });
});

describe('applyEditBlocks — bytes are literal: no CRLF/whitespace normalization, no regex', () => {
  it('an LF-authored find refuses against CRLF content (0 matches — bytes the model never saw)', () => {
    const r = applyEditBlocks('a\r\nb\r\n', [{ find: 'a\nb', replace: 'X' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('not present');
  });

  it('a CRLF-authored find applies and the output preserves \\r\\n bytes exactly', () => {
    const r = applyEditBlocks('a\r\nb\r\n', [{ find: 'a\r\nb', replace: 'a\r\nB' }]);
    expect(r).toEqual({ ok: true, content: 'a\r\nB\r\n' });
  });

  it('whitespace-exact: a find differing only in trailing or indentation whitespace refuses', () => {
    const original = '  foo();\n\tbar();\n';
    // trailing space the file does not have
    const trailing = applyEditBlocks(original, [{ find: '  foo(); ', replace: 'x' }]);
    expect(trailing.ok).toBe(false);
    if (!trailing.ok) expect(trailing.reason).toContain('not present');
    // tab where the file has two spaces
    const tabbed = applyEditBlocks(original, [{ find: '\tfoo();', replace: 'x' }]);
    expect(tabbed.ok).toBe(false);
    if (!tabbed.ok) expect(tabbed.reason).toContain('not present');
    // two spaces where the file has a tab
    const spaced = applyEditBlocks(original, [{ find: '  bar();', replace: 'x' }]);
    expect(spaced.ok).toBe(false);
    if (!spaced.ok) expect(spaced.reason).toContain('not present');
  });

  it('finds are literal strings, never regex: metacharacters do not pattern-match', () => {
    // 'a.*b' must NOT match 'axxxb' (a regex would)
    const noPattern = applyEditBlocks('axxxb\n', [{ find: 'a.*b', replace: 'Y' }]);
    expect(noPattern.ok).toBe(false);
    if (!noPattern.ok) expect(noPattern.reason).toContain('not present');
    // ...but it DOES match the literal characters 'a.*b'
    const literal = applyEditBlocks('match a.*b literally\n', [{ find: 'a.*b', replace: 'A_TO_B' }]);
    expect(literal).toEqual({ ok: true, content: 'match A_TO_B literally\n' });
    // unbalanced-paren and backslash-class finds neither throw nor misfire
    expect(applyEditBlocks('f(x)\n', [{ find: '(x)', replace: '(y)' }])).toEqual({ ok: true, content: 'f(y)\n' });
    expect(applyEditBlocks('pattern: \\d+\n', [{ find: '\\d+', replace: 'DIGITS' }])).toEqual({ ok: true, content: 'pattern: DIGITS\n' });
  });

  it('replacement text is literal: $& / $1 / $\' never expand (no String.replace pattern semantics)', () => {
    expect(applyEditBlocks('aXb\n', [{ find: 'X', replace: '$&$&' }])).toEqual({ ok: true, content: 'a$&$&b\n' });
    expect(applyEditBlocks('aXb\n', [{ find: 'X', replace: "$1$'" }])).toEqual({ ok: true, content: "a$1$'b\n" });
  });
});

describe('reconstructProposalFiles — the edits branch is applyEditBlocks-bound (find-once is load-bearing)', () => {
  it('REFUSES an empty edits array — a no-op reconstruction can never yield a signable proposal', () => {
    const r = reconstructProposalFiles(
      [{ relPath: 'f.ts', edits: [] }],
      { readFile: reader({ 'f.ts': 'unchanged disk content\n' }) },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('do not apply cleanly');
      expect(r.reason).toContain('no edits provided');
    }
  });

  it('surfaces the AMBIGUOUS (multi-match) refusal through the wrapper with the file path', () => {
    const disk = { 'src/big.ts': 'function a() {\n  return {};\n}\nfunction b() {\n  return {};\n}\n' };
    const r = reconstructProposalFiles(
      [{ relPath: 'src/big.ts', edits: [{ find: 'return {}', replace: 'return { ok: true }' }] }],
      { readFile: reader(disk) },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('edits for src/big.ts do not apply cleanly to disk');
      expect(r.reason).toContain('ambiguous');
      expect(r.reason).toContain('occurs 2 times');
    }
  });

  it('is ATOMIC on the edits branch: one refusing edits file fails the WHOLE set (no partial files)', () => {
    const disk = { 'good.ts': 'a\n', 'bad.ts': 'x x\n' }; // 'x' occurs twice in bad.ts -> ambiguous
    const r = reconstructProposalFiles(
      [
        { relPath: 'good.ts', content: 'a\nb\n' },
        { relPath: 'bad.ts', edits: [{ find: 'x', replace: 'y' }] },
      ],
      { readFile: reader(disk) },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('bad.ts');
      // no partial reconstruction may leak on the refusal shape
      expect((r as unknown as { files?: unknown }).files).toBeUndefined();
    }
  });
});
