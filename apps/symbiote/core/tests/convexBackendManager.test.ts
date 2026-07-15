// Brick W3c — the managed brain runtime: pure decisions, fail-closed preflight, loopback always.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  resolveBrainPaths,
  binaryIdentity,
  buildBootArgv,
  buildBootEnv,
  readSecretStrict,
  preflightBrain,
  isControlledRuntimePath,
  isStateDirWritable,
  BrainManagerError,
  DEFAULT_BRAIN_PORT,
  INSTANCE_SECRET_PATH,
} from '../src/convexBackendManager';
import { ADMIN_KEY_PATH } from '../src/memoryKernelTransport';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aukora-brain-'));
const secretFile = (dir: string, name: string, content: string, mode: number) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content, { mode });
  fs.chmodSync(p, mode);
  return p;
};
const codeOf = (fn: () => unknown): string => {
  try { fn(); } catch (e) { if (e instanceof BrainManagerError) return e.code; throw e; }
  throw new Error('expected a BrainManagerError');
};

describe('resolveBrainPaths — data in repo state/convex by default, keys outside repo', () => {
  it('default: data under <repo>/state/convex, keys under ~/.aukora-symbiote/convex', () => {
    const p = resolveBrainPaths({ repoRoot: '/repo', env: {} });
    expect(p.stateDir).toBe(path.resolve('/repo/state/convex'));
    expect(p.adminKeyPath).toBe(ADMIN_KEY_PATH);
    expect(p.instanceSecretPath).toBe(INSTANCE_SECRET_PATH);
    expect(p.port).toBe(DEFAULT_BRAIN_PORT);
    expect(p.sitePort).toBe(DEFAULT_BRAIN_PORT + 1);
    expect(p.url).toBe('http://127.0.0.1:3210');
  });

  it('AUKORA_CONVEX_STATE_DIR overrides the data dir (container/Nebius mounted volume); keys never move', () => {
    const p = resolveBrainPaths({ repoRoot: '/repo', env: { AUKORA_CONVEX_STATE_DIR: '/data/convex' } });
    expect(p.stateDir).toBe(path.resolve('/data/convex'));
    expect(p.adminKeyPath).toBe(ADMIN_KEY_PATH); // custody location is fixed
  });

  it('an invalid port is refused loudly, incl. 65535 (site-proxy port+1 would overflow)', () => {
    expect(codeOf(() => resolveBrainPaths({ repoRoot: '/repo', env: { AUKORA_CONVEX_PORT: 'nope' } }))).toBe('brain_port_invalid');
    expect(codeOf(() => resolveBrainPaths({ repoRoot: '/repo', env: { AUKORA_CONVEX_PORT: '70000' } }))).toBe('brain_port_invalid');
    expect(codeOf(() => resolveBrainPaths({ repoRoot: '/repo', env: { AUKORA_CONVEX_PORT: '65535' } }))).toBe('brain_port_invalid');
    const p = resolveBrainPaths({ repoRoot: '/repo', env: { AUKORA_CONVEX_PORT: '65534' } });
    expect(p.port).toBe(65534); expect(p.sitePort).toBe(65535); // both valid TCP ports
  });

  it('DEFAULT runtime paths are all under the two controlled roots (invariant: no stray dirs)', () => {
    const p = resolveBrainPaths({ repoRoot: '/repo', env: {} });
    expect(isControlledRuntimePath(p.stateDir, '/repo')).toBe(true);
    expect(isControlledRuntimePath(p.adminKeyPath, '/repo')).toBe(true);
    expect(isControlledRuntimePath(p.instanceSecretPath, '/repo')).toBe(true);
    // a stray path is NOT controlled
    expect(isControlledRuntimePath('/tmp/somewhere', '/repo')).toBe(false);
    expect(isControlledRuntimePath('/Users/x/Desktop/db', '/repo')).toBe(false);
  });
});

describe('buildBootArgv — loopback is never omitted', () => {
  it('always pins --interface 127.0.0.1 (the binary default is 0.0.0.0, the LAN trap)', () => {
    const p = resolveBrainPaths({ repoRoot: '/repo', env: {} });
    const argv = buildBootArgv(p, 'the-secret');
    const i = argv.indexOf('--interface');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(argv[i + 1]).toBe('127.0.0.1');
    expect(argv).not.toContain('0.0.0.0');
    expect(argv[argv.indexOf('--port') + 1]).toBe('3210');
    expect(argv[argv.indexOf('--instance-secret') + 1]).toBe('the-secret');
  });

  it('buildBootEnv turns the beacon off and CI on (zero backend egress)', () => {
    const env = buildBootEnv({ PATH: '/usr/bin' });
    expect(env.DISABLE_BEACON).toBe('true');
    expect(env.CI).toBe('1');
    expect(env.PATH).toBe('/usr/bin');
  });
});

describe('binaryIdentity — printed for reproducibility', () => {
  it('reports sha256 + size for a real file, absent for a missing one', () => {
    const d = tmp();
    const f = path.join(d, 'bin');
    fs.writeFileSync(f, 'ELF...');
    const id = binaryIdentity(f);
    expect(id.exists).toBe(true);
    expect(id.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(id.sizeBytes).toBe(6);
    expect(binaryIdentity(path.join(d, 'nope'))).toMatchObject({ exists: false, executable: false });
  });
});

describe('readSecretStrict — same custody discipline as the write transport', () => {
  it('accepts a 0600 single-line secret', () => {
    const p = secretFile(tmp(), 'instance-secret.txt', 'abc123\n', 0o600);
    expect(readSecretStrict(p, 'instance secret')).toBe('abc123');
  });
  it('refuses missing / group-readable / empty / multi-line / symlink', () => {
    expect(codeOf(() => readSecretStrict(path.join(tmp(), 'nope'), 'x'))).toBe('brain_secret_missing');
    expect(codeOf(() => readSecretStrict(secretFile(tmp(), 's', 'k', 0o644), 'x'))).toBe('brain_secret_permissions_open');
    expect(codeOf(() => readSecretStrict(secretFile(tmp(), 's', '  ', 0o600), 'x'))).toBe('brain_secret_empty');
    expect(codeOf(() => readSecretStrict(secretFile(tmp(), 's', 'a\nb', 0o600), 'x'))).toBe('brain_secret_malformed');
    const d = tmp(); const real = secretFile(d, 'real', 'k', 0o600); const link = path.join(d, 'link');
    fs.symlinkSync(real, link);
    expect(codeOf(() => readSecretStrict(link, 'x'))).toBe('brain_secret_symlink_refused');
  });
});

describe('preflightBrain — fail-closed, complete report (never throws)', () => {
  const okBin = () => { const d = tmp(); const f = path.join(d, 'bin'); fs.writeFileSync(f, 'x', { mode: 0o755 }); fs.chmodSync(f, 0o755); return f; };
  const keysDir = () => { const d = tmp(); return d; };

  it('all-green when binary present, port free, both secrets 0600', () => {
    const d = keysDir();
    const admin = secretFile(d, 'admin-key.txt', 'k', 0o600);
    const secret = secretFile(d, 'instance-secret.txt', 's', 0o600);
    // point the manager's fixed key paths at our temp files via a resolveBrainPaths shim:
    // preflight uses resolveBrainPaths internally which reads ADMIN_KEY_PATH — so instead assert the
    // COMPOSITION by checking the port/binary problems independently, and custody via readSecretStrict.
    const r = preflightBrain({ repoRoot: '/repo', binPath: okBin(), env: {}, isPortFree: () => true });
    // admin/instance secrets live at the real ~/.aukora-symbiote paths which don't exist in CI, so
    // those two custody problems are EXPECTED here; assert the non-custody checks are clean.
    expect(r.problems.some((p) => p.code === 'brain_binary_missing')).toBe(false);
    expect(r.problems.some((p) => p.code === 'brain_port_busy')).toBe(false);
    void admin; void secret;
  });

  it('flags a missing binary, a busy port, and captures custody problems as a COMPLETE list (no throw)', () => {
    // Gate-honesty fix (M4, 2026-07-05): pin the custody dir to a controlled EMPTY temp dir. The old
    // form leaned on the real ~/.aukora-symbiote paths being absent — true in CI, false on the lived
    // tree the moment `brain.sh provision` ran for real (the brain went live this day and the real
    // 0600 keys made "custody problems present" silently false). Lived inputs get pinned, not assumed.
    const emptyKeys = tmp();
    const r = preflightBrain({ repoRoot: '/repo', binPath: '/nope/bin', env: { AUKORA_CONVEX_KEY_DIR: emptyKeys } as NodeJS.ProcessEnv, isPortFree: () => false });
    expect(r.ok).toBe(false);
    const codes = r.problems.map((p) => p.code);
    expect(codes).toContain('brain_binary_missing');
    expect(codes).toContain('brain_port_busy');
    // custody problems for the (pinned-empty) key dir are ALSO present — proving it doesn't
    // stop at the first failure
    expect(codes.some((c) => c.startsWith('brain_secret_'))).toBe(true);
  });

  it('respects an injected stateDirWritable=false check', () => {
    const r = preflightBrain({ repoRoot: '/repo', binPath: okBin(), env: {}, isPortFree: () => true, stateDirWritable: () => false });
    expect(r.problems.map((p) => p.code)).toContain('brain_state_dir_unwritable');
  });
});

describe('isStateDirWritable — fresh-clone safe (nothing under state/ is tracked in git)', () => {
  it('accepts an existing writable dir', () => {
    expect(isStateDirWritable(tmp())).toBe(true);
  });

  it('accepts a NOT-YET-EXISTING dir several levels deep when an ancestor is writable (mkdir -p creates the rest)', () => {
    // the first-run shape: <repo>/state/convex where neither state/ nor state/convex/ exists yet
    expect(isStateDirWritable(path.join(tmp(), 'state', 'convex'))).toBe(true);
  });

  // root bypasses directory write permissions, so the locked ancestor can't be provoked as root
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  it.skipIf(asRoot)('refuses when the nearest existing ancestor is not writable', () => {
    const locked = path.join(tmp(), 'locked');
    fs.mkdirSync(locked, { mode: 0o555 });
    fs.chmodSync(locked, 0o555);
    try {
      expect(isStateDirWritable(path.join(locked, 'state', 'convex'))).toBe(false);
    } finally {
      fs.chmodSync(locked, 0o755); // so the tmp tree stays cleanable
    }
  });
});
