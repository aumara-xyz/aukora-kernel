// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * fusion-seat-ledger-row-v1 — phase 1 of the seat-accuracy ledger (#178 round 3;
 * design: docs/FUSION_SEAT_LEDGER_DESIGN.md, merged in #181).
 *
 * START RECORDING: one append-only row per council seat per review, so paid runs
 * become durable evidence about which minds to trust. Phase 1 records and tallies
 * the QUORUM-AGREEMENT column only — with the design's two hard scoring rules
 * already enforced in code, not prose:
 *   1. phase-locked rounds are EXCLUDED from quorum-agreement (the alarm rounds are
 *      the failure mode, not ground truth — a parrot must not score);
 *   2. below the evidence floor the rate is NULL, never a small-n number.
 * The owner and outcome columns are reported as { state: 'not-joined' } — honest
 * placeholders until the promotion-receipt join (design brick 3) exists. No column
 * is ever collapsed into a single headline score.
 *
 * Storage: JSONL under `<symbiote home>/fusion/seat-ledger/` — DELIBERATE deviation
 * from the design's "core/evidence/" sketch, for two reasons stated here so the
 * reviewer can veto: (a) the home dir is already env-parameterized everywhere
 * (AUKORA_SYMBIOTE_HOME), so every existing test is hermetic against it — a mocked
 * council in a test can never pollute the REAL ledger with fake evidence; (b) rows
 * are node-local runtime evidence like proposal-advisories/, not per-run artifacts.
 *
 * The line that never moves: rows are EVIDENCE about advisors. Nothing reads this
 * ledger to gate, weight, or authorize anything — consumption (design brick 4) only
 * ever produces proposals the owner signs. advisoryOnly/grantsAuthority pinned per
 * row; validation fail-closed on write AND read (a tampered line is skipped and
 * counted, never half-trusted).
 */
import * as fs from 'fs';
import * as path from 'path';
import type { SelfEditReviewSummary } from './selfEditReviewCouncil';
// Read-only listing of signed, executed applies — the join's ONLY authority-adjacent import, and it
// is the advisory read surface (listAppliedProposals), never the signer or the enforcement path.
import { listAppliedProposals } from './appliedProposalLedger';

export const SEAT_LEDGER_FILE = 'seat-ledger-v1.jsonl';
const KEY_CAP = 80;
const SEAT_CAP = 80;
const QUORUM_STATUS_CAP = 60;
/** Minimum scored (non-excluded) votes before a quorum-agreement RATE is stated. */
export const QUORUM_RATE_FLOOR = 10;
/** Bounded read: the tail of the file, never the unbounded whole. */
export const MAX_ROWS_READ = 10_000;

const RUN_KINDS = ['proposal-review', 'repo-audit', 'chat-reading'] as const;
const VOTES = ['GREEN', 'YELLOW', 'RED', 'NON_VOTE'] as const;
const OVERALLS = ['GREEN', 'YELLOW', 'RED', 'NO_QUORUM'] as const;

export interface SeatLedgerRowV1 {
  schema: 'fusion-seat-ledger-row-v1';
  createdAt: string;
  runKind: (typeof RUN_KINDS)[number];
  key: string; // proposalHash (proposal-review) or runId — what was reviewed
  seat: string; // the seat identifier as the review reports it
  vote: (typeof VOTES)[number]; // NON_VOTE = adapter failure, never a fabricated stance
  providerContacted: boolean;
  durationMs: number;
  overallVerdict: (typeof OVERALLS)[number];
  quorumStatus: string;
  phaseLocked: boolean;
  advisoryOnly: true;
  grantsAuthority: false;
}

export function seatLedgerDir(homeDir?: string): string {
  const home = homeDir ?? process.env.AUKORA_SYMBIOTE_HOME ?? path.join(process.env.HOME || '', '.aukora-symbiote');
  return path.join(home, 'fusion', 'seat-ledger');
}

const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/** One row per council seat in the review. An empty/skipped review yields zero rows (nothing to record). */
export function buildSeatLedgerRows(input: {
  review: SelfEditReviewSummary;
  runKind: SeatLedgerRowV1['runKind'];
  key: string;
  createdAt?: string;
}): SeatLedgerRowV1[] {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const r = input.review;
  return (r.results ?? []).map((res) => ({
    schema: 'fusion-seat-ledger-row-v1' as const,
    createdAt,
    runKind: input.runKind,
    key: cap(input.key, KEY_CAP),
    seat: cap(String(res.model ?? 'unknown'), SEAT_CAP),
    vote: res.adapterFailure ? 'NON_VOTE' : res.verdict,
    providerContacted: res.provider_contacted === true,
    durationMs: Number.isFinite(res.durationMs) ? res.durationMs : 0,
    overallVerdict: r.overallVerdict,
    quorumStatus: cap(String(r.quorum?.status ?? 'unknown'), QUORUM_STATUS_CAP),
    phaseLocked: r.phaseLocked === true,
    advisoryOnly: true as const,
    grantsAuthority: false as const,
  }));
}

/** Fail-closed shape check — anything that isn't exactly the pinned row shape is refused. */
export function validateSeatLedgerRow(u: unknown): { valid: true } | { valid: false; reason: string } {
  if (!u || typeof u !== 'object') return { valid: false, reason: 'not an object' };
  const v = u as Record<string, unknown>;
  if (v.schema !== 'fusion-seat-ledger-row-v1') return { valid: false, reason: `wrong schema: ${String(v.schema)}` };
  if (typeof v.createdAt !== 'string' || !v.createdAt) return { valid: false, reason: 'createdAt missing' };
  if (!RUN_KINDS.includes(v.runKind as (typeof RUN_KINDS)[number])) return { valid: false, reason: `unknown runKind: ${String(v.runKind)}` };
  if (typeof v.key !== 'string' || !v.key || v.key.length > KEY_CAP) return { valid: false, reason: 'key missing or over cap' };
  if (typeof v.seat !== 'string' || !v.seat || v.seat.length > SEAT_CAP) return { valid: false, reason: 'seat missing or over cap' };
  if (!VOTES.includes(v.vote as (typeof VOTES)[number])) return { valid: false, reason: `unknown vote: ${String(v.vote)}` };
  if (typeof v.providerContacted !== 'boolean') return { valid: false, reason: 'providerContacted not boolean' };
  if (typeof v.durationMs !== 'number' || !Number.isFinite(v.durationMs)) return { valid: false, reason: 'durationMs not a number' };
  if (!OVERALLS.includes(v.overallVerdict as (typeof OVERALLS)[number])) return { valid: false, reason: `unknown overallVerdict: ${String(v.overallVerdict)}` };
  if (typeof v.quorumStatus !== 'string' || v.quorumStatus.length > QUORUM_STATUS_CAP) return { valid: false, reason: 'quorumStatus malformed' };
  if (typeof v.phaseLocked !== 'boolean') return { valid: false, reason: 'phaseLocked not boolean' };
  if (v.advisoryOnly !== true) return { valid: false, reason: 'advisoryOnly must be pinned true' };
  if (v.grantsAuthority !== false) return { valid: false, reason: 'grantsAuthority must be pinned false' };
  return { valid: true };
}

/** Validate-then-append (whole batch fail-closed: ONE invalid row refuses the batch — a partially
 *  written batch would silently skew per-seat tallies). Zero rows is a valid no-op. The CALLER treats
 *  refusal as non-blocking: recording evidence never fails a review. */
export function appendSeatLedgerRows(rows: SeatLedgerRowV1[], homeDir?: string): { ok: true; path: string; appended: number } | { ok: false; reason: string } {
  for (let i = 0; i < rows.length; i++) {
    const check = validateSeatLedgerRow(rows[i]);
    if (!check.valid) return { ok: false, reason: `refused (fail-closed): row ${i}: ${check.reason}` };
  }
  const dir = seatLedgerDir(homeDir);
  const filePath = path.join(dir, SEAT_LEDGER_FILE);
  if (rows.length === 0) return { ok: true, path: filePath, appended: 0 };
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.appendFileSync(filePath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
    return { ok: true, path: filePath, appended: rows.length };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Bounded, fail-closed read: the last `max` lines; a tampered/foreign line is SKIPPED AND COUNTED,
 *  never half-trusted. A missing file is an honestly empty ledger. Never throws. */
export function readSeatLedgerRows(homeDir?: string, max = MAX_ROWS_READ): { rows: SeatLedgerRowV1[]; skippedInvalid: number } {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(seatLedgerDir(homeDir), SEAT_LEDGER_FILE), 'utf-8');
  } catch {
    return { rows: [], skippedInvalid: 0 };
  }
  const lines = raw.split('\n').filter((l) => l.trim()).slice(-Math.max(1, max));
  const rows: SeatLedgerRowV1[] = [];
  let skippedInvalid = 0;
  for (const line of lines) {
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { skippedInvalid++; continue; }
    if (validateSeatLedgerRow(parsed).valid) rows.push(parsed as SeatLedgerRowV1);
    else skippedInvalid++;
  }
  return { rows, skippedInvalid };
}

// ═══════════════════════════════════════════════════════════════════════════════
// OWNER-DECISION JOIN (#178 round 4 — design brick 3)
//
// The only knowable positive owner fact is a SIGNED, EXECUTED apply: an entry in the
// applied-proposal ledger, which is written exclusively behind signature verification
// (appliedProposalLedger.ts). An unsigned proposal is UNKNOWN — still pending, maybe
// archived — and is NEVER counted as a rejection; no negative decision is invented.
// Decision rows live in their OWN JSONL file (owner-decisions-v1.jsonl): mixing two
// schemas in one file would make each schema's reader count the other as tampering.
// ═══════════════════════════════════════════════════════════════════════════════

export const OWNER_DECISIONS_FILE = 'owner-decisions-v1.jsonl';
/** Design §6: below this many owner-decided votes, the owner column states no rate. */
export const OWNER_RATE_FLOOR = 30;
const COMMIT_CAP = 60;

export interface OwnerDecisionRowV1 {
  schema: 'fusion-ledger-owner-decision-v1';
  createdAt: string; // when the JOIN recorded it
  key: string; // proposalHash
  ownerDecision: 'signed-applied'; // the only durable positive fact in phase 2
  decidedAt: string; // appliedAt from the applied-proposal ledger
  commitSha: string;
  advisoryOnly: true;
  grantsAuthority: false;
}

export function validateOwnerDecisionRow(u: unknown): { valid: true } | { valid: false; reason: string } {
  if (!u || typeof u !== 'object') return { valid: false, reason: 'not an object' };
  const v = u as Record<string, unknown>;
  if (v.schema !== 'fusion-ledger-owner-decision-v1') return { valid: false, reason: `wrong schema: ${String(v.schema)}` };
  if (typeof v.createdAt !== 'string' || !v.createdAt) return { valid: false, reason: 'createdAt missing' };
  if (typeof v.key !== 'string' || !v.key || v.key.length > KEY_CAP) return { valid: false, reason: 'key missing or over cap' };
  if (v.ownerDecision !== 'signed-applied') return { valid: false, reason: `unknown ownerDecision: ${String(v.ownerDecision)}` };
  if (typeof v.decidedAt !== 'string' || !v.decidedAt) return { valid: false, reason: 'decidedAt missing' };
  if (typeof v.commitSha !== 'string' || !v.commitSha || v.commitSha.length > COMMIT_CAP) return { valid: false, reason: 'commitSha missing or over cap' };
  if (v.advisoryOnly !== true) return { valid: false, reason: 'advisoryOnly must be pinned true' };
  if (v.grantsAuthority !== false) return { valid: false, reason: 'grantsAuthority must be pinned false' };
  return { valid: true };
}

/** Same discipline as the seat rows: whole-batch fail-closed append, zero rows a valid no-op. */
export function appendOwnerDecisionRows(rows: OwnerDecisionRowV1[], homeDir?: string): { ok: true; path: string; appended: number } | { ok: false; reason: string } {
  for (let i = 0; i < rows.length; i++) {
    const check = validateOwnerDecisionRow(rows[i]);
    if (!check.valid) return { ok: false, reason: `refused (fail-closed): row ${i}: ${check.reason}` };
  }
  const dir = seatLedgerDir(homeDir);
  const filePath = path.join(dir, OWNER_DECISIONS_FILE);
  if (rows.length === 0) return { ok: true, path: filePath, appended: 0 };
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.appendFileSync(filePath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
    return { ok: true, path: filePath, appended: rows.length };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Whether any owner-decision evidence has ever been recorded on this node (#178 round 5: the gate
 *  distinguishes "records not started" from "records exist but say nothing yet"). File presence
 *  only — content is read and validated by readOwnerDecisionRows. */
export function hasOwnerDecisions(homeDir?: string): boolean {
  try { return fs.existsSync(path.join(seatLedgerDir(homeDir), OWNER_DECISIONS_FILE)); } catch { return false; }
}

/** Bounded, fail-closed read — tampered lines skipped AND counted; missing file honestly empty. */
export function readOwnerDecisionRows(homeDir?: string, max = MAX_ROWS_READ): { rows: OwnerDecisionRowV1[]; skippedInvalid: number } {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(seatLedgerDir(homeDir), OWNER_DECISIONS_FILE), 'utf-8');
  } catch {
    return { rows: [], skippedInvalid: 0 };
  }
  const lines = raw.split('\n').filter((l) => l.trim()).slice(-Math.max(1, max));
  const rows: OwnerDecisionRowV1[] = [];
  let skippedInvalid = 0;
  for (const line of lines) {
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { skippedInvalid++; continue; }
    if (validateOwnerDecisionRow(parsed).valid) rows.push(parsed as OwnerDecisionRowV1);
    else skippedInvalid++;
  }
  return { rows, skippedInvalid };
}

export type OwnerJoinResult =
  | { ok: true; path: string; appended: number; alreadyJoined: number; unmatchedApplied: number }
  | { ok: false; reason: string };

/** The join: read the applied-proposal ledger (signed, executed applies — the ONLY source of a
 *  positive owner decision) and append one decision row for each applied proposal the council has
 *  vote rows for. Idempotent (already-joined keys skip); applied proposals the council never
 *  reviewed are counted, not invented into rows; a corrupt applied ledger is an honest refusal,
 *  never read as empty. Read-only over authority surfaces — this function can see that a signature
 *  happened; it can never make one happen. */
export function joinOwnerDecisions(
  homeDir?: string,
  now = new Date().toISOString(),
  deps: { listApplied: typeof listAppliedProposals } = { listApplied: listAppliedProposals },
): OwnerJoinResult {
  const applied = deps.listApplied({ homeDir });
  if (!applied.ok) return { ok: false, reason: `applied-proposal ledger refused: ${applied.reason}` };

  const reviewedKeys = new Set(readSeatLedgerRows(homeDir).rows.map((r) => r.key));
  const joinedKeys = new Set(readOwnerDecisionRows(homeDir).rows.map((r) => r.key));

  const fresh: OwnerDecisionRowV1[] = [];
  let alreadyJoined = 0;
  let unmatchedApplied = 0;
  for (const e of applied.entries) {
    if (joinedKeys.has(e.proposalHash)) { alreadyJoined++; continue; }
    if (!reviewedKeys.has(e.proposalHash)) { unmatchedApplied++; continue; }
    fresh.push({
      schema: 'fusion-ledger-owner-decision-v1',
      createdAt: now,
      key: cap(e.proposalHash, KEY_CAP),
      ownerDecision: 'signed-applied',
      decidedAt: e.appliedAt,
      commitSha: cap(e.commitSha, COMMIT_CAP),
      advisoryOnly: true,
      grantsAuthority: false,
    });
  }
  const w = appendOwnerDecisionRows(fresh, homeDir);
  if (!w.ok) return { ok: false, reason: w.reason };
  return { ok: true, path: w.path, appended: w.appended, alreadyJoined, unmatchedApplied };
}

export interface SeatLedgerSummary {
  seat: string;
  rows: number;
  votes: number;
  nonVotes: number;
  /** Column 1 of 3 — cheap, immediate, groupthink-biased by nature, so phase-locked rounds are
   *  excluded and the rate is null below the evidence floor. */
  quorum: { scored: number; agreed: number; excludedPhaseLocked: number; rate: number | null };
  /** Column 2 — alive when decision rows are supplied. Scored over SIGNED proposals only (an
   *  unsigned proposal is unknown, never a rejection). agree = the seat's vote was GREEN or
   *  YELLOW (advice compatible with the owner's yes); disagree = RED against a signed apply.
   *  Phase-locked rounds are NOT excluded here — the seat's own stance vs the owner's choice is
   *  the signal, not the room's convergence. Rate NULL below OWNER_RATE_FLOOR. */
  owner: { state: 'not-joined' } | { scored: number; agreed: number; rate: number | null };
  /** Column 3: not recorded yet — the outcome join is design brick 5. */
  outcome: { state: 'not-joined' };
}

/** Per-seat tallies over validated rows. Pure. NON_VOTEs and NO_QUORUM rounds are never scored;
 *  phase-locked rounds are excluded from quorum-agreement and surfaced in their own count.
 *  `ownerDecisions` OMITTED means the join never ran (owner column reads 'not-joined'); an EMPTY
 *  array means the join ran and found nothing signed yet — different facts, shown differently. */
export function summarizeSeatLedger(rows: SeatLedgerRowV1[], ownerDecisions?: OwnerDecisionRowV1[]): SeatLedgerSummary[] {
  const bySeat = new Map<string, SeatLedgerRowV1[]>();
  for (const r of rows) {
    const list = bySeat.get(r.seat) ?? [];
    list.push(r);
    bySeat.set(r.seat, list);
  }
  const out: SeatLedgerSummary[] = [];
  for (const [seat, seatRows] of [...bySeat.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const votes = seatRows.filter((r) => r.vote !== 'NON_VOTE');
    const scorable = votes.filter((r) => r.overallVerdict !== 'NO_QUORUM');
    const excludedPhaseLocked = scorable.filter((r) => r.phaseLocked).length;
    const scoredRows = scorable.filter((r) => !r.phaseLocked);
    const agreed = scoredRows.filter((r) => r.vote === r.overallVerdict).length;
    let owner: SeatLedgerSummary['owner'] = { state: 'not-joined' };
    if (ownerDecisions !== undefined) {
      const signedKeys = new Set(ownerDecisions.filter((d) => d.ownerDecision === 'signed-applied').map((d) => d.key));
      const ownerScored = votes.filter((r) => signedKeys.has(r.key));
      const ownerAgreed = ownerScored.filter((r) => r.vote === 'GREEN' || r.vote === 'YELLOW').length;
      owner = {
        scored: ownerScored.length,
        agreed: ownerAgreed,
        rate: ownerScored.length >= OWNER_RATE_FLOOR ? Math.round((ownerAgreed / ownerScored.length) * 1000) / 1000 : null,
      };
    }
    out.push({
      seat,
      rows: seatRows.length,
      votes: votes.length,
      nonVotes: seatRows.length - votes.length,
      quorum: {
        scored: scoredRows.length,
        agreed,
        excludedPhaseLocked,
        rate: scoredRows.length >= QUORUM_RATE_FLOOR ? Math.round((agreed / scoredRows.length) * 1000) / 1000 : null,
      },
      owner,
      outcome: { state: 'not-joined' },
    });
  }
  return out;
}
