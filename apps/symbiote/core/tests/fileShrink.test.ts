// #91 shared file-shrink detector — one implementation feeding both the sign-time AUMLOK assistant and
// the run-time #51 evidence packet.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { computeFileShrink, computeProposalShrinks, SHRINK_LINE_FRACTION, SHRINK_MIN_DELETED_LINES } from '../src/fileShrink';

let repo: string;
beforeEach(() => { repo = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'fileshrink-')); });
afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

function writeRepoFile(rel: string, lines: number) {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
}

describe('#91 computeFileShrink', () => {
  it('flags an existing large file replaced by tiny content (the truncation class)', () => {
    writeRepoFile('docs/BIG.md', 100);
    const r = computeFileShrink(repo, 'docs/BIG.md', 'a\nb\nc');
    expect(r.existsInRepo).toBe(true);
    expect(r.beforeLines).toBe(101);
    expect(r.afterLines).toBe(3);
    expect(r.netLineDelta).toBe(3 - 101);
    expect(r.shrinkWarning).toBe(true);
  });

  it('does NOT flag a small edit that grows or barely changes an existing file', () => {
    writeRepoFile('docs/SMALL.md', 19);
    const grow = computeFileShrink(repo, 'docs/SMALL.md', Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n'));
    expect(grow.shrinkWarning).toBe(false);
    expect(grow.netLineDelta).toBeGreaterThanOrEqual(0);
  });

  it('never flags a NEW file (no before) and reports null before-counts', () => {
    const r = computeFileShrink(repo, 'docs/NEW.md', 'hello');
    expect(r.existsInRepo).toBe(false);
    expect(r.beforeLines).toBeNull();
    expect(r.netLineDelta).toBeNull();
    expect(r.shrinkWarning).toBe(false);
  });

  it('refuses an unsafe/out-of-repo path (no read, treated as new)', () => {
    const r = computeFileShrink(repo, '../../etc/passwd', 'x');
    expect(r.existsInRepo).toBe(false);
    expect(r.beforeLines).toBeNull();
    expect(r.shrinkWarning).toBe(false);
  });

  it('honors the threshold: just-above the fraction/min-deleted does not warn, well-below does', () => {
    writeRepoFile('docs/T.md', 100);
    // drop to 60 lines: 60 > 100*0.5, only 41 deleted, 60 > 100*0.75 boundary → no warn
    expect(computeFileShrink(repo, 'docs/T.md', Array.from({ length: 60 }, () => 'x').join('\n')).shrinkWarning).toBe(false);
    // drop to 10 lines: 10 <= 50 AND 91 deleted >= 20 → warn
    expect(computeFileShrink(repo, 'docs/T.md', Array.from({ length: 10 }, () => 'x').join('\n')).shrinkWarning).toBe(true);
    expect(SHRINK_LINE_FRACTION).toBe(0.5);
    expect(SHRINK_MIN_DELETED_LINES).toBe(20);
  });

  it('flags a LARGE absolute deletion even when >50% of the file survives (the gap an adversary found)', () => {
    // 500 → 300: keeps 60% (passes the fraction-only test) but rips out 200 lines — the exact
    // "comment-only change that deletes hundreds of lines" class. Must warn via the absolute floor.
    writeRepoFile('docs/BIG.md', 500);
    const r = computeFileShrink(repo, 'docs/BIG.md', Array.from({ length: 300 }, () => 'x').join('\n'));
    expect(r.beforeLines).toBe(501); expect(r.afterLines).toBe(300);
    expect(r.shrinkWarning).toBe(true);
    // 1000 → 600 (deletes 400, keeps 60%) also warns — separate file so the before-count is fresh
    writeRepoFile('docs/BIG2.md', 1000);
    expect(computeFileShrink(repo, 'docs/BIG2.md', Array.from({ length: 600 }, () => 'x').join('\n')).shrinkWarning).toBe(true);
    // a large file barely trimmed (1000 → 960, deletes 41) does NOT warn — no rule trips
    expect(computeFileShrink(repo, 'docs/BIG2.md', Array.from({ length: 960 }, () => 'x').join('\n')).shrinkWarning).toBe(false);
  });

  it('flags a moderate fractional drop that clears the moderate rule (≤75% and ≥50 deleted)', () => {
    writeRepoFile('docs/M.md', 200); // 201 lines
    // 201 → 150: keeps ~75%, deletes 51 → moderate rule warns
    expect(computeFileShrink(repo, 'docs/M.md', Array.from({ length: 150 }, () => 'x').join('\n')).shrinkWarning).toBe(true);
    // 201 → 190: keeps ~95%, deletes 11 → below every rule, no warn
    expect(computeFileShrink(repo, 'docs/M.md', Array.from({ length: 190 }, () => 'x').join('\n')).shrinkWarning).toBe(false);
  });

  it('computeProposalShrinks maps every file', () => {
    writeRepoFile('a.md', 100);
    const rs = computeProposalShrinks(repo, [{ relPath: 'a.md', content: 'x' }, { relPath: 'b.md', content: 'y' }]);
    expect(rs.length).toBe(2);
    expect(rs[0].shrinkWarning).toBe(true);   // existing, truncated
    expect(rs[1].existsInRepo).toBe(false);   // new file
  });
});
