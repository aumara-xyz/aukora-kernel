// #104 wiring — reconstruct proposal files from unified diffs into whole-file content. Hermetic:
// an injected reader stands in for disk, so we pin the safety properties without touching the repo:
// exact-match-or-refuse, modify-only (diff target must exist), ambiguity refused, atomic (one bad file
// fails the whole set), and — the load-bearing property — a reconstructed diff yields BYTE-IDENTICAL
// content to the whole-file form, so the downstream proposalHash is unchanged.
import { describe, it, expect } from 'vitest';
import { reconstructProposalFiles, proposalUsesDiff, type FileReader } from '../src/proposalDiffReconstruct';
import { computeProposalHash } from '../src/proposalHash';

const reader = (files: Record<string, string>): FileReader => (relPath) =>
  relPath in files ? { ok: true, content: files[relPath] } : { ok: false, reason: `not found: ${relPath}` };

describe('reconstructProposalFiles — #104 diff → content', () => {
  it('passes whole-file content through unchanged', () => {
    const r = reconstructProposalFiles([{ relPath: 'a.ts', content: 'hello\n' }], { readFile: reader({}) });
    expect(r).toEqual({ ok: true, files: [{ relPath: 'a.ts', content: 'hello\n' }] });
  });

  it('applies a clean diff against current disk bytes and yields the exact new content', () => {
    const disk = { 'core/src/x.ts': 'a\nb\nc\n' };
    const diff = '@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n';
    const r = reconstructProposalFiles([{ relPath: 'core/src/x.ts', diff }], { readFile: reader(disk) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.files[0]).toEqual({ relPath: 'core/src/x.ts', content: 'a\nB\nc\n' });
  });

  it('the RECONSTRUCTED content hashes identically to the whole-file form (owner signs the same hash)', () => {
    const disk = { 'f.ts': 'one\ntwo\nthree\n' };
    const diff = '@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n';
    const viaDiff = reconstructProposalFiles([{ relPath: 'f.ts', diff }], { readFile: reader(disk) });
    const viaContent = reconstructProposalFiles([{ relPath: 'f.ts', content: 'one\nTWO\nthree\n' }], { readFile: reader(disk) });
    expect(viaDiff.ok && viaContent.ok).toBe(true);
    if (viaDiff.ok && viaContent.ok) {
      expect(viaDiff.files).toEqual(viaContent.files);
      expect(computeProposalHash('g', viaDiff.files)).toBe(computeProposalHash('g', viaContent.files));
    }
  });

  it('REFUSES a diff whose context does not match disk (exact-match safety — never guesses)', () => {
    const disk = { 'f.ts': 'a\nb\nc\n' };
    const staleDiff = '@@ -1,3 +1,3 @@\n a\n-X\n+B\n c\n'; // "X" is not what's on disk
    const r = reconstructProposalFiles([{ relPath: 'f.ts', diff: staleDiff }], { readFile: reader(disk) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('does not apply cleanly');
  });

  it('REFUSES a diff whose target file does not exist (diff is modify-only; new files use content)', () => {
    const r = reconstructProposalFiles([{ relPath: 'new.ts', diff: '@@ -0,0 +1,1 @@\n+hi\n' }], { readFile: reader({}) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('not found');
  });

  it('REFUSES ambiguity (both content and diff) and emptiness (neither)', () => {
    expect(reconstructProposalFiles([{ relPath: 'f.ts', content: 'x', diff: '@@' }], { readFile: reader({}) }).ok).toBe(false);
    expect(reconstructProposalFiles([{ relPath: 'f.ts' }], { readFile: reader({}) }).ok).toBe(false);
  });

  it('is ATOMIC — one unresolvable file fails the whole set (no partial reconstruction reaches the gate)', () => {
    const disk = { 'good.ts': 'a\n' };
    const r = reconstructProposalFiles([
      { relPath: 'good.ts', content: 'a\nb\n' },
      { relPath: 'missing.ts', diff: '@@ -1 +1 @@\n-a\n+b\n' },
    ], { readFile: reader(disk) });
    expect(r.ok).toBe(false);
  });

  it('refuses an oversized diff and an empty file set', () => {
    expect(reconstructProposalFiles([], { readFile: reader({}) }).ok).toBe(false);
    const huge = '@@ -1 +1 @@\n' + '+x\n'.repeat(80_000);
    expect(reconstructProposalFiles([{ relPath: 'f.ts', diff: huge }], { readFile: reader({ 'f.ts': 'a\n' }) }).ok).toBe(false);
  });

  it('proposalUsesDiff flags the #104 path (diff or edits)', () => {
    expect(proposalUsesDiff([{ relPath: 'a', content: 'x' }])).toBe(false);
    expect(proposalUsesDiff([{ relPath: 'a', diff: '@@' }])).toBe(true);
    expect(proposalUsesDiff([{ relPath: 'a', edits: [{ find: 'x', replace: 'y' }] }])).toBe(true);
    expect(proposalUsesDiff([{ relPath: 'a', content: 'x' }, { relPath: 'b', diff: '@@' }])).toBe(true);
  });

  it('reconstructs from EDITS (search/replace) against disk, and hashes identically to the whole-file form', () => {
    const disk = { 'big.ts': 'line1\nconst GENESIS = "genesis";\nline3\n' };
    const viaEdits = reconstructProposalFiles(
      [{ relPath: 'big.ts', edits: [{ find: 'const GENESIS = "genesis";', replace: '// the anchor\nconst GENESIS = "genesis";' }] }],
      { readFile: reader(disk) },
    );
    const viaContent = reconstructProposalFiles(
      [{ relPath: 'big.ts', content: 'line1\n// the anchor\nconst GENESIS = "genesis";\nline3\n' }],
      { readFile: reader(disk) },
    );
    expect(viaEdits.ok && viaContent.ok).toBe(true);
    if (viaEdits.ok && viaContent.ok) {
      expect(viaEdits.files).toEqual(viaContent.files);
      expect(computeProposalHash('g', viaEdits.files)).toBe(computeProposalHash('g', viaContent.files));
    }
  });

  it('an edits form whose find is absent from disk refuses; more-than-one-form refuses', () => {
    const disk = { 'f.ts': 'a\n' };
    expect(reconstructProposalFiles([{ relPath: 'f.ts', edits: [{ find: 'ZZZ', replace: 'x' }] }], { readFile: reader(disk) }).ok).toBe(false);
    expect(reconstructProposalFiles([{ relPath: 'f.ts', content: 'a', edits: [{ find: 'a', replace: 'b' }] }], { readFile: reader(disk) }).ok).toBe(false);
    expect(reconstructProposalFiles([{ relPath: 'f.ts', diff: '@@', edits: [{ find: 'a', replace: 'b' }] }], { readFile: reader(disk) }).ok).toBe(false);
  });
});
