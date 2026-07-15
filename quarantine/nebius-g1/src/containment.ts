// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Path containment for ALL output writes (Round-22 blocker 3).
 *
 * resolveContained(baseDir, rel) returns an absolute path that is GUARANTEED to sit under baseDir, or throws
 * a typed ContainmentError. It rejects, fail-closed:
 *   - absolute or empty `rel`;
 *   - any '..' segment (parent traversal), before touching the filesystem;
 *   - a resolved path outside baseDir (string containment on real paths);
 *   - a symlink escape: the resolved PARENT directory, after fs.realpathSync, must still be under
 *     realpath(baseDir) — so a symlink planted inside baseDir that points elsewhere is caught.
 * Pure-ish: it only reads path metadata (realpathSync); it never writes.
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

  // Symlink-escape check on the PARENT directory: it must exist and, after following symlinks, remain
  // under baseReal. This catches a symlink planted inside baseDir that points outside it.
  const parent = path.dirname(abs);
  let parentReal: string;
  try {
    parentReal = fs.realpathSync(parent);
  } catch {
    throw new ContainmentError(`parent-unresolved:${parent}`);
  }
  if (!within(baseReal, parentReal)) throw new ContainmentError(`symlink-escape:${rel}`);

  return abs;
}
