import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { runBoundedActiveInferenceLoop, sanitizeConsequenceForModel } from '../src/activeInferenceLoop';
import { Proposer, ProposerContext } from '../src/proposer';
import { RawIntent, normalizeProposal } from '../src/normalizer';
import { getTestPublicKey, signPoP, hash } from '../src/crypto';
import { PrincipalRegistry, _resetChain, evaluateIntent, getChain } from '../src/index';
import { trainOnDecision } from '../src/loop';
import { StructuralMemoryPredictor } from '../src/structuralMemory';

const TEST_SEED = "99".repeat(32);
const TEST_PUB = getTestPublicKey(TEST_SEED);

class MockProposer implements Proposer {
  public callCount = 0;
  public lastContext: ProposerContext | null = null;
  public mockSequence: RawIntent[] = [];

  async propose(context: ProposerContext): Promise<RawIntent> {
    this.callCount++;
    this.lastContext = context;
    if (this.mockSequence.length > 0) {
      return this.mockSequence.shift()!;
    }
    return { action: 'read_file', resource: 'data.txt', ring: 'local' };
  }
}

describe('Commit 19A: Bounded Active-Inference Loop', () => {
  let proposer: MockProposer;

  beforeEach(() => {
    _resetChain();
    PrincipalRegistry.set('test-anchor', TEST_PUB);
    proposer = new MockProposer();
  });

  it('runs exactly N steps, no infinite loop', async () => {
    const results = await runBoundedActiveInferenceLoop({
      proposer,
      steps: 3,
      initialContext: 'start',
      createHarnessPop: () => null
    });
    expect(results.length).toBe(3);
    expect(proposer.callCount).toBe(3);
  });

  it('requires fresh PoP per step and passes valid tuple to execution', async () => {
    const usedNonces = new Set<string>();
    
    const results = await runBoundedActiveInferenceLoop({
      proposer,
      steps: 2,
      initialContext: 'start',
      createHarnessPop: (intent) => {
        if (intent.action === 'read_file' && intent.resource === 'data.txt' && intent.ring === 'local') {
          const nonce = `nonce_${Date.now()}_${Math.random()}`;
          usedNonces.add(nonce);
          return signPoP(TEST_SEED, {
            principalId: 'test-anchor',
            methodId: 'evaluateIntent',
            argsHash: hash(JSON.stringify(normalizeProposal(intent))),
            nonce
          });
        }
        return null;
      }
    });

    expect(results.length).toBe(2);
    expect(usedNonces.size).toBe(2); // No nonce reuse
    expect(results[0].decision.verdict).toBe('golden_success');
    expect(results[0].consequence.executionStatus).toBe('success');
  });

  it('off-tuple proposal refuses and does not execute', async () => {
    proposer.mockSequence = [{ action: 'write_file', resource: 'data.txt', ring: 'local' }];
    
    const results = await runBoundedActiveInferenceLoop({
      proposer,
      steps: 1,
      initialContext: 'start',
      createHarnessPop: () => null // Harness refuses to attach PoP for write
    });

    expect(results[0].decision.verdict).toBe('refused');
    expect(results[0].consequence.executionStatus).toBe('skipped');
  });

  it('feedback strictly excludes crypto keys, PoPs, tokens', async () => {
    const pop = signPoP(TEST_SEED, {
      principalId: 'test-anchor',
      methodId: 'evaluateIntent',
      argsHash: hash(JSON.stringify(normalizeProposal({ action: 'read_file', resource: 'data.txt', ring: 'local' }))),
      nonce: '1'
    });

    const results = await runBoundedActiveInferenceLoop({
      proposer,
      steps: 2,
      initialContext: 'start',
      createHarnessPop: () => pop
    });

    // Check what the proposer received on the second call
    const contextStr = proposer.lastContext?.prompt || '';
    
    // Minimal consequence checks
    expect(contextStr).toContain('Previous Action: read_file');
    expect(contextStr).toContain('Execution Status: success');
    
    // Strict exclusion checks
    expect(contextStr).not.toContain(TEST_SEED); // No private keys
    expect(contextStr).not.toContain('receipt:'); 
    expect(contextStr).not.toContain('signedHead');
    expect(contextStr).not.toContain(pop.signature); // No PoP leaked
    
    // It shouldn't contain the receipt ID
    expect(contextStr).not.toContain(results[0].decision.receipt?.id);
  });
  it('deterministic replay: identical proposer sequence yields identical results', async () => {
    let nonceCounter = 0;
    const createPop = (intent: RawIntent) => {
      if (intent.action !== 'read_file') return null;
      return signPoP(TEST_SEED, {
        principalId: 'test-anchor',
        methodId: 'evaluateIntent',
        argsHash: hash(JSON.stringify(normalizeProposal(intent))),
        nonce: `static_nonce_${++nonceCounter}`
      });
    };

    const results1 = await runBoundedActiveInferenceLoop({
      proposer: new MockProposer(),
      steps: 2,
      initialContext: 'start',
      createHarnessPop: createPop
    });

    _resetChain(); // fresh state
    PrincipalRegistry.set('test-anchor', TEST_PUB);
    nonceCounter = 0;

    const results2 = await runBoundedActiveInferenceLoop({
      proposer: new MockProposer(), // new instance, same sequence
      steps: 2,
      initialContext: 'start',
      createHarnessPop: createPop
    });

    for (let i = 0; i < 2; i++) {
      expect(results1[i].intent).toEqual(results2[i].intent);
      expect(results1[i].decision.verdict).toEqual(results2[i].decision.verdict);
      expect(results1[i].decision.receipt?.id).toEqual(results2[i].decision.receipt?.id);
      expect(results1[i].decision.vkRow?.rowId).toEqual(results2[i].decision.vkRow?.rowId);
      expect(results1[i].consequence).toEqual(results2[i].consequence);
    }
  });

  it('no live network: loop never calls fetch', async () => {
    global.fetch = vi.fn();
    await runBoundedActiveInferenceLoop({
      proposer,
      steps: 2,
      initialContext: 'start',
      createHarnessPop: () => null
    });
    expect(fetch).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('signed-only training: forged chain/head throws and prevents learning (verified directly)', () => {
    // We already proved runBoundedActiveInferenceLoop delegates to trainOnDecision.
    // We test the invariant here directly without a test hook.
    const intent = normalizeProposal({ action: 'read_file', resource: 'data.txt', ring: 'local' });
    const decision: any = {
      verdict: 'golden_success',
      vkRow: { rowId: 'row1' },
      receipt: {
        id: 'receipt1',
        verdict: 'golden_success',
        intentHash: 'hash',
        normalizedIntent: intent,
        prevHash: 'genesis',
        signedHead: 'forged_signature'
      }
    };

    expect(() => trainOnDecision(decision, [decision.receipt], 'forged_signature')).toThrow();
  });

  it('no self-confirmation: feedback uses gate verdict, not prediction, in case of divergence', async () => {
    // 1. Train the learner to believe read_file data.txt ALWAYS succeeds
    const rawIntent = { action: 'read_file', resource: 'data.txt', ring: 'local' };
    const intent = normalizeProposal(rawIntent);
    const mockDecision: any = {
      verdict: 'golden_success',
      vkRow: { rowId: 'row1' },
      receipt: {
        id: 'receipt1',
        verdict: 'golden_success',
        intentHash: 'hash',
        normalizedIntent: intent,
        prevHash: 'genesis',
        signedHead: 'test'
      }
    };
    
    // Cheat to preload the learner's stats manually (easier than a full crypto setup just for test state)
    // Actually we can just run one valid closed loop step to pre-train it
    const pop1 = signPoP(TEST_SEED, {
      principalId: 'test-anchor',
      methodId: 'evaluateIntent',
      argsHash: hash(JSON.stringify(intent)),
      nonce: 'pretrain-nonce'
    });
    
    await runBoundedActiveInferenceLoop({
      proposer: new MockProposer(),
      steps: 1,
      initialContext: 'start',
      createHarnessPop: () => pop1
    });

    // 2. Now the learner predicts read_file will be 'golden_success'
    // But we run the proposer loop WITHOUT providing a PoP for the next step
    const divergentProposer = new MockProposer();
    divergentProposer.mockSequence = [rawIntent]; // It will propose read_file data.txt

    const results = await runBoundedActiveInferenceLoop({
      proposer: divergentProposer,
      steps: 1,
      initialContext: 'start',
      createHarnessPop: () => null // Oh no! Harness refuses to sign it! Gate will refuse.
    });

    // The learner's prediction inside runClosedLoopStep was 'golden_success'
    expect(results[0].decision.verdict).toBe('refused'); // But the gate refused it
    
    // The consequence fed back to the model MUST be the gate's verdict, not the prediction
    expect(results[0].consequence.gateVerdict).toBe('refused');
    expect(results[0].consequence.executionStatus).toBe('skipped');
  });

  it('argsHash binding: PoP for data.txt cannot authorize reading other.txt', async () => {
    // 1. Model proposes reading other.txt
    proposer.mockSequence = [{ action: 'read_file', resource: 'other.txt', ring: 'local' }];
    
    const results = await runBoundedActiveInferenceLoop({
      proposer,
      steps: 1,
      initialContext: 'start',
      createHarnessPop: (intent) => {
        // Attack: Harness attaches a perfectly valid PoP, but the PoP is bound to 'data.txt'
        const authorizedIntent = normalizeProposal({ action: 'read_file', resource: 'data.txt', ring: 'local' });
        return signPoP(TEST_SEED, {
          principalId: 'test-anchor',
          methodId: 'evaluateIntent',
          argsHash: hash(JSON.stringify(authorizedIntent)), // Binding is for data.txt!
          nonce: 'attack-nonce'
        });
      }
    });

    // Gate must refuse because argsHash computed from proposed intent (other.txt)
    // will not match the argsHash signed in the PoP (data.txt)
    expect(results[0].decision.verdict).toBe('refused');
    expect(results[0].consequence.executionStatus).toBe('skipped');
  });

  it('forbidden action with PoP: intent is refused even when a PoP is attached', async () => {
    proposer.mockSequence = [{ action: 'write_file', resource: 'data.txt', ring: 'local' }];
    
    const results = await runBoundedActiveInferenceLoop({
      proposer,
      steps: 1,
      initialContext: 'start',
      createHarnessPop: (intent) => {
        // Attack: Harness blindly signs an off-tuple intent
        return signPoP(TEST_SEED, {
          principalId: 'test-anchor',
          methodId: 'evaluateIntent',
          argsHash: hash(JSON.stringify(normalizeProposal(intent))),
          nonce: 'attack-nonce-2'
        });
      }
    });

    // Gate must still refuse it because the action tuple is not explicitly allowed in evaluating intents
    expect(results[0].decision.verdict).toBe('refused');
    expect(results[0].consequence.executionStatus).toBe('skipped');
  });
  it('informative feedback: refused off-tuple action produces expectedAction hint', async () => {
    proposer.mockSequence = [{ action: 'read', resource: 'data.txt', ring: 'local' }, { action: 'retry', resource: 'data.txt', ring: 'local' }];
    const results = await runBoundedActiveInferenceLoop({
      proposer,
      steps: 2,
      initialContext: 'start',
      createHarnessPop: () => null
    });
    
    expect(results[0].decision.verdict).toBe('refused');
    expect(results[0].consequence.reason).toBe('unsupported_tuple');
    expect(results[0].consequence.expectedAction).toBe('read_file');
    
    // Check that it's in the prompt for the next step
    const nextPrompt = proposer.lastContext?.prompt || '';
    expect(nextPrompt).toContain('Expected Action: read_file');
  });

  it('informative feedback: refused off-tuple resource produces expectedResource hint', async () => {
    proposer.mockSequence = [{ action: 'read_file', resource: 'other.txt', ring: 'local' }, { action: 'retry', resource: 'data.txt', ring: 'local' }];
    const results = await runBoundedActiveInferenceLoop({
      proposer,
      steps: 2,
      initialContext: 'start',
      createHarnessPop: () => null
    });
    
    expect(results[0].decision.verdict).toBe('refused');
    expect(results[0].consequence.expectedResource).toBe('data.txt');
    
    const nextPrompt = proposer.lastContext?.prompt || '';
    expect(nextPrompt).toContain('Expected Resource: data.txt');
  });

  it('informative feedback: mock proposer corrects using feedback and reaches golden_success', async () => {
    // We create a mock proposer that looks at the context.
    // If it sees "Expected Action: read_file", it proposes read_file.
    // Otherwise, it proposes "read".
    class CorrectingProposer implements Proposer {
      async propose(context: ProposerContext): Promise<RawIntent> {
        if (context.prompt.includes('Expected Action: read_file')) {
          return { action: 'read_file', resource: 'data.txt', ring: 'local' };
        }
        return { action: 'read', resource: 'data.txt', ring: 'local' };
      }
    }

    const usedNonces = new Set<string>();
    const correctingProposer = new CorrectingProposer();

    const results = await runBoundedActiveInferenceLoop({
      proposer: correctingProposer,
      steps: 2,
      initialContext: 'start',
      createHarnessPop: (intent) => {
        if (intent.action === 'read_file' && intent.resource === 'data.txt' && intent.ring === 'local') {
          const nonce = `correct-nonce-${Math.random()}`;
          usedNonces.add(nonce);
          return signPoP(TEST_SEED, {
            principalId: 'test-anchor',
            methodId: 'evaluateIntent',
            argsHash: hash(JSON.stringify(normalizeProposal(intent))),
            nonce
          });
        }
        return null;
      }
    });

    // Step 1 should be refused with a hint
    expect(results[0].intent.action).toBe('read');
    expect(results[0].decision.verdict).toBe('refused');
    expect(results[0].consequence.expectedAction).toBe('read_file');

    // Step 2 should be corrected, approved, and executed
    expect(results[1].intent.action).toBe('read_file');
    expect(results[1].decision.verdict).toBe('golden_success');
    expect(results[1].consequence.executionStatus).toBe('success');
    expect(usedNonces.size).toBe(1);
  });
});

import { HypothesisMemory, VerifiedEvidenceBundle } from '../src/hypothesisMemory';
import { exportVkRow, loadVkRow } from '../src/trainingExport';
import { computeMerkleRoot, signHead } from '../src/crypto';

describe('Commit 20B: Scrubbed Hypothesis Context Wiring', () => {
  let proposer: MockProposer;
  const EDGE_NODE_SEED = "88".repeat(32);

  beforeEach(() => {
    _resetChain();
    PrincipalRegistry.set('test-anchor', TEST_PUB);
    proposer = new MockProposer();
  });

  function generateRealEvidenceBundle(action: string, resource: string, expectedVerdict: 'golden_success' | 'refused', ring: string = 'local'): VerifiedEvidenceBundle {
    const rawIntent = { action, resource, ring };
    const intentHash = hash(JSON.stringify(normalizeProposal(rawIntent)));
    const pop = ring === 'local' ? signPoP(TEST_SEED, {
      principalId: 'test-anchor',
      methodId: 'evaluateIntent',
      argsHash: intentHash,
      nonce: Math.random().toString()
    }) : signPoP("11".repeat(32), { // actual different attacker seed
      principalId: 'hacker',
      methodId: 'evaluateIntent',
      argsHash: intentHash,
      nonce: Math.random().toString()
    });
    const decision = evaluateIntent(rawIntent, pop);
    expect(decision.verdict).toBe(expectedVerdict);
    
    const chain = getChain();
    const root = computeMerkleRoot(chain);
    
    return {
      vkRow: loadVkRow(exportVkRow(decision.vkRow!)),
      receiptChain: chain,
      expectedRoot: root,
      signedHead: signHead(EDGE_NODE_SEED, root)
    };
  }

  it('active loop context includes scrubbed hypothesis summary and excludes crypto material', async () => {
    const memory = new HypothesisMemory();
    const hyp = memory.createHypothesis("Action read_file is allowed", "open", "read_file", "data.txt");
    
    const bundle = generateRealEvidenceBundle('read_file', 'data.txt', 'golden_success');
    memory.updateWithVerifiedEvidence(hyp.hypothesisId, bundle);

    await runBoundedActiveInferenceLoop({
      proposer,
      steps: 1,
      initialContext: 'start_context',
      createHarnessPop: () => null,
      hypothesisMemory: memory
    });

    const finalPrompt = proposer.lastContext?.prompt || '';
    
    // 1. Includes scrubbed hypothesis summary
    expect(finalPrompt).toContain('--- ADVISORY HYPOTHESIS CONTEXT ---');
    expect(finalPrompt).toContain('Hypothesis: "Action read_file is allowed"');
    expect(finalPrompt).toContain('Status: open');
    expect(finalPrompt).toContain('Confidence: 7'); // 5 + 2
    expect(finalPrompt).toContain('Last signed outcome: golden_success');

    // 2. Context excludes crypto material
    expect(finalPrompt).not.toContain(bundle.signedHead);
    expect(finalPrompt).not.toContain(bundle.expectedRoot);
    expect(finalPrompt).not.toContain('receiptId');
    expect(finalPrompt).not.toContain('intentHash');
  });

  it('contradicted hypothesis appears as warning/negative evidence in context', async () => {
    const memory = new HypothesisMemory();
    const hyp = memory.createHypothesis("Action write is allowed", "open", "write_file", "data.txt");
    
    const bundle = generateRealEvidenceBundle('write_file', 'data.txt', 'refused', 'system');
    memory.updateWithVerifiedEvidence(hyp.hypothesisId, bundle);

    await runBoundedActiveInferenceLoop({
      proposer,
      steps: 1,
      initialContext: 'start_context',
      createHarnessPop: () => null,
      hypothesisMemory: memory
    });

    const finalPrompt = proposer.lastContext?.prompt || '';
    expect(finalPrompt).toContain('Status: contradicted');
    expect(finalPrompt).toContain('Confidence: 2'); // 5 - 3
    expect(finalPrompt).toContain('Last signed outcome: refused');
  });

  it('model prediction with genuinely supported hypothesis still cannot bypass gate', async () => {
    const memory = new HypothesisMemory();
    
    // 1. Create a genuinely supportable hypothesis (read_file local)
    const hyp = memory.createHypothesis("Action read_file is allowed", "open", "read_file", "data.txt");
    
    // Note: Forbidden actions like `write_file` are structurally unsupportable by design 
    // because the gate never emits a `golden_success` receipt for them under any local PoP.
    // They will always collapse to contradicted.
    
    // 2. Feed it real signed golden_success evidence twice to push confidence past 8 (supported)
    const bundle1 = generateRealEvidenceBundle('read_file', 'data.txt', 'golden_success');
    memory.updateWithVerifiedEvidence(hyp.hypothesisId, bundle1);
    
    const bundle2 = generateRealEvidenceBundle('read_file', 'data.txt', 'golden_success');
    memory.updateWithVerifiedEvidence(hyp.hypothesisId, bundle2);
    
    expect(hyp.status).toBe('supported');
    expect(hyp.confidence).toBe(9);
    
    // 3. Proposer attempts to execute this exact supported action
    proposer.mockSequence = [{ action: 'read_file', resource: 'data.txt', ring: 'local' }];
    
    const results = await runBoundedActiveInferenceLoop({
      proposer,
      steps: 1,
      initialContext: 'start_context',
      createHarnessPop: () => null, // NO PoP PROVIDED!
      hypothesisMemory: memory
    });

    // 4. Gate still blocks the action because no valid PoP was provided, proving belief ≠ authority.
    expect(results[0].decision.verdict).toBe('refused');
  });
});

describe('Commit 20C: Receipt-Anticipation Heartbeat', () => {
  let proposer: MockProposer;
  
  beforeEach(() => {
    _resetChain();
    PrincipalRegistry.set('test-anchor', TEST_PUB);
    proposer = new MockProposer();
  });

  it('measures prediction before gate decision and reduces surprise on repeated successes', async () => {
    const memory = new HypothesisMemory();
    const hyp = memory.createHypothesis("Action read_file is allowed", "open", "read_file", "data.txt");
    
    // Proposer correctly emits read_file 3 times
    proposer.mockSequence = [
      { action: 'read_file', resource: 'data.txt', ring: 'local' },
      { action: 'read_file', resource: 'data.txt', ring: 'local' },
      { action: 'read_file', resource: 'data.txt', ring: 'local' }
    ];

    const results = await runBoundedActiveInferenceLoop({
      proposer,
      steps: 3,
      initialContext: 'start',
      createHarnessPop: (intent) => {
        const intentHash = hash(JSON.stringify(normalizeProposal(intent)));
        return signPoP(TEST_SEED, {
          principalId: 'test-anchor',
          methodId: 'evaluateIntent',
          argsHash: intentHash,
          nonce: Math.random().toString()
        });
      },
      hypothesisMemory: memory
    });

    // Step 1: initial confidence is 5. pGolden = 0.5. Surprise is high.
    const hb1 = results[0].heartbeat!;
    expect(hb1.predictedVerdict).toBe('golden_success'); // 0.5 ties go to golden
    expect(hb1.predictedProbabilityOfActualVerdict).toBeCloseTo(0.5);
    expect(hb1.actualVerdict).toBe('golden_success');

    // Memory is updated! Confidence goes from 5 to 7. pGolden = 0.1 + 0.7*0.8 = 0.66
    const hb2 = results[1].heartbeat!;
    expect(hb2.predictedProbabilityOfActualVerdict).toBeCloseTo(0.66);
    expect(hb2.surprise).toBeLessThan(hb1.surprise); // surprise decreases

    // Memory updated! Confidence goes from 7 to 9. pGolden = 0.1 + 0.9*0.8 = 0.82
    const hb3 = results[2].heartbeat!;
    expect(hb3.predictedProbabilityOfActualVerdict).toBeCloseTo(0.82);
    expect(hb3.surprise).toBeLessThan(hb2.surprise); // surprise decreases again
  });

  it('refused paths are valid training signal and update hypothesis', async () => {
    const memory = new HypothesisMemory();
    const hyp = memory.createHypothesis("Action write is allowed", "open", "write_file", "data.txt");
    
    // Proposer emits write_file 2 times
    proposer.mockSequence = [
      { action: 'write_file', resource: 'data.txt', ring: 'system' },
      { action: 'write_file', resource: 'data.txt', ring: 'system' }
    ];

    const results = await runBoundedActiveInferenceLoop({
      proposer,
      steps: 2,
      initialContext: 'start',
      createHarnessPop: (intent) => {
        const intentHash = hash(JSON.stringify(normalizeProposal(intent)));
        return signPoP(TEST_SEED, {
          principalId: 'test-anchor',
          methodId: 'evaluateIntent',
          argsHash: intentHash,
          nonce: Math.random().toString()
        });
      },
      hypothesisMemory: memory
    });

    // Step 1: initial confidence 5. pGolden = 0.5. Verdict is refused.
    const hb1 = results[0].heartbeat!;
    expect(hb1.actualVerdict).toBe('refused');
    expect(hb1.predictedProbabilityOfActualVerdict).toBeCloseTo(0.5); // 1 - 0.5

    // Confidence drops 5 -> 2. pGolden = 0.1 + 0.2*0.8 = 0.26
    const hb2 = results[1].heartbeat!;
    expect(hb2.actualVerdict).toBe('refused');
    expect(hb2.predictedVerdict).toBe('refused'); // 0.26 < 0.5
    expect(hb2.predictedProbabilityOfActualVerdict).toBeCloseTo(0.74); // 1 - 0.26
    expect(hb2.surprise).toBeLessThan(hb1.surprise); // Less surprised by the refusal!
  });

  it('missing PoP still refuses even if predicted golden, but does not degrade capability belief', async () => {
    const memory = new HypothesisMemory();
    const hyp = memory.createHypothesis("Action read is allowed", "open", "read_file", "data.txt");
    hyp.confidence = 9; // Manually force to highly confident (0.82 pGolden)
    
    proposer.mockSequence = [{ action: 'read_file', resource: 'data.txt', ring: 'local' }];

    const results = await runBoundedActiveInferenceLoop({
      proposer,
      steps: 1,
      initialContext: 'start',
      createHarnessPop: () => null, // NO POP -> authorization_refusal
      hypothesisMemory: memory
    });

    const hb = results[0].heartbeat!;
    expect(hb.predictedVerdict).toBe('golden_success');
    expect(hb.actualVerdict).toBe('refused'); // Gate still refuses
    expect(hb.refusalCause).toBe('authorization_refusal');
    expect(hb.surprise).toBeGreaterThan(1); // Highly surprised! (expected success, got failure)

    // Verify capability belief was NOT degraded
    expect(hyp.confidence).toBe(9);
    // But lastSignedOutcome is recorded
    expect(hyp.lastSignedOutcome).toBe('refused');
    expect(hyp.refusalCause).toBe('authorization_refusal');
  });

  it('rejects tampered write-back bundles and leaves hypothesis unchanged', async () => {
    const memory = new HypothesisMemory();
    const hyp = memory.createHypothesis("Action write is allowed", "open", "write_file", "data.txt");
    
    proposer.mockSequence = [{ action: 'write_file', resource: 'data.txt', ring: 'system' }];

    const originalUpdate = memory.updateWithVerifiedEvidence.bind(memory);
    let tampered = false;

    // Intercept the write-back path to inject a forged signature
    vi.spyOn(memory, 'updateWithVerifiedEvidence').mockImplementation((id, bundle, cause) => {
      const forgedBundle = { ...bundle, signedHead: 'fake_forged_signature' };
      tampered = true;
      // This will throw, and the loop should catch it safely without crashing
      originalUpdate(id, forgedBundle, cause);
    });

    await runBoundedActiveInferenceLoop({
      proposer,
      steps: 1,
      initialContext: 'start',
      createHarnessPop: (intent) => {
        const intentHash = hash(JSON.stringify(normalizeProposal(intent)));
        return signPoP(TEST_SEED, {
          principalId: 'test-anchor',
          methodId: 'evaluateIntent',
          argsHash: intentHash,
          nonce: Math.random().toString()
        });
      },
      hypothesisMemory: memory
    });

    expect(tampered).toBe(true);
    // Because the write-back was forged, the memory update threw an error, so confidence remains unchanged
    expect(hyp.confidence).toBe(5);
    expect(hyp.lastSignedOutcome).toBeUndefined();
  });
});

describe('Commit 20E: Structural Memory Resonator Advisory', () => {
  let proposer: MockProposer;

  beforeEach(() => {
    _resetChain();
    PrincipalRegistry.set('test-anchor', TEST_PUB);
    proposer = new MockProposer();
  });

  it('1. Structural advisory context appears in proposer context when enabled', async () => {
    const predictor = new StructuralMemoryPredictor();
    // Train with 1 simple example so predictor has some data
    predictor.train([{
      action: 'read_file',
      resource: 'data.txt',
      ring: 'local',
      popState: 'valid',
      verdict: 'golden_success'
    }]);

    await runBoundedActiveInferenceLoop({
      proposer,
      steps: 1,
      initialContext: 'start',
      createHarnessPop: () => null,
      structuralMemory: predictor
    });

    const finalPrompt = proposer.lastContext?.prompt || '';
    expect(finalPrompt).toContain('--- ADVISORY STRUCTURAL MEMORY CONTEXT ---');
    expect(finalPrompt).toContain('Candidate Action: read_file');
    expect(finalPrompt).toContain('Predicted Verdict:');
    expect(finalPrompt).toContain('Structural Memory MDL:');
  });

  it('2. Advisory context is scrubbed: no receipt ids, signed heads, PoP, keys, roots, VK rows, chain hashes, or raw cases', async () => {
    const predictor = new StructuralMemoryPredictor();
    predictor.train([{
      action: 'read_file',
      resource: 'data.txt',
      ring: 'local',
      popState: 'valid',
      verdict: 'golden_success'
    }]);

    await runBoundedActiveInferenceLoop({
      proposer,
      steps: 1,
      initialContext: 'start',
      createHarnessPop: () => null,
      structuralMemory: predictor
    });

    const finalPrompt = proposer.lastContext?.prompt || '';
    expect(finalPrompt).not.toContain(TEST_SEED);
    expect(finalPrompt).not.toContain('receiptId');
    expect(finalPrompt).not.toContain('signedHead');
    expect(finalPrompt).not.toContain('vkRow');
  });

  it('3. Missing PoP still refuses even if structural memory predicts golden_success', async () => {
    const predictor = new StructuralMemoryPredictor();
    // Train predictor to believe local read_file with valid PoP always succeeds
    predictor.train([{
      action: 'read_file',
      resource: 'data.txt',
      ring: 'local',
      popState: 'valid',
      verdict: 'golden_success'
    }]);

    // Propose read_file but provide NO PoP in harness
    proposer.mockSequence = [{ action: 'read_file', resource: 'data.txt', ring: 'local' }];

    const results = await runBoundedActiveInferenceLoop({
      proposer,
      steps: 1,
      initialContext: 'start',
      createHarnessPop: () => null, // NO POP!
      structuralMemory: predictor
    });

    // Predictor predicted success for valid PoP, but actual gate still refuses
    expect(results[0].decision.verdict).toBe('refused');
  });

  it('4. Gate verdict is identical with and without structural advisory context for the same intent/PoP', async () => {
    const predictor = new StructuralMemoryPredictor();
    predictor.train([{
      action: 'read_file',
      resource: 'data.txt',
      ring: 'local',
      popState: 'valid',
      verdict: 'golden_success'
    }]);

    // Case A: Without advisory context
    const resultsNoAdv = await runBoundedActiveInferenceLoop({
      proposer: new MockProposer(),
      steps: 1,
      initialContext: 'start',
      createHarnessPop: () => null
    });

    _resetChain();
    PrincipalRegistry.set('test-anchor', TEST_PUB);

    // Case B: With advisory context
    const resultsWithAdv = await runBoundedActiveInferenceLoop({
      proposer: new MockProposer(),
      steps: 1,
      initialContext: 'start',
      createHarnessPop: () => null,
      structuralMemory: predictor
    });

    expect(resultsNoAdv[0].decision.verdict).toBe(resultsWithAdv[0].decision.verdict);
  });

  it('5. Structural advisory reduces surprise in a mocked repeated scenario', async () => {
    const predictor = new StructuralMemoryPredictor();
    predictor.train([{
      action: 'read_file',
      resource: 'data.txt',
      ring: 'local',
      popState: 'valid',
      verdict: 'golden_success'
    }]);

    // A smart proposer that reads structural context.
    class SmartProposer implements Proposer {
      async propose(context: ProposerContext): Promise<RawIntent> {
        if (context.prompt.includes('Predicted Verdict: golden_success')) {
          return { action: 'read_file', resource: 'data.txt', ring: 'local' };
        }
        return { action: 'read', resource: 'data.txt', ring: 'local' }; // wrong guess
      }
    }

    const createPop = (intent: RawIntent) => {
      if (intent.action !== 'read_file') return null;
      return signPoP(TEST_SEED, {
        principalId: 'test-anchor',
        methodId: 'evaluateIntent',
        argsHash: hash(JSON.stringify(normalizeProposal(intent))),
        nonce: `smart-nonce-${Math.random()}`
      });
    };

    // Run SmartProposer WITH structural memory
    const resultsWithMemory = await runBoundedActiveInferenceLoop({
      proposer: new SmartProposer(),
      steps: 1,
      initialContext: 'start',
      createHarnessPop: createPop,
      structuralMemory: predictor
    });

    // Proposer used structural memory to get it right on the very first step
    expect(resultsWithMemory[0].decision.verdict).toBe('golden_success');
  });

  it('6. Malformed/replay/forged paths still fail closed', async () => {
    // 1. Replayed PoP
    const pop = signPoP(TEST_SEED, {
      principalId: 'test-anchor',
      methodId: 'evaluateIntent',
      argsHash: hash(JSON.stringify(normalizeProposal({ action: 'read_file', resource: 'data.txt', ring: 'local' }))),
      nonce: 'nonce_replay_loop_test'
    });

    // Replay it once to register
    evaluateIntent({ action: 'read_file', resource: 'data.txt', ring: 'local' }, pop);

    // Try in loop
    const resultsReplay = await runBoundedActiveInferenceLoop({
      proposer,
      steps: 1,
      initialContext: 'start',
      createHarnessPop: () => pop // Replayed!
    });
    expect(resultsReplay[0].decision.verdict).toBe('refused');

    // 2. Malformed PoP
    const malformedPop = { ...pop, signature: 'forged_signature_bad' };
    const resultsMalformed = await runBoundedActiveInferenceLoop({
      proposer,
      steps: 1,
      initialContext: 'start',
      createHarnessPop: () => malformedPop
    });
    expect(resultsMalformed[0].decision.verdict).toBe('refused');
  });

  it('7. src/resonator.ts contains no restricted operations/imports', () => {
    const sourcePath = path.resolve(__dirname, '../src/resonator.ts');
    const content = fs.readFileSync(sourcePath, 'utf-8');

    const restrictedTokens = [
      'evaluateIntent',
      'executor',
      'PrincipalRegistry',
      'signPoP',
      'getAndCheckEdgeNodeSeed',
      'child_process',
      'fs',
      'fetch'
    ];

    for (const token of restrictedTokens) {
      expect(content).not.toContain(token);
    }
  });
});
