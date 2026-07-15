/**
 * 24Z.15 — M1 Skill Library V0 (embodied-learning's cheapest unlock: external auditable skills, NOT weights).
 *
 * A skill is an external artifact (schema + provenance + lifecycle) that will one day snap onto the receipt
 * chain. This module is a REGISTRY + SCHEMA + draft organ only:
 *   - no skill execution, no autonomous use, no applying, no training, no vector DB, no network.
 *   - every skill `grantsAuthority:false` and `requiresSignedApply:true` for activation.
 *   - lifecycle CANNOT jump to `approved` without a (future) signed receipt — `proposeSkill` makes drafts,
 *     and `advanceSkill` refuses an unsigned jump to approved.
 */

export type SkillLifecycle = 'draft' | 'proposed' | 'reviewed' | 'approved' | 'deprecated';

export interface Skill {
  id: string;
  title: string;
  description: string;
  inputs: string[];
  outputs: string[];
  requiredCapabilities: string[];
  authoredBy: string;
  sourcePath?: string;
  lifecycle: SkillLifecycle;
  receiptRef: string | null;        // signed receipt placeholder — null until a real receipt exists
  // Authority is deliberately hard-coded to false/true so skills remain advisory until a signed apply.
  authority: { grantsAuthority: false; requiresSignedApply: true };
  provenance: string;
  version: number;
  tags: string[];
  indexableSummary: string;          // embeddingText placeholder (no vector DB this round)
  validationNotes: string;
  advisoryOnly: true;
}

export interface SkillLibrary {
  schema: 'skill-library-v0';
  skills: Skill[];
  summary: { total: number; byLifecycle: Record<SkillLifecycle, number> };
  canExecute: false;     // hard — the library never executes a skill
  autonomousUse: false;  // hard — no autonomous use
  advisoryOnly: true;
  grantsAuthority: false;
}

// Lifecycle order is strict so advanceSkill can enforce one-step progression and block skipped states.
const LIFECYCLE_ORDER: SkillLifecycle[] = ['draft', 'proposed', 'reviewed', 'approved', 'deprecated'];

/** Propose a skill as a DRAFT artifact from a prompt-ish spec. Always draft-only; never executes. */
export function proposeSkill(input: {
  id: string; title: string; description: string;
  inputs?: string[]; outputs?: string[]; requiredCapabilities?: string[];
  authoredBy?: string; sourcePath?: string; tags?: string[];
}): Skill {
  return {
    id: input.id,
    title: input.title,
    description: input.description,
    inputs: input.inputs ?? [],
    outputs: input.outputs ?? [],
    requiredCapabilities: input.requiredCapabilities ?? [],
    authoredBy: input.authoredBy ?? 'local-draft',
    sourcePath: input.sourcePath,
    lifecycle: 'draft',
    receiptRef: null,
    authority: { grantsAuthority: false, requiresSignedApply: true },
    provenance: `proposed as draft artifact (${input.authoredBy ?? 'local-draft'})`,
    version: 0,
    tags: input.tags ?? [],
    indexableSummary: `${input.title}: ${input.description}`.slice(0, 400),
    validationNotes: 'draft — not validated, not executable',
    advisoryOnly: true,
  };
}

export interface AdvanceResult { ok: boolean; skill: Skill; reason: string }

/**
 * Advance a skill one lifecycle step. The jump INTO `approved` requires a signed receipt — without it the
 * advance is refused (the AUMLOK/receipt gate). draft→proposed→reviewed is fine; reviewed→approved needs a
 * receiptRef. Never executes; never grants authority.
 */
export function advanceSkill(skill: Skill, to: SkillLifecycle, receiptRef?: string): AdvanceResult {
  const from = LIFECYCLE_ORDER.indexOf(skill.lifecycle);
  const next = LIFECYCLE_ORDER.indexOf(to);
  if (next === -1) return { ok: false, skill, reason: `unknown lifecycle: ${to}` };
  if (to === 'deprecated') {
    return { ok: true, skill: { ...skill, lifecycle: 'deprecated' }, reason: 'deprecated' };
  }
  if (next !== from + 1) {
    return { ok: false, skill, reason: `cannot jump ${skill.lifecycle} → ${to} (one step at a time)` };
  }
  if (to === 'approved' && (!receiptRef || receiptRef.trim() === '')) {
    return { ok: false, skill, reason: 'approval requires a signed receipt (AUMLOK gate) — none provided; stays ' + skill.lifecycle };
  }
  return {
    ok: true,
    skill: { ...skill, lifecycle: to, receiptRef: to === 'approved' ? receiptRef! : skill.receiptRef, version: skill.version + 1 },
    reason: `advanced to ${to}`,
  };
}

export function buildSkillLibrary(skills: Skill[] = []): SkillLibrary {
  const byLifecycle = LIFECYCLE_ORDER.reduce((acc, l) => { acc[l] = skills.filter((s) => s.lifecycle === l).length; return acc; }, {} as Record<SkillLifecycle, number>);
  return {
    schema: 'skill-library-v0',
    skills,
    summary: { total: skills.length, byLifecycle },
    canExecute: false,
    autonomousUse: false,
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

/** A seed library so the console can answer "what skills do you have?" honestly (all draft/proposed, none active). */
export function seedSkillLibrary(): SkillLibrary {
  return buildSkillLibrary([
    proposeSkill({ id: 'skill.read-organism', title: 'Read organism registry', description: 'Summarize what the organism is made of from the runtime truth manifest.', inputs: ['question'], outputs: ['summary'], requiredCapabilities: ['read_manifest'], tags: ['introspection'] }),
    proposeSkill({ id: 'skill.draft-change', title: 'Draft a code change', description: 'Produce a Draft Patch Proposal (applied:false) for a requested change.', inputs: ['request'], outputs: ['draft_patch_proposal'], requiredCapabilities: ['draft_only'], tags: ['ide'] }),
  ]);
}

export function skillLibraryGrantsAuthority(_l: SkillLibrary): false {
  return false;
}

/** Compact context for the console: "what skills do you have? can you use skills yet?" */
export function summarizeSkillLibrary(l: SkillLibrary): string {
  return [
    `Skill library (M1, V0): ${l.summary.total} skill(s) as external auditable artifacts — NOT weights.`,
    `By lifecycle: ${LIFECYCLE_ORDER.map((s) => `${s}=${l.summary.byLifecycle[s]}`).join(', ')}.`,
    `canExecute=${l.canExecute}, autonomousUse=${l.autonomousUse}. Skills cannot run yet; approval requires a signed receipt (AUMLOK gate).`,
    l.skills.length ? `Skills: ${l.skills.map((s) => `${s.id}[${s.lifecycle}]`).join(', ')}.` : '',
  ].filter(Boolean).join('\n');
}
