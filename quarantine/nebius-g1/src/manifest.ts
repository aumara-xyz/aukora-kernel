// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Self-covering bundle manifest (Round-24 R23 blocker 8). The Round-22 manifest omitted material inputs
 * (package-lock.json, the audit doc) and did not cover itself. This module defines the manifest shape and a
 * verifier that proves, at audit time:
 *   1. every listed file recomputes to its recorded sha256 (no file tampered);
 *   2. every MATERIAL file on disk is listed (no material input omitted) — computed from the SAME exclusion
 *      rule the generator uses;
 *   3. sealed_bundle_digest recomputes over the sorted path:hash lines;
 *   4. manifest_self_sha256 recomputes over the manifest with that one field removed (the manifest covers
 *      itself — tampering any other manifest field is detected).
 *
 * All hashing uses the vendored D6 sha256Hex primitive (the bundle's crypto is exclusively D6). SHA-256 is
 * SHA-256, so a generator using node:crypto produces byte-identical digests.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sha256Hex } from '../d6/evidence/index';

export const MANIFEST_NAME = 'MANIFEST.json';
export const SELF_FIELD = 'manifest_self_sha256';

/** Directories/patterns excluded from "material" coverage (runtime output, installed deps, scratch). */
const EXCLUDE_DIRS = new Set(['node_modules', '.g1-out', '.git']);
function isExcludedFile(rel: string): boolean {
  const parts = rel.split('/');
  if (parts.some((p) => EXCLUDE_DIRS.has(p))) return true;
  const base = parts[parts.length - 1];
  if (base === '.DS_Store') return true;
  if (/^\..*\.tmp-/.test(base)) return true; // atomic-writer temporaries
  if (base === MANIFEST_NAME) return true; // covered by the self hash, not by files_sha256
  return false;
}

/** Enumerate every material file (POSIX-relative), sorted. */
export function materialFiles(bundleRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      const rel = path.relative(bundleRoot, abs).split(path.sep).join('/');
      if (EXCLUDE_DIRS.has(name)) continue;
      const st = fs.lstatSync(abs);
      if (st.isDirectory()) walk(abs);
      else if (st.isFile() && !isExcludedFile(rel)) out.push(rel);
    }
  };
  walk(bundleRoot);
  out.sort();
  return out;
}

export function hashFile(bundleRoot: string, rel: string): string {
  const b = fs.readFileSync(path.join(bundleRoot, rel));
  return sha256Hex(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
}

/** Recursive key-sorted canonical JSON — identical on the generator and verifier sides. */
export function canonicalJSON(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(norm);
    const o = v as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) sorted[k] = norm(o[k]);
    return sorted;
  };
  return JSON.stringify(norm(value), null, 2);
}

/** sealed_bundle_digest = sha256 over the sorted "path:hash\n" lines of files_sha256. */
export function sealedBundleDigest(filesSha256: Record<string, string>): string {
  const lines = Object.keys(filesSha256).sort().map((k) => `${k}:${filesSha256[k]}`).join('\n');
  return sha256Hex(new TextEncoder().encode(lines));
}

export interface VerifyResult {
  readonly ok: boolean;
  readonly problems: string[];
}

/** Verify the on-disk manifest is complete (no omission), untampered, and self-covering. Never throws. */
export function verifyManifest(bundleRoot: string): VerifyResult {
  const problems: string[] = [];
  try {
    const manPath = path.join(bundleRoot, MANIFEST_NAME);
    const man = JSON.parse(fs.readFileSync(manPath, 'utf8')) as Record<string, unknown>;
    const files = man.files_sha256 as Record<string, string> | undefined;
    if (files === undefined || files === null || typeof files !== 'object') {
      return { ok: false, problems: ['files_sha256-missing'] };
    }

    // 2. no material input omitted, and no listed file that is absent.
    const material = materialFiles(bundleRoot);
    const listed = new Set(Object.keys(files));
    for (const f of material) if (!listed.has(f)) problems.push(`omitted-material-file:${f}`);
    for (const f of listed) if (!material.includes(f)) problems.push(`listed-but-not-material:${f}`);

    // 1. every listed file recomputes.
    for (const f of Object.keys(files)) {
      let got: string;
      try { got = hashFile(bundleRoot, f); } catch { problems.push(`unreadable:${f}`); continue; }
      if (got !== files[f]) problems.push(`hash-mismatch:${f}`);
    }

    // 3. sealed_bundle_digest recomputes.
    const expectedSealed = sealedBundleDigest(files);
    if (man.sealed_bundle_digest_sha256 !== expectedSealed) problems.push('sealed-bundle-digest-mismatch');

    // 4. manifest self-hash recomputes over the manifest MINUS the self field.
    const withoutSelf: Record<string, unknown> = {};
    for (const k of Object.keys(man)) if (k !== SELF_FIELD) withoutSelf[k] = man[k];
    const expectedSelf = sha256Hex(new TextEncoder().encode(canonicalJSON(withoutSelf)));
    if (man[SELF_FIELD] !== expectedSelf) problems.push('manifest-self-hash-mismatch');

    return { ok: problems.length === 0, problems };
  } catch (e) {
    return { ok: false, problems: [`exception:${(e as Error).message}`] };
  }
}
