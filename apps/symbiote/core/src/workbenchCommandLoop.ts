// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Workbench command loop — deterministic (no model, no NLP) text-command parser that maps chat input
 * to Round 1's native tool dispatcher. This file itself never imports fs/child_process/network directly
 * — real subprocess/fs capability is delegated to sandboxTestRunner.ts (bounded test commands),
 * nativeLiveApply.ts (the signed live-apply lane), and workbenchReceiptPersistence.ts (persisting a
 * completed receipt), each with its own narrow, separately-tested surface.
 *
 * Command grammar (deterministic, line-based):
 *   status
 *   map yourself | self map
 *   list files <dir>
 *   read file <relPath>
 *   search <query>
 *   agent: <goal>
 *   run: <goal>
 *   propose patch
 *   goal: <text>
 *   --- file: <relPath>
 *   <content lines...>
 *   --- end
 *   (repeat --- file/--- end blocks for multiple files)
 *   sandbox apply
 *   run sandbox tests
 *   run typecheck
 *   run targeted test <testFile.test.ts>
 *   run full test suite
 *   run fusion review
 *   write receipt
 *   rollback sandbox
 *   apply signed proposal <path-to-signed-receipt.json>
 *
 * "sandbox apply" / "run sandbox tests" / "write receipt" / "rollback sandbox" reuse the MOST RECENT
 * successful propose_patch / sandbox_apply in this session's in-memory state (single local owner,
 * single workbench — no multi-tenant concern). Session state never stores the raw sandbox path outside
 * this in-memory object; it is never serialized back to the browser (only a hash is, matching
 * nativeIdeDispatcher.ts's own discipline for sandbox_apply's public output).
 *
 * "run typecheck" / "run targeted test" / "run full test suite" are a SEPARATE capability
 * (sandboxTestRunner.ts) — the first real subprocess-execution surface in this codebase, kept out of
 * nativeIdeDispatcher.ts on purpose (see that module's own "no subprocess" invariant). "run sandbox
 * tests" stays the Round-1 simulated content-match check; these three run the REAL toolchain (tsc /
 * vitest / scripts/test.sh) against a fresh, isolated temp copy with the proposal overlaid. Either kind
 * of result can populate the receipt's testResult field — whichever ran most recently.
 *
 * "propose patch" also writes a human-reviewable proposal artifact outside the repo and prints the
 * exact terminal command to sign it — signing NEVER happens here or in the browser, only in the
 * owner's own terminal via scripts/aumlok-authority.sh. "apply signed proposal <path>" reads that
 * signed receipt back and calls nativeLiveApply.ts's dispatchSignedLiveApply — the first command in
 * this loop that can write to the LIVE repo, gated entirely by that module's own signature/replay/
 * sacred-path checks (this file adds no additional logic of its own for that gate).
 *
 * "run fusion review" (selfEditReviewCouncil.ts) is the FIRST real network call this loop makes —
 * Fusion Council reviewing this ONE proposal (GREEN/YELLOW/RED + recommendations). Fusion is a
 * reviewer, never a hand: it cannot authorize, sign, apply, or mutate anything, and this command never
 * blocks "apply signed proposal" (or "run:", below) from running regardless of the verdict — the
 * owner decides.
 *
 * "agent: <goal>" (Round 2, issue #22) is the SECOND real network call this loop makes, and the first
 * one where the MODEL — not the owner — drives the exploration: it runs nativeToolCallingEngine.ts's
 * runNativeAgent(), which lets the model call its own status/self_map/list_files/read_file/search tools
 * (never sandbox_apply/run_tests/write_receipt/rollback_sandbox — those stay withheld from the model
 * always; this loop's OWNER-typed commands are the only thing that ever drives them) and terminates the
 * instant it calls propose_patch once. On a successful proposal this command does EXACTLY what "propose
 * patch" does afterward (write the artifact, set session.lastProposal, print sign instructions) — every
 * downstream command (sandbox apply / run sandbox tests / run fusion review / write receipt / apply
 * signed proposal) is unchanged and works identically regardless of whether the proposal came from the
 * owner typing it or the model proposing it herself.
 *
 * "run: <goal>" (Round 5, issue #25; typecheck stage added Round 6, issue #34) is a single command that
 * chains agent -> sandbox apply -> content check -> typecheck -> fusion review -> write receipt, stopping
 * honestly at the first stage that doesn't succeed and reporting exactly how far it got
 * (workbenchRunReport.ts). It is built ENTIRELY from the same stage helpers the standalone commands above
 * call — same code path, same behavior, just sequenced. It never calls "apply signed proposal": live-apply
 * requires a signature produced in the owner's own terminal, which cannot exist before this chain has even
 * produced a proposal, so "run:" always stops at a printed proposal + sign instructions, exactly like
 * "agent:" does today. A receipt is persisted to disk (workbenchReceiptPersistence.ts) if and ONLY if
 * every stage through write_receipt succeeded — never for a partial or failed run. Both content_check
 * (a simulated mismatch) and typecheck (a real tsc failure) stop the chain as its own integrity check;
 * Fusion's verdict never does, at any stage, matching this file's existing "reviewer, never a hand"
 * invariant.
 */
import { dispatchIdeToolWithState } from './nativeIdeDispatcher';
import type { IdeToolName, IdeToolResult } from './ideToolContract';
import { runSandboxTestCommand, type AllowedTestCommand } from './sandboxTestRunner';
import { buildSelfEditProposalArtifact, writeSelfEditProposalArtifact, withdrawSelfEditProposalArtifact, readPendingProposalByHash } from './selfEditProposalArtifact';
import {
  buildProposalIntent, writeProposalIntent, readProposalIntentById, buildAgentGoalFromIntent,
  type AffectedPath, type EpistemicStatus, type ProposalIntentInput, type ProposalIntentV1,
} from './proposalIntent';
import { dispatchSignedLiveApply, readSignedPromotionReceiptFromFile } from './nativeLiveApply';
import { reviewSelfEditProposal, formatSelfEditReviewSummary } from './selfEditReviewCouncil';
// Great Merge round 1 (issue #178, Fusion lane): the council's verdict travels WITH the proposal —
// a bounded advisory sidecar keyed by proposalHash, for the signing surface to read. Evidence
// plumbing only; the apply lane never reads it and no verdict gates anything.
import { buildProposalFusionAdvisory, writeProposalFusionAdvisory } from './proposalFusionAdvisory';
// #178 round 3 (Fusion lane): seat-ledger phase 1 — every completed review also appends one
// append-only evidence row PER SEAT (who voted what, against which quorum, phase-lock flagged).
// Evidence about advisors, recorded beside the review; nothing reads it to gate or weight anything.
import { buildSeatLedgerRows, appendSeatLedgerRows, joinOwnerDecisions } from './fusionSeatLedger';
import { runNativeAgent } from './nativeToolCallingEngine';
import { WombMemoryStore, type WombMemoryKind } from './wombMemory';
import { captureWithReceipt } from './wombMemoryReceiptChain';
import { loadBrainState, saveBrainState, defaultKiraStatePath } from './kiraBrain';
import { truncateHexRunsForCapture } from './hexTruncation';
import { persistWorkbenchReceipt } from './workbenchReceiptPersistence';
import { stageReport, buildRunReport, formatRunReport, summarizeToolCalls, type RunStageReport, type RunStageName } from './workbenchRunReport';
import { buildEvidencePacketFromRunReport, buildDraftEvidencePacket, formatEvidencePacketForChat } from './workbenchEvidencePacket';
import { computeProposalShrinks, defaultRepoRoot } from './fileShrink';
import { buildStateDigest } from './stateDigest';
import type { RecursiveIdeRehearsalReceiptV1 } from './recursiveIdeRehearsalReceipt';

export interface WorkbenchSessionState {
  toolCallsUsed: string[];
  lastProposal: { goal: string; files: Array<{ relPath: string; content: string }>; proposalHash: string } | null;
  lastSandboxPath: string | null;
  lastTestResult: { passed: boolean; ran: string[]; detail: string } | null;
  // Round 3 (issue #23): captureWithReceipt's in-memory half. Kira's own persisted state is loaded/saved
  // fresh around each capture (never held open across commands) — only the womb-store index needs to
  // live for the session's duration. Advisory-only, same as everything else in this store: it records
  // that events happened, it never influences what a later command is allowed to do.
  wombStore: WombMemoryStore;
}

export function freshWorkbenchSession(): WorkbenchSessionState {
  return { toolCallsUsed: [], lastProposal: null, lastSandboxPath: null, lastTestResult: null, wombStore: new WombMemoryStore() };
}

// Issue #25 follow-up (Fable QA): kiraBrain's sanitizeText() fail-closes on any 40+/64+ hex-char run as
// secret-shaped content (sha256/sha1 hashes, commit shas, ...). Round 5's per-call-site summarizer
// (summarizeReceiptForCapture, below) and issue #37's stateDigest.ts already truncate the hashes THEY
// know about — this is the belt-on-top-of-braces version, applied ONCE at the chokepoint so every
// current AND future call site is protected, including free-text content (a fusion review's findings,
// a proposal goal) that could incidentally quote a full hash. Does NOT touch kiraBrain.ts's guard
// itself — that stays exactly as strict as it is; this only keeps advisory summaries under it.
// Extracted to core/src/hexTruncation.ts (issue #54) so the flight recorder shares ONE definition
// rather than copying it — this file's history already documents two duplication-drift incidents.

// Round 3 (issue #23): "proposal/review/apply events land in Kira's chain — memory finally learns
// from receipts." Best-effort and advisory-only by construction: loads the real persisted Kira state,
// captures via the already-tested captureWithReceipt (wombMemory.ts + kiraBrain.ts wiring), saves it
// back. Never throws into the caller — a memory-capture failure must never block or fail the actual
// gated pipeline step it's attached to.
//
// Issue #25 follow-up (Fable QA): the catch used to be bare — a real capture failure (the exact
// hex-secret-shape guard above, before this fix existed) hid silently for two rounds (#23 through #25)
// because "advisory, never fail the command" was implemented as "advisory, never SURFACE either." Those
// are not the same thing. A capture failure now pushes a visible (but still non-fatal) transcript entry.
// Issue #37: opts.tags is generic, threaded straight through to captureWithReceipt (which already
// accepted tags — this chokepoint just never forwarded them). Not a digest-specific parameter: any
// future capture site (the #42/#43 approval-gate work) reuses this same plumbing.
function captureWorkbenchEvent(entries: WorkbenchTranscriptEntry[], session: WorkbenchSessionState, kind: WombMemoryKind, title: string, content: string, source: string, opts?: { tags?: string[] }): void {
  try {
    const statePath = defaultKiraStatePath();
    const kiraState = loadBrainState(statePath);
    const result = captureWithReceipt(session.wombStore, kiraState, kind, title, truncateHexRunsForCapture(content), source, { tags: opts?.tags });
    saveBrainState(statePath, result.kiraState);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    entries.push({ kind: 'info', text: `kira capture failed (advisory): ${truncateHexRunsForCapture(msg).slice(0, 300)}` });
  }
}

// Both receipt shapes below carry 64-char sha256 hex fields (proposalHash, receiptHash, ...) — passing
// them raw (e.g. via JSON.stringify) as Kira capture `content` trips kiraBrain.ts's sanitizeText()
// secret-shaped-hex-string guard and throws, silently swallowed by captureWorkbenchEvent's catch (see
// issue #25). Truncated hash prefixes (well under the 64-char threshold) keep the capture traceable
// without re-embedding the full hash.
function summarizeReceiptForCapture(receipt: RecursiveIdeRehearsalReceiptV1): string {
  return `task=${receipt.task} targetFiles=${receipt.targetFiles.join(', ')} testResult.passed=${receipt.testResult.passed} proposalHash=${receipt.proposalHash.slice(0, 16)}... appliedLive=${receipt.appliedLive}`;
}

export interface WorkbenchTranscriptEntry {
  kind: 'command' | 'tool_call' | 'tool_result' | 'info' | 'error';
  text: string;
  tool?: IdeToolName;
  result?: IdeToolResult;
}

function call(session: WorkbenchSessionState, tool: IdeToolName, args: Record<string, unknown>) {
  const dispatched = dispatchIdeToolWithState({ tool, args });
  session.toolCallsUsed.push(tool);
  return dispatched;
}

function emitToolResult(entries: WorkbenchTranscriptEntry[], tool: IdeToolName, d: { result: IdeToolResult; rawSandboxPath?: string }) {
  entries.push({ kind: 'tool_call', text: `dispatchIdeTool(${tool})`, tool });
  entries.push({ kind: 'tool_result', text: JSON.stringify(d.result.output ?? d.result.reason ?? null), tool, result: d.result });
  return d;
}

function parseProposePatchBlock(lines: string[]): { goal: string; files: Array<{ relPath: string; content: string }> } | { error: string } {
  let goal = '';
  const files: Array<{ relPath: string; content: string }> = [];
  let i = 0;
  const goalLine = lines.find((l) => /^goal:\s*/i.test(l.trim()));
  if (goalLine) goal = goalLine.trim().replace(/^goal:\s*/i, '');
  while (i < lines.length) {
    const m = lines[i].trim().match(/^---\s*file:\s*(.+)$/i);
    if (m) {
      const relPath = m[1].trim();
      const content: string[] = [];
      i++;
      while (i < lines.length && !/^---\s*end\s*$/i.test(lines[i].trim())) { content.push(lines[i]); i++; }
      if (i >= lines.length) return { error: `unterminated file block for ${relPath} — missing "--- end"` };
      files.push({ relPath, content: content.join('\n') });
      i++; // consume the --- end line
      continue;
    }
    i++;
  }
  if (!goal) return { error: 'propose patch requires a "goal: <text>" line' };
  if (!files.length) return { error: 'propose patch requires at least one "--- file: <relPath>" ... "--- end" block' };
  return { goal, files };
}

// #35: parse a `draft intent:` block into a proposal-intent input. Labeled lines only — goal/rationale/risk
// and one or more `path: <relPath> [<epistemicStatus>] <note?>`. An unlabeled/typo status collapses to
// `unknown` (the honest default — never silently upgraded to a fact). This authors an ADVISORY intent; it
// writes nothing to the repo, hashes no real file content, and grants no authority.
function parseDraftIntentBlock(lines: string[]): ProposalIntentInput | { error: string } {
  let goal = '';
  let rationale = '';
  let riskNotes = '';
  const affectedPaths: AffectedPath[] = [];
  const EP: ReadonlySet<string> = new Set(['verified', 'inferred', 'owner_stated', 'unknown']);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^goal:\s*(.+)$/i))) { goal = m[1].trim(); continue; }
    if ((m = line.match(/^rationale:\s*(.+)$/i))) { rationale = m[1].trim(); continue; }
    if ((m = line.match(/^risk:\s*(.+)$/i))) { riskNotes = m[1].trim(); continue; }
    if ((m = line.match(/^path:\s*(\S+)\s*(?:\[([a-z_]+)\])?\s*(.*)$/i))) {
      const statusRaw = (m[2] || 'unknown').toLowerCase();
      const epistemicStatus = (EP.has(statusRaw) ? statusRaw : 'unknown') as EpistemicStatus;
      const note = m[3]?.trim();
      affectedPaths.push({ path: m[1].trim(), epistemicStatus, ...(note ? { note } : {}) });
      continue;
    }
    // any other line is ignored (lenient) — the goal + at least one path are what's required below.
  }
  if (!goal) return { error: 'draft intent requires a "goal: <text>" line' };
  if (!affectedPaths.length) return { error: 'draft intent requires at least one "path: <relPath> [verified|inferred|owner_stated|unknown]" line' };
  return { goal, rationale, riskNotes, affectedPaths, authoredBy: 'owner' };
}

// #35: detect + resolve `agent:/run: --from-proposal <id>`. Loads the stored intent by its 64-hex id (no
// path/traversal accepted), and turns it into a native-agent goal that RE-READS the real files — the intent
// is never trusted as content. Returns null when the goal is a normal freeform goal (not a from-proposal).
function resolveFromProposal(goal: string):
  | { kind: 'not-from-proposal' }
  | { kind: 'error'; error: string }
  | { kind: 'ok'; agentGoal: string; intentId: string; intent: ProposalIntentV1 } {
  const m = goal.match(/^--from-proposal\s+(\S+)\s*$/i);
  if (!m) return { kind: 'not-from-proposal' };
  const read = readProposalIntentById(m[1].trim());
  if (!read.ok) return { kind: 'error', error: `--from-proposal: ${read.reason}` };
  return { kind: 'ok', agentGoal: buildAgentGoalFromIntent(read.intent), intentId: read.intent.intentId, intent: read.intent };
}

const HELP_TEXT = [
  'Commands: status | map yourself | list files <dir> | read file <relPath> | search <query>',
  'agent: <goal>  (the model explores with her own tools, then proposes ONE patch herself — same',
  '  downstream flow as "propose patch" below: sandbox apply / run fusion review / write receipt)',
  'run: <goal>  (chains agent -> sandbox apply -> content check -> typecheck -> fusion review -> write receipt in',
  '  one shot, stopping honestly at the first stage that fails; see the report it prints for exactly',
  '  how far it got. Never applies live — same sign-it-yourself instructions as "agent:" above.)',
  'propose patch (multi-line — see below) | sandbox apply | run sandbox tests | write receipt | rollback sandbox',
  'run typecheck | run targeted test <file.test.ts> | run full test suite  (real, isolated subprocess runs)',
  'run fusion review  (real Fusion Council opinion on the current proposal — GREEN/YELLOW/RED, reviewer only)',
  'apply signed proposal <path-to-signed-receipt.json>  (the ONLY command that can write to the live repo —',
  '  requires a signature you produced yourself via scripts/aumlok-authority.sh sign, in your own terminal)',
  '',
  'Propose-patch syntax:',
  '  propose patch',
  '  goal: <what this change does>',
  '  --- file: <relPath>',
  '  <full new file content>',
  '  --- end',
  '  (repeat --- file / --- end for more files)',
].join('\n');

function runRealTestCommand(command: AllowedTestCommand, testFile: string | undefined, session: WorkbenchSessionState, entries: WorkbenchTranscriptEntry[]): void {
  if (!session.lastProposal) { entries.push({ kind: 'error', text: 'no proposal yet — run "propose patch" first' }); return; }
  entries.push({ kind: 'tool_call', text: `runSandboxTestCommand(${command}${testFile ? ' ' + testFile : ''})` });
  const r = runSandboxTestCommand({ command, testFile, files: session.lastProposal.files });
  session.toolCallsUsed.push(`sandbox_test_${command}`);
  const summary = `ok=${r.ok} exitCode=${r.exitCode} timedOut=${r.timedOut} durationMs=${r.durationMs} ran="${r.resolvedArgv}"`;
  entries.push({ kind: 'tool_result', text: (r.ok ? 'OK  ' : 'REFUSED/FAILED  ') + summary + (r.outputExcerpt ? `\n${r.outputExcerpt.slice(0, 1500)}` : '') });
  session.lastTestResult = {
    passed: r.ok,
    ran: [r.resolvedArgv],
    // On FAILURE the output excerpt rides along (capped): it holds the actual tsc/vitest error
    // lines, which is what extractFailureEvidence (Brick 3.1) parses into file:line + message.
    // Found live 2026-07-08: a failed typecheck's evidence said only "ok=false exitCode=2" —
    // metadata, no defect — because the excerpt stopped at the transcript entry and never
    // reached the stage detail the evidence packet reads.
    detail: `${summary}${r.truncated ? ' (output truncated)' : ''}${!r.ok && r.outputExcerpt ? `\n${r.outputExcerpt.slice(0, 1200)}` : ''}`,
  };
}

// ── Stage helpers (issue #25) — each wraps exactly one branch's real logic, unchanged from the
// standalone command it was extracted from. Both the standalone commands below AND "run:" call these
// same functions, so there is only ever one implementation of what each stage does. ──

async function stageAgent(session: WorkbenchSessionState, goal: string, entries: WorkbenchTranscriptEntry[]): Promise<{
  ok: boolean; report: RunStageReport; model: string | null; artifactPath: string | null; toolCallsSummary: string | null; signCommand: string | null;
}> {
  entries.push({ kind: 'tool_call', text: `runNativeAgent(${JSON.stringify(goal)})` });
  const run = await runNativeAgent(goal);
  session.toolCallsUsed.push(...run.toolCalls.map((t) => t.tool));
  for (const t of run.toolCalls) {
    entries.push({ kind: 'tool_result', text: `  [round ${t.round}] ${t.tool} -> ${t.ok ? 'ok' : `refused (${t.reason ?? 'no reason given'})`}` });
  }
  // Issue #25 follow-up (Fable QA A4): the report's "tools used" line — the agent's OWN exploration
  // calls (status/self_map/list_files/read_file/search/propose_patch), not the whole chain's dispatcher
  // calls (those are already itemized per-stage in the report body).
  const toolCallsSummary = summarizeToolCalls(run.toolCalls);
  if (run.stoppedReason !== 'proposed_patch' || !run.candidateFiles || !run.proposalHash) {
    const detail = `agent did not produce a proposal — stoppedReason=${run.stoppedReason} after ${run.rounds} round(s)`;
    entries.push({ kind: 'error', text: detail });
    return { ok: false, report: stageReport('agent', false, detail), model: run.model, artifactPath: null, toolCallsSummary, signCommand: null };
  }
  const goalText = run.proposedGoal ?? goal;
  const files = run.candidateFiles;
  session.lastProposal = { goal: goalText, files, proposalHash: run.proposalHash };
  session.lastSandboxPath = null;
  session.lastTestResult = null;
  // Same artifact-write + sign-instructions behavior as "propose patch" below — downstream stages/
  // commands don't know or care whether the proposal came from the owner typing it or the model
  // proposing it herself.
  const artifact = buildSelfEditProposalArtifact(goalText, files);
  const artifactPath = writeSelfEditProposalArtifact(artifact);
  const signCommand = `bash scripts/aumlok-authority.sh sign ${artifactPath} > /tmp/signed-${run.proposalHash.slice(0, 12)}.json\n  Then: apply signed proposal /tmp/signed-${run.proposalHash.slice(0, 12)}.json`;
  captureWorkbenchEvent(entries, session, 'code', goalText, files.map((f) => f.relPath).join(', '), 'workbench_agent_propose');
  entries.push({
    kind: 'info',
    text: `Aukora proposed a patch herself (${run.rounds} round(s), ${run.toolCalls.length} tool call(s)).\nProposal artifact written -> ${artifactPath}\nTo authorize this EXACT proposal for live apply, run in your own terminal (never here):\n  ${signCommand}`,
  });
  return { ok: true, report: stageReport('agent', true, `model=${run.model} proposalHash=${run.proposalHash.slice(0, 16)}...`), model: run.model, artifactPath, toolCallsSummary, signCommand };
}

function stageSandboxApply(session: WorkbenchSessionState, entries: WorkbenchTranscriptEntry[]): { ok: boolean; report: RunStageReport } {
  if (!session.lastProposal) {
    const detail = 'no proposal yet — run "propose patch" first';
    entries.push({ kind: 'error', text: detail });
    return { ok: false, report: stageReport('sandbox_apply', false, detail) };
  }
  const d = call(session, 'sandbox_apply', { goal: session.lastProposal.goal, files: session.lastProposal.files, proposalHash: session.lastProposal.proposalHash });
  emitToolResult(entries, 'sandbox_apply', d);
  if (d.result.ok && d.rawSandboxPath) session.lastSandboxPath = d.rawSandboxPath;
  const detail = d.result.ok ? 'temp-only sandbox created' : `refused: ${d.result.reason ?? 'unknown'}`;
  return { ok: d.result.ok, report: stageReport('sandbox_apply', d.result.ok, detail) };
}

function stageContentCheck(session: WorkbenchSessionState, entries: WorkbenchTranscriptEntry[]): { ok: boolean; report: RunStageReport } {
  if (!session.lastProposal || !session.lastSandboxPath) {
    const detail = 'no sandbox to test — run "propose patch" then "sandbox apply" first';
    entries.push({ kind: 'error', text: detail });
    return { ok: false, report: stageReport('content_check', false, detail) };
  }
  const d = call(session, 'run_tests', { sandboxPath: session.lastSandboxPath, files: session.lastProposal.files });
  emitToolResult(entries, 'run_tests', d);
  if (d.result.ok) session.lastTestResult = d.result.output as WorkbenchSessionState['lastTestResult'];
  // Fable's ruling (issue #25 follow-up): unlike Fusion's verdict (never gates, any stage, any chain —
  // reviewer, never a hand), a content MISMATCH here is the CHAIN'S OWN integrity check: the
  // sandbox-applied content doesn't match what was actually proposed — an apply anomaly, not a review
  // opinion. Continuing would spend real Fusion money reviewing a patch that isn't the one the agent
  // proposed. So `ok` reflects BOTH dispatch success AND a content match; either a refused dispatch OR a
  // mismatch stops the "run:" chain. The standalone "run sandbox tests" command ignores this return
  // value entirely (see its dispatch below) — unaffected by this change.
  const matched = d.result.ok && !!session.lastTestResult?.passed;
  const detail = !d.result.ok
    ? `refused: ${d.result.reason ?? 'unknown'}`
    : `content match: ${matched ? 'MATCH' : 'MISMATCH'} — ${session.lastTestResult?.detail ?? ''}`;
  return { ok: matched, report: stageReport('content_check', matched, detail) };
}

// Issue #34/Round 6: the real, isolated `tsc` subprocess lane runRealTestCommand() already runs for the
// standalone "run typecheck" command — this is a stage helper wrapping that SAME function (never
// reimplemented), so "run:" gets a real check, distinct from content_check's simulated one. A typecheck
// FAILURE stops the chain — the chain's own integrity check, same reasoning as content_check's MISMATCH,
// not a review opinion (Fusion's verdict still never gates anything).
function stageTypecheck(session: WorkbenchSessionState, entries: WorkbenchTranscriptEntry[]): { ok: boolean; report: RunStageReport } {
  if (!session.lastProposal) {
    const detail = 'no proposal yet — run "propose patch" first';
    entries.push({ kind: 'error', text: detail });
    return { ok: false, report: stageReport('typecheck', false, detail) };
  }
  runRealTestCommand('typecheck', undefined, session, entries);
  const passed = !!session.lastTestResult?.passed;
  const detail = `real typecheck ${passed ? 'PASSED' : 'FAILED'} — ${session.lastTestResult?.detail ?? 'unknown'}`;
  return { ok: passed, report: stageReport('typecheck', passed, detail) };
}

async function stageFusionReview(session: WorkbenchSessionState, entries: WorkbenchTranscriptEntry[]): Promise<{ ok: boolean; report: RunStageReport; kiraCitations: string[] | null }> {
  if (!session.lastProposal) {
    const detail = 'no proposal yet — run "propose patch" first';
    entries.push({ kind: 'error', text: detail });
    return { ok: false, report: stageReport('fusion_review', false, detail), kiraCitations: null };
  }
  entries.push({ kind: 'tool_call', text: 'reviewSelfEditProposal(...)' });
  const testResult = session.lastTestResult ?? { passed: false, ran: [], detail: 'no test has been run yet this session' };
  const review = await reviewSelfEditProposal({ goal: session.lastProposal.goal, files: session.lastProposal.files, testResult });
  session.toolCallsUsed.push('fusion_review');
  const formatted = formatSelfEditReviewSummary(review);
  // Advisory-only capture of the review OUTCOME (never the verdict influencing later stages — that's
  // the pinned invariant below; this only grows Kira's read-only recall history).
  captureWorkbenchEvent(entries, session, 'fusion', session.lastProposal.goal, formatted, 'workbench_fusion_review');
  entries.push({ kind: 'tool_result', text: formatted });
  // The verdict travels WITH the proposal (#178 round 1): persist a bounded advisory sidecar keyed
  // by proposalHash so the signing surface can show the council's reading at the decision moment.
  // Best-effort and fail-closed: an invalid advisory is refused (not written), and a failed write
  // never affects the review result — same "reviewer, never a hand" invariant as the verdict itself.
  const sidecar = writeProposalFusionAdvisory(buildProposalFusionAdvisory({ proposalHash: session.lastProposal.proposalHash, review }));
  entries.push({
    kind: 'tool_result',
    text: sidecar.ok
      ? `fusion advisory sidecar -> ${sidecar.path} (advisory only, grants no authority; the signer may read it, the apply lane never does)`
      : `fusion advisory sidecar NOT written: ${sidecar.reason} (review outcome unaffected)`,
  });
  // Seat-ledger phase 1 (#178 round 3): record one evidence row per seat. Best-effort, same
  // invariant as the sidecar — a refused/failed append never affects the review result.
  const ledger = appendSeatLedgerRows(buildSeatLedgerRows({ review, runKind: 'proposal-review', key: session.lastProposal.proposalHash }));
  entries.push({
    kind: 'tool_result',
    text: ledger.ok
      ? `seat ledger: ${ledger.appended} row(s) -> ${ledger.path} (advisory evidence about the council, grants no authority)`
      : `seat ledger NOT appended: ${ledger.reason} (review outcome unaffected)`,
  });
  // Owner-decision join (#178 round 4): opportunistic backfill — every council use also refreshes
  // "did the owner sign it" evidence from the applied-proposal ledger (read-only over signed facts;
  // an unsigned proposal stays unknown, never a rejection). Best-effort, same never-gates invariant.
  const join = joinOwnerDecisions();
  entries.push({
    kind: 'tool_result',
    text: join.ok
      ? `owner-decision join: ${join.appended} new, ${join.alreadyJoined} already joined, ${join.unmatchedApplied} applied-without-review (advisory evidence, grants no authority)`
      : `owner-decision join refused: ${join.reason} (review outcome unaffected)`,
  });
  // Issue #25 follow-up (Fable QA A4): surface the SAME Kira citations formatSelfEditReviewSummary
  // already prints inline — the report block was omitting them even though the data existed.
  const kiraCitations = review.kiraRecall && review.kiraRecall.hits.length ? review.kiraRecall.hits.slice(0, 3).map((h) => h.citation) : null;
  // ok=true whenever the review itself completed (didn't throw) — Fusion NEVER gates this chain,
  // regardless of verdict (GREEN/YELLOW/RED/NO_QUORUM). The verdict is reported honestly in `detail`.
  return { ok: true, report: stageReport('fusion_review', true, `verdict=${review.overallVerdict}`), kiraCitations };
}

function stageWriteReceipt(session: WorkbenchSessionState, entries: WorkbenchTranscriptEntry[]): { ok: boolean; report: RunStageReport; receiptPath: string | null } {
  if (!session.lastProposal || !session.lastSandboxPath) {
    const detail = 'nothing to receipt — run "propose patch" then "sandbox apply" first';
    entries.push({ kind: 'error', text: detail });
    return { ok: false, report: stageReport('write_receipt', false, detail), receiptPath: null };
  }
  const d = call(session, 'write_receipt', {
    task: session.lastProposal.goal,
    toolCallsUsed: [...session.toolCallsUsed],
    targetFiles: session.lastProposal.files.map((f) => f.relPath),
    proposalHash: session.lastProposal.proposalHash,
    sandboxPath: session.lastSandboxPath,
    testResult: session.lastTestResult ?? { passed: false, ran: [], detail: 'run_tests was never called this session' },
  });
  emitToolResult(entries, 'write_receipt', d);
  if (!d.result.ok) {
    return { ok: false, report: stageReport('write_receipt', false, `refused: ${d.result.reason ?? 'unknown'}`), receiptPath: null };
  }
  const receipt = (d.result.output as { receipt: RecursiveIdeRehearsalReceiptV1 }).receipt;
  const receiptPath = persistWorkbenchReceipt(receipt);
  // Round 3 (issue #23) wired captureWorkbenchEvent into 4 of 5 branches and left this one gap —
  // Round 5 (issue #25) closes it, matching every other governed step in this file. The content is a
  // SUMMARY, not JSON.stringify(receipt): the raw receipt embeds two 64-char sha256 hex fields
  // (proposalHash, receiptHash), and kiraBrain.ts's sanitizeText() refuses (throws) any text containing
  // a 64+ hex-char run as secret-shaped — a real, silent capture failure this exact call would have hit
  // otherwise (caught here while building this fix; see the identical fix at the live-apply branch below).
  captureWorkbenchEvent(entries, session, 'receipt', session.lastProposal.goal, summarizeReceiptForCapture(receipt), 'workbench_write_receipt');
  entries.push({ kind: 'info', text: `Receipt persisted -> ${receiptPath}` });
  return { ok: true, report: stageReport('write_receipt', true, `persisted -> ${receiptPath}`), receiptPath };
}

/** Run ONE chat turn against the session. Deterministic parsing only — no free-form fs/shell. Async only
 *  because "run fusion review"/"agent:"/"run:" make real network calls; every other command resolves
 *  synchronously. */
export async function runWorkbenchCommand(input: string, session: WorkbenchSessionState): Promise<WorkbenchTranscriptEntry[]> {
  const trimmed = input.trim();
  const lines = input.split('\n');
  const first = trimmed.split('\n')[0].trim().toLowerCase();
  const entries: WorkbenchTranscriptEntry[] = [{ kind: 'command', text: input }];

  if (!trimmed) { entries.push({ kind: 'info', text: HELP_TEXT }); return entries; }

  if (first === 'help' || first === '?') { entries.push({ kind: 'info', text: HELP_TEXT }); return entries; }

  if (first === 'status') { emitToolResult(entries, 'status', call(session, 'status', {})); return entries; }

  if (first === 'map yourself' || first === 'self map' || first === 'map self') {
    emitToolResult(entries, 'self_map', call(session, 'self_map', {})); return entries;
  }

  {
    const m = trimmed.match(/^list files\s+(.+)$/i);
    if (m) { emitToolResult(entries, 'list_files', call(session, 'list_files', { dir: m[1].trim() })); return entries; }
  }

  {
    const m = trimmed.match(/^read file\s+(.+)$/i);
    if (m) { emitToolResult(entries, 'read_file', call(session, 'read_file', { relPath: m[1].trim() })); return entries; }
  }

  {
    const m = trimmed.match(/^search\s+(.+)$/is);
    if (m) { emitToolResult(entries, 'search', call(session, 'search', { query: m[1].trim() })); return entries; }
  }

  {
    const m = trimmed.match(/^agent:\s*(.+)$/is);
    if (m) {
      let goal = m[1].trim();
      if (!goal) { entries.push({ kind: 'error', text: 'agent: requires a goal, e.g. "agent: add a one-line clarifying comment to core/src/restingGlyph.ts" — or "agent: --from-proposal <intent-id>"' }); return entries; }
      const fromProposal = resolveFromProposal(goal); // #35: ingest a proposal-intent by id
      if (fromProposal.kind === 'error') { entries.push({ kind: 'error', text: fromProposal.error }); return entries; }
      if (fromProposal.kind === 'ok') {
        entries.push({ kind: 'info', text: `Ingesting proposal-intent ${fromProposal.intentId.slice(0, 12)}… — the agent will RE-READ the real files; the intent's paths/snippets are advisory hints (epistemic-labelled), never trusted as content.` });
        goal = fromProposal.agentGoal;
      }
      const agentStage = await stageAgent(session, goal, entries);
      // Auto fusion review (#178 round 1): env opt-in ONLY — default OFF, landing arms nothing.
      // When armed, a successful standalone `agent:` draft gets the council's advisory reading
      // automatically (the `run:` chain already reviews; this closes the bare-draft gap, which is
      // exactly where the future auto-drain daemon originates proposals with no human at the REPL).
      // Same pinned invariant as the manual stage: the verdict NEVER gates; the owner still signs.
      if (agentStage.ok && process.env.AUKORA_AUTO_FUSION_REVIEW === '1') {
        entries.push({ kind: 'info', text: 'auto fusion review (AUKORA_AUTO_FUSION_REVIEW=1): the council reads this fresh draft — advisory only, never gates, the AUMLOK signature remains the only authority.' });
        await stageFusionReview(session, entries);
      }
      return entries;
    }
  }

  {
    const m = trimmed.match(/^run:\s*(.+)$/is);
    if (m) {
      const rawGoal = m[1].trim();
      if (!rawGoal) { entries.push({ kind: 'error', text: 'run: requires a goal, e.g. "run: add a one-line clarifying comment to core/src/restingGlyph.ts" — or "run: --from-proposal <intent-id>"' }); return entries; }
      const fromProposal = resolveFromProposal(rawGoal); // #35: ingest a proposal-intent by id
      if (fromProposal.kind === 'error') { entries.push({ kind: 'error', text: fromProposal.error }); return entries; }
      // `goal` = short label for the report; `agentGoal` = the full prompt the agent explores from (which
      // re-reads real files). For a normal freeform run they are identical.
      const goal = fromProposal.kind === 'ok' ? fromProposal.intent.goal : rawGoal;
      const agentGoal = fromProposal.kind === 'ok' ? fromProposal.agentGoal : rawGoal;
      const fromIntentId = fromProposal.kind === 'ok' ? fromProposal.intentId : null;
      if (fromProposal.kind === 'ok') entries.push({ kind: 'info', text: `Ingesting proposal-intent ${fromProposal.intentId.slice(0, 12)}… — RE-reading real files; the intent's paths/snippets are advisory hints, never trusted as content.` });

      const stages: RunStageReport[] = [];
      let model: string | null = null;
      let receiptPath: string | null = null;
      let toolCallsSummary: string | null = null;
      let artifactPath: string | null = null;
      let signCommand: string | null = null;
      let kiraCitations: string[] | null = null;
      const finish = () => {
        // Gate-safety (found live 2026-07-08): the proposal artifact is written at the AGENT stage, so a
        // chain that later fails (typecheck, content check) used to leave a signable-looking artifact in
        // pending-proposals — the gate offered a typecheck-FAILED change for signature with a riskHint
        // claiming its checks "already ran". A failed chain now WITHDRAWS its artifact into archive/
        // (never deleted — the evidence trail stays); only a chain that reached its receipt leaves a
        // signable artifact at the gate. Best-effort: a failed move never masks the real failure report.
        const failed = stages.some((s) => !s.ok);
        if (failed && artifactPath) {
          const withdrawn = withdrawSelfEditProposalArtifact(artifactPath);
          if (withdrawn.ok) {
            entries.push({ kind: 'info', text: `proposal artifact WITHDRAWN (chain failed before its receipt) — archived, not signable: ${withdrawn.archivedPath}` });
            artifactPath = withdrawn.archivedPath;
          } // a failed move never masks the FAILED_AT report below — that report is the authoritative truth
        }
        const report = buildRunReport({ goal, stages, proposalHash: session.lastProposal?.proposalHash ?? null, model, receiptPath, toolCallsSummary, artifactPath, signCommand, kiraCitations });
        entries.push({ kind: 'info', text: formatRunReport(report) });
        // #51: frame the run as a redacted, honesty-checked evidence packet the chat lane returns to Auma —
        // evidence, never authority; appliedLive:false; no false "landed" language. #91: compute the
        // file-shrink verdicts here (fs read) and pass them in, so the packet stays pure but chat still
        // sees a run-time truncation warning — the same check the sign-time assistant does.
        const fileShrinks = session.lastProposal ? computeProposalShrinks(defaultRepoRoot(), session.lastProposal.files) : [];
        const packet = buildEvidencePacketFromRunReport(report, { intentId: fromIntentId, fileShrinks });
        entries.push({ kind: 'info', text: formatEvidencePacketForChat(packet) });
        return entries;
      };

      // Issue #25 follow-up (Fable QA A3): a throw from ANY stage (fs error in persistWorkbenchReceipt,
      // an artifact-write failure, anything) used to escape this handler uncaught — the owner got NO
      // report at all, breaking the "reports exactly how far it got" promise. currentStage tracks which
      // stage is running so a throw still produces a truthful, hex-sanitized FAILED_AT report instead of
      // an unhandled rejection.
      let currentStage: RunStageName = 'agent';
      try {
        const agentStage = await stageAgent(session, agentGoal, entries);
        stages.push(agentStage.report);
        model = agentStage.model;
        toolCallsSummary = agentStage.toolCallsSummary;
        artifactPath = agentStage.artifactPath;
        signCommand = agentStage.signCommand;
        if (!agentStage.ok) return finish();

        currentStage = 'sandbox_apply';
        const applyStage = stageSandboxApply(session, entries);
        stages.push(applyStage.report);
        if (!applyStage.ok) return finish();

        currentStage = 'content_check';
        const checkStage = stageContentCheck(session, entries);
        stages.push(checkStage.report);
        if (!checkStage.ok) return finish();

        currentStage = 'typecheck';
        const typecheckStage = stageTypecheck(session, entries);
        stages.push(typecheckStage.report);
        if (!typecheckStage.ok) return finish();

        currentStage = 'fusion_review';
        const reviewStage = await stageFusionReview(session, entries);
        stages.push(reviewStage.report);
        kiraCitations = reviewStage.kiraCitations;
        if (!reviewStage.ok) return finish();

        currentStage = 'write_receipt';
        const receiptStage = stageWriteReceipt(session, entries);
        stages.push(receiptStage.report);
        receiptPath = receiptStage.receiptPath;
        return finish();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        stages.push(stageReport(currentStage, false, `threw: ${truncateHexRunsForCapture(msg).slice(0, 300)}`));
        return finish();
      }
    }
  }

  if (first === 'draft intent:' || first === 'draft intent') {
    // #35: author an ADVISORY proposal-intent from chat/voice. Writes NO repo files, hashes no real
    // content, grants no authority. The workbench builds the real, disk-verified proposal only when the
    // owner runs `agent:/run: --from-proposal <id>`.
    const parsed = parseDraftIntentBlock(lines.slice(1));
    if ('error' in parsed) { entries.push({ kind: 'error', text: parsed.error }); return entries; }
    const intent = buildProposalIntent(parsed);
    const intentPath = writeProposalIntent(intent);
    const pathsSummary = intent.affectedPaths.map((a) => `${a.path} [${a.epistemicStatus}]`).join(', ');
    entries.push({
      kind: 'info',
      text: `Proposal-intent drafted (advisory only — nothing is proposed, verified, signed, or applied).\n  id: ${intent.intentId}\n  goal: ${intent.goal}\n  affected paths: ${pathsSummary}\n  written -> ${intentPath}\nTo build the REAL, disk-verified proposal from this intent:\n  agent: --from-proposal ${intent.intentId}\n  (or "run: --from-proposal ${intent.intentId}" for the full sandbox → tests → fusion review → receipt chain)\nThe workbench re-reads the real files itself; the intent's snippets are hints, never trusted as content.`,
    });
    // #51: a draft-only evidence packet — clearly DRAFT_ONLY, appliedLive:false, so chat never mistakes
    // an authored intent for a landed change.
    const draftPacket = buildDraftEvidencePacket({ intentId: intent.intentId, goal: intent.goal });
    entries.push({ kind: 'info', text: formatEvidencePacketForChat(draftPacket) });
    return entries;
  }

  if (first === 'propose patch') {
    const parsed = parseProposePatchBlock(lines.slice(1));
    if ('error' in parsed) { entries.push({ kind: 'error', text: parsed.error }); return entries; }
    const d = call(session, 'propose_patch', { goal: parsed.goal, files: parsed.files });
    emitToolResult(entries, 'propose_patch', d);
    if (d.result.ok) {
      const out = d.result.output as { proposalHash: string };
      session.lastProposal = { goal: parsed.goal, files: parsed.files, proposalHash: out.proposalHash };
      session.lastSandboxPath = null;
      session.lastTestResult = null;
      // Write the human-reviewable proposal artifact (outside the repo) and tell the owner exactly
      // what to run in their OWN terminal to sign it — signing never touches the browser/this process.
      const artifact = buildSelfEditProposalArtifact(parsed.goal, parsed.files);
      const artifactPath = writeSelfEditProposalArtifact(artifact);
      captureWorkbenchEvent(entries, session, 'code', parsed.goal, parsed.files.map((f) => f.relPath).join(', '), 'workbench_propose_patch');
      entries.push({
        kind: 'info',
        text: `Proposal artifact written -> ${artifactPath}\nTo authorize this EXACT proposal for live apply, run in your own terminal (never here):\n  bash scripts/aumlok-authority.sh sign ${artifactPath} > /tmp/signed-${out.proposalHash.slice(0, 12)}.json\nThen come back and type: apply signed proposal /tmp/signed-${out.proposalHash.slice(0, 12)}.json`,
      });
    }
    return entries;
  }

  if (first === 'sandbox apply') { stageSandboxApply(session, entries); return entries; }

  if (first === 'run sandbox tests') { stageContentCheck(session, entries); return entries; }

  if (first === 'run typecheck') { runRealTestCommand('typecheck', undefined, session, entries); return entries; }

  if (first === 'run full test suite') { runRealTestCommand('full_test_suite', undefined, session, entries); return entries; }

  {
    const m = trimmed.match(/^run targeted test\s+(.+)$/i);
    if (m) { runRealTestCommand('targeted_test', m[1].trim(), session, entries); return entries; }
  }

  if (first === 'run fusion review') { await stageFusionReview(session, entries); return entries; }

  if (first === 'write receipt') { stageWriteReceipt(session, entries); return entries; }

  if (first === 'rollback sandbox') {
    if (!session.lastSandboxPath) { entries.push({ kind: 'error', text: 'no sandbox to roll back' }); return entries; }
    const d = call(session, 'rollback_sandbox', { sandboxPath: session.lastSandboxPath });
    emitToolResult(entries, 'rollback_sandbox', d);
    if (d.result.ok) session.lastSandboxPath = null;
    return entries;
  }

  {
    const m = trimmed.match(/^apply signed proposal\s+(.+)$/i);
    if (m) {
      const signedPath = m[1].trim();
      // The signed receipt is read FIRST: it is the authoritative pointer (authorization.proposalHash)
      // to WHICH proposal the owner signed — whether or not this session produced it.
      const read = readSignedPromotionReceiptFromFile(signedPath);
      if (!read.ok) { entries.push({ kind: 'error', text: `could not read signed receipt: ${read.reason}` }); return entries; }
      // First-contact seam fix (2026-07-05): a FRESH session used to refuse here ("no proposal in this
      // session") even though the owner had a signed receipt in hand and the proposal artifact was on
      // disk. Now: if the session doesn't hold the proposal, load it from the pending-proposals dir BY
      // THE SIGNED HASH (bare 64-hex only; the loader re-derives the artifact's hash from goal+files and
      // cross-checks it against the requested hash, so a swapped file cannot ride a signed receipt).
      // dispatchSignedLiveApply then re-verifies the signature against the recomputed hash as always —
      // this changes WHERE the proposal bytes are read from, never WHAT authorizes them.
      let proposal = session.lastProposal;
      if (!proposal) {
        const signedHash = (read.signedReceipt as { authorization?: { proposalHash?: unknown } })?.authorization?.proposalHash;
        if (typeof signedHash !== 'string' || !signedHash) {
          entries.push({ kind: 'error', text: 'no proposal in this session and the signed receipt names no proposalHash — nothing to apply' });
          return entries;
        }
        const loaded = readPendingProposalByHash(signedHash);
        if (!loaded.ok) {
          entries.push({ kind: 'error', text: `no proposal in this session, and the signed proposal could not be loaded from pending-proposals: ${loaded.reason}` });
          return entries;
        }
        entries.push({ kind: 'info', text: `session holds no proposal — loaded the SIGNED one from disk: ${loaded.filePath} (hash cross-checked)` });
        proposal = { goal: loaded.artifact.goal, files: loaded.artifact.files, proposalHash: loaded.artifact.proposalHash };
      }
      entries.push({ kind: 'tool_call', text: `dispatchSignedLiveApply(proposalHash=${proposal.proposalHash.slice(0, 16)}...)` });
      const result = dispatchSignedLiveApply({
        goal: proposal.goal,
        proposalHash: proposal.proposalHash,
        files: proposal.files,
        signedReceipt: read.signedReceipt,
      });
      session.toolCallsUsed.push('signed_live_apply');
      if (result.ok) {
        entries.push({ kind: 'tool_result', text: `OK  LIVE APPLIED — commit ${result.receipt!.commitSha} — rollback: ${result.receipt!.rollbackCommand}\n${JSON.stringify(result.receipt, null, 2)}` });
        // Issue #37: upgrades this same capture call in place (same source, same site — not a second,
        // parallel capture) from a raw receipt summary to a compact state digest, so a later chat turn
        // can answer "what changed?" by reciting this exact atom instead of guessing.
        const digest = buildStateDigest({
          receipt: result.receipt!,
          proposal: { goal: proposal.goal, files: proposal.files },
          testResult: session.lastTestResult,
        });
        captureWorkbenchEvent(entries, session, 'receipt', proposal.goal, digest.text, 'workbench_live_apply', { tags: digest.tags });
      } else {
        entries.push({ kind: 'tool_result', text: `REFUSED  ${result.reason}` });
      }
      return entries;
    }
  }

  entries.push({ kind: 'error', text: `unrecognized command: "${first}". Type "help" for the command list.` });
  return entries;
}
