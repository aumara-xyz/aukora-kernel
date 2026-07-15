// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * aukora.xyz lander — static, GET-only, loopback. Port 7096
 * (env AUKORA_LANDER_PORT; 7095 is claimed by the spatial-verify config).
 * The page is a self-contained artifact: when it's time to go public, deploy
 * the lander/ folder to any static host as-is.
 */
import * as fs from 'fs';
import * as path from 'path';

const DIR = import.meta.dir;
const PORT = Number(process.env.AUKORA_LANDER_PORT ?? 7096);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

Bun.serve({
  hostname: '127.0.0.1',
  port: PORT,
  fetch(req) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('nope', { status: 405 });
    const url = new URL(req.url);
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const abs = path.resolve(DIR, rel);
    if (!abs.startsWith(DIR + path.sep)) return new Response('not found', { status: 404 });
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return new Response('not found', { status: 404 });
    return new Response(Bun.file(abs), {
      headers: { 'content-type': MIME[path.extname(abs)] ?? 'application/octet-stream' },
    });
  },
});

console.log(`aukora.xyz lander — http://127.0.0.1:${PORT}`);
