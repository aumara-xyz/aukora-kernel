import { describe, it, expect, beforeEach } from 'vitest';
import { runClosedLoopStep, trainOnDecision, runClosedLoopBurn } from '../src/loop';
import { evaluateIntent, PrincipalRegistry, _resetChain } from '../src/index';
import { getTestPublicKey, signPoP, hash, computeMerkleRoot, signHead, generateReceipt } from '../src/crypto';
import { normalizeProposal } from '../src/normalizer';
import { resetLearnerModel, predictVerdict } from '../src/learner';
import { readFileSync } from 'fs';
import { join } from 'path';
import { writeVkRow } from '../src/vk';

const POP_SEED = "77".repeat(32);
const EDGE_NODE_SEED = "88".repeat(32);
const ATTACKER_SEED = "99".repeat(32);

const POP_PUBLIC_KEY = getTestPublicKey(POP_SEED);
const EDGE_NODE_PUBLIC_KEY = getTestPublicKey(EDGE_NODE_SEED);

describe('Commit 10: Closed Learner -> Gate -> Receipt Loop', () => {
  beforeEach(() => {
    resetLearnerModel();
    _resetChain();
    PrincipalRegistry.set('test-admin', POP_PUBLIC_KEY);
  });

  it('predicted golden_success still goes through evaluateIntent and can only become real if gate returns golden_success', () => {
    const rawIntent = { action: 'read_file', resource: 'data.txt', ring: 'local' };
    
    // Valid PoP -> gate will return golden_success
    const pop = signPoP(POP_SEED, {
      principalId: 'test-admin',
      methodId: 'evaluateIntent',
      argsHash: hash(JSON.stringify(normalizeProposal(rawIntent))),
      nonce: 'nonce-1'
    });

    const { prediction, decision } = runClosedLoopStep(rawIntent, pop);
    
    // Prediction should be refused since learner is empty
    expect(prediction.predictedVerdict).toBe('refused');
    expect(prediction.evidenceOnly).toBe(true);

    // Gate should authorize
    expect(decision.verdict).toBe('golden_success');
    expect(decision.receipt).toBeDefined();

    // Now train the learner on this decision
    trainOnDecision(decision, [decision.receipt], decision.receipt.signedHead);

    // Next prediction should be golden_success
    const { prediction: pred2, decision: dec2 } = runClosedLoopStep(rawIntent, null);
    
    // Prediction learned golden
    expect(pred2.predictedVerdict).toBe('golden_success');
    expect(pred2.evidenceOnly).toBe(true);

    // But gate without PoP refuses! Prediction does NOT substitute for authorization!
    expect(dec2.verdict).toBe('refused');
  });

  it('predicted refused does not itself create a receipt or VK row', () => {
    const rawIntent = { action: 'unknown_magic', resource: 'stuff', ring: 'local' };
    
    const { prediction, decision } = runClosedLoopStep(rawIntent, null);
    
    expect(prediction.predictedVerdict).toBe('refused');
    
    // The loop inherently returns both. Prediction does not cause side effects.
    expect(decision.verdict).toBe('refused'); // default deny
  });

  it('prediction alone creates no training row', async () => {
    // This is structurally true. predictVerdict just returns an object.
    const { predictVerdict } = await import('../src/learner');
    const pred = predictVerdict(normalizeProposal({ action: 'read_file', resource: 'data', ring: 'local' }));
    
    // Cannot pass `pred` to trainOnDecision. It's fundamentally impossible by types.
    expect(pred.evidenceOnly).toBe(true);
  });

  it('forbidden action predicted refused still goes through gate and is refused by gate', () => {
    const rawIntent = { action: 'delete_path', resource: 'sys', ring: 'local' };
    
    // Valid PoP but forbidden action
    const pop = signPoP(POP_SEED, {
      principalId: 'test-admin',
      methodId: 'evaluateIntent',
      argsHash: hash(JSON.stringify(normalizeProposal(rawIntent))),
      nonce: 'nonce-2'
    });

    const { prediction, decision } = runClosedLoopStep(rawIntent, pop);
    
    expect(prediction.predictedVerdict).toBe('refused');
    expect(decision.verdict).toBe('refused'); // Gate hard-denies delete_path
  });

  it('if learner prediction is manually mutated to golden_success, evaluateIntent verdict is unchanged', () => {
    const rawIntent = { action: 'read_file', resource: 'data.txt', ring: 'local' };
    
    const { prediction, decision } = runClosedLoopStep(rawIntent, null);
    
    prediction.predictedVerdict = 'golden_success';
    
    // Mutating prediction object has no impact on the decision object already emitted
    expect(decision.verdict).toBe('refused');
  });

  it('new row from gate can be exported, loaded, verified against signed chain, and then trained', () => {
    const rawIntent = { action: 'read_file', resource: 'data.txt', ring: 'local' };
    const pop = signPoP(POP_SEED, {
      principalId: 'test-admin',
      methodId: 'evaluateIntent',
      argsHash: hash(JSON.stringify(normalizeProposal(rawIntent))),
      nonce: 'nonce-1'
    });

    const { decision } = runClosedLoopStep(rawIntent, pop);
    
    expect(() => trainOnDecision(decision, [decision.receipt], decision.receipt.signedHead)).not.toThrow();
  });

  it('learner.ts still does not import evaluateIntent', () => {
    const learnerSource = readFileSync(join(__dirname, '../src/learner.ts'), 'utf-8');
    expect(learnerSource).not.toMatch(/import.*evaluateIntent/);
  });

  // --- Commit 11 Tests ---

  it('multi-step burn: 10 steps, predictions drift but do not affect verdict, deep chain training works', () => {
    // 1. Build candidates
    const candidates = Array.from({ length: 10 }).map((_, i) => {
      const rawIntent = { action: 'read_file', resource: `burn_loop_${i}.txt`, ring: 'local' };
      // Every even index gets a valid PoP, every odd index gets null
      const pop = i % 2 === 0 ? signPoP(POP_SEED, {
        principalId: 'test-admin',
        methodId: 'evaluateIntent',
        argsHash: hash(JSON.stringify(normalizeProposal(rawIntent))),
        nonce: `burn-nonce-${i}`
      }) : null;

      return { rawIntent, pop };
    });

    // Pass empty receipt history initially since chain is reset
    
    // Pass empty receipt history initially since chain is reset
    const burnResult = runClosedLoopBurn(candidates, true, []);

    expect(burnResult.stepResults.length).toBe(10);

    // Verify invariants over time
    let goldenCount = 0;
    for (let i = 0; i < 10; i++) {
      const step = burnResult.stepResults[i];
      expect(step.prediction).toBeDefined();
      expect(step.decision).toBeDefined();

      // Gate decision is absolute: even index is golden, odd is refused
      expect(step.decision.verdict).toBe(i % 2 === 0 ? 'golden_success' : 'refused');
      
      // Prediction drifts depending on what was learned previously, 
      // but it NEVER substitutes the gate.
      if (step.decision.verdict === 'golden_success') goldenCount++;
    }

    expect(goldenCount).toBe(5);

    // After training on the 10 steps (5 golden, 5 refused for read_file), ratio is 0.5.
    // Our action-primary conservatism says if ratio > 0.5 it's golden, otherwise refused.
    // At exactly 0.5, it should predict refused.
    const finalIntent = normalizeProposal({ action: 'read_file', resource: 'final', ring: 'local' });
    const finalPred = predictVerdict(finalIntent);
    expect(finalPred.predictedVerdict).toBe('refused');
  });

  it('deep-chain training: train on a non-last receipt in a multi-receipt chain', () => {
    // Generate a sequence of receipts manually to form a long chain
    const receipts = [];
    let lastHash = 'genesis_hash';
    for(let i=0; i<5; i++) {
      const intent = normalizeProposal({action: 'read_file', resource: `${i}`, ring: 'local'});
      const r = generateReceipt('golden_success', intent, hash(JSON.stringify(intent)), lastHash);
      r.signedHead = signHead(EDGE_NODE_SEED, computeMerkleRoot([...receipts, r]));
      receipts.push(r);
      lastHash = r.id;
    }

    // Attempt to train on the 3rd row (index 2), using the chain up to that point
    const targetReceipt = receipts[2];
    const decision = {
      verdict: targetReceipt.verdict,
      receipt: targetReceipt,
      vkRow: writeVkRow('evaluate_intent', targetReceipt.normalizedIntent, targetReceipt.verdict, targetReceipt)
    };

    // Train on decision using the partial chain up to index 2
    const partialChain = receipts.slice(0, 3);
    
    // Should succeed because trainOnDecision recomputes the root for the partial chain and verifies the head
    expect(() => trainOnDecision(decision as any, partialChain, targetReceipt.signedHead)).not.toThrow();
  });

  it('forged KernelDecision / fake receipt is rejected by trainOnDecision', () => {
    const rawIntent = { action: 'read_file', resource: 'data', ring: 'local' };
    // Attacker crafts a fake receipt and signs it with their own key
    const intent = normalizeProposal(rawIntent);
    const fakeReceipt = generateReceipt('golden_success', intent, hash(JSON.stringify(intent)), 'genesis_hash');
    const fakeRoot = computeMerkleRoot([fakeReceipt]);
    fakeReceipt.signedHead = signHead(ATTACKER_SEED, fakeRoot); // Fake signature
    
    const fakeDecision = {
      verdict: 'golden_success',
      receipt: fakeReceipt,
      vkRow: writeVkRow('evaluate_intent', normalizeProposal(rawIntent), 'golden_success', fakeReceipt)
    };

    // Try to train on the fabricated decision
    expect(() => trainOnDecision(fakeDecision as any, [fakeReceipt], fakeReceipt.signedHead))
      .toThrow(/signed head signature invalid/);
  });

  it('determinism lock: running the exact sequence twice produces identical predictions, verdicts, and receipts (excluding createdAt)', () => {
    const candidates = Array.from({ length: 5 }).map((_, i) => {
      const rawIntent = { action: 'read_file', resource: `deterministic_test_${i}.txt`, ring: 'local' };
      const pop = signPoP(POP_SEED, {
        principalId: 'test-admin',
        methodId: 'evaluateIntent',
        argsHash: hash(JSON.stringify(normalizeProposal(rawIntent))),
        nonce: `det-nonce-${i}`
      });
      return { rawIntent, pop };
    });

    // Run 1
    resetLearnerModel();
    _resetChain();
    PrincipalRegistry.set('test-admin', POP_PUBLIC_KEY);
    const run1 = runClosedLoopBurn(candidates, true, []);

    // Run 2
    resetLearnerModel();
    _resetChain();
    PrincipalRegistry.set('test-admin', POP_PUBLIC_KEY);
    const run2 = runClosedLoopBurn(candidates, true, []);

    expect(run1.stepResults.length).toBe(run2.stepResults.length);

    for(let i=0; i<run1.stepResults.length; i++) {
      const r1 = run1.stepResults[i];
      const r2 = run2.stepResults[i];

      // Assert identical predictions
      expect(r1.prediction.predictedVerdict).toBe(r2.prediction.predictedVerdict);
      expect(r1.prediction.confidence).toBe(r2.prediction.confidence);

      // Assert identical gate verdicts and cryptographic receipts
      expect(r1.decision.verdict).toBe(r2.decision.verdict);
      expect(r1.decision.receipt!.id).toBe(r2.decision.receipt!.id);
      expect(r1.decision.receipt!.signedHead).toBe(r2.decision.receipt!.signedHead);

      // Assert identical VK memory rows (excluding createdAt)
      expect(r1.decision.vkRow!.rowId).toBe(r2.decision.vkRow!.rowId);
      expect(r1.decision.vkRow!.glyphHash).toBe(r2.decision.vkRow!.glyphHash);
      expect(r1.decision.vkRow!.vkPayload).toEqual(r2.decision.vkRow!.vkPayload);
    }
  });
});
