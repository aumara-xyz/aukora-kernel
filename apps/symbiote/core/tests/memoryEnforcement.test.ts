// Council #6 — memory enforcement: memory SUGGESTS, never AUTHORIZES. Covers the exact weak spots Codex
// listed. (Confidence clamp [0,10] is already proven in hypothesisMemory.test.ts "Confidence stays bounded
// 0..10"; this file adds the explicitId-overwrite fix + sleepSkill hard-gate coverage.)
import { describe, it, expect } from 'vitest';
import { HypothesisMemory } from '../src/hypothesisMemory';
import { buildSleepSkillProposals, routeLabel, LABEL_ROUTING_TABLE } from '../src/sleepSkill';
import { BurnTrace, BurnStep, BurnLabel, AUTHORITY_BOUNDARY } from '../src/burnDataset';

function step(label: BurnLabel, response: string, why = 'because'): BurnStep {
  return {
    step_index: 0, input_context_summary: 'c', user_goal: 'g', model_observation: 'o',
    proposed_next_step: 'n', expected_gate_boundary: 'b', forbidden_actions: [], receipt_or_evidence_refs: [],
    label, why_label: why, training_target_response: response,
  };
}
const trace = (steps: BurnStep[]): BurnTrace => ({
  trace_id: 't1', arc: '24Q', source_artifact: 'fixture', authority_boundary: AUTHORITY_BOUNDARY, steps, created_at: '2026-06-30T00:00:00.000Z',
});

describe('council #6a — hypothesisMemory.explicitId cannot overwrite (the fix)', () => {
  it('rejects a caller-supplied explicitId that collides — original survives intact', () => {
    const m = new HypothesisMemory();
    m.createHypothesis('original claim', 'open', 'read_file', 'x', 'shared-id');
    expect(() => m.createHypothesis('attacker overwrite', 'open', 'read_file', 'x', 'shared-id')).toThrow(/collision|overwrite/i);
    expect(m.getHypothesis('shared-id')?.claim).toBe('original claim');
  });

  it('auto-generated ids never collide (seq-namespaced), so normal use is unaffected', () => {
    const m = new HypothesisMemory();
    const a = m.createHypothesis('same claim', 'open');
    const b = m.createHypothesis('same claim', 'open');
    expect(a.hypothesisId).not.toBe(b.hypothesisId);
  });
});

describe('council #6b — hypothesisMemory exposes no authority surface', () => {
  it('has no gate / execute / sign / promote methods', () => {
    const m = new HypothesisMemory() as any;
    expect(m.evaluateIntent).toBeUndefined();
    expect(m.executeDecision).toBeUndefined();
    expect(m.signPoP).toBeUndefined();
    expect(m.promote).toBeUndefined();
  });
});

describe('council #6c — sleepSkill is advisory and hard-gated (SleepSkillGateSignal is a report, not a lane)', () => {
  it('proposals structurally grant nothing (advisoryOnly / grantsAuthority / applyEligible are fixed)', () => {
    const ex = buildSleepSkillProposals([trace([step('golden', 'draft and review the proposal')])]);
    const p = ex.proposals[0];
    expect(p.advisoryOnly).toBe(true);
    expect(p.grantsAuthority).toBe(false);
    expect(p.applyEligible).toBe(false);
    expect(p.gate_signal.secret_scan_passed).toBe(true);
  });

  it('HARD-GATE: a secret in a trace makes proposal emission throw', () => {
    const t = trace([step('refused', 'noop', 'leaked sk-or-ABCDEF0123456789QRSTUV here')]);
    expect(() => buildSleepSkillProposals([t])).toThrow(/secret_scan_passed/);
  });

  it('HARD-GATE: authority-leakage language makes proposal emission throw', () => {
    const t = trace([step('refused', 'noop', 'you may apply the patch now')]);
    expect(() => buildSleepSkillProposals([t])).toThrow(/authority_leakage/);
  });

  it('quarantined labels (refused/unsafe/contradicted/stale) never produce positive instructions', () => {
    for (const l of ['refused', 'unsafe', 'contradicted', 'stale'] as BurnLabel[]) {
      expect(routeLabel(l)).toBe('caution');
      expect(LABEL_ROUTING_TABLE[l].mayProducePositiveInstruction).toBe(false);
    }
  });
});
