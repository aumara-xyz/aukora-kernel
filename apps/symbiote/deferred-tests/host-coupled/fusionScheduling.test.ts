import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  resetCallCount,
  setCallBudget,
  getEffectiveCallBudget,
  getCallCount,
  DEFAULT_CALLS_PER_RUN,
  HARD_MAX_CALLS_PER_RUN,
} from '../src/externalReview';
import {
  resolveSchedule,
  CHEAP_MODELS,
  FOCUS_MODELS,
  SHARD_NAMES,
  type ShardName,
} from '../src/fractalFusion';
import { PRIME_MODELS } from '../src/fusionConfig';

const ROOT = path.resolve(__dirname, '..');

describe('24V.2: per-run call budget', () => {
  beforeEach(() => {
    resetCallCount();
  });

  it('defaults to conservative budget', () => {
    expect(getEffectiveCallBudget()).toBe(DEFAULT_CALLS_PER_RUN);
    expect(DEFAULT_CALLS_PER_RUN).toBe(10);
  });

  it('setCallBudget returns requested and effective', () => {
    const result = setCallBudget(25);
    expect(result.requested).toBe(25);
    expect(result.effective).toBe(25);
    expect(getEffectiveCallBudget()).toBe(25);
  });

  it('effective budget never exceeds hard cap', () => {
    const result = setCallBudget(100);
    expect(result.effective).toBe(HARD_MAX_CALLS_PER_RUN);
    expect(result.effective).toBeLessThanOrEqual(50);
  });

  it('budget clamps to minimum 1', () => {
    const result = setCallBudget(0);
    expect(result.effective).toBe(1);
  });

  it('hard cap is 50', () => {
    expect(HARD_MAX_CALLS_PER_RUN).toBe(50);
  });

  it('resetCallCount resets budget to default', () => {
    setCallBudget(30);
    expect(getEffectiveCallBudget()).toBe(30);
    resetCallCount();
    expect(getEffectiveCallBudget()).toBe(DEFAULT_CALLS_PER_RUN);
  });

  it('getCallCount starts at 0', () => {
    expect(getCallCount()).toBe(0);
  });

  it('full mode requires explicit budget for 25 calls', () => {
    const schedule = resolveSchedule('full');
    expect(schedule.expectedCalls).toBe(25);
    expect(DEFAULT_CALLS_PER_RUN).toBeLessThan(schedule.expectedCalls);
  });
});

describe('24V.2: shard scheduling modes', () => {
  it('full mode uses all 5 models x 5 shards', () => {
    const schedule = resolveSchedule('full');
    expect(schedule.mode).toBe('full');
    expect(schedule.models.length).toBe(5);
    expect(schedule.shards.length).toBe(5);
    expect(schedule.expectedCalls).toBe(25);
  });

  it('cheap_full uses 3 cheap models x 5 shards', () => {
    const schedule = resolveSchedule('cheap_full');
    expect(schedule.mode).toBe('cheap_full');
    expect(schedule.models.length).toBe(3);
    expect(schedule.shards.length).toBe(5);
    expect(schedule.expectedCalls).toBe(15);
    expect(schedule.models).not.toContain('anthropic/claude-opus-4.8');
    expect(schedule.models).not.toContain('moonshotai/kimi-k2.6');
  });

  it('prime_focus uses 3 focus models x 1 shard', () => {
    const schedule = resolveSchedule('prime_focus', { focusShard: 'authority_gate_receipts' });
    expect(schedule.mode).toBe('prime_focus');
    expect(schedule.models.length).toBe(3);
    expect(schedule.shards.length).toBe(1);
    expect(schedule.shards[0]).toBe('authority_gate_receipts');
    expect(schedule.expectedCalls).toBe(3);
    expect(schedule.models).toContain('anthropic/claude-opus-4.8');
  });

  it('retry_only uses only failed pairs', () => {
    const pairs = [
      { shard: 'authority_gate_receipts' as ShardName, model: 'anthropic/claude-opus-4.8' },
      { shard: 'memory_burn_sleep' as ShardName, model: 'qwen/qwen3-coder' },
    ];
    const schedule = resolveSchedule('retry_only', { retryPairs: pairs });
    expect(schedule.mode).toBe('retry_only');
    expect(schedule.expectedCalls).toBe(2);
    expect(schedule.models).toContain('anthropic/claude-opus-4.8');
    expect(schedule.models).toContain('qwen/qwen3-coder');
    expect(schedule.shards).toContain('authority_gate_receipts');
    expect(schedule.shards).toContain('memory_burn_sleep');
  });

  it('retry_only with empty pairs produces 0 expected calls', () => {
    const schedule = resolveSchedule('retry_only', { retryPairs: [] });
    expect(schedule.expectedCalls).toBe(0);
    expect(schedule.models.length).toBe(0);
    expect(schedule.shards.length).toBe(0);
  });

  it('CHEAP_MODELS is a subset of PRIME_MODELS', () => {
    for (const m of CHEAP_MODELS) {
      expect([...PRIME_MODELS]).toContain(m);
    }
  });

  it('FOCUS_MODELS contains opus', () => {
    expect([...FOCUS_MODELS]).toContain('anthropic/claude-opus-4.8');
  });
});

describe('24V.2: rate_cap produces NO_QUORUM not RED', () => {
  it('rate_cap failure reason is not a RED verdict source', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'externalReview.ts'), 'utf-8');
    const rateCapBlock = src.match(/callCountThisRun >= effectiveBudget[\s\S]*?failureReason:\s*'rate_cap'/);
    expect(rateCapBlock).not.toBeNull();
    const rateCapSection = rateCapBlock![0];
    expect(rateCapSection).not.toContain("verdict: 'RED'");
  });
});

describe('24V.2: retry pack runner structure', () => {
  it('runner reads prior results', () => {
    const src = fs.readFileSync(path.join(ROOT, 'evidence', 'run-24v2-fusion-retry-packs.ts'), 'utf-8');
    expect(src).toContain('24v1-coherence-pulse-results.json');
    expect(src).toContain('adapterFailure');
  });

  it('runner saves output separately', () => {
    const src = fs.readFileSync(path.join(ROOT, 'evidence', 'run-24v2-fusion-retry-packs.ts'), 'utf-8');
    expect(src).toContain('24v2-retry-results.json');
    expect(src).not.toContain('overwrite');
  });

  it('runner uses setCallBudget', () => {
    const src = fs.readFileSync(path.join(ROOT, 'evidence', 'run-24v2-fusion-retry-packs.ts'), 'utf-8');
    expect(src).toContain('setCallBudget');
    expect(src).toContain('getEffectiveCallBudget');
  });

  it('runner does not log key values', () => {
    const src = fs.readFileSync(path.join(ROOT, 'evidence', 'run-24v2-fusion-retry-packs.ts'), 'utf-8');
    expect(src).not.toContain('keyResult.key');
    expect(src).toContain('keyResult.source');
  });

  it('runner writes skip report if no key', () => {
    const src = fs.readFileSync(path.join(ROOT, 'evidence', 'run-24v2-fusion-retry-packs.ts'), 'utf-8');
    expect(src).toContain("status: 'SKIPPED'");
    expect(src).toContain('No Fusion ran. No success claimed.');
  });
});

describe('24V.2: action items tracker', () => {
  it('fusion-action-items.json exists and is valid', () => {
    const itemsPath = path.join(ROOT, 'evidence', 'fusion-action-items.json');
    expect(fs.existsSync(itemsPath)).toBe(true);
    const items = JSON.parse(fs.readFileSync(itemsPath, 'utf-8'));
    expect(items.advisory_only).toBe(true);
    expect(items.authority_granted).toBe(false);
    expect(Array.isArray(items.items)).toBe(true);
  });

  it('each item has required fields', () => {
    const itemsPath = path.join(ROOT, 'evidence', 'fusion-action-items.json');
    const items = JSON.parse(fs.readFileSync(itemsPath, 'utf-8'));
    for (const item of items.items) {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('source_shard');
      expect(item).toHaveProperty('source_models');
      expect(item).toHaveProperty('severity');
      expect(item).toHaveProperty('status');
      expect(item).toHaveProperty('title');
      expect(item).toHaveProperty('target_files');
      expect(item).toHaveProperty('why_accepted');
      expect(['proposed', 'accepted', 'rejected', 'implemented']).toContain(item.status);
    }
  });

  it('items reference real source shards', () => {
    const itemsPath = path.join(ROOT, 'evidence', 'fusion-action-items.json');
    const items = JSON.parse(fs.readFileSync(itemsPath, 'utf-8'));
    const validShards = [...SHARD_NAMES, 'fusion_ops_reliability'];
    for (const item of items.items) {
      expect(validShards).toContain(item.source_shard);
    }
  });
});

describe('24V.2: coherence pulse uses budget', () => {
  it('coherence pulse runner imports setCallBudget', () => {
    const src = fs.readFileSync(path.join(ROOT, 'evidence', 'run-24v1-coherence-pulse.ts'), 'utf-8');
    expect(src).toContain('setCallBudget');
    expect(src).toContain('getEffectiveCallBudget');
  });

  it('coherence pulse defaults to cheap_full', () => {
    const src = fs.readFileSync(path.join(ROOT, 'evidence', 'run-24v1-coherence-pulse.ts'), 'utf-8');
    expect(src).toContain("'cheap_full'");
  });

  it('24S.1 runner uses setCallBudget', () => {
    const src = fs.readFileSync(path.join(ROOT, 'evidence', 'run-24s1-live-fractal-fusion.ts'), 'utf-8');
    expect(src).toContain('setCallBudget');
  });
});

describe('24V.2: structural safety', () => {
  it('no authority imports in scheduling', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'fractalFusion.ts'), 'utf-8');
    const importLines = src.split('\n').filter(l => /^\s*import\s/.test(l));
    for (const line of importLines) {
      expect(line).not.toContain("from './index'");
      expect(line).not.toContain("from './patchApproval'");
    }
  });

  it('no AUMA-ONE references in new files', () => {
    const files = [
      'evidence/run-24v2-fusion-retry-packs.ts',
      'evidence/fusion-action-items.json',
    ];
    for (const f of files) {
      const content = fs.readFileSync(path.join(ROOT, f), 'utf-8');
      expect(content).not.toContain('AUMA-ONE');
      expect(content).not.toContain('auma-one-app');
    }
  });

  it('no Nebius references in new files', () => {
    const files = [
      'evidence/run-24v2-fusion-retry-packs.ts',
      'evidence/fusion-action-items.json',
    ];
    for (const f of files) {
      const content = fs.readFileSync(path.join(ROOT, f), 'utf-8');
      expect(content).not.toContain('nebius');
    }
  });

  it('no key logging in retry runner source', () => {
    const src = fs.readFileSync(path.join(ROOT, 'evidence', 'run-24v2-fusion-retry-packs.ts'), 'utf-8');
    expect(src).not.toContain('keyResult.key');
    expect(src).not.toMatch(/console\.log.*apiKey/);
    expect(src).not.toMatch(/console\.log.*sk-or/);
  });

  it('budget is never silently exceeded', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'externalReview.ts'), 'utf-8');
    expect(src).toContain('callCountThisRun >= effectiveBudget');
    expect(src).toContain('HARD_MAX_CALLS_PER_RUN');
    expect(src).toContain('Math.min');
  });
});
