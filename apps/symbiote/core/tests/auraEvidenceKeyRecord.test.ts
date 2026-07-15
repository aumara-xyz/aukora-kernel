// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// aura-evidence-key-record-v1 pins (AURA lane round 4): the capture-key index CONTRACT, not a
// writer. Closed field set (any smuggling surface refuses), key grammar + canonical timestamps,
// one-bad-record-refuses-the-list, duplicates refuse (within the list AND across reader
// sources), bounded NEWEST-FIRST selection BEFORE the reader's final lexicographic order,
// privacy/no-content guarantees, and absent-list compatibility (the round-3 behavior is
// byte-identical when no index is supplied).
import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import {
  validateAuraEvidenceKeyRecord,
  normalizeAuraEvidenceKeyRecords,
  AURA_EVIDENCE_KEY_RECORD_SCHEMA,
  MAX_CAPTURE_INDEX_KEYS,
  keyRecordGrantsAuthority,
} from '../src/auraEvidenceKeyRecord';
import { readLiveEvidence, type KnownKey, type EvidenceReaderDeps, type HeadView, EXCLUDED_EVIDENCE_CLASSES, EXCLUDED_WITH_CAPTURE_INDEX } from '../src/auraEvidenceReader';

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const OWNER = 'aumara.root';
const rec = (key: string, at: string) => ({ schema: AURA_EVIDENCE_KEY_RECORD_SCHEMA, key, at, sourceClass: 'captured-turn' as const });

describe('the record contract — closed, bounded, content-free', () => {
  it('accepts a well-formed record and canonicalizes its timestamp', () => {
    const v = validateAuraEvidenceKeyRecord(rec('turn.20260708t011134662z.0', '2026-07-08 01:11:34.662Z'));
    expect(v.valid).toBe(true);
    if (v.valid) expect(v.record.at).toBe('2026-07-08T01:11:34.662Z'); // canonical ISO, always
  });

  it('any extra field — every smuggling surface — refuses', () => {
    for (const extra of [{ text: 'the turn text' }, { preview: 'x' }, { prompt: 'x' }, { modelOutput: 'x' }, { identity: 'x' }, { signature: 'x' }, { hash: sha('x') }, { token: 'x' }, { aura: 5 }]) {
      const v = validateAuraEvidenceKeyRecord({ ...rec('turn.a.0', '2026-07-08T00:00:00.000Z'), ...extra });
      expect(v).toMatchObject({ valid: false, reason: 'record_unknown_field' });
    }
  });

  it('bad key grammar, bad timestamps, wrong schema/class all refuse — categorically', () => {
    expect(validateAuraEvidenceKeyRecord(rec('../etc/passwd', '2026-07-08T00:00:00Z'))).toMatchObject({ valid: false, reason: 'record_key_invalid' });
    expect(validateAuraEvidenceKeyRecord(rec('turn.a.0', 'not a time'))).toMatchObject({ valid: false, reason: 'record_at_invalid' });
    expect(validateAuraEvidenceKeyRecord({ ...rec('turn.a.0', '2026-07-08T00:00:00Z'), schema: 'v2' })).toMatchObject({ valid: false, reason: 'record_wrong_schema' });
    expect(validateAuraEvidenceKeyRecord({ ...rec('turn.a.0', '2026-07-08T00:00:00Z'), sourceClass: 'vouch' })).toMatchObject({ valid: false, reason: 'record_wrong_source_class' });
    expect(validateAuraEvidenceKeyRecord('a string')).toMatchObject({ valid: false, reason: 'record_not_an_object' });
  });

  it('one bad record refuses the WHOLE list; duplicate keys refuse; empty list is honestly empty', () => {
    const good = rec('turn.a.0', '2026-07-08T00:00:00Z');
    expect(normalizeAuraEvidenceKeyRecords([good, { junk: true }])).toMatchObject({ ok: false, refusal: 'record_unknown_field' });
    expect(normalizeAuraEvidenceKeyRecords([good, rec('turn.a.0', '2026-07-09T00:00:00Z')])).toMatchObject({ ok: false, refusal: 'index_duplicate_key' });
    expect(normalizeAuraEvidenceKeyRecords('not-a-list')).toMatchObject({ ok: false, refusal: 'index_not_a_list' });
    expect(normalizeAuraEvidenceKeyRecords([])).toEqual({ ok: true, records: [] });
  });

  it('selection is bounded NEWEST-FIRST with a deterministic tiebreak', () => {
    const list = [
      rec('turn.c.0', '2026-07-08T03:00:00Z'),
      rec('turn.a.0', '2026-07-08T01:00:00Z'),
      rec('turn.d.0', '2026-07-08T03:00:00Z'), // same instant as c — tiebreak by key desc
      rec('turn.b.0', '2026-07-08T02:00:00Z'),
    ];
    const n = normalizeAuraEvidenceKeyRecords(list, { max: 3 });
    expect(n.ok).toBe(true);
    if (n.ok) expect(n.records.map((r) => r.key)).toEqual(['turn.d.0', 'turn.c.0', 'turn.b.0']); // newest 3, oldest dropped
    const cap = normalizeAuraEvidenceKeyRecords(
      Array.from({ length: MAX_CAPTURE_INDEX_KEYS + 10 }, (_, i) => rec(`turn.k${String(i).padStart(4, '0')}.0`, `2026-07-08T00:${String(i % 60).padStart(2, '0')}:00Z`)),
    );
    expect(cap.ok && cap.records.length).toBe(MAX_CAPTURE_INDEX_KEYS);
  });

  it('normalized records carry NOTHING but the four contract fields', () => {
    const n = normalizeAuraEvidenceKeyRecords([rec('turn.a.0', '2026-07-08T00:00:00Z')]);
    if (!n.ok) throw new Error('expected ok');
    expect(Object.keys(n.records[0]).sort()).toEqual(['at', 'key', 'schema', 'sourceClass']);
    expect(keyRecordGrantsAuthority()).toBe(false);
  });
});

// ── the reader seam ────────────────────────────────────────────────────────────────────────────
const KNOWN: KnownKey[] = [
  { source: 'canon-ledger', key: 'canon.safety-laws.76905af79b5f' },
  { source: 'focus-pointer', key: 'focus.20260708t040707185z.0' },
];
function fakeStore(extraKeys: string[] = []) {
  const all = [...KNOWN.map((k) => k.key), ...extraKeys];
  const heads = new Map<string, HeadView>(all.map((k) => [`mem:${OWNER}:${k}`, { exists: true, count: 1, lastChainHash: sha(`head:${k}`) }]));
  const deps: EvidenceReaderDeps = {
    ownerRootId: OWNER,
    verifyStore: async () => ({ ok: true, flagged: 0, checked: heads.size }),
    readHead: async (chainKey) => heads.get(chainKey) ?? { exists: false, count: 0, lastChainHash: null },
  };
  return deps;
}

describe('the reader seam — index joins the classes, laws unchanged', () => {
  const INDEX = [rec('turn.20260708t011134662z.0', '2026-07-08T01:11:34.662Z'), rec('turn.20260708t015720732z.0', '2026-07-08T01:57:20.732Z')];

  it('consumes a validated index: class counted, gap entry drops, FINAL order stays lexicographic', async () => {
    const deps = fakeStore(INDEX.map((r) => r.key));
    const r = await readLiveEvidence(KNOWN, deps, { captureIndex: INDEX });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.classCounts['capture-index']).toBe(2);
      expect(r.evidence.map((e) => e.chainKey)).toEqual([...r.evidence.map((e) => e.chainKey)].sort()); // lexicographic, not newest-first
      expect(r.excluded).toBe(EXCLUDED_WITH_CAPTURE_INDEX);
      expect(r.excluded.some((x) => x.startsWith('captured-turns-before-last'))).toBe(false);
    }
  });

  it('ABSENT index: byte-identical round-3 behavior, gap still named', async () => {
    const deps = fakeStore();
    const withOpts = await readLiveEvidence(KNOWN, deps, {});
    const without = await readLiveEvidence(KNOWN, deps);
    expect(withOpts).toEqual(without);
    if (without.ok) expect(without.excluded).toBe(EXCLUDED_EVIDENCE_CLASSES);
  });

  it('a malformed index refuses the WHOLE read; duplicates ACROSS sources refuse loudly', async () => {
    const deps = fakeStore(INDEX.map((r) => r.key));
    expect(await readLiveEvidence(KNOWN, deps, { captureIndex: [{ bad: true }] })).toMatchObject({ ok: false, refusal: 'record_unknown_field' });
    // the same key arriving from capture-status AND the index = the standing duplicate refusal
    const withStatus: KnownKey[] = [...KNOWN, { source: 'capture-status', key: INDEX[0].key }];
    expect(await readLiveEvidence(withStatus, deps, { captureIndex: INDEX })).toMatchObject({ ok: false, refusal: 'duplicate_chain_key' });
  });

  it('privacy holds through the seam: results and refusals never carry record contents', async () => {
    const deps = fakeStore(INDEX.map((r) => r.key));
    const r = await readLiveEvidence(KNOWN, deps, { captureIndex: INDEX });
    if (r.ok) {
      const flat = JSON.stringify({ classCounts: r.classCounts, excluded: r.excluded, storeChecked: r.storeChecked });
      expect(flat).not.toMatch(/turn\.|canon\.|focus\.|mem:|[0-9a-f]{64}/); // evidence list aside, the report surface is content-free
    }
  });
});
