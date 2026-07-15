// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * The ONE place the workbench's "write receipt" / "run: <goal>" chain (issue #25) touches disk to
 * persist a completed rehearsal receipt — kept out of workbenchCommandLoop.ts itself, matching that
 * file's own stated invariant ("this file itself never imports fs/child_process/network directly").
 * Mirrors selfEditProposalArtifact.ts's write-then-return-path shape, using the SAME shared path
 * resolver (authority/symbiotePaths.ts) the AUMLOK writer/reader round-trip fix (issue #24 follow-up)
 * established, so this doesn't hand-roll a second default to drift from it.
 */
import * as fs from 'fs';
import { aumlokReceiptPath, aumlokReceiptsDir } from '../../authority/symbiotePaths';
import type { RecursiveIdeRehearsalReceiptV1 } from './recursiveIdeRehearsalReceipt';

/** Persists ONLY on explicit call — never implicit. The caller decides WHEN it's correct to call this
 *  (workbenchCommandLoop.ts only ever calls it after write_receipt's own dispatch already succeeded);
 *  this module has no opinion on that precondition, it just writes the given receipt and returns the
 *  path. One file per proposal hash — a second call for the same hash overwrites with identical
 *  content (the receipt is a pure function of the same inputs), never a different proposal's data. */
export function persistWorkbenchReceipt(receipt: RecursiveIdeRehearsalReceiptV1): string {
  fs.mkdirSync(aumlokReceiptsDir(), { recursive: true, mode: 0o700 });
  const filePath = aumlokReceiptPath(receipt.proposalHash);
  fs.writeFileSync(filePath, JSON.stringify(receipt, null, 2), { mode: 0o600 });
  return filePath;
}
