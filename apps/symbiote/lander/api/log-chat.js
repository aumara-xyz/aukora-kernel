// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// aukora.xyz — Ask Auma conversation log (for building an FAQ from real questions).
//
// The widget calls this fire-and-forget after each reply. It commits the whole
// page-session transcript into THIS repo via the GitHub Contents API — one file
// per conversation (keyed by a client session id), overwritten as the chat grows.
// From these we can see what people actually ask (→ FAQ) and how they treat her.
//
// PRIVACY NOTE (load-bearing — read before touching this file): CHATS_DIR below
// stores whatever visitors type, which can include personal info. It is only safe
// because this repo is PRIVATE today. If this repo is ever made public (or a
// "clean" copy is cut for release), CHATS_DIR must be excluded/stripped first —
// it is user content and must never ship in a public repo. Failing closed (no
// token, bad input) is always fine; this endpoint must never break the chat UX.

import { resolveDataTarget } from './_data-target.js';

const GITHUB_API = 'https://api.github.com';
// Eagle Eye (#86): no hardcoded write target. Visitor chats persist ONLY to a SEPARATE private
// data repo the operator explicitly configures (resolveDataTarget); never the code repo/main.
const CHATS_DIR = 'lander/data/chats';

const MAX_MESSAGES = 40;
const MAX_CHARS = 4000; // per message
const CONV_RE = /^[a-z0-9-]{6,64}$/;

function ghHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'content-type': 'application/json',
  };
}

async function getSha(token, t, path) {
  const r = await fetch(`${GITHUB_API}/repos/${t.owner}/${t.repo}/contents/${path}?ref=${t.branch}`, {
    headers: ghHeaders(token),
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`github read ${r.status}`);
  const data = await r.json();
  return data.sha || null;
}

async function putFile(token, t, path, content, sha) {
  const body = {
    message: 'ask-auma: conversation log',
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch: t.branch,
  };
  if (sha) body.sha = sha;
  const r = await fetch(`${GITHUB_API}/repos/${t.owner}/${t.repo}/contents/${path}`, {
    method: 'PUT',
    headers: ghHeaders(token),
    body: JSON.stringify(body),
  });
  return r;
}

export default async function handler(req, res) {
  // Always answer 200 with a tiny body — this is best-effort telemetry and must
  // never surface an error into the chat UI. Real failures are logged server-side.
  if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }
  const token = process.env.GITHUB_CONTENTS_TOKEN;
  if (!token) { res.status(200).json({ ok: false, reason: 'not-configured' }); return; }
  // Fail closed: persist ONLY to an explicitly-configured SEPARATE private data repo.
  const target = resolveDataTarget(process.env);
  if (!target) { res.status(200).json({ ok: false, reason: 'not-configured' }); return; }

  const body = req.body || {};
  const convId = String(body.convId || '').trim();
  const rawMsgs = Array.isArray(body.messages) ? body.messages : null;
  if (!CONV_RE.test(convId) || !rawMsgs || rawMsgs.length === 0) {
    res.status(200).json({ ok: false, reason: 'bad-input' });
    return;
  }
  const messages = rawMsgs
    .slice(-MAX_MESSAGES)
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
  if (messages.length === 0) { res.status(200).json({ ok: false, reason: 'empty' }); return; }

  const path = `${CHATS_DIR}/${convId}.json`;
  const record = JSON.stringify(
    { convId, updatedAt: new Date().toISOString(), messages },
    null,
    2,
  ) + '\n';

  try {
    // convId is stable per page session and turns are sequential (each waits for
    // its reply), so a plain get-sha → overwrite is race-free in practice. One
    // retry covers the rare stale-sha case.
    for (let attempt = 0; attempt < 2; attempt++) {
      const sha = await getSha(token, target, path);
      const r = await putFile(token, target, path, record, sha);
      if (r.ok) { res.status(200).json({ ok: true }); return; }
      if (r.status !== 409 && r.status !== 422) throw new Error(`github write ${r.status}`);
    }
    res.status(200).json({ ok: false, reason: 'busy' });
  } catch (e) {
    console.error('log-chat fn error:', e && e.message ? e.message : String(e));
    res.status(200).json({ ok: false, reason: 'error' });
  }
}
