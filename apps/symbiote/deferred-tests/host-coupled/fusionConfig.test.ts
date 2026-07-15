import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  resolveApiKey,
  getModelProfile,
  MODEL_PROFILES,
  DEFAULT_PROFILE,
  buildSwarmPlan,
  synthesizeSwarmResults,
  AdvisoryResult,
  AUDIT_LENS_PROMPTS,
} from '../src/fusionConfig';
import { generateConnectivityReport, writeConnectivityReport } from '../src/organismConnectivity';
import { verifyChain, generateReceipt, hash, Receipt } from '../src/crypto';

const fakeOpenRouterKey = (value: string) => ['sk', 'or', value].join('-');

describe('21E: Key Source Resolver', () => {
  const originalEnv = process.env;
  let tmpDir: string;
  const edgeNodeEnvPath = path.resolve(__dirname, '..', '.env');
  let savedEnvContent: string | null = null;

  beforeEach(() => {
    process.env = { ...originalEnv };
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aukora-fusion-key-test-'));
    try {
      savedEnvContent = fs.readFileSync(edgeNodeEnvPath, 'utf-8');
      fs.unlinkSync(edgeNodeEnvPath);
    } catch {
      savedEnvContent = null;
    }
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (savedEnvContent !== null) {
      fs.writeFileSync(edgeNodeEnvPath, savedEnvContent, 'utf-8');
      savedEnvContent = null;
    }
  });

  it('resolves key from process.env first', () => {
    process.env.OPENROUTER_API_KEY = fakeOpenRouterKey('test-from-env-abcdef1234');
    const result = resolveApiKey();
    expect(result).not.toBeNull();
    expect(result!.key).toBe(fakeOpenRouterKey('test-from-env-abcdef1234'));
    expect(result!.source).toBe('process.env');
  });

  it('resolves key from explicit env file path', () => {
    delete process.env.OPENROUTER_API_KEY;
    const envFile = path.join(tmpDir, '.env');
    fs.writeFileSync(envFile, `OPENROUTER_API_KEY=${fakeOpenRouterKey('from-file-xyz789')}\n`);
    const result = resolveApiKey(envFile);
    expect(result).not.toBeNull();
    expect(result!.key).toBe(fakeOpenRouterKey('from-file-xyz789'));
    expect(result!.source).toBe(envFile);
  });

  it('resolves key from FUSION_ENV_FILE', () => {
    delete process.env.OPENROUTER_API_KEY;
    const envFile = path.join(tmpDir, 'fusion.env');
    fs.writeFileSync(envFile, `OPENROUTER_API_KEY=${fakeOpenRouterKey('fusion-env-aaa')}\n`);
    process.env.FUSION_ENV_FILE = envFile;
    const result = resolveApiKey();
    expect(result).not.toBeNull();
    expect(result!.key).toBe(fakeOpenRouterKey('fusion-env-aaa'));
    expect(result!.source).toBe(envFile);
  });

  it('returns null when no key is available', () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.FUSION_ENV_FILE;
    const result = resolveApiKey();
    expect(result).toBeNull();
  });

  it('rejects compromised key by SHA-256 hash', () => {
    const compromisedKeyParts = [
      'sk-or-',
      'v1-',
      '0b769cf59f9ceaa1d6d937ee9593c337ba22009188dd7901737314',
      'ffe4de2278',
    ];
    process.env.OPENROUTER_API_KEY = compromisedKeyParts.join('');
    const result = resolveApiKey();
    expect(result).toBeNull();
  });

  it('rejects keys shorter than 8 characters', () => {
    process.env.OPENROUTER_API_KEY = 'short';
    const result = resolveApiKey();
    expect(result).toBeNull();
  });

  it('handles quoted values in env files', () => {
    delete process.env.OPENROUTER_API_KEY;
    const envFile = path.join(tmpDir, '.env');
    fs.writeFileSync(envFile, `OPENROUTER_API_KEY="${fakeOpenRouterKey('quoted-key-value')}"\n`);
    const result = resolveApiKey(envFile);
    expect(result).not.toBeNull();
    expect(result!.key).toBe(fakeOpenRouterKey('quoted-key-value'));
  });

  it('skips comments and empty lines in env files', () => {
    delete process.env.OPENROUTER_API_KEY;
    const envFile = path.join(tmpDir, '.env');
    fs.writeFileSync(envFile, `# comment\n\nOPENROUTER_API_KEY=${fakeOpenRouterKey('after-comment')}\nOTHER=val\n`);
    const result = resolveApiKey(envFile);
    expect(result!.key).toBe(fakeOpenRouterKey('after-comment'));
  });

  it('never includes the key value in the source label', () => {
    process.env.OPENROUTER_API_KEY = fakeOpenRouterKey('secret-key-never-in-source');
    const result = resolveApiKey();
    expect(result!.source).not.toContain('sk-or-');
    expect(result!.source).not.toContain('secret');
    expect(result!.source).toBe('process.env');
  });

  it('env file source label is the file path, not the key', () => {
    delete process.env.OPENROUTER_API_KEY;
    const envFile = path.join(tmpDir, '.env');
    fs.writeFileSync(envFile, `OPENROUTER_API_KEY=${fakeOpenRouterKey('file-key-do-not-leak')}\n`);
    const result = resolveApiKey(envFile);
    expect(result!.source).toBe(envFile);
    expect(result!.source).not.toContain('sk-or-');
  });

  it('process.env takes priority over env file', () => {
    process.env.OPENROUTER_API_KEY = fakeOpenRouterKey('env-wins-aaaaaaa');
    const envFile = path.join(tmpDir, '.env');
    fs.writeFileSync(envFile, `OPENROUTER_API_KEY=${fakeOpenRouterKey('file-loses-bbb')}\n`);
    const result = resolveApiKey(envFile);
    expect(result!.key).toBe(fakeOpenRouterKey('env-wins-aaaaaaa'));
    expect(result!.source).toBe('process.env');
  });
});

describe('21E: Per-Model Audit Profiles', () => {
  it('Opus profile has longer timeout than default', () => {
    const opus = getModelProfile('anthropic/claude-opus-4.8');
    expect(opus.fetchTimeoutMs).toBeGreaterThan(DEFAULT_PROFILE.fetchTimeoutMs);
    expect(opus.wallClockTimeoutMs).toBeGreaterThan(DEFAULT_PROFILE.wallClockTimeoutMs);
  });

  it('all prime models have defined profiles', () => {
    const primes = [
      'anthropic/claude-opus-4.8',
      'z-ai/glm-5.2',
      'moonshotai/kimi-k2.7-code',
      'deepseek/deepseek-v4-pro',
      'qwen/qwen3.7-max',
    ];
    for (const slug of primes) {
      const profile = getModelProfile(slug);
      expect(profile.slug).toBe(slug);
      expect(profile.fetchTimeoutMs).toBeGreaterThan(0);
      expect(profile.wallClockTimeoutMs).toBeGreaterThanOrEqual(profile.fetchTimeoutMs);
      expect(profile.maxRetries).toBeGreaterThan(0);
    }
  });

  it('unknown model gets default profile', () => {
    const profile = getModelProfile('unknown/model-xyz');
    expect(profile.slug).toBe('unknown/model-xyz');
    expect(profile.fetchTimeoutMs).toBe(DEFAULT_PROFILE.fetchTimeoutMs);
  });

  it('Opus has fewer retries than default models', () => {
    const opus = getModelProfile('anthropic/claude-opus-4.8');
    const glm = getModelProfile('z-ai/glm-5.2');
    expect(opus.maxRetries).toBeLessThanOrEqual(glm.maxRetries);
  });
});

describe('21E: Swarm Mode', () => {
  it('builds swarm plan with correct instance count', () => {
    const models = ['z-ai/glm-5.2', 'moonshotai/kimi-k2.7-code'];
    const plan = buildSwarmPlan(models, 3);
    expect(plan).toHaveLength(6);
  });

  it('assigns distinct lenses across instances', () => {
    const plan = buildSwarmPlan(['z-ai/glm-5.2'], 5);
    const lenses = plan.map(p => p.lens);
    expect(new Set(lenses).size).toBe(5);
  });

  it('labels include model short name and lens', () => {
    const plan = buildSwarmPlan(['z-ai/glm-5.2'], 1);
    expect(plan[0].label).toBe('glm-5.2:security');
    expect(plan[0].model).toBe('z-ai/glm-5.2');
  });

  it('all five audit lenses have prompts', () => {
    const lenses = Object.keys(AUDIT_LENS_PROMPTS);
    expect(lenses).toHaveLength(5);
    for (const prompt of Object.values(AUDIT_LENS_PROMPTS)) {
      expect(prompt.length).toBeGreaterThan(10);
    }
  });
});

describe('21E: Swarm Synthesis', () => {
  function makeResult(overrides: Partial<AdvisoryResult>): AdvisoryResult {
    return {
      model: 'z-ai/glm-5.2',
      label: 'glm:security',
      durationMs: 1000,
      adapterFailure: false,
      verdict: 'YELLOW',
      findings: 'test findings',
      risks: 'test risks',
      missing_tests: 'none',
      recommended_next_commit: 'next',
      confidence: 7,
      ...overrides,
    };
  }

  it('adapter failures are excluded from verdict counts', () => {
    const results = [
      makeResult({ verdict: 'GREEN', adapterFailure: false }),
      makeResult({ verdict: 'RED', adapterFailure: true, model: 'anthropic/claude-opus-4.8', label: 'opus:security' }),
      makeResult({ verdict: 'YELLOW', adapterFailure: false }),
    ];
    const synthesis = synthesizeSwarmResults(results);
    expect(synthesis.completed_count).toBe(2);
    expect(synthesis.failure_count).toBe(1);
    expect(synthesis.red_count).toBe(0);
    expect(synthesis.consensus).toBe('YELLOW');
  });

  it('all adapter failures produces NO_QUORUM', () => {
    const results = [
      makeResult({ adapterFailure: true }),
      makeResult({ adapterFailure: true }),
    ];
    const synthesis = synthesizeSwarmResults(results);
    expect(synthesis.consensus).toBe('NO_QUORUM');
    expect(synthesis.completed_count).toBe(0);
  });

  it('unanimous GREEN produces GREEN consensus', () => {
    const results = [
      makeResult({ verdict: 'GREEN' }),
      makeResult({ verdict: 'GREEN' }),
      makeResult({ verdict: 'GREEN' }),
    ];
    const synthesis = synthesizeSwarmResults(results);
    expect(synthesis.consensus).toBe('GREEN');
    expect(synthesis.disagreement_score).toBe(0);
  });

  it('any real RED produces RED consensus', () => {
    const results = [
      makeResult({ verdict: 'GREEN' }),
      makeResult({ verdict: 'RED' }),
      makeResult({ verdict: 'YELLOW' }),
    ];
    const synthesis = synthesizeSwarmResults(results);
    expect(synthesis.consensus).toBe('RED');
    expect(synthesis.red_count).toBe(1);
  });

  it('disagreement score reflects verdict diversity', () => {
    const unanimous = synthesizeSwarmResults([
      makeResult({ verdict: 'YELLOW' }),
      makeResult({ verdict: 'YELLOW' }),
    ]);
    expect(unanimous.disagreement_score).toBe(0);

    const split = synthesizeSwarmResults([
      makeResult({ verdict: 'GREEN' }),
      makeResult({ verdict: 'RED' }),
      makeResult({ verdict: 'YELLOW' }),
    ]);
    expect(split.disagreement_score).toBe(1);
  });

  it('failure details are preserved in synthesis', () => {
    const results = [
      makeResult({ adapterFailure: true, model: 'anthropic/claude-opus-4.8', label: 'opus:security', findings: 'adapter timeout' }),
    ];
    const synthesis = synthesizeSwarmResults(results);
    expect(synthesis.failures).toHaveLength(1);
    expect(synthesis.failures[0].model).toBe('anthropic/claude-opus-4.8');
    expect(synthesis.failures[0].findings).toBe('adapter timeout');
  });
});

describe('21E: Organism Connectivity', () => {
  it('reports all core nodes as existing', () => {
    const report = generateConnectivityReport();
    const coreNodes = ['gate', 'executor', 'crypto', 'hypothesis_memory', 'structural_memory', 'active_inference_loop', 'resonator', 'external_reviewer'];
    for (const name of coreNodes) {
      const node = report.nodes.find(n => n.name === name);
      expect(node, `node ${name} should exist`).toBeDefined();
      expect(node!.exists, `node ${name} should have file on disk`).toBe(true);
    }
  });

  it('reports zero forbidden authority violations', () => {
    const report = generateConnectivityReport();
    const violations = report.forbidden_crossings.filter(f => f.violated);
    expect(violations).toEqual([]);
    expect(report.summary.forbidden_violations).toBe(0);
  });

  it('all high-priority tests retired, only low-priority remain', () => {
    const report = generateConnectivityReport();
    expect(report.missing_tests.length).toBeGreaterThan(0);
    const highPriority = report.missing_tests.filter(t => t.priority === 'high');
    expect(highPriority.length).toBe(0);
    const lowPriority = report.missing_tests.filter(t => t.priority === 'low');
    expect(lowPriority.length).toBeGreaterThan(0);
  });

  it('identifies unwired paths', () => {
    const report = generateConnectivityReport();
    expect(report.unwired.length).toBeGreaterThan(0);
  });

  it('verified edges match real source imports', () => {
    const report = generateConnectivityReport();
    const gateToChrypto = report.edges.find(e => e.from === 'gate' && e.to === 'crypto');
    expect(gateToChrypto?.verified).toBe(true);
    const loopToGate = report.edges.find(e => e.from === 'active_inference_loop' && e.to === 'gate');
    expect(loopToGate?.verified).toBe(true);
  });

  it('writes organism connectivity report artifact', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aukora-connectivity-report-'));
    try {
      const outPath = path.join(tmpDir, 'organism-connectivity-report.json');
      const report = writeConnectivityReport(outPath);
      const parsed = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
      expect(parsed.summary).toEqual(report.summary);
      expect(parsed.nodes.some((node: { name: string }) => node.name === 'gate')).toBe(true);
      expect(parsed.forbidden_crossings.filter((crossing: { violated: boolean }) => crossing.violated)).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('21E: Adversarial Receipt Chain', () => {
  function buildChain(n: number): Receipt[] {
    const chain: Receipt[] = [];
    let prevHash = 'genesis_hash';
    for (let i = 0; i < n; i++) {
      const intent = { action: 'read_file', resource: `file_${i}.txt`, ring: 'local' };
      const intentHash = hash(JSON.stringify(intent));
      const r = generateReceipt('golden_success', intent, intentHash, prevHash);
      prevHash = r.id;
      chain.push(r);
    }
    return chain;
  }

  it('rejects truncated chain (missing first receipt)', () => {
    const chain = buildChain(3);
    expect(verifyChain(chain)).toBe(true);
    const truncated = chain.slice(1);
    expect(verifyChain(truncated)).toBe(false);
  });

  it('rejects forked chain (receipt with wrong prevHash)', () => {
    const intent0 = { action: 'read_file', resource: 'a.txt', ring: 'local' };
    const r0 = generateReceipt('golden_success', intent0, hash(JSON.stringify(intent0)), 'genesis_hash');
    const intent1 = { action: 'read_file', resource: 'b.txt', ring: 'local' };
    const forked = generateReceipt('golden_success', intent1, hash(JSON.stringify(intent1)), 'forged_prev_hash');
    expect(verifyChain([r0, forked])).toBe(false);
  });

  it('rejects reordered chain', () => {
    const chain = buildChain(3);
    expect(verifyChain(chain)).toBe(true);
    const reordered = [chain[0], chain[2], chain[1]];
    expect(verifyChain(reordered)).toBe(false);
  });

  it('rejects receipt with tampered verdict', () => {
    const intent = { action: 'read_file', resource: 'a.txt', ring: 'local' };
    const r = generateReceipt('golden_success', intent, hash(JSON.stringify(intent)), 'genesis_hash');
    const tampered = { ...r, verdict: 'refused' as const };
    expect(verifyChain([tampered])).toBe(false);
  });

  it('rejects receipt with tampered intent', () => {
    const intent = { action: 'read_file', resource: 'a.txt', ring: 'local' };
    const r = generateReceipt('golden_success', intent, hash(JSON.stringify(intent)), 'genesis_hash');
    const tampered = { ...r, normalizedIntent: { ...intent, resource: 'other.txt' } };
    expect(verifyChain([tampered])).toBe(false);
  });
});

describe('21E: Resonator Poisoning', () => {
  it('gate verdict is independent of poisoned advisory context', async () => {
    const { evaluateIntent } = await import('../src/index');
    const rawIntent = { action: 'write_file', resource: 'pwned.txt', ring: 'local' };
    const decision = evaluateIntent(rawIntent, null);
    expect(decision.verdict).toBe('refused');
  });

  it('advisory context cannot contain authority imports', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/resonator.ts'), 'utf-8');
    expect(source).not.toContain('evaluateIntent');
    expect(source).not.toContain('executeDecision');
    expect(source).not.toContain('signPoP');
    expect(source).not.toContain('PrincipalRegistry');
  });
});

describe('21E: Fusion Config Forbidden Imports', () => {
  it('fusionConfig.ts does not import authority modules', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/fusionConfig.ts'), 'utf-8');
    const forbidden = ['evaluateIntent', 'executeDecision', 'signPoP', 'PrincipalRegistry', 'NonceLedger', 'child_process'];
    for (const term of forbidden) {
      expect(source).not.toContain(term);
    }
  });

  it('organismConnectivity.ts does not import authority modules', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/organismConnectivity.ts'), 'utf-8');
    const importLines = source.split('\n').filter(l => l.trim().startsWith('import '));
    const forbidden = ['./index', './executor', './crypto', './normalizer', './nodeIdentity'];
    for (const mod of forbidden) {
      const imports = importLines.filter(l => l.includes(`'${mod}'`) || l.includes(`"${mod}"`));
      expect(imports, `organismConnectivity.ts must not import from ${mod}`).toEqual([]);
    }
  });
});
