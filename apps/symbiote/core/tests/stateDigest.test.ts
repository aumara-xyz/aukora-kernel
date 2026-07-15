// Issue #37: state digest pipeline. buildStateDigest/formatDigestText are pure and tested directly;
// the "does this actually land in Kira correctly" half is tested here too, against a REAL (throwaway)
// Kira brain via ingestMemory directly — the same function captureWithReceipt/captureWorkbenchEvent
// call underneath — since the live-apply success branch that actually calls this in production is
// structurally unreachable from workbenchCommandLoop.test.ts (dispatchSignedLiveApply has no test
// override, by design; see that file's own "apply signed proposal" describe block).
import { describe, it, expect } from 'vitest';
import { buildStateDigest, formatDigestText, type StateDigestInput } from '../src/stateDigest';
import { createEmptyBrain, ingestMemory, recall, verifyBrainState } from '../src/kiraBrain';
import type { AumlokLiveApplyReceiptV1 } from '../src/nativeLiveApply';

function fixtureReceipt(overrides: Partial<AumlokLiveApplyReceiptV1> = {}): AumlokLiveApplyReceiptV1 {
  return {
    schema: 'aumlok-live-apply-receipt-v1',
    version: 1,
    task: 'add a clarifying comment',
    targetFiles: ['core/src/example.ts'],
    proposalHash: 'a'.repeat(64),
    signerKeyId: 'test-signer',
    preImageSnapshotHash: 'b'.repeat(64),
    commitSha: 'c'.repeat(40),
    rollbackCommand: `git revert ${'c'.repeat(40)}`,
    appliedLive: true,
    promotionReady: false,
    advisoryOnly: true,
    grantsAuthority: false,
    createdAt: '2026-07-02T10:00:00.000Z',
    receiptHash: 'd'.repeat(64),
    ...overrides,
  };
}

function fixtureInput(overrides: Partial<StateDigestInput> = {}): StateDigestInput {
  return {
    receipt: fixtureReceipt(),
    proposal: { goal: 'add a clarifying comment', files: [{ relPath: 'core/src/example.ts', content: '// clarifying comment\nexport const x = 1;\n' }] },
    testResult: { passed: true, ran: ['tsc --noEmit'], detail: 'ok=true exitCode=0' },
    now: '2026-07-02T10:00:05.000Z',
    ...overrides,
  };
}

describe('stateDigest: buildStateDigest / formatDigestText (pure)', () => {
  it('digestId is exactly the receiptHash prefix, matching kiraBrain\'s SAFE_ID shape', () => {
    const { digestId } = buildStateDigest(fixtureInput());
    expect(digestId).toBe('d'.repeat(16));
    expect(digestId.length).toBe(16);
  });

  it('the text contains the goal, the changed file, a checks summary, and a receipt reference', () => {
    const { text } = buildStateDigest(fixtureInput());
    expect(text).toContain('goal: add a clarifying comment');
    expect(text).toContain('core/src/example.ts');
    expect(text).toContain('checks: PASSED');
    expect(text).toContain('tsc --noEmit');
    expect(text).toContain('receipt_ref:');
  });

  it('never embeds a raw 40+ hex-char run — every sha is pre-truncated to 12 chars in the formatter itself', () => {
    const { text } = buildStateDigest(fixtureInput());
    expect(text).not.toMatch(/[0-9a-f]{40,}/i);
    // still traceable — truncated prefixes ARE present
    expect(text).toContain('a'.repeat(12));
    expect(text).toContain('c'.repeat(12));
  });

  it('missing testResult (null) still produces valid, honest text', () => {
    const { text } = buildStateDigest(fixtureInput({ testResult: null }));
    expect(text).toContain('no test result was recorded');
  });

  it('loc figures are explicitly after-only — no before/after delta claimed (v1 scope)', () => {
    const { text } = buildStateDigest(fixtureInput());
    expect(text).toContain('after-only');
    expect(text).not.toMatch(/\bdelta\b.*[+-]\d/i); // no numeric delta claim anywhere
  });

  it('a file list beyond the 25-entry cap is truncated with an honest "and N more"', () => {
    const files = Array.from({ length: 30 }, (_, i) => ({ relPath: `core/src/file${i}.ts`, content: 'x\n' }));
    const { text } = buildStateDigest(fixtureInput({ proposal: { goal: 'g', files } }));
    expect(text).toContain('files_changed (30):');
    expect(text).toContain('and 5 more');
    expect(text.split('\n').filter((l) => l.trim().startsWith('- core/src/file')).length).toBe(25);
  });

  it('stays under the ~3000-char cap even with a large valid input', () => {
    const files = Array.from({ length: 25 }, (_, i) => ({ relPath: `core/src/veryLongModuleNameForPaddingPurposesOnly${i}.ts`, content: 'x\n'.repeat(500) }));
    const { text } = buildStateDigest(fixtureInput({ proposal: { goal: 'g'.repeat(200), files } }));
    expect(text.length).toBeLessThanOrEqual(3_000);
  });

  it('formatDigestText is deterministic for the same inputs (aside from the caller-supplied now)', () => {
    const input = fixtureInput();
    const a = formatDigestText(input, 'fixedid1234567890', '2026-07-02T10:00:05.000Z');
    const b = formatDigestText(input, 'fixedid1234567890', '2026-07-02T10:00:05.000Z');
    expect(a).toBe(b);
  });
});

describe('stateDigest: real ingestion into Kira (issue #37 acceptance — a digest produces one recallable atom)', () => {
  it('a built digest ingests into a real (throwaway) Kira brain without throwing, tagged correctly, advisory-only', () => {
    const { text, tags } = buildStateDigest(fixtureInput());
    const before = createEmptyBrain('2026-07-02T09:00:00.000Z');
    expect(before.atoms.length).toBe(0);

    const { state: after, atom } = ingestMemory(before, {
      kind: 'receipt',
      text,
      source: 'workbench_live_apply',
      scope: 'digest',
      tags,
      now: '2026-07-02T10:00:05.000Z',
    });

    expect(after.atoms.length).toBe(1);
    expect(after.receipts.length).toBe(1);
    expect(atom.tags).toEqual(expect.arrayContaining(['digest', 'live_apply']));
    expect(atom.advisoryOnly).toBe(true);
    expect(atom.grantsAuthority).toBe(false);
    expect(verifyBrainState(after).ok).toBe(true);
  });

  it('recall("what changed") surfaces the digest atom via its tags/text, cited by receipt', () => {
    const { text, tags } = buildStateDigest(fixtureInput());
    let state = createEmptyBrain('2026-07-02T09:00:00.000Z');
    const { state: after, receipt } = ingestMemory(state, {
      kind: 'receipt', text, source: 'workbench_live_apply', scope: 'digest', tags, now: '2026-07-02T10:00:05.000Z',
    });
    state = after;

    const result = recall(state, 'what changed clarifying comment digest', 5);
    expect(result.grantsAuthority).toBe(false);
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0].receiptId).toBe(receipt.id);
    expect(result.hits[0].tags).toEqual(expect.arrayContaining(['digest']));
  });

  it('a digest never authorizes anything — advisoryOnly/grantsAuthority pinned on every returned shape', () => {
    const { text, tags } = buildStateDigest(fixtureInput());
    const { atom, receipt, state } = ingestMemory(createEmptyBrain(), { kind: 'receipt', text, source: 'workbench_live_apply', tags });
    expect(atom.advisoryOnly).toBe(true);
    expect(atom.grantsAuthority).toBe(false);
    expect(receipt.advisoryOnly).toBe(true);
    expect(receipt.grantsAuthority).toBe(false);
    expect(state.advisoryOnly).toBe(true);
    expect(state.grantsAuthority).toBe(false);
  });
});
