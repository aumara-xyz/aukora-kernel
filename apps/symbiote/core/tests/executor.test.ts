import { describe, it, expect, beforeEach } from 'vitest';
import { evaluateIntent, _resetChain, getChain } from '../src/index';
import { executeDecision } from '../src/executor';
import { createLocalTestAnchorPoP } from './testAnchor';
import { normalizeProposal } from '../src/normalizer';
import { signPoP, getTestPublicKey, hash, signHead, computeMerkleRoot } from '../src/crypto';
import { randomUUID } from 'crypto';

describe('Commit 18.1: Executor Verify-Before-Act', () => {
  beforeEach(() => {
    _resetChain();
  });

  it('without PoP, live/model proposal remains refused and does not execute', () => {
    const decision = evaluateIntent({ action: 'read_file', resource: 'data.txt', ring: 'local' }, null);
    expect(decision.verdict).toBe('refused');
    const result = executeDecision(decision, getChain());
    expect(result.success).toBe(false);
  });

  it('forged decision with verdict manually flipped to golden_success is rejected', () => {
    const decision = evaluateIntent({ action: 'read_file', resource: 'data.txt', ring: 'local' }, null);
    expect(decision.verdict).toBe('refused');
    
    // Attacker flips the field
    decision.verdict = 'golden_success'; 
    const result = executeDecision(decision, getChain());
    
    expect(result.success).toBe(false);
    expect(result.error).toBe('forged_verdict'); 
  });

  it('with LOCAL_TEST_ANCHOR PoP, read_file/data.txt/local returns golden_success and reads fixture', () => {
    const pop = createLocalTestAnchorPoP();
    const decision = evaluateIntent({ action: 'read_file', resource: 'data.txt', ring: 'local' }, pop);
    expect(decision.verdict).toBe('golden_success');

    const result = executeDecision(decision, getChain());
    expect(result.success).toBe(true);
    expect(result.data).toContain('LOCAL_TEST_ANCHOR_EVIDENCE');
    expect(decision.receipt.id).toBeDefined();
  });

  it('wrong signed-head key rejects', () => {
    const pop = createLocalTestAnchorPoP();
    const decision = evaluateIntent({ action: 'read_file', resource: 'data.txt', ring: 'local' }, pop);
    
    // Attacker replaces signature
    decision.receipt.signedHead = signHead("0000000000000000000000000000000000000000000000000000000000000000", computeMerkleRoot(getChain()));
    
    const result = executeDecision(decision, getChain());
    expect(result.success).toBe(false);
    expect(result.error).toBe('signature_invalid');
  });

  it('receipt not in chain rejects', () => {
    const pop = createLocalTestAnchorPoP();
    const decision = evaluateIntent({ action: 'read_file', resource: 'data.txt', ring: 'local' }, pop);
    
    // Fake the receipt ID so it won't match what is in the chain
    const fakeReceipt = { ...decision.receipt, id: 'fake_id' };
    const fakeDecision = { ...decision, receipt: fakeReceipt };
    
    const result = executeDecision(fakeDecision, getChain());
    expect(result.success).toBe(false);
    expect(result.error).toBe('receipt_not_in_chain');
  });

  it('delete_path/write_file/shell/network refuses even with PoP', () => {
    const seed = "1111111111111111111111111111111111111111111111111111111111111111";
    const intent = normalizeProposal({ action: 'delete_path', resource: 'data.txt', ring: 'local' });
    const pop = signPoP(seed, {
      principalId: 'LOCAL_TEST_ANCHOR',
      methodId: 'evaluateIntent',
      argsHash: hash(JSON.stringify(intent)),
      nonce: randomUUID()
    });

    const decision = evaluateIntent({ action: 'delete_path', resource: 'data.txt', ring: 'local' }, pop);
    expect(decision.verdict).toBe('refused');
    
    const result = executeDecision(decision, getChain());
    expect(result.success).toBe(false);
  });

  it('path traversal ../secret refuses execution even if gate hypothetically allowed it', async () => {
    const decision = evaluateIntent({ action: 'read_file', resource: '../secret.txt', ring: 'local' }, null);
    
    // To bypass the forged_verdict check, we'd have to forge the whole chain.
    // Instead, we verify the execution hard wall directly:
    // If we mock a valid chain where the gate returned golden_success, it STILL fails the intent hard-wall check.
    // Since we just wrote the verify step, let's inject a fake chain and signature to test the executor boundary.
    // We import getEdgeNodeSeed and hashReceiptPreimage
    const { getEdgeNodeSeed } = await import('../src/nodeIdentity');
    const { hashReceiptPreimage } = await import('../src/crypto');
    
    const intent = normalizeProposal({ action: 'read_file', resource: '../secret.txt', ring: 'local' });
    const fakeReceipt = {
      id: '',
      verdict: 'golden_success' as const,
      intentHash: hash(JSON.stringify(intent)),
      normalizedIntent: intent,
      prevHash: 'genesis_hash',
      signedHead: ''
    };
    fakeReceipt.id = hashReceiptPreimage(fakeReceipt.verdict, fakeReceipt.normalizedIntent, fakeReceipt.prevHash);
    
    fakeReceipt.signedHead = signHead(
      getEdgeNodeSeed(),
      computeMerkleRoot([fakeReceipt])
    );
    const fakeDecision = {
      verdict: 'golden_success' as const,
      receipt: fakeReceipt,
      vkRow: null as any
    };

    const result = executeDecision(fakeDecision, [fakeReceipt]);
    expect(result.success).toBe(false);
    expect(result.error).toBe('unsupported_capability'); // path traversal strictly rejected
  });

  it('model/proposer cannot create PoP (wrong seed will be refused)', () => {
    const wrongSeed = "0000000000000000000000000000000000000000000000000000000000000000";
    const pop = signPoP(wrongSeed, {
      principalId: 'LOCAL_TEST_ANCHOR',
      methodId: 'evaluateIntent',
      argsHash: hash(JSON.stringify(normalizeProposal({ action: 'read_file', resource: 'data.txt', ring: 'local' }))),
      nonce: randomUUID()
    });
    
    const decision = evaluateIntent({ action: 'read_file', resource: 'data.txt', ring: 'local' }, pop);
    expect(decision.verdict).toBe('refused');
  });
});
