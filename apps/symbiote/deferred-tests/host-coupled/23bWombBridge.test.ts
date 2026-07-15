import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { generateConnectivityReport } from '../src/organismConnectivity';

const EDGE_ROOT = path.resolve(__dirname, '..');
const ARTIFACT_PATH = path.resolve(EDGE_ROOT, 'evidence/opencode-womb-advisory.json');
const BRIDGE_SRC = fs.readFileSync(path.resolve(EDGE_ROOT, 'src/opencodeWombArtifact.ts'), 'utf-8');
const RUNNER_SRC = fs.readFileSync(path.resolve(EDGE_ROOT, 'evidence/write-opencode-womb-artifact.ts'), 'utf-8');
const OPENCODE_ADVISORY_SRC = fs.existsSync(
  path.resolve(EDGE_ROOT, '../opencode-lab/opencode-dev/packages/core/src/system-context/aukora-fusion-advisory.ts')
)
  ? fs.readFileSync(
      path.resolve(EDGE_ROOT, '../opencode-lab/opencode-dev/packages/core/src/system-context/aukora-fusion-advisory.ts'),
      'utf-8',
    )
  : '';

describe('23B: Womb bridge artifact is scrubbed', () => {
  const artifactExists = fs.existsSync(ARTIFACT_PATH);

  it('opencode-womb-advisory.json exists', () => {
    expect(artifactExists).toBe(true);
  });

  it('artifact has advisory_only: true', () => {
    if (!artifactExists) return;
    const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf-8'));
    expect(artifact.advisory_only).toBe(true);
  });

  it('artifact has valid consensus value', () => {
    if (!artifactExists) return;
    const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf-8'));
    expect(['GREEN', 'YELLOW', 'RED']).toContain(artifact.consensus);
  });

  it('artifact contains no OpenRouter key pattern', () => {
    if (!artifactExists) return;
    const raw = fs.readFileSync(ARTIFACT_PATH, 'utf-8');
    expect(raw).not.toMatch(/sk-or-[a-zA-Z0-9_-]{16,}/);
  });

  it('artifact contains no Bearer token', () => {
    if (!artifactExists) return;
    const raw = fs.readFileSync(ARTIFACT_PATH, 'utf-8');
    expect(raw).not.toMatch(/Bearer\s+[a-zA-Z0-9_.-]{10,}/i);
  });

  // 24Z.35: the builderSignature block is PUBLIC attestation material (an Ed25519 public key + a signature, meant to
  // be shipped and verified; the PRIVATE key is gitignored). It is NOT a secret, so redact it before the secret-scan —
  // same treatment as projectionHash. (The signature itself proves tamper-evidence; leaking it leaks nothing.)
  const redactBuilderSig = (s: string) => s.replace(/"builderSignature":\s*\{[^}]*\}/g, '"builderSignature":"REDACTED"');

  it('artifact contains no hex key (64 chars) outside projectionHash + builder signature', () => {
    if (!artifactExists) return;
    const raw = redactBuilderSig(fs.readFileSync(ARTIFACT_PATH, 'utf-8'));
    const scrubbed = raw.replace(/"projectionHash":\s*"[a-fA-F0-9]{64}"/g, '"projectionHash":"REDACTED"');
    expect(scrubbed).not.toMatch(/\b[a-fA-F0-9]{64}\b/);
  });

  it('artifact contains no PQ signature (96+ hex chars) outside the public builder signature', () => {
    if (!artifactExists) return;
    const raw = redactBuilderSig(fs.readFileSync(ARTIFACT_PATH, 'utf-8'));
    expect(raw).not.toMatch(/\b[a-fA-F0-9]{96,}\b/);
  });

  it('artifact contains no receipt IDs', () => {
    if (!artifactExists) return;
    const raw = fs.readFileSync(ARTIFACT_PATH, 'utf-8');
    expect(raw).not.toMatch(/\b(?:receipt|rcpt)_[a-zA-Z0-9_-]{8,}/i);
  });

  it('artifact contains no nonce values', () => {
    if (!artifactExists) return;
    const raw = fs.readFileSync(ARTIFACT_PATH, 'utf-8');
    expect(raw).not.toMatch(/\bnonce_[a-zA-Z0-9_.]+/);
  });

  it('artifact contains no VK payload IDs', () => {
    if (!artifactExists) return;
    let raw = fs.readFileSync(ARTIFACT_PATH, 'utf-8');
    raw = raw.replace(/vk_chronos_parked_safety/g, 'SHARD_REDACTED');
    expect(raw).not.toMatch(/\bvk_[a-zA-Z0-9_-]{8,}/i);
  });

  it('artifact contains no signedHead assignments', () => {
    if (!artifactExists) return;
    const raw = fs.readFileSync(ARTIFACT_PATH, 'utf-8');
    expect(raw).not.toMatch(/signedHead["']?\s*[:=]/i);
  });

  it('artifact contains no merkleRoot values', () => {
    if (!artifactExists) return;
    const raw = fs.readFileSync(ARTIFACT_PATH, 'utf-8');
    expect(raw).not.toMatch(/merkleRoot["']?\s*[:=]\s*["']?[a-fA-F0-9]{32,}/i);
  });
});

describe('23B: Bridge imports no authority', () => {
  const FORBIDDEN_AUTHORITY = [
    'evaluateIntent',
    'executeDecision',
    'signPoP',
    'PrincipalRegistry',
    'NonceLedger',
    'getAndCheckEdgeNodeSeed',
    'EDGE_NODE_PUBLIC_KEY',
    'PINNED_EDGE_NODE_PUBLIC_KEY',
  ];

  for (const term of FORBIDDEN_AUTHORITY) {
    it(`opencodeWombArtifact.ts does not import: ${term}`, () => {
      expect(BRIDGE_SRC).not.toContain(term);
    });

    it(`write-opencode-womb-artifact.ts does not import: ${term}`, () => {
      expect(RUNNER_SRC).not.toContain(term);
    });
  }
});

describe('23B: OpenCode advisory cannot authorize actions', () => {
  it('OpenCode advisory source has FORBIDDEN_PATTERNS denylist', () => {
    expect(OPENCODE_ADVISORY_SRC).toContain('FORBIDDEN_PATTERNS');
  });

  it('OpenCode advisory source has containsForbiddenContent check', () => {
    expect(OPENCODE_ADVISORY_SRC).toContain('containsForbiddenContent');
  });

  it('OpenCode advisory rejects tainted artifact (returns unavailable)', () => {
    expect(OPENCODE_ADVISORY_SRC).toContain('unavailable');
  });

  it('OpenCode advisory does not import gate, executor, PoP, or private seed', () => {
    const srcWithoutDetectionPatterns = OPENCODE_ADVISORY_SRC
      .split('\n')
      .filter((line: string) => !line.trim().startsWith('/\\b'))
      .join('\n');
    expect(srcWithoutDetectionPatterns).not.toContain('evaluateIntent');
    expect(srcWithoutDetectionPatterns).not.toContain('executeDecision');
    expect(srcWithoutDetectionPatterns).not.toContain('signPoP');
    expect(srcWithoutDetectionPatterns).not.toContain('EDGE_NODE_SEED');
  });

  it('OpenCode advisory renders as advisory-only tag', () => {
    expect(OPENCODE_ADVISORY_SRC).toContain('Advisory only');
    expect(OPENCODE_ADVISORY_SRC).toContain('no authority granted');
  });
});

describe('23B: Organism connectivity sees the bridge', () => {
  const report = generateConnectivityReport();

  it('womb_artifact_builder node exists and is found', () => {
    const node = report.nodes.find(n => n.name === 'womb_artifact_builder');
    expect(node).toBeDefined();
    expect(node!.exists).toBe(true);
  });

  it('fusion_swarm node exists and is found', () => {
    const node = report.nodes.find(n => n.name === 'fusion_swarm');
    expect(node).toBeDefined();
    expect(node!.exists).toBe(true);
  });

  it('edge: fusion_swarm -> womb_artifact_builder is verified', () => {
    const edge = report.edges.find(e => e.from === 'fusion_swarm' && e.to === 'womb_artifact_builder');
    expect(edge).toBeDefined();
    expect(edge!.type).toBe('advisory');
    expect(edge!.verified).toBe(true);
  });

  it('edge: womb_artifact_builder -> opencode_advisory is verified', () => {
    const edge = report.edges.find(e => e.from === 'womb_artifact_builder' && e.to === 'opencode_advisory');
    expect(edge).toBeDefined();
    expect(edge!.type).toBe('advisory');
    expect(edge!.verified).toBe(true);
  });

  it('womb_artifact_builder -> gate boundary is not violated', () => {
    const crossing = report.forbidden_crossings.find(
      f => f.from === 'womb_artifact_builder' && f.to === 'gate',
    );
    expect(crossing).toBeDefined();
    expect(crossing!.violated).toBe(false);
  });

  it('womb_artifact_builder -> executor boundary is not violated', () => {
    const crossing = report.forbidden_crossings.find(
      f => f.from === 'womb_artifact_builder' && f.to === 'executor',
    );
    expect(crossing).toBeDefined();
    expect(crossing!.violated).toBe(false);
  });

  it('womb_artifact_builder -> crypto boundary is not violated', () => {
    const crossing = report.forbidden_crossings.find(
      f => f.from === 'womb_artifact_builder' && f.to === 'crypto',
    );
    expect(crossing).toBeDefined();
    expect(crossing!.violated).toBe(false);
  });

  it('zero forbidden crossing violations in entire report', () => {
    expect(report.summary.forbidden_violations).toBe(0);
  });

  it('active_inference_loop -> external_reviewer is explicitly unwired', () => {
    const unwiredEntry = report.unwired.find(u => u.includes('active_inference_loop') && u.includes('external_reviewer'));
    expect(unwiredEntry).toBeDefined();
    expect(unwiredEntry).toContain('intentionally unwired');
  });

  it('artifact bridge is no longer listed as unwired (artifact file exists)', () => {
    const unwiredEntry = report.unwired.find(u => u.includes('fusion_artifact_bridge') && u.includes('no scrubbed artifact'));
    expect(unwiredEntry).toBeUndefined();
  });
});

describe('23B: Adapter failures are not RED votes', () => {
  it('fusionSwarm tags adapter failures on each result', () => {
    const swarmSrc = fs.readFileSync(path.resolve(EDGE_ROOT, 'src/fusionSwarm.ts'), 'utf-8');
    expect(swarmSrc).toContain('adapterFailure');
  });

  it('fusionConfig synthesis filters adapter failures from verdict counts', () => {
    const configSrc = fs.readFileSync(path.resolve(EDGE_ROOT, 'src/fusionConfig.ts'), 'utf-8');
    expect(configSrc).toContain('adapterFailure');
    expect(configSrc).toContain('failure_count');
  });

  it('synthesizeSwarmResults excludes adapter failures via classifyVote -> non_vote (24Z.2.1)', () => {
    const configSrc = fs.readFileSync(path.resolve(EDGE_ROOT, 'src/fusionConfig.ts'), 'utf-8');
    // 24Z.2.1: exclusion now runs through classifyVote (adapterFailure -> 'non_vote'), not a raw filter.
    expect(configSrc).toContain('classifyVote');
    expect(configSrc).toContain("if (r.adapterFailure) return 'non_vote'");
    expect(configSrc).toContain("classifyVote(r) === 'RED'");
  });

  it('bridge artifact labels adapter failures as not counted', () => {
    expect(BRIDGE_SRC).toContain('adapter failure');
    expect(BRIDGE_SRC).toContain('not counted');
  });
});
