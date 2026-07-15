// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Aukora Fu spend ledger — controller-owned, append-only, locked daily spend record (blocker 3).
 *
 * The in-memory SpendMeter enforces per-pass and per-day ceilings within ONE process; it cannot on its
 * own stop the $10/day cap from resetting every time a new process starts. This ledger persists actual
 * per-pass spend to an append-only JSONL file, so a fresh SpendMeter can be seeded with today's real
 * day-to-date total before a pass, and the ceiling holds ACROSS processes.
 *
 * Append-only (never rewrites history) + a mkdir-based lock (atomic on POSIX and Windows) so concurrent
 * writers cannot interleave a partial line. This module does filesystem I/O but NEVER network, and it is
 * advisory accounting only — it grants no authority.
 */
import * as fs from 'fs';
import * as path from 'path';

export interface SpendEntry {
  date: string;      // YYYY-MM-DD (UTC)
  ts: number;        // epoch ms
  amountUsd: number; // actual spend for one pass
  note?: string;
}

/** Any ledger integrity or availability failure. The pass must FAIL CLOSED on this — never silently
 *  proceed with an unknown or partial day-to-date total (Codex spend/evidence ruling, 2026-07-12). */
export class LedgerError extends Error {}

export const utcDay = (now = Date.now()): string => new Date(now).toISOString().slice(0, 10);

export class AukoraFuSpendLedger {
  private readonly file: string;
  private readonly lockDir: string;

  constructor(private readonly baseDir: string, fileName = 'aukora-fu-spend-ledger.jsonl') {
    this.file = path.join(baseDir, fileName);
    this.lockDir = path.join(baseDir, `${fileName}.lock`);
  }

  /** Sum of actual spend recorded for `date` (default today, UTC). Missing file → 0. A corrupt or
   *  non-finite line FAILS CLOSED (throws) — a partial/ambiguous total must never silently under-count
   *  the day and let a pass slip past the ceiling (Codex ruling, 2026-07-12). */
  todayTotalUsd(date = utcDay()): number {
    let raw: string;
    try { raw = fs.readFileSync(this.file, 'utf-8'); }
    catch (e: any) { if (e?.code === 'ENOENT') return 0; throw new LedgerError(`ledger unreadable: ${e?.message ?? e}`); }
    let total = 0;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let e: SpendEntry;
      try { e = JSON.parse(line) as SpendEntry; }
      catch { throw new LedgerError('corrupt ledger line (unparseable JSON) — failing closed'); }
      if (typeof e.date !== 'string' || typeof e.amountUsd !== 'number' || !Number.isFinite(e.amountUsd)) {
        throw new LedgerError('non-finite/invalid ledger entry — failing closed');
      }
      if (e.date === date) total += e.amountUsd;
    }
    return total;
  }

  /** Append one pass's actual spend under a short-held lock. Returns the new day-to-date total. */
  append(amountUsd: number, note?: string, now = Date.now()): number {
    if (!Number.isFinite(amountUsd) || amountUsd < 0) throw new Error(`invalid spend amount: ${amountUsd}`);
    fs.mkdirSync(this.baseDir, { recursive: true });
    this.withLock(() => {
      const entry: SpendEntry = { date: utcDay(now), ts: now, amountUsd, note };
      fs.appendFileSync(this.file, JSON.stringify(entry) + '\n');
    });
    return this.todayTotalUsd(utcDay(now));
  }

  /** Atomic lock via mkdir (fails if the dir already exists). Bounded spin, then FAIL CLOSED — an active
   *  lock is NEVER force-broken merely because time elapsed (Codex ruling, 2026-07-12): a held lock means
   *  another writer is mid-append, and stealing it would corrupt the ledger. The pass fails instead. */
  private withLock<T>(fn: () => T, attempts = 50, waitMs = 20): T {
    let acquired = false;
    for (let i = 0; i < attempts; i++) {
      try { fs.mkdirSync(this.lockDir); acquired = true; break; }
      catch { const until = Date.now() + waitMs; while (Date.now() < until) { /* brief spin */ } }
    }
    if (!acquired) throw new LedgerError(`ledger lock unavailable after ${attempts} attempts — failing closed (not force-breaking)`);
    try { return fn(); }
    finally { try { fs.rmdirSync(this.lockDir); } catch { /* already released */ } }
  }
}
