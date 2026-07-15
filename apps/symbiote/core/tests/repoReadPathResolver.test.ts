import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveRepoReadPath } from '../src/repoReadPathResolver';

// Fixture roots are created under the REALPATH'd tmpdir so the baseline (non-root-symlink) tests compare
// like-for-like; the dedicated root-symlink test below deliberately passes a symlinked spelling to pin rule 3.
// Unique prefixes matter under parallel vitest (see nativeIdeDispatcher.test.ts:237).
const TMP = fs.realpathSync(os.tmpdir());
const cleanups: string[] = [];
function freshRoot(tag: string): string {
  const d = fs.mkdtempSync(path.join(TMP, `repo-read-resolver-${tag}-`));
  cleanups.push(d);
  return d;
}
afterEach(() => {
  for (const p of cleanups.splice(0)) fs.rmSync(p, { recursive: true, force: true });
});

describe('repoReadPathResolver: normal in-repo reads resolve', () => {
  it('a normal file under the root resolves ok with correct abs/real/rel', () => {
    const root = freshRoot('normal');
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'note.md'), 'hello');
    const r = resolveRepoReadPath('docs/note.md', { root });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.real).toBe(path.join(root, 'docs', 'note.md'));
    expect(r.rel).toBe(path.join('docs', 'note.md'));
    expect(path.isAbsolute(r.abs)).toBe(true);
  });
});

describe('repoReadPathResolver: symlinks are denied (the #75 escape class)', () => {
  it('a FILE symlink pointing outside the root is refused, reason mentions symlink', () => {
    const root = freshRoot('filelink');
    const outside = freshRoot('filelink-outside');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'exfiltrate me');
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'link.md'));
    const r = resolveRepoReadPath('link.md', { root });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/symlink/i);
  });

  it('a DIRECTORY symlink pointing outside the root is refused when resolved directly', () => {
    const root = freshRoot('dirlink');
    const outside = freshRoot('dirlink-outside');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'exfiltrate me');
    fs.symlinkSync(outside, path.join(root, 'outdir'), 'dir');
    const r = resolveRepoReadPath('outdir', { root });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/symlink/i);
  });

  it('a file reached THROUGH a directory symlink is refused via realpath confinement', () => {
    const root = freshRoot('dirlink2');
    const outside = freshRoot('dirlink2-outside');
    // Deliberately a NON-sensitive filename so this exercises the realpath-confinement rule (5), not the
    // lexical sensitive rule (2) which fires first (a name like `secret.txt` would refuse earlier — proven
    // by the sensitive-policy tests below).
    fs.writeFileSync(path.join(outside, 'payload.txt'), 'exfiltrate me');
    fs.symlinkSync(outside, path.join(root, 'outdir'), 'dir');
    // The final component (payload.txt) is not itself a symlink, so lstat (rule 4) passes; realpath resolves
    // through the intermediate symlink to outside the root and confinement (rule 5) refuses it.
    const r = resolveRepoReadPath('outdir/payload.txt', { root });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/escape|realpath/i);
  });

  it('a DANGLING symlink is refused AS a symlink (not as "not found")', () => {
    const root = freshRoot('dangling');
    fs.symlinkSync(path.join(root, 'nonexistent-target-xyz'), path.join(root, 'dead.md'));
    const r = resolveRepoReadPath('dead.md', { root });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/symlink/i);
    expect(r.reason).not.toMatch(/not found/i);
  });
});

describe('repoReadPathResolver: lexical refusals (traversal / absolute / NUL / empty)', () => {
  const root = fs.realpathSync(os.tmpdir()); // any real dir; these refuse before touching it
  for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'a\u0000b', '']) {
    it(`refuses ${JSON.stringify(bad)}`, () => {
      const r = resolveRepoReadPath(bad, { root });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toMatch(/lexical/i);
    });
  }
});

describe('repoReadPathResolver: the root itself may be a symlinked spelling (rule 3, macOS /tmp class)', () => {
  it('a normal file still resolves when the ROOT is passed as a symlink to the real root', () => {
    const realRoot = freshRoot('rootlink-real');
    const linkRoot = path.join(TMP, `repo-read-resolver-rootlink-${process.pid}-${cleanups.length}`);
    fs.symlinkSync(realRoot, linkRoot, 'dir');
    cleanups.push(linkRoot);
    fs.writeFileSync(path.join(realRoot, 'note.md'), 'hi');
    const r = resolveRepoReadPath('note.md', { root: linkRoot });
    expect(r.ok).toBe(true); // resolver realpaths the root, so a symlinked root spelling does not false-refuse
    if (!r.ok) return;
    expect(r.real).toBe(path.join(realRoot, 'note.md')); // confined to the REAL root
  });
});

describe('repoReadPathResolver: sensitive-path policy is uniform (no opt-out)', () => {
  it('refuses a lexically sensitive rel (key material) before touching the filesystem', () => {
    const root = freshRoot('sensitive');
    const r = resolveRepoReadPath('deploy.pem', { root }); // never created — refused before existence check
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/sensitive/i);
  });

  it('refuses an EXISTING secret-named file — there is no way to opt out (the closed #75 leak)', () => {
    const root = freshRoot('secret-named');
    // A real, present file whose name matches a genuine-secret pattern. Every consumer — the read tools AND
    // kiraBrain.ingestSelfMap — gets this same refusal; an earlier opt-out that would have admitted such
    // files into the persistent brain was removed after adversarial review.
    fs.writeFileSync(path.join(root, 'auth.json'), '{"token":"nope"}\n');
    const r = resolveRepoReadPath('auth.json', { root });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/sensitive/i);
  });
});
