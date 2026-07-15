import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { buildOrganismGraph, getAffectedFilesForPatch, serializeGraphSafe, OrganismGraph } from '../src/organismGraph';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

describe('24B: Organism Graph', () => {
  let graph: OrganismGraph;

  it('graph generation is deterministic', () => {
    const g1 = buildOrganismGraph();
    const g2 = buildOrganismGraph();
    expect(g1.nodes.length).toBe(g2.nodes.length);
    expect(g1.edges.length).toBe(g2.edges.length);
    const ids1 = g1.nodes.map(n => n.id).sort();
    const ids2 = g2.nodes.map(n => n.id).sort();
    expect(ids1).toEqual(ids2);
    graph = g1;
  });

  it('all Rosetta layers are represented', () => {
    const g = buildOrganismGraph();
    const layers = new Set(g.nodes.filter(n => n.rosettaLayer).map(n => n.rosettaLayer));
    expect(layers.has('L01_sacred_normalizer')).toBe(true);
    expect(layers.has('L02_cryptographic_gate')).toBe(true);
    expect(layers.has('L03_receipt_chain')).toBe(true);
    expect(layers.has('L04_vk_training_rows')).toBe(true);
    expect(layers.has('L05_proposer_adapters')).toBe(true);
    expect(layers.has('L06_executor')).toBe(true);
    expect(layers.has('L07_active_inference')).toBe(true);
    expect(layers.has('L08_learner')).toBe(true);
    expect(layers.has('L09_hypothesis_memory')).toBe(true);
    expect(layers.has('L10_structural_memory')).toBe(true);
    expect(layers.has('L11_node_identity')).toBe(true);
    expect(layers.has('L12_convex_kernel')).toBe(true);
    expect(layers.has('L13_chronos')).toBe(true);
    expect(layers.has('fusion_council')).toBe(true);
    expect(layers.has('opencode_advisory')).toBe(true);
    expect(layers.size).toBeGreaterThanOrEqual(15);
  });

  it('authority and advisory edges are not conflated', () => {
    const g = buildOrganismGraph();
    const authorityEdges = g.edges.filter(e => e.kind === 'authority');
    const advisoryEdges = g.edges.filter(e => e.kind === 'advisory');
    for (const ae of authorityEdges) {
      expect(ae.kind).toBe('authority');
      expect(advisoryEdges.find(
        a => a.source === ae.source && a.target === ae.target && a.relation === ae.relation
      )).toBeUndefined();
    }
  });

  it('no AUMA-ONE references in graph output', () => {
    const g = buildOrganismGraph();
    const json = JSON.stringify(g);
    expect(json).not.toContain('AUMA-ONE');
    expect(json).not.toContain('auma-one');
  });

  it('donor code is not imported as authority', () => {
    const g = buildOrganismGraph();
    for (const edge of g.edges) {
      expect(edge.source).not.toContain('donor');
      expect(edge.target).not.toContain('donor');
    }
    for (const node of g.nodes) {
      expect(node.file).not.toContain('donor-labs');
    }
  });

  it('forbidden edges are visible as forbidden', () => {
    const g = buildOrganismGraph();
    const forbidden = g.edges.filter(e => e.kind === 'forbidden');
    expect(forbidden.length).toBeGreaterThan(0);
    for (const f of forbidden) {
      expect(f.kind).toBe('forbidden');
      expect(f.relation).toMatch(/VIOLATED|RESPECTED/);
    }
    const violated = forbidden.filter(f => f.relation.startsWith('VIOLATED'));
    expect(violated.length).toBe(0);
  });

  it('graph can be serialized into advisory-safe JSON', () => {
    const g = buildOrganismGraph();
    const json = serializeGraphSafe(g);
    expect(typeof json).toBe('string');
    const parsed = JSON.parse(json);
    expect(parsed.nodes.length).toBeGreaterThan(0);
    expect(parsed.advisory_only).toBeUndefined();
  });

  it('no keys/tokens/signatures/receipts leak into graph output', () => {
    const g = buildOrganismGraph();
    const json = serializeGraphSafe(g);
    expect(json).not.toMatch(/sk-or-[a-zA-Z0-9]{20}/);
    expect(json).not.toMatch(/Bearer\s+[a-zA-Z0-9]{20}/);
    expect(json).not.toMatch(/-----BEGIN.*PRIVATE KEY-----/);
    expect(json).not.toMatch(/signedHead\s*=\s*[a-zA-Z0-9]/);
  });

  it('graph has reasonable node counts', () => {
    const g = buildOrganismGraph();
    expect(g.summary.nodeCount).toBeGreaterThan(40);
    expect(g.summary.authorityNodes).toBeGreaterThanOrEqual(8);
    expect(g.summary.advisoryNodes).toBeGreaterThanOrEqual(5);
    expect(g.summary.memoryNodes).toBeGreaterThanOrEqual(3);
    expect(g.summary.testNodes).toBeGreaterThanOrEqual(10);
    expect(g.summary.evidenceNodes).toBeGreaterThanOrEqual(3);
  });

  it('graph has EXTRACTED confidence edges from imports', () => {
    const g = buildOrganismGraph();
    const extracted = g.edges.filter(e => e.confidence === 'EXTRACTED' && e.relation === 'imports');
    expect(extracted.length).toBeGreaterThan(10);
  });

  it('summary counts match actual data', () => {
    const g = buildOrganismGraph();
    expect(g.summary.nodeCount).toBe(g.nodes.length);
    expect(g.summary.edgeCount).toBe(g.edges.length);
    expect(g.summary.authorityEdges).toBe(g.edges.filter(e => e.kind === 'authority').length);
    expect(g.summary.advisoryEdges).toBe(g.edges.filter(e => e.kind === 'advisory').length);
    expect(g.summary.forbiddenEdges).toBe(g.edges.filter(e => e.kind === 'forbidden').length);
  });
});

describe('24B: Affected-File BFS', () => {
  it('BFS includes tests for changed source file', () => {
    const report = getAffectedFilesForPatch(['src/crypto.ts']);
    expect(report.seedFiles).toContain('src/crypto.ts');
    expect(report.authoritySurfacesTouched.length).toBeGreaterThan(0);
  });

  it('authority surface changes yield HIGH risk', () => {
    const report = getAffectedFilesForPatch(['src/index.ts']);
    expect(report.risk).toBe('HIGH');
    expect(report.authoritySurfacesTouched).toContain('src/index.ts');
  });

  it('advisory-only changes yield lower risk', () => {
    const report = getAffectedFilesForPatch(['src/nebiusSpend.ts']);
    expect(report.risk).not.toBe('HIGH');
  });

  it('multiple seed files aggregate affected', () => {
    const report = getAffectedFilesForPatch(['src/normalizer.ts', 'src/vk.ts']);
    expect(report.seedFiles.length).toBe(2);
    expect(report.authoritySurfacesTouched.length).toBeGreaterThan(0);
  });
});

describe('24B: Master Singularity Path', () => {
  const pathFile = path.join(REPO_ROOT, 'AUKORA_SINGULARITY_PATH.md');

  it('master path file exists', () => {
    expect(fs.existsSync(pathFile)).toBe(true);
  });

  it('tracks all Rosetta Stone layers', () => {
    const content = fs.readFileSync(pathFile, 'utf-8');
    expect(content).toContain('Sacred Normalizer');
    expect(content).toContain('Cryptographic Gate');
    expect(content).toContain('Receipt Chain');
    expect(content).toContain('VK Training Rows');
    expect(content).toContain('Proposer Adapters');
    expect(content).toContain('Executor');
    expect(content).toContain('Active-Inference Loop');
    expect(content).toContain('Learner');
    expect(content).toContain('Hypothesis Memory');
    expect(content).toContain('Structural Memory');
    expect(content).toContain('Node Identity');
    expect(content).toContain('Kernel');
    expect(content).toContain('Chronos');
  });

  it('tracks OpenCode womb stages', () => {
    const content = fs.readFileSync(pathFile, 'utf-8');
    expect(content).toContain('Foundation');
    expect(content).toContain('Advisory Bridge');
    expect(content).toContain('Organism Graph');
    expect(content).toContain('Memory Persistence');
    expect(content).toContain('Patch Proposal');
    expect(content).toContain('Tauri Shell');
  });

  it('tracks Fusion Council status', () => {
    const content = fs.readFileSync(pathFile, 'utf-8');
    expect(content).toContain('Fusion Council');
    expect(content).toContain('OPERATIONAL');
    expect(content).toContain('Opus 4.8');
    expect(content).toContain('GLM 5.2');
  });

  it('tracks Auma 32B/VL role', () => {
    const content = fs.readFileSync(pathFile, 'utf-8');
    expect(content).toContain('Qwen 32B');
    expect(content).toContain('Auma/VL');
  });

  it('tracks VK compression / glyph future', () => {
    const content = fs.readFileSync(pathFile, 'utf-8');
    expect(content).toContain('Codebook');
    expect(content).toContain('Cold decode');
    expect(content).toContain('Neural VK');
  });

  it('tracks memory/graph training wheels', () => {
    const content = fs.readFileSync(pathFile, 'utf-8');
    expect(content).toContain('Hypothesis Memory');
    expect(content).toContain('Structural Memory');
    expect(content).toContain('Organism Graph');
    expect(content).toContain('Donor Benchmark');
  });

  it('tracks what is complete, partial, blocked, next', () => {
    const content = fs.readFileSync(pathFile, 'utf-8');
    expect(content).toContain('What Is Complete');
    expect(content).toContain('What Is Partial');
    expect(content).toContain('What Is Blocked');
    expect(content).toContain('What Is Next');
  });

  it('contains no AUMA-ONE-APP references', () => {
    const content = fs.readFileSync(pathFile, 'utf-8');
    expect(content).not.toContain('AUMA-ONE-APP');
  });

  it('contains hard laws', () => {
    const content = fs.readFileSync(pathFile, 'utf-8');
    expect(content).toContain('Gate authorizes');
    expect(content).toContain('Receipts decide');
  });
});
