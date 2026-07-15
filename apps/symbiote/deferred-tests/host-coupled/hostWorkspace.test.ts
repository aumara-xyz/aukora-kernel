import { describe, it, expect } from 'vitest';
import { hostWorkspace } from '../src/hostWorkspace';

/**
 * 24Z.61 — Workspace context V0 is read-only, names-only, secrets-excluded, and path-jailed to the repo.
 */
const SECRET = /\.env|\.aukora|admin[-_]?key|auth\.json|node_modules|\.git\/|\.(key|pem|p12|keystore)$|id_rsa|credentials/i;

describe('workspace context — read-only, secrets excluded, path-jailed', () => {
  it('the tree + changed lists never include secret/runtime paths', () => {
    const w = hostWorkspace('');
    expect(w.ok).toBe(true);
    const paths = [...w.tree.map((e) => e.path), ...w.changed.map((c) => c.path)];
    for (const p of paths) expect(p, `excluded path leaked: ${p}`).not.toMatch(SECRET);
  });
  it('drilling into a real subdir stays excluded + jailed', () => {
    const w = hostWorkspace('internal');
    expect(w.subdir).toBe('internal');
    for (const e of w.tree) expect(e.path).not.toMatch(SECRET);
  });
  it('a ../ escape is rejected (path-jailed to the repo)', () => {
    expect(hostWorkspace('../../../etc').subdir).toBe('');
    expect(hostWorkspace('../../..').subdir).toBe('');
  });
  it('names only — no file contents are returned', () => {
    const json = JSON.stringify(hostWorkspace('internal'));
    expect(json).not.toMatch(/"content"|"afterContent"|"body"|"text":"/);
    // every tree entry is exactly {path, type}
    for (const e of hostWorkspace('').tree) expect(Object.keys(e).sort()).toEqual(['path', 'type']);
  });
});
