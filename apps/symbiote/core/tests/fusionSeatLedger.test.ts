import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildSeatLedgerRows, validateSeatLedgerRow, appendSeatLedgerRows, readSeatLedgerRows,
  summarizeSeatLedger, seatLedgerDir, SEAT_LEDGER_FILE, QUORUM_RATE_FLOOR,
  type SeatLedgerRowV1,
} from '../src/fusionSeatLedger';
import type { SelfEditReviewSummary } from '../src/selfEditReviewCouncil';
import type { AdvisoryResult } from '../src/fusionConfig';

const NOW = '2026-07-08T06:00:00.000Z';
const KEY = 'ab'.repeat(32);

function result(model: string, verdict: 'GREEN' | 'YELLOW' | 'RED', over: Partial<AdvisoryResult> = {}): AdvisoryResult {
  return {
    model, label: 'proposal', durationMs: 1200, adapterFailure: false, provider_contacted: true,
    verdict, findings: '', risks: '', missing_tests: '', recommended_next_commit: '',
    ...over,
  } as AdvisoryResult;
}

function review(over: Partial<SelfEditReviewSummary> = {}): SelfEditReviewSummary {
  return {
    schema: 'self-edit-review-v2', goal: 'ledger fixture',
    councilModels: ['QWN', 'DSK', 'GLM'],
    results: [
      result('QWN', 'GREEN'),
      result('DSK', 'YELLOW'),
      result('GLM', 'RED', { adapterFailure: true, provider_contacted: false }),
    ],
    quorum: {
      status: 'GREEN_QUORUM', completedCount: 2, failureCount: 1, totalCount: 3,
      adapterFailuresArePoisoning: false, reason: 'canned',
      completedVotes: 2, nonVotes: 1, redVotes: 0, greenVotes: 1, yellowVotes: 1,
    } as SelfEditReviewSummary['quorum'],
    overallVerdict: 'GREEN', recommendations: [], gateAction: 'proceed', insight: '',
    contradictions: [], strongestContradiction: null, phaseLocked: false, incidents: [],
    patchesApplied: 0, skippedReason: null, fusionRunArtifact: null, fusionRunValid: false,
    fusionSelfReview: null, fusionSelfReviewValid: false,
    kiraRecall: null, advisoryOnly: true, grantsAuthority: false, createdAt: NOW,
    ...over,
  } as SelfEditReviewSummary;
}

function row(over: Partial<SeatLedgerRowV1> = {}): SeatLedgerRowV1 {
  return {
    schema: 'fusion-seat-ledger-row-v1', createdAt: NOW, runKind: 'proposal-review',
    key: KEY, seat: 'QWN', vote: 'GREEN', providerContacted: true, durationMs: 1000,
    overallVerdict: 'GREEN', quorumStatus: 'GREEN_QUORUM', phaseLocked: false,
    advisoryOnly: true, grantsAuthority: false,
    ...over,
  };
}

let home = '';
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'aukora-seat-ledger-')); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

describe('fusionSeatLedger — building rows', () => {
  it('one row per seat; adapter failure records NON_VOTE, never a fabricated stance', () => {
    const rows = buildSeatLedgerRows({ review: review(), runKind: 'proposal-review', key: KEY, createdAt: NOW });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => [r.seat, r.vote])).toEqual([['QWN', 'GREEN'], ['DSK', 'YELLOW'], ['GLM', 'NON_VOTE']]);
    for (const r of rows) {
      expect(validateSeatLedgerRow(r)).toEqual({ valid: true });
      expect(r.advisoryOnly).toBe(true);
      expect(r.grantsAuthority).toBe(false);
      expect(r.key).toBe(KEY);
      expect(r.overallVerdict).toBe('GREEN');
    }
    expect(rows[2].providerContacted).toBe(false);
  });

  it('a skipped review (no results) yields zero rows — nothing to record, nothing invented', () => {
    expect(buildSeatLedgerRows({ review: review({ results: [], skippedReason: 'secret-shaped' }), runKind: 'proposal-review', key: KEY })).toHaveLength(0);
  });

  it('caps unbounded fields', () => {
    const rows = buildSeatLedgerRows({
      review: review({ results: [result('m'.repeat(500), 'GREEN')] }),
      runKind: 'proposal-review', key: 'k'.repeat(500),
    });
    expect(rows[0].seat.length).toBe(80);
    expect(rows[0].key.length).toBe(80);
    expect(validateSeatLedgerRow(rows[0])).toEqual({ valid: true });
  });
});

describe('fusionSeatLedger — validation is fail-closed', () => {
  it('refuses every malformed shape', () => {
    const cases: Array<[string, unknown]> = [
      ['not an object', 42],
      ['wrong schema', row({ schema: 'fusion-seat-ledger-row-v2' as never })],
      ['unknown runKind', row({ runKind: 'vibes' as never })],
      ['unknown vote', row({ vote: 'MAYBE' as never })],
      ['unknown overall', row({ overallVerdict: 'PURPLE' as never })],
      ['authority pin flipped', row({ grantsAuthority: true as never })],
      ['advisory pin flipped', row({ advisoryOnly: false as never })],
      ['empty seat', row({ seat: '' })],
      ['NaN duration', row({ durationMs: Number.NaN })],
    ];
    for (const [label, bad] of cases) expect(validateSeatLedgerRow(bad).valid, label).toBe(false);
  });
});

describe('fusionSeatLedger — append + read (untrusted disk)', () => {
  it('append→read round-trips as JSONL under <home>/fusion/seat-ledger', () => {
    const rows = buildSeatLedgerRows({ review: review(), runKind: 'proposal-review', key: KEY, createdAt: NOW });
    const w = appendSeatLedgerRows(rows, home);
    expect(w.ok).toBe(true);
    if (w.ok) {
      expect(w.appended).toBe(3);
      expect(w.path).toBe(path.join(seatLedgerDir(home), SEAT_LEDGER_FILE));
    }
    const r = readSeatLedgerRows(home);
    expect(r.rows).toEqual(rows);
    expect(r.skippedInvalid).toBe(0);
  });

  it('appends accumulate (append-only), never overwrite', () => {
    appendSeatLedgerRows([row()], home);
    appendSeatLedgerRows([row({ seat: 'DSK' })], home);
    expect(readSeatLedgerRows(home).rows.map((r) => r.seat)).toEqual(['QWN', 'DSK']);
  });

  it('zero rows is a valid no-op that creates nothing', () => {
    const w = appendSeatLedgerRows([], home);
    expect(w.ok).toBe(true);
    expect(fs.existsSync(path.join(seatLedgerDir(home), SEAT_LEDGER_FILE))).toBe(false);
  });

  it('ONE invalid row refuses the whole batch — no partial batch can skew tallies', () => {
    const w = appendSeatLedgerRows([row(), row({ vote: 'MAYBE' as never })], home);
    expect(w.ok).toBe(false);
    if (!w.ok) expect(w.reason).toMatch(/fail-closed.*row 1/);
    expect(fs.existsSync(path.join(seatLedgerDir(home), SEAT_LEDGER_FILE))).toBe(false);
  });

  it('read skips tampered/foreign lines and counts them; missing file reads honestly empty', () => {
    expect(readSeatLedgerRows(home)).toEqual({ rows: [], skippedInvalid: 0 });
    appendSeatLedgerRows([row()], home);
    fs.appendFileSync(path.join(seatLedgerDir(home), SEAT_LEDGER_FILE), 'not json at all\n{"schema":"fusion-seat-ledger-row-v1","grantsAuthority":true}\n');
    const r = readSeatLedgerRows(home);
    expect(r.rows).toHaveLength(1);
    expect(r.skippedInvalid).toBe(2);
  });

  it('read is tail-bounded', () => {
    appendSeatLedgerRows(Array.from({ length: 20 }, (_, i) => row({ durationMs: i })), home);
    const r = readSeatLedgerRows(home, 5);
    expect(r.rows).toHaveLength(5);
    expect(r.rows[0].durationMs).toBe(15); // the TAIL, not the head
  });
});

describe('fusionSeatLedger — summarize (three columns, groupthink-excluded)', () => {
  it('scores agreement-with-quorum, excludes phase-locked rounds, never scores NON_VOTE or NO_QUORUM', () => {
    const rows: SeatLedgerRowV1[] = [
      row({ vote: 'GREEN', overallVerdict: 'GREEN' }), // agree
      row({ vote: 'YELLOW', overallVerdict: 'GREEN' }), // disagree
      row({ vote: 'GREEN', overallVerdict: 'GREEN', phaseLocked: true }), // excluded — alarm round
      row({ vote: 'NON_VOTE' }), // never scored
      row({ vote: 'GREEN', overallVerdict: 'NO_QUORUM' }), // no ground truth — not scored
    ];
    const [s] = summarizeSeatLedger(rows);
    expect(s.seat).toBe('QWN');
    expect(s.rows).toBe(5);
    expect(s.votes).toBe(4);
    expect(s.nonVotes).toBe(1);
    expect(s.quorum.scored).toBe(2);
    expect(s.quorum.agreed).toBe(1);
    expect(s.quorum.excludedPhaseLocked).toBe(1);
    expect(s.quorum.rate).toBeNull(); // 2 < floor — counts shown, rate withheld
  });

  it('states a rate only at/above the evidence floor', () => {
    const under = summarizeSeatLedger(Array.from({ length: QUORUM_RATE_FLOOR - 1 }, () => row()));
    expect(under[0].quorum.rate).toBeNull();
    const at = summarizeSeatLedger(Array.from({ length: QUORUM_RATE_FLOOR }, (_, i) => row({ vote: i % 2 ? 'GREEN' : 'YELLOW', overallVerdict: 'GREEN' })));
    expect(at[0].quorum.scored).toBe(QUORUM_RATE_FLOOR);
    expect(at[0].quorum.rate).toBe(0.5);
  });

  it('owner and outcome columns are honestly not-joined in phase 1 — absence is never zero evidence', () => {
    const [s] = summarizeSeatLedger([row()]);
    expect(s.owner).toEqual({ state: 'not-joined' });
    expect(s.outcome).toEqual({ state: 'not-joined' });
    expect('rate' in s.owner).toBe(false);
  });

  it('per-seat grouping with deterministic order', () => {
    const seats = summarizeSeatLedger([row({ seat: 'KIM' }), row({ seat: 'DSK' }), row({ seat: 'KIM' })]).map((s) => s.seat);
    expect(seats).toEqual(['DSK', 'KIM']);
  });
});

// ─── #178 round 4: the owner-decision join ───────────────────────────────────────────────────
import {
  validateOwnerDecisionRow, appendOwnerDecisionRows, readOwnerDecisionRows, joinOwnerDecisions,
  OWNER_DECISIONS_FILE, OWNER_RATE_FLOOR, type OwnerDecisionRowV1,
} from '../src/fusionSeatLedger';

function decision(over: Partial<OwnerDecisionRowV1> = {}): OwnerDecisionRowV1 {
  return {
    schema: 'fusion-ledger-owner-decision-v1', createdAt: NOW, key: KEY,
    ownerDecision: 'signed-applied', decidedAt: NOW, commitSha: 'abc123def456',
    advisoryOnly: true, grantsAuthority: false,
    ...over,
  };
}

function writeAppliedLedger(entries: Array<{ proposalHash: string; appliedAt: string; commitSha: string }>) {
  const dir = path.join(home, 'aumlok');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'applied-ledger.json'), JSON.stringify(entries, null, 2));
}

describe('ownerDecision rows — validation, append, read', () => {
  it('validates fail-closed', () => {
    expect(validateOwnerDecisionRow(decision())).toEqual({ valid: true });
    const cases: Array<[string, unknown]> = [
      ['wrong schema', decision({ schema: 'fusion-ledger-owner-decision-v2' as never })],
      ['invented decision value', decision({ ownerDecision: 'rejected' as never })], // no negative fact exists in phase 2
      ['authority pin flipped', decision({ grantsAuthority: true as never })],
      ['missing commit', decision({ commitSha: '' })],
    ];
    for (const [label, bad] of cases) expect(validateOwnerDecisionRow(bad).valid, label).toBe(false);
  });

  it('append→read round-trips in its OWN file; tampered lines skipped and counted', () => {
    expect(appendOwnerDecisionRows([decision()], home).ok).toBe(true);
    fs.appendFileSync(path.join(seatLedgerDir(home), OWNER_DECISIONS_FILE), '{"schema":"fusion-ledger-owner-decision-v1","ownerDecision":"rejected"}\n');
    const r = readOwnerDecisionRows(home);
    expect(r.rows).toEqual([decision()]);
    expect(r.skippedInvalid).toBe(1);
    // the two schemas never share a file — seat-row reads are untouched
    expect(readSeatLedgerRows(home)).toEqual({ rows: [], skippedInvalid: 0 });
  });
});

describe('joinOwnerDecisions — signed facts in, decision rows out', () => {
  it('joins applied proposals the council reviewed; counts (never invents rows for) unreviewed applies', () => {
    appendSeatLedgerRows([row({ key: KEY })], home);
    writeAppliedLedger([
      { proposalHash: KEY, appliedAt: NOW, commitSha: 'c0ffee123456' },
      { proposalHash: 'cd'.repeat(32), appliedAt: NOW, commitSha: 'dead12345678' }, // applied, never reviewed
    ]);
    const j = joinOwnerDecisions(home, NOW);
    expect(j.ok).toBe(true);
    if (j.ok) {
      expect(j.appended).toBe(1);
      expect(j.unmatchedApplied).toBe(1);
      expect(j.alreadyJoined).toBe(0);
    }
    const rows = readOwnerDecisionRows(home).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe(KEY);
    expect(rows[0].commitSha).toBe('c0ffee123456');
  });

  it('is idempotent: a rerun appends nothing and says so', () => {
    appendSeatLedgerRows([row({ key: KEY })], home);
    writeAppliedLedger([{ proposalHash: KEY, appliedAt: NOW, commitSha: 'c0ffee123456' }]);
    expect(joinOwnerDecisions(home, NOW)).toMatchObject({ ok: true, appended: 1 });
    expect(joinOwnerDecisions(home, NOW)).toMatchObject({ ok: true, appended: 0, alreadyJoined: 1 });
    expect(readOwnerDecisionRows(home).rows).toHaveLength(1);
  });

  it('a missing applied ledger is the honest first-use empty; a CORRUPT one is a refusal, never read as empty', () => {
    appendSeatLedgerRows([row({ key: KEY })], home);
    expect(joinOwnerDecisions(home, NOW)).toMatchObject({ ok: true, appended: 0, alreadyJoined: 0, unmatchedApplied: 0 });

    fs.mkdirSync(path.join(home, 'aumlok'), { recursive: true });
    fs.writeFileSync(path.join(home, 'aumlok', 'applied-ledger.json'), 'not json');
    const j = joinOwnerDecisions(home, NOW);
    expect(j.ok).toBe(false);
    if (!j.ok) expect(j.reason).toMatch(/applied-proposal ledger refused/);
    expect(readOwnerDecisionRows(home).rows).toHaveLength(0); // nothing written on refusal
  });
});

describe('summarize — the owner column comes alive', () => {
  it('omitted decisions → not-joined; empty array → the join ran and found nothing signed', () => {
    expect(summarizeSeatLedger([row()])[0].owner).toEqual({ state: 'not-joined' });
    expect(summarizeSeatLedger([row()], [])[0].owner).toEqual({ scored: 0, agreed: 0, rate: null });
  });

  it('scores only SIGNED keys: GREEN/YELLOW agree, RED disagrees, NON_VOTE and unsigned excluded', () => {
    const signed = KEY;
    const unsigned = 'cd'.repeat(32);
    const rows: SeatLedgerRowV1[] = [
      row({ key: signed, vote: 'GREEN' }),   // agree
      row({ key: signed, vote: 'YELLOW' }),  // agree (advice compatible with the owner's yes)
      row({ key: signed, vote: 'RED' }),     // disagree — advised against a signed apply
      row({ key: signed, vote: 'NON_VOTE' }),// excluded
      row({ key: unsigned, vote: 'GREEN' }), // unknown decision — never scored, never a rejection
    ];
    const [s] = summarizeSeatLedger(rows, [decision({ key: signed })]);
    expect(s.owner).toEqual({ scored: 3, agreed: 2, rate: null });
  });

  it('states an owner rate only at/above the 30-decision evidence floor', () => {
    const mk = (n: number) => {
      const rows: SeatLedgerRowV1[] = [];
      const decisions: OwnerDecisionRowV1[] = [];
      for (let i = 0; i < n; i++) {
        const k = i.toString(16).padStart(64, '0');
        rows.push(row({ key: k, vote: 'GREEN' }));
        decisions.push(decision({ key: k }));
      }
      return summarizeSeatLedger(rows, decisions)[0].owner;
    };
    expect(mk(OWNER_RATE_FLOOR - 1)).toEqual({ scored: OWNER_RATE_FLOOR - 1, agreed: OWNER_RATE_FLOOR - 1, rate: null });
    expect(mk(OWNER_RATE_FLOOR)).toEqual({ scored: OWNER_RATE_FLOOR, agreed: OWNER_RATE_FLOOR, rate: 1 });
  });
});
