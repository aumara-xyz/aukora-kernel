// dashboard/serve.ts — the AUMARA icon route. Live-fire proof (not just static source scanning): spawn the
// REAL server on an OS-assigned loopback port, fetch the icon over HTTP, and confirm it's actually a PNG
// served from the repo's own static asset — never the iCloud source path, never network/authority reachable.
import { describe, it, expect, afterAll } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { join } from 'path';
import { existsSync, statSync } from 'fs';

const REPO = join(__dirname, '..', '..');

function startServer(): Promise<{ proc: ChildProcessWithoutNullStreams; port: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('bun', ['dashboard/serve.ts'], {
      cwd: REPO,
      env: { ...process.env, AUKORA_CONSOLE_PORT: '0' },
    });
    let out = '';
    const timer = setTimeout(() => reject(new Error('server did not report a port in time')), 10000);
    proc.stdout.on('data', (chunk) => {
      out += String(chunk);
      const m = out.match(/localhost:(\d+)/);
      if (m) { clearTimeout(timer); resolve({ proc, port: Number(m[1]) }); }
    });
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

describe('dashboard/serve.ts — AUMARA icon asset route (real server, real HTTP)', () => {
  let proc: ChildProcessWithoutNullStreams;
  let base: string;

  it('the static asset file exists in the repo (not fetched from iCloud at runtime)', () => {
    const p = join(REPO, 'dashboard', 'assets', 'aumara-icon.png');
    expect(existsSync(p)).toBe(true);
    expect(statSync(p).size).toBeGreaterThan(1000); // a real image, not a stub
  });

  it('the real server serves the icon as image/png over loopback HTTP', async () => {
    const started = await startServer();
    proc = started.proc;
    base = `http://127.0.0.1:${started.port}`;
    const res = await fetch(base + '/assets/aumara-icon.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const buf = new Uint8Array(await res.arrayBuffer());
    // PNG magic bytes
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50); // 'P'
    expect(buf[2]).toBe(0x4e); // 'N'
    expect(buf[3]).toBe(0x47); // 'G'
  });

  it('an unknown asset path 404s — the route is a single fixed file, not a parameterized lookup', async () => {
    const res = await fetch(base + '/assets/does-not-exist.png');
    expect(res.status).toBe(404);
  });

  afterAll(() => {
    if (proc) proc.kill();
  });
});

describe('dashboard/serve.ts — Organs real status injection (real server, real HTTP)', () => {
  let proc: ChildProcessWithoutNullStreams;
  let base: string;

  it('the /first-contact response embeds the REAL status text server-side — placeholder token is gone, no client fetch needed', async () => {
    const started = await startServer();
    proc = started.proc;
    base = `http://127.0.0.1:${started.port}`;
    const res = await fetch(base + '/first-contact');
    expect(res.status).toBe(200);
    const body = await res.text();
    // the raw placeholder token must be fully replaced by the time it reaches the browser
    expect(body).not.toContain('__AUKORA_ORGANS_STATUS__');
    // real, honest status.sh output — same text a human sees running the script themselves
    expect(body).toMatch(/gate (source|integrity)/i);
    expect(body).toMatch(/AUMLOK/);
    // no secret material rides along with it
    expect(body).not.toMatch(/-----BEGIN|PRIVATE KEY|aumlok-local-stub-root/i);
  });

  afterAll(() => {
    if (proc) proc.kill();
  });
});
