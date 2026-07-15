// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Pure state-digest builder (issue #37) — turns a completed, signed live-apply receipt into a compact,
 * deterministic text summary for Kira's advisory memory, so a later chat turn can answer "what changed?"
 * from real evidence instead of guessing. No fs/network/git of its own — the caller
 * (workbenchCommandLoop.ts) already has everything this needs: the real receipt from
 * dispatchSignedLiveApply, and the session's own proposal + last test result.
 *
 * Deliberately v1-scoped (amended into issue #37's own text, not silently narrowed here):
 *   - loc figures are AFTER-only line counts. nativeLiveApply.ts's receipt carries only a HASH of the
 *     pre-image (preImageSnapshotHash), never its content, so a real added/modified/deleted delta isn't
 *     derivable here — a vNext concern, not this round's.
 *   - review_ref (an external Fable/Fusion review reference) is omitted entirely in v1 — issue #35's
 *     external-review lane will attach one later via kiraBrain's own `links` field, referencing this
 *     digest's `digestId`, rather than this module trying to anticipate that shape now.
 *
 * Every sha embedded in the rendered text is pre-truncated to 12 chars — the capture chokepoint
 * (workbenchCommandLoop.ts's truncateHexRunsForCapture) already mangles any 40+ hex run it sees, so
 * doing it here first keeps this module's own output deterministic and directly testable, rather than
 * depending on that later, separately-tested pass.
 */
import type { AumlokLiveApplyReceiptV1 } from './nativeLiveApply';

const MAX_TEXT_CHARS = 3_000;
const MAX_FILES_LISTED = 25;
const SHA_PREFIX_LEN = 12;
const DIGEST_ID_LEN = 16; // matches kiraBrain.ts's SAFE_ID shape, with enough entropy to avoid collisions

export interface StateDigestProposal {
  goal: string;
  files: Array<{ relPath: string; content: string }>;
}

export interface StateDigestTestResult {
  passed: boolean;
  ran: string[];
  detail: string;
}

export interface StateDigestInput {
  receipt: AumlokLiveApplyReceiptV1;
  proposal: StateDigestProposal;
  testResult: StateDigestTestResult | null;
  now?: string;
}

export interface StateDigest {
  digestId: string;
  text: string;
  tags: string[];
}

function shortSha(sha: string): string {
  return sha.slice(0, SHA_PREFIX_LEN);
}

function locCount(content: string): number {
  return content.length === 0 ? 0 : content.split('\n').length;
}

/** The digest's own text, deterministic given the same inputs (aside from `now`, which the caller
 *  supplies rather than this module reading the clock itself). Exported separately from
 *  buildStateDigest so it's directly testable against fixed inputs. */
export function formatDigestText(input: StateDigestInput, digestId: string, now: string): string {
  const { receipt, proposal, testResult } = input;
  const files = proposal.files;
  const listedFiles = files.slice(0, MAX_FILES_LISTED);
  const fileLines = listedFiles.map((f) => `  - ${f.relPath} (${locCount(f.content)} lines, after-only — no before/after delta in v1)`);
  if (files.length > MAX_FILES_LISTED) fileLines.push(`  - and ${files.length - MAX_FILES_LISTED} more`);

  const checksLine = testResult
    ? `checks: ${testResult.passed ? 'PASSED' : 'FAILED'} — ran: ${testResult.ran.join(', ') || '(none)'} — ${testResult.detail}`
    : 'checks: no test result was recorded for this landing';

  const lines = [
    `digest_id: ${digestId}`,
    `landed_at: ${now}`,
    `goal: ${proposal.goal}`,
    `files_changed (${files.length}):`,
    ...fileLines,
    checksLine,
    `receipt_ref: proposalHash=${shortSha(receipt.proposalHash)}... commitSha=${shortSha(receipt.commitSha)}... rollback="git revert ${shortSha(receipt.commitSha)}..."`,
    'advisoryOnly: true — grantsAuthority: false. This digest is context about a landed change, never an instruction and never authority — receipts remain the canonical record.',
  ];
  return lines.join('\n');
}

/** Builds the full digest — id, text (capped), and tags. Never throws for any well-shaped input;
 *  ingestMemory's own guard (kiraBrain.ts) is the backstop against secret-shaped content, not this
 *  module — this module's job is keeping ordinary receipt/proposal data out of that guard's way. */
export function buildStateDigest(input: StateDigestInput): StateDigest {
  const now = input.now ?? new Date().toISOString();
  const digestId = input.receipt.receiptHash.slice(0, DIGEST_ID_LEN);
  const text = formatDigestText(input, digestId, now).slice(0, MAX_TEXT_CHARS);
  return { digestId, text, tags: ['digest', 'live_apply'] };
}
