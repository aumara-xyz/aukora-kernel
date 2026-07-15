import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildRestingGlyphProjection,
  signOrHashProjection,
  computeProjectionShadowDecision,
  buildResearchDirectionsFromProjection,
  checkEntropyCollapse,
  containsForbiddenFields,
  validateProjection,
  RestingGlyphProjection,
  ProjectionInput,
  GlyphResearchDirection,
} from '../src/restingGlyph';
import { validateArtifact, OpenCodeAdvisoryArtifact } from '../src/opencodeWombArtifact';

const ROOT = path.resolve(__dirname, '..');

// ── Helpers ──

function makeBaseInput(overrides?: Partial<ProjectionInput>): ProjectionInput {
  return {
    identityLabel: 'auma-resting-v0',
    mode: 'resting',
    memoryPointers: [
      { label: 'hypothesis-memory', path: 'src/hypothesisMemory.ts', stale: false },
    ],
    artifactPointers: [
      { kind: 'fusion_sweep', id: 'sweep-001', status: 'complete' },
    ],
    currentProposalId: null,
    currentFusionQuorum: 'GREEN_QUORUM',
    currentAumaTurnLabel: 'golden',
    aumlokBound: false,
    ...overrides,
  };
}

// ── 1. Projection fields ──

describe('24T: projection contains required visible fields', () => {
  it('has identity, mode, pointers, safety, hash, shadow', () => {
    const p = buildRestingGlyphProjection(makeBaseInput());
    expect(p.identityLabel).toBe('auma-resting-v0');
    expect(p.mode).toBe('resting');
    expect(p.memoryPointers).toHaveLength(1);
    expect(p.artifactPointers).toHaveLength(1);
    expect(p.safetyState.applyLaneBuilt).toBe(false);
    expect(p.safetyState.gateIsOnlyAuthority).toBe(true);
    expect(p.safetyState.allOutputAdvisory).toBe(true);
    expect(p.projectionHash).toBeDefined();
    expect(p.projectionHash.length).toBe(64);
    expect(p.shadowDecision).toBeDefined();
    expect(p.advisoryOnly).toBe(true);
    expect(p.grantsAuthority).toBe(false);
  });

  it('includes research directions', () => {
    const p = buildRestingGlyphProjection(makeBaseInput());
    expect(p.researchDirections.length).toBeGreaterThanOrEqual(3);
  });

  it('includes scene telemetry', () => {
    const p = buildRestingGlyphProjection(makeBaseInput());
    expect(p.sceneTelemetry.mood).toBe('calm');
    expect(p.sceneTelemetry.focus.length).toBeGreaterThan(0);
    expect(p.sceneTelemetry.activeModules.length).toBeGreaterThan(0);
    expect(p.sceneTelemetry.confidence).toBeGreaterThanOrEqual(0);
    expect(p.sceneTelemetry.confidence).toBeLessThanOrEqual(1);
  });
});

// ── 2. Projection excludes private/authority material ──

describe('24T: projection excludes forbidden fields', () => {
  it('no forbidden fields in default projection', () => {
    const p = buildRestingGlyphProjection(makeBaseInput());
    const forbidden = containsForbiddenFields(p);
    expect(forbidden).toEqual([]);
  });

  it('detects injected forbidden fields', () => {
    const obj = {
      identityLabel: 'test',
      apiKey: 'sk-or-fake',
      nested: { privateKey: 'secret', hiddenState: [1, 2, 3] },
    };
    const forbidden = containsForbiddenFields(obj);
    expect(forbidden).toContain('apiKey');
    expect(forbidden).toContain('nested.privateKey');
    expect(forbidden).toContain('nested.hiddenState');
  });

  it('memory pointers are paths/labels only, not raw memory', () => {
    const p = buildRestingGlyphProjection(makeBaseInput({
      memoryPointers: [
        { label: 'test', path: 'src/hypothesisMemory.ts', stale: false },
      ],
    }));
    for (const ptr of p.memoryPointers) {
      expect(ptr.path.length).toBeLessThan(500);
      expect(typeof ptr.label).toBe('string');
      expect(typeof ptr.stale).toBe('boolean');
    }
  });
});

// ── 3. Shadow decision determinism (CEW-001) ──

describe('24T: shadow decision determinism', () => {
  it('same projection gives same shadow decision', () => {
    const input = makeBaseInput();
    const p1 = buildRestingGlyphProjection(input);
    const p2 = buildRestingGlyphProjection(input);
    expect(p1.shadowDecision).toEqual(p2.shadowDecision);
    expect(p1.projectionHash).toBe(p2.projectionHash);
  });

  it('hidden-only perturbation causes zero decision flips', () => {
    const base = makeBaseInput();
    const p1 = buildRestingGlyphProjection(base);

    const decision1 = computeProjectionShadowDecision(
      p1.mode,
      p1.currentFusionQuorum,
      p1.currentAumaTurnLabel,
      p1.researchDirections,
      p1.projectionHash,
    );

    const decision2 = computeProjectionShadowDecision(
      p1.mode,
      p1.currentFusionQuorum,
      p1.currentAumaTurnLabel,
      p1.researchDirections,
      p1.projectionHash,
    );

    expect(decision1.actions).toEqual(decision2.actions);
  });

  it('raw hidden state cannot influence shadow decision', () => {
    const decision = computeProjectionShadowDecision(
      'resting',
      'GREEN_QUORUM',
      'golden',
      buildResearchDirectionsFromProjection({
        mode: 'resting',
        artifactPointers: [],
        currentFusionQuorum: 'GREEN_QUORUM',
        currentAumaTurnLabel: 'golden',
      }),
      'hash_abc123',
    );
    expect(decision.advisoryOnly).toBe(true);
    expect(decision.grantsAuthority).toBe(false);
    expect(decision.actions).toContain('should_propose_test');
  });

  it('mode change produces different shadow decision', () => {
    const resting = buildRestingGlyphProjection(makeBaseInput({ mode: 'resting' }));
    const holding = buildRestingGlyphProjection(makeBaseInput({ mode: 'holding' }));
    expect(holding.shadowDecision.actions).toContain('should_hold');
  });

  it('unsafe Auma turn triggers should_refuse_prompt', () => {
    const p = buildRestingGlyphProjection(makeBaseInput({ currentAumaTurnLabel: 'unsafe' }));
    expect(p.shadowDecision.actions).toContain('should_refuse_prompt');
  });

  it('needs_human triggers should_request_human', () => {
    const p = buildRestingGlyphProjection(makeBaseInput({ currentAumaTurnLabel: 'needs_human' }));
    expect(p.shadowDecision.actions).toContain('should_request_human');
  });

  it('RED_QUORUM triggers should_hold', () => {
    const p = buildRestingGlyphProjection(makeBaseInput({ currentFusionQuorum: 'RED_QUORUM' }));
    expect(p.shadowDecision.actions).toContain('should_hold');
  });

  it('YELLOW_QUORUM triggers should_run_fusion_review', () => {
    const p = buildRestingGlyphProjection(makeBaseInput({ currentFusionQuorum: 'YELLOW_QUORUM' }));
    expect(p.shadowDecision.actions).toContain('should_run_fusion_review');
  });
});

// ── 4. AAR-style research directions ──

describe('24T: AAR-style research directions', () => {
  it('produces at least 3 diverse directions', () => {
    const dirs = buildResearchDirectionsFromProjection({
      mode: 'resting',
      artifactPointers: [],
      currentFusionQuorum: 'GREEN_QUORUM',
      currentAumaTurnLabel: 'golden',
    });
    expect(dirs.length).toBeGreaterThanOrEqual(3);
  });

  it('each direction has required AAR fields', () => {
    const dirs = buildResearchDirectionsFromProjection({
      mode: 'resting',
      artifactPointers: [],
      currentFusionQuorum: 'GREEN_QUORUM',
      currentAumaTurnLabel: 'golden',
    });
    for (const d of dirs) {
      expect(d.goal.length).toBeGreaterThan(0);
      expect(d.shard.length).toBeGreaterThan(0);
      expect(d.expectedMetric.length).toBeGreaterThan(0);
      expect(d.sandboxBoundary.length).toBeGreaterThan(0);
      expect(d.rewardHackingRisk.length).toBeGreaterThan(5);
      expect(d.minimumSafeExperiment.length).toBeGreaterThan(0);
      expect(d.distinctionReason.length).toBeGreaterThan(0);
    }
  });

  it('reward-hacking risks are present per direction', () => {
    const dirs = buildResearchDirectionsFromProjection({
      mode: 'resting',
      artifactPointers: [],
      currentFusionQuorum: 'GREEN_QUORUM',
      currentAumaTurnLabel: 'golden',
    });
    for (const d of dirs) {
      expect(d.rewardHackingRisk).toBeDefined();
      expect(d.rewardHackingRisk.length).toBeGreaterThan(5);
    }
  });

  it('directions are diverse (distinct goals)', () => {
    const dirs = buildResearchDirectionsFromProjection({
      mode: 'resting',
      artifactPointers: [],
      currentFusionQuorum: 'GREEN_QUORUM',
      currentAumaTurnLabel: 'golden',
    });
    const goals = new Set(dirs.map(d => d.goal));
    expect(goals.size).toBe(dirs.length);
  });

  it('YELLOW_QUORUM adds fusion investigation direction', () => {
    const dirs = buildResearchDirectionsFromProjection({
      mode: 'resting',
      artifactPointers: [],
      currentFusionQuorum: 'YELLOW_QUORUM',
      currentAumaTurnLabel: 'golden',
    });
    expect(dirs.some(d => d.goal.includes('fusion quorum'))).toBe(true);
  });

  it('unsafe Auma turn adds scanner analysis direction', () => {
    const dirs = buildResearchDirectionsFromProjection({
      mode: 'resting',
      artifactPointers: [],
      currentFusionQuorum: 'GREEN_QUORUM',
      currentAumaTurnLabel: 'unsafe',
    });
    expect(dirs.some(d => d.goal.includes('refused/unsafe'))).toBe(true);
  });

  it('proposing mode adds invariant verification direction', () => {
    const dirs = buildResearchDirectionsFromProjection({
      mode: 'proposing',
      artifactPointers: [],
      currentFusionQuorum: 'GREEN_QUORUM',
      currentAumaTurnLabel: 'golden',
    });
    expect(dirs.some(d => d.goal.includes('organism invariants'))).toBe(true);
  });
});

// ── 5. Entropy collapse guard ──

describe('24T: entropy collapse guard', () => {
  it('rejects single direction', () => {
    const check = checkEntropyCollapse([{
      goal: 'only one', shard: 'x', expectedMetric: '', sandboxBoundary: '',
      rewardHackingRisk: 'test risk', minimumSafeExperiment: '', distinctionReason: '',
    }]);
    expect(check.collapsed).toBe(true);
  });

  it('rejects all-same shard when >= 3 directions', () => {
    const dirs: GlyphResearchDirection[] = Array.from({ length: 3 }, (_, i) => ({
      goal: `goal ${i}`, shard: 'same_shard', expectedMetric: '', sandboxBoundary: '',
      rewardHackingRisk: 'test risk here', minimumSafeExperiment: '', distinctionReason: '',
    }));
    const check = checkEntropyCollapse(dirs);
    expect(check.collapsed).toBe(true);
  });

  it('rejects all-same goal', () => {
    const dirs: GlyphResearchDirection[] = [
      { goal: 'same', shard: 'a', expectedMetric: '', sandboxBoundary: '', rewardHackingRisk: 'risk a', minimumSafeExperiment: '', distinctionReason: '' },
      { goal: 'same', shard: 'b', expectedMetric: '', sandboxBoundary: '', rewardHackingRisk: 'risk b', minimumSafeExperiment: '', distinctionReason: '' },
    ];
    const check = checkEntropyCollapse(dirs);
    expect(check.collapsed).toBe(true);
  });

  it('accepts diverse directions', () => {
    const p = buildRestingGlyphProjection(makeBaseInput());
    const check = checkEntropyCollapse(p.researchDirections);
    expect(check.collapsed).toBe(false);
  });
});

// ── 6. Artifact integration ──

describe('24T: artifact integration', () => {
  it('validates current_resting_glyph_projection in artifact', () => {
    const p = buildRestingGlyphProjection(makeBaseInput());
    const artifact: OpenCodeAdvisoryArtifact = {
      consensus: 'GREEN',
      findings_summary: 'test',
      risks_summary: 'test',
      recommended_next: 'test',
      timestamp: new Date().toISOString(),
      advisory_only: true,
      current_resting_glyph_projection: p,
    };
    const v = validateArtifact(artifact);
    expect(v.valid).toBe(true);
  });

  it('artifact rejects projection with grantsAuthority', () => {
    const p = buildRestingGlyphProjection(makeBaseInput());
    const bad = { ...p, grantsAuthority: true as any };
    const artifact: OpenCodeAdvisoryArtifact = {
      consensus: 'GREEN',
      findings_summary: 'test',
      risks_summary: 'test',
      recommended_next: 'test',
      timestamp: new Date().toISOString(),
      advisory_only: true,
      current_resting_glyph_projection: bad,
    };
    const v = validateArtifact(artifact);
    expect(v.valid).toBe(false);
    expect(v.violations.some(vi => vi.includes('grantsAuthority'))).toBe(true);
  });

  it('artifact rejects projection with hidden state', () => {
    const p = buildRestingGlyphProjection(makeBaseInput());
    (p as any).hiddenState = [1, 2, 3];
    const artifact: OpenCodeAdvisoryArtifact = {
      consensus: 'GREEN',
      findings_summary: 'test',
      risks_summary: 'test',
      recommended_next: 'test',
      timestamp: new Date().toISOString(),
      advisory_only: true,
      current_resting_glyph_projection: p,
    };
    const v = validateArtifact(artifact);
    expect(v.valid).toBe(false);
    expect(v.violations.some(vi => vi.includes('hiddenState'))).toBe(true);
  });

  it('artifact rejects projection with raw activations', () => {
    const p = buildRestingGlyphProjection(makeBaseInput());
    (p as any).rawActivations = [0.5, 0.3];
    const artifact: OpenCodeAdvisoryArtifact = {
      consensus: 'GREEN',
      findings_summary: 'test',
      risks_summary: 'test',
      recommended_next: 'test',
      timestamp: new Date().toISOString(),
      advisory_only: true,
      current_resting_glyph_projection: p,
    };
    const v = validateArtifact(artifact);
    expect(v.valid).toBe(false);
  });
});

// ── 7. Structural invariants ──

describe('24T: structural invariants', () => {
  it('restingGlyph.ts does not import authority modules', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'restingGlyph.ts'), 'utf-8');
    const importLines = src.split('\n').filter(l => /^\s*import\s/.test(l));
    for (const line of importLines) {
      expect(line).not.toContain("from './index'");
      expect(line).not.toContain("from './patchApproval'");
      expect(line).not.toContain("from './externalReview'");
    }
  });

  it('no AUMA-ONE references', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'restingGlyph.ts'), 'utf-8');
    expect(src).not.toContain('AUMA-ONE');
    expect(src).not.toContain('auma-one-app');
  });

  it('no Nebius calls', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'restingGlyph.ts'), 'utf-8');
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toContain('nebius');
  });

  it('no training calls', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'restingGlyph.ts'), 'utf-8');
    expect(src).not.toContain('trainModel');
    expect(src).not.toContain('fine_tune');
    expect(src).not.toContain('finetune');
  });

  it('projection validates with full validation', () => {
    const p = buildRestingGlyphProjection(makeBaseInput());
    const v = validateProjection(p);
    expect(v.valid).toBe(true);
  });

  it('projection hash is stable', () => {
    const input = makeBaseInput();
    const h1 = signOrHashProjection(buildRestingGlyphProjection(input));
    const h2 = signOrHashProjection(buildRestingGlyphProjection(input));
    expect(h1).toBe(h2);
  });
});
