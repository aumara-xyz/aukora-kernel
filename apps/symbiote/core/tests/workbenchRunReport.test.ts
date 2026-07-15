import { describe, it, expect } from 'vitest';
import { stageReport, buildRunReport, formatRunReport, summarizeToolCalls, type RunStageReport } from '../src/workbenchRunReport';

// Issue #25 follow-up (Fable QA A4): a direct unit test of the pure report formatter — no command-loop
// machinery needed, since this module has no fs/network/subprocess dependency of its own.

function fullSuccessStages(): RunStageReport[] {
  return [
    stageReport('agent', true, 'model=test-org/override-model proposalHash=abcdef0123456789...'),
    stageReport('sandbox_apply', true, 'temp-only sandbox created'),
    stageReport('content_check', true, 'content match: MATCH — ok'),
    stageReport('fusion_review', true, 'verdict=GREEN'),
    stageReport('write_receipt', true, 'persisted -> /tmp/receipt.json'),
  ];
}

describe('workbenchRunReport: summarizeToolCalls', () => {
  it('folds repeated tool calls into one aggregate line, preserving first-seen order', () => {
    const summary = summarizeToolCalls([
      { tool: 'read_file' }, { tool: 'read_file' }, { tool: 'search' }, { tool: 'read_file' }, { tool: 'propose_patch' },
    ]);
    expect(summary).toBe('read_file×3, search×1, propose_patch×1');
  });

  it('returns an empty string for zero tool calls', () => {
    expect(summarizeToolCalls([])).toBe('');
  });
});

describe('workbenchRunReport: buildRunReport terminal-state vocabulary', () => {
  it('AWAITING_OWNER_SIGNATURE iff the chain reached write_receipt and it succeeded', () => {
    const report = buildRunReport({ goal: 'g', stages: fullSuccessStages(), proposalHash: 'abc', model: 'm', receiptPath: '/tmp/r.json' });
    expect(report.terminalState).toBe('AWAITING_OWNER_SIGNATURE');
    expect(report.receiptPath).toBe('/tmp/r.json');
  });

  it('FAILED_AT: <stage> names the first failing stage, and receiptPath/signCommand are nulled even if passed in', () => {
    const stages = [stageReport('agent', true, 'ok'), stageReport('sandbox_apply', false, 'refused: sacred path')];
    const report = buildRunReport({ goal: 'g', stages, proposalHash: 'abc', model: 'm', receiptPath: '/should/be/nulled.json', signCommand: 'should also be nulled' });
    expect(report.terminalState).toBe('FAILED_AT: sandbox_apply');
    expect(report.receiptPath).toBeNull();
    expect(report.signCommand).toBeNull();
  });

  it('a synthetic throw-stage report (stageReport built by the caller\'s catch block) produces FAILED_AT for that stage', () => {
    const stages = [stageReport('agent', true, 'ok'), stageReport('sandbox_apply', true, 'ok'), stageReport('write_receipt', false, 'threw: EEXIST: file already exists')];
    const report = buildRunReport({ goal: 'g', stages, proposalHash: 'abc', model: 'm', receiptPath: null });
    expect(report.terminalState).toBe('FAILED_AT: write_receipt');
  });
});

describe('workbenchRunReport: formatRunReport — all nine items render on full success', () => {
  it('renders goal, model, tools-used aggregate, artifact path, stage-by-stage detail, Kira citations, receipt path, the exact sign command, and a rollback hint', () => {
    const report = buildRunReport({
      goal: 'add a doc note',
      stages: fullSuccessStages(),
      proposalHash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      model: 'test-org/override-model',
      receiptPath: '/tmp/aumlok/receipts/abcdef.json',
      toolCallsSummary: 'read_file×3, search×1, propose_patch×1',
      artifactPath: '/tmp/aumlok/pending-proposals/abcdef.json',
      kiraCitations: ['abcdef0123456789 (receiver)', 'fedcba9876543210 (memory)'],
      signCommand: 'bash scripts/aumlok-authority.sh sign /tmp/aumlok/pending-proposals/abcdef.json > /tmp/signed-abcdef012345.json\n  Then: apply signed proposal /tmp/signed-abcdef012345.json',
    });
    const text = formatRunReport(report);

    // 1. goal
    expect(text).toContain('add a doc note');
    // 2. model (issue AUKORA_AGENT_MODEL override string coverage)
    expect(text).toContain('test-org/override-model');
    // 3. tools-used aggregate
    expect(text).toContain('read_file×3, search×1, propose_patch×1');
    // 4. proposal artifact path
    expect(text).toContain('/tmp/aumlok/pending-proposals/abcdef.json');
    // 5. stage-by-stage detail (all 5 stages present, honest content-check labeling)
    for (const s of report.stages) expect(text).toContain(s.stage);
    expect(text).toContain('content check (simulated sandbox-content match — NOT a real test run)');
    expect(text).not.toMatch(/tests passed/i);
    // 6. Kira citations
    expect(text).toContain('abcdef0123456789 (receiver)');
    expect(text).toContain('fedcba9876543210 (memory)');
    // 7. receipt path
    expect(text).toContain('/tmp/aumlok/receipts/abcdef.json');
    // 8. the EXACT sign command lives in the final AWAITING_OWNER_SIGNATURE line, not just "see above"
    expect(text).toContain('AWAITING_OWNER_SIGNATURE');
    expect(text).toContain('bash scripts/aumlok-authority.sh sign /tmp/aumlok/pending-proposals/abcdef.json');
    expect(text).not.toMatch(/see the write_receipt stage detail above/i);
    // 9. rollback sandbox hint
    expect(text).toMatch(/rollback sandbox/i);
  });

  it('a FAILED_AT report never shows AWAITING_OWNER_SIGNATURE, a sign command, or a receipt path', () => {
    const stages = [stageReport('agent', true, 'ok'), stageReport('sandbox_apply', false, 'refused: sacred path')];
    const report = buildRunReport({ goal: 'g', stages, proposalHash: null, model: 'm', receiptPath: null });
    const text = formatRunReport(report);
    expect(text).toContain('FAILED_AT: sandbox_apply');
    expect(text).not.toContain('AWAITING_OWNER_SIGNATURE');
    expect(text).not.toContain('chain complete');
  });

  it('omits the Kira-citations line entirely when there are none (not an empty line)', () => {
    const report = buildRunReport({ goal: 'g', stages: fullSuccessStages(), proposalHash: 'abc', model: 'm', receiptPath: '/tmp/r.json', kiraCitations: null });
    expect(formatRunReport(report)).not.toMatch(/Kira recall citations/);
  });
});
