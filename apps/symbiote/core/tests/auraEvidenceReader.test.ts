// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// AURA evidence reader pins (round 3): explicit deterministic ordering (never iteration order),
// duplicates REFUSE (never silently deduped), unverified store refuses, missing/invalid heads
// refuse with CATEGORY strings that never leak a key or hash, a moving snapshot refuses (verify +
// heads read twice), bounds hold, the excluded classes are named as data — and the erasure law is
// pinned end to end: an epoch built from a snapshot fails live verification after a chain's head
// changes, while the reader itself refuses to read across the change.
import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { readLiveEvidence, EXCLUDED_EVIDENCE_CLASSES, evidenceReaderGrantsAuthority, type KnownKey, type HeadView, type EvidenceReaderDeps } from '../src/auraEvidenceReader';
import { buildAuraTraceEpoch, verifyAuraTraceEpoch, MAX_TRACE_COMMITMENTS } from '../src/auraTrace';

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const OWNER = 'aumara.root';

const KNOWN: KnownKey[] = [
  { source: 'canon-ledger', key: 'canon.safety-laws.76905af79b5f' },
  { source: 'capture-status', key: 'turn.20260708t011134662z.0' },
  { source: 'focus-pointer', key: 'focus.20260708t040707185z.0' },
];

function fakeStore(overrides: Partial<{ heads: Map<string, HeadView>; verify: () => Promise<{ ok: boolean; flagged: number; checked: number }>; readHead: (k: string) => Promise<HeadView | null> }> = {}) {
  const heads = overrides.heads ?? new Map<string, HeadView>(
    KNOWN.map((k) => [`mem:${OWNER}:${k.key}`, { exists: true, count: 1, lastChainHash: sha(`head:${k.key}`) }]),
  );
  const deps: EvidenceReaderDeps = {
    ownerRootId: OWNER,
    verifyStore: overrides.verify ?? (async () => ({ ok: true, flagged: 0, checked: heads.size })),
    readHead: overrides.readHead ?? (async (chainKey) => heads.get(chainKey) ?? { exists: false, count: 0, lastChainHash: null }),
  };
  return { heads, deps };
}

describe('deterministic assembly', () => {
  it('orders lexicographically by chainKey regardless of input order, with class counts + the named gap', async () => {
    const { deps } = fakeStore();
    const a = await readLiveEvidence(KNOWN, deps);
    const b = await readLiveEvidence([KNOWN[2], KNOWN[0], KNOWN[1]], deps);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.evidence).toEqual(b.evidence); // input order never matters — the RULE orders
      expect(a.evidence.map((e) => e.chainKey)).toEqual([...a.evidence.map((e) => e.chainKey)].sort());
      expect(a.classCounts).toEqual({ 'canon-ledger': 1, 'focus-pointer': 1, 'capture-status': 1, 'capture-index': 0 }); // round 4: the index class exists, honestly zero when absent
      expect(a.excluded).toBe(EXCLUDED_EVIDENCE_CLASSES); // the honest gap travels as data
    }
  });

  it('the same snapshot yields the same epoch commitment through buildAuraTraceEpoch', async () => {
    const { deps } = fakeStore();
    const r1 = await readLiveEvidence(KNOWN, deps);
    const r2 = await readLiveEvidence([...KNOWN].reverse(), deps);
    if (!r1.ok || !r2.ok) throw new Error('expected ok');
    const e1 = buildAuraTraceEpoch({ epochOf: OWNER, at: '2026-07-10T20:00:00.000Z', evidence: r1.evidence });
    const e2 = buildAuraTraceEpoch({ epochOf: OWNER, at: '2026-07-10T20:00:00.000Z', evidence: r2.evidence });
    expect(e1.epochCommitment).toBe(e2.epochCommitment);
  });
});

describe('refusals — loud, categorical, never leaking', () => {
  it('duplicates refuse (never silently deduped); junk shapes and unknown classes refuse', async () => {
    const { deps } = fakeStore();
    expect(await readLiveEvidence([KNOWN[0], { source: 'focus-pointer', key: KNOWN[0].key }], deps)).toMatchObject({ ok: false, refusal: 'duplicate_chain_key' });
    expect(await readLiveEvidence([{ source: 'canon-ledger', key: '../etc/passwd' }], deps)).toMatchObject({ ok: false, refusal: 'invalid_key_shape:canon-ledger' });
    expect(await readLiveEvidence([{ source: 'vouch-graph' as never, key: 'k' }], deps)).toMatchObject({ ok: false, refusal: 'unknown_evidence_class' });
    expect(await readLiveEvidence([], deps)).toMatchObject({ ok: false, refusal: 'no_local_key_knowledge' });
  });

  it('an unverified or flagged store refuses before any head is trusted', async () => {
    const { deps } = fakeStore({ verify: async () => ({ ok: true, flagged: 2, checked: 9 }) });
    expect(await readLiveEvidence(KNOWN, deps)).toMatchObject({ ok: false, refusal: 'store_unverified' });
  });

  it('missing chains and invalid heads refuse with the SOURCE CLASS — never the key or hash', async () => {
    const { heads, deps } = fakeStore();
    heads.delete(`mem:${OWNER}:${KNOWN[1].key}`);
    const r = await readLiveEvidence(KNOWN, deps);
    expect(r).toMatchObject({ ok: false, refusal: 'chain_missing:capture-status' });
    const bad = fakeStore();
    bad.heads.set(`mem:${OWNER}:${KNOWN[0].key}`, { exists: true, count: 1, lastChainHash: 'not-hex' });
    expect(await readLiveEvidence(KNOWN, bad.deps)).toMatchObject({ ok: false, refusal: 'head_invalid:canon-ledger' });
    // the leak pin: no refusal string may carry a row key, chain key, or head hash
    for (const res of [r]) {
      if (!res.ok) {
        expect(res.refusal).not.toMatch(/mem:|canon\.|turn\.|focus\.|[0-9a-f]{64}/);
      }
    }
  });

  it('overflow refuses at the trace bound', async () => {
    const many: KnownKey[] = Array.from({ length: MAX_TRACE_COMMITMENTS + 1 }, (_, i) => ({ source: 'canon-ledger', key: `canon.x.${String(i).padStart(12, '0')}` }));
    const { deps } = fakeStore();
    expect(await readLiveEvidence(many, deps)).toMatchObject({ ok: false, refusal: 'evidence_overflow' });
  });
});

describe('the snapshot must hold — twice-checked, never stitched', () => {
  it('a head that changes between pass A and pass B refuses (erasure/new-write mid-read)', async () => {
    const { heads, deps } = fakeStore();
    const target = `mem:${OWNER}:${KNOWN[1].key}`;
    let reads = 0;
    const flipping: EvidenceReaderDeps = {
      ...deps,
      readHead: async (chainKey) => {
        if (chainKey === target) {
          reads += 1;
          if (reads > 1) return { exists: true, count: 2, lastChainHash: sha('head-after-erasure') }; // the chain grew
        }
        return heads.get(chainKey) ?? { exists: false, count: 0, lastChainHash: null };
      },
    };
    expect(await readLiveEvidence(KNOWN, flipping)).toMatchObject({ ok: false, refusal: 'snapshot_moved' });
  });

  it('a store whose verified row count drifts between passes refuses', async () => {
    let calls = 0;
    const { deps } = fakeStore({ verify: async () => ({ ok: true, flagged: 0, checked: calls++ === 0 ? 9 : 10 }) });
    expect(await readLiveEvidence(KNOWN, deps)).toMatchObject({ ok: false, refusal: 'snapshot_moved' });
  });

  it('END TO END erasure law: an epoch from snapshot N fails live verification at snapshot N+1', async () => {
    const { deps } = fakeStore();
    const before = await readLiveEvidence(KNOWN, deps);
    if (!before.ok) throw new Error('expected ok');
    const epoch = buildAuraTraceEpoch({ epochOf: OWNER, at: '2026-07-10T20:00:00.000Z', evidence: before.evidence });
    expect(verifyAuraTraceEpoch(epoch, { evidence: before.evidence })).toMatchObject({ valid: true });
    // an erasure receipt lands on one chain: its head changes
    const after = before.evidence.map((e, i) => (i === 1 ? { ...e, chainHeadHash: sha('head-after-erasure-receipt') } : e));
    expect(verifyAuraTraceEpoch(epoch, { evidence: after })).toMatchObject({ valid: false, reason: 'trace_evidence_mismatch_at:1' });
  });

  it('the reader grants nothing', () => {
    expect(evidenceReaderGrantsAuthority()).toBe(false);
  });
});
