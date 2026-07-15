// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Round-6 loop-continuity truth fix: the persisted rehearsal status is the signability signal every
// reader trusts (/api/loop, read_rehearsal_logs, the #245 disposition join). The old derivation checked
// the generic AWAITING_OWNER_SIGNATURE wording FIRST, so a transcript containing both the flow's
// boilerplate AND an explicit `FAILED_AT: <stage>` persisted as signature-ready — the live contradiction
// reproduced below. Explicit failure evidence must ALWAYS beat generic awaiting language.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { deriveRehearsalTerminalStatus, isSignableRehearsalStatus } from '../src/rehearsalStatus';

describe('deriveRehearsalTerminalStatus — explicit FAILED_AT beats generic awaiting language', () => {
  it('THE live contradiction: both texts present (awaiting wording first) → the FAILURE persists, never signable', () => {
    const all = [
      '[info] run: Add a derived recencyTier to each memory_peek hit — additive only.',
      '[info] agent → sandbox → gate; every rehearsal stops at AWAITING_OWNER_SIGNATURE — no apply.',
      '[info] evidence packet — governed workbench run',
      'terminal state: FAILED_AT: agent',
      'why it failed: agent did not produce a proposal — stoppedReason=model_error after 3 round(s)',
    ].join('\n');
    const status = deriveRehearsalTerminalStatus(all);
    expect(status).toBe('FAILED_AT: agent');
    expect(status).not.toBe('AWAITING_OWNER_SIGNATURE');
    expect(isSignableRehearsalStatus(status)).toBe(false);
  });

  it('same contradiction with FAILED_AT appearing BEFORE the awaiting wording — order in text never matters', () => {
    const all = 'FAILED_AT: sandbox\n…the flow otherwise stops at AWAITING_OWNER_SIGNATURE as usual…';
    expect(deriveRehearsalTerminalStatus(all)).toBe('FAILED_AT: sandbox');
  });

  it('a genuinely clean run still reads AWAITING_OWNER_SIGNATURE and is the ONLY signable status', () => {
    const status = deriveRehearsalTerminalStatus('proposal built…\nterminal state: AWAITING_OWNER_SIGNATURE\nproposalHash: ' + 'a'.repeat(64));
    expect(status).toBe('AWAITING_OWNER_SIGNATURE');
    expect(isSignableRehearsalStatus(status)).toBe(true);
  });

  it('neither marker → unknown, not signable', () => {
    const status = deriveRehearsalTerminalStatus('the workbench said something unrecognized');
    expect(status).toBe('unknown');
    expect(isSignableRehearsalStatus(status)).toBe(false);
  });

  it('FAILED_AT is case-insensitive and preserves the stage verbatim (legacy behavior kept)', () => {
    expect(deriveRehearsalTerminalStatus('failed_at typecheck')).toBe('FAILED_AT: typecheck');
    expect(deriveRehearsalTerminalStatus('Failed_At: fusion_review')).toBe('FAILED_AT: fusion_review');
  });

  it('errored is never signable (the runner catch-path status)', () => {
    expect(isSignableRehearsalStatus('errored')).toBe(false);
    expect(isSignableRehearsalStatus('FAILED_AT: agent')).toBe(false);
    expect(isSignableRehearsalStatus('unknown')).toBe(false);
  });
});

describe('structural pin — the runner PERSISTS through the fixed derivation, old awaiting-first ternary is gone', () => {
  const runnerSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'rehearsalQueueRunner.ts'), 'utf-8');

  it('the runner derives the persisted status via deriveRehearsalTerminalStatus', () => {
    expect(runnerSrc).toContain("from '../core/src/rehearsalStatus'");
    expect(runnerSrc).toContain('deriveRehearsalTerminalStatus(all)');
  });

  it('the old awaiting-first inline ternary no longer exists anywhere in the runner', () => {
    expect(runnerSrc).not.toMatch(/AWAITING_OWNER_SIGNATURE\/\.test\(all\)\s*\?\s*'AWAITING_OWNER_SIGNATURE'/);
  });
});
