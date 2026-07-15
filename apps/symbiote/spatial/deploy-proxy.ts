// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Deploy proxy for the Nebius dojo node.
 *
 * This fronts the loopback Spatial servers behind one public tunnel so the
 * browser only ever talks to a same-origin door. The Agora token is injected
 * here server-side and never leaves the node.
 */

const PUBLIC_PORT = Number(process.env.PROXY_PORT || 7090);
const SHELL = `http://127.0.0.1:${process.env.SHELL_PORT || 7095}`;
const CHAT = `http://127.0.0.1:${process.env.CHAT_PORT || 7091}`;
const AGORA = `http://127.0.0.1:${process.env.AGORA_PORT || 7092}`;
const AGORA_TOKEN = process.env.AGORA_TOKEN || '';
const CHAT_PATHS = ['/api/chat', '/api/models', '/api/presence'];

Bun.serve({
  hostname: '0.0.0.0',
  port: PUBLIC_PORT,
  idleTimeout: 240,
  async fetch(req) {
    const url = new URL(req.url);
    const toAgora = url.pathname === '/api/agora' || url.pathname.startsWith('/api/agora/');
    const toChat = !toAgora && CHAT_PATHS.some((pfx) => url.pathname === pfx || url.pathname.startsWith(`${pfx}/`));
    const base = toAgora ? AGORA : toChat ? CHAT : SHELL;

    let search = url.search;
    if (toAgora && AGORA_TOKEN) {
      const sp = new URLSearchParams(url.search);
      sp.set('k', AGORA_TOKEN);
      search = `?${sp.toString()}`;
    }

    const target = `${base}${url.pathname}${search}`;
    const headers = new Headers(req.headers);
    if (toChat) headers.set('origin', 'http://127.0.0.1:7090');
    headers.set('host', new URL(base).host);

    try {
      const resp = await fetch(target, {
        method: req.method,
        headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
        // @ts-ignore bun streaming body
        duplex: 'half',
        redirect: 'manual',
      });
      return new Response(resp.body, { status: resp.status, headers: resp.headers });
    } catch (e) {
      return new Response(`upstream unreachable: ${String(e)}`, { status: 502 });
    }
  },
});

console.log(`deploy-proxy on 0.0.0.0:${PUBLIC_PORT} (chat->${CHAT}, agora->${AGORA}, shell->${SHELL})`);
