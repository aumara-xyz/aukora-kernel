// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/** Tests for the persistent, locked daily spend ledger (blocker 3) using a throwaway temp dir. */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AukoraFuSpendLedger, LedgerError } from '../src/aukoraFuSpendLedger';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aukora-fu-ledger-'));

describe('AukoraFuSpendLedger (blocker 3 persistence)', () => {
  it('missing file → 0; appends accumulate; a fresh instance reads the same total (survives restart)', () => {
    const dir = tmp();
    const l1 = new AukoraFuSpendLedger(dir);
    expect(l1.todayTotalUsd()).toBe(0);
    l1.append(0.10, 'pass 1');
    l1.append(0.05, 'pass 2');
    expect(l1.todayTotalUsd()).toBeCloseTo(0.15, 6);
    // a NEW instance (simulating a new process) reads the same day-to-date — the $10/day cap holds across runs
    expect(new AukoraFuSpendLedger(dir).todayTotalUsd()).toBeCloseTo(0.15, 6);
  });

  it('only today counts toward the day total', () => {
    const dir = tmp();
    const l = new AukoraFuSpendLedger(dir);
    l.append(1.0, 'yesterday', Date.now() - 24 * 3600 * 1000);
    l.append(0.2, 'today');
    expect(l.todayTotalUsd()).toBeCloseTo(0.2, 6);
  });

  it('is append-only (history is never rewritten) and rejects invalid amounts', () => {
    const dir = tmp();
    const l = new AukoraFuSpendLedger(dir);
    l.append(0.1); l.append(0.2);
    const lines = fs.readFileSync(path.join(dir, 'aukora-fu-spend-ledger.jsonl'), 'utf-8').trim().split('\n');
    expect(lines.length).toBe(2);                 // two appends → two lines, none overwritten
    expect(() => l.append(-1)).toThrow();
    expect(() => l.append(NaN)).toThrow();
  });

  it('FAILS CLOSED on a corrupt or non-finite ledger line (never silently skips)', () => {
    const dir = tmp();
    const l = new AukoraFuSpendLedger(dir);
    l.append(0.1, 'good');
    fs.appendFileSync(path.join(dir, 'aukora-fu-spend-ledger.jsonl'), 'this is not json\n');
    expect(() => l.todayTotalUsd()).toThrow(LedgerError);
  });

  it('FAILS CLOSED (does not force-break) when the lock is already held', () => {
    const dir = tmp();
    const l = new AukoraFuSpendLedger(dir);
    fs.mkdirSync(path.join(dir, 'aukora-fu-spend-ledger.jsonl.lock')); // simulate another writer holding the lock
    expect(() => l.append(0.1)).toThrow(LedgerError);
    // the pre-existing lock is still there — it was NOT stolen
    expect(fs.existsSync(path.join(dir, 'aukora-fu-spend-ledger.jsonl.lock'))).toBe(true);
  });
});
