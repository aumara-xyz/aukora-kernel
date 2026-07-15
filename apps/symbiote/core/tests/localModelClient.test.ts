import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'http';
import { isStrictLoopbackUrl, probeLocalEndpoint, callLocalModel } from '../src/localModelClient';

// 24Z.27 — the loopback model client is tested against a REAL Node http server bound to 127.0.0.1 (a real
// loopback endpoint responding — no real model weights). External hosts / redirects / oversize / timeout refused.

let server: http.Server | null = null;
function startServer(handler: http.RequestListener): Promise<string> {
  return new Promise((resolve) => {
    server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server!.address();
      resolve(`http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`);
    });
  });
}
afterEach(() => { if (server) { server.close(); server = null; } });

describe('24Z.27: isStrictLoopbackUrl accepts ONLY loopback, rejects spoofs', () => {
  it('accepts loopback literals/names', () => {
    for (const u of ['http://127.0.0.1', 'http://127.0.0.1:11434/v1', 'http://localhost:8080', 'http://[::1]:9/x']) expect(isStrictLoopbackUrl(u), u).toBe(true);
  });
  it('rejects external / disguised / userinfo / non-http', () => {
    for (const u of ['http://127.0.0.1.evil.com', 'http://localhost.evil.com', 'http://[::1]@evil.com', 'http://user:pw@127.0.0.1', 'http://0.0.0.0', 'https://evil.example.com', 'file:///etc/passwd', 'ftp://127.0.0.1']) {
      expect(isStrictLoopbackUrl(u), u).toBe(false);
    }
  });
  it('rejects NUMERIC encodings of NON-loopback IPs (URL normalizes them; strict 127.0.0.1 match catches it)', () => {
    // 3232235521 = 192.168.1.1 (private), 0x7f000002 = 127.0.0.2 (loopback-range but NOT the literal 127.0.0.1)
    for (const u of ['http://3232235521', 'http://0x7f000002', 'http://2130706434']) expect(isStrictLoopbackUrl(u), u).toBe(false);
    // canonical decimal/hex of 127.0.0.1 IS loopback (URL normalizes to 127.0.0.1) — correctly accepted, safe
    for (const u of ['http://2130706433', 'http://0x7f.0.0.1']) expect(isStrictLoopbackUrl(u), u).toBe(true);
  });
});

describe('24Z.27: probe + call a REAL 127.0.0.1 endpoint (loopback-hard, bounded, no key)', () => {
  it('probes a reachable loopback endpoint', async () => {
    const url = await startServer((_req, res) => { res.writeHead(200); res.end('ok'); });
    expect((await probeLocalEndpoint(url)).reachable).toBe(true);
  });
  it('reports unreachable for a closed port (honest parked signal)', async () => {
    const pr = await probeLocalEndpoint('http://127.0.0.1:1'); // nothing listening
    expect(pr.reachable).toBe(false);
  });
  it('calls a loopback model and returns the OpenAI-shaped content (no Authorization header sent)', async () => {
    let sawAuth = true;
    const patch = JSON.stringify({ objective: 'x', files: [{ relPath: 'drafts/n.md', content: 'hi' }] });
    const url = await startServer((req, res) => {
      sawAuth = !!req.headers['authorization'];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: patch } }] }));
    });
    const r = await callLocalModel(url, 'do a thing');
    expect(r.ok).toBe(true);
    expect(r.text).toBe(patch);
    expect(sawAuth).toBe(false);               // local provider needs NO key — never sends Authorization
  });
  it('REFUSES a redirect (even a 3xx to an external host can never be followed)', async () => {
    const url = await startServer((_req, res) => { res.writeHead(302, { location: 'http://evil.example.com/x' }); res.end(); });
    const r = await callLocalModel(url, 'x');
    expect(r.ok).toBe(false);                   // redirect: 'error' → no external follow
  });
  it('enforces a response-size cap (no unbounded buffering of a hostile endpoint)', async () => {
    const url = await startServer((_req, res) => { res.writeHead(200); res.end('Z'.repeat(2 * 1024 * 1024)); });
    const r = await callLocalModel(url, 'x', { maxBytes: 64 * 1024 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/exceeded/i);
  });
  it('enforces a hard timeout', async () => {
    const url = await startServer((_req, res) => { setTimeout(() => { res.writeHead(200); res.end('late'); }, 1000); });
    const r = await callLocalModel(url, 'x', { timeoutMs: 80 });
    expect(r.ok).toBe(false);
  });
  it('refuses a non-loopback endpoint outright (never makes the request)', async () => {
    expect((await callLocalModel('https://evil.example.com', 'x')).ok).toBe(false);
    expect((await probeLocalEndpoint('http://127.0.0.1.evil.com')).reachable).toBe(false);
  });
});
