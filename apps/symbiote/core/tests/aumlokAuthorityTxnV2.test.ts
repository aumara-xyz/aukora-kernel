// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// #361 Fable Finish amendment (Codex review B1) — the authority-event ledger is now a cross-process,
// crash-safe RESERVE → COMMIT | ABORT transaction. These tests pin: the state machine (reserved blocks
// replay, committed blocks replay, aborted tombstones, none-but-committed reads installed); corrupt
// fail-closed; bounded lock-contention "busy" fail-closed; race-safe stale-lock reclaim; and a REAL
// multiprocess race (spawned processes) proving exactly-once commit with no lost entries.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import {
  reserveAuthorityEvent, commitAuthorityEvent, abortAuthorityEvent, consumeAuthorityEventOnce,
  listAuthorityEvents, isAuthorityEventInstalled, canonicalEventHash,
} from '../src/aumlokAuthorityEventLedger';

const NOW = '2026-07-13T12:00:00.000Z';
const LEDGER = (h: string) => path.join(h, 'aumlok', 'authority-event-ledger.json');
const LOCK = (h: string) => path.join(h, 'aumlok', '.authority-event-ledger.lock');

let homeDir: string;
beforeEach(() => { homeDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aumlok-txn-')); });
afterEach(() => { fs.rmSync(homeDir, { recursive: true, force: true }); });

describe('reserve → commit | abort state machine', () => {
  it('reserve then commit installs; both reserved and committed refuse a replay; only committed reads installed', () => {
    const p = 'payload-A';
    const r = reserveAuthorityEvent('migration-v1-to-v2', p, 'note', NOW, { homeDir });
    expect(r.ok).toBe(true);
    // a reserved row is NOT installed yet, but it already blocks replay (in-flight/crashed)
    expect(isAuthorityEventInstalled(p, { homeDir })).toBe(false);
    const replayWhileReserved = reserveAuthorityEvent('migration-v1-to-v2', p, 'note', NOW, { homeDir });
    expect(replayWhileReserved.ok).toBe(false);
    if (!replayWhileReserved.ok) expect(replayWhileReserved.blocked).toBe('reserved');
    // commit → installed
    expect(commitAuthorityEvent(p, NOW, { homeDir }).ok).toBe(true);
    expect(isAuthorityEventInstalled(p, { homeDir })).toBe(true);
    const replayAfterCommit = reserveAuthorityEvent('migration-v1-to-v2', p, 'note', NOW, { homeDir });
    expect(replayAfterCommit.ok).toBe(false);
    if (!replayAfterCommit.ok) expect(replayAfterCommit.blocked).toBe('committed');
    // exactly one row for this payload
    const listed = listAuthorityEvents({ homeDir });
    expect(listed.ok && listed.entries.filter((e) => e.canonicalHash === canonicalEventHash(p)).length).toBe(1);
  });

  it('abort tombstones a failed attempt: it never reads installed, and replay of the SAME payload refuses', () => {
    const p = 'payload-B';
    expect(reserveAuthorityEvent('lifecycle-rotate', p, 'n', NOW, { homeDir }).ok).toBe(true);
    expect(abortAuthorityEvent(p, 'install failed', NOW, { homeDir }).ok).toBe(true);
    expect(isAuthorityEventInstalled(p, { homeDir })).toBe(false);
    const replay = reserveAuthorityEvent('lifecycle-rotate', p, 'n', NOW, { homeDir });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.blocked).toBe('aborted');
    // committing an aborted attempt refuses; aborting again is idempotent
    expect(commitAuthorityEvent(p, NOW, { homeDir }).ok).toBe(false);
    expect(abortAuthorityEvent(p, 'again', NOW, { homeDir }).ok).toBe(true);
  });

  it('a DIFFERENT payload is unaffected — a failed/aborted attempt never blocks a fresh envelope', () => {
    expect(reserveAuthorityEvent('lifecycle-rotate', 'attempt-1', 'n', NOW, { homeDir }).ok).toBe(true);
    expect(abortAuthorityEvent('attempt-1', 'crashed', NOW, { homeDir }).ok).toBe(true);
    // a retry generates a fresh envelope (new nonce/seeds → different canonical payload) — proceeds cleanly
    const retry = reserveAuthorityEvent('lifecycle-rotate', 'attempt-2', 'n', NOW, { homeDir });
    expect(retry.ok).toBe(true);
    expect(commitAuthorityEvent('attempt-2', NOW, { homeDir }).ok).toBe(true);
    expect(isAuthorityEventInstalled('attempt-2', { homeDir })).toBe(true);
  });

  it('the one-shot consumeAuthorityEventOnce is atomic: first commits, replay refuses, corrupt fails closed', () => {
    const p = 'oneshot-X';
    expect(consumeAuthorityEventOnce('migration-v1-to-v2', p, 'n', NOW, { homeDir }).ok).toBe(true);
    const replay = consumeAuthorityEventOnce('migration-v1-to-v2', p, 'n', NOW, { homeDir });
    expect(replay.ok).toBe(false);
    if (!replay.ok && 'existing' in replay) expect(replay.existing.installedAt).toBe(NOW);
    // corrupt ledger → enforcement fails closed (never reads as "nothing installed")
    fs.writeFileSync(LEDGER(homeDir), 'not json');
    const onCorrupt = reserveAuthorityEvent('lifecycle-revoke', 'y', 'n', NOW, { homeDir });
    expect(onCorrupt.ok).toBe(false);
    if (!onCorrupt.ok) expect(onCorrupt.corrupt).toBe(true);
    expect(listAuthorityEvents({ homeDir }).ok).toBe(false);
  });
});

describe('cross-process lock', () => {
  it('a held lock fails the reserve CLOSED as busy within the bounded window (never a silent double-accept)', () => {
    fs.mkdirSync(path.join(homeDir, 'aumlok'), { recursive: true, mode: 0o700 });
    const held = fs.openSync(LOCK(homeDir), 'wx', 0o600); // a live lock, freshly held
    try {
      process.env.AUMLOK_LEDGER_LOCK_WAIT_MS = '150'; // shrink the bounded window for the test
      const r = reserveAuthorityEvent('migration-v1-to-v2', 'p', 'n', NOW, { homeDir });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.busy).toBe(true);
    } finally {
      delete process.env.AUMLOK_LEDGER_LOCK_WAIT_MS;
      fs.closeSync(held); fs.rmSync(LOCK(homeDir), { force: true });
    }
  });

  it('a STALE lock (older than the crash threshold) is reclaimed race-safely and the reserve proceeds', () => {
    fs.mkdirSync(path.join(homeDir, 'aumlok'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(LOCK(homeDir), JSON.stringify({ pid: 999999, at: 'old' }), { mode: 0o600 });
    const old = new Date(Date.now() - 120_000); // 2 minutes ago > 60s stale threshold
    fs.utimesSync(LOCK(homeDir), old, old);
    const r = reserveAuthorityEvent('lifecycle-rotate', 'p', 'n', NOW, { homeDir });
    expect(r.ok).toBe(true); // the crashed lock was reclaimed
    expect(fs.existsSync(LOCK(homeDir))).toBe(false); // released cleanly after the operation
  });

  it('age never steals a lock from a living holder', () => {
    fs.mkdirSync(path.join(homeDir, 'aumlok'), { recursive: true, mode: 0o700 });
    const token = '0123456789abcdef0123456789abcdef';
    fs.writeFileSync(LOCK(homeDir), JSON.stringify({ pid: process.pid, at: 'old', token }), { mode: 0o600 });
    const old = new Date(Date.now() - 120_000);
    fs.utimesSync(LOCK(homeDir), old, old);
    try {
      process.env.AUMLOK_LEDGER_LOCK_WAIT_MS = '100';
      const r = reserveAuthorityEvent('lifecycle-rotate', 'living-holder', 'n', NOW, { homeDir });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.busy).toBe(true);
      expect(JSON.parse(fs.readFileSync(LOCK(homeDir), 'utf-8')).token).toBe(token);
    } finally {
      delete process.env.AUMLOK_LEDGER_LOCK_WAIT_MS;
      fs.rmSync(LOCK(homeDir), { force: true });
    }
  });
});

describe('REAL multiprocess race (spawned processes)', () => {
  const BUN = process.execPath.includes('bun') ? process.execPath : 'bun';
  const CORE = path.join(__dirname, '..');
  const child = (payload: string): Promise<string> => new Promise((resolve) => {
    const code = `
      const L = require('./src/aumlokAuthorityEventLedger');
      const p = process.env.PAYLOAD; const H = process.env.H; const now = new Date().toISOString();
      const r = L.reserveAuthorityEvent('migration-v1-to-v2', p, 'race', now, { homeDir: H });
      if (!r.ok) { console.log('refused'); process.exit(0); }
      const c = L.commitAuthorityEvent(p, now, { homeDir: H });
      console.log(c.ok ? 'committed' : 'commitfail'); process.exit(0);
    `;
    const cp = spawn(BUN, ['-e', code], { cwd: CORE, env: { ...process.env, PAYLOAD: payload, H: homeDir } });
    let out = '';
    cp.stdout.on('data', (d) => { out += d.toString(); });
    cp.on('close', () => resolve(out.trim().split('\n').pop() || ''));
  });

  it('N processes racing the SAME payload → exactly ONE commits, the rest refuse; ledger has ONE row, no lost entries', async () => {
    const N = 8;
    const results = await Promise.all(Array.from({ length: N }, () => child('same-payload-race')));
    expect(results.filter((r) => r === 'committed').length).toBe(1);
    expect(results.filter((r) => r === 'refused').length).toBe(N - 1);
    const listed = listAuthorityEvents({ homeDir });
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      const rows = listed.entries.filter((e) => e.canonicalHash === canonicalEventHash('same-payload-race'));
      expect(rows.length).toBe(1);                 // no duplicate accept
      expect(rows[0].status).toBe('committed');
    }
  }, 60_000);

  it('N processes racing DIFFERENT payloads → all commit; the ledger holds all N, none lost to a clobber', async () => {
    const N = 8;
    const payloads = Array.from({ length: N }, (_, i) => `distinct-payload-${i}`);
    const results = await Promise.all(payloads.map((p) => child(p)));
    expect(results.every((r) => r === 'committed')).toBe(true);
    const listed = listAuthorityEvents({ homeDir });
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.entries.filter((e) => e.status === 'committed').length).toBe(N); // no lost entries
      for (const p of payloads) expect(isAuthorityEventInstalled(p, { homeDir })).toBe(true);
    }
  }, 60_000);
});
