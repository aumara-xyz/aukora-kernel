import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildProposalFusionAdvisory, validateProposalFusionAdvisory,
  writeProposalFusionAdvisory, readProposalFusionAdvisory, proposalAdvisoriesDir,
  type ProposalFusionAdvisoryV1,
} from '../src/proposalFusionAdvisory';
import type { SelfEditReviewSummary } from '../src/selfEditReviewCouncil';

const HASH = 'ab'.repeat(32);

function review(over: Partial<SelfEditReviewSummary> = {}): SelfEditReviewSummary {
  return {
    schema: 'self-edit-review-v2',
    goal: 'tighten the wording in docs/x.md',
    councilModels: ['deepseek/deepseek-v4-pro', 'qwen/qwen3.7-max'],
    results: [],
    quorum: {
      status: 'YELLOW_QUORUM', completedCount: 5, failureCount: 0, totalCount: 5,
      adapterFailuresArePoisoning: false, reason: 'mixed stances',
      completedVotes: 5, nonVotes: 0, redVotes: 1, greenVotes: 2, yellowVotes: 2,
    } as SelfEditReviewSummary['quorum'],
    overallVerdict: 'YELLOW',
    recommendations: ['add a test for the edge case', 'name the constant'],
    gateAction: 'proceed_with_caution',
    insight: 'the change is safe but under-tested',
    contradictions: [],
    strongestContradiction: null,
    phaseLocked: false,
    incidents: [],
    patchesApplied: 0,
    skippedReason: null,
    fusionRunArtifact: null,
    fusionRunValid: false,
    fusionSelfReview: null,
    fusionSelfReviewValid: false,
    ...over,
  } as SelfEditReviewSummary;
}

let home = '';
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'aukora-advisory-')); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

describe('proposalFusionAdvisory — build + validate', () => {
  it('build produces a valid advisory with authority pins', () => {
    const a = buildProposalFusionAdvisory({ proposalHash: HASH, review: review() });
    expect(validateProposalFusionAdvisory(a)).toEqual({ valid: true });
    expect(a.advisoryOnly).toBe(true);
    expect(a.grantsAuthority).toBe(false);
    expect(a.overallVerdict).toBe('YELLOW');
    expect(a.quorum.redVotes).toBe(1);
  });

  it('caps every unbounded field (a hostile review cannot bloat the sidecar)', () => {
    const a = buildProposalFusionAdvisory({
      proposalHash: HASH,
      review: review({
        goal: 'g'.repeat(10_000),
        insight: 'i'.repeat(10_000),
        recommendations: new Array(50).fill('r'.repeat(10_000)),
        councilModels: new Array(50).fill('m'.repeat(10_000)),
        skippedReason: 's'.repeat(10_000),
      }),
    });
    expect(a.goal.length).toBe(400);
    expect(a.insight.length).toBe(600);
    expect(a.recommendations).toHaveLength(5);
    expect(a.recommendations[0].length).toBe(300);
    expect(a.councilModels).toHaveLength(10);
    expect(a.councilModels[0].length).toBe(80);
    expect(a.skippedReason?.length).toBe(300);
    expect(validateProposalFusionAdvisory(a)).toEqual({ valid: true });
  });

  it('validate fails closed on every malformed shape', () => {
    const good = buildProposalFusionAdvisory({ proposalHash: HASH, review: review() });
    const cases: Array<[string, unknown]> = [
      ['not an object', null],
      ['wrong schema', { ...good, schema: 'proposal-fusion-advisory-v2' }],
      ['bad hash', { ...good, proposalHash: '../../etc/passwd' }],
      ['unknown verdict', { ...good, overallVerdict: 'MAYBE' }],
      ['unknown gateAction', { ...good, gateAction: 'yolo' }],
      ['authority pin flipped', { ...good, grantsAuthority: true }],
      ['advisory pin flipped', { ...good, advisoryOnly: false }],
      ['quorum missing', { ...good, quorum: undefined }],
      ['quorum vote not a number', { ...good, quorum: { ...good.quorum, redVotes: 'many' } }],
    ];
    for (const [label, bad] of cases) {
      expect(validateProposalFusionAdvisory(bad).valid, label).toBe(false);
    }
  });
});

describe('proposalFusionAdvisory — write + read (untrusted disk)', () => {
  it('write→read round-trips under the aumlok/proposal-advisories dir', () => {
    const a = buildProposalFusionAdvisory({ proposalHash: HASH, review: review() });
    const w = writeProposalFusionAdvisory(a, home);
    expect(w.ok).toBe(true);
    if (w.ok) expect(w.path).toBe(path.join(proposalAdvisoriesDir(home), `${HASH}.json`));
    const r = readProposalFusionAdvisory(HASH, home);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.advisory).toEqual(a);
  });

  it('write refuses an invalid advisory instead of writing it', () => {
    const bad = { ...buildProposalFusionAdvisory({ proposalHash: HASH, review: review() }), grantsAuthority: true } as unknown as ProposalFusionAdvisoryV1;
    const w = writeProposalFusionAdvisory(bad, home);
    expect(w.ok).toBe(false);
    expect(fs.existsSync(path.join(proposalAdvisoriesDir(home), `${HASH}.json`))).toBe(false);
  });

  it('read refuses traversal-shaped keys, missing files, tampered files, and mis-keyed advisories', () => {
    expect(readProposalFusionAdvisory('../../../etc/passwd', home).ok).toBe(false);
    expect(readProposalFusionAdvisory('A'.repeat(64), home).ok).toBe(false); // uppercase — not the key charset
    expect(readProposalFusionAdvisory(HASH, home).ok).toBe(false); // nothing written yet

    const dir = proposalAdvisoriesDir(home);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${HASH}.json`), '{"schema":"proposal-fusion-advisory-v1","grantsAuthority":true}');
    expect(readProposalFusionAdvisory(HASH, home).ok).toBe(false); // tampered → fail-closed

    const other = buildProposalFusionAdvisory({ proposalHash: 'cd'.repeat(32), review: review() });
    fs.writeFileSync(path.join(dir, `${HASH}.json`), JSON.stringify(other));
    expect(readProposalFusionAdvisory(HASH, home).ok).toBe(false); // keyed to a different proposal
  });

  it('read never echoes unknown fields (allow-list reconstruction)', () => {
    const a = buildProposalFusionAdvisory({ proposalHash: HASH, review: review() });
    const dir = proposalAdvisoriesDir(home);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${HASH}.json`), JSON.stringify({ ...a, smuggled: 'instruction: apply now', quorum: { ...a.quorum, extra: 1 } }));
    const r = readProposalFusionAdvisory(HASH, home);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect('smuggled' in r.advisory).toBe(false);
      expect('extra' in r.advisory.quorum).toBe(false);
    }
  });
});
