// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Aukora Spatial — the ARC door. A thin, loopback-only relay between the
 * AGI · ARC 3 organ and the live benchmark at three.arcprize.org.
 *
 * Why a separate process: spatial/serve.ts is structurally GET-only (the
 * advisory read surface must never grow a write lane), and chat-serve.ts is
 * the governed chat door. This door does exactly one job: hold the X-API-Key
 * OUT of the browser, keep per-session cookie affinity (the ARC backend
 * routes stateful game sessions via AWSALB* cookies), and pace requests under
 * the platform's 600 requests/minute limit.
 *
 * The door has NO authority and NO reasoning. Auma's reasoner runs in the
 * browser; every action she takes arrives here already decided, with her
 * one-line reasoning attached (forwarded verbatim in the `reasoning` field so
 * the official scorecard carries her receipts).
 *
 * Key resolution (never logged, never echoed):
 *   1. env ARC_API_KEY (the arcprize convention)
 *   2. env AUKORA_ARC3_API_KEY
 *   3. ~/.aukora-symbiote/arc3/api-key.txt (single line)
 *   4. an ANONYMOUS key from GET /api/games/anonkey — the platform's own
 *      guest lane (the official arc-agi toolkit does exactly this). Anonymous
 *      runs count on no leaderboard; register at three.arcprize.org to own
 *      your scorecards.
 *
 * Port 7093 (env AUKORA_ARC3_PORT — 7092 belongs to the Auma Live / KNVS voice sidecar,
 * which start-node's arc3 auto-start was squatting; dedup 2026-07-08). Loopback only. CORS restricted to the
 * spatial shell's origin (7090). Without a key the door still boots and says
 * so honestly — the organ then runs the onboard arcade instead.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createPulseSession } from './arc3-pulse';
import { maybeDraftPulseWorkOrder } from './arc3-workorder';

const PORT = Number(process.env.AUKORA_ARC3_PORT ?? 7093);
const ARC_BASE = process.env.AUKORA_ARC3_BASE ?? 'https://three.arcprize.org';
const SHELL_ORIGINS = new Set([
  'http://127.0.0.1:7090',
  'http://localhost:7090',
  // preview lane (wrapper serving the same app on a spare port; loopback only)
  'http://127.0.0.1:7098',
  'http://localhost:7098',
]);

function resolveKey(): string | null {
  const env = process.env.ARC_API_KEY || process.env.AUKORA_ARC3_API_KEY;
  if (env && env.trim()) return env.trim();
  try {
    const p = path.join(os.homedir(), '.aukora-symbiote', 'arc3', 'api-key.txt');
    const raw = fs.readFileSync(p, 'utf8').trim();
    if (raw) return raw.split(/\r?\n/)[0].trim();
  } catch { /* no key file — honest keyless mode */ }
  return null;
}

let API_KEY = resolveKey();
let keyMode: 'configured' | 'anonymous' | 'none' = API_KEY ? 'configured' : 'none';
let anonAttemptAt = 0;

// The platform's guest lane, mirrored from the official arc-agi toolkit:
// GET /api/games/anonkey → { api_key }. Best-effort with a retry cooldown.
async function ensureKey(): Promise<string | null> {
  if (API_KEY) return API_KEY;
  if (Date.now() - anonAttemptAt < 30_000) return null;
  anonAttemptAt = Date.now();
  try {
    const res = await fetch(`${ARC_BASE}/api/games/anonkey`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { api_key?: string };
    if (data.api_key) {
      API_KEY = String(data.api_key);
      keyMode = 'anonymous';
      console.log('arc3 door: using an ANONYMOUS key — register at three.arcprize.org to own your scorecards');
      return API_KEY;
    }
  } catch { /* offline or platform down — the organ falls back to the onboard arcade */ }
  return null;
}

// ---------------------------------------------------------------------------
// Session affinity: the ARC platform pins a game session to a backend via
// AWSALB* cookies. One cookie jar per game guid; RESETs that mint a new guid
// start from a fresh jar which is then bound to the returned guid.
// ---------------------------------------------------------------------------

const jars = new Map<string, Map<string, string>>(); // guid → cookie name → value
const MAX_JARS = 64;

function jarHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function absorbCookies(jar: Map<string, string>, res: Response): void {
  const setCookies: string[] = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const line of setCookies) {
    const first = line.split(';', 1)[0];
    const eq = first.indexOf('=');
    if (eq > 0) jar.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
  }
}

function bindJar(guid: string, jar: Map<string, string>): void {
  jars.set(guid, jar);
  if (jars.size > MAX_JARS) {
    const oldest = jars.keys().next().value;
    if (oldest !== undefined) jars.delete(oldest);
  }
}

// ---------------------------------------------------------------------------
// Pacing: stay well under 600 RPM (one upstream call every ≥120 ms), and pass
// 429s through so the organ can show the backoff honestly.
// ---------------------------------------------------------------------------

const MIN_INTERVAL_MS = 120;
let lastUpstreamAt = 0;
let chain: Promise<void> = Promise.resolve();

function paced<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = lastUpstreamAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait));
    lastUpstreamAt = Date.now();
    return fn();
  });
  chain = run.then(() => undefined, () => undefined);
  return run;
}

async function upstream(method: 'GET' | 'POST', apiPath: string, body: unknown, jar: Map<string, string>): Promise<{ status: number; json: unknown; res: Response }> {
  const headers: Record<string, string> = { 'X-API-Key': API_KEY ?? '' };
  if (method === 'POST') headers['content-type'] = 'application/json';
  if (jar.size) headers['cookie'] = jarHeader(jar);
  const res = await fetch(`${ARC_BASE}${apiPath}`, {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    signal: AbortSignal.timeout(45_000),
    redirect: 'follow',
  });
  absorbCookies(jar, res);
  let json: unknown = null;
  try { json = await res.json(); } catch { json = { error: 'NON_JSON_RESPONSE', status: res.status }; }
  return { status: res.status, json, res };
}

// ---------------------------------------------------------------------------
// The door.
// ---------------------------------------------------------------------------

const CMD_NAMES = new Set(['RESET', 'ACTION1', 'ACTION2', 'ACTION3', 'ACTION4', 'ACTION5', 'ACTION6', 'ACTION7']);

// ---------------------------------------------------------------------------
// MK-PULSE — "find the silent door" (THE GREAT MERGE #178, Phase C rung 0).
// game_id `pulse-node` is handled HERE, never upstream: the node itself is
// the arena. Probes are the same read-only loopback GETs `bun run start`
// performs; nothing leaves the machine, nothing is written, no scorecard.
// ---------------------------------------------------------------------------

const pulseSessions = new Map<string, ReturnType<typeof createPulseSession>>();
const PULSE_MAX_SESSIONS = 16;

async function pulseProbe(probeUrl: string): Promise<{ up: boolean; ms: number }> {
  const t0 = Date.now();
  try {
    const res = await fetch(probeUrl, { signal: AbortSignal.timeout(600) });
    // any answer is an answer; silence is the only failure — but the CLOCK
    // rides along, because a slow door is not a dead one
    return { up: res.status > 0, ms: Date.now() - t0 };
  } catch { return { up: false, ms: Date.now() - t0 }; }
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allowed = SHELL_ORIGINS.has(origin) ? origin : 'http://127.0.0.1:7090';
  return {
    'access-control-allow-origin': allowed,
    'access-control-allow-methods': 'POST, GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'origin',
  };
}

function json(req: Request, value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(req) },
  });
}

Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });

    if (req.method === 'GET' && url.pathname === '/arc3/status') {
      await ensureKey();
      return json(req, { up: true, hasKey: API_KEY != null, keyMode, base: ARC_BASE, port: PORT });
    }

    if (!API_KEY && !(await ensureKey())) {
      return json(req, { error: 'NO_KEY', message: 'no ARC API key and the anonymous lane is unreachable — set ARC_API_KEY or ~/.aukora-symbiote/arc3/api-key.txt (register at three.arcprize.org)' }, 503);
    }

    try {
      if (req.method === 'GET' && url.pathname === '/arc3/games') {
        const { status, json: body } = await paced(() => upstream('GET', '/api/games', null, new Map()));
        return json(req, body, status);
      }

      if (req.method === 'GET' && /^\/arc3\/scorecard\/[\w-]+$/.test(url.pathname)) {
        const cardId = url.pathname.split('/').pop() as string;
        const { status, json: body } = await paced(() => upstream('GET', `/api/scorecard/${cardId}`, null, new Map()));
        return json(req, body, status);
      }

      if (req.method === 'POST' && url.pathname === '/arc3/open') {
        const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
        const meta = {
          source_url: typeof body.source_url === 'string' ? body.source_url : undefined,
          tags: Array.isArray(body.tags) ? body.tags.slice(0, 8) : undefined,
          opaque: typeof body.opaque === 'object' && body.opaque !== null ? body.opaque : undefined,
        };
        const { status, json: out } = await paced(() => upstream('POST', '/api/scorecard/open', meta, new Map()));
        return json(req, out, status);
      }

      if (req.method === 'POST' && url.pathname === '/arc3/close') {
        const body = (await req.json().catch(() => ({}))) as { card_id?: string };
        if (!body.card_id) return json(req, { error: 'BAD_REQUEST', message: 'card_id required' }, 400);
        const { status, json: out } = await paced(() => upstream('POST', '/api/scorecard/close', { card_id: body.card_id }, new Map()));
        return json(req, out, status);
      }

      if (req.method === 'POST' && url.pathname === '/arc3/cmd') {
        const body = (await req.json().catch(() => ({}))) as { name?: string; payload?: Record<string, unknown> };
        const name = String(body.name ?? '');
        if (!CMD_NAMES.has(name)) return json(req, { error: 'BAD_REQUEST', message: `unknown command ${name}` }, 400);
        const payload = body.payload ?? {};
        const guid = typeof payload.guid === 'string' ? payload.guid : null;

        // The node's own arena: pulse ids never travel upstream.
        if (String(payload.game_id ?? '').startsWith('pulse-')) {
          if (name === 'RESET') {
            const existing = guid ? pulseSessions.get(guid) : null;
            if (existing) return json(req, existing.reset());
            const seed = typeof payload.seed === 'number' ? payload.seed : undefined;
            const session = createPulseSession({ seed, prober: pulseProbe });
            pulseSessions.set(session.guid, session);
            if (pulseSessions.size > PULSE_MAX_SESSIONS) {
              const oldest = pulseSessions.keys().next().value;
              if (oldest !== undefined) pulseSessions.delete(oldest);
            }
            return json(req, session.reset());
          }
          const session = guid ? pulseSessions.get(guid) : null;
          if (!session) return json(req, { error: 'NOT_FOUND', message: 'unknown pulse session - RESET first' }, 404);
          const x = typeof payload.x === 'number' ? payload.x : undefined;
          const y = typeof payload.y === 'number' ? payload.y : undefined;
          const fr = await session.act(name, x, y);
          // The lawful crossing: a naming may become an advisory proposal
          // draft through the existing ceremony. Gated off by default; the
          // result (drafted or the honest reason why not) rides the frame.
          const named = session.takeFinding();
          if (named) {
            (fr as unknown as Record<string, unknown>).pulse_workorder =
              maybeDraftPulseWorkOrder({ surface: named.surface, guid: session.guid, level: named.level, probes: named.probes });
          }
          return json(req, fr);
        }
        // Backend affinity: each ARC backend instance hosts a SUBSET of the
        // games, and a cookieless RESET rolls the load-balancer dice — the
        // same game_id flips between playable and "not found" per roll
        // (measured 2026-07-08). So a fresh RESET retries with a fresh jar
        // until it lands on a backend that hosts the game; once the guid
        // binds a jar, the AWSALB cookie keeps every later command home.
        const attempts = name === 'RESET' && !guid ? 12 : 1;
        let last: { status: number; json: unknown } = { status: 502, json: { error: 'UPSTREAM_FAILURE' } };
        for (let i = 0; i < attempts; i++) {
          const jar = (guid && jars.get(guid)) || new Map<string, string>();
          last = await paced(() => upstream('POST', `/api/cmd/${name}`, payload, jar));
          const out = last.json as { guid?: string; message?: string } | null;
          const notFound = typeof out?.message === 'string' && /not found/i.test(out.message);
          if (typeof out?.guid === 'string' && out.guid) bindJar(out.guid, jar);
          if (!notFound) break;
        }
        return json(req, last.json, last.status);
      }
    } catch (e) {
      return json(req, { error: 'UPSTREAM_FAILURE', message: e instanceof Error ? e.message : String(e) }, 502);
    }

    return json(req, { error: 'NOT_FOUND' }, 404);
  },
});

console.log(`arc3 door listening on http://127.0.0.1:${PORT} — key ${API_KEY ? 'present' : 'ABSENT (onboard arcade only)'} — upstream ${ARC_BASE}`);
