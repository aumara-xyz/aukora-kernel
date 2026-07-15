// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// The drand-anchor laws, pinned — fully OFFLINE (the fixture is a real quicknet round captured live
// on 2026-07-08 and BLS-verified before this suite was written):
//   1. verification is pure + pinned-key (a tampered round/signature never verifies);
//   2. egress is owner-gated fail-closed (unarmed → the fetch impl is NEVER called);
//   3. a server response that fails the pinned-key check is DISCARDED (no unverified anchors, ever);
//   4. a v2 bind journals the witnessed anchor (the CLOSED v2 genesis receipt pins drandAnchor null —
//      #361 Cycle A); absence stays honest (no witness evidence when no anchor was offered).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { verifyDrandRound, fetchDrandAnchor, expectedDrandRound, DRAND_GENESIS_UNIX, DRAND_PERIOD_S } from '../src/drandAnchor';
import { freshBindStore, mintBindCandidate, completeCeremony, readCeremonyEvidence } from '../src/aumlokBindCeremony';

// Real quicknet round, captured + verified live before authoring (api.drand.sh, 2026-07-08).
const FIX = {
  round: 30226057,
  randomness: '95443ca4a22318a59f34f9a1933d2afa8cfc1df8a05bc0f1020993c351e1f109',
  signature: '8a60dcbcfc1036a69c229bbc5ff59ced72d960fa13dcb7e1561201afa918210fb5a668c9b251fc794d54705dcb5c3369',
};

describe('verifyDrandRound — pure, pinned-key, offline', () => {
  it('verifies the captured live round', () => {
    expect(verifyDrandRound(FIX.round, FIX.signature)).toBe(true);
  });
  it('a tampered round number fails', () => {
    expect(verifyDrandRound(FIX.round + 1, FIX.signature)).toBe(false);
  });
  it('a tampered signature fails (single hex nibble flip)', () => {
    const bad = (FIX.signature[0] === 'a' ? 'b' : 'a') + FIX.signature.slice(1);
    expect(verifyDrandRound(FIX.round, bad)).toBe(false);
  });
  it('malformed inputs fail closed, never throw', () => {
    expect(verifyDrandRound(0, FIX.signature)).toBe(false);
    expect(verifyDrandRound(FIX.round, 'zz'.repeat(48))).toBe(false);
    expect(verifyDrandRound(FIX.round, '')).toBe(false);
  });
  it('expectedDrandRound maps the fixture round to its real emission window', () => {
    const emittedAtMs = (DRAND_GENESIS_UNIX + (FIX.round - 1) * DRAND_PERIOD_S) * 1000;
    expect(expectedDrandRound(emittedAtMs)).toBe(FIX.round);
  });
});

describe('fetchDrandAnchor — owner-gated egress, fail-closed on unverifiable responses', () => {
  it('UNARMED: refuses without ever touching the network', async () => {
    let called = 0;
    const res = await fetchDrandAnchor({ env: {} as NodeJS.ProcessEnv, fetchImpl: async () => { called++; throw new Error('must not be called'); } });
    expect(res.ok).toBe(false);
    expect(called).toBe(0);
  });
  it('ARMED + verified response → anchor with verified:true and clock drift', async () => {
    const emittedAtMs = (DRAND_GENESIS_UNIX + (FIX.round - 1) * DRAND_PERIOD_S) * 1000;
    const res = await fetchDrandAnchor({
      env: { AUKORA_DRAND_ANCHOR: '1' } as NodeJS.ProcessEnv,
      nowMs: emittedAtMs + 1500,
      fetchImpl: async () => ({ ok: true, json: async () => ({ ...FIX }) }),
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.anchor.round).toBe(FIX.round);
      expect(res.anchor.verified).toBe(true);
      expect(res.anchor.grantsAuthority).toBe(false);
      expect(res.anchor.roundDriftFromClock).toBeLessThanOrEqual(1);
    }
  });
  it('ARMED + a lying server (bad signature) → discarded, no anchor (fail-closed)', async () => {
    const res = await fetchDrandAnchor({
      env: { AUKORA_DRAND_ANCHOR: '1' } as NodeJS.ProcessEnv,
      fetchImpl: async () => ({ ok: true, json: async () => ({ ...FIX, round: FIX.round + 2 }) }),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain('BLS');
  });
});

describe('binding receipt ⟷ drand anchor', () => {
  let home: string;
  beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'drand-bind-')); });
  afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

  it('a v2 bind completed WITH an anchor journals the witnessed round (the closed v2 genesis receipt pins null); WITHOUT stays honest', () => {
    // #361 Fable Finish Cycle A: fresh ceremony binds are HYBRID v2. The v2 genesis receipt is a CLOSED
    // shape that pins drandAnchor to null (aumlokBindV2.validateBindingReceiptShape) — folding a verified
    // round into it is a deliberate closed-shape extension for a later brick. The witnessed round is
    // preserved as content-free ceremony evidence instead, so the proof-of-time is never silently dropped.
    const store = freshBindStore();
    const m = mintBindCandidate(store, home, 1_750_000_000_000);
    if (!m.ok) throw new Error('mint failed');
    const anchor = { schema: 'drand-anchor-v1', round: FIX.round, verified: true };
    const done = completeCeremony(store, home, m.phrase, m.nonce, 1_750_000_001_000, anchor);
    expect(done.ok).toBe(true);
    const receipt = JSON.parse(fs.readFileSync(path.join(home, 'aumlok', 'hybrid-v2', 'binding-receipt-v2.json'), 'utf-8'));
    expect(receipt.schema).toBe('aumlok-binding-receipt-v2');
    expect(receipt.drandAnchor).toBe(null); // the closed shape — never a smuggled field
    expect(readCeremonyEvidence(home, 10).some((e) => e.event === 'bind_drand_anchor_witnessed_v2')).toBe(true);

    const home2 = fs.mkdtempSync(path.join(os.tmpdir(), 'drand-bind2-'));
    try {
      const s2 = freshBindStore();
      const m2 = mintBindCandidate(s2, home2, 1_750_000_000_000);
      if (!m2.ok) throw new Error('mint failed');
      completeCeremony(s2, home2, m2.phrase, m2.nonce, 1_750_000_001_000);
      const r2 = JSON.parse(fs.readFileSync(path.join(home2, 'aumlok', 'hybrid-v2', 'binding-receipt-v2.json'), 'utf-8'));
      expect(r2.drandAnchor).toBe(null);
      // no anchor offered → no witness evidence either (absence stays honest)
      expect(readCeremonyEvidence(home2, 10).some((e) => e.event === 'bind_drand_anchor_witnessed_v2')).toBe(false);
    } finally { fs.rmSync(home2, { recursive: true, force: true }); }
  });
});
