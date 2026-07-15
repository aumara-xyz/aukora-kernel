// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/** Write-only ceremony hook for proposal dispositions. It grants no authority and runs post-apply. */
import * as fs from 'fs';
import * as path from 'path';
import { buildProposalDispositionArtifact, type ProposalDispositionArtifactV1 } from './proposalDisposition';
import { proposalDispositionJournalPath, readProposalDispositionRows } from './proposalDispositionRead';

export type RecordSignedAppliedDispositionResult =
  | { ok: true; artifact: ProposalDispositionArtifactV1; path: string; duplicate: boolean }
  | { ok: false; reason: string };

export type RecordRejectedDispositionResult =
  | { ok: true; artifact: ProposalDispositionArtifactV1; path: string; duplicate: boolean }
  | { ok: false; reason: string };

/**
 * Record closure only after the existing signed apply has succeeded. Failure here cannot undo the
 * already-real commit, so callers must report it as a closure-evidence warning, never as "apply failed".
 */
export function recordSignedAppliedDisposition(input: {
  proposalHash: string;
  decidedAt: string;
  commitSha: string;
  receiptHash: string;
  ownerNote?: string;
}, homeDir?: string): RecordSignedAppliedDispositionResult {
  let artifact: ProposalDispositionArtifactV1;
  try {
    artifact = buildProposalDispositionArtifact({ ...input, disposition: 'signed_applied' });
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }

  const existing = readProposalDispositionRows(homeDir, 100);
  if (existing.refusedReason) return { ok: false, reason: `cannot trust existing disposition journal: ${existing.refusedReason}` };
  if (existing.rows.some((row) => row.artifactHash === artifact.artifactHash)) {
    return { ok: true, artifact, path: proposalDispositionJournalPath(homeDir), duplicate: true };
  }

  const filePath = proposalDispositionJournalPath(homeDir);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    fs.appendFileSync(filePath, JSON.stringify(artifact) + '\n', { mode: 0o600 });
    return { ok: true, artifact, path: filePath, duplicate: false };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Record the owner's explicit refusal of an unsigned proposal. This is closure evidence only: it
 * never reads a signing key, produces a signature, or participates in an authorization decision.
 *
 * A proposal may have one terminal owner disposition. A repeated reject is idempotent only when the
 * existing journal row is itself a rejection; any other existing disposition refuses loudly.
 */
export function recordRejectedDisposition(input: {
  proposalHash: string;
  decidedAt: string;
}, homeDir?: string): RecordRejectedDispositionResult {
  let artifact: ProposalDispositionArtifactV1;
  try {
    artifact = buildProposalDispositionArtifact({ ...input, disposition: 'rejected' });
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }

  const existing = readProposalDispositionRows(homeDir, 100);
  if (existing.refusedReason) return { ok: false, reason: `cannot trust existing disposition journal: ${existing.refusedReason}` };
  const prior = existing.rows.find((row) => row.proposalHash === artifact.proposalHash);
  if (prior) {
    if (prior.disposition === 'rejected') return { ok: true, artifact: prior, path: proposalDispositionJournalPath(homeDir), duplicate: true };
    return { ok: false, reason: `proposal already has terminal disposition: ${prior.disposition}` };
  }

  const filePath = proposalDispositionJournalPath(homeDir);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    fs.appendFileSync(filePath, JSON.stringify(artifact) + '\n', { mode: 0o600 });
    return { ok: true, artifact, path: filePath, duplicate: false };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
