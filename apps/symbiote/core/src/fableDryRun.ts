/**
 * 24Z.34 — Fable SYNTHETIC dry run (evidence-only, deterministic, clearly labeled).
 *
 * Fable is a FUTURE model / inside-out refactor / optimization intelligence — NOT memory itself. It will later
 * consume episode + continuity + MDL evidence to PROPOSE optimizations. No real Fable model exists yet and no real
 * model episodes exist, so this is a DETERMINISTIC test-double scoring over the fixture lessons, labeled
 * `fableDryRunSource: 'synthetic_fixture'`. HARD LAW: Fable proposals are evidence/proposal only — they NEVER
 * authorize, NEVER apply, and a synthetic dry run can NEVER be presented as a real Fable run. FIREWALL: imports no
 * gate/apply/OpenCode/signer; no such module imports it.
 */
import type { ConsolidationRecord } from './continuityConsolidation';

export type FableDryRunSource = 'synthetic_fixture' | 'real';
export type FableProposalKind = 'reinforce_guard' | 'investigate_failure' | 'preserve_boundary' | 'note_pattern' | 'no_action';

export interface FableProposal {
  proposalId: string;
  kind: FableProposalKind;
  fromLessonKind: string;          // the lesson kind that motivated it (categorical, no episode prose)
  rationale: string;               // a FIXED engine-generated string per kind — never lesson/episode prose
  priorityScore: number;           // deterministic, derived from lesson kind only
  source: FableDryRunSource;       // 'synthetic_fixture' here — never silently 'real'
  canAuthorize: false;             // HARD
}

export interface FableDryRunResult {
  fableDryRunSource: FableDryRunSource;   // 'synthetic_fixture' — the whole run is labeled
  ranOnRealEpisodes: false;               // HARD: no real model episodes exist
  isRealFableModel: false;                // HARD: no real Fable model ran
  grantsAuthority: false;                 // HARD
  canAuthorize: false;                    // HARD
  proposalCount: number;
  proposals: FableProposal[];
  note: string;
}

// deterministic priority + a fixed rationale per lesson kind (safety/refusal lessons rank highest).
const KIND_RULES: Record<string, { kind: FableProposalKind; priority: number; rationale: string }> = {
  refusal: { kind: 'reinforce_guard', priority: 90, rationale: 'A refusal lesson suggests reinforcing the guard that refused (proposal only; a human gate decides).' },
  boundary: { kind: 'preserve_boundary', priority: 80, rationale: 'A boundary lesson suggests preserving the boundary that held (proposal only).' },
  regression: { kind: 'investigate_failure', priority: 70, rationale: 'A regression lesson suggests investigating what changed (proposal only).' },
  failure: { kind: 'investigate_failure', priority: 60, rationale: 'A failure/incomplete lesson suggests investigating the incomplete path (proposal only).' },
  identity_anchor_candidate: { kind: 'note_pattern', priority: 50, rationale: 'An identity-anchor candidate is NOTED only — activation requires a future human/AUMLOK ceremony.' },
  design_note: { kind: 'note_pattern', priority: 30, rationale: 'A design-note lesson is recorded as context for a future pass (proposal only).' },
  success: { kind: 'no_action', priority: 10, rationale: 'A routine success lesson needs no action (recorded as baseline).' },
};

function sha256_8(s: string): string {
  // tiny deterministic id (FNV-1a → hex), no crypto-key semantics.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Run the synthetic Fable dry run over consolidated lessons. Pure + deterministic. Every proposal is labeled
 * `synthetic_fixture`, scored from the lesson KIND only (never episode prose), and cannot authorize. A
 * quarantine/un-Fable-readable lesson is skipped (it is metadata, not optimization input).
 */
export function runFableSyntheticDryRun(lessons: ConsolidationRecord[]): FableDryRunResult {
  const proposals: FableProposal[] = [];
  for (const lesson of lessons) {
    if (lesson.fableReadable === false) continue;            // quarantine lessons are not optimization input
    const rule = KIND_RULES[lesson.lessonKind] ?? KIND_RULES.design_note;
    proposals.push({
      proposalId: `fdr_${sha256_8(`${lesson.lessonKind}|${lesson.consolidationId}`)}`,
      kind: rule.kind,
      fromLessonKind: lesson.lessonKind,
      rationale: rule.rationale,
      priorityScore: rule.priority,
      source: 'synthetic_fixture',
      canAuthorize: false,
    });
  }
  // deterministic ordering: priority desc, then id asc (stable, no Date/random)
  proposals.sort((a, b) => (b.priorityScore - a.priorityScore) || a.proposalId.localeCompare(b.proposalId));
  return {
    fableDryRunSource: 'synthetic_fixture',
    ranOnRealEpisodes: false,
    isRealFableModel: false,
    grantsAuthority: false,
    canAuthorize: false,
    proposalCount: proposals.length,
    proposals,
    note: 'SYNTHETIC dry run over fixture lessons. Fable is a future model/refactor intelligence; no real Fable model ran; proposals are evidence only and cannot authorize.',
  };
}
