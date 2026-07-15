import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  reviewSelfEditProposal, formatSelfEditReviewSummary, selfEditReviewGrantsAuthority, packetsToAdvisoryResults,
} from '../src/selfEditReviewCouncil';
import { createEmptyBrain, ingestMemory, saveBrainState } from '../src/kiraBrain';
import type { CouncilMember } from '../src/aukoraFuEngine';

const OK_TEST_RESULT = { passed: true, ran: ['x'], detail: 'ok' };
// Point every test at a path that does not exist, so results are deterministic and never depend on
// (or pollute) the real local state/kira/brain.json — a dedicated describe block below tests the
// real recall path against a constructed, disposable brain state.
const NO_BRAIN_STATE = '/tmp/aukora-selfEditReviewCouncil-test-no-such-file.json';

function member(id: string, overrides: Partial<CouncilMember> = {}): CouncilMember {
  return {
    id, slug: `test/${id.toLowerCase()}`, name: id, voice: 'test voice',
    specialty: 'analysis', framework: 'symbolic', weight: 1.0, costPer1M: 0.1, accuracy: 0.5, active: true,
    ...overrides,
  };
}

function glyphLine(opts: { stance?: string; confidence?: string; strategy?: string; framework?: string; dist?: [number, number, number, number]; hyp?: string }) {
  const [e, x, v, a] = opts.dist ?? [0.25, 0.25, 0.25, 0.25];
  return `STANCE:${opts.stance ?? '⊕'} CONFIDENCE:${opts.confidence ?? '↑'} STRATEGY:${opts.strategy ?? '↗'} FRAMEWORK:${opts.framework ?? 'symbolic'} DIST:explore=${e},exploit=${x},verify=${v},abstain=${a} HYP:"${opts.hyp ?? 'ok'}"`;
}

/** Mocks globalThis.fetch (AukoraFuEngine's only network dependency) keyed by model slug. A slug with
 *  no configured response gets a real, well-formed GREEN glyph by default. `responses[slug] === null`
 *  simulates an HTTP failure for that model (adapter failure -> non-vote, never a fabricated RED). */
function mockFetchByModel(responses: Record<string, string | null>) {
  return vi.fn(async (_url: unknown, opts: { body: string }) => {
    const body = JSON.parse(opts.body);
    const slug = body.model as string;
    if (!(slug in responses)) {
      return { ok: true, json: async () => ({ choices: [{ message: { content: glyphLine({}) } }] }) };
    }
    const text = responses[slug];
    if (text === null) return { ok: false, status: 500 };
    return { ok: true, json: async () => ({ choices: [{ message: { content: text } }] }) };
  });
}

let originalFetch: typeof globalThis.fetch;
beforeEach(() => { originalFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = originalFetch; });

// Fable QA (Round 6): every test in this file mocks fetch, but aukoraFuEngine.ts's emitGlyph() calls
// captureRawFusionReply() unconditionally on every reply (mocked or real) and checks AUKORA_FUSION_CAPTURE
// fresh each time (core/src/fusionCaptureLog.ts). If a developer's shell already has that var exported
// (e.g. from doing a real live council run earlier), running this file's tests in that SAME shell would
// write MOCKED glyph replies into the REAL ${AUKORA_SYMBIOTE_HOME}/fusion-captures/ dir — polluting the
// exact evidence base the capture feature exists to build. Same isolation discipline
// workbenchCommandLoop.test.ts already applies to AUKORA_KIRA_STATE/AUKORA_SYMBIOTE_HOME.
let testFusionHome: string;
let prevFusionHome: string | undefined;
let prevFusionCapture: string | undefined;
let prevApiKey: string | undefined;
beforeEach(() => {
  testFusionHome = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-selfEditReviewCouncil-home-'));
  prevFusionHome = process.env.AUKORA_SYMBIOTE_HOME;
  process.env.AUKORA_SYMBIOTE_HOME = testFusionHome;
  prevFusionCapture = process.env.AUKORA_FUSION_CAPTURE;
  delete process.env.AUKORA_FUSION_CAPTURE;
  // Isolate key resolution: every test here mocks fetch, but the reviewSelfEditProposal calls that do NOT pass
  // an explicit apiKey go through resolveApiKey(), which reads process.env.OPENROUTER_API_KEY, edge-node .env,
  // AND ~/.local/share/opencode/auth.json. On a developer machine a real key is found so the engine reaches the
  // mock; on a bare CI checkout (no auth.json, no env) it fail-fasts to NO_QUORUM and every such test fails.
  // Pin a deterministic non-secret key (process.env is resolveApiKey's FIRST source) so the mock is always
  // reached, independent of host credentials. Tests that pass apiKey:'' explicitly still exercise the fail-fast.
  prevApiKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'sk-test-fusion-ci-not-a-real-key';
});
afterEach(() => {
  if (prevFusionHome === undefined) delete process.env.AUKORA_SYMBIOTE_HOME; else process.env.AUKORA_SYMBIOTE_HOME = prevFusionHome;
  if (prevFusionCapture === undefined) delete process.env.AUKORA_FUSION_CAPTURE; else process.env.AUKORA_FUSION_CAPTURE = prevFusionCapture;
  if (prevApiKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = prevApiKey;
  fs.rmSync(testFusionHome, { recursive: true, force: true });
});

describe('selfEditReviewCouncil: never authorizes anything', () => {
  it('selfEditReviewGrantsAuthority is always false', () => {
    expect(selfEditReviewGrantsAuthority({} as any)).toBe(false);
  });

  it('every summary is pinned advisoryOnly:true, grantsAuthority:false', async () => {
    globalThis.fetch = mockFetchByModel({ 'test/a': glyphLine({}), 'test/b': glyphLine({}) }) as any;
    const r = await reviewSelfEditProposal({
      goal: 'g', files: [{ relPath: 'docs/A.md', content: 'x' }], testResult: OK_TEST_RESULT,
      council: [member('a'), member('b')], kiraStatePath: NO_BRAIN_STATE,
    });
    expect(r.advisoryOnly).toBe(true);
    expect(r.grantsAuthority).toBe(false);
  });
});

describe('selfEditReviewCouncil: quorum aggregation from real aukora-fu glyph packets', () => {
  it('all models agree (⊕) -> overallVerdict GREEN, gate proceeds', async () => {
    globalThis.fetch = mockFetchByModel({
      'test/a': glyphLine({ stance: '⊕' }), 'test/b': glyphLine({ stance: '⊕' }), 'test/c': glyphLine({ stance: '⊕' }),
    }) as any;
    const r = await reviewSelfEditProposal({
      goal: 'g', files: [{ relPath: 'docs/A.md', content: 'x' }], testResult: OK_TEST_RESULT,
      council: [member('a'), member('b'), member('c')], kiraStatePath: NO_BRAIN_STATE,
    });
    expect(r.overallVerdict).toBe('GREEN');
    expect(r.quorum.redVotes).toBe(0);
    expect(r.results.length).toBe(3);
  });

  it('any ⊘ (reject/veto) -> overallVerdict RED (RED always wins)', async () => {
    globalThis.fetch = mockFetchByModel({
      'test/a': glyphLine({ stance: '⊕' }), 'test/b': glyphLine({ stance: '⊘', dist: [0.1, 0.1, 0.1, 0.7] }),
    }) as any;
    const r = await reviewSelfEditProposal({
      goal: 'g', files: [{ relPath: 'docs/A.md', content: 'x' }], testResult: OK_TEST_RESULT,
      council: [member('a'), member('b')], kiraStatePath: NO_BRAIN_STATE,
    });
    expect(r.overallVerdict).toBe('RED');
  });

  it('a ⊙ (neutral) with no ⊘ -> overallVerdict YELLOW', async () => {
    globalThis.fetch = mockFetchByModel({
      'test/a': glyphLine({ stance: '⊕' }), 'test/b': glyphLine({ stance: '⊙', dist: [0.2, 0.2, 0.3, 0.3] }),
    }) as any;
    const r = await reviewSelfEditProposal({
      goal: 'g', files: [{ relPath: 'docs/A.md', content: 'x' }], testResult: OK_TEST_RESULT,
      council: [member('a'), member('b')], kiraStatePath: NO_BRAIN_STATE,
    });
    expect(r.overallVerdict).toBe('YELLOW');
  });

  it('all models fail to respond -> NO_QUORUM, incidents logged, never fabricated as RED', async () => {
    globalThis.fetch = mockFetchByModel({ 'test/a': null, 'test/b': null }) as any;
    const r = await reviewSelfEditProposal({
      goal: 'g', files: [{ relPath: 'docs/A.md', content: 'x' }], testResult: OK_TEST_RESULT,
      council: [member('a'), member('b')], kiraStatePath: NO_BRAIN_STATE,
    });
    expect(r.overallVerdict).toBe('NO_QUORUM');
    expect(r.quorum.redVotes).toBe(0);
    expect(r.results.every((res) => res.adapterFailure)).toBe(true);
    // Both models fail identically (same quarantinePacket() shape), which is itself a real
    // phase-lock-detectable case, so a model_timeout incident per model is expected, plus
    // possibly a phase_lock_detected incident — never a fabricated RED vote either way.
    expect(r.incidents.filter((i) => i.type === 'model_timeout').length).toBe(2);
    expect(r.overallVerdict).not.toBe('RED');
  });

  it('a malformed glyph response is a non-vote adapter failure, not a fabricated RED', async () => {
    globalThis.fetch = mockFetchByModel({
      'test/a': glyphLine({ stance: '⊕' }), 'test/b': 'garbage, not a glyph at all',
    }) as any;
    const r = await reviewSelfEditProposal({
      goal: 'g', files: [{ relPath: 'docs/A.md', content: 'x' }], testResult: OK_TEST_RESULT,
      council: [member('a'), member('b')], kiraStatePath: NO_BRAIN_STATE,
    });
    const bResult = r.results.find((res) => res.model === 'b');
    expect(bResult?.adapterFailure).toBe(true);
    expect(bResult?.verdict).not.toBe('RED'); // fallback packet reads YELLOW-shaped (⊚), never RED
    expect(r.incidents.some((i) => i.type === 'malformed_glyph')).toBe(true);
  });
});

describe('selfEditReviewCouncil: real aukora-fu signals (contradictions, shear, phase-lock)', () => {
  it('genuinely disagreeing models produce a real contradiction with a meaningful shear magnitude', async () => {
    globalThis.fetch = mockFetchByModel({
      'test/a': glyphLine({ stance: '⊕', dist: [1, 0, 0, 0] }),
      'test/b': glyphLine({ stance: '⊖', dist: [0, 1, 0, 0] }),
    }) as any;
    const r = await reviewSelfEditProposal({
      goal: 'g', files: [{ relPath: 'docs/A.md', content: 'x' }], testResult: OK_TEST_RESULT,
      council: [member('a'), member('b')], kiraStatePath: NO_BRAIN_STATE,
    });
    expect(r.contradictions.length).toBeGreaterThan(0);
    expect(r.strongestContradiction).not.toBeNull();
    expect(r.strongestContradiction!.shearMagnitude).toBeGreaterThan(0.6);
  });

  it('identical distributions across the whole council -> phase-locked, escalated off a raw GREEN', async () => {
    globalThis.fetch = mockFetchByModel({
      'test/a': glyphLine({ stance: '⊕' }), 'test/b': glyphLine({ stance: '⊕' }), 'test/c': glyphLine({ stance: '⊕' }),
    }) as any;
    const r = await reviewSelfEditProposal({
      goal: 'g', files: [{ relPath: 'docs/A.md', content: 'x' }], testResult: OK_TEST_RESULT,
      council: [member('a'), member('b'), member('c')], kiraStatePath: NO_BRAIN_STATE,
    });
    expect(r.phaseLocked).toBe(true);
  });

  it('gateAction reflects AukoraFuEngine.reason()\'s real GateDecision, not a re-derived value', async () => {
    // gateAction is driven by perceive()'s KL-divergence verdict over the raw distributions, NOT by
    // the stance glyph label — orthogonal distributions (not merely a "⊘" label) are what produce a
    // real RED verdict and thus a quarantine gate action.
    globalThis.fetch = mockFetchByModel({
      'test/a': glyphLine({ stance: '⊘', dist: [1, 0, 0, 0] }), 'test/b': glyphLine({ stance: '⊘', dist: [0, 1, 0, 0] }),
    }) as any;
    const r = await reviewSelfEditProposal({
      goal: 'g', files: [{ relPath: 'docs/A.md', content: 'x' }], testResult: OK_TEST_RESULT,
      council: [member('a'), member('b')], kiraStatePath: NO_BRAIN_STATE,
    });
    expect(r.gateAction).toBe('quarantine');
  });
});

describe('selfEditReviewCouncil: real fusion-run-v1 / fusion-self-review-v1 artifacts (issue #5)', () => {
  it('produces a validated fusion-run-v1 artifact from real aukora-fu output', async () => {
    globalThis.fetch = mockFetchByModel({
      'test/a': glyphLine({ stance: '⊕' }), 'test/b': glyphLine({ stance: '⊕' }),
    }) as any;
    const r = await reviewSelfEditProposal({
      goal: 'add a note', files: [{ relPath: 'docs/A.md', content: 'x' }], testResult: OK_TEST_RESULT,
      council: [member('a'), member('b')], kiraStatePath: NO_BRAIN_STATE,
    });
    expect(r.fusionRunValid).toBe(true);
    expect(r.fusionRunArtifact).not.toBeNull();
    expect(r.fusionRunArtifact!.schema).toBe('fusion-run-v1');
    expect(r.fusionRunArtifact!.cells.length).toBe(2);
  });

  it('produces a validated fusion-self-review-v1 built from the real run artifact', async () => {
    globalThis.fetch = mockFetchByModel({
      'test/a': glyphLine({ stance: '⊕' }), 'test/b': glyphLine({ stance: '⊕' }), 'test/c': glyphLine({ stance: '⊕' }),
    }) as any;
    const r = await reviewSelfEditProposal({
      goal: 'add a note', files: [{ relPath: 'docs/A.md', content: 'x' }], testResult: OK_TEST_RESULT,
      council: [member('a'), member('b'), member('c')], kiraStatePath: NO_BRAIN_STATE,
    });
    expect(r.fusionSelfReviewValid).toBe(true);
    expect(r.fusionSelfReview).not.toBeNull();
    expect(r.fusionSelfReview!.schema).toBe('fusion-self-review-v1');
    expect(typeof r.fusionSelfReview!.recommendedNextChange).toBe('string');
  });
});

describe('selfEditReviewCouncil: Kira recall (issue #5) — read-only, advisory, never authority', () => {
  it('a missing brain state file reads as an empty brain (zero hits), never throws', async () => {
    globalThis.fetch = mockFetchByModel({ 'test/a': glyphLine({}), 'test/b': glyphLine({}) }) as any;
    const r = await reviewSelfEditProposal({
      goal: 'g', files: [{ relPath: 'docs/A.md', content: 'x' }], testResult: OK_TEST_RESULT,
      council: [member('a'), member('b')], kiraStatePath: NO_BRAIN_STATE,
    });
    expect(r.kiraRecall).not.toBeNull();
    expect(r.kiraRecall!.hits).toEqual([]);
  });

  it('surfaces real, cited recall hits from a constructed disposable brain state', async () => {
    globalThis.fetch = mockFetchByModel({ 'test/a': glyphLine({}) }) as any;
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-kira-recall-'));
    const statePath = path.join(dir, 'brain.json');
    const ingested = ingestMemory(createEmptyBrain(), {
      text: 'A prior note about the docs A.md file and its rollback behavior.',
      source: 'test', scope: 'docs', tags: ['rollback'],
    });
    saveBrainState(statePath, ingested.state);

    const r = await reviewSelfEditProposal({
      goal: 'docs A.md rollback', files: [{ relPath: 'docs/A.md', content: 'x' }], testResult: OK_TEST_RESULT,
      council: [member('a')], kiraStatePath: statePath,
    });
    expect(r.kiraRecall).not.toBeNull();
    expect(r.kiraRecall!.hits.length).toBeGreaterThan(0);
    expect(r.kiraRecall!.hits[0].advisoryOnly).toBe(true);
    expect(r.kiraRecall!.hits[0].grantsAuthority).toBe(false);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a corrupt brain state file reads as "no context available", never throws or fails the review', async () => {
    globalThis.fetch = mockFetchByModel({ 'test/a': glyphLine({}) }) as any;
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-kira-recall-'));
    const statePath = path.join(dir, 'brain.json');
    fs.writeFileSync(statePath, 'not valid json{{{');
    const r = await reviewSelfEditProposal({
      goal: 'g', files: [{ relPath: 'docs/A.md', content: 'x' }], testResult: OK_TEST_RESULT,
      council: [member('a')], kiraStatePath: statePath,
    });
    expect(r.kiraRecall).toBeNull();
    expect(r.results.length).toBe(1); // the council review itself still ran fine despite the corrupt brain state
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('selfEditReviewCouncil: secret-content guard (external-API exposure surface)', () => {
  it('refuses to send a proposal containing a private-key block to any external review — fetch never called', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
    const r = await reviewSelfEditProposal({
      goal: 'g',
      files: [{ relPath: 'docs/A.md', content: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----' }],
      testResult: OK_TEST_RESULT,
      council: [member('a')], kiraStatePath: NO_BRAIN_STATE,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r.skippedReason).toMatch(/secret/i);
    expect(r.results).toEqual([]);
    expect(r.overallVerdict).toBe('NO_QUORUM');
  });

  it('refuses a proposal touching an aumlok-shaped path without ever calling fetch', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
    const r = await reviewSelfEditProposal({
      goal: 'g', files: [{ relPath: 'authority/aumlok/x.ts', content: 'anything' }], testResult: OK_TEST_RESULT,
      council: [member('a')], kiraStatePath: NO_BRAIN_STATE,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r.skippedReason).toBeTruthy();
  });

  it('allows an ordinary, harmless proposal through to review', async () => {
    globalThis.fetch = mockFetchByModel({ 'test/a': glyphLine({}) }) as any;
    const r = await reviewSelfEditProposal({
      goal: 'g', files: [{ relPath: 'docs/A.md', content: 'hello world' }], testResult: OK_TEST_RESULT,
      council: [member('a')], kiraStatePath: NO_BRAIN_STATE,
    });
    expect(r.skippedReason).toBeNull();
    expect(r.results.length).toBe(1);
  });
});

// Issue #21 regression: aukoraFuEngine's emitGlyph used to re-truncate the already-bounded evidence
// pack (selfEditReviewCouncil's own MAX_EVIDENCE_CHARS = 12_000) down to 400 chars before ever
// building the model prompt — every council vote was cast on a goal/preamble fragment, never the
// actual proposed file content. This must fail on the old `problem.slice(0, 400)` code and pass now.
describe('selfEditReviewCouncil: Fusion sees the real evidence pack, not a 400-char preamble (issue #21)', () => {
  it('a sentinel string placed well past the old 400-char cutoff reaches the outgoing model request body', async () => {
    const capturedBodies: string[] = [];
    globalThis.fetch = vi.fn(async (_url: unknown, opts: { body: string }) => {
      capturedBodies.push(opts.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: glyphLine({}) } }] }) };
    }) as any;

    const filler = 'x'.repeat(600); // the preamble + this filler alone already exceeds the old 400-char cutoff
    const sentinel = 'SENTINEL_9f3a7c_ISSUE21_REGRESSION_MARKER';
    const r = await reviewSelfEditProposal({
      goal: 'demo goal for issue 21',
      files: [{ relPath: 'core/src/example.ts', content: `${filler}\n${sentinel}\n` }],
      testResult: OK_TEST_RESULT,
      council: [member('a'), member('b')],
      kiraStatePath: NO_BRAIN_STATE,
    });

    expect(r.skippedReason).toBeNull();
    expect(capturedBodies.length).toBeGreaterThan(0);
    for (const body of capturedBodies) {
      expect(body).toContain(sentinel);
    }
  });
});

describe('selfEditReviewCouncil: missing-key fail-fast (issue #21)', () => {
  it('an empty resolved API key short-circuits to NO_QUORUM/missing_key and never calls fetch', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
    const r = await reviewSelfEditProposal({
      goal: 'g', files: [{ relPath: 'docs/A.md', content: 'hello world' }], testResult: OK_TEST_RESULT,
      council: [member('a'), member('b')], kiraStatePath: NO_BRAIN_STATE,
      apiKey: '', // simulates resolveApiKey() finding nothing, deterministically (no env dependency)
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r.overallVerdict).toBe('NO_QUORUM');
    expect(r.results).toEqual([]);
    expect(r.councilModels).toEqual([]);
    expect(r.skippedReason).toMatch(/missing_key/);
    expect(r.advisoryOnly).toBe(true);
    expect(r.grantsAuthority).toBe(false);
  });

  it('a real (non-empty) key still proceeds to a normal review, unaffected by the guard', async () => {
    globalThis.fetch = mockFetchByModel({ 'test/a': glyphLine({}) }) as any;
    const r = await reviewSelfEditProposal({
      goal: 'g', files: [{ relPath: 'docs/A.md', content: 'hello world' }], testResult: OK_TEST_RESULT,
      council: [member('a')], kiraStatePath: NO_BRAIN_STATE,
      apiKey: 'a-real-looking-test-key',
    });
    expect(r.skippedReason).toBeNull();
    expect(r.results.length).toBe(1);
  });
});

describe('selfEditReviewCouncil: packetsToAdvisoryResults adapter', () => {
  it('maps stance glyphs to the shared verdict vocabulary correctly', () => {
    const packets = [
      { modelId: 'a', stance: '⊕' as const, confidence: '↑' as const, strategy: '↗' as const, distribution: { explore: 1, exploit: 0, verify: 0, abstain: 0 }, hypothesis: 'h', reasoning: '', timestamp: 0 },
      { modelId: 'b', stance: '⊘' as const, confidence: '↑' as const, strategy: '↗' as const, distribution: { explore: 1, exploit: 0, verify: 0, abstain: 0 }, hypothesis: 'h', reasoning: '', timestamp: 0 },
      { modelId: 'c', stance: '⊙' as const, confidence: '↑' as const, strategy: '↗' as const, distribution: { explore: 1, exploit: 0, verify: 0, abstain: 0 }, hypothesis: 'h', reasoning: '', timestamp: 0 },
    ];
    const results = packetsToAdvisoryResults(packets, []);
    expect(results.find((r) => r.model === 'a')?.verdict).toBe('GREEN');
    expect(results.find((r) => r.model === 'b')?.verdict).toBe('RED');
    expect(results.find((r) => r.model === 'c')?.verdict).toBe('YELLOW');
  });

  it('a packet with an accompanying incident is adapterFailure:true regardless of its stance', () => {
    const packets = [
      { modelId: 'a', stance: '⊚' as const, confidence: '↓' as const, strategy: '↙' as const, distribution: { explore: 0.1, exploit: 0.1, verify: 0.4, abstain: 0.4 }, hypothesis: 'h', reasoning: '', timestamp: 0 },
    ];
    const results = packetsToAdvisoryResults(packets, [{ type: 'model_timeout', modelId: 'a', timestamp: 0, action: 'quarantined' }]);
    expect(results[0].adapterFailure).toBe(true);
    expect(results[0].failureReason).toBe('model_timeout');
  });
});

describe('selfEditReviewCouncil: transcript formatting', () => {
  it('formats a skipped review honestly', () => {
    const text = formatSelfEditReviewSummary({
      schema: 'self-edit-review-v2', goal: 'g', councilModels: [], results: [],
      quorum: { status: 'NO_QUORUM', completedCount: 0, failureCount: 0, totalCount: 0, adapterFailuresArePoisoning: false, reason: 'x', completedVotes: 0, nonVotes: 0, redVotes: 0, greenVotes: 0, yellowVotes: 0 },
      overallVerdict: 'NO_QUORUM', recommendations: [], skippedReason: 'secret-shaped content',
      gateAction: 'quarantine', insight: '', contradictions: [], strongestContradiction: null, phaseLocked: false, incidents: [], patchesApplied: 0,
      fusionRunArtifact: null, fusionRunValid: false, fusionSelfReview: null, fusionSelfReviewValid: false, kiraRecall: null,
      advisoryOnly: true, grantsAuthority: false, createdAt: 'now',
    });
    expect(text).toContain('SKIPPED');
  });

  it('formats a real verdict and always states neither Fusion nor Kira authorizes', async () => {
    globalThis.fetch = mockFetchByModel({ 'test/a': glyphLine({ stance: '⊕' }), 'test/b': glyphLine({ stance: '⊕' }) }) as any;
    const r = await reviewSelfEditProposal({
      goal: 'g', files: [{ relPath: 'docs/A.md', content: 'x' }], testResult: OK_TEST_RESULT,
      council: [member('a'), member('b')], kiraStatePath: NO_BRAIN_STATE,
    });
    const text = formatSelfEditReviewSummary(r);
    expect(text).toMatch(/authorizes/);
    expect(text).toContain('fusion-run-v1: validated');
  });

  it('flags phase-lock and the strongest contradiction in the rendered transcript when present', async () => {
    globalThis.fetch = mockFetchByModel({
      'test/a': glyphLine({ stance: '⊕', dist: [1, 0, 0, 0] }),
      'test/b': glyphLine({ stance: '⊖', dist: [0, 1, 0, 0] }),
    }) as any;
    const r = await reviewSelfEditProposal({
      goal: 'g', files: [{ relPath: 'docs/A.md', content: 'x' }], testResult: OK_TEST_RESULT,
      council: [member('a'), member('b')], kiraStatePath: NO_BRAIN_STATE,
    });
    const text = formatSelfEditReviewSummary(r);
    expect(text).toContain('Strongest contradiction');
  });
});

// Issue #34/Round 6: every test above passes `council` explicitly (a test-only override), so none of
// them exercise the DEFAULT path at all. This proves AUKORA_FUSION_MODELS actually reaches a real
// (unmocked-council) review run — the exact path "run fusion review"/"run:" use in the real workbench,
// which never passes `council` itself.
describe('selfEditReviewCouncil: AUKORA_FUSION_MODELS narrows the DEFAULT roster (issue #34)', () => {
  let prevRoster: string | undefined;
  beforeEach(() => { prevRoster = process.env.AUKORA_FUSION_MODELS; });
  afterEach(() => { if (prevRoster === undefined) delete process.env.AUKORA_FUSION_MODELS; else process.env.AUKORA_FUSION_MODELS = prevRoster; });

  it('when council is NOT passed explicitly, AUKORA_FUSION_MODELS narrows which of the real 5 default models are actually contacted', async () => {
    process.env.AUKORA_FUSION_MODELS = 'deepseek/deepseek-v4-pro,z-ai/glm-5.2';
    const contacted = new Set<string>();
    globalThis.fetch = vi.fn(async (_url: unknown, opts: { body: string }) => {
      contacted.add(JSON.parse(opts.body).model);
      return { ok: true, json: async () => ({ choices: [{ message: { content: glyphLine({}) } }] }) };
    }) as any;

    await reviewSelfEditProposal({
      goal: 'g', files: [{ relPath: 'docs/A.md', content: 'x' }], testResult: OK_TEST_RESULT,
      apiKey: 'test-key', kiraStatePath: NO_BRAIN_STATE,
      // council intentionally OMITTED — must fall through to resolveFusionCouncil(defaultCouncil())
    });

    expect(contacted).toEqual(new Set(['deepseek/deepseek-v4-pro', 'z-ai/glm-5.2']));
  });

  it('with no env override and no explicit council, all 5 real default models are contacted (unchanged default behavior)', async () => {
    delete process.env.AUKORA_FUSION_MODELS;
    const contacted = new Set<string>();
    globalThis.fetch = vi.fn(async (_url: unknown, opts: { body: string }) => {
      contacted.add(JSON.parse(opts.body).model);
      return { ok: true, json: async () => ({ choices: [{ message: { content: glyphLine({}) } }] }) };
    }) as any;

    await reviewSelfEditProposal({
      goal: 'g', files: [{ relPath: 'docs/A.md', content: 'x' }], testResult: OK_TEST_RESULT,
      apiKey: 'test-key', kiraStatePath: NO_BRAIN_STATE,
    });

    expect(contacted.size).toBe(5);
  });
});

describe('selfEditReviewCouncil: roster fail-closed guards (issue #34, offline)', () => {
  let prevModels: string | undefined;
  beforeEach(() => { prevModels = process.env.AUKORA_FUSION_MODELS; });
  afterEach(() => { if (prevModels === undefined) delete process.env.AUKORA_FUSION_MODELS; else process.env.AUKORA_FUSION_MODELS = prevModels; });

  it('an all-unknown AUKORA_FUSION_MODELS fails closed (bad_roster) and contacts NO model', async () => {
    process.env.AUKORA_FUSION_MODELS = 'totally/made-up-a,totally/made-up-b';
    // fetch throws: proves the fail-closed skip returns BEFORE the engine ever calls out (no full-council spend).
    globalThis.fetch = (() => { throw new Error('no network expected'); }) as any;
    const r = await reviewSelfEditProposal({
      goal: 'g', files: [{ relPath: 'docs/A.md', content: 'x' }], testResult: OK_TEST_RESULT,
      apiKey: 'test-key', kiraStatePath: NO_BRAIN_STATE, // apiKey present so it passes the missing-key skip first
    });
    expect(r.overallVerdict).toBe('NO_QUORUM');
    expect(r.skippedReason).toMatch(/bad_roster/);
    expect(r.councilModels).toEqual([]); // never fell back to the full default council
  });

  it('an explicitly empty council never reaches quorum math (empty_council) and contacts NO model', async () => {
    globalThis.fetch = (() => { throw new Error('no network expected'); }) as any;
    const r = await reviewSelfEditProposal({
      goal: 'g', files: [{ relPath: 'docs/A.md', content: 'x' }], testResult: OK_TEST_RESULT,
      apiKey: 'test-key', council: [], kiraStatePath: NO_BRAIN_STATE,
    });
    expect(r.overallVerdict).toBe('NO_QUORUM');
    expect(r.skippedReason).toMatch(/empty_council/);
    expect(r.councilModels).toEqual([]);
  });
});
