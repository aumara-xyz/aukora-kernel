import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  evaluateFreshness,
  advanceHighWater,
  InMemoryHighWaterStore,
  highWaterChecksum,
  verifyHighWaterRecord,
  highWaterMac,
  verifyHighWaterMac,
  resolveHighWaterMacSecret,
  assessHighWaterEntry,
  type HighWaterRecord,
  type HighWaterMacSecret,
  type FreshnessHeadInput,
} from '../src/convexCanonicalFreshness';

function head(over: Partial<FreshnessHeadInput> = {}): FreshnessHeadInput {
  return { chainKey: 'organism', count: 10, lastChainHash: 'h10', receiptLogRoot: 'r10', headSignedAt: 1000, ...over };
}
function rec(over: Partial<HighWaterRecord> = {}): HighWaterRecord {
  return { chainKey: 'organism', maxCount: 10, headHash: 'h10', receiptLogRoot: 'r10', headSignedAt: 1000, recordedAt: 1000, ...over };
}

describe('24Y.8: evaluateFreshness — replay/rollback/fork matrix', () => {
  it('no prior history → unknown_no_history (advances, NOT GREEN)', () => {
    const r = evaluateFreshness(null, head());
    expect(r.verdict).toBe('unknown_no_history');
    expect(r.freshnessVerified).toBe(false);
    expect(r.advanced).toBe(true);
    expect(r.replayRisk).toBe('low');
  });

  it('count increases → fresh', () => {
    const r = evaluateFreshness(rec({ maxCount: 9, headHash: 'h9', receiptLogRoot: 'r9' }), head({ count: 10 }));
    expect(r.verdict).toBe('fresh');
    expect(r.freshnessVerified).toBe(true);
    expect(r.replayRisk).toBe('none');
    expect(r.advanced).toBe(true);
  });

  it('same signed head observed twice → same_head (OK, no advance)', () => {
    const r = evaluateFreshness(rec(), head());
    expect(r.verdict).toBe('same_head');
    expect(r.replayRisk).toBe('none');
    expect(r.advanced).toBe(false);
    expect(r.freshnessVerified).toBe(false);
  });

  it('count decreases → rollback (SEVERE)', () => {
    const r = evaluateFreshness(rec({ maxCount: 12, headHash: 'h12' }), head({ count: 10 }));
    expect(r.verdict).toBe('rollback');
    expect(r.replayRisk).toBe('severe');
    expect(r.advanced).toBe(false);
  });

  it('same count, different hash → fork (SEVERE)', () => {
    const r = evaluateFreshness(rec(), head({ lastChainHash: 'DIFFERENT' }));
    expect(r.verdict).toBe('fork');
    expect(r.replayRisk).toBe('severe');
  });

  it('same count, different receiptLogRoot → fork (SEVERE)', () => {
    const r = evaluateFreshness(rec(), head({ receiptLogRoot: 'DIFFERENT' }));
    expect(r.verdict).toBe('fork');
    expect(r.replayRisk).toBe('severe');
  });

  it('older timestamp with HIGHER count → fresh (count is the ordering authority, not ts)', () => {
    // window NOT enforced → timestamp ignored for ordering
    const r = evaluateFreshness(rec({ maxCount: 9 }), head({ count: 10, headSignedAt: 1 }));
    expect(r.verdict).toBe('fresh');
    expect(r.timestampStatus).toBe('not_enforced');
  });

  it('count advanced but timestamp OUTSIDE enforced window → stale (low risk)', () => {
    const r = evaluateFreshness(
      rec({ maxCount: 9 }),
      head({ count: 10, headSignedAt: 1000 }),
      { maxAgeMs: 60_000, now: 1000 + 120_000 }, // signed 120s ago, window 60s
    );
    expect(r.verdict).toBe('stale');
    expect(r.timestampStatus).toBe('stale');
    expect(r.replayRisk).toBe('low');
    expect(r.freshnessVerified).toBe(false);
  });

  it('count advanced and timestamp WITHIN window → fresh + within_window', () => {
    const r = evaluateFreshness(
      rec({ maxCount: 9 }),
      head({ count: 10, headSignedAt: 1000 }),
      { maxAgeMs: 60_000, now: 1000 + 30_000 },
    );
    expect(r.verdict).toBe('fresh');
    expect(r.timestampStatus).toBe('within_window');
    expect(r.freshnessVerified).toBe(true);
  });

  it('enforced window but head has no timestamp → stale (fail closed)', () => {
    const r = evaluateFreshness(rec({ maxCount: 9 }), head({ count: 10, headSignedAt: null }), { maxAgeMs: 1000, now: 5000 });
    expect(r.timestampStatus).toBe('stale');
    expect(r.verdict).toBe('stale');
  });

  it('chainKey mismatch in record → unknown (defensive, never compared)', () => {
    const r = evaluateFreshness(rec({ chainKey: 'other' }), head({ chainKey: 'organism' }));
    expect(r.verdict).toBe('unknown_no_history');
    expect(r.reason).toContain('chainkey_mismatch');
  });
});

describe('24Y.8: advanceHighWater + store', () => {
  it('advanceHighWater captures the head as the new high-water', () => {
    const hw = advanceHighWater(head({ count: 11, lastChainHash: 'h11', receiptLogRoot: 'r11', headSignedAt: 2000 }), 9999);
    expect(hw.maxCount).toBe(11);
    expect(hw.headHash).toBe('h11');
    expect(hw.receiptLogRoot).toBe('r11');
    expect(hw.recordedAt).toBe(9999);
  });

  it('in-memory store round-trips and detects a replay across reads', () => {
    const store = new InMemoryHighWaterStore();
    expect(store.get('organism')).toBeNull();
    // first fresh advance
    let r = evaluateFreshness(store.get('organism'), head({ count: 10 }));
    expect(r.verdict).toBe('unknown_no_history');
    store.set(advanceHighWater(head({ count: 10 }), 1));
    // a later REPLAY of an older head is caught
    r = evaluateFreshness(store.get('organism'), head({ count: 8, lastChainHash: 'h8' }));
    expect(r.verdict).toBe('rollback');
    expect(r.replayRisk).toBe('severe');
  });
});

describe('24Y.8: high-water corruption integrity (checksum)', () => {
  const rec = (): HighWaterRecord => ({ chainKey: 'organism', maxCount: 10, headHash: 'h10', receiptLogRoot: 'r10', headSignedAt: 1000, recordedAt: 1 });

  it('a valid record + its checksum round-trips', () => {
    const r = rec();
    const cs = highWaterChecksum(r);
    expect(verifyHighWaterRecord(r, cs)).not.toBeNull();
    expect(verifyHighWaterRecord(r, cs)!.maxCount).toBe(10);
  });

  it('a LOWERED count without recomputing the checksum is rejected (fail closed)', () => {
    const r = rec();
    const cs = highWaterChecksum(r);
    const tampered = { ...r, maxCount: 2 }; // naive attacker lowers the baseline
    expect(verifyHighWaterRecord(tampered, cs)).toBeNull();
  });

  it('checksum is independent of recordedAt (ordering fields only)', () => {
    expect(highWaterChecksum(rec())).toBe(highWaterChecksum({ ...rec(), recordedAt: 999999 }));
  });

  it('checksum CHANGES when an ordering field changes', () => {
    expect(highWaterChecksum(rec())).not.toBe(highWaterChecksum({ ...rec(), maxCount: 11 }));
    expect(highWaterChecksum(rec())).not.toBe(highWaterChecksum({ ...rec(), headHash: 'X' }));
    expect(highWaterChecksum(rec())).not.toBe(highWaterChecksum({ ...rec(), receiptLogRoot: 'X' }));
  });

  it('malformed record (missing/garbage fields) → null', () => {
    expect(verifyHighWaterRecord({ chainKey: 'x' }, 'whatever')).toBeNull();
    expect(verifyHighWaterRecord(null, 'x')).toBeNull();
    expect(verifyHighWaterRecord({ ...rec(), maxCount: -1 }, highWaterChecksum({ ...rec(), maxCount: -1 }))).toBeNull();
  });

  it('checksum is NOT claimed as tamper-resistance (honest doc)', () => {
    const fs = require('fs'); const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'convexCanonicalFreshness.ts'), 'utf-8');
    expect(src).toContain('CORRUPTION integrity (not tamper-resistance)');
    expect(src).toContain('keyed MAC');
  });
});

describe('24Y.9: keyed MAC tamper-resistance', () => {
  const rec = (): HighWaterRecord => ({ chainKey: 'organism', maxCount: 10, headHash: 'h10', receiptLogRoot: 'r10', headSignedAt: 1000, recordedAt: 1 });
  const SECRET: HighWaterMacSecret = { key: 'x'.repeat(40), source: 'env' };
  const entryWith = (r: HighWaterRecord, secret: HighWaterMacSecret | null) => ({
    record: r, checksum: highWaterChecksum(r), ...(secret ? { mac: highWaterMac(r, secret) } : {}),
  });

  it('valid MAC verifies', () => {
    expect(verifyHighWaterMac(rec(), highWaterMac(rec(), SECRET), SECRET)).toBe(true);
  });

  it('wrong secret → MAC rejects', () => {
    const mac = highWaterMac(rec(), SECRET);
    expect(verifyHighWaterMac(rec(), mac, { key: 'y'.repeat(40), source: 'env' })).toBe(false);
  });

  it('tampered record → MAC rejects', () => {
    const mac = highWaterMac(rec(), SECRET);
    expect(verifyHighWaterMac({ ...rec(), maxCount: 2 }, mac, SECRET)).toBe(false);
  });

  it('assess: secret + valid mac → mac_verified, tamperResistant', () => {
    const a = assessHighWaterEntry(entryWith(rec(), SECRET), SECRET);
    expect(a.integrity).toBe('mac_verified');
    expect(a.tamperResistant).toBe(true);
    expect(a.record).not.toBeNull();
  });

  it('assess: NO secret → checksum_only, NOT tamper-resistant (record still usable for dev)', () => {
    const a = assessHighWaterEntry(entryWith(rec(), null), null);
    expect(a.integrity).toBe('checksum_only');
    expect(a.tamperResistant).toBe(false);
    expect(a.record).not.toBeNull();
  });

  it('assess: secret configured but entry has NO mac → mac_missing, record DISCARDED (fail closed)', () => {
    const a = assessHighWaterEntry(entryWith(rec(), null), SECRET);
    expect(a.integrity).toBe('mac_missing');
    expect(a.tamperResistant).toBe(false);
    expect(a.record).toBeNull();
  });

  it('assess: secret + INVALID mac (tamper) → mac_invalid, record DISCARDED', () => {
    const tampered = { record: { ...rec(), maxCount: 2 }, checksum: highWaterChecksum({ ...rec(), maxCount: 2 }), mac: highWaterMac(rec(), SECRET) };
    const a = assessHighWaterEntry(tampered, SECRET);
    expect(a.integrity).toBe('mac_invalid');
    expect(a.record).toBeNull();
  });

  it('assess: corrupt checksum → none (safe degrade) regardless of secret', () => {
    const a = assessHighWaterEntry({ record: rec(), checksum: 'WRONG', mac: highWaterMac(rec(), SECRET) }, SECRET);
    expect(a.integrity).toBe('none');
    expect(a.record).toBeNull();
  });

  it('deleted/missing entry → none, unknown baseline (not green)', () => {
    const a = assessHighWaterEntry(null, SECRET);
    expect(a.integrity).toBe('none');
    expect(a.record).toBeNull();
  });

  it('resolveHighWaterMacSecret: unset → null (checksum_only, no false tamper-resistance claim)', () => {
    expect(resolveHighWaterMacSecret({})).toBeNull();
  });

  it('resolveHighWaterMacSecret: valid env secret → resolved (env source)', () => {
    const s = resolveHighWaterMacSecret({ AUKORA_HIGH_WATER_MAC_SECRET: 'z'.repeat(40) });
    expect(s).not.toBeNull();
    expect(s!.source).toBe('env');
  });

  it('resolveHighWaterMacSecret: too-short secret → throws (fail closed)', () => {
    expect(() => resolveHighWaterMacSecret({ AUKORA_HIGH_WATER_MAC_SECRET: 'short' })).toThrow('too_short');
  });

  it('resolveHighWaterMacSecret: error message NEVER contains the secret value (24Y.9 Fusion)', () => {
    const secret = 'SUPER-SECRET-VALUE-1234567890-abcdefghij';
    try {
      // even a long secret that fails for another reason must not echo the value; force a short one too
      resolveHighWaterMacSecret({ AUKORA_HIGH_WATER_MAC_SECRET: secret.slice(0, 5) });
      expect.fail('should have thrown');
    } catch (e) {
      expect(String((e as Error).message)).not.toContain('SUPER-SECRET');
      expect(String((e as Error).message)).not.toContain(secret.slice(0, 5));
    }
  });

  it('MAC compare rejects a same-length wrong MAC (XOR accumulation, not ===)', () => {
    const r = rec();
    const good = highWaterMac(r, SECRET);
    const wrong = good.slice(0, -1) + (good.endsWith('0') ? '1' : '0'); // same length, last nibble flipped
    expect(verifyHighWaterMac(r, wrong, SECRET)).toBe(false);
    expect(verifyHighWaterMac(r, good, SECRET)).toBe(true);
  });

  it('MAC compare is described as constant-time (no "ish" hedge)', () => {
    const fs = require('fs'); const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'convexCanonicalFreshness.ts'), 'utf-8');
    expect(src).toContain('Constant-time hex compare via XOR accumulation');
    expect(src).not.toContain('constant-time-ish');
  });

  it('resolveHighWaterMacSecret: file source', () => {
    const s = resolveHighWaterMacSecret({ AUKORA_HIGH_WATER_MAC_SECRET_FILE: '/tmp/whatever' }, () => 'q'.repeat(40));
    expect(s!.source).toBe('file');
  });

  it('replay after deleting store with MAC configured → no trusted baseline (unknown), NOT fresh', () => {
    // attacker deletes the file (entry null). With a secret configured, there is simply no baseline.
    const a = assessHighWaterEntry(null, SECRET);
    const r = evaluateFreshness(a.record, { chainKey: 'organism', count: 5, lastChainHash: 'h5', receiptLogRoot: 'r5', headSignedAt: 1 });
    expect(r.verdict).toBe('unknown_no_history');
    expect(r.freshnessVerified).toBe(false); // a replayed head is shown but NEVER 'fresh' after a reset
  });
});

describe('24Y.9: MAC source safety', () => {
  const fs = require('fs'); const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'convexCanonicalFreshness.ts'), 'utf-8');
  it('MAC secret is never printed/logged in the module', () => {
    expect(src).not.toMatch(/console\.(log|error|warn)\([^)]*secret/i);
    expect(src).not.toMatch(/console\.(log|error)\([^)]*\.key/);
  });
  it('no auto-generation of the MAC secret (no TOFU)', () => {
    expect(src).not.toContain('randomBytes');
    expect(src).not.toContain('Math.random');
    expect(src).toContain('NO auto-generation');
  });
  it('smoke runner never prints the MAC secret value', () => {
    const smoke = fs.readFileSync(path.join(__dirname, '..', 'evidence', 'check-convex-loopback-readonly.ts'), 'utf-8');
    // forbid printing the secret value (.key or a bare ${macSecret}); allow the boolean ${macSecret !== null}
    expect(smoke).not.toMatch(/macSecret\.key/);
    expect(smoke).not.toMatch(/\$\{\s*macSecret\s*\}/);
    expect(smoke).not.toMatch(/console\.log\([^)]*\.key/);
    expect(smoke).toContain('macConfigured: ${macSecret !== null}');
  });
});

describe('24Y.8: freshness module source safety', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'convexCanonicalFreshness.ts'), 'utf-8');
  it('pure — no Convex, no Date.now, no mutation/network', () => {
    expect(src).not.toContain('Date.now');
    expect(src).not.toMatch(/fetch\s*\(/);
    expect(src).not.toMatch(/\/api\/mutation/);
    expect(src).not.toContain('ctx.db');
  });
  it('no secrets', () => {
    expect(src).not.toMatch(/sk-[a-zA-Z0-9]/);
    expect(src).not.toContain('privateKey');
  });
});
