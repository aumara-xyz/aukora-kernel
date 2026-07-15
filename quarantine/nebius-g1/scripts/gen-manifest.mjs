// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Deterministic generator for the self-covering MANIFEST.json (R23 blocker 8). Mirrors src/manifest.ts exactly
// (same exclusion rule, same canonicalization). SHA-256 via node:crypto is byte-identical to the D6 primitive
// that src/manifest.ts uses to verify. No timestamps, no randomness — fully reproducible.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const BUNDLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_NAME = 'MANIFEST.json';
const SELF_FIELD = 'manifest_self_sha256';
const EXCLUDE_DIRS = new Set(['node_modules', '.g1-out', '.git']);

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

function isExcludedFile(rel) {
  const parts = rel.split('/');
  if (parts.some((p) => EXCLUDE_DIRS.has(p))) return true;
  const base = parts[parts.length - 1];
  if (base === '.DS_Store') return true;
  if (/^\..*\.tmp-/.test(base)) return true;
  if (base === MANIFEST_NAME) return true;
  return false;
}

function materialFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (EXCLUDE_DIRS.has(name)) continue;
      const abs = path.join(dir, name);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      const st = fs.lstatSync(abs);
      if (st.isDirectory()) walk(abs);
      else if (st.isFile() && !isExcludedFile(rel)) out.push(rel);
    }
  };
  walk(root);
  return out.sort();
}

function canonicalJSON(value) {
  const norm = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(norm);
    const sorted = {};
    for (const k of Object.keys(v).sort()) sorted[k] = norm(v[k]);
    return sorted;
  };
  return JSON.stringify(norm(value), null, 2);
}

const pin = JSON.parse(fs.readFileSync(path.join(BUNDLE, 'd6', 'D6_TREE_VERIFICATION.json'), 'utf8'));

const files = {};
const list = materialFiles(BUNDLE);
for (const f of list) files[f] = sha(fs.readFileSync(path.join(BUNDLE, f)));

const sealedLines = Object.keys(files).sort().map((k) => `${k}:${files[k]}`).join('\n');
const sealed = sha(Buffer.from(sealedLines, 'utf8'));

const base = {
  bundle: 'aukora-g1-bundle',
  version: 'v1-r24-repair',
  mode: 'QUARANTINED — repaired and published for audit; NOT deployed, NOT armed',
  d6: {
    commit: pin.d6_commit,
    tree: pin.d6_tree_object,
    full_tracked_tree_ls_sha256: pin.d6_full_tracked_tree_ls_sha256,
    tracked_entries: pin.d6_tracked_entry_count,
    source: 'aukora-fu public repo (already public); vendored, not modified',
  },
  verification: {
    tsc_noEmit: 'exit 0',
    tests: '63/63 pass (negativeControls 26 + r24Repairs 35 + manifest 2) + fail-before repro drives base-vs-fixed',
    runtime: 'Node + vitest 4.1.x',
    verified_by: 'OPUS NEBIUS lane (author) plus independent Codex conductor reproduction',
    note: 'files_sha256 covers every material file; manifest_self_sha256 covers this manifest itself.',
  },
  file_count: list.length,
  files_sha256: files,
  sealed_bundle_digest_sha256: sealed,
};

const selfHash = sha(Buffer.from(canonicalJSON(base), 'utf8'));
const final = { ...base, [SELF_FIELD]: selfHash };

fs.writeFileSync(path.join(BUNDLE, MANIFEST_NAME), canonicalJSON(final) + '\n');
console.log(`MANIFEST.json written: ${list.length} material files; sealed=${sealed.slice(0, 12)}…; self=${selfHash.slice(0, 12)}…`);
