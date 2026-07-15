// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * AUMLOK in-app signing ASSISTANT (issues #81 + #91). A pure, read-only helper that lets the app EXPLAIN
 * AUMLOK actions to the owner — it never signs, never applies, and never reads the private key. It answers:
 * "what is my key/root/promotion status, what proposals are waiting, are any of them dangerous (a #91
 * truncation), and what EXACT terminal command do I run next?"
 *
 * Hard boundaries this module is built to hold (they are the whole point):
 *   - NO browser/app signing. This module imports NOTHING that can sign or apply — no aumlokSigner,
 *     no dispatchSignedLiveApply, no child_process, no network. It only reads files and formats strings.
 *   - NO private-key read. Key presence is checked by existence ONLY (via aumlokStatusSnapshot, which
 *     `fs.existsSync`es the key path and never opens it). This module never touches the key path at all.
 *   - Observer/helper only. Every output is advisory. Signing is the owner's, in the owner's terminal.
 *   - Trusted-dir reads only. Pending proposals are read from `<home>/aumlok/pending-proposals` and each is
 *     validated (schema + canonical hash re-derivation) before being shown; a tampered artifact is flagged,
 *     not trusted.
 *
 * The terminal commands are DISPLAY strings — shell-escaped so the owner can copy them verbatim, but this
 * module never executes them.
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildAumlokStatusSnapshot, type AumlokStatusSnapshot } from './aumlokStatusSnapshot';
import { readSelfEditProposalArtifact } from './selfEditProposalArtifact';
import { computeFileShrink, type FileShrinkResult } from './fileShrink';
import { computeProposalPreview, type ProposalPreview } from './proposalPreview';
// #178 round 2 (Fusion lane): the council's reading rides the signing view — read-only, fail-closed,
// and NEVER an input to any gate (the WARNINGS list already pins "Fusion only advises").
import { readProposalFusionAdvisory, proposalAdvisoriesDir } from './proposalFusionAdvisory';
// #178 round 5: seat track records at the gate — read-only over the seat ledger (votes + the
// owner-decision rows the #208 join records). Floors are enforced UPSTREAM (summarizeSeatLedger
// returns a NULL rate below OWNER_RATE_FLOOR); this view only carries what it is given.
import { readSeatLedgerRows, readOwnerDecisionRows, hasOwnerDecisions, summarizeSeatLedger, OWNER_RATE_FLOOR } from './fusionSeatLedger';
import { stalenessVerdict, type StalenessVerdict } from './stalenessCore';
// #178 round 5 (ARC3 lane): the game's own receipts ride the signing view too — when MK·PULSE named a
// door and drafted a work-order intent, the owner sees EXACTLY what the game saw at the moment of signing.
// Display-only, fail-closed, never a gate input (same discipline as the council reading above).
import { listPendingIntentIds, readProposalIntentById } from './proposalIntent';
import { readArc3GameReceipt } from './arc3GameReceipt';
import { readProposalDispositionRows } from './proposalDispositionRead';

// #91 file-shrink detection lives in the shared fileShrink.ts so the sign-time (this assistant) and
// run-time (workbenchEvidencePacket) surfaces never drift. ProposalFileSafety keeps its name for the
// existing endpoint/UI shape — it IS the shared FileShrinkResult.
export type ProposalFileSafety = FileShrinkResult;

/** The council's reading as the SIGNING SCREEN sees it (#178 round 2). Tri-state and fail-closed:
 *  'none' (no sidecar on disk), 'refused' (a sidecar exists but failed integrity — shown as a refusal,
 *  never as partial data), or a bounded projection of the advisory. Provenance is fused into the shape
 *  (councilCount + readAt) per the #178 focus-row reader-side rules: the owner always sees WHO read it
 *  and HOW OLD the reading is. Display-only — no gate, no endpoint, no apply path reads this. */
export type CouncilAdvisoryAtGate =
  | { state: 'none' }
  | { state: 'refused'; reason: string }
  | {
      state: 'present';
      verdict: 'GREEN' | 'YELLOW' | 'RED' | 'NO_QUORUM';
      gateAction: string;
      insight: string;
      phaseLocked: boolean;
      votes: { green: number; yellow: number; red: number; non: number };
      recommendations: string[]; // top 3
      councilCount: number;
      council: string[]; // the seat ids as the sidecar recorded them (#178 round 5 — track-record lines key on these)
      readAt: string;
    };

/** One seat's owner-decision track record, as the SIGNING SCREEN sees it (#178 round 5).
 *  `rate` is NULL below the 30-decision evidence floor — summarizeSeatLedger enforces that; this
 *  projection only carries it. Display-only: no gate, no weighting, no authority reads this. */
export interface SeatTrackRecord {
  seat: string;
  ownerScored: number; // owner-decided votes for this seat (signed applies the seat voted on)
  ownerAgreed: number;
  ownerRate: number | null; // NULL until ownerScored >= OWNER_RATE_FLOOR — percentages stay silent below the floor
}

/** The ledger's state as one honest object for the gate: 'not-started' (no decision evidence has
 *  ever been recorded on this node) vs real records. decisionCount is the number of signed-apply
 *  decision rows, NOT a per-seat count. */
export type SeatRecordsAtGate =
  | { state: 'not-started' }
  | { state: 'recording'; decisionCount: number; floor: number; records: SeatTrackRecord[] };

export interface AssistantProposal {
  proposalHash: string;
  goal: string;
  createdAt: string;
  /** #183 staleness core: the REAL verdict portal chips render (flagged never hidden; age on
   *  every read; stale cannot mint a challenge without the owner's explicit revive). */
  staleness: StalenessVerdict;
  files: ProposalFileSafety[];
  // A pending proposal is, by definition, advisory — it carries NO authority until an owner signature
  // exists. These are literal, not read from the artifact (the artifact schema has no such field).
  advisoryOnly: true;
  grantsAuthority: false;
  valid: boolean; // did the artifact validate (schema + canonical hash)?
  invalidReason: string | null;
  anyShrinkWarning: boolean;
  // #105 read layer: a bounded, secret-scanned diff preview per file so the owner can SEE the change in the
  // UI before signing. READ-ONLY (computed via the #75-confined resolver; secret-shaped lines withheld).
  preview: ProposalPreview[];
  riskHint: string; // advisory placeholder until the #78 PolicyKernel/ring model exists
  artifactPath: string;
  signCommand: string; // EXACT terminal command to sign THIS proposal (display only)
  applyHint: string; // what to type in the workbench AFTER signing (display only)
  councilAdvisory: CouncilAdvisoryAtGate; // #178 round 2 — display-only, never gates
}

/** A game finding as the SIGNING SCREEN sees it (#178 round 5): an `arc3`-authored pending intent, with
 *  its structured game receipt fused in when present (tri-state, fail-closed, like the council reading).
 *  This is what MK·PULSE saw when it named a door — display-only, provenance visible, never a gate. */
export interface GameFindingAtGate {
  intentId: string;
  goal: string;           // the intent's own goal ("restart the 'chat-door' door — …")
  createdAt: string;
  advisoryOnly: true;
  grantsAuthority: false;
  // the receipt is the game's eyes; absence and tamper stay distinct
  receipt:
    | { state: 'none' }
    | { state: 'refused'; reason: string }
    | { state: 'present'; door: string; url: string; guid: string; level: number; probes: number; readAt: string };
}

export interface AumlokAssistantView {
  schema: 'aumlok-signing-assistant-v1';
  status: AumlokStatusSnapshot;
  keygenNeeded: boolean;
  pending: AssistantProposal[];
  gameFindings: GameFindingAtGate[]; // #178 round 5 — display-only, never gates
  commands: { keygen: string | null }; // keygen is null when a key already exists
  warnings: string[];
  seatRecords: SeatRecordsAtGate; // #178 round 5 — node-wide, computed once per view; display-only
  advisoryOnly: true;
  grantsAuthority: false;
  generatedAt: string;
}

export interface AssistantPaths {
  homeDir?: string;
  repoRoot?: string;
}

/** POSIX-shell single-quote escaping so a path can be pasted verbatim into a terminal. */
export function shellQuote(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function pendingProposalsDir(homeDir: string): string {
  return path.join(homeDir, 'aumlok', 'pending-proposals');
}

// Advisory-only risk hint from target paths. NOT the #78 PolicyKernel — a placeholder until that lands.
function riskHintFor(relPaths: string[]): string {
  const sacredish = relPaths.some((p) => /^(authority\/|scripts\/aumlok|core\/src\/(aumlok|gate|sandboxApply|nativeLiveApply)|docs\/SAFETY_LAWS|docs\/SEED_ROOT)/i.test(p));
  if (sacredish) return 'ELEVATED — touches authority/gate/apply-adjacent paths; the apply lane may refuse sacred paths regardless of signature. Review with extra care. (ring model: #78, not yet built)';
  const codeish = relPaths.some((p) => /^core\/|^receiver\/|\.ts$/i.test(p));
  if (codeish) return 'MODERATE — touches code; targeted tests + typecheck already ran in the chain, but read the diff. (ring model: #78, not yet built)';
  return 'LOW — docs/UI-class change. Still owner-signed. (ring model: #78, not yet built)';
}

/** Read the council sidecar for one proposal, tri-state (#178 round 2). Absence and refusal are kept
 *  DISTINCT on purpose: "no reading exists" and "a reading exists but failed integrity" are different
 *  facts at a signing moment, and conflating them would hide tampering as mere absence. */
function councilAdvisoryFor(proposalHash: string, homeDir: string): CouncilAdvisoryAtGate {
  if (!/^[0-9a-f]{64}$/.test(proposalHash)) return { state: 'none' };
  if (!fs.existsSync(path.join(proposalAdvisoriesDir(homeDir), `${proposalHash}.json`))) return { state: 'none' };
  const r = readProposalFusionAdvisory(proposalHash, homeDir);
  if (!r.ok) return { state: 'refused', reason: r.reason };
  const a = r.advisory;
  return {
    state: 'present',
    verdict: a.overallVerdict,
    gateAction: a.gateAction,
    insight: a.insight,
    phaseLocked: a.phaseLocked,
    votes: { green: a.quorum.greenVotes, yellow: a.quorum.yellowVotes, red: a.quorum.redVotes, non: a.quorum.nonVotes },
    recommendations: a.recommendations.slice(0, 3),
    councilCount: a.councilModels.length,
    council: [...a.councilModels],
    readAt: a.createdAt,
  };
}

/** The node-wide seat records, one honest object (#178 round 5). 'not-started' when no decision
 *  evidence has ever been recorded (the first live signature starts it); otherwise the per-seat
 *  owner column, floors already enforced upstream. Never throws — evidence display must not be
 *  able to break the signing page. */
function seatRecordsFor(homeDir: string): SeatRecordsAtGate {
  try {
    if (!hasOwnerDecisions(homeDir)) return { state: 'not-started' };
    const decisions = readOwnerDecisionRows(homeDir).rows;
    const summaries = summarizeSeatLedger(readSeatLedgerRows(homeDir).rows, decisions);
    return {
      state: 'recording',
      decisionCount: decisions.length,
      floor: OWNER_RATE_FLOOR,
      records: summaries.map((s) => ({
        seat: s.seat,
        ownerScored: 'state' in s.owner ? 0 : s.owner.scored,
        ownerAgreed: 'state' in s.owner ? 0 : s.owner.agreed,
        ownerRate: 'state' in s.owner ? null : s.owner.rate,
      })),
    };
  } catch {
    return { state: 'not-started' }; // an unreadable ledger reads as no records, never as a crash
  }
}

const WARNINGS: readonly string[] = [
  'Signing happens ONLY in your own terminal. This app never signs and cannot sign.',
  'Never paste your private key or passphrase into the browser. The app never reads your key — it only checks that a key file exists.',
  '⚠ Do NOT sign a proposal marked FILE-SHRINK — it may be truncating a file (see #91). Review the before/after line counts first.',
  'AUMLOK owner decides. Fusion only advises — a GREEN verdict is NOT permission to apply.',
  'The sign step re-derives the proposal hash from the artifact and prints the goal + each file before it signs — read that prompt before you confirm.',
];

/**
 * Build the full assistant view. Pure w.r.t. the clock (`now` passed in). Never throws — a missing dir or
 * malformed proposal degrades to an honest empty/invalid entry rather than an exception.
 */
export function buildAumlokAssistantView(paths: AssistantPaths = {}, now = new Date().toISOString()): AumlokAssistantView {
  const homeDir = paths.homeDir ?? process.env.AUKORA_SYMBIOTE_HOME ?? path.join(process.env.HOME || '', '.aukora-symbiote');
  const repoRoot = paths.repoRoot ?? path.resolve(__dirname, '..', '..');

  const status = buildAumlokStatusSnapshot({ homeDir, repoRoot }, now);
  const keygenNeeded = !status.keyPresent;

  const dir = pendingProposalsDir(homeDir);
  const pending: AssistantProposal[] = [];
  // A rejection is terminal owner closure. When its archive move is delayed or interrupted, the
  // artifact must still disappear from every approval surface rather than becoming signable again.
  const dispositions = readProposalDispositionRows(homeDir, 100);
  const rejected = dispositions.refusedReason
    ? new Set<string>()
    : new Set(dispositions.rows.filter((row) => row.disposition === 'rejected').map((row) => row.proposalHash));
  let files: string[] = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); } catch { files = []; }

  for (const fname of files) {
    const artifactPath = path.join(dir, fname);
    const read = readSelfEditProposalArtifact(artifactPath);
    const hash = fname.replace(/\.json$/, '');
    if (rejected.has(hash)) continue;
    const hash12 = hash.slice(0, 12);
    const signCommand =
      `bash scripts/aumlok-authority.sh sign ${shellQuote(artifactPath)} > ${shellQuote(`/tmp/signed-${hash12}.json`)}`;
    const applyHint = `apply signed proposal /tmp/signed-${hash12}.json`;

    if (!read.ok) {
      pending.push({
        proposalHash: hash, goal: '(unreadable / invalid proposal artifact)', createdAt: '',
        staleness: stalenessVerdict({}, Date.parse(now)), // unknown-age: FLAGGED, never hidden
        files: [], advisoryOnly: true, grantsAuthority: false, valid: false, invalidReason: read.reason,
        anyShrinkWarning: false, riskHint: 'INVALID — this artifact failed validation; do not sign it.',
        preview: [], artifactPath, signCommand, applyHint,
        councilAdvisory: councilAdvisoryFor(hash, homeDir),
      });
      continue;
    }
    const a = read.artifact;
    const fileSafeties = a.files.map((f) => computeFileShrink(repoRoot, f.relPath, f.content));
    const anyShrink = fileSafeties.some((f) => f.shrinkWarning);
    const preview = a.files.map((f) => computeProposalPreview(repoRoot, f.relPath, f.content));
    pending.push({
      proposalHash: a.proposalHash,
      goal: a.goal,
      createdAt: a.createdAt,
      staleness: stalenessVerdict(a, Date.parse(now)),
      files: fileSafeties,
      advisoryOnly: true,
      grantsAuthority: false,
      valid: true,
      invalidReason: null,
      anyShrinkWarning: anyShrink,
      riskHint: riskHintFor(a.files.map((f) => f.relPath)),
      preview,
      artifactPath,
      signCommand,
      applyHint,
      councilAdvisory: councilAdvisoryFor(a.proposalHash, homeDir),
    });
  }

  // #178 round 5: the game's findings. Every arc3-authored pending intent, with its structured receipt
  // fused when present — so a pulse work order shows exactly what the game saw. Read-only, fail-closed.
  const gameFindings: GameFindingAtGate[] = [];
  for (const intentId of listPendingIntentIds(homeDir)) {
    const read = readProposalIntentById(intentId, homeDir);
    if (!read.ok || read.intent.authoredBy !== 'arc3') continue;
    const rc = readArc3GameReceipt(intentId, homeDir);
    gameFindings.push({
      intentId,
      goal: read.intent.goal,
      createdAt: read.intent.createdAt,
      advisoryOnly: true,
      grantsAuthority: false,
      receipt: rc.state === 'present'
        ? {
            state: 'present',
            door: rc.receipt.door, url: rc.receipt.url, guid: rc.receipt.guid,
            level: rc.receipt.level, probes: rc.receipt.probes, readAt: rc.receipt.createdAt,
          }
        : rc,
    });
  }

  return {
    schema: 'aumlok-signing-assistant-v1',
    status,
    keygenNeeded,
    pending,
    gameFindings,
    commands: { keygen: keygenNeeded ? 'bash scripts/aumlok-authority.sh keygen' : null },
    warnings: [...WARNINGS],
    seatRecords: seatRecordsFor(homeDir),
    advisoryOnly: true,
    grantsAuthority: false,
    generatedAt: now,
  };
}
