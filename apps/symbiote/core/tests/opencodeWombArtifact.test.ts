import { describe, it, expect } from 'vitest';
import { buildAdvisoryArtifact, buildLoopArtifact, validateArtifact, OpenCodeAdvisoryArtifact, LoopIterationState } from '../src/opencodeWombArtifact';
import { SwarmReviewResult } from '../src/fusionSwarm';
import { SpendCheck } from '../src/opencodeWombArtifact';
import { ConnectivityReport } from '../src/organismConnectivity';

function makeFusionResult(overrides: Partial<SwarmReviewResult> = {}): SwarmReviewResult {
  return {
    advisory_only: true,
    authority_granted: false,
    memory_updated: false,
    gate_changed: false,
    key_source: 'process.env',
    plan: [],
    results: [
      {
        model: 'z-ai/glm-5.2',
        lens: 'security',
        label: 'glm-5.2:security',
        durationMs: 1200,
        adapterFailure: false,
        verdict: 'GREEN',
        findings: 'No issues found.',
        risks: 'Low risk.',
        missing_tests: 'None.',
        recommended_next_commit: 'Proceed with bridge.',
        confidence: 8,
      },
    ],
    synthesis: {
      completed_count: 1,
      failure_count: 0,
      green_count: 1,
      yellow_count: 0,
      red_count: 0,
      disagreement_score: 0,
      consensus: 'GREEN',
      failures: [],
    },
    ...overrides,
  };
}

function makeConnectivity(overrides: Partial<ConnectivityReport> = {}): ConnectivityReport {
  return {
    timestamp: '2026-06-18T00:00:00Z',
    nodes: [],
    edges: [],
    forbidden_crossings: [],
    missing_tests: [],
    unwired: [],
    summary: { connected: 8, unwired: 1, forbidden_violations: 0, missing_test_count: 3 },
    ...overrides,
  };
}

function makeSpend(overrides: Partial<SpendCheck> = {}): SpendCheck {
  return {
    status: 'GREEN',
    running: [],
    stopped: [],
    warnings: [],
    ...overrides,
  };
}

describe('23A: OpenCode Womb Artifact', () => {
  it('produces valid advisory artifact from GREEN council', () => {
    const artifact = buildAdvisoryArtifact(makeFusionResult(), null, makeConnectivity());
    expect(artifact.advisory_only).toBe(true);
    expect(artifact.consensus).toBe('GREEN');
    expect(artifact.findings_summary).toContain('glm-5.2:security: GREEN');
    expect(artifact.timestamp).toBeTruthy();
    const v = validateArtifact(artifact);
    expect(v.valid).toBe(true);
  });

  it('maps NO_QUORUM to RED', () => {
    const result = makeFusionResult({
      results: [],
      synthesis: {
        completed_count: 0, failure_count: 0,
        green_count: 0, yellow_count: 0, red_count: 0,
        disagreement_score: 0, consensus: 'NO_QUORUM', failures: [],
      },
    });
    const artifact = buildAdvisoryArtifact(result, null, null);
    expect(artifact.consensus).toBe('RED');
  });

  it('includes spend warnings in risks', () => {
    const spend = makeSpend({ status: 'RED', warnings: ['UNAPPROVED RUNNING: qwen-72b'] });
    const artifact = buildAdvisoryArtifact(makeFusionResult(), spend, null);
    expect(artifact.risks_summary).toContain('Nebius spend: RED');
    expect(artifact.risks_summary).toContain('UNAPPROVED RUNNING');
  });

  it('includes connectivity unwired in risks', () => {
    const conn = makeConnectivity({ unwired: ['loop -> reviewer: not wired'] });
    const artifact = buildAdvisoryArtifact(makeFusionResult(), null, conn);
    expect(artifact.risks_summary).toContain('unwired');
    expect(artifact.risks_summary).toContain('loop -> reviewer');
  });

  it('adapter failures are labeled, not counted as verdicts', () => {
    const result = makeFusionResult({
      results: [
        {
          model: 'moonshotai/kimi-k2.6', lens: 'cohesion', label: 'kimi:cohesion',
          durationMs: 500, adapterFailure: true,
          verdict: 'RED', findings: 'timeout', risks: '', missing_tests: '',
          recommended_next_commit: '', confidence: 0,
        },
      ],
      synthesis: {
        completed_count: 0, failure_count: 1,
        green_count: 0, yellow_count: 0, red_count: 0,
        disagreement_score: 0, consensus: 'NO_QUORUM', failures: [],
      },
    });
    const artifact = buildAdvisoryArtifact(result, null, null);
    expect(artifact.findings_summary).toContain('adapter failure');
    expect(artifact.findings_summary).toContain('not counted');
  });

  it('scrubs forbidden patterns from findings', () => {
    const result = makeFusionResult();
    result.results[0].findings = 'Found key: sk-or-abcdefghijklmnopqr and nonce_abc123';
    const artifact = buildAdvisoryArtifact(result, null, null);
    expect(artifact.findings_summary).not.toContain('sk-or-');
    expect(artifact.findings_summary).not.toContain('nonce_abc');
    const v = validateArtifact(artifact);
    expect(v.valid).toBe(true);
  });

  it('truncates oversized fields', () => {
    const result = makeFusionResult();
    result.results[0].findings = 'x'.repeat(5000);
    const artifact = buildAdvisoryArtifact(result, null, null);
    expect(artifact.findings_summary.length).toBeLessThanOrEqual(2100);
  });

  it('validation rejects artifact with forbidden pattern that slipped through', () => {
    const artifact: OpenCodeAdvisoryArtifact = {
      consensus: 'GREEN',
      findings_summary: 'signedHead=abc123def456',
      risks_summary: 'ok',
      recommended_next: 'ok',
      timestamp: '2026-06-18T00:00:00Z',
      advisory_only: true,
    };
    const v = validateArtifact(artifact);
    expect(v.valid).toBe(false);
    expect(v.violations.length).toBeGreaterThan(0);
  });

  it('never sets authority_granted or gate_changed', () => {
    const artifact = buildAdvisoryArtifact(makeFusionResult(), makeSpend(), makeConnectivity());
    expect(artifact.advisory_only).toBe(true);
    expect((artifact as any).authority_granted).toBeUndefined();
    expect((artifact as any).gate_changed).toBeUndefined();
  });
});

describe('23C: Loop Artifact Builder', () => {
  function makeLoopState(overrides: Partial<LoopIterationState> = {}): LoopIterationState {
    return {
      testsPassed: 340,
      testsFailed: 0,
      testFiles: 21,
      connectivity: makeConnectivity(),
      priorArtifact: null,
      patchDescription: '23C: first patch loop iteration',
      ...overrides,
    };
  }

  it('produces YELLOW when tests pass but edges are unwired', () => {
    const state = makeLoopState({
      connectivity: makeConnectivity({ unwired: ['loop -> reviewer: intentional'] }),
    });
    const artifact = buildLoopArtifact(state);
    expect(artifact.consensus).toBe('YELLOW');
    expect(artifact.advisory_only).toBe(true);
    const v = validateArtifact(artifact);
    expect(v.valid).toBe(true);
  });

  it('produces GREEN when tests pass, no unwired, no violations', () => {
    const state = makeLoopState({
      connectivity: makeConnectivity({ summary: { connected: 16, unwired: 0, forbidden_violations: 0, missing_test_count: 0 } }),
    });
    const artifact = buildLoopArtifact(state);
    expect(artifact.consensus).toBe('GREEN');
  });

  it('produces RED when tests fail', () => {
    const state = makeLoopState({ testsFailed: 3 });
    const artifact = buildLoopArtifact(state);
    expect(artifact.consensus).toBe('RED');
    expect(artifact.risks_summary).toContain('3 test(s) failed');
  });

  it('produces RED when forbidden violations exist', () => {
    const state = makeLoopState({
      connectivity: makeConnectivity({ summary: { connected: 16, unwired: 0, forbidden_violations: 2, missing_test_count: 0 } }),
    });
    const artifact = buildLoopArtifact(state);
    expect(artifact.consensus).toBe('RED');
    expect(artifact.risks_summary).toContain('forbidden crossing');
  });

  it('includes patch description in findings', () => {
    const state = makeLoopState({ patchDescription: 'add loop runner' });
    const artifact = buildLoopArtifact(state);
    expect(artifact.findings_summary).toContain('add loop runner');
  });

  it('includes test counts in findings', () => {
    const state = makeLoopState({ testsPassed: 340, testsFailed: 0, testFiles: 21 });
    const artifact = buildLoopArtifact(state);
    expect(artifact.findings_summary).toContain('340/340 passed');
    expect(artifact.findings_summary).toContain('21 files');
  });

  it('includes prior artifact consensus in findings when available', () => {
    const prior: OpenCodeAdvisoryArtifact = {
      consensus: 'RED',
      findings_summary: 'old',
      risks_summary: 'old',
      recommended_next: 'old',
      timestamp: '2026-06-18T00:00:00Z',
      advisory_only: true,
    };
    const state = makeLoopState({ priorArtifact: prior });
    const artifact = buildLoopArtifact(state);
    expect(artifact.findings_summary).toContain('Prior consensus: RED');
  });

  it('recommends fixing tests when tests fail', () => {
    const state = makeLoopState({ testsFailed: 1 });
    const artifact = buildLoopArtifact(state);
    expect(artifact.recommended_next).toContain('Fix failing tests');
  });

  it('recommends next improvement when all clear', () => {
    const state = makeLoopState({
      connectivity: makeConnectivity({
        summary: { connected: 16, unwired: 0, forbidden_violations: 0, missing_test_count: 0 },
        missing_tests: [],
      }),
    });
    const artifact = buildLoopArtifact(state);
    expect(artifact.recommended_next).toContain('propose next organism improvement');
  });

  it('surfaces high-priority missing tests in risks', () => {
    const state = makeLoopState({
      connectivity: makeConnectivity({
        missing_tests: [
          { area: 'receipts', description: 'receipt chain truncation attack', priority: 'high' },
          { area: 'live_cohesion', description: 'live 32B model', priority: 'low' },
        ],
      }),
    });
    const artifact = buildLoopArtifact(state);
    expect(artifact.risks_summary).toContain('receipt chain truncation');
    expect(artifact.risks_summary).not.toContain('live 32B');
  });
});
