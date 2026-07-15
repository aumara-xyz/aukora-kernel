// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Promotion-grade rollback CONTRACT (snapshot / restore) — the muscle that MUST be proven before live
 * self-modification can ever be allowed. This file DEFINES the contract and provides:
 *   - captureSnapshot(): READ-ONLY content-hash manifest of the body (no mutation, no live apply)
 *   - planRestore():     DRY-RUN diff of what a restore WOULD change (it applies NOTHING)
 *
 * It deliberately does NOT wire live apply and does NOT restore the real body. `restoreProven` stays false
 * until a real restore is mechanically tested; `liveApplyWired` stays false until a deliberate, signed,
 * separately-proven promotion lane exists. No promotion, no authority, no mutation here.
 */
import { createHash } from 'crypto';

export interface SnapshotFile { path: string; sha256: string; bytes: number; }
export interface PromotionSnapshot {
  schemaVersion: 'promotion-snapshot-v1';
  createdAt: string;
  files: SnapshotFile[];
  advisoryOnly: true;
  grantsAuthority: false;
}

export interface RestorePlanEntry { path: string; status: 'unchanged' | 'would_restore' | 'missing_now'; fromSha?: string; toSha: string; }
export interface RestorePlan {
  schemaVersion: 'promotion-restore-plan-v1';
  dryRun: true;             // ALWAYS a dry run — this contract never applies to the real body
  appliedLive: false;
  entries: RestorePlanEntry[];
  wouldRestoreCount: number;
  advisoryOnly: true;
  grantsAuthority: false;
}

/**
 * The honest status of this muscle. `restoreProven` flips to true ONLY when a real restore is mechanically
 * tested; `liveApplyWired` stays false until a deliberate, signed, separately-proven promotion lane exists.
 * The self-mod readiness ladder reads this — so promotion-grade rollback cannot be silently claimed "done".
 */
export const PROMOTION_ROLLBACK_STATUS = {
  contractDefined: true,
  restoreProven: false,
  liveApplyWired: false,
} as const;

function sha256(s: string): string { return createHash('sha256').update(s).digest('hex'); }

/** READ-ONLY: capture a content-hash manifest of the given files. No mutation, no live apply. */
export function captureSnapshot(files: { path: string; content: string }[], createdAt: string): PromotionSnapshot {
  return {
    schemaVersion: 'promotion-snapshot-v1',
    createdAt,
    files: files.map(f => ({ path: f.path, sha256: sha256(f.content), bytes: Buffer.byteLength(f.content, 'utf8') })),
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

/** DRY-RUN ONLY: compute what a restore WOULD change vs the current files. It applies NOTHING. */
export function planRestore(snapshot: PromotionSnapshot, currentFiles: { path: string; content: string }[]): RestorePlan {
  const currentByPath = new Map(currentFiles.map(f => [f.path, sha256(f.content)]));
  const entries: RestorePlanEntry[] = snapshot.files.map(sf => {
    if (!currentByPath.has(sf.path)) return { path: sf.path, status: 'missing_now', toSha: sf.sha256 };
    const nowSha = currentByPath.get(sf.path)!;
    return nowSha === sf.sha256
      ? { path: sf.path, status: 'unchanged', fromSha: nowSha, toSha: sf.sha256 }
      : { path: sf.path, status: 'would_restore', fromSha: nowSha, toSha: sf.sha256 };
  });
  return {
    schemaVersion: 'promotion-restore-plan-v1',
    dryRun: true,
    appliedLive: false,
    entries,
    wouldRestoreCount: entries.filter(e => e.status === 'would_restore').length,
    advisoryOnly: true,
    grantsAuthority: false,
  };
}
