// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// #361 Fable Finish amendment (Codex review B2) — EVIDENCE-FIRST crash safety. Authority state is never
// mutated without its full signed lineage/lifecycle artifact already durable, and a crash between the
// authority mutation and the ledger commit is deterministically reconciled. These tests inject fs faults at
// each boundary and prove: a receipt/event-write failure never installs; a publish failure after the receipt
// leaves the node honestly at its prior state with no orphan; a durable install whose ledger row is still
// `reserved` is deterministically committed; and a best-effort journal failure never blocks the install (the
// embedded signed event is the durable authority-bound evidence). Generated custody in mkdtemp homes.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const fsCtl = vi.hoisted(() => ({
  onOpen: null as null | ((p: string, flags: string) => void | 'throw'),
  onRename: null as null | ((from: string, to: string) => void | 'throw'),
  onAppend: null as null | ((p: string) => void | 'throw'),
}));
vi.mock('fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('fs')>();
  const wrapped = {
    ...real,
    openSync: ((p: unknown, flags: unknown, mode?: unknown) => {
      if (fsCtl.onOpen?.(String(p), String(flags)) === 'throw') throw new Error('injected: openSync');
      return real.openSync(p as never, flags as never, mode as never);
    }) as typeof real.openSync,
    renameSync: ((a: unknown, b: unknown) => {
      if (fsCtl.onRename?.(String(a), String(b)) === 'throw') throw new Error('injected: renameSync');
      return real.renameSync(a as never, b as never);
    }) as typeof real.renameSync,
    appendFileSync: ((p: unknown, data: unknown, opts?: unknown) => {
      if (fsCtl.onAppend?.(String(p)) === 'throw') throw new Error('injected: appendFileSync');
      return real.appendFileSync(p as never, data as never, opts as never);
    }) as typeof real.appendFileSync,
  };
  return { ...wrapped, default: wrapped };
});
import { bindHybridV2, hybridV2StatePresent, hybridBindStatusV2, hybridBundleDir } from '../src/aumlokBindV2';
import { migrateV1ToHybridV2, migrationReceiptPath, reconcileMigrationLedger } from '../src/aumlokMigrateV2';
import { rotateHybridV2, revokeHybridV2 } from '../src/aumlokLifecycleV2';
import { listAuthorityEvents } from '../src/aumlokAuthorityEventLedger';
import { generateKeypair } from '../src/aumlokSigner';
import { pinAuthorityRoot, serializeRootManifest } from '../src/aumlokAuthorityRoot';

const PHRASE = 'harbor-otter-maple-river-bison-ember-rowan';
const NOW = Date.parse('2026-07-13T12:00:00.000Z');
const LEDGER = (h: string) => path.join(h, 'aumlok', 'authority-event-ledger.json');

let homeDir: string;
beforeEach(() => { fsCtl.onOpen = null; fsCtl.onRename = null; fsCtl.onAppend = null; homeDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aumlok-fault-')); });
afterEach(() => { fsCtl.onOpen = null; fsCtl.onRename = null; fsCtl.onAppend = null; fs.rmSync(homeDir, { recursive: true, force: true }); });

function writeV1Identity(h: string): void {
  const dir = path.join(h, 'aumlok');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const pair = generateKeypair();
  fs.writeFileSync(path.join(dir, 'authority-ed25519.key'), pair.privateKeyHex, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'authority-ed25519.pub'), pair.publicKeyHex);
  fs.writeFileSync(path.join(dir, 'authority-root.json'), serializeRootManifest(pinAuthorityRoot(pair.publicKeyHex)));
}
const committedCount = () => { const l = listAuthorityEvents({ homeDir }); return l.ok ? l.entries.filter((e) => e.status === 'committed').length : -1; };

describe('migration — evidence-first, crash-safe', () => {
  it('receipt-write fault: no bundle installed, no committed row, and a fresh retry still succeeds', () => {
    writeV1Identity(homeDir);
    fsCtl.onOpen = (p) => { if (p.endsWith('migration-receipt-v1.json')) return 'throw'; };
    const r = migrateV1ToHybridV2(homeDir, PHRASE, NOW);
    fsCtl.onOpen = null;
    expect(r.ok).toBe(false);
    expect(hybridV2StatePresent(homeDir)).toBe(false);                 // authority NOT mutated
    expect(fs.existsSync(migrationReceiptPath(homeDir))).toBe(false);  // no durable evidence orphan
    expect(committedCount()).toBe(0);                                  // the reservation is aborted, never committed
    // a retry (fresh envelope → new canonical hash) is NOT blocked by the aborted attempt
    const retry = migrateV1ToHybridV2(homeDir, PHRASE, NOW + 1000);
    expect(retry.ok).toBe(true);
    expect(hybridBindStatusV2(homeDir).bound).toBe(true);
    expect(committedCount()).toBe(1);
  });

  it('publish fault AFTER the receipt: node stays v1, the orphan receipt is cleaned, the reservation aborts', () => {
    writeV1Identity(homeDir);
    fsCtl.onRename = (from, to) => { if (from.includes('.bindv2-') && to.endsWith(`${path.sep}hybrid-v2`)) return 'throw'; };
    const r = migrateV1ToHybridV2(homeDir, PHRASE, NOW);
    fsCtl.onRename = null;
    expect(r.ok).toBe(false);
    expect(hybridV2StatePresent(homeDir)).toBe(false);                                     // node still v1
    expect(fs.existsSync(path.join(homeDir, 'aumlok', 'authority-ed25519.key'))).toBe(true); // v1 identity intact
    expect(fs.existsSync(migrationReceiptPath(homeDir))).toBe(false);                       // orphan receipt removed
    expect(committedCount()).toBe(0);
  });

  it('deterministic reconcile: a durable install whose ledger row is still `reserved` is committed', () => {
    writeV1Identity(homeDir);
    expect(migrateV1ToHybridV2(homeDir, PHRASE, NOW).ok).toBe(true);
    expect(committedCount()).toBe(1);
    // simulate a crash BETWEEN publish and commit: flip the committed row back to reserved
    const led = JSON.parse(fs.readFileSync(LEDGER(homeDir), 'utf-8'));
    led[0].status = 'reserved'; led[0].installedAt = null;
    fs.writeFileSync(LEDGER(homeDir), JSON.stringify(led));
    expect(committedCount()).toBe(0);
    expect(hybridBindStatusV2(homeDir).bound).toBe(true); // the install itself is durable regardless
    reconcileMigrationLedger(homeDir);                    // deterministic recovery
    expect(committedCount()).toBe(1);
  });
});

describe('rotation — evidence embedded with the swap', () => {
  it('embedded-event-write fault before the swap: custody unchanged, reservation aborts', () => {
    bindHybridV2(homeDir, PHRASE, NOW);
    const before = hybridBindStatusV2(homeDir).rootId;
    fsCtl.onOpen = (p) => { if (p.endsWith('lifecycle-event-v2.json')) return 'throw'; };
    const r = rotateHybridV2(homeDir, PHRASE, NOW + 1000);
    fsCtl.onOpen = null;
    expect(r.ok).toBe(false);
    expect(hybridBindStatusV2(homeDir).rootId).toBe(before); // no swap happened
    expect(committedCount()).toBe(0);
  });

  it('best-effort JOURNAL failure never blocks the rotation — the embedded signed event is the durable evidence', () => {
    bindHybridV2(homeDir, PHRASE, NOW);
    fsCtl.onAppend = () => 'throw'; // the append-only history write fails
    const r = rotateHybridV2(homeDir, PHRASE, NOW + 1000);
    fsCtl.onAppend = null;
    expect(r.ok).toBe(true); // history is best-effort; the rotation still succeeds
    // the authoritative signed evidence rode into the bundle atomically with the swap
    expect(fs.existsSync(path.join(hybridBundleDir(homeDir), 'lifecycle-event-v2.json'))).toBe(true);
    expect(committedCount()).toBe(1);
  });
});

describe('revocation — evidence-first before the reseal', () => {
  it('revoke-event-write fault: manifest NOT sealed, node not revoked, reservation aborts', () => {
    bindHybridV2(homeDir, PHRASE, NOW);
    fsCtl.onOpen = (p) => { if (p.endsWith('revoke-event-v2.json')) return 'throw'; };
    const r = revokeHybridV2(homeDir, PHRASE, NOW + 1000);
    fsCtl.onOpen = null;
    expect(r.ok).toBe(false);
    expect(hybridBindStatusV2(homeDir).revoked).toBe(false); // authority NOT mutated
    expect(committedCount()).toBe(0);
  });

  it('reseal fault AFTER the event write: node not revoked, the orphan revoke event is removed, reservation aborts', () => {
    bindHybridV2(homeDir, PHRASE, NOW);
    fsCtl.onRename = (_from, to) => { if (to.endsWith('authority-root-v2.json')) return 'throw'; };
    const r = revokeHybridV2(homeDir, PHRASE, NOW + 1000);
    fsCtl.onRename = null;
    expect(r.ok).toBe(false);
    expect(hybridBindStatusV2(homeDir).revoked).toBe(false);
    expect(fs.existsSync(path.join(hybridBundleDir(homeDir), 'revoke-event-v2.json'))).toBe(false); // orphan removed
    expect(committedCount()).toBe(0);
    // and a fresh revoke (new envelope) still works afterward
    expect(revokeHybridV2(homeDir, PHRASE, NOW + 2000).ok).toBe(true);
    expect(hybridBindStatusV2(homeDir).revoked).toBe(true);
  });
});
