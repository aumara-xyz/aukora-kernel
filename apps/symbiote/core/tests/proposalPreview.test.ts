// #105 read layer — the diff preview. The safety properties under test: it is READ-ONLY, BOUNDED, and
// SECRET-SCANNED, and it refuses (leaks nothing) for a path the #75 resolver would deny. A hermetic temp
// repo stands in for the real tree so the resolver's confinement + the diff logic are pinned exactly.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { computeProposalPreview } from '../src/proposalPreview';

let repo: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-preview-'));
  fs.mkdirSync(path.join(repo, 'core', 'src'), { recursive: true });
});
afterEach(() => { try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* best-effort */ } });

const write = (rel: string, content: string) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), content); };

describe('computeProposalPreview — bounded, secret-scanned, read-only diff', () => {
  it('shows the changed middle of a large file with +/- and context, correct counts', () => {
    const disk = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n') + '\n';
    write('core/src/x.ts', disk);
    const proposed = disk.replace('line 20', '// new comment\nline 20');
    const pv = computeProposalPreview(repo, 'core/src/x.ts', proposed);
    expect(pv.isNewFile).toBe(false);
    expect(pv.addedLines).toBe(1);
    expect(pv.removedLines).toBe(0);
    expect(pv.hunk).toContain('+ // new comment');
    expect(pv.hunk).toContain(' line 19'); // context before
    expect(pv.hunk).toContain(' line 20'); // context after
    expect(pv.hunk).not.toContain('line 0'); // far-away identical lines trimmed away
    expect(pv.refusedReason).toBeNull();
  });

  it('a new file (no disk target) shows the whole content as added', () => {
    const pv = computeProposalPreview(repo, 'core/src/new.ts', 'a\nb\n');
    expect(pv.isNewFile).toBe(true);
    expect(pv.removedLines).toBe(0);
    expect(pv.addedLines).toBe(2);
    expect(pv.hunk).toContain('(new file)');
  });

  it('identical content produces no hunk', () => {
    write('core/src/x.ts', 'a\nb\n');
    const pv = computeProposalPreview(repo, 'core/src/x.ts', 'a\nb\n');
    expect(pv.hunk).toBe('');
    expect(pv.addedLines).toBe(0);
    expect(pv.removedLines).toBe(0);
  });

  it('WITHHOLDS a secret-shaped line — the secret never appears in the preview', () => {
    write('core/src/x.ts', 'a\nb\n');
    const secret = '-----BEGIN OPENSSH PRIVATE KEY-----';
    const pv = computeProposalPreview(repo, 'core/src/x.ts', `a\n${secret}\nb\n`);
    expect(pv.secretRedacted).toBe(true);
    expect(pv.hunk).toContain('[line withheld — scanned as secret-shaped]');
    expect(pv.hunk).not.toContain(secret); // the load-bearing assertion: the secret is NOT served
  });

  it('WITHHOLDS the BROADER secret classes on CONTEXT and REMOVED lines (adversarial-review regression)', () => {
    // The narrow forbiddenContent scanner missed these; the union with SECRET_CONTENT_PATTERNS closes it.
    // Each secret sits on a disk line that becomes CONTEXT or REMOVED in the diff — the exact leak vector.
    const secrets = [
      'const k = "AKIA' + 'ABCDEFGHIJKLMNOP' + '";',      // AWS access key id
      'const t = "ghp_' + 'a'.repeat(36) + '";',           // GitHub token
      'const s = "xoxb-' + '1234567890-abcdefghij' + '";', // Slack token
      'apiKey = "abcdefghij0123456789XYZ"',                // hardcoded credential
    ];
    for (const secret of secrets) {
      // secret on a CONTEXT line (unchanged), change happens on an adjacent line
      write('core/src/x.ts', `top\n${secret}\nbottom\n`);
      const ctxPv = computeProposalPreview(repo, 'core/src/x.ts', `TOP\n${secret}\nbottom\n`);
      expect(ctxPv.hunk).not.toContain(secret);
      expect(ctxPv.secretRedacted).toBe(true);
      // secret on a REMOVED line
      write('core/src/y.ts', `${secret}\nkeep\n`);
      const remPv = computeProposalPreview(repo, 'core/src/y.ts', `keep\n`);
      expect(remPv.hunk).not.toContain(secret);
      expect(remPv.secretRedacted).toBe(true);
    }
  });

  it('REFUSES a sensitive/secret path (existing) — no preview, reason stated, nothing leaked', () => {
    write('.env', 'SECRET=on-disk\n');
    const pv = computeProposalPreview(repo, '.env', 'SECRET=changed\n');
    expect(pv.hunk).toBe('');
    expect(pv.refusedReason).toBeTruthy();
    expect(pv.hunk).not.toContain('changed');
  });

  it('REFUSES a sensitive path even for a NEW file (never previews a proposal that adds a secret file)', () => {
    // .env does not exist in the temp repo — a sensitive path must still refuse, not read as "new file"
    const pv = computeProposalPreview(repo, 'core/src/aumlokSigner.ts', 'export const x = "leak";\n');
    expect(pv.hunk).toBe('');
    expect(pv.refusedReason).toBeTruthy();
    expect(pv.hunk).not.toContain('leak');
  });

  it('is BOUNDED — a huge change is truncated, never floods the response', () => {
    write('core/src/x.ts', 'header\n');
    const huge = 'header\n' + Array.from({ length: 5000 }, (_, i) => `added ${i}`).join('\n') + '\n';
    const pv = computeProposalPreview(repo, 'core/src/x.ts', huge);
    expect(pv.truncated).toBe(true);
    expect(pv.hunk.length).toBeLessThan(9000); // hard char cap holds
  });

  it('never throws on a garbage relPath', () => {
    expect(() => computeProposalPreview(repo, '', 'x')).not.toThrow();
    expect(() => computeProposalPreview(repo, '../../etc/passwd', 'x')).not.toThrow();
  });
});
