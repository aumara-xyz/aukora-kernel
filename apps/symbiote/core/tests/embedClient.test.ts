// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Hermetic tests for the local-embedder client: JSON-line protocol over a unix socket (a fake
// daemon on a tmp socket), hard vector validation, and the load-bearing refusal — a node without
// the OWNER-vendored model must get a typed refusal naming the zero-egress law, never a fetch.
import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { embedText, embedderHealth, EMBED_DIMS } from '../../scripts/embedClient';

let server: net.Server | null = null;
let dir: string | null = null;

function fakeDaemon(reply: (req: any) => any): string {
  dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-embed-'));
  const sock = path.join(dir, 'embed.sock');
  server = net.createServer((conn) => {
    let buf = '';
    conn.on('data', (d) => {
      buf += d.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl >= 0) conn.write(JSON.stringify(reply(JSON.parse(buf.slice(0, nl)))) + '\n');
    });
  });
  server.listen(sock);
  return sock;
}

afterEach(() => {
  server?.close();
  server = null;
  if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } dir = null; }
});

describe('embedText — protocol, validation, typed refusals', () => {
  it('embeds via the JSON-line protocol and returns the 384-d vector', async () => {
    const sock = fakeDaemon((req) => (req.op === 'embed' ? { ok: true, dims: EMBED_DIMS, vector: new Array(EMBED_DIMS).fill(0.5) } : { ok: false }));
    const r = await embedText('hello memory', { sockPath: sock });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.vector.length).toBe(EMBED_DIMS);
  });

  it('refuses wrong dims and non-finite vectors from a misbehaving daemon', async () => {
    const sock = fakeDaemon(() => ({ ok: true, dims: 3, vector: [1, 2, 3] }));
    expect((await embedText('x', { sockPath: sock })).ok).toBe(false);
    server?.close();
    const sock2 = fakeDaemon(() => ({ ok: true, dims: EMBED_DIMS, vector: [Number.NaN, ...new Array(EMBED_DIMS - 1).fill(0)] }));
    const r2 = await embedText('x', { sockPath: sock2 });
    expect(r2).toMatchObject({ ok: false, refused: expect.stringContaining('embedder_bad_vector') });
  });

  it('a node without the daemon gets the typed zero-egress refusal, never a fetch', async () => {
    const r = await embedText('x', { sockPath: '/tmp/definitely-not-a-socket-aukora-test.sock', timeoutMs: 2_000 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refused).toContain('embedder_unavailable');
      expect(r.refused).toContain('vendored'); // the fix is named: owner vendors the model; nothing auto-downloads
    }
  });

  it('daemon-side refusals pass through typed', async () => {
    const sock = fakeDaemon(() => ({ ok: false, reason: 'embed requires text:string' }));
    const r = await embedText('x', { sockPath: sock });
    expect(r).toMatchObject({ ok: false, refused: expect.stringContaining('embedder_refused') });
  });
});

describe('embedderHealth — honest health, zero-egress asserted', () => {
  it('healthy only when the daemon says remote:false', async () => {
    const sock = fakeDaemon(() => ({ ok: true, model: 'Xenova/all-MiniLM-L6-v2', dims: EMBED_DIMS, remote: false }));
    expect((await embedderHealth({ sockPath: sock })).ok).toBe(true);
    server?.close();
    const sock2 = fakeDaemon(() => ({ ok: true, model: 'x', dims: EMBED_DIMS, remote: true }));
    expect((await embedderHealth({ sockPath: sock2 })).ok).toBe(false); // a remote-capable embedder is NOT healthy here
  });
});
