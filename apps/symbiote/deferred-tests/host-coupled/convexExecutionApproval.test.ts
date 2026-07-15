import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  parseCanonicalExecutionApproval,
  denyReasonForLiveAction,
  BACKEND_START_ENV,
  RECEIPT_MUTATION_ENV,
} from '../src/convexExecutionApproval';

describe('24Y.10.1: parseCanonicalExecutionApproval — fail-closed latch', () => {
  it('no env → both denied, no violations', () => {
    const a = parseCanonicalExecutionApproval({});
    expect(a.backendStartApproved).toBe(false);
    expect(a.receiptMutationApproved).toBe(false);
    expect(a.violations).toEqual([]);
  });

  it('vague values are rejected (true/1/ok/approved/YES/y)', () => {
    for (const v of ['true', '1', 'ok', 'approved', 'YES', 'Yes', 'y', '', ' yes', 'yes ']) {
      const a = parseCanonicalExecutionApproval({ [BACKEND_START_ENV]: v });
      expect(a.backendStartApproved).toBe(false);
      expect(a.violations.length).toBeGreaterThan(0);
    }
  });

  it('backend approval ONLY → backend allowed, receipt denied (A never implies B)', () => {
    const a = parseCanonicalExecutionApproval({ [BACKEND_START_ENV]: 'yes' });
    expect(a.backendStartApproved).toBe(true);
    expect(a.receiptMutationApproved).toBe(false);
    expect(a.violations).toEqual([]); // receipt simply absent, not a violation
  });

  it('receipt approval ONLY (backend absent) → receipt DENIED + violation (B requires A)', () => {
    const a = parseCanonicalExecutionApproval({ [RECEIPT_MUTATION_ENV]: 'yes' });
    expect(a.backendStartApproved).toBe(false);
    expect(a.receiptMutationApproved).toBe(false);
    expect(a.violations.some((v) => v.includes('requires an approved+running backend'))).toBe(true);
  });

  it('BOTH exact approvals → both allowed', () => {
    const a = parseCanonicalExecutionApproval({ [BACKEND_START_ENV]: 'yes', [RECEIPT_MUTATION_ENV]: 'yes' });
    expect(a.backendStartApproved).toBe(true);
    expect(a.receiptMutationApproved).toBe(true);
    expect(a.violations).toEqual([]);
  });

  it('backend exact + receipt vague → backend allowed, receipt denied + violation', () => {
    const a = parseCanonicalExecutionApproval({ [BACKEND_START_ENV]: 'yes', [RECEIPT_MUTATION_ENV]: 'true' });
    expect(a.backendStartApproved).toBe(true);
    expect(a.receiptMutationApproved).toBe(false);
    expect(a.violations.some((v) => v.includes(RECEIPT_MUTATION_ENV))).toBe(true);
  });

  it('default-on is impossible: the literal "yes" string must be present', () => {
    // sanity: nothing other than exact "yes" flips the latch
    expect(parseCanonicalExecutionApproval({ [BACKEND_START_ENV]: 'yes\n' }).backendStartApproved).toBe(false);
    expect(parseCanonicalExecutionApproval({ [BACKEND_START_ENV]: 'YES' }).backendStartApproved).toBe(false);
    expect(parseCanonicalExecutionApproval({ [BACKEND_START_ENV]: 'yes' }).backendStartApproved).toBe(true);
  });
});

describe('24Y.10.1: denyReasonForLiveAction', () => {
  it('denies backend start without approval', () => {
    expect(denyReasonForLiveAction('backend_start', parseCanonicalExecutionApproval({}))).toBe('backend execution not approved');
  });
  it('denies receipt mutation without approval', () => {
    expect(denyReasonForLiveAction('receipt_mutation', parseCanonicalExecutionApproval({ [BACKEND_START_ENV]: 'yes' }))).toBe('receipt mutation not approved');
  });
  it('permits backend start when approved (null reason)', () => {
    expect(denyReasonForLiveAction('backend_start', parseCanonicalExecutionApproval({ [BACKEND_START_ENV]: 'yes' }))).toBeNull();
  });
  it('permits receipt mutation only when both approved', () => {
    const both = parseCanonicalExecutionApproval({ [BACKEND_START_ENV]: 'yes', [RECEIPT_MUTATION_ENV]: 'yes' });
    expect(denyReasonForLiveAction('receipt_mutation', both)).toBeNull();
  });
});

describe('24Y.10.1: module source safety', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'convexExecutionApproval.ts'), 'utf-8');

  it('never logs / never prints env values', () => {
    expect(src).not.toMatch(/console\.(log|error|warn)/);
  });
  it('pure — no Convex/network/fs/exec side effects', () => {
    expect(src).not.toMatch(/fetch\s*\(/);
    expect(src).not.toContain('child_process');
    expect(src).not.toContain('ctx.db');
    expect(src).not.toMatch(/\bfs\./);
  });
  it('defaults are false (no accidental default-on)', () => {
    expect(src).toContain('approved: false');
  });

  it('smoke runner wires the latch and never persists approvals to artifacts', () => {
    const smoke = fs.readFileSync(path.join(__dirname, '..', 'evidence', 'check-convex-loopback-readonly.ts'), 'utf-8');
    expect(smoke).toContain('parseCanonicalExecutionApproval');
    expect(smoke).toContain('denyReasonForLiveAction');
    expect(smoke).toContain("denyReasonForLiveAction('backend_start'");
    expect(smoke).toContain("denyReasonForLiveAction('receipt_mutation'");
    // reports the latch as a boolean, never the env value; never written to the high-water file/artifact
    expect(smoke).toContain('backendStartApproved: ${execApproval.backendStartApproved}');
    expect(smoke).not.toMatch(/saveHighWater[\s\S]{0,200}backendStartApproved/);
  });

  it('latch deny strings live in the module (returned by denyReasonForLiveAction)', () => {
    const mod = fs.readFileSync(path.join(__dirname, '..', 'src', 'convexExecutionApproval.ts'), 'utf-8');
    expect(mod).toContain('backend execution not approved');
    expect(mod).toContain('receipt mutation not approved');
  });

  it('smoke NEVER prints the raw approval env VALUES (only booleans) — closes 24Y.10 Opus note', () => {
    const smoke = fs.readFileSync(path.join(__dirname, '..', 'evidence', 'check-convex-loopback-readonly.ts'), 'utf-8');
    // no console call interpolates the raw env value for either approval var
    expect(smoke).not.toMatch(/console\.(log|error)\([^)]*process\.env\.AUKORA_EXECUTE_CANONICAL_BACKEND/);
    expect(smoke).not.toMatch(/console\.(log|error)\([^)]*process\.env\.AUKORA_APPROVE_CANONICAL_SMOKE_RECEIPT/);
    expect(smoke).not.toMatch(/console\.(log|error)\([^)]*env\[BACKEND_START_ENV\]/);
    // approval state never written into the persisted high-water entry or the artifact
    expect(smoke).not.toMatch(/saveHighWater[\s\S]{0,300}(backendStartApproved|receiptMutationApproved|execApproval)/);
  });
});
