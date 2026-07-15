// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Pure report builder for the workbench "run: <goal>" chain (issue #25). No fs/network/subprocess of
 * its own — it only assembles and formats stage results the caller (workbenchCommandLoop.ts) already
 * produced by calling the SAME stage helpers the standalone commands use. Kept pure so the honesty
 * rule below is unit-testable without ever running a real stage.
 *
 * Honesty rule this module exists to enforce: "content_check" is a SIMULATED sandbox-content match
 * (run_tests / "run sandbox tests" — never a subprocess) and must never be worded as if it were a real
 * test/typecheck run. Only "typecheck" (issue #34/Round 6 — the real, isolated `tsc` subprocess lane
 * sandboxTestRunner.ts already runs for the standalone "run typecheck" command, wired into the chain as
 * its own distinct stage, never reimplemented) may ever be labeled a real typecheck PASS — that
 * distinction lives entirely in STAGE_LABELS below, so it can't silently drift per call site.
 *
 * A stage's `ok` means "this stage's own gate succeeded, the chain may proceed" (tool-dispatch level) —
 * NOT "the content check's verdict was a match". Fusion review's GREEN/YELLOW/RED/NO_QUORUM verdict is
 * never a chain-stopping condition either way (matching workbenchCommandLoop.ts's own established
 * invariant: Fusion is a reviewer, never a hand, and never blocks a downstream step). Both kinds of
 * verdict go in `detail`, reported honestly, without gating `ok`. A typecheck FAILURE, like a
 * content_check MISMATCH, DOES stop the chain — it's the chain's own integrity check, not a review
 * opinion.
 */

export type RunStageName = 'agent' | 'sandbox_apply' | 'content_check' | 'typecheck' | 'fusion_review' | 'write_receipt';

export interface RunStageReport {
  stage: RunStageName;
  label: string;
  ok: boolean;
  detail: string;
}

export interface WorkbenchRunReport {
  goal: string;
  stages: RunStageReport[];
  // Issue #25 follow-up (Fable QA): the vocabulary is now explicit rather than a bare boolean —
  // 'AWAITING_OWNER_SIGNATURE' (the chain reached write_receipt and it succeeded — a receipt was
  // persisted, but this is still only a PROPOSAL, never a live change) or `FAILED_AT: <stage>` (a stage
  // returned ok:false OR threw — the caller is responsible for turning a throw into a synthetic
  // stageReport() for the stage that was running, via truncateHexRunsForCapture on the message; this
  // module has no fs/network of its own to throw from).
  terminalState: string;
  proposalHash: string | null;
  model: string | null;
  receiptPath: string | null;
  // Report-polish fields (issue #25 follow-up, Fable QA A4) — all optional inputs, all display-only.
  toolCallsSummary: string | null;
  artifactPath: string | null;
  kiraCitations: string[] | null;
  signCommand: string | null;
}

const STAGE_LABELS: Readonly<Record<RunStageName, string>> = {
  agent: 'agent proposal',
  sandbox_apply: 'sandbox apply (temp-only copy, never a live write)',
  content_check: 'content check (simulated sandbox-content match — NOT a real test run)',
  typecheck: 'typecheck (real, isolated tsc subprocess — a real typecheck run)',
  fusion_review: 'fusion review (advisory only — never blocks this chain, any verdict)',
  write_receipt: 'write receipt',
};

// Issue #25 follow-up (Fable QA A4): folds the agent's own exploration tool calls into one aggregate
// line (e.g. "read_file×3, search×1, propose_patch×1") instead of the report only ever itemizing them
// per-round in the surrounding transcript. Structurally typed (no import from nativeToolCallingEngine.ts)
// to keep this module's own dependency surface at zero.
export function summarizeToolCalls(toolCalls: Array<{ tool: string }>): string {
  const counts = new Map<string, number>();
  for (const t of toolCalls) counts.set(t.tool, (counts.get(t.tool) ?? 0) + 1);
  return [...counts.entries()].map(([tool, n]) => `${tool}×${n}`).join(', ');
}

export function stageReport(stage: RunStageName, ok: boolean, detail: string): RunStageReport {
  return { stage, label: STAGE_LABELS[stage], ok, detail };
}

export function buildRunReport(input: {
  goal: string;
  stages: RunStageReport[];
  proposalHash: string | null;
  model: string | null;
  receiptPath: string | null;
  toolCallsSummary?: string | null;
  artifactPath?: string | null;
  kiraCitations?: string[] | null;
  signCommand?: string | null;
}): WorkbenchRunReport {
  const last = input.stages[input.stages.length - 1];
  const complete = !!last && last.stage === 'write_receipt' && last.ok;
  const failedStage = input.stages.find((s) => !s.ok);
  const terminalState = complete ? 'AWAITING_OWNER_SIGNATURE' : `FAILED_AT: ${failedStage?.stage ?? 'unknown'}`;
  return {
    goal: input.goal,
    stages: input.stages,
    terminalState,
    proposalHash: input.proposalHash,
    model: input.model,
    receiptPath: complete ? input.receiptPath : null,
    toolCallsSummary: input.toolCallsSummary ?? null,
    artifactPath: input.artifactPath ?? null,
    kiraCitations: input.kiraCitations ?? null,
    signCommand: complete ? (input.signCommand ?? null) : null,
  };
}

export function formatRunReport(report: WorkbenchRunReport): string {
  const lines: string[] = [`run: ${report.goal}`];
  if (report.model) lines.push(`model: ${report.model}`);
  if (report.toolCallsSummary) lines.push(`tools used: ${report.toolCallsSummary}`);
  if (report.artifactPath) lines.push(`proposal artifact: ${report.artifactPath}`);
  for (const s of report.stages) {
    lines.push(`  [${s.ok ? 'OK' : 'STOPPED'}] ${s.stage} — ${s.label}`);
    if (s.detail) lines.push(`        ${s.detail}`);
  }
  if (report.kiraCitations && report.kiraCitations.length) {
    lines.push(`Kira recall citations (advisory, cited): ${report.kiraCitations.join(', ')}`);
  }
  if (report.terminalState === 'AWAITING_OWNER_SIGNATURE') {
    lines.push(`chain complete — receipt persisted: ${report.receiptPath ?? '(unknown path)'}`);
    lines.push('This is a PROPOSAL, not a live change — nothing was written to the live repo.');
    lines.push(`AWAITING_OWNER_SIGNATURE — to authorize this EXACT proposal, run in your own terminal (never here):\n  ${report.signCommand ?? '(sign command unavailable)'}`);
    lines.push('Not ready to sign? Type "rollback sandbox" to discard the temp sandbox without applying anything.');
  } else {
    lines.push(`${report.terminalState} — no receipt was written. This is a PARTIAL result, not a completed run.`);
  }
  return lines.join('\n');
}
