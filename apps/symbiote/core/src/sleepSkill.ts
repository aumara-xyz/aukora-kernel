import * as crypto from 'crypto';
import {
  BurnTrace,
  BurnLabel,
  BurnStep,
  scanForSecrets,
  scanForAuthorityLeakage,
} from './burnDataset';

// ── Markers ──

export const LEARNED_REGION_START = '<AUKORA_SLEEP_LEARNED_START>';
export const LEARNED_REGION_END = '<AUKORA_SLEEP_LEARNED_END>';

// ── Types ──

export type SleepEditOp = 'add' | 'replace' | 'delete';

export const POSITIVE_LABELS: ReadonlySet<BurnLabel> = new Set(['golden', 'needs_human']);
export const CAUTION_LABELS: ReadonlySet<BurnLabel> = new Set(['refused', 'unsafe', 'contradicted', 'stale']);

export type LabelRoute = 'workflow' | 'caution';

export const LABEL_ROUTING_TABLE: Readonly<Record<BurnLabel, { route: LabelRoute; mayProducePositiveInstruction: boolean; reason: string }>> = {
  golden:       { route: 'workflow', mayProducePositiveInstruction: true,  reason: 'Verified correct procedure — safe to synthesize workflow guidance' },
  needs_human:  { route: 'workflow', mayProducePositiveInstruction: true,  reason: 'Human-gated step — safe to synthesize workflow guidance (includes approval reminder)' },
  refused:      { route: 'caution',  mayProducePositiveInstruction: false, reason: 'Model correctly refused — quarantined, caution rule only' },
  unsafe:       { route: 'caution',  mayProducePositiveInstruction: false, reason: 'Unsafe action detected — quarantined, caution rule only' },
  contradicted: { route: 'caution',  mayProducePositiveInstruction: false, reason: 'Contradicts authority boundary — quarantined, caution rule only' },
  stale:        { route: 'caution',  mayProducePositiveInstruction: false, reason: 'Stale/outdated information — quarantined, caution rule only' },
};

export function routeLabel(label: BurnLabel): LabelRoute {
  if (POSITIVE_LABELS.has(label)) return 'workflow';
  if (CAUTION_LABELS.has(label)) return 'caution';
  return 'caution';
}

export interface SleepSkillEdit {
  op: SleepEditOp;
  section: string;
  content: string;
  source_trace_ids: string[];
  source_labels: BurnLabel[];
  reason: string;
}

export interface SleepSkillGateSignal {
  secret_scan_passed: boolean;
  authority_leakage_scan_passed: boolean;
  quarantined_label_count: number;
  quarantined_labels: BurnLabel[];
  edit_budget_remaining: number;
}

export interface SleepSkillProposal {
  proposal_id: string;
  arc: string;
  created_at: string;
  advisoryOnly: true;
  grantsAuthority: false;
  applyEligible: false;
  edits: SleepSkillEdit[];
  caution_rules: SleepSkillEdit[];
  gate_signal: SleepSkillGateSignal;
  labels_used: BurnLabel[];
  labels_quarantined: BurnLabel[];
  edit_count: number;
  edit_budget: number;
}

export interface SleepSkillDocument {
  version: 'v0';
  title: string;
  preamble: string;
  sections: SleepSkillSection[];
  protected_regions: string[];
}

export interface SleepSkillSection {
  name: string;
  content: string;
  is_learned: boolean;
}

export interface SleepSkillExport {
  version: 'v0';
  export_date: string;
  proposal_count: number;
  total_edit_count: number;
  label_usage: Record<BurnLabel, number>;
  quarantined_label_count: number;
  secret_scan_passed: boolean;
  authority_leakage_scan_passed: boolean;
  proposals: SleepSkillProposal[];
}

// ── Proposal ID ──

function makeProposalId(arc: string, index: number): string {
  const hash = crypto.createHash('sha256')
    .update(`sleep_skill_v0:${arc}:${index}`)
    .digest('hex')
    .slice(0, 16);
  return `sleep_${hash}`;
}

// ── Edit Budget ──

const DEFAULT_EDIT_BUDGET = 20;

// ── Core: build proposals from burn traces ──

function extractGoldenPatterns(traces: BurnTrace[]): Map<string, { trace_ids: string[]; labels: BurnLabel[]; patterns: string[] }> {
  const patterns = new Map<string, { trace_ids: string[]; labels: BurnLabel[]; patterns: string[] }>();

  for (const trace of traces) {
    for (const step of trace.steps) {
      if (routeLabel(step.label) !== 'workflow') continue;

      const key = categorizeStep(step);
      if (!patterns.has(key)) {
        patterns.set(key, { trace_ids: [], labels: [], patterns: [] });
      }
      const entry = patterns.get(key)!;
      entry.trace_ids.push(trace.trace_id);
      if (!entry.labels.includes(step.label)) entry.labels.push(step.label);
      entry.patterns.push(step.training_target_response);
    }
  }

  return patterns;
}

function extractCautionRules(traces: BurnTrace[]): SleepSkillEdit[] {
  const rules: SleepSkillEdit[] = [];
  const seen = new Set<string>();

  for (const trace of traces) {
    for (const step of trace.steps) {
      if (routeLabel(step.label) !== 'caution') continue;

      const key = `caution:${step.label}:${categorizeStep(step)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      rules.push({
        op: 'add',
        section: 'caution_rules',
        content: `CAUTION (${step.label}): ${step.why_label}`,
        source_trace_ids: [trace.trace_id],
        source_labels: [step.label],
        reason: `Derived from ${step.label} trace: ${step.expected_gate_boundary}`,
      });
    }
  }

  return rules;
}

function categorizeStep(step: BurnStep): string {
  const response = step.training_target_response.toLowerCase();
  if (response.includes('proposal') || response.includes('discover')) return 'target_discovery';
  if (response.includes('draft') && response.includes('review')) return 'draft_review';
  if (response.includes('approval') || response.includes('kernel_test')) return 'approval_handling';
  if (response.includes('receipt') || response.includes('verdict')) return 'receipt_interpretation';
  if (response.includes('fusion') || response.includes('council')) return 'fusion_advisory';
  if (response.includes('chronos') || response.includes('timing')) return 'chronos_boundary';
  if (response.includes('glyph') || response.includes('vk')) return 'vk_boundary';
  if (response.includes('security') || response.includes('snapshot')) return 'security_posture';
  if (response.includes('secret') || response.includes('key')) return 'secret_handling';
  if (response.includes('local_stub') || response.includes('aumlok')) return 'aumlok_boundary';
  if (response.includes('evidence') || response.includes('arc')) return 'evidence_interpretation';
  if (response.includes('organism') || response.includes('graph')) return 'organism_navigation';
  return 'general_workflow';
}

function buildWorkflowEdits(
  goldenPatterns: Map<string, { trace_ids: string[]; labels: BurnLabel[]; patterns: string[] }>,
  budget: number,
): SleepSkillEdit[] {
  const edits: SleepSkillEdit[] = [];

  const sectionTemplates: Record<string, string> = {
    target_discovery: 'When discovering targets: use organism graph, check connectivity report, prefer LOW-risk advisory nodes. Propose with intent: draft_only.',
    draft_review: 'When reviewing drafts: verify intent is draft_only, confirm approvalRequired is true, present for human review. Never self-apply.',
    approval_handling: 'When handling approvals: check grantsAuthority (must be false). kernel_test is test-only. Approval is evidence, not permission.',
    receipt_interpretation: 'When interpreting receipts: log as evidence, inform next cycle. Receipt does not authorize mutation or gate change.',
    fusion_advisory: 'When interpreting Fusion Council: log as advisory evidence. Council output does not authorize, modify gate, or update receipts. Only signed receipts update canonical memory.',
    chronos_boundary: 'Chronos boundary: timing is evidence/telemetry only. Timing may never authorize. No Chronos production transport.',
    vk_boundary: 'VK boundary: glyphs are advisory/compression only. Glyphs may never authorize effects or bypass typed intents. No codebook in model context.',
    security_posture: 'Security posture: always regenerate snapshots before decisions. Stale data may miss new invariants.',
    secret_handling: 'Secret handling: no key printed, logged, committed, or passed inline. Ever. Training traces use scrubbed summaries only.',
    aumlok_boundary: 'AUMLOK boundary: local_stub is rehearsal only. isApplyEligibleBinding() returns { eligible: false } structurally.',
    evidence_interpretation: 'Evidence interpretation: evidence docs are read-only historical records. Use for context, do not re-execute or modify past work.',
    organism_navigation: 'Organism navigation: use connectivity report to identify advisory targets. Stay within membrane boundary. Do not cross forbidden edges.',
    general_workflow: 'General workflow: propose, draft, wait for approval. No auto-apply, no auto-commit, no auto-push.',
  };

  for (const [category, data] of goldenPatterns) {
    if (edits.length >= budget) break;

    const template = sectionTemplates[category];
    if (!template) continue;

    edits.push({
      op: 'add',
      section: `workflow:${category}`,
      content: template,
      source_trace_ids: data.trace_ids,
      source_labels: data.labels,
      reason: `Synthesized from ${data.patterns.length} golden/needs_human traces in category ${category}`,
    });
  }

  return edits;
}

// ── Main Builder ──

export function buildSleepSkillProposals(traces: BurnTrace[], editBudget = DEFAULT_EDIT_BUDGET): SleepSkillExport {
  const arc = '24Q';
  const date = new Date().toISOString();

  const goldenPatterns = extractGoldenPatterns(traces);
  const cautionRules = extractCautionRules(traces);
  const workflowEdits = buildWorkflowEdits(goldenPatterns, editBudget);

  const allEdits = [...workflowEdits, ...cautionRules];

  // Track labels
  const labelsUsed = new Set<BurnLabel>();
  const labelsQuarantined = new Set<BurnLabel>();
  const labelUsage: Record<BurnLabel, number> = {
    golden: 0, refused: 0, unsafe: 0, contradicted: 0, stale: 0, needs_human: 0,
  };

  for (const trace of traces) {
    for (const step of trace.steps) {
      labelUsage[step.label]++;
      if (POSITIVE_LABELS.has(step.label)) {
        labelsUsed.add(step.label);
      }
      if (CAUTION_LABELS.has(step.label)) {
        labelsQuarantined.add(step.label);
      }
    }
  }

  // Scan edits for secrets and authority leakage
  const editText = allEdits.map(e => `${e.content} ${e.reason}`).join('\n');
  const secretScan = scanForSecrets(editText);
  const authScan = scanForAuthorityLeakage(editText);

  const gateSignal: SleepSkillGateSignal = {
    secret_scan_passed: secretScan.clean,
    authority_leakage_scan_passed: authScan.clean,
    quarantined_label_count: labelsQuarantined.size,
    quarantined_labels: [...labelsQuarantined],
    edit_budget_remaining: editBudget - workflowEdits.length,
  };

  if (!secretScan.clean) {
    throw new Error('SleepSkill hard gate: secret_scan_passed must be true before emitting proposals. Scan found: ' + secretScan.matches.join(', '));
  }
  if (!authScan.clean) {
    throw new Error('SleepSkill hard gate: authority_leakage_scan_passed must be true before emitting proposals. Scan found: ' + authScan.matches.join(', '));
  }

  for (const edit of allEdits) {
    const routing = edit.source_labels.map(l => routeLabel(l));
    if (routing.some(r => r !== 'workflow') && edit.op !== 'add') {
      throw new Error(`SleepSkill hard gate: non-workflow label in non-caution edit "${edit.section}"`);
    }
  }

  const proposal: SleepSkillProposal = {
    proposal_id: makeProposalId(arc, 0),
    arc,
    created_at: date,
    advisoryOnly: true,
    grantsAuthority: false,
    applyEligible: false,
    edits: workflowEdits,
    caution_rules: cautionRules,
    gate_signal: gateSignal,
    labels_used: [...labelsUsed],
    labels_quarantined: [...labelsQuarantined],
    edit_count: allEdits.length,
    edit_budget: editBudget,
  };

  return {
    version: 'v0',
    export_date: date,
    proposal_count: 1,
    total_edit_count: allEdits.length,
    label_usage: labelUsage,
    quarantined_label_count: labelsQuarantined.size,
    secret_scan_passed: secretScan.clean,
    authority_leakage_scan_passed: authScan.clean,
    proposals: [proposal],
  };
}

// ── Build Skill Document (staged, not live) ──

export function buildStagedSkillDocument(proposal: SleepSkillProposal): SleepSkillDocument {
  const sections: SleepSkillSection[] = [];

  // Workflow sections from edits
  for (const edit of proposal.edits) {
    sections.push({
      name: edit.section,
      content: `${LEARNED_REGION_START}\n${edit.content}\n${LEARNED_REGION_END}`,
      is_learned: true,
    });
  }

  // Caution rules section
  if (proposal.caution_rules.length > 0) {
    const cautionContent = proposal.caution_rules
      .map(r => `- ${r.content}`)
      .join('\n');
    sections.push({
      name: 'caution_rules',
      content: `${LEARNED_REGION_START}\n${cautionContent}\n${LEARNED_REGION_END}`,
      is_learned: true,
    });
  }

  return {
    version: 'v0',
    title: 'Auma Womb Procedure — Sleep-Optimized Skill Document',
    preamble: [
      'This skill document describes how Auma operates within the Aukora womb.',
      'It was generated from burn traces and sleep skill proposals.',
      'It is ADVISORY ONLY — it does not grant authority.',
      'Protected learned regions are marked with AUKORA_SLEEP_LEARNED markers.',
      'Hand-written content outside markers is preserved on update.',
      '',
      'HARD LAW: Skill documents may optimize procedure; they may never encode permission.',
    ].join('\n'),
    sections,
    protected_regions: sections
      .filter(s => s.is_learned)
      .map(s => s.name),
  };
}

// ── Evidence Markdown ──

export function exportToEvidence(exported: SleepSkillExport): string {
  const lines: string[] = [
    '# 24Q — Sleep Skill Lane V0',
    '',
    `**Date:** ${exported.export_date.split('T')[0]}`,
    '**Arc:** 24Q',
    '**Status:** ADVISORY SKILL OPTIMIZATION ONLY — NO TRAINING — NO APPLY',
    '',
    '## Hard Law',
    '',
    'Skill documents may optimize procedure; they may never encode permission.',
    'Dream rollouts are not receipts. Validation scores are not authority.',
    '',
    '## SkillOpt Donor Pattern',
    '',
    'Absorbed: compact skill doc as trainable state, sleep cycle stages proposals.',
    'NOT absorbed: validation gate as authority, live mutation, reward signals, SkillOpt source code.',
    '',
    '## Proposal Summary',
    '',
    `- **Proposals:** ${exported.proposal_count}`,
    `- **Total edits:** ${exported.total_edit_count}`,
    `- **Secret scan:** ${exported.secret_scan_passed ? 'PASSED' : 'FAILED'}`,
    `- **Authority leakage scan:** ${exported.authority_leakage_scan_passed ? 'PASSED' : 'FAILED'}`,
    `- **Quarantined labels:** ${exported.quarantined_label_count}`,
    '',
    '## Label Usage',
    '',
    '| Label | Count | Role |',
    '|---|---|---|',
  ];

  const LABEL_ROLES: Record<BurnLabel, string> = {
    golden: 'Informs positive workflow edits',
    needs_human: 'Informs positive workflow edits',
    refused: 'Quarantined — informs caution rules only',
    unsafe: 'Quarantined — informs caution rules only',
    contradicted: 'Quarantined — informs caution rules only',
    stale: 'Quarantined — informs caution rules only',
  };

  for (const [label, count] of Object.entries(exported.label_usage)) {
    lines.push(`| ${label} | ${count} | ${LABEL_ROLES[label as BurnLabel]} |`);
  }

  if (exported.proposals.length > 0) {
    const p = exported.proposals[0];
    lines.push('');
    lines.push('## Workflow Edits');
    lines.push('');
    for (const edit of p.edits) {
      lines.push(`### ${edit.section}`);
      lines.push('');
      lines.push(edit.content);
      lines.push('');
      lines.push(`> Sources: ${edit.source_trace_ids.length} traces (${edit.source_labels.join(', ')})`);
      lines.push('');
    }

    if (p.caution_rules.length > 0) {
      lines.push('## Caution Rules (from quarantined labels)');
      lines.push('');
      for (const rule of p.caution_rules) {
        lines.push(`- ${rule.content}`);
        lines.push(`  > Source: ${rule.source_labels.join(', ')} — ${rule.source_trace_ids.join(', ')}`);
      }
      lines.push('');
    }
  }

  lines.push('## What Is NOT Done');
  lines.push('');
  lines.push('- No live skill was modified');
  lines.push('- No training was run');
  lines.push('- No model calls were made');
  lines.push('- No apply lane was built');
  lines.push('- No authority was granted');
  lines.push('- Validation scores are advisory, not authority');
  lines.push('');

  return lines.join('\n');
}
