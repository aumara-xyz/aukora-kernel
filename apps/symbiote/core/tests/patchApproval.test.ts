// MARKER: 24N Human Approval Gate
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  createPatchApproval,
  refusePatchDraft,
  validatePatchApproval,
  hashPatchApproval,
  sanitizeApprovalForArtifact,
  PatchApprovalRecord,
  ApprovalInput,
} from '../src/patchApproval';
import { PatchDraft } from '../src/wombPatchDraft';

function makeDraft(overrides?: Partial<PatchDraft>): PatchDraft {
  return {
    draftId: 'draft_test1234abcd',
    proposalId: 'prop_test1234abcd',
    candidateId: 'cand_abcd1234',
    targetFiles: ['src/resonator.ts'],
    riskLevel: 'LOW',
    authoritySurfaces: [],
    advisorySurfaces: ['src/resonator.ts'],
    intent: 'draft_only',
    summary: 'Draft for test coverage for resonator',
    proposedChanges: ['Create tests/resonator.test.ts'],
    requiredTests: ['tests/resonator.test.ts'],
    approvalRequired: true,
    advisoryOnly: true,
    createdAt: '2026-06-18T00:00:00Z',
    hashes: {
      proposalHash: 'a'.repeat(64),
      draftHash: 'b'.repeat(64),
      targetFilesHash: 'c'.repeat(64),
      contextHash: 'd'.repeat(64),
    },
    ...overrides,
  };
}

function makeApprovalInput(overrides?: Partial<ApprovalInput>): ApprovalInput {
  return {
    draft: makeDraft(),
    approvedBy: 'kernel_test',
    expiresInMs: 30 * 60 * 1000,
    ...overrides,
  };
}

describe('24N: Patch Approval Gate', () => {
  describe('determinism', () => {
    it('produces stable approval IDs across runs', () => {
      const input = makeApprovalInput();
      const a1 = createPatchApproval(input);
      const a2 = createPatchApproval(input);
      expect(a1.approvalId).toBe(a2.approvalId);
      expect(a1.approvalId).toMatch(/^approval_/);
    });

    it('produces stable approval hashes at same timestamp', () => {
      const input = makeApprovalInput();
      const frozen = new Date('2026-06-18T12:00:00Z');
      const RealDate = globalThis.Date;
      const FakeDate = function(this: any, ...args: any[]) {
        if (args.length === 0) return new RealDate(frozen);
        return new (RealDate as any)(...args);
      } as any;
      FakeDate.now = () => frozen.getTime();
      FakeDate.prototype = RealDate.prototype;
      globalThis.Date = FakeDate;
      try {
        const a1 = createPatchApproval(input);
        const a2 = createPatchApproval(input);
        expect(a1.approvalHash).toBe(a2.approvalHash);
      } finally {
        globalThis.Date = RealDate;
      }
    });

    it('hashPatchApproval is deterministic', () => {
      const approval = createPatchApproval(makeApprovalInput());
      const h1 = hashPatchApproval(approval);
      const h2 = hashPatchApproval(approval);
      expect(h1).toBe(h2);
    });

    it('approval IDs differ for different drafts', () => {
      const a1 = createPatchApproval(makeApprovalInput());
      const a2 = createPatchApproval(makeApprovalInput({
        draft: makeDraft({ draftId: 'draft_different' }),
      }));
      expect(a1.approvalId).not.toBe(a2.approvalId);
    });
  });

  describe('binding', () => {
    it('binds to exact draftId', () => {
      const approval = createPatchApproval(makeApprovalInput());
      expect(approval.draftId).toBe('draft_test1234abcd');
    });

    it('binds to exact draftHash', () => {
      const draft = makeDraft();
      const approval = createPatchApproval(makeApprovalInput({ draft }));
      expect(approval.draftHash).toBe(draft.hashes.draftHash);
    });

    it('binds to exact proposalId', () => {
      const approval = createPatchApproval(makeApprovalInput());
      expect(approval.proposalId).toBe('prop_test1234abcd');
    });

    it('approval for draft A fails validation against draft B', () => {
      const draftA = makeDraft({ draftId: 'draft_aaaaaaaaaaaa' });
      const draftB = makeDraft({ draftId: 'draft_bbbbbbbbbbbb' });
      const approval = createPatchApproval(makeApprovalInput({ draft: draftA }));
      const result = validatePatchApproval(approval, draftB);
      expect(result.valid).toBe(false);
      expect(result.violations).toContain('draftId mismatch');
    });

    it('approval fails validation when draftHash changes', () => {
      const draft = makeDraft();
      const approval = createPatchApproval(makeApprovalInput({ draft }));
      const alteredDraft = makeDraft({
        hashes: { ...draft.hashes, draftHash: 'e'.repeat(64) },
      });
      const result = validatePatchApproval(approval, alteredDraft);
      expect(result.valid).toBe(false);
      expect(result.violations).toContain('draftHash mismatch');
    });

    it('approval fails validation when proposalId changes', () => {
      const draft = makeDraft();
      const approval = createPatchApproval(makeApprovalInput({ draft }));
      const alteredDraft = makeDraft({ proposalId: 'prop_different' });
      const result = validatePatchApproval(approval, alteredDraft);
      expect(result.valid).toBe(false);
      expect(result.violations).toContain('proposalId mismatch');
    });
  });

  describe('scope', () => {
    it('target file widening is rejected', () => {
      const draft = makeDraft({ targetFiles: ['src/resonator.ts'] });
      const approval = createPatchApproval(makeApprovalInput({ draft }));
      const widenedDraft = makeDraft({
        targetFiles: ['src/resonator.ts', 'src/extra.ts'],
        hashes: draft.hashes,
      });
      const result = validatePatchApproval(approval, widenedDraft);
      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes('missing draft target'))).toBe(true);
    });

    it('scope cannot widen target files beyond draft', () => {
      const draft = makeDraft({ targetFiles: ['src/resonator.ts'] });
      const approval = createPatchApproval(makeApprovalInput({ draft }));
      (approval.approvedScope as any).targetFiles = ['src/resonator.ts', 'src/injected.ts'];
      const result = validatePatchApproval(approval, draft);
      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes('widens beyond draft'))).toBe(true);
    });

    it('required tests cannot be removed from scope', () => {
      const draft = makeDraft({ requiredTests: ['tests/resonator.test.ts', 'tests/extra.test.ts'] });
      const approval = createPatchApproval(makeApprovalInput({ draft }));
      (approval.approvedScope as any).requiredTests = ['tests/resonator.test.ts'];
      const result = validatePatchApproval(approval, draft);
      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes('missing draft test'))).toBe(true);
    });

    it('approved scope contains correct operations', () => {
      const approval = createPatchApproval(makeApprovalInput());
      expect(approval.approvedScope.allowedOperations).toEqual(['apply_candidate_diff']);
    });

    it('approved scope has valid expiry', () => {
      const before = Date.now();
      const approval = createPatchApproval(makeApprovalInput({ expiresInMs: 30 * 60 * 1000 }));
      const after = Date.now();
      expect(approval.approvalState).toBe('approved');
      const expiresAt = new Date(approval.approvedScope.expiresAt).getTime();
      expect(expiresAt).toBeGreaterThanOrEqual(before + 30 * 60 * 1000 - 1000);
      expect(expiresAt).toBeLessThanOrEqual(after + 30 * 60 * 1000 + 1000);
    });
  });

  describe('expiry', () => {
    it('expired approval is rejected', () => {
      const draft = makeDraft();
      const approval = createPatchApproval(makeApprovalInput({ draft }));
      (approval.approvedScope as any).expiresAt = '2020-01-01T00:00:00Z';
      const result = validatePatchApproval(approval, draft);
      expect(result.valid).toBe(false);
      expect(result.violations).toContain('approval has expired');
    });
  });

  describe('refusal', () => {
    it('refused record has correct state', () => {
      const draft = makeDraft();
      const refusal = refusePatchDraft({ draft, approvedBy: 'human_local', reason: 'not ready' });
      expect(refusal.approvalState).toBe('refused');
      expect(refusal.refusalReason).toBe('not ready');
      expect(refusal.advisoryOnly).toBe(true);
      expect(refusal.grantsAuthority).toBe(false);
    });

    it('refused record cannot validate as approval', () => {
      const draft = makeDraft();
      const refusal = refusePatchDraft({ draft, approvedBy: 'human_local', reason: 'not ready' });
      expect(refusal.approvalState).toBe('refused');
      expect(refusal.approvedScope.targetFiles).toEqual([]);
      expect(refusal.approvedScope.allowedOperations).toEqual([]);
      expect(refusal.approvedScope.maxFilesChanged).toBe(0);
    });

    it('refused record has valid approval ID', () => {
      const draft = makeDraft();
      const refusal = refusePatchDraft({ draft, approvedBy: 'human_local', reason: 'refused' });
      expect(refusal.approvalId).toMatch(/^approval_/);
    });

    it('refused approval validates with refusalReason present', () => {
      const draft = makeDraft();
      const refusal = refusePatchDraft({ draft, approvedBy: 'kernel_test', reason: 'refused for test' });
      const result = validatePatchApproval(refusal, draft);
      expect(result.valid).toBe(true);
    });

    it('refused approval without refusalReason fails validation', () => {
      const draft = makeDraft();
      const refusal = refusePatchDraft({ draft, approvedBy: 'kernel_test', reason: 'refused' });
      (refusal as any).refusalReason = undefined;
      const result = validatePatchApproval(refusal, draft);
      expect(result.valid).toBe(false);
      expect(result.violations).toContain('refused approval must have refusalReason');
    });
  });

  describe('HIGH-risk refusal', () => {
    it('HIGH-risk draft is automatically refused', () => {
      const draft = makeDraft({ riskLevel: 'HIGH' });
      const approval = createPatchApproval(makeApprovalInput({ draft }));
      expect(approval.approvalState).toBe('refused');
      expect(approval.refusalReason).toContain('HIGH-risk');
    });

    it('HIGH-risk draft fails validation even if manually forced to approved', () => {
      const draft = makeDraft({ riskLevel: 'HIGH' });
      const approval = createPatchApproval(makeApprovalInput({ draft }));
      (approval as any).approvalState = 'approved';
      const result = validatePatchApproval(approval, draft);
      expect(result.valid).toBe(false);
      expect(result.violations).toContain('HIGH-risk drafts cannot be approved');
    });
  });

  describe('legacy app exclusion', () => {
    it('refuses drafts targeting legacy app paths', () => {
      const LEGACY_APP = ['AUMA', 'ONE', 'APP'].join('-');
      const draft = makeDraft({ targetFiles: [`${LEGACY_APP}/src/thing.ts`] });
      const approval = createPatchApproval(makeApprovalInput({ draft }));
      expect(approval.approvalState).toBe('refused');
      expect(approval.refusalReason).toContain('legacy app');
    });
  });

  describe('authority boundary', () => {
    it('grantsAuthority is always false', () => {
      const approval = createPatchApproval(makeApprovalInput());
      expect(approval.grantsAuthority).toBe(false);
    });

    it('advisoryOnly is always true', () => {
      const approval = createPatchApproval(makeApprovalInput());
      expect(approval.advisoryOnly).toBe(true);
    });

    it('grantsAuthority=true is rejected by validation', () => {
      const draft = makeDraft();
      const approval = createPatchApproval(makeApprovalInput({ draft }));
      (approval as any).grantsAuthority = true;
      const result = validatePatchApproval(approval, draft);
      expect(result.valid).toBe(false);
      expect(result.violations).toContain('grantsAuthority must be false');
    });

    it('advisoryOnly=false is rejected by validation', () => {
      const draft = makeDraft();
      const approval = createPatchApproval(makeApprovalInput({ draft }));
      (approval as any).advisoryOnly = false;
      const result = validatePatchApproval(approval, draft);
      expect(result.valid).toBe(false);
      expect(result.violations).toContain('advisoryOnly must be true');
    });

    it('no PoP, signature, signedHead, or merkleRoot fields', () => {
      const approval = createPatchApproval(makeApprovalInput()) as any;
      expect(approval.pop).toBeUndefined();
      expect(approval.signature).toBeUndefined();
      expect(approval.signedHead).toBeUndefined();
      expect(approval.merkleRoot).toBeUndefined();
    });

    it('injected PoP field is rejected by validation', () => {
      const draft = makeDraft();
      const approval = createPatchApproval(makeApprovalInput({ draft }));
      (approval as any).pop = 'forged';
      const result = validatePatchApproval(approval, draft);
      expect(result.valid).toBe(false);
      expect(result.violations).toContain('PoP field present');
    });

    it('injected signature field is rejected by validation', () => {
      const draft = makeDraft();
      const approval = createPatchApproval(makeApprovalInput({ draft }));
      (approval as any).signature = 'forged';
      const result = validatePatchApproval(approval, draft);
      expect(result.valid).toBe(false);
      expect(result.violations).toContain('signature field present');
    });
  });

  describe('forbidden content', () => {
    it('scrubs signPoP from refusal reason', () => {
      const draft = makeDraft();
      const refusal = refusePatchDraft({ draft, approvedBy: 'kernel_test', reason: 'signPoP detected' });
      expect(refusal.refusalReason).not.toContain('signPoP');
      expect(refusal.refusalReason).toContain('[SCRUBBED]');
    });

    it('scrubs overrideGate from refusal reason', () => {
      const draft = makeDraft();
      const refusal = refusePatchDraft({ draft, approvedBy: 'kernel_test', reason: 'overrideGate attempt' });
      expect(refusal.refusalReason).not.toContain('overrideGate');
    });

    it('draft containing forbidden content is refused', () => {
      const draft = makeDraft({
        summary: 'evaluateIntent bypass found',
      });
      const approval = createPatchApproval(makeApprovalInput({ draft }));
      expect(approval.approvalState).toBe('refused');
      expect(approval.refusalReason).toContain('forbidden content');
    });

    it('draft containing API key pattern is refused', () => {
      const draft = makeDraft({
        summary: 'found sk-or-v1-abcdef1234567890abcdef in logs',
      });
      const approval = createPatchApproval(makeApprovalInput({ draft }));
      expect(approval.approvalState).toBe('refused');
    });

    it('draft containing PEM key is refused', () => {
      const draft = makeDraft({
        summary: '-----BEGIN PRIVATE KEY-----\nMIIEv...',
      });
      const approval = createPatchApproval(makeApprovalInput({ draft }));
      expect(approval.approvalState).toBe('refused');
    });
  });

  describe('sanitize', () => {
    it('sanitized output omits hashes and internal fields', () => {
      const approval = createPatchApproval(makeApprovalInput());
      const sanitized = sanitizeApprovalForArtifact(approval);
      expect(sanitized.advisoryOnly).toBe(true);
      expect(sanitized.grantsAuthority).toBe(false);
      expect((sanitized as any).draftHash).toBeUndefined();
      expect((sanitized as any).proposalHash).toBeUndefined();
      expect((sanitized as any).approvalHash).toBeUndefined();
      expect((sanitized as any).createdAt).toBeUndefined();
    });

    it('sanitized output preserves scope', () => {
      const approval = createPatchApproval(makeApprovalInput());
      const sanitized = sanitizeApprovalForArtifact(approval);
      expect(sanitized.approvedScope.targetFiles).toEqual(approval.approvedScope.targetFiles);
      expect(sanitized.approvedScope.allowedOperations).toEqual(approval.approvedScope.allowedOperations);
      expect(sanitized.approvedScope.requiredTests).toEqual(approval.approvedScope.requiredTests);
    });

    it('sanitized output scrubs forbidden content in refusalReason', () => {
      const draft = makeDraft();
      const refusal = refusePatchDraft({ draft, approvedBy: 'kernel_test', reason: 'clean reason' });
      const sanitized = sanitizeApprovalForArtifact(refusal);
      expect(sanitized.refusalReason).toBe('clean reason');
    });
  });

  describe('no target files modified', () => {
    it('approval creation does not modify any files', () => {
      const draft = makeDraft();
      const targets = draft.targetFiles.filter(f => {
        try {
          return fs.existsSync(path.resolve(__dirname, '..', f));
        } catch {
          return false;
        }
      });
      const beforeStats = targets.map(f => {
        const full = path.resolve(__dirname, '..', f);
        return { file: f, mtime: fs.statSync(full).mtimeMs, size: fs.statSync(full).size };
      });

      createPatchApproval(makeApprovalInput({ draft }));

      const afterStats = targets.map(f => {
        const full = path.resolve(__dirname, '..', f);
        return { file: f, mtime: fs.statSync(full).mtimeMs, size: fs.statSync(full).size };
      });

      expect(afterStats).toEqual(beforeStats);
    });
  });

  describe('import boundary', () => {
    it('patchApproval.ts does not import gate, executor, crypto authority, or child_process', () => {
      const src = fs.readFileSync(path.resolve(__dirname, '../src/patchApproval.ts'), 'utf-8');
      expect(src).not.toContain("from './index'");
      expect(src).not.toContain("from './executor'");
      expect(src).not.toContain("from './crypto'");
      expect(src).not.toContain("from 'child_process'");
      const lines = src.split('\n').filter(line => !line.trim().startsWith('/\\b'));
      const joined = lines.join('\n');
      expect(joined).not.toContain('evaluateIntent');
      expect(joined).not.toContain('executeDecision');
      expect(joined).not.toContain('signPoP');
      expect(joined).not.toContain('EDGE_NODE_SEED');
    });
  });
});
