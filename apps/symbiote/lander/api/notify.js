// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// aukora.xyz — the "public release coming soon" notify form's backend.
//
// The lander's repo (aumara-xyz/aukora-symbiote) is PRIVATE today, so every
// GitHub link on the page opens a small modal instead of a dead/permission-
// denied link. This endpoint is that modal's only job: take one email address
// and commit it into THIS repo via the GitHub Contents API — no database, no
// third-party mailing list, exactly what was asked for ("store it in the repo").
//
// PRIVACY NOTE (load-bearing, read before touching this file): this repo is
// PRIVATE right now, so storing real people's emails in WAITLIST_PATH below is
// safe today. If this repo is ever made public (or a "clean" copy is cut for
// public release), WAITLIST_PATH must be excluded/stripped first — it is real
// PII and must never ship in a public repo.

import { resolveDataTarget } from './_data-target.js';

const GITHUB_API = 'https://api.github.com';
// Eagle Eye (#86): no hardcoded write target. Emails persist ONLY to a SEPARATE private data repo
// the operator explicitly configures (resolveDataTarget); never the code repo/main.
const WAITLIST_PATH = 'lander/data/waitlist.jsonl';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ghHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'content-type': 'application/json',
  };
}

async function getFile(token, t) {
  const r = await fetch(`${GITHUB_API}/repos/${t.owner}/${t.repo}/contents/${WAITLIST_PATH}?ref=${t.branch}`, {
    headers: ghHeaders(token),
  });
  if (r.status === 404) return { sha: null, content: '' };
  if (!r.ok) throw new Error(`github read ${r.status}`);
  const data = await r.json();
  const content = Buffer.from(data.content, 'base64').toString('utf8');
  return { sha: data.sha, content };
}

async function putFile(token, t, content, sha) {
  const body = {
    message: 'notify: waitlist signup',
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch: t.branch,
  };
  if (sha) body.sha = sha;
  const r = await fetch(`${GITHUB_API}/repos/${t.owner}/${t.repo}/contents/${WAITLIST_PATH}`, {
    method: 'PUT',
    headers: ghHeaders(token),
    body: JSON.stringify(body),
  });
  return r;
}

async function appendEmail(token, t, email) {
  const line = JSON.stringify({ email, ts: new Date().toISOString() }) + '\n';
  // One retry: if another signup lands between our GET and PUT, the sha is
  // stale and GitHub returns 409/422 — re-read the latest sha and try once more.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { sha, content } = await getFile(token, t);
    const r = await putFile(token, t, content + line, sha);
    if (r.ok) return true;
    if (r.status !== 409 && r.status !== 422) throw new Error(`github write ${r.status}`);
  }
  return false;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'POST only' });
    return;
  }
  const token = process.env.GITHUB_CONTENTS_TOKEN;
  if (!token) {
    res.status(503).json({ ok: false, error: 'notify list is not configured yet' });
    return;
  }
  // Fail closed: persist ONLY to an explicitly-configured SEPARATE private data repo.
  const target = resolveDataTarget(process.env);
  if (!target) {
    res.status(503).json({ ok: false, error: 'notify list is not configured yet' });
    return;
  }
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    res.status(400).json({ ok: false, error: 'a real email address is required' });
    return;
  }
  try {
    const ok = await appendEmail(token, target, email);
    if (!ok) {
      res.status(503).json({ ok: false, error: 'busy right now — try again in a moment' });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('notify fn error:', e && e.message ? e.message : String(e));
    res.status(502).json({ ok: false, error: 'could not save that — try again' });
  }
}
