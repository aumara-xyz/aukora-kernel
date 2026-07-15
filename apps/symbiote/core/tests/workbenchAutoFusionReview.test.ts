import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// The council and the agent engine are the two network edges of this loop — both mocked, so this
// suite exercises ONLY the new wiring: the advisory sidecar landing next to pending-proposals, and
// the env-gated auto-review hook on the bare `agent:` path (default OFF, never gates).
let reviewCalls = 0;
let cannedVerdict: 'GREEN' | 'YELLOW' | 'RED' | 'NO_QUORUM' = 'YELLOW';
vi.mock('../src/selfEditReviewCouncil', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/selfEditReviewCouncil')>();
  return {
    ...actual,
    reviewSelfEditProposal: async (input: { goal: string }) => {
      reviewCalls += 1;
      return {
        schema: 'self-edit-review-v2',
        goal: input.goal,
        councilModels: ['deepseek/deepseek-v4-pro'],
        // #178 round 3: per-seat results so the seat-ledger emission has seats to record.
        results: [
          { model: 'QWN', label: 'proposal', durationMs: 900, adapterFailure: false, provider_contacted: true, verdict: 'YELLOW', findings: '', risks: '', missing_tests: '', recommended_next_commit: '' },
          { model: 'DSK', label: 'proposal', durationMs: 800, adapterFailure: true, provider_contacted: true, verdict: 'RED', findings: '', risks: '', missing_tests: '', recommended_next_commit: '' },
        ],
        quorum: {
          status: 'YELLOW_QUORUM', completedCount: 1, failureCount: 0, totalCount: 1,
          adapterFailuresArePoisoning: false, reason: 'canned',
          completedVotes: 1, nonVotes: 0, redVotes: 0, greenVotes: 0, yellowVotes: 1,
        },
        overallVerdict: cannedVerdict,
        recommendations: ['canned recommendation'],
        gateAction: 'proceed_with_caution',
        insight: 'canned insight',
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
        kiraRecall: null,
      };
    },
    formatSelfEditReviewSummary: () => 'canned formatted review',
  };
});

const AGENT_HASH = 'f0'.repeat(32);
vi.mock('../src/nativeToolCallingEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/nativeToolCallingEngine')>();
  return {
    ...actual,
    runNativeAgent: async (goal: string) => ({
      model: 'test-model',
      rounds: 1,
      toolCalls: [],
      stoppedReason: 'proposed_patch',
      proposedGoal: goal,
      candidateFiles: [{ relPath: 'docs/AUTO_REVIEW_FIXTURE.md', content: 'hello from the fixture' }],
      proposalHash: AGENT_HASH,
    }),
  };
});

import { runWorkbenchCommand, freshWorkbenchSession } from '../src/workbenchCommandLoop';
import { proposalAdvisoriesDir, readProposalFusionAdvisory } from '../src/proposalFusionAdvisory';
import { readSeatLedgerRows, readOwnerDecisionRows, appendSeatLedgerRows } from '../src/fusionSeatLedger';

let home = '';
const savedHome = process.env.AUKORA_SYMBIOTE_HOME;
const savedAuto = process.env.AUKORA_AUTO_FUSION_REVIEW;
const savedKira = process.env.AUKORA_KIRA_STATE;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'aukora-autoreview-'));
  process.env.AUKORA_SYMBIOTE_HOME = home;
  process.env.AUKORA_KIRA_STATE = path.join(home, 'no-brain.json'); // hermetic recall
  delete process.env.AUKORA_AUTO_FUSION_REVIEW;
  reviewCalls = 0;
  cannedVerdict = 'YELLOW';
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  if (savedHome === undefined) delete process.env.AUKORA_SYMBIOTE_HOME; else process.env.AUKORA_SYMBIOTE_HOME = savedHome;
  if (savedAuto === undefined) delete process.env.AUKORA_AUTO_FUSION_REVIEW; else process.env.AUKORA_AUTO_FUSION_REVIEW = savedAuto;
  if (savedKira === undefined) delete process.env.AUKORA_KIRA_STATE; else process.env.AUKORA_KIRA_STATE = savedKira;
});

const PROPOSE = 'propose patch\ngoal: fixture change\n--- file: docs/AUTO_REVIEW_FIXTURE.md\nhello\n--- end';

describe('fusion advisory sidecar — the verdict travels with the proposal', () => {
  it('run fusion review persists a readable sidecar keyed by the proposal hash', async () => {
    const s = freshWorkbenchSession();
    await runWorkbenchCommand(PROPOSE, s);
    const hash = s.lastProposal!.proposalHash;
    const entries = await runWorkbenchCommand('run fusion review', s);

    const note = entries.find((e) => /fusion advisory sidecar ->/.test(e.text ?? ''));
    expect(note, 'sidecar entry announced').toBeDefined();
    const r = readProposalFusionAdvisory(hash, home);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.advisory.overallVerdict).toBe('YELLOW');
      expect(r.advisory.grantsAuthority).toBe(false);
      expect(r.advisory.goal).toBe('fixture change');
    }
  });

  it('run fusion review also records one seat-ledger row per council seat (#178 round 3)', async () => {
    const s = freshWorkbenchSession();
    await runWorkbenchCommand(PROPOSE, s);
    const hash = s.lastProposal!.proposalHash;
    const entries = await runWorkbenchCommand('run fusion review', s);

    expect(entries.some((e) => /seat ledger: 2 row\(s\) ->/.test(e.text ?? ''))).toBe(true);
    const { rows, skippedInvalid } = readSeatLedgerRows(home);
    expect(skippedInvalid).toBe(0);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.seat, r.vote])).toEqual([['QWN', 'YELLOW'], ['DSK', 'NON_VOTE']]);
    for (const r of rows) {
      expect(r.key).toBe(hash);
      expect(r.runKind).toBe('proposal-review');
      expect(r.grantsAuthority).toBe(false);
    }
  });


  it('run fusion review also backfills owner decisions from the applied ledger (#178 round 4)', async () => {
    // an OLD reviewed proposal the owner has since signed (applied ledger written behind the signature)
    const oldKey = 'a1'.repeat(32);
    appendSeatLedgerRows([{
      schema: 'fusion-seat-ledger-row-v1', createdAt: '2026-07-08T00:00:00.000Z', runKind: 'proposal-review',
      key: oldKey, seat: 'QWN', vote: 'GREEN', providerContacted: true, durationMs: 5,
      overallVerdict: 'GREEN', quorumStatus: 'GREEN_QUORUM', phaseLocked: false,
      advisoryOnly: true, grantsAuthority: false,
    }], home);
    fs.mkdirSync(path.join(home, 'aumlok'), { recursive: true });
    fs.writeFileSync(path.join(home, 'aumlok', 'applied-ledger.json'),
      JSON.stringify([{ proposalHash: oldKey, appliedAt: '2026-07-08T01:00:00.000Z', commitSha: 'c0ffee123456' }]));

    const s = freshWorkbenchSession();
    await runWorkbenchCommand(PROPOSE, s);
    const entries = await runWorkbenchCommand('run fusion review', s);

    expect(entries.some((e) => /owner-decision join: 1 new/.test(e.text ?? ''))).toBe(true);
    const decisions = readOwnerDecisionRows(home);
    expect(decisions.skippedInvalid).toBe(0);
    expect(decisions.rows).toHaveLength(1);
    expect(decisions.rows[0].key).toBe(oldKey);
    expect(decisions.rows[0].ownerDecision).toBe('signed-applied');
  });

  it('a RED verdict still writes the sidecar and still gates nothing (ok stays true)', async () => {
    cannedVerdict = 'RED';
    const s = freshWorkbenchSession();
    await runWorkbenchCommand(PROPOSE, s);
    const entries = await runWorkbenchCommand('run fusion review', s);
    expect(entries.some((e) => e.kind === 'error')).toBe(false); // reviewer, never a hand
    const r = readProposalFusionAdvisory(s.lastProposal!.proposalHash, home);
    expect(r.ok && r.advisory.overallVerdict).toBe('RED');
  });
});

describe('auto fusion review on agent: — env opt-in, default OFF', () => {
  it('default OFF: a bare agent: draft runs NO council review (landing arms nothing)', async () => {
    const s = freshWorkbenchSession();
    await runWorkbenchCommand('agent: make the fixture change', s);
    expect(reviewCalls).toBe(0);
    expect(s.toolCallsUsed).not.toContain('fusion_review');
    expect(readProposalFusionAdvisory(AGENT_HASH, home).ok).toBe(false);
  });

  it('AUKORA_AUTO_FUSION_REVIEW=1: the draft is auto-reviewed and the sidecar lands', async () => {
    process.env.AUKORA_AUTO_FUSION_REVIEW = '1';
    const s = freshWorkbenchSession();
    const entries = await runWorkbenchCommand('agent: make the fixture change', s);
    expect(reviewCalls).toBe(1);
    expect(s.toolCallsUsed).toContain('fusion_review');
    expect(entries.some((e) => /auto fusion review/.test(e.text ?? ''))).toBe(true);
    expect(entries.some((e) => /never gates/.test(e.text ?? ''))).toBe(true);
    const r = readProposalFusionAdvisory(AGENT_HASH, home);
    expect(r.ok).toBe(true);
  });

  it('the flag does not resurrect a failed draft: no proposal → no auto review', async () => {
    process.env.AUKORA_AUTO_FUSION_REVIEW = '1';
    const s = freshWorkbenchSession();
    // agent: with an empty goal errors before any engine/council call
    const entries = await runWorkbenchCommand('agent:    ', s);
    expect(entries.some((e) => e.kind === 'error')).toBe(true);
    expect(reviewCalls).toBe(0);
  });
});
