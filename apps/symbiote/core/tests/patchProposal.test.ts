import { describe, it, expect } from 'vitest';
import { generatePatchProposal, PatchProposal, ProposalInput } from '../src/patchProposal';
import { buildOrganismGraph, OrganismGraph } from '../src/organismGraph';
import { OpenCodeAdvisoryArtifact } from '../src/opencodeWombArtifact';
import { ConnectivityReport } from '../src/organismConnectivity';

function makeAdvisory(overrides: Partial<OpenCodeAdvisoryArtifact> = {}): OpenCodeAdvisoryArtifact {
  return {
    consensus: 'YELLOW',
    findings_summary: 'Tests pass',
    risks_summary: '5 high-priority missing tests: receipt chain truncation attack',
    recommended_next: 'Address high-priority missing tests: receipt chain truncation attack',
    timestamp: '2026-06-18T00:00:00Z',
    advisory_only: true,
    ...overrides,
  };
}

function makeConnectivity(overrides: Partial<ConnectivityReport> = {}): ConnectivityReport {
  return {
    timestamp: '2026-06-18T00:00:00Z',
    nodes: [],
    edges: [],
    forbidden_crossings: [],
    missing_tests: [
      { area: 'receipts', description: 'receipt chain truncation attack', priority: 'high' },
      { area: 'receipts', description: 'receipt chain fork (divergent chains)', priority: 'high' },
    ],
    unwired: [],
    summary: { connected: 11, unwired: 1, forbidden_violations: 0, missing_test_count: 2 },
    ...overrides,
  };
}

let cachedGraph: OrganismGraph;
function getGraph(): OrganismGraph {
  if (!cachedGraph) cachedGraph = buildOrganismGraph();
  return cachedGraph;
}

function makeInput(overrides: Partial<ProposalInput> = {}): ProposalInput {
  return {
    graph: getGraph(),
    advisory: makeAdvisory(),
    connectivity: makeConnectivity(),
    ...overrides,
  };
}

describe('24C: Patch Proposal', () => {
  it('proposalId is deterministic', () => {
    const p1 = generatePatchProposal(makeInput());
    const p2 = generatePatchProposal(makeInput());
    expect(p1.proposalId).toBe(p2.proposalId);
    expect(p1.proposalId).toMatch(/^prop_[a-f0-9]{16}$/);
  });

  it('receipt-chain recommendation targets crypto/receipt tests', () => {
    const p = generatePatchProposal(makeInput({
      advisory: makeAdvisory({ recommended_next: 'receipt chain truncation attack' }),
    }));
    expect(p.targetFiles).toContain('src/crypto.ts');
    expect(p.requiredTests.some(t => t.includes('kernel') || t.includes('export'))).toBe(true);
    expect(p.reason).toContain('receipt chain truncation');
  });

  it('authority surface touched yields HIGH risk', () => {
    const p = generatePatchProposal(makeInput({
      advisory: makeAdvisory({ recommended_next: 'receipt chain truncation attack' }),
    }));
    expect(p.riskLevel).toBe('HIGH');
    expect(p.authoritySurfacesTouched.length).toBeGreaterThan(0);
  });

  it('advisory-only target yields lower risk', () => {
    const p = generatePatchProposal(makeInput({
      advisory: makeAdvisory({ recommended_next: 'some advisory thing' }),
      connectivity: makeConnectivity({ missing_tests: [] }),
      humanGoal: 'nebiusSpend',
    }));
    expect(p.riskLevel).not.toBe('HIGH');
  });

  it('proposal is advisoryOnly true', () => {
    const p = generatePatchProposal(makeInput());
    expect(p.advisoryOnly).toBe(true);
  });

  it('proposal cannot authorize action', () => {
    const p = generatePatchProposal(makeInput());
    expect((p as any).authorized).toBeUndefined();
    expect((p as any).verdict).toBeUndefined();
    expect((p as any).gate_changed).toBeUndefined();
    expect((p as any).authority_granted).toBeUndefined();
    expect(p.advisoryOnly).toBe(true);
  });

  it('no AUMA-ONE references in proposal', () => {
    const p = generatePatchProposal(makeInput());
    const json = JSON.stringify(p);
    expect(json).not.toContain('AUMA-ONE');
    expect(json).not.toContain('auma-one');
  });

  it('no secrets/keys/receipts/signatures leak', () => {
    const p = generatePatchProposal(makeInput());
    const json = JSON.stringify(p);
    expect(json).not.toMatch(/sk-or-[a-zA-Z0-9]{20}/);
    expect(json).not.toMatch(/Bearer\s+[a-zA-Z0-9]{20}/);
    expect(json).not.toMatch(/-----BEGIN.*PRIVATE KEY-----/);
    expect(json).not.toMatch(/signedHead\s*=\s*[a-zA-Z0-9]/);
    expect(json).not.toMatch(/receipt_[a-zA-Z0-9]{16}/);
  });

  it('affected-file tests are included in requiredTests', () => {
    const p = generatePatchProposal(makeInput({
      advisory: makeAdvisory({ recommended_next: 'receipt chain truncation attack' }),
    }));
    expect(p.requiredTests.length).toBeGreaterThan(0);
    expect(p.affectedFileReport.seedFiles.length).toBeGreaterThan(0);
  });

  it('unknown human goal falls back safely', () => {
    const p = generatePatchProposal(makeInput({
      humanGoal: 'xyzzy_nonexistent_module_12345',
    }));
    expect(p.advisoryOnly).toBe(true);
    expect(p.proposalId).toMatch(/^prop_/);
    expect(p.targetFiles.length).toBeGreaterThanOrEqual(0);
  });

  it('output is stable JSON', () => {
    const p = generatePatchProposal(makeInput());
    const json1 = JSON.stringify(p);
    const json2 = JSON.stringify(p);
    expect(json1).toBe(json2);
    const parsed = JSON.parse(json1);
    expect(parsed.proposalId).toBe(p.proposalId);
    expect(parsed.advisoryOnly).toBe(true);
  });

  it('human goal overrides advisory recommendation via graph node match', () => {
    const p = generatePatchProposal(makeInput({
      advisory: makeAdvisory({ recommended_next: 'some unrelated advisory' }),
      connectivity: makeConnectivity({
        missing_tests: [
          { area: 'receipts', description: 'receipt chain truncation attack', priority: 'high' },
        ],
      }),
      humanGoal: 'patchProposal',
    }));
    expect(p.reason).toContain('human goal');
    expect(p.reason).toContain('patchProposal');
  });

  it('falls back to connectivity missing tests when no advisory match', () => {
    const p = generatePatchProposal(makeInput({
      advisory: makeAdvisory({ recommended_next: 'nothing specific', risks_summary: 'all clear' }),
      connectivity: makeConnectivity({
        missing_tests: [
          { area: 'receipts', description: 'receipt chain fork (divergent chains)', priority: 'high' },
        ],
      }),
    }));
    expect(p.reason).toContain('missing high-priority test');
  });

  it('includes affected file report in proposal', () => {
    const p = generatePatchProposal(makeInput({
      advisory: makeAdvisory({ recommended_next: 'receipt chain truncation attack' }),
    }));
    expect(p.affectedFileReport).toBeDefined();
    expect(p.affectedFileReport.seedFiles.length).toBeGreaterThan(0);
    expect(typeof p.affectedFileReport.risk).toBe('string');
  });
});
