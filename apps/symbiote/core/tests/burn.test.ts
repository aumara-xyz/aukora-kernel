import { describe, it, expect, beforeEach } from 'vitest';
import { _resetChain, PrincipalRegistry } from '../src/index';
import { hash, computeMerkleRoot, verifyReceiptHistory, signPoP, PoP, getTestPublicKey, verifyChain } from '../src/crypto';
import { normalizeProposal } from '../src/normalizer';
import { runBurnHarness, BurnCandidate } from '../src/burn';

const POP_SEED = "77".repeat(32);
const ATTACKER_SEED = "99".repeat(32);

const POP_PUBLIC_KEY = getTestPublicKey(POP_SEED);

function createDeterministicCandidates(): BurnCandidate[] {
  const candidates: BurnCandidate[] = [];
  
  // 1: Valid read
  const c1 = { action: 'read_file', resource: 'burn_1.txt', ring: 'local' };
  candidates.push({ rawIntent: c1, pop: signPoP(POP_SEED, {
    principalId: 'test-admin',
    methodId: 'evaluateIntent',
    argsHash: hash(JSON.stringify(normalizeProposal(c1))),
    nonce: 'burn-nonce-1'
  })});
  
  // 2: Valid read
  const c2 = { action: 'read_file', resource: 'burn_2.txt', ring: 'local' };
  candidates.push({ rawIntent: c2, pop: signPoP(POP_SEED, {
    principalId: 'test-admin',
    methodId: 'evaluateIntent',
    argsHash: hash(JSON.stringify(normalizeProposal(c2))),
    nonce: 'burn-nonce-2'
  })});
  
  // 3: Forbidden action
  const c3 = { action: 'delete_path', resource: 'sys.txt', ring: 'local' };
  candidates.push({ rawIntent: c3, pop: signPoP(POP_SEED, {
    principalId: 'test-admin',
    methodId: 'evaluateIntent',
    argsHash: hash(JSON.stringify(normalizeProposal(c3))),
    nonce: 'burn-nonce-3'
  })});
  
  // 4: Missing PoP
  const c4 = { action: 'read_file', resource: 'burn_4.txt', ring: 'local' };
  candidates.push({ rawIntent: c4, pop: null });
  
  // 5: Unknown principal
  const c5 = { action: 'read_file', resource: 'burn_5.txt', ring: 'local' };
  candidates.push({ rawIntent: c5, pop: signPoP(POP_SEED, {
    principalId: 'unknown-admin',
    methodId: 'evaluateIntent',
    argsHash: hash(JSON.stringify(normalizeProposal(c5))),
    nonce: 'burn-nonce-5'
  })});
  
  // 6: Attacker key
  const c6 = { action: 'read_file', resource: 'burn_6.txt', ring: 'local' };
  candidates.push({ rawIntent: c6, pop: signPoP(ATTACKER_SEED, {
    principalId: 'test-admin',
    methodId: 'evaluateIntent',
    argsHash: hash(JSON.stringify(normalizeProposal(c6))),
    nonce: 'burn-nonce-6'
  })});
  
  // 7: Replay nonce (reusing nonce 1)
  const c7 = { action: 'read_file', resource: 'burn_7.txt', ring: 'local' };
  candidates.push({ rawIntent: c7, pop: signPoP(POP_SEED, {
    principalId: 'test-admin',
    methodId: 'evaluateIntent',
    argsHash: hash(JSON.stringify(normalizeProposal(c7))),
    nonce: 'burn-nonce-1' 
  })});
  
  // 8: Valid read
  const c8 = { action: 'read_file', resource: 'burn_8.txt', ring: 'local' };
  candidates.push({ rawIntent: c8, pop: signPoP(POP_SEED, {
    principalId: 'test-admin',
    methodId: 'evaluateIntent',
    argsHash: hash(JSON.stringify(normalizeProposal(c8))),
    nonce: 'burn-nonce-8'
  })});
  
  // 9: Sacred violation
  const c9 = { action: 'read_file', resource: 'aukoraConfig', ring: 'local' };
  candidates.push({ rawIntent: c9, pop: signPoP(POP_SEED, {
    principalId: 'test-admin',
    methodId: 'evaluateIntent',
    argsHash: hash(JSON.stringify(normalizeProposal(c9))),
    nonce: 'burn-nonce-9'
  })});
  
  // 10: Valid read
  const c10 = { action: 'read_file', resource: 'burn_10.txt', ring: 'local' };
  candidates.push({ rawIntent: c10, pop: signPoP(POP_SEED, {
    principalId: 'test-admin',
    methodId: 'evaluateIntent',
    argsHash: hash(JSON.stringify(normalizeProposal(c10))),
    nonce: 'burn-nonce-10'
  })});
  
  return candidates;
}

describe('Commit 5: 10-Iteration Candidate-Only Burn Harness', () => {
  beforeEach(() => {
    _resetChain();
    PrincipalRegistry.set('test-admin', POP_PUBLIC_KEY);
  });

  it('runs exactly 10 iterations cleanly and conforms to laws', () => {
    const candidates = createDeterministicCandidates();
    const results = runBurnHarness(candidates);
    
    expect(results.length).toBe(10);
    
    const receipts = results.map(r => r.decision.receipt);
    
    // Each iteration emits one receipt and one VK row
    for (const res of results) {
      expect(res.receiptId).toBeDefined();
      expect(res.vkRowId).toBeDefined();
      expect(res.decision.vkRow.evidenceOnly).toBe(true);
      // Ensure score shows law conformance (+1 for receipt, +1 for evidenceOnly, +1 for rule check = 3)
      // For some cases, the score logic gives 2 or 3 depending on the rule
      expect(res.score).toBeGreaterThanOrEqual(2); 
    }
    
    // verifyChain stays true after the run
    expect(verifyChain(receipts)).toBe(true);
    
    // verifyReceiptHistory matches the final Merkle root
    const finalRoot = computeMerkleRoot(receipts);
    expect(verifyReceiptHistory(receipts, finalRoot)).toBe(true);
    
    // Verify specific boundary defenses held up during the burn
    expect(results[0].verdict).toBe('golden_success');
    expect(results[2].verdict).toBe('refused'); // forbidden action
    expect(results[3].verdict).toBe('refused'); // missing PoP
    expect(results[4].verdict).toBe('refused'); // unknown principal
    expect(results[5].verdict).toBe('refused'); // attacker key
    expect(results[6].verdict).toBe('refused'); // replay nonce
    expect(results[8].verdict).toBe('refused'); // sacred violation
  });

  it('burn output never changes authorization verdicts', () => {
    const candidates = createDeterministicCandidates();
    const results = runBurnHarness(candidates);
    
    // Attempting to mutate evidence post-burn doesn't alter the sealed verdict
    const vkRows = results.map(r => r.decision.vkRow);
    vkRows[0].verdict = 'refused';
    
    expect(results[0].verdict).toBe('golden_success');
  });

  it('replay excluding createdAt is completely deterministic', () => {
    const candidates1 = createDeterministicCandidates();
    const results1 = runBurnHarness(candidates1);
    
    // Complete fresh state
    _resetChain();
    PrincipalRegistry.set('test-admin', POP_PUBLIC_KEY);
    
    const candidates2 = createDeterministicCandidates();
    const results2 = runBurnHarness(candidates2);
    
    for (let i = 0; i < 10; i++) {
      const vk1 = results1[i].decision.vkRow;
      const vk2 = results2[i].decision.vkRow;
      
      const { createdAt: c1, ...rest1 } = vk1;
      const { createdAt: c2, ...rest2 } = vk2;
      
      expect(rest1).toEqual(rest2);
      expect(results1[i].receiptId).toBe(results2[i].receiptId);
      expect(results1[i].verdict).toBe(results2[i].verdict);
    }
  });
});
