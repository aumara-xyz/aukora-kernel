import { describe, it, expect } from 'vitest';
import {
  buildRecursiveIdeRehearsalReceipt, validateRecursiveIdeRehearsalReceipt,
  rehearsalReceiptGrantsAuthority, type RecursiveIdeRehearsalReceiptV1,
} from '../src/recursiveIdeRehearsalReceipt';

const NOW = '2026-07-01T00:00:00.000Z';

function freshReceipt(): RecursiveIdeRehearsalReceiptV1 {
  return buildRecursiveIdeRehearsalReceipt({
    task: 'demo task',
    toolCallsUsed: ['status', 'propose_patch', 'sandbox_apply'],
    targetFiles: ['docs/DEMO.md'],
    proposalHash: 'p'.repeat(64),
    sandboxPath: '/tmp/aukora-apply-abc123',
    testResult: { passed: true, ran: ['sandbox-content:docs/DEMO.md'], detail: 'ok' },
    now: NOW,
  });
}

describe('recursive-ide-rehearsal-receipt-v1: builder', () => {
  it('builds a receipt with the literal safety fields pinned', () => {
    const r = freshReceipt();
    expect(r.schema).toBe('recursive-ide-rehearsal-receipt-v1');
    expect(r.appliedLive).toBe(false);
    expect(r.promotionReady).toBe(false);
    expect(r.advisoryOnly).toBe(true);
    expect(r.grantsAuthority).toBe(false);
    expect(r.sandboxProof.tmpRootProven).toBe(true);
  });

  it('NEVER stores the raw sandbox path — only its sha256 hash', () => {
    const r = freshReceipt();
    const json = JSON.stringify(r);
    expect(json).not.toContain('/tmp/aukora-apply-abc123');
    expect(r.sandboxProof.sandboxPathHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is valid per its own validator', () => {
    expect(validateRecursiveIdeRehearsalReceipt(freshReceipt())).toEqual({ valid: true });
  });

  it('rehearsalReceiptGrantsAuthority is always false', () => {
    expect(rehearsalReceiptGrantsAuthority(freshReceipt())).toBe(false);
  });
});

describe('recursive-ide-rehearsal-receipt-v1: validator fails closed', () => {
  it('rejects a non-object / wrong schema', () => {
    expect(validateRecursiveIdeRehearsalReceipt(null).valid).toBe(false);
    expect(validateRecursiveIdeRehearsalReceipt({ ...freshReceipt(), schema: 'v0' as any }).valid).toBe(false);
  });

  it('rejects an unknown top-level field', () => {
    const r: any = { ...freshReceipt(), extra: 'nope' };
    expect(validateRecursiveIdeRehearsalReceipt(r).valid).toBe(false);
  });

  it('rejects an unknown nested field in sandboxProof / testResult', () => {
    const r1: any = freshReceipt(); r1.sandboxProof = { ...r1.sandboxProof, extra: 1 };
    expect(validateRecursiveIdeRehearsalReceipt(r1).valid).toBe(false);
    const r2: any = freshReceipt(); r2.testResult = { ...r2.testResult, extra: 1 };
    expect(validateRecursiveIdeRehearsalReceipt(r2).valid).toBe(false);
  });

  it('rejects appliedLive/promotionReady/advisoryOnly/grantsAuthority tampering', () => {
    expect(validateRecursiveIdeRehearsalReceipt({ ...freshReceipt(), appliedLive: true as any }).valid).toBe(false);
    expect(validateRecursiveIdeRehearsalReceipt({ ...freshReceipt(), promotionReady: true as any }).valid).toBe(false);
    expect(validateRecursiveIdeRehearsalReceipt({ ...freshReceipt(), advisoryOnly: false as any }).valid).toBe(false);
    expect(validateRecursiveIdeRehearsalReceipt({ ...freshReceipt(), grantsAuthority: true as any }).valid).toBe(false);
  });

  it('rejects a malformed sandboxPathHash (not sha256 hex)', () => {
    const r: any = freshReceipt();
    r.sandboxProof = { ...r.sandboxProof, sandboxPathHash: 'not-a-hash' };
    expect(validateRecursiveIdeRehearsalReceipt(r).valid).toBe(false);
  });

  it('rejects tmpRootProven !== true', () => {
    const r: any = freshReceipt();
    r.sandboxProof = { ...r.sandboxProof, tmpRootProven: false };
    expect(validateRecursiveIdeRehearsalReceipt(r).valid).toBe(false);
  });

  it('detects a tampered receiptHash (integrity mismatch)', () => {
    const r = { ...freshReceipt(), task: 'a different task now' };
    const v = validateRecursiveIdeRehearsalReceipt(r);
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/tampered/);
  });

  it('rejects a forbidden secret-shaped key anywhere in the receipt', () => {
    const r: any = { ...freshReceipt(), privateKey: 'x' };
    expect(validateRecursiveIdeRehearsalReceipt(r).valid).toBe(false);
  });
});
