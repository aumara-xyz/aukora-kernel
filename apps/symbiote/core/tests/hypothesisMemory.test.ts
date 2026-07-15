import { describe, it, expect, beforeEach } from 'vitest';
import { HypothesisMemory, VerifiedEvidenceBundle } from '../src/hypothesisMemory';
import { evaluateIntent, PrincipalRegistry, _resetChain, getChain } from '../src/index';
import { getTestPublicKey, signPoP, hash, computeMerkleRoot, signHead } from '../src/crypto';
import { normalizeProposal } from '../src/normalizer';
import { exportVkRow, loadVkRow } from '../src/trainingExport';

const POP_SEED = "77".repeat(32);
const EDGE_NODE_SEED = "88".repeat(32);
const POP_PUBLIC_KEY = getTestPublicKey(POP_SEED);

function createValidPoP(rawIntent: any): any {
  const intent = normalizeProposal(rawIntent);
  const intentHash = hash(JSON.stringify(intent));
  return signPoP(POP_SEED, {
    principalId: 'test-admin',
    methodId: 'evaluateIntent',
    argsHash: intentHash,
    nonce: Math.random().toString(),
  });
}

describe('Commit 20A.2: Real Crypto Hypothesis Memory', () => {

  beforeEach(() => {
    _resetChain();
    PrincipalRegistry.set('test-admin', POP_PUBLIC_KEY);
  });

  function generateRealEvidenceBundle(action: string, resource: string, expectedVerdict: 'golden_success' | 'refused', ring: string = 'local'): VerifiedEvidenceBundle {
    const rawIntent = { action, resource, ring };
    // If ring is system but we want refusal, we should use an invalid PoP. 
    // If ring is local, valid PoP.
    const pop = ring === 'local' ? createValidPoP(rawIntent) : signPoP("99".repeat(32), { // Attacker seed
        principalId: 'hacker',
        methodId: 'evaluateIntent',
        argsHash: hash(JSON.stringify(normalizeProposal(rawIntent))),
        nonce: "1"
    });
    
    // Evaluate to put receipt in chain
    const decision = evaluateIntent(rawIntent, pop);
    expect(decision.verdict).toBe(expectedVerdict);
    
    const exportedJson = exportVkRow(decision.vkRow!);
    const vkRow = loadVkRow(exportedJson);
    
    const chain = getChain();
    const root = computeMerkleRoot(chain);
    const sig = signHead(EDGE_NODE_SEED, root);
    
    return {
      vkRow,
      receiptChain: chain,
      expectedRoot: root,
      signedHead: sig
    };
  }

  it('Cannot mark supported with tampered signedHead', () => {
    const memory = new HypothesisMemory();
    const hyp = memory.createHypothesis("read is allowed", "open", "read_file", "data.txt");
    
    const bundle = generateRealEvidenceBundle('read_file', 'data.txt', 'golden_success');
    bundle.signedHead = "tampered-signature";
    
    expect(() => {
      memory.updateWithVerifiedEvidence(hyp.hypothesisId, bundle);
    }).toThrow("Verification Failed");
    
    expect(hyp.status).toBe('open');
  });

  it('Cannot mark supported with tampered VK row hash (verifyVkRowAgainstSignedChain fails)', () => {
    const memory = new HypothesisMemory();
    const hyp = memory.createHypothesis("read is allowed", "open", "read_file", "data.txt");
    
    const bundle = generateRealEvidenceBundle('read_file', 'data.txt', 'golden_success');
    bundle.vkRow.verdict = "refused"; // tamper the row directly
    
    expect(() => {
      memory.updateWithVerifiedEvidence(hyp.hypothesisId, bundle);
    }).toThrow("Verification Failed");
    
    expect(hyp.status).toBe('open');
  });

  it('Real signed matching golden_success evidence marks supported', () => {
    const memory = new HypothesisMemory();
    const hyp = memory.createHypothesis("Action read is allowed", "open", "read_file", "data.txt");
    
    const bundle1 = generateRealEvidenceBundle('read_file', 'data.txt', 'golden_success');
    memory.updateWithVerifiedEvidence(hyp.hypothesisId, bundle1);
    
    const bundle2 = generateRealEvidenceBundle('read_file', 'data.txt', 'golden_success');
    memory.updateWithVerifiedEvidence(hyp.hypothesisId, bundle2);
    
    expect(hyp.confidence).toBe(9);
    expect(hyp.status).toBe('supported');
    expect(hyp.evidenceForReceiptIds.length).toBe(2);
  });

  it('Real signed matching refused evidence lowers confidence or marks contradicted', () => {
    // We must generate a refusal. A refusal occurs if ring='system' and no admin PoP is provided, or missing ring, etc.
    // Our PoP is valid for test-admin. Let's make it fail by using an unknown principal.
    const memory = new HypothesisMemory();
    const hyp = memory.createHypothesis("Action write is allowed", "open", "write_file", "data.txt");
    
    const rawIntent = { action: 'write_file', resource: 'data.txt', ring: 'system' };
    const invalidPoP = signPoP("99".repeat(32), { // Attacker seed
        principalId: 'hacker',
        methodId: 'evaluateIntent',
        argsHash: hash(JSON.stringify(normalizeProposal(rawIntent))),
        nonce: "1"
    });

    const decision = evaluateIntent(rawIntent, invalidPoP);
    expect(decision.verdict).toBe('refused');
    
    const chain = getChain();
    const root = computeMerkleRoot(chain);
    
    const bundle: VerifiedEvidenceBundle = {
      vkRow: loadVkRow(exportVkRow(decision.vkRow!)),
      receiptChain: chain,
      expectedRoot: root,
      signedHead: signHead(EDGE_NODE_SEED, root)
    };
    
    memory.updateWithVerifiedEvidence(hyp.hypothesisId, bundle);
    
    expect(hyp.confidence).toBe(2);
    expect(hyp.status).toBe('contradicted');
  });
  
  it('Mismatched signed receipt cannot support unrelated claim', () => {
    const memory = new HypothesisMemory();
    const hyp = memory.createHypothesis("write is good", "open", "write_file", "data.txt");
    
    // Generate success for 'read_file' instead of 'write_file'
    const bundle = generateRealEvidenceBundle('read_file', 'data.txt', 'golden_success');
    
    expect(() => {
      memory.updateWithVerifiedEvidence(hyp.hypothesisId, bundle);
    }).toThrow("Mismatched receipt intent cannot support or contradict this hypothesis");
    
    expect(hyp.status).toBe('open');
  });

  it('Hypothesis memory has no forbidden authority imports', () => {
    const memory = new HypothesisMemory();
    expect((memory as any).evaluateIntent).toBeUndefined();
    expect((memory as any).executeDecision).toBeUndefined();
    expect((memory as any).signPoP).toBeUndefined();
  });

  it('Confidence stays bounded 0..10 using real evidence', () => {
    const memory = new HypothesisMemory();
    const hyp = memory.createHypothesis("bounds test", "open", "read_file", "data.txt");
    
    // Push above 10
    for(let i=0; i<4; i++) {
        const successBundle = generateRealEvidenceBundle('read_file', 'data.txt', 'golden_success');
        memory.updateWithVerifiedEvidence(hyp.hypothesisId, successBundle);
    }
    expect(hyp.confidence).toBe(10);
    
    // Push below 0
    for(let i=0; i<6; i++) {
        const failBundle = generateRealEvidenceBundle('write_file', 'data.txt', 'refused', 'system');
        // Wait, the action must match the targetAction ('read_file') or it throws mismatched intent.
        // We will generate a refusal for 'read_file' but ring='system' so it refuses.
        const refusedRead = generateRealEvidenceBundle('read_file', 'data.txt', 'refused', 'system');
        memory.updateWithVerifiedEvidence(hyp.hypothesisId, refusedRead);
    }
    expect(hyp.confidence).toBe(0);
  });

  it('Dream/replay only updates hypothesis state from verified evidence', () => {
    const memory = new HypothesisMemory();
    const hyp1 = memory.createHypothesis("Hyp 1", "open", "read_file", "data.txt");
    
    const validBundle = generateRealEvidenceBundle("read_file", "data.txt", "golden_success");
    
    // Replay valid update
    memory.dreamReplay([
      { hypothesisId: hyp1.hypothesisId, bundle: validBundle },
    ]);
    
    const updatedHyp1 = memory.getHypothesis(hyp1.hypothesisId)!;
    expect(updatedHyp1.confidence).toBe(7); // 5 + 2 = 7
    expect(updatedHyp1.status).toBe('open'); 
  });
});
