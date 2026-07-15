// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Proposal-disposition artifact: advisory closure evidence for the inside-out loop.
 *
 * This artifact never authorizes an action. A `signed_applied` row is written only AFTER the
 * existing AUMLOK ceremony has produced a verified live-apply receipt; the row merely carries
 * that receipt's public hash and commit id back to observer/read surfaces. The remaining values
 * are reserved for future explicit owner actions. Their presence in this schema does not create
 * an endpoint that can assert them.
 */
import { createHash } from 'crypto';

export const PROPOSAL_DISPOSITION_SCHEMA = 'proposal-disposition-v1' as const;
export type ProposalDisposition = 'signed_applied' | 'rejected' | 'shelved' | 'superseded';

export interface ProposalDispositionArtifactV1 {
  schema: typeof PROPOSAL_DISPOSITION_SCHEMA;
  proposalHash: string;
  disposition: ProposalDisposition;
  decidedAt: string;
  ownerNote?: string;
  commitSha?: string;
  receiptHash?: string;
  advisoryOnly: true;
  grantsAuthority: false;
  artifactHash: string;
}

export interface BuildProposalDispositionInput {
  proposalHash: string;
  disposition: ProposalDisposition;
  decidedAt: string;
  ownerNote?: string;
  commitSha?: string;
  receiptHash?: string;
}

const HEX64_RE = /^[0-9a-f]{64}$/;
const COMMIT_RE = /^[0-9a-f]{7,64}$/;
const OWNER_NOTE_CAP = 500;
const KEYS = new Set([
  'schema', 'proposalHash', 'disposition', 'decidedAt', 'ownerNote', 'commitSha',
  'receiptHash', 'advisoryOnly', 'grantsAuthority', 'artifactHash',
]);
const DISPOSITIONS = new Set<ProposalDisposition>(['signed_applied', 'rejected', 'shelved', 'superseded']);

function artifactHashOf(a: Omit<ProposalDispositionArtifactV1, 'artifactHash'>): string {
  return createHash('sha256').update(JSON.stringify({
    schema: a.schema,
    proposalHash: a.proposalHash,
    disposition: a.disposition,
    decidedAt: a.decidedAt,
    ownerNote: a.ownerNote ?? null,
    commitSha: a.commitSha ?? null,
    receiptHash: a.receiptHash ?? null,
    advisoryOnly: a.advisoryOnly,
    grantsAuthority: a.grantsAuthority,
  })).digest('hex');
}

export function validateProposalDispositionArtifact(value: unknown): { valid: true } | { valid: false; reason: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false, reason: 'not an object' };
  const a = value as Record<string, unknown>;
  if (!Object.keys(a).every((key) => KEYS.has(key))) return { valid: false, reason: 'unknown field(s)' };
  if (a.schema !== PROPOSAL_DISPOSITION_SCHEMA) return { valid: false, reason: 'wrong schema' };
  if (typeof a.proposalHash !== 'string' || !HEX64_RE.test(a.proposalHash)) return { valid: false, reason: 'proposalHash must be 64 lowercase hex' };
  if (typeof a.disposition !== 'string' || !DISPOSITIONS.has(a.disposition as ProposalDisposition)) return { valid: false, reason: 'unknown disposition' };
  if (typeof a.decidedAt !== 'string' || !Number.isFinite(Date.parse(a.decidedAt))) return { valid: false, reason: 'decidedAt must be a parseable timestamp' };
  if (a.ownerNote !== undefined && (typeof a.ownerNote !== 'string' || !a.ownerNote.trim() || a.ownerNote.length > OWNER_NOTE_CAP)) {
    return { valid: false, reason: `ownerNote must be non-empty and at most ${OWNER_NOTE_CAP} characters when present` };
  }
  if (a.disposition === 'signed_applied') {
    if (typeof a.commitSha !== 'string' || !COMMIT_RE.test(a.commitSha)) return { valid: false, reason: 'signed_applied requires a commitSha' };
    if (typeof a.receiptHash !== 'string' || !HEX64_RE.test(a.receiptHash)) return { valid: false, reason: 'signed_applied requires a 64-hex receiptHash' };
  } else if (a.commitSha !== undefined || a.receiptHash !== undefined) {
    return { valid: false, reason: 'non-applied dispositions cannot claim commit or receipt evidence' };
  }
  if (a.advisoryOnly !== true) return { valid: false, reason: 'advisoryOnly must be true' };
  if (a.grantsAuthority !== false) return { valid: false, reason: 'grantsAuthority must be false' };
  if (typeof a.artifactHash !== 'string' || !HEX64_RE.test(a.artifactHash)) return { valid: false, reason: 'artifactHash must be 64 lowercase hex' };
  const { artifactHash, ...body } = a as unknown as ProposalDispositionArtifactV1;
  if (artifactHash !== artifactHashOf(body)) return { valid: false, reason: 'artifactHash integrity mismatch' };
  return { valid: true };
}

export function buildProposalDispositionArtifact(input: BuildProposalDispositionInput): ProposalDispositionArtifactV1 {
  const note = input.ownerNote?.trim();
  const body: Omit<ProposalDispositionArtifactV1, 'artifactHash'> = {
    schema: PROPOSAL_DISPOSITION_SCHEMA,
    proposalHash: input.proposalHash,
    disposition: input.disposition,
    decidedAt: input.decidedAt,
    ...(note ? { ownerNote: note } : {}),
    ...(input.commitSha ? { commitSha: input.commitSha } : {}),
    ...(input.receiptHash ? { receiptHash: input.receiptHash } : {}),
    advisoryOnly: true,
    grantsAuthority: false,
  };
  const artifact: ProposalDispositionArtifactV1 = { ...body, artifactHash: artifactHashOf(body) };
  const check = validateProposalDispositionArtifact(artifact);
  if (!check.valid) throw new Error(`invalid proposal disposition: ${check.reason}`);
  return artifact;
}
