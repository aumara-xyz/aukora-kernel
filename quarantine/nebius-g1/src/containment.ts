// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Path containment for ALL output writes (Round-22 blocker 3; Round-24 R23 blocker 1).
 *
 * resolveContained(baseDir, rel) returns an absolute path GUARANTEED to sit under baseDir, or throws a typed
 * ContainmentError. It rejects, fail-closed:
 *   - absolute or empty `rel`;
 *   - any '..' segment (parent traversal), before touching the filesystem;
 *   - a resolved path outside baseDir (string containment on real paths);
 *   - a PARENT-directory symlink escape: the resolved parent, after realpathSync, must still be under
 *     realpath(baseDir);
 *   - a FINAL-COMPONENT symlink: if the target path already exists and is a symbolic link, it is refused
 *     (R23 blocker 1 — a naive `writeFileSync` would follow it and escape the base directory).
 *
 * writeContainedAtomic(baseDir, rel, data) is the ONLY sanctioned way to persist an artifact. It resolves the
 * contained path (so every check above runs), creates a fresh temp file in the SAME directory with
 * O_CREAT|O_EXCL (no-follow — a pre-planted symlink at the temp name fails EEXIST, never followed), fsyncs it,
 * and atomically renames it onto the final path. rename(2) operates on the name and replaces a symlink at the
 * destination WITHOUT following it, so the write can never escape even if the final name was a symlink. The
 * atomic rename also makes the persisted artifact/lineage record durable and all-or-nothing (no half record).
 *
 * Pure-ish for resolve (reads path metadata only); writeContainedAtomic is the sole writer.
 *
 * DISCLOSED RESIDUAL (P3, out of the input-driven threat model): for a NESTED `rel` (e.g. 'lineage/gen-1.json')
 * an EXTERNAL, concurrent process that can write to the base subtree could swap an intermediate real directory
 * for a symlink AFTER resolveContained validates it but BEFORE openSync/rename, landing the write outside base.
 * This is NOT reachable via the untrusted `rel` alone — Node is single-threaded and both functions are fully
 * synchronous with no interleaving — so it requires a second writer holding base-subtree access (a stronger
 * capability than the input-driven symlink threat, and one that already implies more direct escapes). A full
 * close needs openat/renameat relative to an O_DIRECTORY fd of the validated parent (not portably exposed by
 * Node). On the sealed, egress-denied, single-tenant G1 VM no such concurrent writer exists.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export class ContainmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContainmentError';
  }
}

function within(baseReal: string, candidateReal: string): boolean {
  const rel = path.relative(baseReal, candidateReal);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function resolveContained(baseDir: string, rel: string): string {
  if (typeof rel !== 'string' || rel.length === 0) throw new ContainmentError('empty-relative-path');
  if (path.isAbsolute(rel)) throw new ContainmentError(`absolute-path-rejected:${rel}`);

  const segments = rel.split(/[\\/]+/);
  if (segments.some((s) => s === '..')) throw new ContainmentError(`parent-traversal-rejected:${rel}`);
  if (segments.some((s) => s === '')) throw new ContainmentError(`empty-segment-rejected:${rel}`);

  // baseDir must exist so we can resolve its real path (the controller mkdirs the out dir first).
  let baseReal: string;
  try {
    baseReal = fs.realpathSync(baseDir);
  } catch {
    throw new ContainmentError(`base-unresolved:${baseDir}`);
  }

  const abs = path.resolve(baseReal, rel);
  if (!within(baseReal, abs)) throw new ContainmentError(`escapes-base:${rel}`);

  // Parent-directory symlink escape: the resolved parent must exist and, after following symlinks, remain
  // under baseReal. Catches a symlink planted inside baseDir that points outside it.
  const parent = path.dirname(abs);
  let parentReal: string;
  try {
    parentReal = fs.realpathSync(parent);
  } catch {
    throw new ContainmentError(`parent-unresolved:${parent}`);
  }
  if (!within(baseReal, parentReal)) throw new ContainmentError(`symlink-escape:${rel}`);

  // FINAL-COMPONENT symlink escape (R23 blocker 1): if the target itself already exists AND is a symlink,
  // refuse. lstat does NOT follow the link, so we see the link, not its target. A missing final component
  // (ENOENT) is fine — that is the normal first-write case; a regular file (re-run overwrite) is fine too.
  try {
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink()) throw new ContainmentError(`final-symlink-rejected:${rel}`);
  } catch (e) {
    if (e instanceof ContainmentError) throw e;
    // any other lstat error (ENOENT) ⇒ no existing final component ⇒ fine
  }

  return abs;
}

let tmpCounter = 0;

/**
 * Atomically persist `data` at baseDir/rel with no symlink following anywhere. Returns the final absolute path.
 * Steps: (1) resolveContained runs every containment check incl. the final-component symlink rejection;
 * (2) a unique temp is created in the SAME directory with 'wx' (O_CREAT|O_EXCL — never follows a symlink);
 * (3) the temp is fsynced; (4) renamed onto the final path (rename replaces the name, does not follow a symlink
 * at the destination). Result: contained, no-follow, durable, all-or-nothing.
 */
export function writeContainedAtomic(baseDir: string, rel: string, data: string | Uint8Array): string {
  const finalAbs = resolveContained(baseDir, rel);
  const dir = path.dirname(finalAbs);
  const base = path.basename(finalAbs);
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);

  let tmpAbs = '';
  for (let i = 0; i < 4096; i++) {
    const cand = path.join(dir, `.${base}.tmp-${process.pid}-${tmpCounter++}`);
    let fd: number;
    try {
      fd = fs.openSync(cand, 'wx', 0o600); // O_CREAT|O_EXCL|O_WRONLY, mode 0600 — never follows a symlink
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') continue; // temp name taken; try the next
      throw e;
    }
    try {
      fs.writeSync(fd, buf);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    tmpAbs = cand;
    break;
  }
  if (tmpAbs === '') throw new ContainmentError(`temp-allocation-failed:${rel}`);

  try {
    fs.renameSync(tmpAbs, finalAbs); // atomic; replaces a symlink at finalAbs without following it
  } catch (e) {
    try { fs.unlinkSync(tmpAbs); } catch { /* best-effort cleanup */ }
    throw e;
  }
  return finalAbs;
}
