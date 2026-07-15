// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'crypto';
import { PatchProposal } from './patchProposal';
import { OpenCodeAdvisoryArtifact, ProposalAdvisoryState } from './opencodeWombArtifact';

export type ApprovalState = 'pending' | 'approved' | 'refused';
export type PatchVerdict = 'proposed' | 'approved' | 'refused' | 'tested_green' | 'tested_red';

export interface PatchLoopReceipt {
  proposalId: string;
  proposalHash: string;
  targetFiles: string[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  authoritySurfaces: string[];
  advisorySurfaces: string[];
  requiredTests: string[];
  approvalState: ApprovalState;
  testsCommand: string;
  testsPassed: number;
  testsFailed: number;
  advisoryArtifactBeforeHash: string;
  advisoryArtifactAfterHash: string;
  patchDescriptionHash: string;
  verdict: PatchVerdict;
  advisoryOnly: true;
  createdAt: string;
}

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function computeProposalHash(proposal: PatchProposal): string {
  const canonical = JSON.stringify({
    proposalId: proposal.proposalId,
    targetFiles: [...proposal.targetFiles].sort(),
    riskLevel: proposal.riskLevel,
    reason: proposal.reason,
  });
  return sha256(canonical);
}

export function computeArtifactHash(artifact: OpenCodeAdvisoryArtifact | null): string {
  if (!artifact) return sha256('null');
  return sha256(JSON.stringify({
    consensus: artifact.consensus,
    findings_summary: artifact.findings_summary,
    risks_summary: artifact.risks_summary,
    recommended_next: artifact.recommended_next,
    timestamp: artifact.timestamp,
  }));
}

export function computePatchDescriptionHash(description: string): string {
  return sha256(description);
}

export interface CreatePatchReceiptInput {
  proposal: PatchProposal;
  approvalState: ApprovalState;
  testsPassed: number;
  testsFailed: number;
  testsCommand: string;
  advisoryBefore: OpenCodeAdvisoryArtifact | null;
  advisoryAfter: OpenCodeAdvisoryArtifact | null;
  patchDescription: string;
  createdAt: string;
}

function deriveVerdict(approvalState: ApprovalState, testsPassed: number, testsFailed: number): PatchVerdict {
  if (approvalState === 'refused') return 'refused';
  if (approvalState === 'pending') return 'proposed';
  if (testsPassed === 0 && testsFailed === 0) return 'approved';
  if (testsFailed > 0) return 'tested_red';
  return 'tested_green';
}

export function createPatchLoopReceipt(input: CreatePatchReceiptInput): PatchLoopReceipt {
  const { proposal, approvalState, testsPassed, testsFailed, testsCommand, advisoryBefore, advisoryAfter, patchDescription, createdAt } = input;

  return {
    proposalId: proposal.proposalId,
    proposalHash: computeProposalHash(proposal),
    targetFiles: [...proposal.targetFiles],
    riskLevel: proposal.riskLevel,
    authoritySurfaces: [...proposal.authoritySurfacesTouched],
    advisorySurfaces: [...proposal.advisorySurfacesTouched],
    requiredTests: [...proposal.requiredTests],
    approvalState,
    testsCommand,
    testsPassed,
    testsFailed,
    advisoryArtifactBeforeHash: computeArtifactHash(advisoryBefore),
    advisoryArtifactAfterHash: computeArtifactHash(advisoryAfter),
    patchDescriptionHash: computePatchDescriptionHash(patchDescription),
    verdict: deriveVerdict(approvalState, testsPassed, testsFailed),
    advisoryOnly: true,
    createdAt,
  };
}

export function validatePatchReceipt(receipt: PatchLoopReceipt): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  if (!receipt.advisoryOnly) violations.push('advisoryOnly must be true');
  if (!receipt.proposalId.startsWith('prop_')) violations.push('proposalId must start with prop_');
  if (!receipt.proposalHash || receipt.proposalHash.length !== 64) violations.push('proposalHash must be a 64-char hex string');
  if (!['pending', 'approved', 'refused'].includes(receipt.approvalState)) violations.push('invalid approvalState');
  if (!['proposed', 'approved', 'refused', 'tested_green', 'tested_red'].includes(receipt.verdict)) violations.push('invalid verdict');
  if (!['LOW', 'MEDIUM', 'HIGH'].includes(receipt.riskLevel)) violations.push('invalid riskLevel');

  const json = JSON.stringify(receipt);
  if (/signedHead/i.test(json)) violations.push('signedHead leaked into receipt');
  if (/merkleRoot/i.test(json)) violations.push('merkleRoot leaked into receipt');
  if (/sk-or-[a-zA-Z0-9_-]{16,}/.test(json)) violations.push('API key pattern found');
  if (/\b[a-fA-F0-9]{96,}\b/.test(json)) violations.push('possible signature or key material found');
  if ((receipt as any).pop) violations.push('PoP field present');
  if ((receipt as any).signature) violations.push('signature field present');
  if ((receipt as any).authority_granted) violations.push('authority_granted field present');
  if ((receipt as any).gate_changed) violations.push('gate_changed field present');

  return { valid: violations.length === 0, violations };
}

export function toProposalAdvisoryState(receipt: PatchLoopReceipt, reason: string): ProposalAdvisoryState {
  return {
    proposalId: receipt.proposalId,
    targetFiles: [...receipt.targetFiles],
    riskLevel: receipt.riskLevel,
    reason,
    requiredTests: [...receipt.requiredTests],
    approvalState: receipt.approvalState,
    verdict: receipt.verdict,
    testsPassed: receipt.testsPassed,
    testsFailed: receipt.testsFailed,
    advisoryOnly: true,
  };
}
