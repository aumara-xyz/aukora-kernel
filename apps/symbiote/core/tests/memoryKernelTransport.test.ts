// Brick W3b — transport custody + guards, all hermetic (no backend, no network, no real CLI).
// The properties Codex asked to see named: where the invoke lives (this module), where the key
// is stored (~/.aukora-symbiote/convex/admin-key.txt — here exercised via temp paths), how
// 0600/custody is checked (lstat: regular file, no symlink, no group/other bits, single-line
// non-empty), and how failures surface WITHOUT fallback writes (typed loud throws, one attempt,
// key material scrubbed from messages).
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  readAdminKeyStrict,
  createGovernedInvoke,
  createGovernedHttpInvoke,
  MemoryKernelTransportError,
  ADMIN_KEY_PATH,
  type RunCli,
  type HttpFetch,
} from '../src/memoryKernelTransport';
import { memoryAppend, REGISTERED_GOVERNED_MUTATION } from '../src/memoryAppend';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aukora-transport-'));

function keyFile(dir: string, content: string, mode: number): string {
  const p = path.join(dir, 'admin-key.txt');
  fs.writeFileSync(p, content, { mode });
  fs.chmodSync(p, mode); // writeFileSync mode is masked by umask — set it explicitly
  return p;
}

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof MemoryKernelTransportError) return e.code;
    throw e;
  }
  throw new Error('expected a MemoryKernelTransportError');
};

describe('admin key custody (strict, loud, fail-closed)', () => {
  it('default custody path is under ~/.aukora-symbiote/convex/', () => {
    expect(ADMIN_KEY_PATH).toBe(path.join(os.homedir(), '.aukora-symbiote', 'convex', 'admin-key.txt'));
  });

  it('a good 0600 single-line key reads cleanly', () => {
    const p = keyFile(tmp(), 'convex-self-hosted|key123\n', 0o600);
    expect(readAdminKeyStrict(p)).toBe('convex-self-hosted|key123');
  });

  it('0400 (owner read-only) is also acceptable custody', () => {
    const p = keyFile(tmp(), 'k', 0o400);
    expect(readAdminKeyStrict(p)).toBe('k');
  });

  it('missing key throws admin_key_missing — never a silent null (the old adapter failure mode)', () => {
    expect(codeOf(() => readAdminKeyStrict(path.join(tmp(), 'nope.txt')))).toBe('admin_key_missing');
  });

  it('group- or world-readable keys are REFUSED, not warned about (0644 was the old backend reality)', () => {
    for (const mode of [0o644, 0o640, 0o604, 0o660]) {
      const p = keyFile(tmp(), 'k', mode);
      expect(codeOf(() => readAdminKeyStrict(p)), `mode ${mode.toString(8)}`).toBe('admin_key_permissions_open');
    }
  });

  it('an empty key file throws admin_key_empty', () => {
    const p = keyFile(tmp(), '   \n', 0o600);
    expect(codeOf(() => readAdminKeyStrict(p))).toBe('admin_key_empty');
  });

  it('a multi-line key file throws admin_key_malformed', () => {
    const p = keyFile(tmp(), 'k1\nk2', 0o600);
    expect(codeOf(() => readAdminKeyStrict(p))).toBe('admin_key_malformed');
  });

  it('a symlinked key is refused even when its target is 0600', () => {
    const d = tmp();
    const real = keyFile(d, 'k', 0o600);
    const link = path.join(d, 'link-key.txt');
    fs.symlinkSync(real, link);
    expect(codeOf(() => readAdminKeyStrict(link))).toBe('admin_key_symlink_refused');
  });
});

const goodDeps = (runCli: RunCli, over: Partial<Parameters<typeof createGovernedInvoke>[0]> = {}) => {
  const d = tmp();
  const adminKeyPath = keyFile(d, 'SECRET-ADMIN-KEY-abc123', 0o600);
  return createGovernedInvoke({ url: 'http://127.0.0.1:3210', adminKeyPath, appRoot: d, runCli, ...over });
};

const PAYLOAD = { req: { action: 'memory.write' }, subjectSig: 'sig', value: 'v' };

describe('governed invoke guards', () => {
  it('refuses any function path other than the registered governed mutation', async () => {
    const runCli = vi.fn(() => '{}');
    const invoke = goodDeps(runCli as RunCli);
    await expect(invoke('aukoraRuntime:submitIntent' as never, PAYLOAD)).rejects.toMatchObject({ code: 'transport_function_not_registered' });
    expect(runCli).not.toHaveBeenCalled();
  });

  it('refuses non-loopback URLs before reading the key or spawning anything', async () => {
    const runCli = vi.fn(() => '{}');
    const invoke = goodDeps(runCli as RunCli, { url: 'https://quirky-robin-188.convex.cloud' });
    await expect(invoke(REGISTERED_GOVERNED_MUTATION, PAYLOAD)).rejects.toMatchObject({ code: 'transport_nonloopback_refused' });
    expect(runCli).not.toHaveBeenCalled();
  });

  it('requires an explicit app root (the wrong-root silent-zero-functions footgun)', () => {
    expect(() => createGovernedInvoke({ appRoot: '' as never, runCli: vi.fn() as never })).toThrow(/transport_app_root_required/);
  });

  it('happy path: one CLI call, argv (no shell), self-hosted env + CI=1, JSON result returned', async () => {
    const calls: Array<{ cmd: string; args: string[]; env: Record<string, string | undefined> }> = [];
    const runCli: RunCli = (cmd, args, opts) => {
      calls.push({ cmd, args, env: opts.env });
      return 'preamble text\n{"ok":true,"receiptHash":"r","memoryHash":"m"}\n';
    };
    const invoke = goodDeps(runCli);
    const res = await invoke(REGISTERED_GOVERNED_MUTATION, PAYLOAD);
    expect(res).toEqual({ ok: true, receiptHash: 'r', memoryHash: 'm' });
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe('npx');
    expect(calls[0].args.slice(0, 3)).toEqual(['convex', 'run', REGISTERED_GOVERNED_MUTATION]);
    expect(JSON.parse(calls[0].args[3])).toEqual(PAYLOAD);
    expect(calls[0].env.CONVEX_SELF_HOSTED_URL).toBe('http://127.0.0.1:3210');
    expect(calls[0].env.CONVEX_SELF_HOSTED_ADMIN_KEY).toBe('SECRET-ADMIN-KEY-abc123');
    expect(calls[0].env.CI).toBe('1');
  });

  it('a kernel/CLI failure surfaces LOUD, once, with the admin key scrubbed from the message', async () => {
    const runCli = vi.fn(() => {
      const err = new Error('convex run failed: aumlok_mem_no_authority (auth SECRET-ADMIN-KEY-abc123)') as Error & { stderr?: string };
      err.stderr = 'Error: aumlok_mem_no_authority — key SECRET-ADMIN-KEY-abc123';
      throw err;
    });
    const invoke = goodDeps(runCli as RunCli);
    let thrown: MemoryKernelTransportError | null = null;
    try {
      await invoke(REGISTERED_GOVERNED_MUTATION, PAYLOAD);
    } catch (e) {
      thrown = e as MemoryKernelTransportError;
    }
    expect(thrown?.code).toBe('transport_kernel_call_failed');
    expect(thrown?.message).toContain('aumlok_mem_no_authority'); // the kernel's reason rides through
    expect(thrown?.message).not.toContain('SECRET-ADMIN-KEY-abc123'); // the key never does
    expect(thrown?.message).toContain('[admin-key redacted]');
    expect(runCli).toHaveBeenCalledTimes(1); // one attempt — no retry loop
  });

  it('non-JSON CLI output is a typed failure, not a guessed success', async () => {
    const invoke = goodDeps((() => 'Deployed 0 functions.') as RunCli);
    await expect(invoke(REGISTERED_GOVERNED_MUTATION, PAYLOAD)).rejects.toMatchObject({ code: 'transport_result_unparseable' });
  });
});

describe('memoryAppend + transport, composed (still hermetic)', () => {
  const REQ = {
    action: 'memory.write' as const,
    ring: 'local-write' as const,
    key: 'note.one',
    ownerRootId: 'root.alpha',
    resource: 'mem:root.alpha',
    manifestId: 'mft.none',
    timestamp: 1_751_700_000_000,
    useSeq: 0,
  };

  it('a kernel refusal becomes a refused no-authority envelope with the transport code visible', async () => {
    const runCli: RunCli = () => {
      throw new Error('aumlok_mft_not_found');
    };
    const invoke = goodDeps(runCli);
    const r = await memoryAppend(
      { req: REQ, subjectSig: 'sig', value: 'x' },
      { deploymentUrl: 'http://127.0.0.1:3210', invoke: invoke as never },
    );
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.refused).toContain('memory_append_kernel_refused');
      expect(r.refused).toContain('aumlok_mft_not_found');
      expect(r.transportInvoked).toBe(true);
    }
    expect(r.advisoryOnly).toBe(true);
    expect(r.grantsAuthority).toBe(false);
  });

  it('custody violations refuse the append too — a 0644 key can never carry a write', async () => {
    const d = tmp();
    const adminKeyPath = keyFile(d, 'k', 0o644);
    const runCli = vi.fn(() => '{}');
    const invoke = createGovernedInvoke({ url: 'http://127.0.0.1:3210', adminKeyPath, appRoot: d, runCli: runCli as RunCli });
    const r = await memoryAppend(
      { req: REQ, subjectSig: 'sig', value: 'x' },
      { deploymentUrl: 'http://127.0.0.1:3210', invoke: invoke as never },
    );
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.refused).toContain('admin_key_permissions_open');
    expect(runCli).not.toHaveBeenCalled(); // custody refusal happened before any CLI spawn
  });
});

// ── W3c HTTP transport (PRIMARY) — same custody/guards, different wire ──────────────────────────────
function httpKeyDeps(fetchImpl: HttpFetch, key = 'SECRET-ADMIN-KEY-abc123', url = 'http://127.0.0.1:3210') {
  const adminKeyPath = keyFile(tmp(), key, 0o600);
  return createGovernedHttpInvoke({ url, adminKeyPath, httpFetch: fetchImpl });
}
const okResp = (obj: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(obj) });

describe('W3c HTTP invoke: same guards as the CLI path', () => {
  it('happy path: one POST to /api/mutation with the admin bearer; returns the mutation value', async () => {
    const calls: Array<{ url: string; init: any }> = [];
    const fetchImpl: HttpFetch = async (url, init) => { calls.push({ url, init }); return okResp({ status: 'success', value: { ok: true, receiptHash: 'r', memoryHash: 'm' } }); };
    const invoke = httpKeyDeps(fetchImpl);
    const res = await invoke(REGISTERED_GOVERNED_MUTATION, PAYLOAD);
    expect(res).toEqual({ ok: true, receiptHash: 'r', memoryHash: 'm' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://127.0.0.1:3210/api/mutation');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers.authorization).toBe('Convex SECRET-ADMIN-KEY-abc123');
    const sent = JSON.parse(calls[0].init.body);
    expect(sent).toEqual({ path: REGISTERED_GOVERNED_MUTATION, args: PAYLOAD, format: 'json' });
  });

  it('refuses any function path other than the registered mutation, before any fetch', async () => {
    const fetchImpl = vi.fn(async () => okResp({ status: 'success', value: {} }));
    const invoke = httpKeyDeps(fetchImpl as unknown as HttpFetch);
    await expect(invoke('aukoraRuntime:submitIntent' as never, PAYLOAD)).rejects.toMatchObject({ code: 'transport_function_not_registered' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a non-loopback URL before reading the key or fetching', async () => {
    const fetchImpl = vi.fn(async () => okResp({ status: 'success', value: {} }));
    const invoke = httpKeyDeps(fetchImpl as unknown as HttpFetch, 'k', 'https://quirky-robin-188.convex.cloud');
    await expect(invoke(REGISTERED_GOVERNED_MUTATION, PAYLOAD)).rejects.toMatchObject({ code: 'transport_nonloopback_refused' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('a 0644 key refuses before any fetch (custody is enforced identically to the CLI path)', async () => {
    const adminKeyPath = keyFile(tmp(), 'k', 0o644);
    const fetchImpl = vi.fn(async () => okResp({ status: 'success', value: {} }));
    const invoke = createGovernedHttpInvoke({ url: 'http://127.0.0.1:3210', adminKeyPath, httpFetch: fetchImpl as unknown as HttpFetch });
    await expect(invoke(REGISTERED_GOVERNED_MUTATION, PAYLOAD)).rejects.toMatchObject({ code: 'admin_key_permissions_open' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('a kernel refusal (status:error) surfaces LOUD with the reason, key scrubbed', async () => {
    const fetchImpl: HttpFetch = async () => okResp({ status: 'error', errorMessage: 'Uncaught Error: aumlok_mem_no_authority (key SECRET-ADMIN-KEY-abc123)' });
    const invoke = httpKeyDeps(fetchImpl);
    let thrown: MemoryKernelTransportError | null = null;
    try { await invoke(REGISTERED_GOVERNED_MUTATION, PAYLOAD); } catch (e) { thrown = e as MemoryKernelTransportError; }
    expect(thrown?.code).toBe('transport_kernel_call_failed');
    expect(thrown?.message).toContain('aumlok_mem_no_authority');
    expect(thrown?.message).not.toContain('SECRET-ADMIN-KEY-abc123');
    expect(thrown?.message).toContain('[admin-key redacted]');
  });

  it('a non-200 HTTP status is a typed failure (e.g. bearer rejected → FunctionPathNotFound)', async () => {
    const fetchImpl: HttpFetch = async () => ({ ok: false, status: 400, text: async () => '{"code":"FunctionPathNotFound"}' });
    const invoke = httpKeyDeps(fetchImpl);
    await expect(invoke(REGISTERED_GOVERNED_MUTATION, PAYLOAD)).rejects.toMatchObject({ code: 'transport_http_status' });
  });

  it('a network failure is a typed failure, not a silent null', async () => {
    const fetchImpl: HttpFetch = async () => { throw new Error('ECONNREFUSED 127.0.0.1:3210'); };
    const invoke = httpKeyDeps(fetchImpl);
    await expect(invoke(REGISTERED_GOVERNED_MUTATION, PAYLOAD)).rejects.toMatchObject({ code: 'transport_http_failed' });
  });

  it('an over-cap response body is a distinct LOUD failure (DoS guard), never a swallowed OOM', async () => {
    // realHttpFetch bounds the read and throws response_too_large; simulate that here…
    const overflowOnFetch: HttpFetch = async () => { throw new Error('response_too_large: backend body exceeded 1048576 bytes'); };
    await expect(httpKeyDeps(overflowOnFetch)(REGISTERED_GOVERNED_MUTATION, PAYLOAD)).rejects.toMatchObject({ code: 'transport_response_too_large' });
    // …and if a runtime instead throws while stringifying the body, that too surfaces (not swallowed to '')
    const overflowOnText: HttpFetch = async () => ({ ok: true, status: 200, text: async () => { throw new Error('Cannot create a string longer than 0x1fffffe8 characters'); } });
    await expect(httpKeyDeps(overflowOnText)(REGISTERED_GOVERNED_MUTATION, PAYLOAD)).rejects.toMatchObject({ code: 'transport_response_too_large' });
  });

  it('composes with memoryAppend: an HTTP kernel refusal becomes a refused no-authority envelope', async () => {
    const HTTP_REQ = {
      action: 'memory.write' as const, ring: 'local-write' as const, key: 'note.one',
      ownerRootId: 'root.alpha', resource: 'mem:root.alpha', manifestId: 'mft.none',
      timestamp: 1_751_700_000_000, useSeq: 0,
    };
    const fetchImpl: HttpFetch = async () => okResp({ status: 'error', errorMessage: 'aumlok_mft_not_found' });
    const invoke = httpKeyDeps(fetchImpl);
    const r = await memoryAppend({ req: HTTP_REQ, subjectSig: 'sig', value: 'x' }, { deploymentUrl: 'http://127.0.0.1:3210', invoke: invoke as never });
    expect(r.ok).toBe(false);
    if (r.ok === false) { expect(r.refused).toContain('memory_append_kernel_refused'); expect(r.refused).toContain('aumlok_mft_not_found'); expect(r.transportInvoked).toBe(true); }
    expect(r.advisoryOnly).toBe(true);
    expect(r.grantsAuthority).toBe(false);
  });
});
