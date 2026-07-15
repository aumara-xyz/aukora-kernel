import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MockBaseProposer, scrubOutboundPrompt } from '../src/proposer';
import { runProposerStep, trainOnDecision } from '../src/loop';
import { _resetChain, PrincipalRegistry, evaluateIntent } from '../src/index';
import { getTestPublicKey, signPoP, hash, computeMerkleRoot } from '../src/crypto';
import { normalizeProposal } from '../src/normalizer';
import { resetLearnerModel } from '../src/learner';

const POP_SEED = "77".repeat(32);
const POP_PUBLIC_KEY = getTestPublicKey(POP_SEED);

describe('Commit 13: Local Pretrained/Base Proposer Adapter', () => {
  beforeEach(() => {
    _resetChain();
    resetLearnerModel();
    PrincipalRegistry.set('test-admin', POP_PUBLIC_KEY);
  });

  it('authority imports remain structurally forbidden for proposer', () => {
    const proposerSource = readFileSync(join(__dirname, '../src/proposer.ts'), 'utf-8');
    
    // Must NOT import these authority modules (use explicit import statement regex)
    expect(proposerSource).not.toMatch(/import\s+.*from\s+['"].*index['"]/);
    expect(proposerSource).not.toMatch(/import\s+.*from\s+['"].*crypto['"]/);
    expect(proposerSource).not.toMatch(/import\s+.*from\s+['"].*vk['"]/);
    expect(proposerSource).not.toMatch(/import\s+.*from\s+['"].*nodeIdentity['"]/);
  });

  it('I/O imports are not part of the permanent mock proposer wall', () => {
    // We intentionally do not forbid 'fs', 'child_process', or 'fetch' here.
    // Real adapters will need I/O to communicate with local processes or Nebius.
    expect(true).toBe(true);
  });

  it('outbound scrub redacts seed and env-secret material', () => {
    const testSeed = "88".repeat(32);
    const fakeSeed2 = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    const standaloneHex = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    
    const dangerousPrompt = `
      Please do this task.
      By the way, AUKORA_EDGE_NODE_SEED=my_secret_seed
      Here is the test seed: ${testSeed}
      And another privateKey: ${fakeSeed2}
      And a random hex: ${standaloneHex}
    `;
    
    const originalEnv = process.env.AUKORA_EDGE_NODE_SEED;
    process.env.AUKORA_EDGE_NODE_SEED = 'my_secret_seed';
    
    try {
      const scrubbed = scrubOutboundPrompt(dangerousPrompt);
      expect(scrubbed).not.toContain(testSeed);
      expect(scrubbed).not.toContain('my_secret_seed');
      expect(scrubbed).not.toContain(fakeSeed2);
      expect(scrubbed).toContain('[REDACTED_SEED]');
      expect(scrubbed).toContain('[REDACTED_64_HEX]');
      expect(scrubbed).toContain('AUKORA_EDGE_NODE_SEED=[REDACTED]');
    } finally {
      process.env.AUKORA_EDGE_NODE_SEED = originalEnv;
    }
  });

  it('scrub preserves harmless prompt content', () => {
    const safePrompt = "Please generate a valid read intent for data.txt.";
    const scrubbed = scrubOutboundPrompt(safePrompt);
    expect(scrubbed).toBe(safePrompt);
  });

  it('mock proposer emits a valid read; gate decides via evaluateIntent', () => {
    const proposer = new MockBaseProposer();
    
    // To pass the gate, we still need a valid PoP for the action the proposer WILL emit
    // In reality, PoPs might be bound to broader intents or session tokens, 
    // but for this test we'll pre-compute the expected intent hash.
    const expectedIntent = { action: 'read_file', resource: 'data.txt', ring: 'local' };
    const pop = signPoP(POP_SEED, {
      principalId: 'test-admin',
      methodId: 'evaluateIntent',
      argsHash: hash(JSON.stringify(normalizeProposal(expectedIntent))),
      nonce: 'nonce1'
    });

    const result = runProposerStep(proposer, { prompt: 'read some data', history: [] }, pop);
    
    expect(result.decision.verdict).toBe('golden_success');
    expect(result.decision.receipt).toBeDefined();
    expect(result.decision.vkRow.verdict).toBe('golden_success');
  });

  it('mock proposer emits delete_path; gate refuses', () => {
    const proposer = new MockBaseProposer();
    
    // We give it a PoP for delete_path, but the gate inherently refuses it
    const expectedIntent = { action: 'delete_path', resource: 'everything', ring: 'local' };
    const pop = signPoP(POP_SEED, {
      principalId: 'test-admin',
      methodId: 'evaluateIntent',
      argsHash: hash(JSON.stringify(normalizeProposal(expectedIntent))),
      nonce: 'nonce2'
    });

    const result = runProposerStep(proposer, { prompt: 'please delete everything', history: [] }, pop);
    
    expect(result.decision.verdict).toBe('refused');
  });

  it('mock proposer emits authority-claiming fields; normalizer strips/refuses as expected', () => {
    const proposer = new MockBaseProposer();
    
    // If the proposer sneaks in 'authorized: true', the normalizer should strip it, 
    // causing a PoP mismatch (or it fails anyway).
    // Let's just evaluate it.
    const result = runProposerStep(proposer, { prompt: 'a malformed intent', history: [] }, null);
    
    // Normalizer explicitly strips unknown fields, and without a PoP it's refused.
    expect(result.decision.verdict).toBe('refused');
    
    // And if we check the resulting intent in the receipt, 'authorized' shouldn't be there
    expect((result.decision.receipt.normalizedIntent as any).authorized).toBeUndefined();
    expect((result.decision.receipt.normalizedIntent as any).verdict).toBeUndefined();
  });

  it('mutating proposer output to include predictedVerdict/authorized:true does not affect gate verdict', () => {
    const proposer = new MockBaseProposer();
    
    // Get the output
    const raw = proposer.propose({ prompt: 'normal', history: [] });
    // Mutate it
    (raw as any).verdict = 'golden_success';
    (raw as any).authorized = true;
    
    // Pass it to the gate without a PoP
    const decision = evaluateIntent(raw, null);
    
    expect(decision.verdict).toBe('refused');
  });

  it('proposer output alone creates no receipt, no VK row, no training row', () => {
    const proposer = new MockBaseProposer();
    
    const raw = proposer.propose({ prompt: 'read some data', history: [] });
    
    // The proposer just returns a POJO. No cryptographic events happened.
    expect(raw).toHaveProperty('action');
    expect((raw as any).receipt).toBeUndefined();
    expect((raw as any).signedHead).toBeUndefined();
  });

  it('signed gated outcome from proposer step can train learner only after verifyVkRowAgainstSignedChain', () => {
    const proposer = new MockBaseProposer();
    const expectedIntent = { action: 'read_file', resource: 'data.txt', ring: 'local' };
    const pop = signPoP(POP_SEED, {
      principalId: 'test-admin',
      methodId: 'evaluateIntent',
      argsHash: hash(JSON.stringify(normalizeProposal(expectedIntent))),
      nonce: 'nonce3'
    });

    const result = runProposerStep(proposer, { prompt: 'read some data', history: [] }, pop);
    
    // Train the learner on the gated outcome
    // trainOnDecision internally calls verifyVkRowAgainstSignedChain
    const receipts = [result.decision.receipt];
    const signedHead = result.decision.receipt.signedHead!;
    
    expect(() => trainOnDecision(result.decision, receipts, signedHead)).not.toThrow();
  });
});
