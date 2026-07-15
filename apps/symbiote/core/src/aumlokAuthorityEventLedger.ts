// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Durable, cross-process, crash-safe TRANSACTION ledger of AUTHORITY EVENTS — migrations and key-lifecycle
 * (rotate/revoke) installs (#361 Fable Finish Cycle C; amended per Codex review B1). The Brick-1 review pinned
 * the law this file satisfies: expiry BOUNDS an authorization window; it is NEVER durable replay prevention.
 * A validly-signed migration/lifecycle envelope re-presented later must be a hard, explicit refusal — this
 * ledger is that refusal's memory, surviving process restarts (the installs are one-shot CLI ceremonies).
 *
 * The amendment (why the old `consumeAuthorityEventOnce` was rejected): it did an UNLOCKED
 * read→mutate→temp-rename, so two door/CLI processes could both accept the same event or clobber each other's
 * entries; and callers recorded `installedAt` BEFORE the install, so a lock/staging/publish failure left a
 * durable row claiming an install that never happened. This module replaces that with an explicit
 * RESERVE → (install) → COMMIT | ABORT transaction:
 *
 *   - every read-modify-write runs under an EXCLUSIVE cross-process lock (an O_EXCL lockfile with race-safe
 *     stale-lock reclaim); a lock we cannot take within the bounded window fails CLOSED ("busy"), never a
 *     silent double-accept;
 *   - a row is `reserved` (installedAt=null, an attempt is in flight), `committed` (installedAt set, the
 *     install is durable), or `aborted` (a known-failed attempt — a tombstone);
 *   - replay refuses ANY existing row for the exact canonical payload: reserved (in-flight/crashed),
 *     committed (installed), and aborted (tombstoned) all block a second install of the same signed bytes;
 *   - truth surfaces read "installed" ONLY from `committed`; reserved/aborted are never installed;
 *   - a corrupt ledger THROWS on the enforcement path — a corrupt ledger must never read as "nothing was ever
 *     installed"; write-to-temp + atomic rename keeps the file itself never half-written.
 *
 * Keyed by sha256 over the CANONICAL payload (canonicalMigrationV1 / canonicalLifecycleV2) — the exact bytes
 * both signatures cover — so no field-reshuffle can mint a "different" event with the same signed substance.
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomBytes } from 'crypto';

export type AuthorityEventKind = 'migration-v1-to-v2' | 'lifecycle-rotate' | 'lifecycle-revoke';
export type AuthorityEventStatus = 'reserved' | 'committed' | 'aborted';

export interface AuthorityEventLedgerEntry {
  kind: AuthorityEventKind;
  canonicalHash: string;              // sha256 hex over the canonical signed payload — the row's identity
  status: AuthorityEventStatus;
  reservationId: string;              // unique per attempt (audit only; rows are addressed by canonicalHash)
  reservedAt: string;
  installedAt: string | null;         // set ONLY on commit (after the install is durable)
  abortedAt: string | null;           // set ONLY on abort
  note: string;                       // public lineage note, e.g. "oldRoot 1234… -> newRoot abcd…" — never a secret
}

const KINDS: ReadonlySet<string> = new Set(['migration-v1-to-v2', 'lifecycle-rotate', 'lifecycle-revoke']);
const STATUSES: ReadonlySet<string> = new Set(['reserved', 'committed', 'aborted']);

// ── cross-process lock (O_EXCL lockfile + race-safe stale reclaim) ───────────────────────────────────────
const LOCK_STALE_MS = 60_000;   // a lock older than this is presumed crashed (ceremonies are seconds-long)
const LOCK_MAX_WAIT_MS = 4_000; // bounded; then fail CLOSED as "busy" — never a silent double-accept
const LOCK_POLL_MS = 25;

/** The bounded lock-acquire window. Overridable ONLY via env for tests that assert the fail-closed "busy"
 *  path without waiting the full production window; production reads the constant. */
function lockMaxWaitMs(): number {
  const raw = process.env.AUMLOK_LEDGER_LOCK_WAIT_MS;
  if (raw !== undefined) { const n = Number(raw); if (Number.isFinite(n) && n >= 0) return n; }
  return LOCK_MAX_WAIT_MS;
}

function resolveLedgerPath(homeDir?: string): string {
  return path.join(resolveHome(homeDir), 'aumlok', 'authority-event-ledger.json');
}
function resolveHome(homeDir?: string): string {
  return homeDir ?? process.env.AUKORA_SYMBIOTE_HOME ?? path.join(process.env.HOME || '', '.aukora-symbiote');
}
function ledgerLockPath(homeDir?: string): string {
  return path.join(resolveHome(homeDir), 'aumlok', '.authority-event-ledger.lock');
}

/** Synchronous sleep without busy-spinning the CPU (these are short, human-ceremony lock waits). */
function sleepSync(ms: number): void {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, ms)); } catch { /* fall through */ }
}

/** Race-safe steal of a STALE lock: rename it to a unique grave; only one racer's rename can succeed (the
 *  source vanishes for every loser), so exactly one steal wins. Never removes a fresh (non-stale) lock. */
function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return (e as NodeJS.ErrnoException)?.code === 'EPERM'; }
}

function readLockOwner(p: string): { pid: number; token: string } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (!Number.isInteger(raw?.pid) || typeof raw?.token !== 'string' || raw.token.length < 12) return null;
    return { pid: raw.pid, token: raw.token };
  } catch { return null; }
}

function tryReclaimStaleLock(p: string): void {
  let st: fs.Stats;
  try { st = fs.statSync(p); } catch { return; } // vanished — nothing to reclaim
  if (Date.now() - st.mtimeMs < LOCK_STALE_MS) return; // still fresh — respect it
  const owner = readLockOwner(p);
  if (owner && processIsAlive(owner.pid)) return; // age never overrules a living holder
  const grave = `${p}.stale-${process.pid}-${randomBytes(4).toString('hex')}`;
  try { fs.renameSync(p, grave); fs.rmSync(grave, { force: true }); } catch { /* another racer won the steal */ }
}

function acquireLock(homeDir?: string): { ok: true; fd: number; token: string } | { ok: false; reason: string } {
  const p = ledgerLockPath(homeDir);
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + lockMaxWaitMs();
  for (;;) {
    try {
      const fd = fs.openSync(p, 'wx', 0o600); // O_CREAT|O_EXCL — cross-process mutual exclusion
      const token = randomBytes(16).toString('hex');
      try { fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), token })); fs.fsyncSync(fd); }
      catch { try { fs.closeSync(fd); } catch {} try { fs.rmSync(p, { force: true }); } catch {} return { ok: false, reason: 'could not persist authority-event lock ownership' }; }
      return { ok: true, fd, token };
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== 'EEXIST') return { ok: false, reason: `ledger lock error: ${(e as Error)?.message ?? 'error'}` };
      tryReclaimStaleLock(p);
      if (Date.now() >= deadline) return { ok: false, reason: 'authority-event ledger is locked by another operation on this node — try again' };
      sleepSync(LOCK_POLL_MS);
    }
  }
}

function releaseLock(fd: number, token: string, homeDir?: string): void {
  try { fs.closeSync(fd); } catch { /* already closed */ }
  const p = ledgerLockPath(homeDir);
  const owner = readLockOwner(p);
  if (owner?.pid !== process.pid || owner.token !== token) return;
  try { fs.rmSync(p, { force: true }); } catch { /* best-effort */ }
}

// ── ledger file (validated shape; corrupt THROWS on the enforcement path) ────────────────────────────────
export function canonicalEventHash(canonicalPayload: string): string {
  return createHash('sha256').update(canonicalPayload).digest('hex');
}

function isValidEntry(e: unknown): e is AuthorityEventLedgerEntry {
  return !!e && typeof e === 'object'
    && KINDS.has((e as any).kind)
    && typeof (e as any).canonicalHash === 'string' && /^[0-9a-f]{64}$/.test((e as any).canonicalHash)
    && STATUSES.has((e as any).status)
    && typeof (e as any).reservationId === 'string'
    && typeof (e as any).reservedAt === 'string'
    && ((e as any).installedAt === null || typeof (e as any).installedAt === 'string')
    && ((e as any).abortedAt === null || typeof (e as any).abortedAt === 'string')
    && typeof (e as any).note === 'string';
}

function readLedgerOrThrow(ledgerPath: string): AuthorityEventLedgerEntry[] {
  let text: string;
  try { text = fs.readFileSync(ledgerPath, 'utf-8'); } catch { return []; } // ENOENT — first use
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error(`authority-event ledger is corrupt (invalid JSON) at ${ledgerPath}`); }
  if (!Array.isArray(raw)) throw new Error(`authority-event ledger is corrupt (not an array) at ${ledgerPath}`);
  if (!raw.every(isValidEntry)) throw new Error(`authority-event ledger is corrupt (malformed entry) at ${ledgerPath}`);
  return raw;
}

function writeLedgerAtomic(ledgerPath: string, entries: AuthorityEventLedgerEntry[]): void {
  const dir = path.dirname(ledgerPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmpPath = path.join(dir, `.authority-event-ledger.tmp-${process.pid}-${randomBytes(4).toString('hex')}`);
  const fd = fs.openSync(tmpPath, 'w', 0o600);
  try { fs.writeSync(fd, JSON.stringify(entries, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmpPath, ledgerPath); // atomic replace on POSIX — never a half-written ledger
}

// ── transaction API ──────────────────────────────────────────────────────────────────────────────────────
export type ReserveResult =
  | { ok: true; reservationId: string }
  | { ok: false; reason: string; blocked?: AuthorityEventStatus; corrupt?: true; busy?: true };
export type CommitResult = { ok: true } | { ok: false; reason: string; corrupt?: true; busy?: true };
export type AbortResult = { ok: true } | { ok: false; reason: string; corrupt?: true; busy?: true };

/** Under the exclusive lock, run `fn(entries)` and (if it returns entries) write them atomically. `fn`
 *  returns a discriminated result; the lock is always released. Corrupt-ledger reads surface as the caller's
 *  own corrupt result (fn is only called when the read succeeded). */
function withLedger<R>(homeDir: string | undefined, fn: (entries: AuthorityEventLedgerEntry[], write: (next: AuthorityEventLedgerEntry[]) => void) => R): R | { ok: false; reason: string; corrupt?: true; busy?: true } {
  const lk = acquireLock(homeDir);
  if (!lk.ok) return { ok: false, reason: lk.reason, busy: true };
  const ledgerPath = resolveLedgerPath(homeDir);
  try {
    let entries: AuthorityEventLedgerEntry[];
    try { entries = readLedgerOrThrow(ledgerPath); }
    catch (e) { return { ok: false, reason: e instanceof Error ? e.message : String(e), corrupt: true }; }
    return fn(entries, (next) => writeLedgerAtomic(ledgerPath, next));
  } finally { releaseLock(lk.fd, lk.token, homeDir); }
}

/** RESERVE the exact canonical payload for an in-flight install. Refuses (fail closed) if any row for this
 *  payload already exists — reserved (in-flight/crashed), committed (installed), or aborted (tombstone). */
export function reserveAuthorityEvent(
  kind: AuthorityEventKind, canonicalPayload: string, note: string, now: string, opts: { homeDir?: string } = {},
): ReserveResult {
  const canonicalHash = canonicalEventHash(canonicalPayload);
  return withLedger<ReserveResult>(opts.homeDir, (entries, write) => {
    const existing = entries.find((e) => e.canonicalHash === canonicalHash);
    if (existing) {
      const why = existing.status === 'committed' ? `already installed at ${existing.installedAt}`
        : existing.status === 'reserved' ? 'an attempt for this exact envelope is in flight (or a prior attempt crashed) — refusing a second install'
        : `this exact envelope was already tried and aborted at ${existing.abortedAt} — refusing replay`;
      return { ok: false, reason: why, blocked: existing.status };
    }
    const reservationId = randomBytes(12).toString('hex');
    write([...entries, { kind, canonicalHash, status: 'reserved', reservationId, reservedAt: now, installedAt: null, abortedAt: null, note }]);
    return { ok: true, reservationId };
  });
}

/** COMMIT a reservation (after the install is durable): flip the reserved row for this payload to
 *  `committed` with installedAt. Idempotent on an already-committed row; refuses an aborted/missing row. */
export function commitAuthorityEvent(canonicalPayload: string, installedAt: string, opts: { homeDir?: string } = {}): CommitResult {
  const canonicalHash = canonicalEventHash(canonicalPayload);
  return withLedger<CommitResult>(opts.homeDir, (entries, write) => {
    const idx = entries.findIndex((e) => e.canonicalHash === canonicalHash);
    if (idx < 0) return { ok: false, reason: 'no reservation to commit for this payload' };
    const row = entries[idx];
    if (row.status === 'committed') return { ok: true }; // idempotent (reconcile / retry)
    if (row.status === 'aborted') return { ok: false, reason: 'this payload was aborted — cannot commit an aborted attempt' };
    const next = entries.slice();
    next[idx] = { ...row, status: 'committed', installedAt };
    write(next);
    return { ok: true };
  });
}

/** ABORT a reservation (a KNOWN-failed attempt): flip the reserved row to `aborted`. Idempotent on an
 *  already-aborted row; refuses to abort a committed install; a missing row is a no-op success. */
export function abortAuthorityEvent(canonicalPayload: string, reason: string, now: string, opts: { homeDir?: string } = {}): AbortResult {
  const canonicalHash = canonicalEventHash(canonicalPayload);
  return withLedger<AbortResult>(opts.homeDir, (entries, write) => {
    const idx = entries.findIndex((e) => e.canonicalHash === canonicalHash);
    if (idx < 0) return { ok: true }; // nothing reserved — nothing to abort
    const row = entries[idx];
    if (row.status === 'aborted') return { ok: true };
    if (row.status === 'committed') return { ok: false, reason: 'refusing to abort an already-committed install' };
    const next = entries.slice();
    next[idx] = { ...row, status: 'aborted', abortedAt: now, note: `${row.note} · aborted: ${reason}`.slice(0, 400) };
    write(next);
    return { ok: true };
  });
}

/** Genuinely-atomic (now LOCKED) one-shot for the no-install case: reserve+commit under one lock hold. Kept
 *  for callers that record an event with no separate durable install step. */
export function consumeAuthorityEventOnce(
  kind: AuthorityEventKind, canonicalPayload: string, note: string, now: string, opts: { homeDir?: string } = {},
): { ok: true } | { ok: false; existing: AuthorityEventLedgerEntry } | { ok: false; corrupt: true; reason: string } {
  const canonicalHash = canonicalEventHash(canonicalPayload);
  const r = withLedger<{ ok: true } | { ok: false; existing: AuthorityEventLedgerEntry }>(opts.homeDir, (entries, write) => {
    const existing = entries.find((e) => e.canonicalHash === canonicalHash);
    if (existing) return { ok: false, existing };
    write([...entries, { kind, canonicalHash, status: 'committed', reservationId: randomBytes(12).toString('hex'), reservedAt: now, installedAt: now, abortedAt: null, note }]);
    return { ok: true };
  });
  if ('corrupt' in r && r.corrupt) return { ok: false, corrupt: true, reason: r.reason };
  if ('busy' in r && r.busy) return { ok: false, corrupt: true, reason: r.reason }; // busy is fail-closed for the one-shot too
  return r as { ok: true } | { ok: false; existing: AuthorityEventLedgerEntry };
}

// ── advisory reads (corrupt = honest refusal, never a guess of empty) ────────────────────────────────────
export function listAuthorityEvents(opts: { homeDir?: string } = {}): { ok: true; entries: AuthorityEventLedgerEntry[] } | { ok: false; reason: string } {
  try { return { ok: true, entries: readLedgerOrThrow(resolveLedgerPath(opts.homeDir)) }; }
  catch (e) { return { ok: false, reason: e instanceof Error ? e.message : String(e) }; }
}

/** True iff a COMMITTED row exists for this canonical payload — the ONLY definition of "installed". */
export function isAuthorityEventInstalled(canonicalPayload: string, opts: { homeDir?: string } = {}): boolean {
  const listed = listAuthorityEvents(opts);
  if (!listed.ok) return false; // a corrupt ledger is not "installed"; enforcement paths fail closed elsewhere
  const h = canonicalEventHash(canonicalPayload);
  return listed.entries.some((e) => e.canonicalHash === h && e.status === 'committed');
}
