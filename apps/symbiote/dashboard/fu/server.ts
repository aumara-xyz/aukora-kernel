// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
//
// Aukora-Fu — Fusion Council OBSERVER server. Loopback-only, read-only, grants no authority.
// It serves the static dashboard and READS the advisory fusion-run-v1 artifacts the council writes
// into ./runs/. It never signs, promotes, mutates, runs a tool, or writes anything. Observer only.
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = __dirname;
const RUNS_DIR = path.join(ROOT, 'runs');

function json(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** List run artifacts newest-first with just the summary the thread-list needs (never the full payload). */
function listRuns() {
  if (!fs.existsSync(RUNS_DIR)) return [];
  return fs.readdirSync(RUNS_DIR)
    .filter(f => f.endsWith('.json') && f !== 'latest.json')
    .map(f => {
      try {
        const a = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), 'utf8'));
        return { runId: a.runId, createdAt: a.createdAt, target: a.target, quorum: a.quorum?.status, council: (a.council || []).length };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a: any, b: any) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

function readRun(name: string) {
  const p = path.join(RUNS_DIR, path.basename(name).endsWith('.json') ? path.basename(name) : `${path.basename(name)}.json`);
  if (!p.startsWith(RUNS_DIR) || !fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];

  if (url === '/' || url === '/dashboard') {
    fs.readFile(path.join(ROOT, 'dashboard.html'), 'utf8', (err, data) => {
      if (err) { res.writeHead(500); res.end('dashboard.html not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  if (url === '/api/runs') return json(res, 200, listRuns());
  if (url === '/api/run/latest') {
    const a = readRun('latest');
    return a ? json(res, 200, a) : json(res, 404, { error: 'no runs yet - run: bun run sample OR OPENROUTER_API_KEY=... bun run council' });
  }
  if (url.startsWith('/api/run/')) {
    const a = readRun(decodeURIComponent(url.slice('/api/run/'.length)));
    return a ? json(res, 200, a) : json(res, 404, { error: 'run not found' });
  }

  // Server-Sent Events: push "update" whenever runs/ changes (a new council run landed) → live refresh.
  if (url === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('event: hello\ndata: {}\n\n');
    let watcher: fs.FSWatcher | null = null;
    try {
      // READ-ONLY: watch the runs dir (which ships with a committed .gitkeep, so it always exists). We never
      // create, write, or delete anything here — if the dir is somehow missing, watch throws and we fall back.
      let last = 0;
      watcher = fs.watch(RUNS_DIR, () => {
        const now = Date.now();
        if (now - last < 250) return; // debounce
        last = now;
        res.write(`event: update\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
      });
    } catch { /* watch unsupported — client falls back to polling */ }
    const keepalive = setInterval(() => res.write(': keepalive\n\n'), 15000);
    req.on('close', () => { clearInterval(keepalive); watcher?.close(); });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

// Loopback-only (127.0.0.1): a LOCAL Fusion observer. Never all-interfaces — it has no signed or
// authenticated network lane. It serves advisory-evidence only; it grants no authority.
server.listen(9900, '127.0.0.1', () => {
  console.log('Aukora-Fu Fusion observer → http://127.0.0.1:9900  (local · observer-only · reads dashboard/fu/runs · no authority)');
});
