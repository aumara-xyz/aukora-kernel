// SAFETY_LAWS 2 — as AMENDED 2026-07-05 (owner-ratified D1, docs/LOCAL_CONVEX_BRAIN_FOUNDATION.md §4):
// the local self-hosted Convex deployment (loopback-only) is the canonical advisory-memory organ;
// writes flow only through the registered memory mutations; any REMOTE Convex deployment remains
// read-only; no Convex path touches Ring-0, the gate, or the apply lane.
//
// This test was REWRITTEN, not deleted (the fence moved; it did not come down). The old form banned
// every `.mutation(` call in the seed runtime — correct while Convex was a passive cloud mirror.
// The new boundary it enforces:
//   1. Client `.mutation(` calls exist ONLY in the registered memory module (core/src/memoryAppend.ts).
//      Every other runtime file — including the spatial door, which the old test never scanned — has none.
//   2. The vendored kernel (convex/) exposes ZERO public function registrations: every endpoint is
//      internalMutation/internalQuery/internalAction, unreachable via bare /api/mutation without the
//      admin credential (the S1a conversion the review demanded).
//   3. Zero `"use node"` directives in the vendored kernel (Node-off-PATH fail-closed stays meaningful).
//   4. Zero non-loopback Convex URLs anywhere in the runtime or kernel, outside the one deny-list
//      definition (convexBrainReadonly.ts CLOUD_DENY) whose job is to name them in order to refuse them.
//   5. If the registered memory module exists, it stamps advisoryOnly:true + grantsAuthority:false —
//      memory writes carry no authority, per the amended law and SAFETY_LAWS 1.
// Scope honesty (Law 2 honesty clause): these are static guarantees about the SEED TREE; they hold
// against every actor WITHOUT the self-hosted admin key. Admin-key custody is an owner-ceremony matter.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

const SEED = join(__dirname, '..', '..'); // core/tests -> seed root
// Runtime scan set: the old list + spatial (the door became a Convex-adjacent runtime in S1a planning;
// scanning it closes the "browser/door writes directly" hole instead of assuming it).
const RUNTIME = ['core/src', 'memory', 'authority', 'spatial'];
// The ONE registered client write module (Brick W3). Until it exists, rule 1 degrades to the old
// total ban — fail-closed in both worlds.
const REGISTERED_WRITE_MODULE = 'core/src/memoryAppend.ts';
// The deny-list that must be allowed to NAME cloud hosts in order to refuse them.
const CLOUD_DENYLIST_FILES = ['core/src/convexBrainReadonly.ts'];

function tsFiles(rel: string, opts: { excludeDirs?: string[] } = {}): string[] {
  const excl = new Set(['node_modules', ...(opts.excludeDirs ?? [])]);
  const out: string[] = [];
  const walk = (d: string) => {
    let ents: string[]; try { ents = readdirSync(d); } catch { return; }
    for (const e of ents) {
      const p = join(d, e);
      let s; try { s = statSync(p); } catch { continue; }
      if (s.isDirectory()) { if (!excl.has(e)) walk(p); }
      else if (e.endsWith('.ts')) out.push(p);
    }
  };
  walk(join(SEED, rel));
  return out;
}

function stripLineComments(ln: string): string {
  return ln.replace(/\/\/.*$/, '');
}

describe('Convex governed-write invariant (SAFETY_LAWS 2, amended 2026-07-05)', () => {
  it('client .mutation( calls exist ONLY in the registered memory module', () => {
    const offenders: string[] = [];
    for (const rel of RUNTIME) {
      for (const f of tsFiles(rel)) {
        const relPath = f.replace(SEED + '/', '');
        if (relPath === REGISTERED_WRITE_MODULE) continue;
        readFileSync(f, 'utf-8').split('\n').forEach((ln, i) => {
          if (/\.mutation\s*\(/.test(stripLineComments(ln))) offenders.push(`${relPath}:${i + 1}`);
        });
      }
    }
    expect(offenders, `ungoverned Convex mutation() call sites: ${offenders.join(', ')}`).toEqual([]);
  });

  it('the vendored kernel registers ZERO public functions (internal-only surface)', () => {
    const offenders: string[] = [];
    // _generated is convex-tool output (type shims mention the public constructors by name);
    // tests exercise the kernel through convex-test, not the public HTTP surface.
    for (const f of tsFiles('convex', { excludeDirs: ['_generated', 'tests'] })) {
      const relPath = f.replace(SEED + '/', '');
      // strip line comments, then scan the whole file so a registration split across lines
      // (`mutation(\n  {`) is still caught. A PUBLIC registration is `mutation(`/`query(`/
      // `action(`/`httpAction(` followed by a config object and NOT the internal* constructor
      // (those differ by case: internalMutation/internalQuery/internalAction never match the
      // lowercase forms).
      const code = readFileSync(f, 'utf-8').split('\n').map(stripLineComments).join('\n');
      const re = /(?<![A-Za-z])(mutation|query|action|httpAction)\s*\(\s*\{/g;
      for (const m of code.matchAll(re)) {
        const line = code.slice(0, m.index).split('\n').length;
        offenders.push(`${relPath}:${line}`);
      }
    }
    expect(offenders, `public Convex function registrations: ${offenders.join(', ')}`).toEqual([]);
  });

  it('the vendored kernel contains ZERO "use node" directives', () => {
    const offenders: string[] = [];
    for (const f of tsFiles('convex', { excludeDirs: ['_generated', 'tests'] })) {
      const head = readFileSync(f, 'utf-8').slice(0, 512);
      if (/^\s*['"]use node['"]/m.test(head)) offenders.push(f.replace(SEED + '/', ''));
    }
    expect(offenders, `"use node" directives found: ${offenders.join(', ')}`).toEqual([]);
  });

  it('zero non-loopback Convex URLs outside the deny-list definition', () => {
    const offenders: string[] = [];
    for (const rel of [...RUNTIME, 'convex']) {
      for (const f of tsFiles(rel, { excludeDirs: ['_generated'] })) {
        const relPath = f.replace(SEED + '/', '');
        if (CLOUD_DENYLIST_FILES.includes(relPath)) continue;
        readFileSync(f, 'utf-8').split('\n').forEach((ln, i) => {
          if (/convex\.(cloud|dev|site)/.test(stripLineComments(ln))) offenders.push(`${relPath}:${i + 1}`);
        });
      }
    }
    expect(offenders, `hosted-Convex references outside the deny-list: ${offenders.join(', ')}`).toEqual([]);
  });

  it('the registered memory module (when present) stamps advisory/no-authority', () => {
    const p = join(SEED, REGISTERED_WRITE_MODULE);
    if (!existsSync(p)) return; // pre-W3: rule 1 already proves there is no client write path at all
    const src = readFileSync(p, 'utf-8');
    expect(src, 'memoryAppend must stamp advisoryOnly: true').toMatch(/advisoryOnly:\s*true/);
    expect(src, 'memoryAppend must stamp grantsAuthority: false').toMatch(/grantsAuthority:\s*false/);
  });
});

// W3c — the managed brain runtime must be loopback-only and never point at a stray host path.
describe('brain runtime invariants (W3c deploy lifecycle)', () => {
  it('DEFAULT-env runtime paths are all under the two controlled roots (keys ~/.aukora-symbiote, data repo state/)', async () => {
    const { resolveBrainPaths, isControlledRuntimePath } = await import('../src/convexBackendManager');
    const p = resolveBrainPaths({ repoRoot: '/repo', env: {} });
    for (const rp of [p.stateDir, p.adminKeyPath, p.instanceSecretPath]) {
      expect(isControlledRuntimePath(rp, '/repo'), `${rp} must be a controlled runtime path`).toBe(true);
    }
  });

  it('the boot argv is loopback-pinned and never contains 0.0.0.0', async () => {
    const { resolveBrainPaths, buildBootArgv } = await import('../src/convexBackendManager');
    const p = resolveBrainPaths({ repoRoot: '/repo', env: {} });
    const argv = buildBootArgv(p, 'sekret');
    const i = argv.indexOf('--interface');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(argv[i + 1]).toBe('127.0.0.1');
    expect(argv.join(' ')).not.toContain('0.0.0.0');
    expect(p.url.startsWith('http://127.0.0.1:')).toBe(true);
  });

  it('the manager never emits a non-loopback URL, even with a port override', async () => {
    const { resolveBrainPaths } = await import('../src/convexBackendManager');
    for (const port of ['3210', '3251', '9999']) {
      const p = resolveBrainPaths({ repoRoot: '/repo', env: { AUKORA_CONVEX_PORT: port } });
      expect(p.url).toBe(`http://127.0.0.1:${port}`);
    }
  });

  it('no runtime source hardcodes a personal home path (paths come from env/resolvers)', () => {
    // A stray "/Users/<name>/" literal in a runtime .ts is the drift class Codex warned about.
    const offenders: string[] = [];
    for (const rel of RUNTIME) {
      for (const f of tsFiles(rel)) {
        readFileSync(f, 'utf-8').split('\n').forEach((ln, i) => {
          const code = ln.replace(/\/\/.*$/, '');
          if (/["'`]\/Users\/[a-z]/i.test(code)) offenders.push(`${f.replace(SEED + '/', '')}:${i + 1}`);
        });
      }
    }
    expect(offenders, `hardcoded personal home paths: ${offenders.join(', ')}`).toEqual([]);
  });
});
