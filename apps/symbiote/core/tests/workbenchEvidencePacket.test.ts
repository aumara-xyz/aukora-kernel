import { describe, it, expect } from 'vitest';
import {
  buildEvidencePacketFromRunReport,
  buildDraftEvidencePacket,
  formatEvidencePacketForChat,
  redactField,
  findFalseLandedClaims,
  FALSE_LANDED_PATTERNS,
  type EvidencePacketV1,
} from '../src/workbenchEvidencePacket';
import { buildRunReport, stageReport } from '../src/workbenchRunReport';

// A successful chain: agent → sandbox_apply → content_check → typecheck → fusion_review → write_receipt, all ok.
function successReport(overrides?: { fusionDetail?: string; goal?: string; artifactPath?: string; receiptPath?: string }) {
  return buildRunReport({
    goal: overrides?.goal ?? 'add a one-line clarifying comment',
    stages: [
      stageReport('agent', true, 'proposed 1 file'),
      stageReport('sandbox_apply', true, 'temp copy'),
      stageReport('content_check', true, 'match'),
      stageReport('typecheck', true, 'tsc exit 0'),
      stageReport('fusion_review', true, overrides?.fusionDetail ?? 'verdict: GREEN'),
      stageReport('write_receipt', true, 'receipt persisted'),
    ],
    proposalHash: 'a'.repeat(64),
    model: 'anthropic/claude-fable-5',
    receiptPath: overrides?.receiptPath ?? '/home/u/.aukora-symbiote/aumlok/receipts/proposal.json',
    artifactPath: overrides?.artifactPath ?? '/home/u/.aukora-symbiote/aumlok/pending-proposals/proposal.json',
    signCommand: 'bash scripts/aumlok-authority.sh sign <path>',
  });
}

// A chain that stopped at typecheck (a real integrity failure — chain does not reach receipt).
function failedReport() {
  return buildRunReport({
    goal: 'break the build',
    stages: [
      stageReport('agent', true, 'proposed 1 file'),
      stageReport('sandbox_apply', true, 'temp copy'),
      stageReport('content_check', true, 'match'),
      stageReport('typecheck', false, 'tsc exit 2 — 3 errors'),
    ],
    proposalHash: 'b'.repeat(64),
    model: 'anthropic/claude-fable-5',
    receiptPath: null,
    artifactPath: '/home/u/.aukora-symbiote/aumlok/pending-proposals/p.json',
  });
}

describe('#51 evidence packet — successful run', () => {
  const packet = buildEvidencePacketFromRunReport(successReport(), { intentId: 'c'.repeat(64) });

  it('is advisoryOnly / not-authority / not-live — literal-pinned', () => {
    expect(packet.schema).toBe('workbench-evidence-packet-v1');
    expect(packet.appliedLive).toBe(false);
    expect(packet.advisoryOnly).toBe(true);
    expect(packet.grantsAuthority).toBe(false);
  });

  it('reports each phase honestly and carries the terminal state + ids', () => {
    expect(packet.kind).toBe('proposal-run');
    expect(packet.draftStatus).toBe('from_intent');
    expect(packet.proposalStatus).toBe('ok');
    expect(packet.testStatus).toBe('ok');
    expect(packet.fusionStatus).toBe('GREEN');
    expect(packet.receiptStatus).toBe('ok');
    expect(packet.terminalState).toBe('AWAITING_OWNER_SIGNATURE');
    expect(packet.intentId).toBeTruthy();       // present (hex-collapsed form asserted below)
    expect(packet.proposalId).toBeTruthy();
  });

  it('the chat summary tells the owner to sign — and NEVER claims a landing', () => {
    const text = formatEvidencePacketForChat(packet);
    expect(text).toContain('appliedLive: false');
    expect(text).toContain('AWAITING_OWNER_SIGNATURE');
    expect(text).toMatch(/sign it in your own terminal|Next step is the owner/);
    expect(findFalseLandedClaims(text)).toEqual([]);
  });

  it('hex-collapses the sha in ids/paths so no full hash rides into chat', () => {
    // 64-char hashes are collapsed to a 16-char prefix + ellipsis by the shared chokepoint.
    expect(packet.proposalId).not.toMatch(/[0-9a-f]{40,}/);
    expect(packet.summary).not.toMatch(/[0-9a-f]{40,}/);
  });
});

describe('#51 evidence packet — failed run', () => {
  const packet = buildEvidencePacketFromRunReport(failedReport());

  it('marks the failing phase and produces NO false success / landed language', () => {
    expect(packet.terminalState).toBe('FAILED_AT: typecheck');
    expect(packet.testStatus).toBe('failed');
    expect(packet.receiptStatus).toBe('not_reached');
    expect(packet.receiptPath).toBeNull();
    expect(findFalseLandedClaims(packet.summary)).toEqual([]);
    expect(packet.summary).toContain('appliedLive: false');
    expect(packet.draftStatus).toBe('ad_hoc'); // no intent id supplied
  });
});

describe('#51 evidence packet — draft-only (intent authored, nothing run)', () => {
  const packet = buildDraftEvidencePacket({ intentId: 'd'.repeat(64), goal: 'tidy a comment' });

  it('is clearly DRAFT_ONLY, not live, not applied, no proposal/test/receipt', () => {
    expect(packet.kind).toBe('draft-intent');
    expect(packet.draftStatus).toBe('authored');
    expect(packet.terminalState).toBe('DRAFT_ONLY');
    expect(packet.proposalStatus).toBe('not_reached');
    expect(packet.testStatus).toBe('not_reached');
    expect(packet.fusionStatus).toBe('not_run');
    expect(packet.receiptStatus).toBe('not_reached');
    expect(packet.appliedLive).toBe(false);
    expect(packet.summary).toContain('DRAFT ONLY');
    expect(findFalseLandedClaims(packet.summary)).toEqual([]);
  });
});

describe('#51 evidence packet — secret / authority redaction', () => {
  it('refuses a secret-shaped goal (OpenRouter key) — placeholder, recorded in redactions', () => {
    const report = successReport({ goal: 'leak sk-or-abcdef0123456789ABCDEF into chat' });
    const packet = buildEvidencePacketFromRunReport(report);
    expect(packet.goal).toContain('[redacted:');
    expect(packet.goal).not.toContain('sk-or-');
    expect(packet.redactions.some((r) => r.startsWith('goal:'))).toBe(true);
    expect(packet.summary).not.toContain('sk-or-');
  });

  it('refuses an authority-leak in a fusion verdict detail ("you may apply")', () => {
    const report = successReport({ fusionDetail: 'GREEN — you may apply this now' });
    const packet = buildEvidencePacketFromRunReport(report);
    // fusionStatus is still parsed as GREEN (structured), but the raw detail never reaches the packet;
    // the authority phrase is not present anywhere in the summary.
    expect(packet.fusionStatus).toBe('GREEN');
    expect(packet.summary).not.toMatch(/you may apply/i);
  });

  it('redactField collapses hex then refuses residual secrets, and leaves clean text intact', () => {
    const red: string[] = [];
    expect(redactField('x', 'just a normal goal', red)).toBe('just a normal goal');
    expect(red).toEqual([]);
    expect(redactField('key', 'Bearer abcdefghijklmnopqrstuvwxyz012345', red)).toContain('[redacted:');
    expect(red.length).toBe(1);
    expect(redactField('nil', null, red)).toBeNull();
  });
});

describe('#51 evidence packet — no-false-landed contract', () => {
  it('FALSE_LANDED_PATTERNS catch affirmative claims but NOT honest negations', () => {
    expect(findFalseLandedClaims('the change has been applied')).not.toEqual([]);
    expect(findFalseLandedClaims('it is now live')).not.toEqual([]);
    expect(findFalseLandedClaims('successfully deployed to main')).not.toEqual([]);
    // honest negations that legitimately appear in our summaries must be clean:
    expect(findFalseLandedClaims('nothing was applied to the live repo')).toEqual([]);
    expect(findFalseLandedClaims('this is a PROPOSAL — nothing applied')).toEqual([]);
    expect(FALSE_LANDED_PATTERNS.length).toBeGreaterThan(0);
  });

  it('every builder path yields a summary with zero affirmative landed claims', () => {
    const packets: EvidencePacketV1[] = [
      buildEvidencePacketFromRunReport(successReport()),
      buildEvidencePacketFromRunReport(failedReport()),
      buildDraftEvidencePacket({ intentId: 'e'.repeat(64), goal: 'g' }),
    ];
    for (const p of packets) expect(findFalseLandedClaims(p.summary)).toEqual([]);
  });
});

describe('#51 evidence packet — fusion verdict extraction', () => {
  it('extracts YELLOW/RED/NO_QUORUM and reports not_run when the stage is absent', () => {
    expect(buildEvidencePacketFromRunReport(successReport({ fusionDetail: 'verdict: YELLOW (1 caution)' })).fusionStatus).toBe('YELLOW');
    expect(buildEvidencePacketFromRunReport(successReport({ fusionDetail: 'RED — blocked opinion' })).fusionStatus).toBe('RED');
    expect(buildEvidencePacketFromRunReport(successReport({ fusionDetail: 'NO_QUORUM' })).fusionStatus).toBe('NO_QUORUM');
    expect(buildEvidencePacketFromRunReport(failedReport()).fusionStatus).toBe('not_run'); // stage never reached
  });
});

describe('#91 run-time shrink warning in the evidence packet', () => {
  const shrink = { relPath: 'docs/BIG.md', existsInRepo: true, beforeLines: 362, afterLines: 27, beforeBytes: 9000, afterBytes: 700, netLineDelta: -335, netByteDelta: -8300, shrinkWarning: true };
  const clean = { relPath: 'fusion/README.md', existsInRepo: true, beforeLines: 19, afterLines: 20, beforeBytes: 1100, afterBytes: 1150, netLineDelta: 1, netByteDelta: 50, shrinkWarning: false };

  it('a shrinking proposal surfaces ⚠ FILE-SHRINK in the packet + summary, at run time', () => {
    const p = buildEvidencePacketFromRunReport(successReport(), { fileShrinks: [shrink] });
    expect(p.anyShrinkWarning).toBe(true);
    expect(p.fileShrinkWarnings.map((f) => f.relPath)).toEqual(['docs/BIG.md']);
    expect(p.summary).toContain('FILE-SHRINK');
    expect(p.summary).toContain('362→27');
    expect(p.summary).toMatch(/Do NOT sign/);
    expect(findFalseLandedClaims(p.summary)).toEqual([]); // still never a false landed claim
  });

  it('a clean (non-shrinking) proposal leaves the packet unwarned', () => {
    const p = buildEvidencePacketFromRunReport(successReport(), { fileShrinks: [clean] });
    expect(p.anyShrinkWarning).toBe(false);
    expect(p.fileShrinkWarnings).toEqual([]);
    expect(p.summary).not.toContain('FILE-SHRINK');
  });

  it('only the SHRINKING files are kept (a mixed proposal lists just the offender)', () => {
    const p = buildEvidencePacketFromRunReport(successReport(), { fileShrinks: [clean, shrink] });
    expect(p.fileShrinkWarnings.map((f) => f.relPath)).toEqual(['docs/BIG.md']);
  });

  it('no fileShrinks passed → unwarned (back-compat with callers that do not compute it)', () => {
    const p = buildEvidencePacketFromRunReport(successReport());
    expect(p.anyShrinkWarning).toBe(false);
  });

  it('draft-only packets carry no shrink warnings', () => {
    const p = buildDraftEvidencePacket({ intentId: 'a'.repeat(64), goal: 'g' });
    expect(p.anyShrinkWarning).toBe(false);
    expect(p.fileShrinkWarnings).toEqual([]);
  });
});

// ── Brick 3.1 (the seamless loop): structured first-failure evidence ────────────────────────────
// The wish: "the difference between 'it failed' and 'I know exactly what to change'". These pin
// that the packet names the failure precisely, stays bounded, redacts like every other field, and
// NEVER invents evidence for a green chain.
import { extractFailureEvidence } from '../src/workbenchEvidencePacket';

describe('failure evidence with teeth (Brick 3.1)', () => {
  function reportFailedAtTypecheck(detail: string) {
    return buildRunReport({
      goal: 'tighten a helper',
      stages: [
        stageReport('agent', true, 'proposed 1 file'),
        stageReport('sandbox_apply', true, 'temp copy'),
        stageReport('content_check', true, 'match'),
        stageReport('typecheck', false, detail),
      ],
      proposalHash: 'c'.repeat(64),
      model: 'anthropic/claude-fable-5',
      receiptPath: null, artifactPath: null, toolCallsSummary: null, kiraCitations: null, signCommand: null,
    });
  }

  it('parses tsc paren-form: file, line, TS code + message, and counts the extra failures', () => {
    const detail = 'real typecheck FAILED — core/src/thing.ts(42,7): error TS2304: Cannot find name \'frob\'.\n'
      + 'core/src/thing.ts(50,1): error TS2551: Property x does not exist.\n2 errors.';
    const p = buildEvidencePacketFromRunReport(reportFailedAtTypecheck(detail));
    expect(p.failureEvidence).not.toBeNull();
    expect(p.failureEvidence!.stage).toBe('typecheck');
    expect(p.failureEvidence!.file).toBe('core/src/thing.ts');
    expect(p.failureEvidence!.line).toBe(42);
    expect(p.failureEvidence!.message).toContain('TS2304');
    expect(p.failureEvidence!.moreFailures).toBe(1);
    expect(p.summary).toContain('why it failed (typecheck)');
    expect(p.summary).toContain('core/src/thing.ts:42');
  });

  it('parses a vitest failure: FAIL header, assertion message, Expected/Received diff, stack frame', () => {
    const detail = [
      'real typecheck FAILED — FAIL  core/tests/frob.test.ts > frob > returns the seam',
      'AssertionError: expected values to be strictly equal',
      '- Expected',
      '+ Received',
      '',
      '- "seam"',
      '+ "seamless"',
      '',
      ' ❯ core/src/frob.ts:17:3',
    ].join('\n');
    const p = buildEvidencePacketFromRunReport(reportFailedAtTypecheck(detail));
    const f = p.failureEvidence!;
    expect(f.failingTest).toContain('core/tests/frob.test.ts > frob > returns the seam');
    expect(f.message).toContain('strictly equal');
    expect(f.expected).toBe('"seam"');
    expect(f.received).toBe('"seamless"');
    expect(f.file).toBe('core/src/frob.ts');
    expect(f.line).toBe(17);
    expect(p.summary).toContain('failing test:');
    expect(p.summary).toContain('assertion: expected "seam" · received "seamless"');
  });

  it('falls back to the inline "expected X to be Y" form when no diff block exists', () => {
    const ev = extractFailureEvidence('typecheck', 'AssertionError: expected 3 to be 4 // Object.is equality');
    expect(ev).not.toBeNull();
    expect(ev!.received).toBe('3');
    expect(ev!.expected).toBe('4');
  });

  it('a green chain carries NO failure evidence and no "why it failed" line — never fabricated', () => {
    const p = buildEvidencePacketFromRunReport(successReport());
    expect(p.failureEvidence).toBeNull();
    expect(p.summary).not.toContain('why it failed');
  });

  it('draft-only packets carry no failure evidence (nothing ran)', () => {
    const p = buildDraftEvidencePacket({ intentId: 'a'.repeat(64), goal: 'g' });
    expect(p.failureEvidence).toBeNull();
  });

  it('unparseable failure detail yields null evidence, not garbage', () => {
    expect(extractFailureEvidence('typecheck', 'exit 2')).toBeNull();
    expect(extractFailureEvidence('typecheck', '')).toBeNull();
    expect(extractFailureEvidence('typecheck', null)).toBeNull();
  });

  it('failure fields pass the SAME redaction chokepoint as everything else', () => {
    // a canonical secret shape (burnDataset SECRET_PATTERNS: sk- + 20 or more chars) — must be refused
    const detail = 'real typecheck FAILED — AssertionError: leaked sk-abcdefghijklmnop0123456789 in output';
    const p = buildEvidencePacketFromRunReport(reportFailedAtTypecheck(detail));
    const f = p.failureEvidence!;
    expect(f.message).not.toContain('sk-abcdefghijklmnop0123456789');
    expect(p.redactions.some((r) => r.startsWith('failure.message'))).toBe(true);
  });

  it('every evidence field is bounded (≤220 chars) no matter how long the log line is', () => {
    const long = 'AssertionError: ' + 'x'.repeat(5000);
    const ev = extractFailureEvidence('typecheck', long);
    expect(ev!.message!.length).toBeLessThanOrEqual(220);
  });
});

// Regression from the FIRST live rehearsal (2026-07-08): an agent-stage failure has no tsc/vitest
// shape — the packet must still say why, in the stage's own words, never show nothing.
describe('failure evidence fallback (first live rehearsal regression)', () => {
  it('an agent-stage failure quotes the stage detail as the message', () => {
    const report = buildRunReport({
      goal: 'brick 2.1',
      stages: [stageReport('agent', false, 'agent did not produce a proposal — stoppedReason=max_rounds_no_patch after 14 round(s)')],
      proposalHash: null, model: 'moonshotai/kimi-k2.7-code', receiptPath: null,
      artifactPath: null, toolCallsSummary: null, kiraCitations: null, signCommand: null,
    });
    const p = buildEvidencePacketFromRunReport(report);
    expect(p.failureEvidence).not.toBeNull();
    expect(p.failureEvidence!.stage).toBe('agent');
    expect(p.failureEvidence!.message).toContain('max_rounds_no_patch');
    expect(p.summary).toContain('why it failed (agent)');
  });

  it('a failed stage with EMPTY detail still yields null — never an invented message', () => {
    const report = buildRunReport({
      goal: 'g',
      stages: [stageReport('agent', false, '')],
      proposalHash: null, model: null, receiptPath: null,
      artifactPath: null, toolCallsSummary: null, kiraCitations: null, signCommand: null,
    });
    expect(buildEvidencePacketFromRunReport(report).failureEvidence).toBeNull();
  });
});
