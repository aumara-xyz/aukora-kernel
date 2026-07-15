import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { LocalModelProposer } from '../src/localModelProposer';
import { evaluateIntent, _resetChain, PrincipalRegistry } from '../src/index';
import { getTestPublicKey, signPoP, hash } from '../src/crypto';
import { normalizeProposal } from '../src/normalizer';
import { runClosedLoopStep } from '../src/loop';

const POP_SEED = "77".repeat(32);
const POP_PUBLIC_KEY = getTestPublicKey(POP_SEED);

describe('Commit 14: Local Model Process Adapter', () => {
  let proposer: LocalModelProposer;
  
  beforeEach(() => {
    _resetChain();
    PrincipalRegistry.set('test-admin', POP_PUBLIC_KEY);
    proposer = new LocalModelProposer('node', [join(__dirname, 'fakeModel.js')]);
  });

  it('adapter avoids authority/key/signing imports', () => {
    const source = readFileSync(join(__dirname, '../src/localModelProposer.ts'), 'utf-8');
    
    // Must NOT import these authority modules
    expect(source).not.toMatch(/import\s+.*from\s+['"].*index['"]/);
    expect(source).not.toMatch(/import\s+.*from\s+['"].*crypto['"]/);
    expect(source).not.toMatch(/import\s+.*from\s+['"].*vk['"]/);
    expect(source).not.toMatch(/import\s+.*from\s+['"].*nodeIdentity['"]/);
  });

  it('structured prompt redacts secrets and uses a schema, preventing free-form leaks', () => {
    const originalEnv = process.env.AUKORA_EDGE_NODE_SEED;
    process.env.AUKORA_EDGE_NODE_SEED = 'my_secret_seed';
    
    try {
      const intent = proposer.propose({ prompt: 'Please AUKORA_EDGE_NODE_SEED=my_secret_seed', history: [] });
      // The fakeModel script asserts that 'AUKORA_EDGE_NODE_SEED=my_secret_seed' doesn't reach it.
      // If it did, fakeModel would process.exit(1) and it would return a FAIL_CLOSED.
      expect(intent.action).not.toBe('FAIL_CLOSED');
    } finally {
      process.env.AUKORA_EDGE_NODE_SEED = originalEnv;
    }
  });

  it('valid JSON output becomes RawIntent and can pass through runClosedLoopStep', () => {
    const intent = proposer.propose({ prompt: 'normal', history: [] });
    
    expect(intent.action).toBe('read_file');
    
    const pop = signPoP(POP_SEED, {
      principalId: 'test-admin',
      methodId: 'evaluateIntent',
      argsHash: hash(JSON.stringify(normalizeProposal(intent))),
      nonce: 'nonce1'
    });
    
    const result = runClosedLoopStep(intent, pop);
    expect(result.decision.verdict).toBe('golden_success');
  });

  it('extra fields like authorized/verdict are ignored/stripped from output', () => {
    const intent = proposer.propose({ prompt: 'inject', history: [] });
    
    // The proposer whitelist ensures 'authorized' and 'verdict' never make it out
    expect((intent as any).authorized).toBeUndefined();
    expect((intent as any).verdict).toBeUndefined();
    expect(intent.action).toBe('read_file');
    
    // And if passed to gate, they don't impact it (they've been stripped)
    const result = runClosedLoopStep(intent, null);
    expect(result.decision.verdict).toBe('refused'); // No PoP
  });

  it('malformed non-JSON output fails closed', () => {
    const intent = proposer.propose({ prompt: 'malformed', history: [] });
    expect(intent.action).toBe('FAIL_CLOSED');
    expect(intent.resource).toBe('parse_error');
  });

  it('invalid JSON shape fails closed', () => {
    const intent = proposer.propose({ prompt: 'invalid_shape', history: [] });
    expect(intent.action).toBe('FAIL_CLOSED');
    expect(intent.resource).toBe('invalid_shape');
  });

  it('process failure fails closed', () => {
    const intent = proposer.propose({ prompt: 'process_error', history: [] });
    expect(intent.action).toBe('FAIL_CLOSED');
    expect(intent.resource).toBe('process_error');
  });

  it('adapter output alone creates no receipt/VK/training row', () => {
    const intent = proposer.propose({ prompt: 'normal', history: [] });
    expect((intent as any).receipt).toBeUndefined();
    expect((intent as any).signedHead).toBeUndefined();
  });

  it('shell metacharacters in payload cannot execute anything', () => {
    // Because we use execFileSync with an argument array, shell injection is impossible.
    // If we injected a command like '; echo hacked', it gets passed strictly as data to fakeModel.js
    const intent = proposer.propose({ prompt: '; echo hacked', history: [] });
    expect(intent.action).toBe('read_file'); // Proceeds normally, ignored by node
  });

  it('hung fake model times out and returns FAIL_CLOSED', () => {
    // The timeout is set to 5000ms. Since that slows tests down, we'll temporarily patch the timeout
    // Or we can just use a fake model that sleeps forever. Wait, 5 seconds is a bit long for a unit test.
    // Let's create a proposer with a shorter timeout by hacking it or just waiting.
    // We'll just wait the 5 seconds for the test.
    const intent = proposer.propose({ prompt: 'hang', history: [] });
    expect(intent.action).toBe('FAIL_CLOSED');
    expect(intent.resource).toBe('process_error');
  }, 10000);

  it('oversized stdout returns FAIL_CLOSED', () => {
    const intent = proposer.propose({ prompt: 'oversized', history: [] });
    expect(intent.action).toBe('FAIL_CLOSED');
    expect(intent.resource).toBe('process_error');
  });
});
