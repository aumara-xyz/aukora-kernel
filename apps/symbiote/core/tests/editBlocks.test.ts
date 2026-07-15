// Search/replace edit blocks — the LLM-friendly #104 authoring format. The safety property under test:
// a find must match the CURRENT content EXACTLY ONCE, or the whole set refuses fail-closed. No fuzzy match,
// no guessing which occurrence, no silent no-op — so a reconstructed edit is still bound byte-for-byte to
// real content.
import { describe, it, expect } from 'vitest';
import { applyEditBlocks } from '../src/editBlocks';

describe('applyEditBlocks — exact-find-exactly-once-or-refuse', () => {
  it('applies a single clean edit', () => {
    const r = applyEditBlocks('const GENESIS = "genesis";\n', [{ find: 'const GENESIS', replace: '// anchor\nconst GENESIS' }]);
    expect(r).toEqual({ ok: true, content: '// anchor\nconst GENESIS = "genesis";\n' });
  });

  it('applies multiple non-overlapping edits in order', () => {
    const orig = 'a\nb\nc\n';
    const r = applyEditBlocks(orig, [{ find: 'a\n', replace: 'A\n' }, { find: 'c\n', replace: 'C\n' }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.content).toBe('A\nb\nC\n');
  });

  it('REFUSES a find that is not present (model hallucinated content)', () => {
    const r = applyEditBlocks('real content\n', [{ find: 'not on disk', replace: 'x' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('not present');
  });

  it('REFUSES an AMBIGUOUS find (occurs more than once) — never guesses which one', () => {
    const r = applyEditBlocks('x\nx\nx\n', [{ find: 'x\n', replace: 'y\n' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('ambiguous');
  });

  it('a unique find with enough context resolves an otherwise-ambiguous token', () => {
    const orig = 'foo = 1\nfoo = 2\n';
    const r = applyEditBlocks(orig, [{ find: 'foo = 2', replace: 'foo = 3' }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.content).toBe('foo = 1\nfoo = 3\n');
  });

  it('REFUSES an empty find, a no-op (find === replace), too many edits, and a non-string field', () => {
    expect(applyEditBlocks('a', [{ find: '', replace: 'x' }]).ok).toBe(false);
    expect(applyEditBlocks('a', [{ find: 'a', replace: 'a' }]).ok).toBe(false);
    expect(applyEditBlocks('a', Array.from({ length: 51 }, () => ({ find: 'a', replace: 'b' }))).ok).toBe(false);
    expect(applyEditBlocks('a', [{ find: 1 as unknown as string, replace: 'x' }]).ok).toBe(false);
    expect(applyEditBlocks('a', []).ok).toBe(false);
  });

  it('a second edit whose find was consumed by the first refuses (no silent no-op)', () => {
    const orig = 'hello world\n';
    const r = applyEditBlocks(orig, [
      { find: 'hello world', replace: 'goodbye' },
      { find: 'hello world', replace: 'again' }, // gone after edit 0 → not present → refuse
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('not present');
  });

  it('REFUSES a SELF-OVERLAPPING find as ambiguous (adversarial-review regression, 2026-07-06)', () => {
    // "\n\n" matches at two overlapping positions in "\n\n\n" — genuinely ambiguous, must refuse, not
    // silently collapse the first gap. (Non-overlapping counting used to undercount these to 1.)
    expect(applyEditBlocks('a\n\n\nb', [{ find: '\n\n', replace: '\n' }]).ok).toBe(false);
    expect(applyEditBlocks('===\n', [{ find: '==', replace: '##' }]).ok).toBe(false);
    expect(applyEditBlocks('xaxax\n', [{ find: 'xax', replace: 'Y' }]).ok).toBe(false);
    // a path run "../../" overlapping itself must also refuse
    expect(applyEditBlocks('import x from "../../../y"\n', [{ find: '../../', replace: '../' }]).ok).toBe(false);
    // but a self-overlapping-shaped find that truly appears ONCE still applies
    expect(applyEditBlocks('a\n\nb', [{ find: '\n\n', replace: '\n\nMID\n' }]).ok).toBe(true);
  });

  it('preserves exact bytes including trailing newline and whitespace', () => {
    const orig = '  indented();\n\ttabbed();\n';
    const r = applyEditBlocks(orig, [{ find: '  indented();', replace: '  INDENTED();' }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.content).toBe('  INDENTED();\n\ttabbed();\n');
  });
});
