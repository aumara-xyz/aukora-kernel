// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Workbench → chat evidence packet (issue #51). After a governed workbench action (`draft intent:`,
 * `agent:`, `run:`) completes, this pure module frames what happened into a typed, REDACTED evidence
 * packet the chat lane can return to Auma — so she never says something "landed" without seeing proof,
 * and never sees a raw secret.
 *
 * Invariants this module exists to hold (straight from the issue's Boundaries):
 *   - Evidence is NOT authority. Every packet is `advisoryOnly:true`, `grantsAuthority:false`,
 *     `appliedLive:false` — literal-pinned. This rung never live-applies anything; a real live apply is
 *     a separate, owner-signed lane, and when that exists it will set appliedLive from a real receipt,
 *     not from chat.
 *   - No false "landed" language. The rendered summary is built from a controlled template that states
 *     the truth for a proposal ("nothing was applied to the live repo"); `assertNoFalseLandedClaim`
 *     re-scans the finished summary and, if some future edit ever slips an affirmative landed claim in
 *     while appliedLive is false, the summary is replaced with a safe fallback and the slip is recorded
 *     as a redaction rather than shown.
 *   - Raw secrets/logs are redacted or excluded. Every free-text field passes through the shared hex
 *     chokepoint (`truncateHexRunsForCapture`) and then the canonical `scanForSecrets` /
 *     `scanForAuthorityLeakage` (burnDataset.ts) — if a value is still secret- or authority-shaped after
 *     hex collapse, the raw value is REFUSED (replaced with a placeholder) and the reason is recorded in
 *     `redactions[]`. One redaction stack, reused — never a second copy.
 *
 * Pure: no fs/network/subprocess/clock. The caller (workbenchCommandLoop.ts) already holds the run
 * report / intent this needs, and passes `now` in for deterministic, testable output.
 */
import { truncateHexRunsForCapture } from './hexTruncation';
import { scanForSecrets, scanForAuthorityLeakage } from './burnDataset';
import type { WorkbenchRunReport, RunStageName } from './workbenchRunReport';
import type { FileShrinkResult } from './fileShrink';

export type PhaseStatus = 'ok' | 'failed' | 'not_reached';
export type FusionStatus = 'GREEN' | 'YELLOW' | 'RED' | 'NO_QUORUM' | 'UNKNOWN' | 'not_run';
export type EvidenceKind = 'draft-intent' | 'proposal-run';

export interface EvidencePacketV1 {
  schema: 'workbench-evidence-packet-v1';
  kind: EvidenceKind;
  goal: string;
  /** proposalHash for a proposal-run, else null. */
  proposalId: string | null;
  /** the upstream proposal-intent id, when this run came from one (#35). */
  intentId: string | null;
  // Per-phase honest status. `not_reached` means the chain never got here (stopped earlier or N/A).
  draftStatus: 'authored' | 'from_intent' | 'ad_hoc';
  proposalStatus: PhaseStatus;
  testStatus: PhaseStatus;
  fusionStatus: FusionStatus;
  receiptStatus: PhaseStatus;
  /** Verbatim from the run report vocabulary: DRAFT_ONLY | AWAITING_OWNER_SIGNATURE | FAILED_AT: <stage>. */
  terminalState: string;
  // Authority spine — literal-pinned. This rung produces evidence, never a landing.
  appliedLive: false;
  advisoryOnly: true;
  grantsAuthority: false;
  artifactPath: string | null;
  receiptPath: string | null;
  model: string | null;
  // #91: files this proposal would shrink dramatically (an existing file replaced by much smaller
  // content — the truncation class the first crossing rehearsal exposed). Surfaced at RUN time so chat
  // sees it right after `run:`, not only at sign time. Empty when nothing shrinks.
  fileShrinkWarnings: FileShrinkResult[];
  anyShrinkWarning: boolean;
  /** What was redacted and why (empty when nothing tripped the guards). */
  redactions: string[];
  // Brick 3.1 (the seamless loop, owner-granted 2026-07-08): when the chain FAILED, a structured
  // read of the FIRST failure — failing test, file:line, message, assertion diff — parsed from the
  // failed stage's own detail text. The difference between "it failed" and "I know exactly what to
  // change". null when the chain succeeded or nothing parseable was found (never fabricated).
  failureEvidence: FailureEvidenceV1 | null;
  /** The redacted, honest, chat-facing text. Never asserts a landing while appliedLive is false. */
  summary: string;
}

/** Structured first-failure evidence. Every text field is capped and passes the same redaction
 *  chokepoint as every other packet field. Advisory like everything here — it names the failure,
 *  it never re-runs anything. */
export interface FailureEvidenceV1 {
  /** which failed stage this was read from (e.g. 'typecheck', 'content_check', 'agent') */
  stage: string;
  /** vitest-style failing test path ("core/tests/x.test.ts > suite > name"), null for typecheck */
  failingTest: string | null;
  file: string | null;
  line: number | null;
  /** the first error/assertion message */
  message: string | null;
  expected: string | null;
  received: string | null;
  /** additional failures visible in the same (already-capped) log beyond the first */
  moreFailures: number;
}

const PLACEHOLDER = '[redacted: secret- or authority-shaped value refused]';
const MAX_FIELD_CHARS = 500;

/**
 * The single redaction gate for one free-text field. Hex-collapse first (hashes/keys/signatures), then
 * refuse anything the canonical scanners still flag. Returns the safe string; pushes a reason into
 * `redactions` when it refused. Never throws.
 */
export function redactField(label: string, value: string | null | undefined, redactions: string[]): string | null {
  if (value == null) return null;
  const collapsed = truncateHexRunsForCapture(String(value)).slice(0, MAX_FIELD_CHARS);
  const secret = scanForSecrets(collapsed);
  const authority = scanForAuthorityLeakage(collapsed);
  if (!secret.clean || !authority.clean) {
    const reasons = [...secret.matches, ...authority.matches].join('; ');
    redactions.push(`${label}: ${reasons}`);
    return PLACEHOLDER;
  }
  return collapsed;
}

// ── Brick 3.1: structured first-failure extraction ────────────────────────────────────────────────
// Pure parsers over the failed stage's detail text (which already embeds the capped tsc/vitest
// excerpt from sandboxTestRunner). Tolerant by design: anything unparseable yields nulls, never a
// throw and never an invented value. Field caps keep the packet bounded no matter what the log says.
const EVIDENCE_FIELD_CHARS = 220;
const capEvidence = (s: string): string => s.trim().slice(0, EVIDENCE_FIELD_CHARS);

/** Parse ONE failed stage's detail into structured evidence, or null when nothing recognizable. */
export function extractFailureEvidence(stage: string, raw: string | null | undefined): FailureEvidenceV1 | null {
  const text = String(raw ?? '');
  if (!text.trim()) return null;
  const ev: FailureEvidenceV1 = { stage, failingTest: null, file: null, line: null, message: null, expected: null, received: null, moreFailures: 0 };

  // vitest failing test headers: "FAIL  core/tests/x.test.ts > suite > name" (also ×/✕ bullet forms).
  // Not line-anchored: stage details prefix the log on the same line ("real typecheck FAILED — FAIL …").
  // "\s+" right after FAIL keeps the word FAILED itself from matching.
  const failMatches = [...text.matchAll(/(?:^|\s)(?:FAIL|×|✕)\s+(\S[^\n]*)/gm)];
  if (failMatches.length) {
    ev.failingTest = capEvidence(failMatches[0][1]);
    ev.moreFailures += failMatches.length - 1;
  }

  // first assertion/error message line
  const assertion = text.match(/(?:AssertionError|[A-Za-z]*Error):\s*([^\n]+)/);
  if (assertion) ev.message = capEvidence(assertion[1]);

  // tsc: "path.ts(12,5): error TS1234: msg"  and the pretty form  "path.ts:12:5 - error TS1234: msg".
  // The path is captured as one non-space token so a same-line stage prefix can never bleed into it.
  const tsParen = text.match(/([\w@][\w@./-]*\.[cm]?tsx?)\((\d+),\d+\):\s*error (TS\d+):\s*([^\n]+)/);
  const tsColon = tsParen ? null : text.match(/([\w@][\w@./-]*\.[cm]?tsx?):(\d+):\d+\s*-\s*error (TS\d+):\s*([^\n]+)/);
  const ts = tsParen ?? tsColon;
  if (ts) {
    ev.file = capEvidence(ts[1]);
    ev.line = Number(ts[2]);
    if (!ev.message) ev.message = capEvidence(`${ts[3]}: ${ts[4]}`);
    const all = text.match(/\berror TS\d+:/g) ?? [];
    ev.moreFailures = Math.max(ev.moreFailures, all.length - 1);
  }

  // vitest assertion diff: "- Expected" / "+ Received" headers, then the first -/+ payload lines
  const expHeader = text.search(/^\s*-\s*Expected\b/m);
  const recHeader = text.search(/^\s*\+\s*Received\b/m);
  if (expHeader >= 0 && recHeader >= 0) {
    const after = text.slice(Math.max(expHeader, recHeader));
    const expLine = after.match(/^\s*-\s+(?!Expected\b)(\S.*)$/m);
    const recLine = after.match(/^\s*\+\s+(?!Received\b)(\S.*)$/m);
    if (expLine) ev.expected = capEvidence(expLine[1]);
    if (recLine) ev.received = capEvidence(recLine[1]);
  }
  // inline fallback: "expected X to be Y" (vitest/chai one-line assertions — X is the RECEIVED value)
  if (ev.expected == null && ev.received == null && ev.message) {
    const inline = ev.message.match(/expected\s+(.{1,120}?)\s+to\s+(?:\w+\s+)+?(\S.{0,120}?)(?:\s*\/\/.*)?$/i);
    if (inline) { ev.received = capEvidence(inline[1]); ev.expected = capEvidence(inline[2]); }
  }

  // file:line from a vitest/node stack frame when tsc gave none: "❯ path.ts:12:5" / "at path.ts:12:5"
  if (!ev.file) {
    const frame = text.match(/(?:❯|\bat)\s+(?:.*?\()?([\w@./-]+\.[cm]?[jt]sx?):(\d+):\d+/);
    if (frame) { ev.file = capEvidence(frame[1]); ev.line = Number(frame[2]); }
  }

  if (!ev.failingTest && !ev.message && !ev.file && ev.expected == null && ev.received == null) return null;
  return ev;
}

/** Redact every free-text field of extracted evidence through the packet's single chokepoint. */
function redactFailureEvidence(ev: FailureEvidenceV1 | null, redactions: string[]): FailureEvidenceV1 | null {
  if (!ev) return null;
  return {
    ...ev,
    failingTest: redactField('failure.failingTest', ev.failingTest, redactions),
    file: redactField('failure.file', ev.file, redactions),
    message: redactField('failure.message', ev.message, redactions),
    expected: redactField('failure.expected', ev.expected, redactions),
    received: redactField('failure.received', ev.received, redactions),
  };
}

function findStage(report: WorkbenchRunReport, name: RunStageName) {
  return report.stages.find((s) => s.stage === name) ?? null;
}

function phaseFrom(report: WorkbenchRunReport, name: RunStageName): PhaseStatus {
  const s = findStage(report, name);
  if (!s) return 'not_reached';
  return s.ok ? 'ok' : 'failed';
}

/** Prefer the real typecheck stage's status; fall back to the simulated content_check; else not_reached. */
function testPhase(report: WorkbenchRunReport): PhaseStatus {
  const tc = findStage(report, 'typecheck');
  if (tc) return tc.ok ? 'ok' : 'failed';
  const cc = findStage(report, 'content_check');
  if (cc) return cc.ok ? 'ok' : 'failed';
  return 'not_reached';
}

/** Fusion is advisory: extract its GREEN/YELLOW/RED/NO_QUORUM verdict from the stage detail, or not_run. */
function fusionFrom(report: WorkbenchRunReport): FusionStatus {
  const s = findStage(report, 'fusion_review');
  if (!s) return 'not_run';
  const m = s.detail.match(/\b(GREEN|YELLOW|RED|NO_QUORUM)\b/);
  return (m ? m[1] : 'UNKNOWN') as FusionStatus;
}

// "It landed" phrasings, in the positive voice. These match a landing CLAIM; `findFalseLandedClaims`
// then clears any match immediately preceded by a negation, so honest negations like "nothing was
// applied to the live repo" read as clean while "the change was applied to main" does not.
export const FALSE_LANDED_PATTERNS: RegExp[] = [
  /\b(?:has|have|had)\s+been\s+(?:applied|landed|deployed|merged|shipped|committed\s+to\s+main)\b/i,
  /\bwas\s+(?:applied|landed|deployed|merged|shipped)\s+(?:to|into)\b/i,
  /\b(?:is|are)\s+now\s+live\b/i,
  /\bwent\s+live\b/i,
  /\bsuccessfully\s+(?:applied|landed|deployed|merged|shipped)\b/i,
  /\bchange\s+(?:is|has\s+been)\s+(?:live|applied|landed)\b/i,
];

// A negation appearing just before a matched phrase flips it from a claim to an honest denial.
const NEGATOR_BEFORE = /\b(?:no|not|nothing|never|without|isn'?t|wasn'?t|weren'?t|won'?t|cannot|can'?t)\b[\s\w,'-]{0,24}$/i;

/** Affirmative landed claims found in `text` (for a not-applied packet, this must be empty). A phrase
 *  preceded within ~24 chars by a negation word is treated as an honest denial, not a claim. */
export function findFalseLandedClaims(text: string): string[] {
  const hits: string[] = [];
  for (const p of FALSE_LANDED_PATTERNS) {
    const m = text.match(p);
    if (!m || m.index == null) continue;
    const preceding = text.slice(Math.max(0, m.index - 32), m.index);
    if (NEGATOR_BEFORE.test(preceding)) continue; // "nothing was applied to…" → honest denial, clean
    hits.push(m[0]);
  }
  return hits;
}

const SAFE_FALLBACK_SUMMARY =
  'Evidence packet withheld a claim that read as a live landing. This is a PROPOSAL — nothing was ' +
  'applied to the live repo (appliedLive: false, advisoryOnly: true).';

function statusWord(s: PhaseStatus): string {
  return s === 'ok' ? 'OK' : s === 'failed' ? 'FAILED' : 'not reached';
}

function renderSummary(p: Omit<EvidencePacketV1, 'summary'>): string {
  const lines: string[] = [];
  lines.push(`evidence packet — ${p.kind === 'draft-intent' ? 'draft intent (advisory)' : 'governed workbench run'}`);
  lines.push(`goal: ${p.goal}`);
  if (p.intentId) lines.push(`intent id: ${p.intentId}`);
  if (p.proposalId) lines.push(`proposal id: ${p.proposalId}`);
  if (p.model) lines.push(`model: ${p.model}`);
  if (p.kind === 'draft-intent') {
    lines.push('status: DRAFT ONLY — an advisory intent was authored. No proposal was built, no test ran, no receipt exists.');
  } else {
    lines.push(`proposal: ${statusWord(p.proposalStatus)}`);
    lines.push(`tests:    ${statusWord(p.testStatus)}`);
    lines.push(`fusion:   ${p.fusionStatus === 'not_run' ? 'not run' : p.fusionStatus} (advisory — never blocks, never authority)`);
    lines.push(`receipt:  ${statusWord(p.receiptStatus)}`);
  }
  // #91: a dramatic file-shrink is the highest-consequence, easiest-to-miss defect of a full-file-replace
  // apply lane. Surface it loudly, at run time, before the owner ever gets to the sign step.
  if (p.anyShrinkWarning) {
    const list = p.fileShrinkWarnings.map((f) => `${f.relPath} (${f.beforeLines}→${f.afterLines} lines)`).join(', ');
    lines.push(`⚠ FILE-SHRINK (#91): this proposal would replace an existing file with much smaller content — possible truncation. Do NOT sign without reviewing the diff: ${list}`);
  }
  // Brick 3.1: name the failure precisely — file:line, message, assertion — so the next draft can
  // aim at the exact defect instead of re-deriving it from raw log lines. Advisory text, like all of it.
  if (p.failureEvidence) {
    const f = p.failureEvidence;
    const where = f.file ? ` ${f.file}${f.line != null ? ':' + f.line : ''} —` : '';
    lines.push(`why it failed (${f.stage}):${where} ${f.message ?? 'no parseable message — see the log excerpt'}`);
    if (f.failingTest) lines.push(`failing test: ${f.failingTest}`);
    if (f.expected != null || f.received != null) lines.push(`assertion: expected ${f.expected ?? '?'} · received ${f.received ?? '?'}`);
    if (f.moreFailures > 0) lines.push(`(+${f.moreFailures} more failure(s) in the same log)`);
  }
  if (p.artifactPath) lines.push(`proposal artifact: ${p.artifactPath}`);
  if (p.receiptPath) lines.push(`receipt: ${p.receiptPath}`);
  lines.push(`terminal state: ${p.terminalState}`);
  // The authority spine, stated every time — evidence is not authority, and nothing here is live.
  lines.push('appliedLive: false — this is a PROPOSAL / draft, nothing was applied to the live repo.');
  lines.push('advisoryOnly: true · grantsAuthority: false — receipts, issues, and git remain the canonical record; chat cannot mark work complete.');
  if (p.terminalState === 'AWAITING_OWNER_SIGNATURE') {
    lines.push('Next step is the owner\'s: review the artifact and sign it in your own terminal. Until then, nothing is applied.');
  }
  if (p.redactions.length) lines.push(`redactions: ${p.redactions.length} field(s) redacted (secret- or authority-shaped).`);
  return lines.join('\n');
}

/** Belt-and-suspenders: re-scan the finished summary. Because appliedLive is always false in this rung,
 *  any affirmative landed claim is a defect — swap in the safe fallback and record it, never show it. */
function finalizeSummary(base: Omit<EvidencePacketV1, 'summary'>): { summary: string; redactions: string[] } {
  const summary = renderSummary(base);
  const landed = findFalseLandedClaims(summary);
  if (landed.length > 0) {
    return { summary: SAFE_FALLBACK_SUMMARY, redactions: [...base.redactions, `summary: false-landed claim suppressed: ${landed.join(', ')}`] };
  }
  return { summary, redactions: base.redactions };
}

/** Build the evidence packet for a completed/partial `run:`/`agent:` chain. */
export function buildEvidencePacketFromRunReport(
  report: WorkbenchRunReport,
  opts?: { intentId?: string | null; fileShrinks?: FileShrinkResult[] },
): EvidencePacketV1 {
  const redactions: string[] = [];
  const fileShrinkWarnings = (opts?.fileShrinks ?? []).filter((s) => s.shrinkWarning);
  const goal = redactField('goal', report.goal, redactions) ?? '(no goal)';
  const proposalId = redactField('proposalId', report.proposalHash, redactions);
  const intentId = redactField('intentId', opts?.intentId ?? null, redactions);
  const artifactPath = redactField('artifactPath', report.artifactPath, redactions);
  const receiptPath = redactField('receiptPath', report.receiptPath, redactions);
  const model = redactField('model', report.model, redactions);
  // A run that came from a #35 intent is `from_intent`; a bare `run: <goal>` is `ad_hoc`.
  const draftStatus: EvidencePacketV1['draftStatus'] = opts?.intentId ? 'from_intent' : 'ad_hoc';
  // Brick 3.1: read the FIRST failed stage's detail into structured evidence (null on a green chain).
  // When the detail has no tsc/vitest shape (e.g. the agent stage: "max_rounds_no_patch"), fall back to
  // quoting the stage's OWN words as the message — never nothing, never invented (first live rehearsal
  // failed exactly this way and the packet showed no "why", 2026-07-08).
  const failedStage = report.stages.find((s) => !s.ok) ?? null;
  const parsedEvidence = failedStage ? extractFailureEvidence(failedStage.stage, failedStage.detail) : null;
  const fallbackEvidence: FailureEvidenceV1 | null = failedStage && !parsedEvidence && String(failedStage.detail ?? '').trim()
    ? { stage: failedStage.stage, failingTest: null, file: null, line: null, message: String(failedStage.detail).trim().slice(0, 220), expected: null, received: null, moreFailures: 0 }
    : null;
  const failureEvidence = redactFailureEvidence(parsedEvidence ?? fallbackEvidence, redactions);

  const base: Omit<EvidencePacketV1, 'summary'> = {
    schema: 'workbench-evidence-packet-v1',
    kind: 'proposal-run',
    goal,
    proposalId,
    intentId,
    draftStatus,
    proposalStatus: phaseFrom(report, 'agent'),
    testStatus: testPhase(report),
    fusionStatus: fusionFrom(report),
    receiptStatus: phaseFrom(report, 'write_receipt'),
    terminalState: report.terminalState,
    appliedLive: false,
    advisoryOnly: true,
    grantsAuthority: false,
    artifactPath,
    receiptPath,
    model,
    fileShrinkWarnings,
    anyShrinkWarning: fileShrinkWarnings.length > 0,
    redactions,
    failureEvidence,
  };
  const { summary, redactions: finalRedactions } = finalizeSummary(base);
  return { ...base, redactions: finalRedactions, summary };
}

/** Build the evidence packet for a `draft intent:` — an advisory intent was authored, nothing was run. */
export function buildDraftEvidencePacket(input: { intentId: string; goal: string }): EvidencePacketV1 {
  const redactions: string[] = [];
  const goal = redactField('goal', input.goal, redactions) ?? '(no goal)';
  const intentId = redactField('intentId', input.intentId, redactions);
  const base: Omit<EvidencePacketV1, 'summary'> = {
    schema: 'workbench-evidence-packet-v1',
    kind: 'draft-intent',
    goal,
    proposalId: null,
    intentId,
    draftStatus: 'authored',
    proposalStatus: 'not_reached',
    testStatus: 'not_reached',
    fusionStatus: 'not_run',
    receiptStatus: 'not_reached',
    terminalState: 'DRAFT_ONLY',
    appliedLive: false,
    advisoryOnly: true,
    grantsAuthority: false,
    artifactPath: null,
    receiptPath: null,
    model: null,
    fileShrinkWarnings: [], // a draft authored nothing — no proposal files to shrink
    anyShrinkWarning: false,
    redactions,
    failureEvidence: null, // a draft ran nothing — there is no failure to read
  };
  const { summary, redactions: finalRedactions } = finalizeSummary(base);
  return { ...base, redactions: finalRedactions, summary };
}

/** The chat-facing text (already redacted + honesty-checked inside the packet). */
export function formatEvidencePacketForChat(packet: EvidencePacketV1): string {
  return packet.summary;
}
