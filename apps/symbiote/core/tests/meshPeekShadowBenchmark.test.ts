// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// mesh_peek SHADOW BENCHMARK (RESEARCH ONLY — #45/#244). Reproducible, deterministic, synthetic:
// receipt-shaped fixtures (core-receipt-stamped values across two threads/doors) feed the DORMANT
// MeshPeekIndex through the shadow reader, and the shadow is COMPARED against a baseline retriever
// that remains authoritative by construction (the shadow returns metrics, never content).
// Gates carried here:
//   G-DORMANT      nothing in live code imports the shadow (structural pin)
//   G-PROVENANCE   cross-thread recall names the originating door/thread of its rows
//   G-RELEVANCE    labeled queries: shadow rank vs baseline rank, both reported honestly
//   G-CONTAMINATION every shadow source row is ledgered, on every query
//   G-ERASE        erasing a row rebuilds the derived index; the row can never surface again
//   G-SUPERSEDE    a receipt-declared correction outranks its target; lineage reaches the origin
//   G-DISABLE      receipt mismatch/drift latches the reader OFF automatically
//   G-VERSION      the encoder/config digest is recorded and config-sensitive
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  MeshPeekShadowReader,
  governedRowFromReceipt,
  meshPeekEncoderDigest,
  meshPeekShadowGrantsAuthority,
  MESH_PEEK_SHADOW_VERSION,
  type ReceiptRecord,
} from '../src/meshPeekShadow';
import { recencyRelevanceScore } from '../../spatial/recallSource';

const OWNER = 'aumara.root';
const NOW = Date.parse('2026-07-13T12:00:00.000Z');
const THREAD_A = 'sess.20260713t090000000z.aaaa'; // the chat door's session
const THREAD_B = 'sess.20260712t200000000z.bbbb'; // an earlier voice session

/** A synthetic stamped receipt value — the same shape a turn-summary row carries after the core
 *  receipt stamp brick, with an explicit research `subject` so clumping has a bucket key. */
function receiptValue(opts: {
  subject: string;
  text: string;
  at: string;
  origin: 'chat' | 'presence' | 'voice';
  thread: string;
  supersedesKey?: string;
}): string {
  return JSON.stringify({
    schema: 'turn-summary-v1',
    at: opts.at,
    origin: opts.origin,
    subject: opts.subject,
    recentTurn: { text: opts.text, at: opts.at, advisoryOnly: true, grantsAuthority: false },
    core: {
      schema: 'core-receipt-stamp-v1',
      coreInstanceId: 'core.abcabcabcabc',
      namespace: `mem:${OWNER}`,
      provenance: 'distilled-turn',
      scope: 'owner-shared',
      at: opts.at,
      thread: opts.thread,
      ...(opts.supersedesKey ? { supersedesKey: opts.supersedesKey } : {}),
      advisoryOnly: true,
      grantsAuthority: false,
    },
    advisoryOnly: true,
    grantsAuthority: false,
  });
}

/** The deterministic synthetic corpus: 8 receipts, two threads, one correction chain. */
function corpus(): ReceiptRecord[] {
  let seq = 0;
  const rec = (key: string, value: string): ReceiptRecord => ({ key, value, seq: seq++ });
  return [
    rec('turn.20260712t200100000z.0', receiptValue({ subject: 'send-button', text: 'owner: the send button should be crimson · auma: noted, crimson', at: '2026-07-12T20:01:00.000Z', origin: 'voice', thread: THREAD_B })),
    rec('turn.20260712t200500000z.1', receiptValue({ subject: 'standup', text: 'owner: standup moves to 9am tomorrow · auma: 9am noted', at: '2026-07-12T20:05:00.000Z', origin: 'voice', thread: THREAD_B })),
    rec('turn.20260712t201000000z.2', receiptValue({ subject: 'deploy', text: 'owner: deploy v3 to the lab box friday · auma: v3 friday', at: '2026-07-12T20:10:00.000Z', origin: 'voice', thread: THREAD_B })),
    rec('turn.20260713t090100000z.3', receiptValue({ subject: 'lunch', text: 'owner: lunch with mira at 1pm · auma: 1pm lunch noted', at: '2026-07-13T09:01:00.000Z', origin: 'chat', thread: THREAD_A })),
    // the cross-thread CORRECTION: today's chat session supersedes yesterday's voice-session color
    rec('turn.20260713t090500000z.4', receiptValue({ subject: 'send-button', text: 'owner: correction, the send button stays teal for the demo · auma: teal, superseding crimson', at: '2026-07-13T09:05:00.000Z', origin: 'chat', thread: THREAD_A, supersedesKey: 'turn.20260712t200100000z.0' })),
    rec('turn.20260713t091000000z.5', receiptValue({ subject: 'deploy', text: 'owner: deploy v3 needs the license check first · auma: license check before v3', at: '2026-07-13T09:10:00.000Z', origin: 'chat', thread: THREAD_A })),
    rec('turn.20260713t091500000z.6', receiptValue({ subject: 'garden', text: 'owner: the tomatoes need water twice a day in this heat · auma: twice daily watering', at: '2026-07-13T09:15:00.000Z', origin: 'presence', thread: THREAD_A })),
    rec('turn.20260713t092000000z.7', receiptValue({ subject: 'standup', text: 'owner: actually standup is cancelled tomorrow · auma: cancelled, noted', at: '2026-07-13T09:20:00.000Z', origin: 'chat', thread: THREAD_A })),
  ];
}

const rowId = (key: string) => `mem:${OWNER}:${key}`;

/** The AUTHORITATIVE baseline — the live client-side ranking law (informative-term overlap +
 *  recency), run over the same receipts. Produced OUTSIDE the shadow; the shadow cannot touch it. */
function baselineRank(query: string, recs: ReceiptRecord[]): string[] {
  const scored = recs.map((r, order) => {
    const parsed = JSON.parse(r.value) as { recentTurn?: { text?: string }; at?: string };
    const text = parsed.recentTurn?.text ?? r.value;
    return { id: rowId(r.key), order, score: recencyRelevanceScore(query, text, parsed.at ?? null, r.key, NOW) };
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.map((s) => s.id);
}

/** Labeled queries: the fixture's ground truth. */
const QUERIES: Array<{ q: string; expectedKey: string }> = [
  { q: 'what color is the send button', expectedKey: 'turn.20260713t090500000z.4' },
  { q: 'when is standup tomorrow', expectedKey: 'turn.20260713t092000000z.7' },
  { q: 'what does deploy v3 need first', expectedKey: 'turn.20260713t091000000z.5' },
  { q: 'when is lunch with mira', expectedKey: 'turn.20260713t090100000z.3' },
  { q: 'how often to water the tomatoes', expectedKey: 'turn.20260713t091500000z.6' },
];

function freshReader(): MeshPeekShadowReader {
  let tick = 0;
  const reader = new MeshPeekShadowReader(OWNER, { now: () => tick++ });
  for (const r of corpus()) reader.ingest(r);
  return reader;
}

describe('G-DORMANT — the shadow is research harness, not live memory', () => {
  it('no live module imports meshPeekShadow (only tests may)', () => {
    const roots = ['core/src', 'spatial', 'scripts', 'memory', 'authority'];
    const offenders: string[] = [];
    for (const rel of roots) {
      const dir = path.join(__dirname, '..', '..', rel);
      const walk = (d: string) => {
        let ents: string[];
        try { ents = fs.readdirSync(d); } catch { return; }
        for (const e of ents) {
          const p = path.join(d, e);
          let s; try { s = fs.statSync(p); } catch { continue; }
          if (s.isDirectory()) { if (e !== 'node_modules') walk(p); }
          else if (e.endsWith('.ts') && !p.endsWith('meshPeekShadow.ts') && fs.readFileSync(p, 'utf-8').includes('meshPeekShadow')) offenders.push(p);
        }
      };
      walk(dir);
    }
    expect(offenders).toEqual([]);
  });

  it('the shadow grants nothing, mechanically', () => {
    expect(meshPeekShadowGrantsAuthority()).toBe(false);
    expect(freshReader().status().grantsAuthority).toBe(false);
  });
});

describe('G-VERSION — encoder digest recorded and config-sensitive', () => {
  it('is deterministic for the default config and distinct for a different one', () => {
    const a = meshPeekEncoderDigest();
    expect(a).toBe(meshPeekEncoderDigest({}));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(meshPeekEncoderDigest({ dim: 256 })).not.toBe(a);
    const r = freshReader();
    expect(r.encoderDigest).toBe(a);
    expect(r.status().version).toBe(MESH_PEEK_SHADOW_VERSION);
  });
});

describe('G-RELEVANCE + G-PROVENANCE + G-CONTAMINATION — the comparison run', () => {
  it('reports shadow vs baseline rank for every labeled query, contamination-free, provenance named', () => {
    const reader = freshReader();
    expect(reader.verifyReceipts()).toBe(true);
    const recs = corpus();
    const report: Array<{ q: string; shadow: number | null; baseline: number | null }> = [];
    for (const { q, expectedKey } of QUERIES) {
      const baseline = baselineRank(q, recs);
      const m = reader.compare(q, baseline, rowId(expectedKey));
      expect(m).not.toBeNull();
      if (!m) continue;
      expect(m.contaminationFree).toBe(true);
      expect(m.shadowLatencyMs).not.toBeNull(); // injected clock: latency is recorded
      report.push({ q, shadow: m.shadowRankOfExpected, baseline: m.baselineRankOfExpected });
    }
    // The REPRODUCIBLE verdict of this synthetic run (deterministic — same bytes every run):
    // shadow hit@1 must be perfect on this corpus, and the baseline must stay ≤ rank 3 —
    // honest numbers, quoted verbatim in the PR evidence.
    expect(report.every((r) => r.shadow === 1)).toBe(true);
    expect(report.every((r) => r.baseline !== null && r.baseline <= 3)).toBe(true);

    // provenance: the send-button answer came from ANOTHER means of knowing — the top handle
    // names both contributing sides of the correction story (chat thread A supersedes voice B,
    // so the surviving handle's origins identify the CHAT thread; the superseded one is B's).
    const m = reader.compare('what color is the send button', baselineRank('what color is the send button', recs), rowId('turn.20260713t090500000z.4'));
    expect(m).not.toBeNull();
    expect(m!.topHandleOrigins).toEqual([`chat/${THREAD_A}`]);
  });
});

describe('G-SUPERSEDE — a receipt-declared correction wins and keeps lineage', () => {
  it('the teal correction outranks crimson, and lineage reaches the superseded voice-thread row', () => {
    const reader = freshReader();
    const lineage = reader.lineageRowIds('what color is the send button');
    // lineage[0] = the live handle's rows (the correction), later entries = superseded chain
    expect(lineage.length).toBeGreaterThanOrEqual(2);
    expect(lineage[0]).toContain(rowId('turn.20260713t090500000z.4'));
    expect(lineage.flat()).toContain(rowId('turn.20260712t200100000z.0')); // history reachable, never deleted
    // and the SUPERSEDED row no longer surfaces as a top answer:
    const m = reader.compare('what color is the send button', [], rowId('turn.20260712t200100000z.0'));
    expect(m!.shadowRankOfExpected).toBeNull();
  });
});

describe('G-ERASE — erasure invalidates the derived index', () => {
  it('an erased row can never surface again; the ledger counts it; receipts still verify', () => {
    const reader = freshReader();
    const before = reader.compare('when is lunch with mira', [], rowId('turn.20260713t090100000z.3'));
    expect(before!.shadowRankOfExpected).toBe(1);
    reader.eraseRow('turn.20260713t090100000z.3');
    expect(reader.disabled).toBe(false); // a lawful erase disables nothing
    expect(reader.verifyReceipts()).toBe(true);
    const after = reader.compare('when is lunch with mira', [], rowId('turn.20260713t090100000z.3'));
    expect(after!.shadowRankOfExpected).toBeNull();
    const status = reader.status();
    expect(status.erasedRows).toBe(1);
    expect(status.liveRows).toBe(corpus().length - 1);
    // erasing a supersede TARGET keeps the corrected fact alive and the erased one gone:
    reader.eraseRow('turn.20260712t200100000z.0');
    const teal = reader.compare('what color is the send button', [], rowId('turn.20260713t090500000z.4'));
    expect(teal!.shadowRankOfExpected).toBe(1);
    const crimson = reader.compare('what color is the send button', [], rowId('turn.20260712t200100000z.0'));
    expect(crimson!.shadowRankOfExpected).toBeNull();
  });
});

describe('G-DISABLE — drift/receipt mismatch latches the shadow OFF', () => {
  it('an unledgered row reaching the index disables the reader; a disabled reader answers nothing', () => {
    const reader = freshReader();
    reader._driftForTests(governedRowFromReceipt({ key: 'turn.99999999999999999.9', value: 'a row the governed ledger never issued', seq: 999 }, OWNER));
    expect(reader.verifyReceipts()).toBe(false);
    expect(reader.disabled).toBe(true);
    expect(reader.status().disabledReason).toContain('receipt mismatch');
    expect(reader.compare('anything', [], rowId('turn.x'))).toBeNull();
    expect(reader.lineageRowIds('anything')).toEqual([]);
  });

  it('a duplicate receipt id disables ingest (no silent overwrite of governed identity)', () => {
    const reader = freshReader();
    reader.ingest({ key: 'turn.20260713t090100000z.3', value: 'dup', seq: 100 });
    expect(reader.disabled).toBe(true);
    expect(reader.status().disabledReason).toContain('duplicate receipt');
  });
});
