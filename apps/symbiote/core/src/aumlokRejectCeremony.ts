// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Device-local owner rejection ceremony for one pending self-edit proposal.
 *
 * Rejection is deliberately separate from approval: it does not mint a challenge, read a key,
 * sign, or apply. It moves the exact validated pending artifact into a local rejected archive and
 * writes an advisory disposition record so the inside-out loop can later observe the owner's no.
 */
import * as fs from 'fs';
import * as path from 'path';
import { readPendingProposalByHash } from './selfEditProposalArtifact';
import { recordRejectedDisposition } from './proposalDispositionWrite';

export interface RejectCeremonyPaths { homeDir?: string; }

export type RejectResult =
  | { ok: true; proposalHash: string; archivedPath: string; dispositionRecorded: true; duplicate: boolean }
  | { ok: false; reason: string };

function resolvedHome(homeDir?: string): string {
  return homeDir ?? process.env.AUKORA_SYMBIOTE_HOME ?? path.join(process.env.HOME || '', '.aukora-symbiote');
}

/**
 * Archive one valid pending proposal after an explicit owner rejection. The journal is recorded
 * before the archive move; if the move fails, the just-written row remains an honest durable record
 * of the owner's decision and the endpoint reports that the proposal could not be removed from view.
 * Callers must then suppress it from any approval surface rather than ever re-offer it for signing.
 */
export function rejectPendingProposal(proposalHash: string, paths: RejectCeremonyPaths = {}): RejectResult {
  if (typeof proposalHash !== 'string' || !/^[0-9a-f]{64}$/.test(proposalHash)) {
    return { ok: false, reason: 'proposal hash must be a bare 64-hex string' };
  }

  const homeDir = resolvedHome(paths.homeDir);
  const loaded = readPendingProposalByHash(proposalHash, homeDir);
  if (!loaded.ok) return { ok: false, reason: `proposal not found or invalid: ${loaded.reason}` };

  const recorded = recordRejectedDisposition({ proposalHash, decidedAt: new Date().toISOString() }, homeDir);
  if (!recorded.ok) return recorded;

  const archiveDir = path.join(homeDir, 'aumlok', 'pending-proposals', 'rejected-archive');
  const archivedPath = path.join(archiveDir, path.basename(loaded.filePath));
  try {
    fs.mkdirSync(archiveDir, { recursive: true, mode: 0o700 });
    if (fs.existsSync(archivedPath)) {
      return { ok: true, proposalHash, archivedPath, dispositionRecorded: true, duplicate: true };
    }
    fs.renameSync(loaded.filePath, archivedPath);
    return { ok: true, proposalHash, archivedPath, dispositionRecorded: true, duplicate: recorded.duplicate };
  } catch (e) {
    return { ok: false, reason: `rejection recorded but pending artifact could not be archived: ${e instanceof Error ? e.message : String(e)}` };
  }
}
