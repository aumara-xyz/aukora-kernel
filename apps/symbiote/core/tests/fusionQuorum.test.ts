import { describe, it, expect } from 'vitest';
import {
  AdvisoryResult,
  evaluateFusionQuorum,
  buildFusionRetryPack,
  synthesizeSwarmResults,
  classifyVote,
} from '../src/fusionConfig';

function makeResult(overrides?: Partial<AdvisoryResult>): AdvisoryResult {
  return {
    model: 'test/model',
    lens: 'security',
    label: 'test:security',
    durationMs: 1000,
    adapterFailure: false,
    verdict: 'GREEN',
    findings: 'test findings',
    risks: 'test risks',
    missing_tests: '',
    recommended_next_commit: 'test commit',
    confidence: 8,
    ...overrides,
  };
}

function makeFailure(model: string, reason?: string): AdvisoryResult {
  return makeResult({
    model,
    label: `${model.split('/').pop()}:security`,
    adapterFailure: true,
    failureReason: reason ?? 'network_timeout',
    verdict: 'RED',
    findings: '',
    risks: '',
    confidence: 0,
  });
}

describe('24R.1: Fusion quorum evaluation', () => {

  describe('GREEN_QUORUM', () => {
    it('5/5 complete = GREEN_QUORUM', () => {
      const results = Array.from({ length: 5 }, () => makeResult());
      const q = evaluateFusionQuorum(results);
      expect(q.status).toBe('GREEN_QUORUM');
      expect(q.completedCount).toBe(5);
      expect(q.failureCount).toBe(0);
    });

    it('3/5 complete = GREEN_QUORUM', () => {
      const results = [
        makeResult(), makeResult(), makeResult(),
        makeFailure('a/b'), makeFailure('c/d'),
      ];
      const q = evaluateFusionQuorum(results);
      expect(q.status).toBe('GREEN_QUORUM');
      expect(q.completedCount).toBe(3);
      expect(q.failureCount).toBe(2);
    });

    it('4/5 complete = GREEN_QUORUM', () => {
      const results = [
        makeResult(), makeResult(), makeResult(), makeResult(),
        makeFailure('a/b'),
      ];
      const q = evaluateFusionQuorum(results);
      expect(q.status).toBe('GREEN_QUORUM');
    });
  });

  describe('YELLOW_QUORUM', () => {
    it('2/5 complete = YELLOW_QUORUM', () => {
      const results = [
        makeResult(), makeResult(),
        makeFailure('a/b'), makeFailure('c/d'), makeFailure('e/f'),
      ];
      const q = evaluateFusionQuorum(results);
      expect(q.status).toBe('YELLOW_QUORUM');
      expect(q.completedCount).toBe(2);
      expect(q.failureCount).toBe(3);
    });
  });

  describe('NO_QUORUM', () => {
    it('1/5 complete = NO_QUORUM', () => {
      const results = [
        makeResult(),
        makeFailure('a/b'), makeFailure('c/d'), makeFailure('e/f'), makeFailure('g/h'),
      ];
      const q = evaluateFusionQuorum(results);
      expect(q.status).toBe('NO_QUORUM');
      expect(q.completedCount).toBe(1);
    });

    it('0/5 = NO_QUORUM', () => {
      const results = Array.from({ length: 5 }, (_, i) => makeFailure(`model${i}/x`));
      const q = evaluateFusionQuorum(results);
      expect(q.status).toBe('NO_QUORUM');
      expect(q.completedCount).toBe(0);
      expect(q.failureCount).toBe(5);
    });

    it('empty results = NO_QUORUM', () => {
      const q = evaluateFusionQuorum([]);
      expect(q.status).toBe('NO_QUORUM');
    });
  });

  describe('RED_QUORUM', () => {
    it('one RED + rest GREEN = RED_QUORUM', () => {
      const results = [
        makeResult({ verdict: 'RED' }),
        makeResult(), makeResult(), makeResult(),
      ];
      const q = evaluateFusionQuorum(results);
      expect(q.status).toBe('RED_QUORUM');
    });

    it('one RED + adapter failures = RED_QUORUM', () => {
      const results = [
        makeResult({ verdict: 'RED' }),
        makeFailure('a/b'), makeFailure('c/d'),
      ];
      const q = evaluateFusionQuorum(results);
      expect(q.status).toBe('RED_QUORUM');
      expect(q.completedCount).toBe(1);
    });
  });

  describe('adapter failures do not poison', () => {
    it('adapterFailuresArePoisoning is always false', () => {
      const results = Array.from({ length: 5 }, (_, i) => makeFailure(`model${i}/x`));
      const q = evaluateFusionQuorum(results);
      expect(q.adapterFailuresArePoisoning).toBe(false);
    });

    it('adapter failure with RED verdict does not count as RED', () => {
      const results = [
        makeResult(),
        makeResult(),
        makeResult(),
        makeFailure('a/b'),
        makeFailure('c/d'),
      ];
      const q = evaluateFusionQuorum(results);
      expect(q.status).toBe('GREEN_QUORUM');
    });

    it('synthesizeSwarmResults also excludes adapter failures from RED count', () => {
      const results = [
        makeResult(),
        makeResult(),
        makeFailure('a/b'),
      ];
      const s = synthesizeSwarmResults(results);
      expect(s.red_count).toBe(0);
      expect(s.completed_count).toBe(2);
      expect(s.failure_count).toBe(1);
    });
  });

  describe('failureReason propagation', () => {
    it('failureReason is present on adapter failures', () => {
      const f = makeFailure('test/model', 'http_5xx');
      expect(f.failureReason).toBe('http_5xx');
    });

    it('failureReason is undefined on successful results', () => {
      const r = makeResult();
      expect(r.failureReason).toBeUndefined();
    });
  });
});

describe('24R.1: Fusion retry pack builder', () => {
  it('identifies failed models', () => {
    const results = [
      makeResult({ model: 'a/good' }),
      makeFailure('b/bad', 'network_timeout'),
      makeFailure('c/bad', 'http_5xx'),
    ];
    const pack = buildFusionRetryPack(results, 'Gate decides.', ['src/foo.ts'], 946, 'Is this safe?');
    expect(pack.failedModels).toEqual(['b/bad', 'c/bad']);
  });

  it('produces compact pack with required sections', () => {
    const pack = buildFusionRetryPack(
      [makeFailure('a/b')],
      'Gate decides. Receipts define reality.',
      ['src/aumaWombPrompt.ts', 'tests/aumaWombPrompt.test.ts'],
      946,
      'Is the prompt harness safe?',
    );
    expect(pack.compactPack).toContain('COMPACT RETRY PACK');
    expect(pack.compactPack).toContain('Gate decides');
    expect(pack.compactPack).toContain('src/aumaWombPrompt.ts');
    expect(pack.compactPack).toContain('946 green');
    expect(pack.compactPack).toContain('Is the prompt harness safe?');
    expect(pack.compactPack).toContain('GREEN/YELLOW/RED');
  });

  it('retry pack is shorter than 2000 chars for typical input', () => {
    const pack = buildFusionRetryPack(
      [makeFailure('a/b')],
      'Gate decides.',
      ['src/foo.ts', 'src/bar.ts', 'tests/foo.test.ts'],
      946,
      'Safe?',
    );
    expect(pack.retryPackLength).toBeLessThan(2000);
  });

  it('no live calls in retry pack builder', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'src', 'fusionConfig.ts'), 'utf-8'
    );
    const buildRetryFn = src.slice(src.indexOf('export function buildFusionRetryPack'));
    expect(buildRetryFn).not.toMatch(/\bfetch\s*\(/);
    expect(buildRetryFn).not.toMatch(/\bperformExternalReview\b/);
  });
});

describe('24Z.2.1: adapter failures are non-votes, never RED', () => {
  it('classifyVote: adapter failure carrying verdict:RED is a non_vote', () => {
    expect(classifyVote(makeFailure('moonshotai/mistral'))).toBe('non_vote'); // makeFailure sets verdict:'RED'
    expect(classifyVote(makeResult({ verdict: 'RED' }))).toBe('RED');
    expect(classifyVote(makeResult({ verdict: 'GREEN' }))).toBe('GREEN');
    expect(classifyVote(makeResult({ verdict: 'YELLOW' }))).toBe('YELLOW');
  });

  it('THE BUG: 4 real votes (GLM/DeepSeek/Qwen/Grok=YELLOW) + adapter-RED failures -> YELLOW/GREEN, NEVER RED', () => {
    const q = evaluateFusionQuorum([
      makeResult({ model: 'z-ai/glm-5.2', verdict: 'YELLOW' }),
      makeResult({ model: 'deepseek/deepseek-v4-pro', verdict: 'YELLOW' }),
      makeResult({ model: 'qwen/qwen3-coder', verdict: 'YELLOW' }),
      makeResult({ model: 'x-ai/grok-4.20', verdict: 'YELLOW' }),
      makeFailure('mistral/large-3'),   // adapter failure carrying verdict:'RED'
      makeFailure('anthropic/claude'),  // adapter failure carrying verdict:'RED'
    ]);
    expect(q.status).toBe('GREEN_QUORUM'); // 4 completed, no real RED, >=3
    expect(q.redVotes).toBe(0);
    expect(q.yellowVotes).toBe(4);
    expect(q.nonVotes).toBe(2);
    expect(q.completedVotes).toBe(4);
  });

  it('a REAL completed RED still triggers RED_QUORUM (alongside non-votes)', () => {
    const q = evaluateFusionQuorum([
      makeResult({ verdict: 'RED' }),
      makeResult({ verdict: 'GREEN' }),
      makeFailure('m/x'),
    ]);
    expect(q.status).toBe('RED_QUORUM');
    expect(q.redVotes).toBe(1);
    expect(q.nonVotes).toBe(1);
  });

  it('ALL adapters failed (each carrying verdict:RED) -> NO_QUORUM, not RED_QUORUM', () => {
    const q = evaluateFusionQuorum([makeFailure('a'), makeFailure('b'), makeFailure('c')]);
    expect(q.status).toBe('NO_QUORUM');
    expect(q.redVotes).toBe(0);
    expect(q.nonVotes).toBe(3);
    expect(q.completedVotes).toBe(0);
  });

  it('synthesizeSwarmResults: adapter-failure-RED does not make consensus RED', () => {
    const s = synthesizeSwarmResults([
      makeResult({ verdict: 'GREEN' }),
      makeResult({ verdict: 'GREEN' }),
      makeFailure('m/x'), // verdict:'RED' but adapter failure
    ]);
    expect(s.consensus).toBe('GREEN');
    expect(s.red_count).toBe(0);
    expect(s.failure_count).toBe(1);
    expect(s.completed_count).toBe(2);
  });

  it('classifyVote robustness: malformed verdict / missing flag (GLM rec)', () => {
    expect(classifyVote(makeResult({ verdict: 'MAYBE' as any }))).toBe('non_vote'); // unknown verdict -> non_vote
    expect(classifyVote(makeResult({ verdict: undefined as any }))).toBe('non_vote');
    expect(classifyVote(makeResult({ adapterFailure: undefined as any, verdict: 'GREEN' }))).toBe('GREEN'); // falsy flag, real vote
    expect(classifyVote(makeResult({ adapterFailure: true, verdict: 'GREEN' }))).toBe('non_vote'); // failure beats any verdict
    expect(classifyVote(makeResult({ adapterFailure: true, verdict: 'MAYBE' as any }))).toBe('non_vote');
  });

  it('an unknown-verdict (non-failure) result is a non_vote, never RED', () => {
    const q = evaluateFusionQuorum([
      makeResult({ verdict: 'GREEN' }), makeResult({ verdict: 'GREEN' }), makeResult({ verdict: 'GREEN' }),
      makeResult({ verdict: 'GARBAGE' as any }),
    ]);
    expect(q.status).toBe('GREEN_QUORUM');
    expect(q.redVotes).toBe(0);
    expect(q.nonVotes).toBe(1);
  });

  it('breakdown sums to total', () => {
    const q = evaluateFusionQuorum([
      makeResult({ verdict: 'GREEN' }), makeResult({ verdict: 'YELLOW' }),
      makeResult({ verdict: 'RED' }), makeFailure('m/x'),
    ]);
    expect(q.greenVotes + q.yellowVotes + q.redVotes + q.nonVotes).toBe(q.totalCount);
    expect(q.completedVotes + q.nonVotes).toBe(q.totalCount);
  });
});
