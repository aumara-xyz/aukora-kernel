// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Auma inbox append tool (#95) — the smallest write organ: one append-only mailbox file
 * (`docs/INBOX.md`) plus an auditable `auma-inbox:` git commit. No path argument, no arbitrary
 * edit, no delete, no apply lane, no authority.
 *
 * #96 multi-way-comms hardening (the mailbox is shared by four lanes — Fable, Codex, Auma, and the
 * Opus lanes — so an entry has to (a) land where every lane looks and (b) actually propagate):
 *   - Unified placement: entries are inserted at the TOP of the "## Round reports for Auma" section
 *     (newest-first), the same anchor Fable/Codex prepend to by hand — so Auma's notes interleave
 *     chronologically with everyone else's instead of stranding at end-of-file, and stay inside the
 *     bounded read window the voice lane sees. EOF is a fallback only if the anchor is missing.
 *   - Fenced opt-in propagation: with AUKORA_INBOX_AUTOPUSH=1 (default OFF — landing this code arms
 *     nothing) the tool pushes the commit so the other lanes see it without the owner relaying by
 *     hand. The push is FAIL-SAFE: it verifies HEAD touched only docs/INBOX.md, fetches, and pushes
 *     ONLY when the local branch is a clean fast-forward of the remote. If the remote has advanced it
 *     does NOT rebase (never touches a dirty working tree) — the commit stays local and auditable and
 *     the next lane's ordinary pull/push carries it. Every outcome is reported honestly, never faked.
 *   - Still append-only, still forbidden-content scanned (secrets + false-authority receipt-injection
 *     claims), still advisory: advisoryOnly:true, grantsAuthority:false.
 */
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import {
  scanForbiddenAuthorityClaims,
  scanForbiddenClaims,
  scanForbiddenKeys,
  scanForbiddenValues,
} from './forbiddenContent';

const MAX_TITLE_CHARS = 120;
const MAX_BODY_CHARS = 6000;
const MAX_ACTION_ITEMS = 8;
const MAX_ACTION_ITEM_CHARS = 300;

/** The one anchor all lanes prepend under. Kept in sync with docs/INBOX.md's section header. */
export const INBOX_SECTION_ANCHOR = '## Round reports for Auma';

export interface InboxAppendInput {
  title?: string;
  body: string;
  actionItems?: string[];
}

export interface InboxAppendOptions {
  repoRoot?: string;
  nowIso?: string;
  commit?: boolean;
  /** Explicit override of the AUKORA_INBOX_AUTOPUSH env gate (tests / callers). */
  autoPush?: boolean;
  remote?: string;
  branch?: string;
}

export type InboxAppendResult =
  | { ok: true; relPath: 'docs/INBOX.md'; commit: string | null; push: PushOutcome; advisoryOnly: true; grantsAuthority: false }
  | { ok: false; reason: string; advisoryOnly: true; grantsAuthority: false };

/** Honest, non-authority report of what propagation did. `status` is never faked. */
export interface PushOutcome {
  status: 'pushed' | 'skipped' | 'not-attempted' | 'failed';
  detail: string;
}

function repoRootDefault(): string {
  return process.env.AUKORA_INBOX_REPO_ROOT || join(__dirname, '..', '..');
}

function autoPushEnabledByEnv(): boolean {
  return process.env.AUKORA_INBOX_AUTOPUSH === '1';
}

/** Strip control chars. The body keeps newlines (multi-line markdown); one-liners drop them. */
function stripControl(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\r/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

function oneLine(s: string, cap: number): string {
  return stripControl(s).replace(/\n/g, ' ').replace(/\s+/g, ' ').trim().slice(0, cap);
}

/**
 * Neutralize markdown that could forge STRUCTURE in the shared mailbox: an ATX header (`### …`) that
 * impersonates another lane's entry, or a setext underline / thematic break (`--- === ___ ***`) that
 * re-headers or splits the doc. Escaping the leading marker renders it as literal text — an untrusted
 * note can describe a header but can never BECOME one. Entry provenance is a trust-substrate property.
 */
function neutralizeStructure(s: string): string {
  return s.split('\n').map((line) => {
    if (/^\s{0,3}#{1,6}(\s|$)/.test(line)) return line.replace(/^(\s{0,3})(#{1,6})/, '$1\\$2');
    if (/^\s{0,3}[-=_*]{3,}\s*$/.test(line)) return line.replace(/^(\s{0,3})([-=_*])/, '$1\\$2');
    return line;
  }).join('\n');
}

function cleanBody(s: string, cap: number): string {
  return neutralizeStructure(stripControl(s)).trim().slice(0, cap);
}

function safeInput(raw: InboxAppendInput): { ok: true; title: string; body: string; actionItems: string[] } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'input must be an object' };
  if (typeof raw.body !== 'string') return { ok: false, reason: 'body is required' };
  const title = neutralizeStructure(oneLine(raw.title || 'Auma note', MAX_TITLE_CHARS)) || 'Auma note';
  const body = cleanBody(raw.body, MAX_BODY_CHARS);
  if (!body) return { ok: false, reason: 'body is required' };
  const actionItems = Array.isArray(raw.actionItems)
    ? raw.actionItems.slice(0, MAX_ACTION_ITEMS).map((x) => neutralizeStructure(oneLine(String(x), MAX_ACTION_ITEM_CHARS))).filter(Boolean)
    : [];

  const scanTarget = { title, body, actionItems };
  const hits = [
    ...scanForbiddenKeys(scanTarget).map((p) => `forbidden key at ${p}`),
    ...scanForbiddenValues(scanTarget).map((p) => `secret-shaped value at ${p}`),
    ...scanForbiddenClaims(scanTarget).map((p) => `forbidden claim at ${p}`),
    ...scanForbiddenAuthorityClaims(scanTarget).map((p) => `false authority claim at ${p}`),
  ];
  if (hits.length > 0) return { ok: false, reason: `content refused: ${hits.join('; ')}` };
  return { ok: true, title, body, actionItems };
}

/** The entry body, without surrounding whitespace (placement adds that). */
function renderEntry(input: { title: string; body: string; actionItems: string[] }, nowIso: string): string {
  const actionBlock = input.actionItems.length
    ? `\n\nACTION ITEMS:\n${input.actionItems.map((x, i) => `${i + 1}. ${x}`).join('\n')}`
    : '';
  return `### ${nowIso} — Auma inbox append: ${input.title}\n\n${input.body}${actionBlock}\n`;
}

/**
 * Insert the entry as the NEWEST item under the shared section anchor, so it sits with the other
 * lanes' reports and inside the voice read window. Falls back to end-of-file (with a rule + heading)
 * only if the anchor is absent, so a mis-shaped inbox never loses a note.
 */
export function insertEntry(content: string, entry: string): string {
  const anchorIdx = content.indexOf(INBOX_SECTION_ANCHOR);
  if (anchorIdx === -1) {
    const sep = content.endsWith('\n') ? '' : '\n';
    return `${content}${sep}\n\n---\n\n${entry}`;
  }
  const lineEnd = content.indexOf('\n', anchorIdx + INBOX_SECTION_ANCHOR.length);
  const cut = lineEnd === -1 ? content.length : lineEnd + 1;
  const head = content.slice(0, cut);
  const tail = content.slice(cut);
  return `${head}\n${entry}\n${tail}`;
}

function git(repoRoot: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || 'Auma Inbox',
      GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || 'auma-inbox@aumara.local',
      GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || 'Auma Inbox',
      GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || 'auma-inbox@aumara.local',
    },
  }).trim();
}

/** Files touched by a commit (empty on error). */
function filesInCommit(repoRoot: string, ref: string): string[] {
  try {
    return git(repoRoot, ['show', '--name-only', '--pretty=', ref]).split('\n').map((s) => s.trim()).filter(Boolean);
  } catch { return []; }
}

/**
 * Fail-safe fenced push. Only pushes when: HEAD is exactly our inbox commit (touched ONLY
 * docs/INBOX.md), a remote+branch exist, and local is a clean fast-forward of the remote. A diverged
 * remote is left for the next lane's ordinary sync — we never rebase (a dirty working tree must not
 * be touched by an advisory organ). Never throws; returns an honest PushOutcome.
 */
function fencedPush(repoRoot: string, relPath: string, opts: InboxAppendOptions): PushOutcome {
  try {
    const touched = filesInCommit(repoRoot, 'HEAD');
    if (touched.length !== 1 || touched[0] !== relPath) {
      return { status: 'skipped', detail: `refused to push: HEAD touched ${touched.join(', ') || 'nothing'}, not only ${relPath}` };
    }
    const branch = opts.branch || git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
    let remote = opts.remote;
    if (!remote) {
      const remotes = git(repoRoot, ['remote']).split('\n').map((s) => s.trim()).filter(Boolean);
      if (remotes.length === 0) return { status: 'skipped', detail: 'no git remote configured — commit stays local and auditable' };
      remote = remotes.includes('origin') ? 'origin' : remotes[0];
    }
    try { git(repoRoot, ['fetch', remote, branch]); } catch (e) {
      return { status: 'skipped', detail: `fetch failed (offline?) — commit stays local: ${(e as Error).message.split('\n')[0]}` };
    }
    // Is remote strictly behind us (i.e. we fast-forward it)? behind = commits on remote not in HEAD.
    let behind = '1';
    try { behind = git(repoRoot, ['rev-list', '--count', `HEAD..${remote}/${branch}`]); } catch { behind = '0'; }
    if (behind !== '0') {
      return { status: 'skipped', detail: `remote ${remote}/${branch} advanced by ${behind} — not fast-forward; commit queued locally, next lane's push carries it (no rebase of a dirty tree)` };
    }
    git(repoRoot, ['push', remote, `HEAD:${branch}`]);
    return { status: 'pushed', detail: `${remote}/${branch}` };
  } catch (e) {
    return { status: 'failed', detail: `push rejected/failed — commit stays local and auditable: ${(e as Error).message.split('\n')[0]}` };
  }
}

export function appendAumaInbox(raw: InboxAppendInput, opts: InboxAppendOptions = {}): InboxAppendResult {
  const advisory = { advisoryOnly: true as const, grantsAuthority: false as const };
  const safe = safeInput(raw);
  if (!safe.ok) return { ...advisory, ok: false, reason: safe.reason };

  const repoRoot = opts.repoRoot ?? repoRootDefault();
  const relPath = 'docs/INBOX.md' as const;
  const inboxPath = join(repoRoot, relPath);
  const nowIso = opts.nowIso ?? new Date().toISOString();
  const existedBefore = existsSync(inboxPath);
  const before = existedBefore ? readFileSync(inboxPath, 'utf8') : '';
  const seed = existedBefore ? before : `# Inbox\n\n${INBOX_SECTION_ANCHOR}\n`;
  try {
    if (!existsSync(dirname(inboxPath))) mkdirSync(dirname(inboxPath), { recursive: true });
    writeFileSync(inboxPath, insertEntry(seed, renderEntry(safe, nowIso)), 'utf8');
    if (opts.commit === false) return { ...advisory, ok: true, relPath, commit: null, push: { status: 'not-attempted', detail: 'commit disabled' } };

    git(repoRoot, ['add', '--', relPath]);
    git(repoRoot, ['commit', '-m', `auma-inbox: ${safe.title}`, '--', relPath]);
    const commit = git(repoRoot, ['rev-parse', '--short=12', 'HEAD']);

    const wantPush = opts.autoPush ?? autoPushEnabledByEnv();
    const push: PushOutcome = wantPush
      ? fencedPush(repoRoot, relPath, opts)
      : { status: 'not-attempted', detail: 'auto-push disabled (AUKORA_INBOX_AUTOPUSH!=1) — commit is local until a lane pushes' };
    return { ...advisory, ok: true, relPath, commit, push };
  } catch (e) {
    try {
      if (existedBefore) writeFileSync(inboxPath, before, 'utf8');
      else rmSync(inboxPath, { force: true });
    } catch { /* best-effort rollback after failed write/commit */ }
    return { ...advisory, ok: false, reason: `append/commit failed: ${(e as Error).message}` };
  }
}
