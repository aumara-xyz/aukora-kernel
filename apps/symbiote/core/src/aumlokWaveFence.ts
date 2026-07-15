// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * AUMLOK WAVE FENCE — the safety core of the disposable-wave harness (scripts/aumlokWave.ts).
 *
 * A disposable wave home is destroyable ONLY when all three fences hold: it is under the OS temp
 * dir, it is NOT the standing Aukora home (nor an ancestor of it), and it carries a matching
 * sentinel file. Pure and injectable so it is unit-testable in isolation; it never reads key or
 * phrase material and its refusal reasons are content-free (paths and categories only).
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';

export const SENTINEL_NAME = '.aumlok-wave-sentinel.json';

export interface WaveRecord {
  id: string;
  home: string;
  port: number;
  pid: number;
  startedAt: string;
  sentinel: string;
  /** bumped on every resume so a stale reference can tell it reopened */
  resumes?: number;
  /** launch identity captured at spawn — the OS process start time + argv of THE door. A PID with
   *  a mismatched identity is a reused PID, never our door: it is treated as exited and NEVER
   *  signaled. Absent on records from before this hardening — those are treated as not-the-door. */
  launch?: { start: string; args: string };
}

/** A CSPRNG sentinel token — long enough to clear the fence's ≥16 length gate and unguessable so a
 *  recycled temp path can never be mistaken for a live wave. */
export function newSentinelToken(): string {
  return `wave-${randomBytes(16).toString('hex')}`;
}

/** Read the registry SAFELY: the path must be a REGULAR file (never a symlink or device) so a
 *  planted symlink can't redirect the read. Malformed/missing/hostile → an empty list, never a
 *  throw. Content-free by construction — the registry holds paths/ports/pids, never secrets. */
export function readRegistrySafe(regPath: string): WaveRecord[] {
  let st: fs.Stats;
  try { st = fs.lstatSync(regPath); } catch { return []; } // absent
  if (!st.isFile()) return []; // symlink, dir, device, fifo — refuse to follow/read
  try {
    const rows = JSON.parse(fs.readFileSync(regPath, 'utf-8'));
    return Array.isArray(rows) ? rows.filter((r): r is WaveRecord => !!r && typeof r.id === 'string' && typeof r.home === 'string') : [];
  } catch { return []; }
}

/** Write the registry via an EXCLUSIVELY-created same-dir temp then an atomic rename — a concurrent
 *  writer or a pre-existing symlink at the temp path can never be followed or clobbered. */
export function writeRegistryAtomic(regPath: string, rows: WaveRecord[]): void {
  const tmp = `${regPath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'wx', 0o600); // wx: exclusive create — never follows a symlink
  try { fs.writeSync(fd, JSON.stringify(rows, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, regPath); // atomic replace on the same filesystem
}

export type DestroyGuard = { ok: true } | { ok: false; why: string };

export function assertDestroyable(
  home: string,
  expectSentinel: string | undefined,
  standingHome: string,
  tmpRoot: string,
): DestroyGuard {
  const resolved = path.resolve(home);
  const standing = path.resolve(standingHome);
  const tmp = path.resolve(tmpRoot);
  if (resolved === standing || standing.startsWith(resolved + path.sep)) return { ok: false, why: 'path is (or contains) the standing Aukora home — refusing' };
  if (resolved !== tmp && !resolved.startsWith(tmp + path.sep)) return { ok: false, why: `path is not under the OS temp dir (${tmp}) — refusing` };
  let sentinel: { token?: unknown };
  try { sentinel = JSON.parse(fs.readFileSync(path.join(resolved, SENTINEL_NAME), 'utf-8')); }
  catch { return { ok: false, why: 'no wave sentinel in this path — refusing (not a disposable wave home)' }; }
  if (typeof sentinel.token !== 'string' || sentinel.token.length < 16) return { ok: false, why: 'sentinel malformed — refusing' };
  if (expectSentinel && sentinel.token !== expectSentinel) return { ok: false, why: 'sentinel token mismatch — refusing' };
  return { ok: true };
}
