// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// AUMLOK history projection (read-only, content-free): the four terminal categories bucketed from
// already-trusted artifacts — awaiting (validated pending proposals) + the proposal-disposition journal
// (applied/rejected/archived). This surface grants nothing and exposes no phrase/key/ownerNote/diff.
// Pins: every category, invalid/missing artifacts, per-category bounds, and the no-authority boundary.
import { describe, it, expect } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import {
  projectAumlokHistory, readAumlokHistory, AUMLOK_HISTORY_SCHEMA, HISTORY_CATEGORY_MAX,
  type HistoryInputs,
} from '../src/aumlokHistory';
import type { ProposalDispositionArtifactV1, ProposalDisposition } from '../src/proposalDisposition';

const H = (c: string) => c.repeat(64);
const disp = (proposalHash: string, disposition: ProposalDisposition, extra: Partial<ProposalDispositionArtifactV1> = {}): ProposalDispositionArtifactV1 => ({
  schema: 'proposal-disposition-v1', proposalHash, disposition, decidedAt: '2026-07-10T12:00:00.000Z',
  advisoryOnly: true, grantsAuthority: false, artifactHash: H('e'), ...extra,
});
const inputs = (over: Partial<HistoryInputs> = {}): HistoryInputs => ({
  pending: [], dispositions: { rows: [], refusedReason: null }, nowIso: '2026-07-10T12:00:00.000Z', ...over,
});

describe('projectAumlokHistory — the four terminal categories', () => {
  it('buckets awaiting/applied/rejected/archived from the trusted inputs, with counts', () => {
    const h = projectAumlokHistory(inputs({
      pending: [{ proposalHash: H('a'), goal: 'restart the chat door', files: [1, 2], valid: true, createdAt: '2026-07-10T11:00:00.000Z' }],
      dispositions: { refusedReason: null, rows: [
        disp(H('b'), 'signed_applied', { commitSha: 'abc1234', receiptHash: H('d') }),
        disp(H('c'), 'rejected'),
        disp(H('f'), 'shelved'),
        disp(H('1'), 'superseded'),
      ] },
    }));
    expect(h.schema).toBe(AUMLOK_HISTORY_SCHEMA);
    expect(h.awaiting.map((r) => r.proposalHash)).toEqual([H('a')]);
    expect(h.applied.map((r) => r.proposalHash)).toEqual([H('b')]);
    expect(h.rejected.map((r) => r.proposalHash)).toEqual([H('c')]);
    expect(h.archived.map((r) => r.proposalHash).sort()).toEqual([H('1'), H('f')].sort());
    expect(h.counts).toEqual({ awaiting: 1, applied: 1, rejected: 1, archived: 2 });
    expect(h.awaiting[0]).toMatchObject({ goal: 'restart the chat door', fileCount: 2, valid: true, shortHash: H('a').slice(0, 12) });
    expect(h.applied[0]).toMatchObject({ commitSha: 'abc1234', receiptHash: H('d') });
    expect(h.archived.find((r) => r.proposalHash === H('1'))!.subKind).toBe('superseded');
  });

  it('NO-AUTHORITY boundary: everything is advisoryOnly/grantsAuthority:false and no signing/key/ownerNote field appears', () => {
    const h = projectAumlokHistory(inputs({
      pending: [{ proposalHash: H('a'), goal: 'g', files: [1], valid: true, createdAt: 'x' }],
      dispositions: { refusedReason: null, rows: [disp(H('b'), 'signed_applied', { ownerNote: 'PRIVATE owner reason', commitSha: 'abc1234' })] },
    }));
    expect(h).toMatchObject({ advisoryOnly: true, grantsAuthority: false });
    const blob = JSON.stringify(h);
    expect(blob).not.toContain('PRIVATE');       // ownerNote never travels
    expect(blob).not.toContain('signCommand');
    expect(blob).not.toContain('applyHint');
    expect(blob).not.toContain('artifactPath');
    expect(blob).not.toContain('privateKey');
    for (const cat of ['awaiting', 'applied', 'rejected', 'archived'] as const) {
      for (const r of h[cat]) { expect(r.advisoryOnly).toBe(true); expect(r.grantsAuthority).toBe(false); }
    }
  });

  it('INVALID artifacts: a non-64-hex hash is dropped; a tampered pending artifact shows valid:false, never hidden', () => {
    const h = projectAumlokHistory(inputs({
      pending: [
        { proposalHash: 'not-hex', goal: 'g', files: [], valid: true, createdAt: 'x' }, // dropped
        { proposalHash: H('a'), goal: 'tampered one', files: [], valid: false, createdAt: 'x' }, // shown, flagged
      ],
      dispositions: { refusedReason: null, rows: [
        disp('short', 'signed_applied'),        // dropped (bad hash)
        disp(H('b'), 'signed_applied'),          // kept
      ] },
    }));
    expect(h.awaiting.map((r) => r.proposalHash)).toEqual([H('a')]);
    expect(h.awaiting[0].valid).toBe(false);
    expect(h.applied.map((r) => r.proposalHash)).toEqual([H('b')]);
  });

  it('MISSING/unreadable journal: honest empty terminal set with a note; awaiting still shown', () => {
    const h = projectAumlokHistory(inputs({
      pending: [{ proposalHash: H('a'), goal: 'g', files: [], valid: true, createdAt: 'x' }],
      dispositions: { refusedReason: 'disposition journal exceeds cap', rows: [] },
    }));
    expect(h.applied).toHaveLength(0);
    expect(h.rejected).toHaveLength(0);
    expect(h.archived).toHaveLength(0);
    expect(h.awaiting).toHaveLength(1);
    expect(h.notes.join(' ')).toContain('disposition journal exceeds cap');
  });

  it('BOUNDS: each category capped at HISTORY_CATEGORY_MAX; goals length-capped; dedup within a category', () => {
    const manyApplied = Array.from({ length: HISTORY_CATEGORY_MAX + 20 }, (_, i) => disp(H('b').slice(0, 63) + (i % 10), 'signed_applied'));
    const dupHash = H('9');
    const h = projectAumlokHistory(inputs({
      pending: [{ proposalHash: H('a'), goal: 'x'.repeat(1000), files: [], valid: true, createdAt: 'x' }],
      dispositions: { refusedReason: null, rows: [disp(dupHash, 'rejected'), disp(dupHash, 'rejected'), ...manyApplied] },
    }));
    expect(h.applied.length).toBeLessThanOrEqual(HISTORY_CATEGORY_MAX);
    expect(h.awaiting[0].goal!.length).toBeLessThanOrEqual(200);
    expect(h.rejected.filter((r) => r.proposalHash === dupHash)).toHaveLength(1); // deduped
  });

  it('empty everywhere → all four categories empty, zero counts, no notes, still no-authority', () => {
    const h = projectAumlokHistory(inputs());
    expect(h.counts).toEqual({ awaiting: 0, applied: 0, rejected: 0, archived: 0 });
    expect(h.notes).toEqual([]);
    expect(h.advisoryOnly).toBe(true);
  });
});

describe('readAumlokHistory — live composition over a tmp home is fail-soft', () => {
  it('a fresh/empty home yields an empty, valid history (no throw)', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aumlok-history-'));
    const h = readAumlokHistory(home);
    expect(h.schema).toBe(AUMLOK_HISTORY_SCHEMA);
    expect(h.counts).toEqual({ awaiting: 0, applied: 0, rejected: 0, archived: 0 });
    expect(h.advisoryOnly).toBe(true);
    expect(h.grantsAuthority).toBe(false);
  });
});

describe('structural pins — the endpoint and shell surface stay read-only', () => {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf-8');

  it('serve.ts wires GET /api/aumlok/history to the pure reader on the READ-ONLY observer', () => {
    const serve = read('spatial/serve.ts');
    expect(serve).toContain("p === '/api/aumlok/history'");
    expect(serve).toContain('readAumlokHistory(SYMBIOTE_HOME)');
  });

  it('the shell history panel reads the endpoint and never signs/applies from it', () => {
    const app = read('spatial/app/aumlok.js');
    expect(app).toContain("fetch('/api/aumlok/history'");
    expect(app).toContain('data-operate-forbid'); // the record rail is fenced from operate_ui
    // isolate ONLY the mountHistoryPanel body (up to the next top-level function) so unrelated panels
    // (e.g. the phrase panel) never mask a regression here
    const start = app.indexOf('async function mountHistoryPanel');
    const end = app.indexOf('\nfunction ', start);
    const panel = app.slice(start, end > 0 ? end : undefined);
    expect(panel).not.toContain('signCommand');
    expect(panel).not.toContain('/api/approve');
    expect(panel).not.toContain('phrase');
  });
});
