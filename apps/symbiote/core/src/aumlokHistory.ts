// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * AUMLOK history projection — a bounded, content-free, READ-ONLY view of the four terminal categories
 * of a proposal's life, sourced ONLY from already-trusted artifacts:
 *   - `awaiting`  ← the validated pending proposals the signing assistant already reads
 *                   (<home>/aumlok/pending-proposals) — advisory, awaiting the owner's signature.
 *   - `applied`   ← `signed_applied` proposal-disposition rows (written only AFTER a verified signed
 *                   apply — core/src/proposalDispositionWrite.ts).
 *   - `rejected`  ← `rejected` disposition rows (the explicit owner REJECT ceremony).
 *   - `archived`  ← `shelved` / `superseded` disposition rows.
 *
 * This projection GRANTS NOTHING and MUTATES NOTHING. It never signs, applies, or exposes phrase/key
 * material, the owner-private `ownerNote`, diff bytes, or any signing command. Every row and the top
 * object carry advisoryOnly:true / grantsAuthority:false. Bounded everywhere: each category is capped,
 * goals are length-capped, only 64-hex proposal hashes are admitted, and a missing/unreadable journal
 * degrades to an honest empty category with a note — never a throw, never a guess.
 *
 * Pure by construction: `projectAumlokHistory` takes injected inputs (fully hermetic under test); the
 * thin `readAumlokHistory` composes the two existing trusted readers for the live endpoint.
 */
import type { ProposalDispositionArtifactV1 } from './proposalDisposition';
import { readProposalDispositionRows } from './proposalDispositionRead';
import { buildAumlokAssistantView } from './aumlokSigningAssistant';

export const AUMLOK_HISTORY_SCHEMA = 'aumlok-history-v1' as const;
export type HistoryCategory = 'awaiting' | 'applied' | 'rejected' | 'archived';
export const HISTORY_CATEGORY_MAX = 50; // per-category cap — newest first
const GOAL_CAP = 200;
const AT_CAP = 40;
const HEX64_RE = /^[0-9a-f]{64}$/;
const COMMIT_RE = /^[0-9a-f]{7,64}$/;
const RECEIPT_RE = /^[0-9a-f]{8,128}$/;

export interface HistoryRow {
  category: HistoryCategory;
  proposalHash: string; // full 64-hex (validated)
  shortHash: string;    // first 12, for the row label
  at: string;           // ISO-ish, capped (createdAt for awaiting; decidedAt for the rest)
  goal?: string;        // awaiting only — bounded metadata (the same goal the signing screen shows)
  fileCount?: number;   // awaiting only
  valid?: boolean;      // awaiting only — the artifact's tamper flag, surfaced honestly (never hidden)
  commitSha?: string;   // applied only
  receiptHash?: string; // applied only (short evidence hash, never a key)
  subKind?: 'shelved' | 'superseded'; // archived only — which archival
  advisoryOnly: true;
  grantsAuthority: false;
}

export interface AumlokHistory {
  schema: typeof AUMLOK_HISTORY_SCHEMA;
  awaiting: HistoryRow[];
  applied: HistoryRow[];
  rejected: HistoryRow[];
  archived: HistoryRow[];
  counts: Record<HistoryCategory, number>;
  notes: string[]; // honest degradation ("disposition journal unreadable: …") — never silent
  advisoryOnly: true;
  grantsAuthority: false;
  generatedAt: string;
}

/** The minimal shapes the projection needs from the two trusted readers (kept structural so the caller
 *  can pass the real reader outputs without this module importing the fs-touching signing assistant). */
export interface AwaitingProposalInput {
  proposalHash?: unknown;
  goal?: unknown;
  files?: unknown; // an array; we count it, never read its contents
  valid?: unknown;
  createdAt?: unknown;
}
export interface HistoryInputs {
  pending: AwaitingProposalInput[];
  dispositions: { rows: ProposalDispositionArtifactV1[]; refusedReason: string | null };
  nowIso?: string;
}

const cap = (s: unknown, n: number): string => (typeof s === 'string' ? s.slice(0, n) : '');
const ADVISORY = { advisoryOnly: true as const, grantsAuthority: false as const };

function awaitingRow(p: AwaitingProposalInput): HistoryRow | null {
  const hash = typeof p.proposalHash === 'string' ? p.proposalHash.toLowerCase() : '';
  if (!HEX64_RE.test(hash)) return null; // can't identify it → not shown (never guessed)
  const goal = cap(p.goal, GOAL_CAP);
  return {
    category: 'awaiting',
    proposalHash: hash,
    shortHash: hash.slice(0, 12),
    at: cap(p.createdAt, AT_CAP),
    ...(goal ? { goal } : {}),
    fileCount: Array.isArray(p.files) ? p.files.length : 0,
    valid: p.valid === true, // an invalid/tampered pending artifact reads valid:false, never hidden
    ...ADVISORY,
  };
}

function dispositionRow(a: ProposalDispositionArtifactV1, category: HistoryCategory): HistoryRow | null {
  if (typeof a.proposalHash !== 'string' || !HEX64_RE.test(a.proposalHash)) return null;
  const commitSha = typeof a.commitSha === 'string' && COMMIT_RE.test(a.commitSha) ? a.commitSha : undefined;
  const receiptHash = typeof a.receiptHash === 'string' && RECEIPT_RE.test(a.receiptHash) ? a.receiptHash : undefined;
  return {
    category,
    proposalHash: a.proposalHash,
    shortHash: a.proposalHash.slice(0, 12),
    at: cap(a.decidedAt, AT_CAP),
    ...(category === 'applied' && commitSha ? { commitSha } : {}),
    ...(category === 'applied' && receiptHash ? { receiptHash } : {}),
    ...(category === 'archived' ? { subKind: a.disposition === 'superseded' ? 'superseded' as const : 'shelved' as const } : {}),
    // NOTE: ownerNote is DELIBERATELY never copied — owner-private text stays in the journal.
    ...ADVISORY,
  };
}

/** Project the four terminal categories from injected trusted inputs. Pure; never throws. */
export function projectAumlokHistory(inputs: HistoryInputs): AumlokHistory {
  const notes: string[] = [];

  const awaiting = (Array.isArray(inputs.pending) ? inputs.pending : [])
    .map(awaitingRow).filter((r): r is HistoryRow => r !== null).slice(0, HISTORY_CATEGORY_MAX);

  const applied: HistoryRow[] = [];
  const rejected: HistoryRow[] = [];
  const archived: HistoryRow[] = [];
  const disp = inputs.dispositions;
  if (disp && disp.refusedReason) {
    notes.push(`disposition journal unavailable: ${cap(disp.refusedReason, 160)} (applied/rejected/archived shown empty)`);
  }
  const seen: Record<HistoryCategory, Set<string>> = { awaiting: new Set(), applied: new Set(), rejected: new Set(), archived: new Set() };
  for (const a of (disp && Array.isArray(disp.rows) ? disp.rows : [])) {
    let category: HistoryCategory | null = null;
    if (a.disposition === 'signed_applied') category = 'applied';
    else if (a.disposition === 'rejected') category = 'rejected';
    else if (a.disposition === 'shelved' || a.disposition === 'superseded') category = 'archived';
    if (!category) continue;
    const bucket = category === 'applied' ? applied : category === 'rejected' ? rejected : archived;
    if (bucket.length >= HISTORY_CATEGORY_MAX) continue;
    const row = dispositionRow(a, category);
    if (!row) continue;
    if (seen[category].has(row.proposalHash)) continue; // dedup within a category (newest kept — reader is newest-first)
    seen[category].add(row.proposalHash);
    bucket.push(row);
  }

  return {
    schema: AUMLOK_HISTORY_SCHEMA,
    awaiting, applied, rejected, archived,
    counts: { awaiting: awaiting.length, applied: applied.length, rejected: rejected.length, archived: archived.length },
    notes,
    ...ADVISORY,
    generatedAt: typeof inputs.nowIso === 'string' ? inputs.nowIso : new Date().toISOString(),
  };
}

/** Live composition for the read-only endpoint: read the two trusted sources, then project. The signing
 *  assistant view supplies `awaiting` (validated pending proposals); the disposition journal supplies the
 *  three terminal categories. Read-only; never throws (each reader is fail-soft, and the projection is
 *  pure) — a broken source becomes an honest empty category with a note. */
export function readAumlokHistory(homeDir?: string): AumlokHistory {
  let pending: AwaitingProposalInput[] = [];
  try {
    const view = buildAumlokAssistantView(homeDir ? { homeDir } : {}) as { pending?: AwaitingProposalInput[] };
    pending = Array.isArray(view.pending) ? view.pending : [];
  } catch { pending = []; }
  let dispositions: { rows: ProposalDispositionArtifactV1[]; refusedReason: string | null };
  try {
    const d = readProposalDispositionRows(homeDir, HISTORY_CATEGORY_MAX * 4);
    dispositions = { rows: d.rows, refusedReason: d.refusedReason };
  } catch (e) {
    dispositions = { rows: [], refusedReason: e instanceof Error ? e.message : String(e) };
  }
  return projectAumlokHistory({ pending, dispositions });
}
