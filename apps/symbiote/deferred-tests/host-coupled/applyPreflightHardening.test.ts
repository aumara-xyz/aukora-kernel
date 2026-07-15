import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

import {
  createLocalAumlokRoot,
  signPatchApprovalWithAumlokRoot,
  verifyAumlokApprovalBinding,
  sanitizeAumlokBindingForArtifact,
  isApplyEligibleBinding,
  _canonicalBindingPayload_FOR_TEST_ONLY as canonicalBindingPayload,
} from '../src/aumlokApprovalRoot';
import type { AumlokApprovalBinding } from '../src/aumlokApprovalRoot';

import { createPatchApproval, isApplyEligibleApproval } from '../src/patchApproval';
import type { PatchApprovalRecord } from '../src/patchApproval';

import { parseImportEdges, stripCommentsAndStrings, symbolUsedInCode, symbolForbiddenInFile } from '../src/importGraphVerifier';

import { generateSecuritySnapshot, REQUIRED_CLAIM_IDS } from '../src/securityInvariantSnapshot';

import {
  FORBIDDEN_CONTENT_PATTERNS,
  FORBIDDEN_COMMAND_PATTERNS,
  containsForbiddenContent,
  containsForbiddenCommand,
} from '../src/wombForbiddenPatterns';

const ROOT = path.resolve(__dirname, '..');

function sha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function makeTestApproval(overrides?: Partial<PatchApprovalRecord>): PatchApprovalRecord {
  return {
    approvalId: 'approval_test123',
    draftId: 'draft_test456',
    proposalId: 'prop_test789',
    candidateId: 'cand_testabc',
    approvalState: 'approved',
    approvedBy: 'kernel_test',
    approvedScope: {
      targetFiles: ['src/test.ts'],
      allowedOperations: ['apply_candidate_diff'],
      requiredTests: ['tests/test.test.ts'],
      maxFilesChanged: 1,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    },
    draftHash: sha256('draft'),
    proposalHash: sha256('proposal'),
    approvalHash: sha256('approval'),
    createdAt: new Date().toISOString(),
    advisoryOnly: true,
    grantsAuthority: false,
    ...overrides,
  };
}

function makeTestBinding(): AumlokApprovalBinding {
  const root = createLocalAumlokRoot();
  const approval = makeTestApproval();
  const signature = signPatchApprovalWithAumlokRoot(approval, root);
  return {
    approval,
    root,
    signature,
    verified: true,
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

describe('Apply Preflight Hardening — 24O.2 / 24P.0', () => {

  describe('1. local_stub apply disqualification', () => {
    it('isApplyEligibleBinding returns false for local_stub', () => {
      const binding = makeTestBinding();
      const result = isApplyEligibleBinding(binding);
      expect(result.eligible).toBe(false);
      expect(result.reasons).toContain('local_stub mode — rehearsal only, not apply-eligible');
    });

    it('local_stub binding can be verified as rehearsal', () => {
      const binding = makeTestBinding();
      const verification = verifyAumlokApprovalBinding(binding);
      expect(verification.valid).toBe(true);
    });

    it('local_stub binding can be displayed in advisory', () => {
      const binding = makeTestBinding();
      const sanitized = sanitizeAumlokBindingForArtifact(binding);
      expect(sanitized.mode).toBe('local_stub');
      expect(sanitized.advisoryOnly).toBe(true);
      expect(sanitized.grantsAuthority).toBe(false);
      expect(sanitized.rootId).toBeTruthy();
    });

    it('local_stub binding can never authorize apply', () => {
      const binding = makeTestBinding();
      const result = isApplyEligibleBinding(binding);
      expect(result.eligible).toBe(false);
      expect(result.reasons.length).toBeGreaterThan(0);
      expect(binding.grantsAuthority).toBe(false);
      expect(binding.advisoryOnly).toBe(true);
    });

    it('return type is structurally { eligible: false }', () => {
      const binding = makeTestBinding();
      const result = isApplyEligibleBinding(binding);
      const typeCheck: { eligible: false; reasons: string[] } = result;
      expect(typeCheck.eligible).toBe(false);
    });
  });

  describe('2. kernel_test approval disqualification', () => {
    it('isApplyEligibleApproval returns false for kernel_test', () => {
      const record = makeTestApproval({ approvedBy: 'kernel_test' });
      const result = isApplyEligibleApproval(record);
      expect(result.eligible).toBe(false);
      expect(result.reasons).toContain('kernel_test approvals are not apply-eligible');
    });

    it('human_local approval is also not apply-eligible (no apply lane)', () => {
      const record = makeTestApproval({ approvedBy: 'human_local' });
      const result = isApplyEligibleApproval(record);
      expect(result.eligible).toBe(false);
      expect(result.reasons).toContain('no apply lane exists');
    });

    it('kernel_test approval grantsAuthority is false', () => {
      const record = makeTestApproval({ approvedBy: 'kernel_test' });
      expect(record.grantsAuthority).toBe(false);
      expect(record.advisoryOnly).toBe(true);
    });

    it('refused approval is not apply-eligible', () => {
      const record = makeTestApproval({ approvalState: 'refused' });
      const result = isApplyEligibleApproval(record);
      expect(result.eligible).toBe(false);
      expect(result.reasons).toContain('approval state is not approved');
    });
  });

  describe('3. canonical binding serialization', () => {
    it('canonical payload is key-order independent', () => {
      const a = canonicalBindingPayload({ z: '1', a: '2', m: '3' });
      const b = canonicalBindingPayload({ a: '2', m: '3', z: '1' });
      expect(a).toBe(b);
    });

    it('canonical payload uses sorted keys and pipe separators', () => {
      const result = canonicalBindingPayload({ b: '2', a: '1' });
      expect(result).toBe('a=1|b=2');
    });

    it('changed draftId changes hash', () => {
      const base = { approvalHash: 'h', approvalId: 'a', draftId: 'd1', mode: 'local_stub', proposalId: 'p', rootId: 'r' };
      const modified = { ...base, draftId: 'd2' };
      expect(sha256(canonicalBindingPayload(base))).not.toBe(sha256(canonicalBindingPayload(modified)));
    });

    it('changed approvalId changes hash', () => {
      const base = { approvalHash: 'h', approvalId: 'a1', draftId: 'd', mode: 'local_stub', proposalId: 'p', rootId: 'r' };
      const modified = { ...base, approvalId: 'a2' };
      expect(sha256(canonicalBindingPayload(base))).not.toBe(sha256(canonicalBindingPayload(modified)));
    });

    it('changed rootId changes hash', () => {
      const base = { approvalHash: 'h', approvalId: 'a', draftId: 'd', mode: 'local_stub', proposalId: 'p', rootId: 'r1' };
      const modified = { ...base, rootId: 'r2' };
      expect(sha256(canonicalBindingPayload(base))).not.toBe(sha256(canonicalBindingPayload(modified)));
    });

    it('changed approvalHash changes hash', () => {
      const base = { approvalHash: 'h1', approvalId: 'a', draftId: 'd', mode: 'local_stub', proposalId: 'p', rootId: 'r' };
      const modified = { ...base, approvalHash: 'h2' };
      expect(sha256(canonicalBindingPayload(base))).not.toBe(sha256(canonicalBindingPayload(modified)));
    });

    it('changed mode changes hash', () => {
      const base = { approvalHash: 'h', approvalId: 'a', draftId: 'd', mode: 'local_stub', proposalId: 'p', rootId: 'r' };
      const modified = { ...base, mode: 'production' };
      expect(sha256(canonicalBindingPayload(base))).not.toBe(sha256(canonicalBindingPayload(modified)));
    });

    it('reordered object keys do not change canonical hash', () => {
      const ordered = { approvalHash: 'h', approvalId: 'a', draftId: 'd', mode: 'local_stub', proposalId: 'p', rootId: 'r' };
      const reversed = { rootId: 'r', proposalId: 'p', mode: 'local_stub', draftId: 'd', approvalId: 'a', approvalHash: 'h' };
      expect(sha256(canonicalBindingPayload(ordered))).toBe(sha256(canonicalBindingPayload(reversed)));
    });

    it('sign + verify round-trips with canonical serialization', () => {
      const binding = makeTestBinding();
      const verification = verifyAumlokApprovalBinding(binding);
      expect(verification.valid).toBe(true);
      expect(verification.violations).toHaveLength(0);
    });
  });

  describe('4. shared forbidden pattern source', () => {
    it('wombForbiddenPatterns exports FORBIDDEN_CONTENT_PATTERNS', () => {
      expect(FORBIDDEN_CONTENT_PATTERNS).toBeDefined();
      expect(FORBIDDEN_CONTENT_PATTERNS.length).toBe(10);
    });

    it('wombForbiddenPatterns exports FORBIDDEN_COMMAND_PATTERNS', () => {
      expect(FORBIDDEN_COMMAND_PATTERNS).toBeDefined();
      expect(FORBIDDEN_COMMAND_PATTERNS.length).toBe(10);
    });

    it('containsForbiddenContent detects API key patterns', () => {
      expect(containsForbiddenContent('sk-or-abc123def456789012')).toBe(true);
    });

    it('containsForbiddenCommand detects signPoP', () => {
      expect(containsForbiddenCommand('call signPoP here')).toBe(true);
    });

    it('no womb module defines its own FORBIDDEN_CONTENT_PATTERNS', () => {
      const wombModules = [
        'src/wombTargetDiscovery.ts',
        'src/wombPatchDraft.ts',
        'src/patchApproval.ts',
        'src/opencodeWombArtifact.ts',
        'src/patchLoopReceipt.ts',
        'src/aumlokApprovalRoot.ts',
      ];
      for (const mod of wombModules) {
        const filePath = path.resolve(ROOT, mod);
        if (!fs.existsSync(filePath)) continue;
        const src = fs.readFileSync(filePath, 'utf-8');
        expect(src, `${mod} still defines inline FORBIDDEN_CONTENT_PATTERNS`).not.toMatch(
          /const\s+FORBIDDEN_CONTENT_PATTERNS\s*[:=]/
        );
      }
    });

    it('no womb module defines its own FORBIDDEN_COMMAND_PATTERNS', () => {
      const wombModules = [
        'src/wombTargetDiscovery.ts',
        'src/wombPatchDraft.ts',
        'src/patchApproval.ts',
        'src/opencodeWombArtifact.ts',
        'src/patchLoopReceipt.ts',
        'src/aumlokApprovalRoot.ts',
      ];
      for (const mod of wombModules) {
        const filePath = path.resolve(ROOT, mod);
        if (!fs.existsSync(filePath)) continue;
        const src = fs.readFileSync(filePath, 'utf-8');
        expect(src, `${mod} still defines inline FORBIDDEN_COMMAND_PATTERNS`).not.toMatch(
          /const\s+FORBIDDEN_COMMAND_PATTERNS\s*[:=]/
        );
      }
    });

    it('no womb module defines its own inline FORBIDDEN_PATTERNS', () => {
      const filePath = path.resolve(ROOT, 'src/opencodeWombArtifact.ts');
      if (!fs.existsSync(filePath)) return;
      const src = fs.readFileSync(filePath, 'utf-8');
      expect(src).not.toMatch(/const\s+FORBIDDEN_PATTERNS\s*:\s*ReadonlyArray/);
    });
  });

  describe('5. static import graph verifier', () => {
    it('parses import statements from source', () => {
      const source = `
import { foo, bar } from './module';
import * as baz from './other';
import Default from './third';
`;
      const edges = parseImportEdges(source);
      expect(edges).toHaveLength(3);
      expect(edges[0].importedSymbols).toContain('foo');
      expect(edges[0].importedSymbols).toContain('bar');
      expect(edges[0].toModule).toBe('./module');
      expect(edges[1].importedSymbols).toContain('baz');
      expect(edges[2].importedSymbols).toContain('Default');
    });

    it('comments containing forbidden symbols do not count as violations', () => {
      const source = `
// evaluateIntent is dangerous — do not import
// signPoP should never be called here
const x = 42;
`;
      expect(symbolUsedInCode(source, 'evaluateIntent')).toBe(false);
      expect(symbolUsedInCode(source, 'signPoP')).toBe(false);
    });

    it('string literals containing forbidden symbols do not count as violations', () => {
      const source = `
const msg = 'evaluateIntent is not imported';
const other = "signPoP should not trigger";
const x = 42;
`;
      expect(symbolUsedInCode(source, 'evaluateIntent')).toBe(false);
      expect(symbolUsedInCode(source, 'signPoP')).toBe(false);
    });

    it('actual code calls DO count as violations', () => {
      const source = `
const result = evaluateIntent(intent);
signPoP(data);
`;
      expect(symbolUsedInCode(source, 'evaluateIntent')).toBe(true);
      expect(symbolUsedInCode(source, 'signPoP')).toBe(true);
    });

    it('stripCommentsAndStrings removes all comment types', () => {
      const source = `
code1(); // line comment
code2(); /* block comment */
code3(); /* multi
line
comment */
code4();
`;
      const stripped = stripCommentsAndStrings(source);
      expect(stripped).toContain('code1()');
      expect(stripped).toContain('code4()');
      expect(stripped).not.toContain('line comment');
      expect(stripped).not.toContain('block comment');
      expect(stripped).not.toContain('multi');
    });

    it('womb modules have no forbidden import edges (import graph proof)', () => {
      const wombFiles = [
        'src/wombTargetDiscovery.ts',
        'src/wombPatchDraft.ts',
        'src/patchApproval.ts',
        'src/opencodeWombArtifact.ts',
        'src/patchLoopReceipt.ts',
        'src/aumlokApprovalRoot.ts',
        'src/wombForbiddenPatterns.ts',
      ];
      const forbiddenSymbols = ['evaluateIntent', 'executeDecision', 'signPoP'];

      for (const file of wombFiles) {
        const absPath = path.resolve(ROOT, file);
        if (!fs.existsSync(absPath)) continue;
        const src = fs.readFileSync(absPath, 'utf-8');
        const edges = parseImportEdges(src);
        for (const symbol of forbiddenSymbols) {
          const imported = edges.some(e => e.importedSymbols.includes(symbol));
          expect(imported, `${file} imports forbidden symbol: ${symbol}`).toBe(false);
        }
      }
    });

    it('symbolForbiddenInFile returns correct evidence type', () => {
      const result = symbolForbiddenInFile(ROOT, 'src/wombForbiddenPatterns.ts', 'evaluateIntent');
      expect(result.violated).toBe(false);
      expect(result.evidence).toBe('none');
    });
  });

  describe('6. VK/Chronos mechanical invariants', () => {
    const snapshot = generateSecuritySnapshot(ROOT);
    const claimMap = new Map(snapshot.claims.map(c => [c.claimId, c]));

    it('chronosProtocol not imported by authority surfaces', () => {
      const claim = claimMap.get('chronos_not_imported_by_authority');
      expect(claim).toBeDefined();
      expect(claim!.status).toBe('PASS');
    });

    it('no Chronos runtime transport exists', () => {
      const claim = claimMap.get('no_chronos_runtime_transport');
      expect(claim).toBeDefined();
      expect(claim!.status).toBe('PASS');
    });

    it('VK/glyph state unreachable from Gate', () => {
      const claim = claimMap.get('vk_unreachable_from_gate');
      expect(claim).toBeDefined();
      expect(claim!.status).toBe('PASS');
    });

    it('glyph evidence may not authorize effects', () => {
      const claim = claimMap.get('glyph_may_not_authorize');
      expect(claim).toBeDefined();
      expect(claim!.status).toBe('PASS');
    });

    it('no codebook keys in model context', () => {
      const claim = claimMap.get('no_codebook_in_model_context');
      expect(claim).toBeDefined();
      expect(claim!.status).toBe('PASS');
    });

    it('timing may never authorize effects', () => {
      const claim = claimMap.get('timing_may_not_authorize');
      expect(claim).toBeDefined();
      expect(claim!.status).toBe('PASS');
    });

    it('security snapshot includes all 21 required claims', () => {
      expect(REQUIRED_CLAIM_IDS.length).toBe(21);
      for (const id of REQUIRED_CLAIM_IDS) {
        expect(claimMap.has(id), `missing claim: ${id}`).toBe(true);
      }
    });

    it('all 18 claims pass', () => {
      for (const claim of snapshot.claims) {
        expect(claim.status, `claim ${claim.claimId} is ${claim.status}`).toBe('PASS');
      }
    });
  });

  describe('7. apply lane NOT BUILT', () => {
    it('no apply-patch runner exists', () => {
      const applyRunner = path.resolve(ROOT, 'evidence/apply-patch.ts');
      expect(fs.existsSync(applyRunner)).toBe(false);
    });

    it('no apply function exported from womb modules', () => {
      const wombModules = [
        'src/wombTargetDiscovery.ts',
        'src/wombPatchDraft.ts',
        'src/patchApproval.ts',
        'src/aumlokApprovalRoot.ts',
        'src/wombForbiddenPatterns.ts',
      ];
      for (const mod of wombModules) {
        const filePath = path.resolve(ROOT, mod);
        if (!fs.existsSync(filePath)) continue;
        const src = fs.readFileSync(filePath, 'utf-8');
        expect(src, `${mod} exports an apply function`).not.toMatch(/export\s+(?:async\s+)?function\s+apply\w*\(/);
      }
    });

    it('grantsAuthority is false in AUMLOK binding', () => {
      const binding = makeTestBinding();
      expect(binding.grantsAuthority).toBe(false);
      expect(binding.root.grantsAuthority).toBe(false);
      expect(binding.signature.grantsAuthority).toBe(false);
    });
  });
});
