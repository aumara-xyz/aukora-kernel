// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/** Read-only half of the proposal-disposition store. No append/write function exists in this module. */
import * as fs from 'fs';
import * as path from 'path';
import { validateProposalDispositionArtifact, type ProposalDispositionArtifactV1 } from './proposalDisposition';

const MAX_JOURNAL_BYTES = 1_000_000;
const MAX_READ_ROWS = 100;

export function proposalDispositionJournalPath(homeDir?: string): string {
  const home = homeDir ?? process.env.AUKORA_SYMBIOTE_HOME ?? path.join(process.env.HOME || '', '.aukora-symbiote');
  return path.join(home, 'aumlok', 'proposal-dispositions-v1.jsonl');
}

export interface ProposalDispositionReadResult {
  rows: ProposalDispositionArtifactV1[];
  total: number;
  skippedInvalid: number;
  refusedReason: string | null;
}

/** Bounded newest-first advisory read. Missing file is honest empty; oversized input refuses. */
export function readProposalDispositionRows(homeDir?: string, limit = 20): ProposalDispositionReadResult {
  const safeLimit = Number.isSafeInteger(limit) ? Math.max(1, Math.min(MAX_READ_ROWS, limit)) : 20;
  const filePath = proposalDispositionJournalPath(homeDir);
  let raw: string;
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile()) return { rows: [], total: 0, skippedInvalid: 0, refusedReason: 'disposition journal is not a regular file' };
    if (st.size > MAX_JOURNAL_BYTES) return { rows: [], total: 0, skippedInvalid: 0, refusedReason: `disposition journal exceeds ${MAX_JOURNAL_BYTES} byte cap` };
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return { rows: [], total: 0, skippedInvalid: 0, refusedReason: null };
    return { rows: [], total: 0, skippedInvalid: 0, refusedReason: e instanceof Error ? e.message : String(e) };
  }

  const lines = raw.split('\n').filter((line) => line.trim());
  const valid: ProposalDispositionArtifactV1[] = [];
  let skippedInvalid = 0;
  for (const line of lines) {
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { skippedInvalid++; continue; }
    const check = validateProposalDispositionArtifact(parsed);
    if (!check.valid) { skippedInvalid++; continue; }
    valid.push(parsed as ProposalDispositionArtifactV1);
  }
  valid.sort((a, b) => Date.parse(b.decidedAt) - Date.parse(a.decidedAt));
  return { rows: valid.slice(0, safeLimit), total: valid.length, skippedInvalid, refusedReason: null };
}
