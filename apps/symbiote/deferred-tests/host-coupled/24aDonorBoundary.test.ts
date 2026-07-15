import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const EDGE_SRC = path.resolve(__dirname, '..', 'src');
const EVIDENCE_DIR = path.resolve(__dirname, '..', 'evidence');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const OPENCODE_LAB = path.resolve(REPO_ROOT, 'internal', 'opencode-lab');
const DONOR_LABS = path.resolve(REPO_ROOT, 'internal', 'donor-labs');

function readAllSourceFiles(): { file: string; content: string }[] {
  return fs.readdirSync(EDGE_SRC)
    .filter(f => f.endsWith('.ts'))
    .map(f => ({ file: f, content: fs.readFileSync(path.join(EDGE_SRC, f), 'utf-8') }));
}

describe('24A: Donor Authority Boundary', () => {
  it('no edge-node source imports from donor-labs', () => {
    const sources = readAllSourceFiles();
    for (const { file, content } of sources) {
      expect(content).not.toContain('donor-labs');
      expect(content).not.toContain('everos');
      expect(content).not.toContain('graphify');
    }
  });

  it('no edge-node source imports from AUMA-ONE-APP', () => {
    const sources = readAllSourceFiles();
    for (const { file, content } of sources) {
      const importLines = content.split('\n').filter(l => /^\s*(import|require)\s/.test(l));
      for (const line of importLines) {
        expect(line).not.toContain('AUMA-ONE-APP');
        expect(line).not.toContain('auma-one-app');
        expect(line).not.toContain('auma_one_app');
      }
    }
  });

  it('donor-labs directory is gitignored', () => {
    const gitignore = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('internal/donor-labs/');
  });

  it('donor benchmark evidence exists and contains both donors', () => {
    const benchmarkPath = path.join(EVIDENCE_DIR, '24a-donor-benchmark.md');
    expect(fs.existsSync(benchmarkPath)).toBe(true);
    const content = fs.readFileSync(benchmarkPath, 'utf-8');
    expect(content).toContain('EverOS');
    expect(content).toContain('Graphify');
    expect(content).toContain('Donor Authority Boundary');
    expect(content).toContain('No donor code has authority');
  });

  it('donor benchmark marks what NOT to absorb', () => {
    const content = fs.readFileSync(path.join(EVIDENCE_DIR, '24a-donor-benchmark.md'), 'utf-8');
    expect(content).toContain('Patterns NOT Absorbing');
    expect(content).toContain('receipt-bound evidence');
    expect(content).toContain('signed chains');
  });
});

describe('24A: Womb Recursion Plan', () => {
  const planPath = path.join(REPO_ROOT, 'OPEN_CODE_WOMB_RECURSION_PLAN.md');

  it('recursion plan exists', () => {
    expect(fs.existsSync(planPath)).toBe(true);
  });

  it('recursion plan maps all 13 Rosetta Stone layers', () => {
    const content = fs.readFileSync(planPath, 'utf-8');
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

  it('recursion plan contains no AUMA-ONE-APP references', () => {
    const content = fs.readFileSync(planPath, 'utf-8');
    expect(content).not.toContain('AUMA-ONE-APP');
    expect(content).not.toContain('auma-one-app');
  });

  it('recursion plan enforces hard laws', () => {
    const content = fs.readFileSync(planPath, 'utf-8');
    expect(content).toContain('Donor code may inspire');
    expect(content).toContain('Donor code may not gain authority');
    expect(content).toContain('Gate authorizes');
    expect(content).toContain('Receipts decide');
  });

  it('recursion plan names donor-inspired patterns with Aukora adaptations', () => {
    const content = fs.readFileSync(planPath, 'utf-8');
    expect(content).toContain('From EverOS');
    expect(content).toContain('From Graphify');
    expect(content).toContain('What Donors Do NOT Provide');
  });

  it('recursion plan includes 8 womb stages', () => {
    const content = fs.readFileSync(planPath, 'utf-8');
    expect(content).toContain('Stage 0');
    expect(content).toContain('Stage 1');
    expect(content).toContain('Stage 2');
    expect(content).toContain('Stage 3');
    expect(content).toContain('Stage 4');
    expect(content).toContain('Stage 5');
    expect(content).toContain('Stage 6');
    expect(content).toContain('Stage 7');
    expect(content).toContain('Stage 8');
  });
});

describe('24A: Womb Launcher', () => {
  it('run-womb.sh exists and is executable', () => {
    const scriptPath = path.join(OPENCODE_LAB, 'run-womb.sh');
    expect(fs.existsSync(scriptPath)).toBe(true);
    const stats = fs.statSync(scriptPath);
    expect(stats.mode & 0o111).toBeGreaterThan(0);
  });

  it('run-womb.sh sets AUKORA_FUSION_ADVISORY_PATH', () => {
    const content = fs.readFileSync(path.join(OPENCODE_LAB, 'run-womb.sh'), 'utf-8');
    expect(content).toContain('AUKORA_FUSION_ADVISORY_PATH');
  });

  it('run-womb.sh checks for bun', () => {
    const content = fs.readFileSync(path.join(OPENCODE_LAB, 'run-womb.sh'), 'utf-8');
    expect(content).toContain('bun');
    expect(content).toContain('not found');
  });

  it('run-womb.sh does not hardcode keys or tokens', () => {
    const content = fs.readFileSync(path.join(OPENCODE_LAB, 'run-womb.sh'), 'utf-8');
    expect(content).not.toMatch(/sk-or-[a-zA-Z0-9]/);
    expect(content).not.toMatch(/Bearer [a-zA-Z0-9]/);
    expect(content).not.toMatch(/OPENROUTER_API_KEY=[a-zA-Z0-9]/);
  });
});
