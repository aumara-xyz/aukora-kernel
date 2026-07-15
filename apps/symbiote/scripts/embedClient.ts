// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * LOCAL EMBEDDER CLIENT — one JSON line in, one JSON line out, over the daemon's 0600 unix socket
 * (memory/embedder/embedder-daemon.ts: all-MiniLM-L6-v2, 384-d, vendored model, allowRemoteModels
 * = false — ZERO egress by construction; this client can only ever reach a local socket).
 *
 * Every failure is a TYPED refusal naming the fix — most importantly the honest one this box hits
 * today: the vendored model dir is an OWNER-PLACED artifact (a supply-chain decision), so a node
 * without it refuses embedding work rather than fetching anything.
 */
import * as net from 'net';
import { homedir } from 'os';
import { join } from 'path';

export const EMBED_SOCK = process.env.AUKORA_EMBEDDER_SOCK ?? join(homedir(), '.aukora', 'embedder', 'embed.sock');
export const EMBED_DIMS = 384;

export type EmbedResult =
  | { ok: true; vector: number[] }
  | { ok: false; refused: string };

function requestLine(payload: unknown, sockPath: string, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(sockPath);
    let buf = '';
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('embedder_timeout')); }, timeoutMs);
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl >= 0) {
        clearTimeout(timer);
        sock.end();
        try { resolve(JSON.parse(buf.slice(0, nl))); } catch (e) { reject(e); }
      }
    });
    sock.on('connect', () => sock.write(JSON.stringify(payload) + '\n'));
  });
}

/** Embed ONE text on-box. Typed refusal (never a throw) when the daemon/model is absent. */
export async function embedText(text: string, opts: { sockPath?: string; timeoutMs?: number } = {}): Promise<EmbedResult> {
  try {
    const res = await requestLine({ op: 'embed', text }, opts.sockPath ?? EMBED_SOCK, opts.timeoutMs ?? 30_000);
    if (res?.ok !== true || !Array.isArray(res.vector)) return { ok: false, refused: `embedder_refused: ${res?.reason ?? 'malformed reply'}` };
    if (res.vector.length !== EMBED_DIMS || res.vector.some((x: unknown) => typeof x !== 'number' || !Number.isFinite(x))) {
      return { ok: false, refused: 'embedder_bad_vector: wrong dims or non-finite values' };
    }
    return { ok: true, vector: res.vector as number[] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/ENOENT|ECONNREFUSED/.test(msg)) {
      return { ok: false, refused: `embedder_unavailable: no daemon at ${opts.sockPath ?? EMBED_SOCK} — start it with \`bun memory/embedder/embedder-daemon.ts\` (requires the OWNER-vendored model dir memory/embedder/models; zero-egress law: it is never downloaded automatically)` };
    }
    return { ok: false, refused: `embedder_transport: ${msg}` };
  }
}

/** Daemon health (model name, dims, remote:false). Same typed-refusal law. */
export async function embedderHealth(opts: { sockPath?: string; timeoutMs?: number } = {}): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await requestLine({ op: 'health' }, opts.sockPath ?? EMBED_SOCK, opts.timeoutMs ?? 5_000);
    if (res?.ok === true && res.remote === false) return { ok: true, detail: `${res.model} (${res.dims}-d, zero egress)` };
    return { ok: false, detail: `unhealthy reply: ${JSON.stringify(res).slice(0, 120)}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
