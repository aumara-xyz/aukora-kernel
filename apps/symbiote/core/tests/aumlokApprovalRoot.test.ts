import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  createLocalAumlokRoot,
  signPatchApprovalWithAumlokRoot,
  verifyAumlokApprovalBinding,
  sanitizeAumlokBindingForArtifact,
  AumlokApprovalRoot,
  AumlokApprovalSignature,
  AumlokApprovalBinding,
} from '../src/aumlokApprovalRoot';
import { PatchApprovalRecord } from '../src/patchApproval';

const STUB_APPROVAL: PatchApprovalRecord = {
  approvalId: 'approval_test1234abcd',
  draftId: 'draft_test1234abcd',
  proposalId: 'prop_abc123def456',
  candidateId: 'cand_xyz789',
  approvalState: 'approved',
  approvedBy: 'kernel_test',
  approvedScope: {
    targetFiles: ['src/resonator.ts'],
    allowedOperations: ['apply_candidate_diff'],
    requiredTests: ['tests/resonator.test.ts'],
    maxFilesChanged: 1,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  },
  draftHash: 'a'.repeat(64),
  proposalHash: 'b'.repeat(64),
  approvalHash: 'c'.repeat(64),
  createdAt: new Date().toISOString(),
  advisoryOnly: true,
  grantsAuthority: false,
};

function makeBinding(overrides?: Partial<{
  root: Partial<AumlokApprovalRoot>;
  signature: Partial<AumlokApprovalSignature>;
  binding: Partial<AumlokApprovalBinding>;
}>): AumlokApprovalBinding {
  const root = createLocalAumlokRoot();
  const signature = signPatchApprovalWithAumlokRoot(STUB_APPROVAL, root);
  return {
    approval: STUB_APPROVAL,
    root: { ...root, ...overrides?.root },
    signature: { ...signature, ...overrides?.signature },
    verified: false,
    advisoryOnly: true,
    grantsAuthority: false,
    ...overrides?.binding,
  } as AumlokApprovalBinding;
}

describe('AUMLOK Approval Root — createLocalAumlokRoot', () => {
  it('creates a root with correct shape', () => {
    const root = createLocalAumlokRoot();
    expect(root.rootId).toMatch(/^aumlok_root_/);
    expect(root.publicFingerprint).toHaveLength(16);
    expect(root.mode).toBe('local_stub');
    expect(root.advisoryOnly).toBe(true);
    expect(root.grantsAuthority).toBe(false);
  });

  it('is deterministic — same rootId each call', () => {
    const a = createLocalAumlokRoot();
    const b = createLocalAumlokRoot();
    expect(a.rootId).toBe(b.rootId);
    expect(a.publicFingerprint).toBe(b.publicFingerprint);
  });

  it('rootId does not contain raw key material', () => {
    const root = createLocalAumlokRoot();
    expect(root.rootId).not.toMatch(/\b[a-fA-F0-9]{64}\b/);
  });
});

describe('AUMLOK Approval Root — signPatchApprovalWithAumlokRoot', () => {
  it('produces a signature with correct shape', () => {
    const root = createLocalAumlokRoot();
    const sig = signPatchApprovalWithAumlokRoot(STUB_APPROVAL, root);
    expect(sig.approvalId).toBe(STUB_APPROVAL.approvalId);
    expect(sig.draftId).toBe(STUB_APPROVAL.draftId);
    expect(sig.proposalId).toBe(STUB_APPROVAL.proposalId);
    expect(sig.rootId).toBe(root.rootId);
    expect(sig.approvalHash).toBe(STUB_APPROVAL.approvalHash);
    expect(sig.signatureHash).toHaveLength(64);
    expect(sig.mode).toBe('local_stub');
    expect(sig.advisoryOnly).toBe(true);
    expect(sig.grantsAuthority).toBe(false);
  });

  it('is deterministic for same inputs', () => {
    const root = createLocalAumlokRoot();
    const a = signPatchApprovalWithAumlokRoot(STUB_APPROVAL, root);
    const b = signPatchApprovalWithAumlokRoot(STUB_APPROVAL, root);
    expect(a.signatureHash).toBe(b.signatureHash);
  });

  it('changes when approval changes', () => {
    const root = createLocalAumlokRoot();
    const a = signPatchApprovalWithAumlokRoot(STUB_APPROVAL, root);
    const modified = { ...STUB_APPROVAL, approvalId: 'approval_different' };
    const b = signPatchApprovalWithAumlokRoot(modified, root);
    expect(a.signatureHash).not.toBe(b.signatureHash);
  });
});

describe('AUMLOK Approval Root — verifyAumlokApprovalBinding', () => {
  it('passes for a valid binding', () => {
    const binding = makeBinding();
    const result = verifyAumlokApprovalBinding(binding);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('fails if binding.grantsAuthority is true', () => {
    const binding = makeBinding({ binding: { grantsAuthority: true as any } });
    const result = verifyAumlokApprovalBinding(binding);
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('binding.grantsAuthority must be false');
  });

  it('fails if binding.advisoryOnly is false', () => {
    const binding = makeBinding({ binding: { advisoryOnly: false as any } });
    const result = verifyAumlokApprovalBinding(binding);
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('binding.advisoryOnly must be true');
  });

  it('fails if root.mode is not local_stub', () => {
    const binding = makeBinding({ root: { mode: 'production' as any } });
    const result = verifyAumlokApprovalBinding(binding);
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('root.mode must be local_stub');
  });

  it('fails if signature.rootId does not match root.rootId', () => {
    const binding = makeBinding({ signature: { rootId: 'aumlok_root_wrong' } });
    const result = verifyAumlokApprovalBinding(binding);
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('signature.rootId does not match root.rootId');
  });

  it('fails if signature.approvalId does not match approval.approvalId', () => {
    const binding = makeBinding({ signature: { approvalId: 'approval_wrong' } });
    const result = verifyAumlokApprovalBinding(binding);
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('signature.approvalId does not match approval.approvalId');
  });

  it('fails if signatureHash recomputation mismatches (tamper detection)', () => {
    const binding = makeBinding({ signature: { signatureHash: 'f'.repeat(64) } });
    const result = verifyAumlokApprovalBinding(binding);
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.includes('signatureHash recomputation failed'))).toBe(true);
  });

  it('fails if PoP field is present', () => {
    const binding = makeBinding();
    (binding as any).pop = 'injected';
    const result = verifyAumlokApprovalBinding(binding);
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('PoP field present');
  });

  it('fails if signedHead field is present', () => {
    const binding = makeBinding();
    (binding as any).signedHead = 'injected';
    const result = verifyAumlokApprovalBinding(binding);
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('signedHead field present');
  });

  it('fails if root.grantsAuthority is not false', () => {
    const binding = makeBinding({ root: { grantsAuthority: true as any } });
    const result = verifyAumlokApprovalBinding(binding);
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('root.grantsAuthority must be false');
  });

  it('fails if signature.grantsAuthority is not false', () => {
    const binding = makeBinding({ signature: { grantsAuthority: true as any } });
    const result = verifyAumlokApprovalBinding(binding);
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('signature.grantsAuthority must be false');
  });
});

describe('AUMLOK Approval Root — sanitizeAumlokBindingForArtifact', () => {
  it('returns the correct subset', () => {
    const binding = makeBinding();
    binding.verified = true;
    const sanitized = sanitizeAumlokBindingForArtifact(binding);
    expect(sanitized.rootId).toBe(binding.root.rootId);
    expect(sanitized.publicFingerprint).toBe(binding.root.publicFingerprint);
    expect(sanitized.approvalId).toBe(binding.signature.approvalId);
    expect(sanitized.signatureHash).toBe(binding.signature.signatureHash.slice(0, 16));
    expect(sanitized.verified).toBe(true);
    expect(sanitized.mode).toBe('local_stub');
    expect(sanitized.advisoryOnly).toBe(true);
    expect(sanitized.grantsAuthority).toBe(false);
  });

  it('does not leak approval hashes or draft details', () => {
    const binding = makeBinding();
    const sanitized = sanitizeAumlokBindingForArtifact(binding);
    const json = JSON.stringify(sanitized);
    expect(json).not.toContain('draftHash');
    expect(json).not.toContain('proposalHash');
    expect(json).not.toContain('approvedBy');
    expect(json).not.toContain('approvedScope');
  });

  it('always has grantsAuthority: false', () => {
    const binding = makeBinding();
    const sanitized = sanitizeAumlokBindingForArtifact(binding);
    expect(sanitized.grantsAuthority).toBe(false);
  });
});

describe('AUMLOK Approval Root — forbidden imports', () => {
  it('source does not import gate, executor, or organism crypto', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../src/aumlokApprovalRoot.ts'), 'utf-8');
    const lines = src.split('\n').filter(line => !line.trim().startsWith('/\\b'));
    const filtered = lines.join('\n');
    const forbidden = [
      'evaluateIntent',
      'executeDecision',
      'signPoP',
      'verifyPoP',
      'EDGE_NODE_SEED',
      'child_process',
      'hypothesisMemory',
      'HypothesisMemory',
      'NonceLedger',
      'PrincipalRegistry',
    ];
    for (const term of forbidden) {
      expect(filtered).not.toContain(term);
    }
  });

  it('source only imports crypto and patchApproval', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../src/aumlokApprovalRoot.ts'), 'utf-8');
    const importLines = src.split('\n').filter(line => line.startsWith('import '));
    expect(importLines).toHaveLength(2);
    expect(importLines[0]).toContain("'crypto'");
    expect(importLines[1]).toContain("'./patchApproval'");
  });

  it('source does not contain legacy app literal', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../src/aumlokApprovalRoot.ts'), 'utf-8');
    const legacyLiteral = ['AUMA', 'ONE', 'APP'].join('-');
    expect(src).not.toContain(legacyLiteral);
  });
});

describe('AUMLOK Approval Root — cross-invariants', () => {
  it('grantsAuthority is false at every level of a valid binding', () => {
    const binding = makeBinding();
    expect(binding.grantsAuthority).toBe(false);
    expect(binding.root.grantsAuthority).toBe(false);
    expect(binding.signature.grantsAuthority).toBe(false);
    expect(binding.approval.grantsAuthority).toBe(false);
  });

  it('advisoryOnly is true at every level of a valid binding', () => {
    const binding = makeBinding();
    expect(binding.advisoryOnly).toBe(true);
    expect(binding.root.advisoryOnly).toBe(true);
    expect(binding.signature.advisoryOnly).toBe(true);
    expect(binding.approval.advisoryOnly).toBe(true);
  });

  it('mode is local_stub at every level', () => {
    const binding = makeBinding();
    expect(binding.root.mode).toBe('local_stub');
    expect(binding.signature.mode).toBe('local_stub');
  });
});
