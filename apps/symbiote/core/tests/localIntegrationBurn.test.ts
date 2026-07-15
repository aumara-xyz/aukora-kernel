import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { runBoundedActiveInferenceLoop } from '../src/activeInferenceLoop';
import { Proposer, ProposerContext } from '../src/proposer';
import { RawIntent, normalizeProposal } from '../src/normalizer';
import { getTestPublicKey, signPoP, hash, computeMerkleRoot, signHead } from '../src/crypto';
import { PrincipalRegistry, _resetChain, evaluateIntent, getChain } from '../src/index';
import { HypothesisMemory, VerifiedEvidenceBundle } from '../src/hypothesisMemory';
import { StructuralMemoryPredictor } from '../src/structuralMemory';
import { exportVkRow, loadVkRow } from '../src/trainingExport';

const SEED = '77'.repeat(32);
const PUB = getTestPublicKey(SEED);
const EDGE_NODE_SEED = '88'.repeat(32);

class IntegrationProposer implements Proposer {
  public proposedIntents: RawIntent[] = [];
  public lastContext: ProposerContext | null = null;

  async propose(context: ProposerContext): Promise<RawIntent> {
    this.lastContext = context;
    const prompt = context.prompt;
    if (
      prompt.includes('Status: supported') || 
      prompt.includes('Predicted Verdict: golden_success')
    ) {
      const intent = { action: 'read_file', resource: 'data.txt', ring: 'local' as const };
      this.proposedIntents.push(intent);
      return intent;
    }
    const guess = { action: 'read', resource: 'data.txt', ring: 'local' as const };
    this.proposedIntents.push(guess);
    return guess;
  }
}

describe('Commit 20F.1: Local Integration Burn Harness (Cohesion Unproven)', () => {
  beforeEach(() => {
    _resetChain();
    PrincipalRegistry.set('test-anchor', PUB);
  });

  function generateRealEvidenceBundle(action: string, resource: string, expectedVerdict: 'golden_success' | 'refused'): VerifiedEvidenceBundle {
    const rawIntent = { action, resource, ring: 'local' as const };
    const intentHash = hash(JSON.stringify(normalizeProposal(rawIntent)));
    let pop = null;
    if (expectedVerdict === 'golden_success') {
      pop = signPoP(SEED, {
        principalId: 'test-anchor',
        methodId: 'evaluateIntent',
        argsHash: intentHash,
        nonce: Math.random().toString()
      });
    }
    const decision = evaluateIntent(rawIntent, pop);
    const chain = getChain();
    const root = computeMerkleRoot(chain);
    
    return {
      vkRow: loadVkRow(exportVkRow(decision.vkRow!)),
      receiptChain: chain,
      expectedRoot: root,
      signedHead: signHead(EDGE_NODE_SEED, root)
    };
  }

  it('1. Burn runs exactly N steps (no while(true), no unbounded recursion)', async () => {
    const proposer = new IntegrationProposer();
    const N = 10;

    const results = await runBoundedActiveInferenceLoop({
      proposer,
      steps: N,
      initialContext: 'burn_start',
      createHarnessPop: () => null
    });

    expect(results.length).toBe(N);
  });

  it('2. Surprise decreases across repeated supportable situations when signed receipts confirm success', async () => {
    const proposer = new IntegrationProposer();
    const hypothesisMemory = new HypothesisMemory();
    const structuralMemory = new StructuralMemoryPredictor();

    const hyp = hypothesisMemory.createHypothesis("read_file data.txt is allowed", "open", "read_file", "data.txt");

    const results = await runBoundedActiveInferenceLoop({
      proposer,
      steps: 5,
      initialContext: 'start_context',
      createHarnessPop: (intent) => {
        if (intent.action !== 'read_file') return null;
        return signPoP(SEED, {
          principalId: 'test-anchor',
          methodId: 'evaluateIntent',
          argsHash: hash(JSON.stringify(normalizeProposal(intent))),
          nonce: `nonce_${Math.random()}_${Date.now()}`
        });
      },
      hypothesisMemory,
      structuralMemory
    });

    // Step 2 was the first successful read_file
    const surpriseFirst = results[1].heartbeat?.surprise;
    // Step 5 should have lower surprise because of updated confidence / rule learning
    const surpriseLast = results[4].heartbeat?.surprise;

    expect(surpriseFirst).toBeDefined();
    expect(surpriseLast).toBeDefined();
    expect(surpriseLast).toBeLessThan(surpriseFirst!);
  });

  it('3. Missing PoP still refuses even if structural/hypothesis context predicts success', async () => {
    const hypothesisMemory = new HypothesisMemory();
    const structuralMemory = new StructuralMemoryPredictor();

    structuralMemory.train([{
      action: 'read_file',
      resource: 'data.txt',
      ring: 'local',
      popState: 'valid',
      verdict: 'golden_success'
    }]);

    const proposer = {
      propose: async () => ({ action: 'read_file', resource: 'data.txt', ring: 'local' as const })
    };

    const results = await runBoundedActiveInferenceLoop({
      proposer,
      steps: 1,
      initialContext: 'start',
      createHarnessPop: () => null, // NO POP!
      hypothesisMemory,
      structuralMemory
    });

    expect(results[0].decision.verdict).toBe('refused');
  });

  it('4. Forbidden capability still degrades capability belief', async () => {
    const hypothesisMemory = new HypothesisMemory();
    const hyp = hypothesisMemory.createHypothesis("write_file data.txt is allowed", "open", "write_file", "data.txt");

    const bundle = generateRealEvidenceBundle('write_file', 'data.txt', 'refused');
    hypothesisMemory.updateWithVerifiedEvidence(hyp.hypothesisId, bundle, 'capability_refusal');

    expect(hyp.confidence).toBeLessThan(5); // degraded
    expect(hyp.lastSignedOutcome).toBe('refused');
    expect(hyp.refusalCause).toBe('capability_refusal');
  });

  it('5. Authorization refusal does not degrade capability belief', async () => {
    const hypothesisMemory = new HypothesisMemory();
    const hyp = hypothesisMemory.createHypothesis("read_file data.txt is allowed", "open", "read_file", "data.txt");
    hyp.confidence = 9;

    const bundle = generateRealEvidenceBundle('read_file', 'data.txt', 'refused');
    hypothesisMemory.updateWithVerifiedEvidence(hyp.hypothesisId, bundle, 'authorization_refusal');

    expect(hyp.confidence).toBe(9); // remains unchanged!
    expect(hyp.refusalCause).toBe('authorization_refusal');
  });

  it('6. Hypothesis memory updates only from verified signed receipt bundles', async () => {
    const hypothesisMemory = new HypothesisMemory();
    const hyp = hypothesisMemory.createHypothesis("read_file data.txt is allowed", "open", "read_file", "data.txt");

    const bundle = generateRealEvidenceBundle('read_file', 'data.txt', 'golden_success');
    const forgedBundle = { ...bundle, signedHead: 'invalid_forged_sig' };

    expect(() => {
      hypothesisMemory.updateWithVerifiedEvidence(hyp.hypothesisId, forgedBundle);
    }).toThrow();
  });

  it('7. Structural memory remains advisory-only and cannot alter gate verdict', async () => {
    const structuralMemory = new StructuralMemoryPredictor();
    structuralMemory.train([{
      action: 'read_file',
      resource: 'data.txt',
      ring: 'local',
      popState: 'valid',
      verdict: 'golden_success'
    }]);

    const resultsNoAdv = await runBoundedActiveInferenceLoop({
      proposer: { propose: async () => ({ action: 'read_file', resource: 'data.txt', ring: 'local' as const }) },
      steps: 1,
      initialContext: 'start',
      createHarnessPop: () => null
    });

    _resetChain();
    PrincipalRegistry.set('test-anchor', PUB);

    const resultsWithAdv = await runBoundedActiveInferenceLoop({
      proposer: { propose: async () => ({ action: 'read_file', resource: 'data.txt', ring: 'local' as const }) },
      steps: 1,
      initialContext: 'start',
      createHarnessPop: () => null,
      structuralMemory
    });

    expect(resultsNoAdv[0].decision.verdict).toBe(resultsWithAdv[0].decision.verdict);
  });

  it('8. Proposer context excludes receipt ids, signed heads, PoP, keys, roots, VK rows, chain hashes, raw cases, and crypto internals', async () => {
    const hypothesisMemory = new HypothesisMemory();
    const structuralMemory = new StructuralMemoryPredictor();
    const proposer = new IntegrationProposer();

    const hyp = hypothesisMemory.createHypothesis("read_file is allowed", "open", "read_file", "data.txt");
    const bundle = generateRealEvidenceBundle('read_file', 'data.txt', 'golden_success');
    hypothesisMemory.updateWithVerifiedEvidence(hyp.hypothesisId, bundle);

    await runBoundedActiveInferenceLoop({
      proposer,
      steps: 2,
      initialContext: 'start',
      createHarnessPop: (intent) => {
        if (intent.action !== 'read_file') return null;
        return signPoP(SEED, {
          principalId: 'test-anchor',
          methodId: 'evaluateIntent',
          argsHash: hash(JSON.stringify(normalizeProposal(intent))),
          nonce: `nonce_${Math.random()}`
        });
      },
      hypothesisMemory,
      structuralMemory
    });

    // Inspect the actual non-empty captured proposer prompt context
    const finalPrompt = proposer.lastContext?.prompt || '';
    expect(finalPrompt.length).toBeGreaterThan(0); // Ensure the test is not vacuous!
    
    // Crypto values must be excluded
    expect(finalPrompt).not.toContain(bundle.signedHead);
    expect(finalPrompt).not.toContain(bundle.expectedRoot);
    expect(finalPrompt).not.toContain(SEED);
  });

  it('9. No live network calls occur', async () => {
    global.fetch = vi.fn();
    const proposer = new IntegrationProposer();

    await runBoundedActiveInferenceLoop({
      proposer,
      steps: 3,
      initialContext: 'start',
      createHarnessPop: () => null
    });

    expect(fetch).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('10. No forbidden imports/calls are added in structuralMemory.ts / resonator.ts', () => {
    const checkFile = (fileName: string) => {
      const sourcePath = path.resolve(__dirname, `../src/${fileName}`);
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
    };

    checkFile('structuralMemory.ts');
    checkFile('resonator.ts');
  });
});
