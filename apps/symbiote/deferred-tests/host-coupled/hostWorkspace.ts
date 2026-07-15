// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * 24Z.61 — Workspace context V0. Read-only awareness so the Host feels like a coding workbench: recent CHANGED files
 * (git status) + a shallow file TREE. NAMES ONLY — no file contents are read or returned, and nothing here is ever sent
 * to any model. Secret/runtime paths are excluded (.env, ~/.aukora, keys, auth.json, admin-key, .git, node_modules,
 * lockfiles, dist, imports/manus). The subdir is path-jailed to the repo (no ../ escape).
 */
import { execFileSync } from 'child_process';
import { readdirSync, statSync, existsSync } from 'fs';
import { join, resolve, relative, sep } from 'path';

const REPO = resolve(__dirname, '../../..');   // aukora-os

const EXCLUDE: RegExp[] = [
  /(^|\/)\.git(\/|$)/, /(^|\/)node_modules(\/|$)/, /(^|\/)dist(\/|$)/, /(^|\/)build(\/|$)/,
  /(^|\/)\.env(\.|$)/, /(^|\/)\.aukora(\/|$)/, /\.(key|pem|p12|keystore)$/i, /auth\.json$/i,
  /admin[-_]?key/i, /id_rsa|credentials/i, /(^|\/)imports\/manus/, /(^|\/)\.DS_Store$/,
  /package-lock\.json$|bun\.lock|yarn\.lock|pnpm-lock/i, /(^|\/)secrets?(\/|$)/i,
  // 24Z.62 hygiene — private OS surfaces + spec material stay out of the workspace tree.
  /(^|\/)\.claude(\/|$)/, /(^|\/)\.github(\/|$)/, /(^|\/)docs\/private(\/|$)/, /(^|\/)canon(\/|$)/,
  /(^|\/)opencode-lab(\/|$)/, /vyomakira|vyoma|kronos|gaussian/i,
];
function excluded(rel: string): boolean { return EXCLUDE.some((re) => re.test(rel)); }

export interface WorkspaceEntry { path: string; type: 'file' | 'dir' }
export interface WorkspaceView { ok: boolean; root: string; subdir: string; changed: Array<{ path: string; status: string }>; tree: WorkspaceEntry[]; note: string }

export function hostWorkspace(subdir = ''): WorkspaceView {
  // recently changed files (names + status only)
  let changed: Array<{ path: string; status: string }> = [];
  try {
    const raw = execFileSync('git', ['-C', REPO, 'status', '--porcelain'], { timeout: 5000 }).toString();
    changed = raw.split('\n').filter(Boolean)
      .map((l) => ({ status: l.slice(0, 2).trim() || '?', path: l.slice(3).replace(/^"|"$/g, '') }))
      .filter((c) => c.path && !excluded(c.path)).slice(0, 80);
  } catch { /* git unavailable → empty */ }

  // shallow, sanitized tree of subdir (path-jailed)
  const clean = (subdir || '').replace(/^[/]+/, '');
  const base = resolve(REPO, clean);
  let tree: WorkspaceEntry[] = [];
  const jailed = base === REPO || base.startsWith(REPO + sep);
  if (jailed && existsSync(base) && !excluded(relative(REPO, base) || '.')) {
    try {
      tree = readdirSync(base)
        .map((n) => { const abs = join(base, n); const rel = relative(REPO, abs); return { rel, abs }; })
        .filter((e) => !excluded(e.rel))
        .map((e) => { let isDir = false; try { isDir = statSync(e.abs).isDirectory(); } catch { /* ignore */ } return { path: e.rel, type: (isDir ? 'dir' : 'file') as 'dir' | 'file' }; })
        .sort((a, b) => (a.type === b.type ? a.path.localeCompare(b.path) : a.type === 'dir' ? -1 : 1))
        .slice(0, 250);
    } catch { /* unreadable → empty */ }
  }
  return { ok: true, root: 'aukora-os', subdir: jailed ? clean : '', changed, tree, note: 'read-only · names only · secrets excluded · nothing sent to any model' };
}
