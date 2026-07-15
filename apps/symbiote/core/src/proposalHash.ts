// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * The ONE canonical proposal-hash function. `propose_patch` (nativeIdeDispatcher.ts) and the human-side
 * signing CLI (scripts/aumlok-authority.sh, via selfEditProposalArtifact.ts) must both hash a proposal
 * the SAME way — any drift between "what Aukora hashed" and "what the human's terminal re-derives before
 * signing" is a confused-deputy risk (a human could be shown/asked to sign a hash that doesn't actually
 * bind to the exact goal+files a receipt later claims). This module is imported by both sides; there is
 * no second implementation anywhere in the codebase.
 */
import { createHash } from 'crypto';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface ProposalFile { relPath: string; content: string }

/** Canonical, order-stable proposal hash: goal + each file's relPath and a hash of its content. */
export function computeProposalHash(goal: string, files: ProposalFile[]): string {
  return sha256(JSON.stringify({ goal, files: files.map((f) => ({ r: f.relPath, c: sha256(f.content) })) }));
}
