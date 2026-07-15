import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { checkFusionOpsHealth } from '../src/fusionOpsHealth';
import { resolveApiKey, PRIME_MODELS } from '../src/fusionConfig';

const ROOT = path.resolve(__dirname, '..');

describe('24V.1: fusionOpsHealth', () => {
  it('reports a key source when resolveApiKey finds one', () => {
    const report = checkFusionOpsHealth(ROOT);
    const keyResult = resolveApiKey();
    if (keyResult) {
      expect(report.keySource).toBe(keyResult.source);
      expect(report.canRunLive).toBe(true);
    } else {
      expect(report.keySource).toBeNull();
      expect(report.canRunLive).toBe(false);
    }
  });

  it('reports blocker when pointed at nonexistent root without env key', () => {
    const origKey = process.env.OPENROUTER_API_KEY;
    const origFile = process.env.FUSION_ENV_FILE;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.FUSION_ENV_FILE;
    try {
      const report = checkFusionOpsHealth(ROOT);
      if (!resolveApiKey()) {
        expect(report.canRunLive).toBe(false);
        expect(report.blockers.some(b => b.includes('no API key'))).toBe(true);
      }
    } finally {
      if (origKey !== undefined) process.env.OPENROUTER_API_KEY = origKey;
      if (origFile !== undefined) process.env.FUSION_ENV_FILE = origFile;
    }
  });

  it('is advisory only', () => {
    const report = checkFusionOpsHealth(ROOT);
    expect(report.advisoryOnly).toBe(true);
    expect(report.grantsAuthority).toBe(false);
  });

  it('includes all prime models', () => {
    const report = checkFusionOpsHealth(ROOT);
    expect(report.enabledModels.length).toBe(5);
    expect(report.enabledModels).toContain('anthropic/claude-opus-4.8');
    expect(report.enabledModels).toContain('qwen/qwen3.7-max');
  });

  it('reads artifact failure rate when artifact exists', () => {
    const report = checkFusionOpsHealth(ROOT);
    if (report.latestFusionArtifactPath) {
      expect(report.adapterFailureRate === null || typeof report.adapterFailureRate === 'number').toBe(true);
    }
  });
});

describe('24V.1: shared resolver', () => {
  it('resolveApiKey is exported from fusionConfig', () => {
    expect(typeof resolveApiKey).toBe('function');
  });

  it('PRIME_MODELS is exported from fusionConfig', () => {
    expect(Array.isArray(PRIME_MODELS)).toBe(true);
    expect(PRIME_MODELS.length).toBe(5);
  });

  it('resolveApiKey returns KeyResolution or null', () => {
    const result = resolveApiKey();
    if (result !== null) {
      expect(result).toHaveProperty('key');
      expect(result).toHaveProperty('source');
      expect(typeof result.key).toBe('string');
      expect(typeof result.source).toBe('string');
    }
  });

  it('key value is never in source string', () => {
    const result = resolveApiKey();
    if (result) {
      expect(result.source).not.toContain(result.key);
    }
  });
});

describe('24V.1: missing key fails closed (structural)', () => {
  it('externalReview checks resolveApiKey and returns RED on null', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'externalReview.ts'), 'utf-8');
    expect(src).toContain('resolveApiKey');
    expect(src).toContain('missing_key');
    expect(src).toContain('FAIL_CLOSED');
  });

  it('fail-closed review has verdict RED', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'externalReview.ts'), 'utf-8');
    const failClosedMatch = src.match(/FAIL_CLOSED_REVIEW[^}]*verdict:\s*'([^']+)'/);
    expect(failClosedMatch).not.toBeNull();
    expect(failClosedMatch![1]).toBe('RED');
  });
});

describe('24V.1: key value never logged', () => {
  it('fusionOpsHealth report does not contain key value', () => {
    const report = checkFusionOpsHealth(ROOT);
    const serialized = JSON.stringify(report);
    const keyResult = resolveApiKey();
    if (keyResult) {
      expect(serialized).not.toContain(keyResult.key);
    }
    expect(serialized).not.toContain('sk-or-');
  });

  it('fusionOpsHealth source code never logs or returns key value', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'fusionOpsHealth.ts'), 'utf-8');
    expect(src).not.toContain('keyResult.key');
    expect(src).not.toContain('console.log');
    expect(src).toContain('keyResult.source');
  });
});

describe('24V.1: health check does not make network calls', () => {
  it('checkFusionOpsHealth uses no fetch/http', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'fusionOpsHealth.ts'), 'utf-8');
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toContain('http://');
    expect(src).not.toContain('https://');
    expect(src).not.toContain('WebSocket');
    expect(src).not.toContain('XMLHttpRequest');
  });
});

describe('24V.1: coherence pulse runner structure', () => {
  it('runner uses shared resolveApiKey', () => {
    const src = fs.readFileSync(path.join(ROOT, 'evidence', 'run-24v1-coherence-pulse.ts'), 'utf-8');
    expect(src).toContain("from '../src/fusionConfig'");
    expect(src).toContain('resolveApiKey');
    expect(src).toContain('PRIME_MODELS');
  });

  it('runner uses checkFusionOpsHealth', () => {
    const src = fs.readFileSync(path.join(ROOT, 'evidence', 'run-24v1-coherence-pulse.ts'), 'utf-8');
    expect(src).toContain("from '../src/fusionOpsHealth'");
    expect(src).toContain('checkFusionOpsHealth');
  });

  it('runner saves raw results before synthesis', () => {
    const src = fs.readFileSync(path.join(ROOT, 'evidence', 'run-24v1-coherence-pulse.ts'), 'utf-8');
    const rawSaveIdx = src.indexOf('24v1-coherence-pulse-results.json');
    const artifactUpdateIdx = src.indexOf('Womb artifact updated');
    expect(rawSaveIdx).toBeGreaterThan(0);
    expect(artifactUpdateIdx).toBeGreaterThan(rawSaveIdx);
  });

  it('runner includes coherence questions', () => {
    const src = fs.readFileSync(path.join(ROOT, 'evidence', 'run-24v1-coherence-pulse.ts'), 'utf-8');
    expect(src).toContain('What did we miss?');
    expect(src).toContain('What is unsafe or embarrassing?');
    expect(src).toContain('evidence-only');
  });

  it('runner writes skip report if no key', () => {
    const src = fs.readFileSync(path.join(ROOT, 'evidence', 'run-24v1-coherence-pulse.ts'), 'utf-8');
    expect(src).toContain("status: 'SKIPPED'");
    expect(src).toContain('No Fusion ran. No success claimed.');
  });

  it('runner does not log key values', () => {
    const src = fs.readFileSync(path.join(ROOT, 'evidence', 'run-24v1-coherence-pulse.ts'), 'utf-8');
    expect(src).not.toContain('keyResult.key');
    expect(src).toContain('keyResult.source');
  });

  it('no AUMA-ONE references in runner', () => {
    const src = fs.readFileSync(path.join(ROOT, 'evidence', 'run-24v1-coherence-pulse.ts'), 'utf-8');
    expect(src).not.toContain('AUMA-ONE');
    expect(src).not.toContain('auma-one-app');
  });

  it('no Nebius references in runner', () => {
    const src = fs.readFileSync(path.join(ROOT, 'evidence', 'run-24v1-coherence-pulse.ts'), 'utf-8');
    expect(src).not.toContain('nebius');
  });
});

describe('24V.1: structural safety', () => {
  it('fusionOpsHealth does not import authority modules', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'fusionOpsHealth.ts'), 'utf-8');
    const importLines = src.split('\n').filter(l => /^\s*import\s/.test(l));
    for (const line of importLines) {
      expect(line).not.toContain("from './index'");
      expect(line).not.toContain("from './patchApproval'");
    }
  });

  it('no AUMA-ONE references in fusionOpsHealth', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'fusionOpsHealth.ts'), 'utf-8');
    expect(src).not.toContain('AUMA-ONE');
    expect(src).not.toContain('auma-one-app');
  });

  it('no Nebius calls in fusionOpsHealth', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'fusionOpsHealth.ts'), 'utf-8');
    expect(src).not.toContain('nebius');
    expect(src).not.toMatch(/\bfetch\s*\(/);
  });
});
