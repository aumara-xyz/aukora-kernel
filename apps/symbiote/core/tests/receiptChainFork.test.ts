import { describe, it, expect } from 'vitest';
import { evaluateIntent, PrincipalRegistry, _resetChain, getChain, KernelDecision } from '../src/index';
import { getTestPublicKey, signPoP, hash, computeMerkleRoot, signHead, verifyChain, verifyReceiptHistory, verifySignedHead, Receipt } from '../src/crypto';
import { normalizeProposal } from '../src/normalizer';
import { exportVkRow, loadVkRow, verifyVkRowAgainstSignedChain } from '../src/trainingExport';

const POP_SEED = "77".repeat(32);
const EDGE_NODE_SEED = "88".repeat(32);
const ATTACKER_SEED = "99".repeat(32);

const POP_PUBLIC_KEY = getTestPublicKey(POP_SEED);
const EDGE_NODE_PUBLIC_KEY = getTestPublicKey(EDGE_NODE_SEED);

function createValidPoP(rawIntent: any): any {
  const intent = normalizeProposal(rawIntent);
  const intentHash = hash(JSON.stringify(intent));
  return signPoP(POP_SEED, {
    principalId: 'test-admin',
    methodId: 'evaluateIntent',
    argsHash: intentHash,
    // DETERMINISTIC nonce per step (#4a): the receipt id now binds the PoP nonceHash, so a "shared prefix"
    // is only genuinely identical when the SAME nonce authorized each shared step. Resources are unique per
    // step, so this keeps every nonce unique within a chain while making the shared prefix truly identical.
    nonce: `fork-${intent.resource}`,
  });
}

function buildChainFromIntents(intents: any[]): { chain: Receipt[]; root: string; signedHead: string; decisions: KernelDecision[] } {
  _resetChain();
  PrincipalRegistry.set('test-admin', POP_PUBLIC_KEY);

  const decisions: KernelDecision[] = [];
  for (const raw of intents) {
    decisions.push(evaluateIntent(raw, createValidPoP(raw)));
  }

  const chain = [...getChain()];
  const root = computeMerkleRoot(chain);
  const signedHead = chain[chain.length - 1].signedHead;
  return { chain, root, signedHead, decisions };
}

const SHARED_PREFIX = [
  { action: 'read_file', resource: 'shared_0.txt', ring: 'local' },
  { action: 'read_file', resource: 'shared_1.txt', ring: 'local' },
  { action: 'read_file', resource: 'shared_2.txt', ring: 'local' },
];

const BRANCH_A_SUFFIX = [
  { action: 'read_file', resource: 'branch_a_3.txt', ring: 'local' },
  { action: 'read_file', resource: 'branch_a_4.txt', ring: 'local' },
];

const BRANCH_B_SUFFIX = [
  { action: 'read_file', resource: 'branch_b_3.txt', ring: 'local' },
  { action: 'read_file', resource: 'branch_b_4.txt', ring: 'local' },
];

describe('24F: Receipt Chain Fork / Divergent Chains', () => {
  it('each branch individually verifies as a valid chain', () => {
    const branchA = buildChainFromIntents([...SHARED_PREFIX, ...BRANCH_A_SUFFIX]);
    expect(verifyChain(branchA.chain)).toBe(true);
    expect(verifyReceiptHistory(branchA.chain, branchA.root)).toBe(true);
    expect(verifySignedHead(EDGE_NODE_PUBLIC_KEY, branchA.root, branchA.signedHead)).toBe(true);

    const branchB = buildChainFromIntents([...SHARED_PREFIX, ...BRANCH_B_SUFFIX]);
    expect(verifyChain(branchB.chain)).toBe(true);
    expect(verifyReceiptHistory(branchB.chain, branchB.root)).toBe(true);
    expect(verifySignedHead(EDGE_NODE_PUBLIC_KEY, branchB.root, branchB.signedHead)).toBe(true);
  });

  it('two divergent branches produce different Merkle roots', () => {
    const branchA = buildChainFromIntents([...SHARED_PREFIX, ...BRANCH_A_SUFFIX]);
    const branchB = buildChainFromIntents([...SHARED_PREFIX, ...BRANCH_B_SUFFIX]);
    expect(branchA.root).not.toBe(branchB.root);
  });

  it('two divergent branches produce different signed heads', () => {
    const branchA = buildChainFromIntents([...SHARED_PREFIX, ...BRANCH_A_SUFFIX]);
    const branchB = buildChainFromIntents([...SHARED_PREFIX, ...BRANCH_B_SUFFIX]);
    expect(branchA.signedHead).not.toBe(branchB.signedHead);
  });

  it('shared prefix is identical so mixed chain equals the suffix-donor branch', () => {
    const branchA = buildChainFromIntents([...SHARED_PREFIX, ...BRANCH_A_SUFFIX]);
    const branchB = buildChainFromIntents([...SHARED_PREFIX, ...BRANCH_B_SUFFIX]);

    const mixed = [...branchA.chain.slice(0, 3), ...branchB.chain.slice(3)];
    const mixedRoot = computeMerkleRoot(mixed);
    expect(mixedRoot).toBe(branchB.root);
    expect(verifyReceiptHistory(mixed, branchB.root)).toBe(true);
    expect(verifyReceiptHistory(mixed, branchA.root)).toBe(false);
  });

  it('inserting a branch A post-fork receipt into branch B breaks chain', () => {
    const branchA = buildChainFromIntents([...SHARED_PREFIX, ...BRANCH_A_SUFFIX]);
    const branchB = buildChainFromIntents([...SHARED_PREFIX, ...BRANCH_B_SUFFIX]);

    const injected = [...branchB.chain];
    injected[3] = branchA.chain[3];
    expect(verifyChain(injected)).toBe(false);
  });

  it('branch A receipts fail against branch B Merkle root', () => {
    const branchA = buildChainFromIntents([...SHARED_PREFIX, ...BRANCH_A_SUFFIX]);
    const branchB = buildChainFromIntents([...SHARED_PREFIX, ...BRANCH_B_SUFFIX]);

    expect(verifyReceiptHistory(branchA.chain, branchB.root)).toBe(false);
    expect(verifyReceiptHistory(branchB.chain, branchA.root)).toBe(false);
  });

  it('branch A signed head rejects branch B Merkle root', () => {
    const branchA = buildChainFromIntents([...SHARED_PREFIX, ...BRANCH_A_SUFFIX]);
    const branchB = buildChainFromIntents([...SHARED_PREFIX, ...BRANCH_B_SUFFIX]);

    expect(verifySignedHead(EDGE_NODE_PUBLIC_KEY, branchB.root, branchA.signedHead)).toBe(false);
    expect(verifySignedHead(EDGE_NODE_PUBLIC_KEY, branchA.root, branchB.signedHead)).toBe(false);
  });

  it('VK row from branch A fails verification against branch B chain', () => {
    const branchA = buildChainFromIntents([...SHARED_PREFIX, ...BRANCH_A_SUFFIX]);
    const lastDecisionA = branchA.decisions[branchA.decisions.length - 1];
    const rowA = loadVkRow(exportVkRow(lastDecisionA.vkRow!));

    const branchB = buildChainFromIntents([...SHARED_PREFIX, ...BRANCH_B_SUFFIX]);

    expect(() => verifyVkRowAgainstSignedChain(rowA, branchB.chain, branchB.root, branchB.signedHead))
      .toThrow();
  });

  it('attacker cannot sign a mixed chain to make it look canonical', () => {
    const branchA = buildChainFromIntents([...SHARED_PREFIX, ...BRANCH_A_SUFFIX]);
    const branchB = buildChainFromIntents([...SHARED_PREFIX, ...BRANCH_B_SUFFIX]);

    const mixed = [...branchA.chain.slice(0, 3), ...branchB.chain.slice(3)];
    const attackerRoot = computeMerkleRoot(mixed);
    const attackerHead = signHead(ATTACKER_SEED, attackerRoot);

    expect(verifySignedHead(EDGE_NODE_PUBLIC_KEY, attackerRoot, attackerHead)).toBe(false);
  });

  it('shared prefix receipts have identical IDs in both branches', () => {
    const branchA = buildChainFromIntents([...SHARED_PREFIX, ...BRANCH_A_SUFFIX]);
    const branchB = buildChainFromIntents([...SHARED_PREFIX, ...BRANCH_B_SUFFIX]);

    for (let i = 0; i < SHARED_PREFIX.length; i++) {
      expect(branchA.chain[i].id).toBe(branchB.chain[i].id);
      expect(branchA.chain[i].prevHash).toBe(branchB.chain[i].prevHash);
    }
  });

  it('divergence point receipts differ despite same position', () => {
    const branchA = buildChainFromIntents([...SHARED_PREFIX, ...BRANCH_A_SUFFIX]);
    const branchB = buildChainFromIntents([...SHARED_PREFIX, ...BRANCH_B_SUFFIX]);

    expect(branchA.chain[3].id).not.toBe(branchB.chain[3].id);
    expect(branchA.chain[3].prevHash).toBe(branchB.chain[3].prevHash);
  });

  it('replacing one post-fork receipt with the other branch receipt breaks chain', () => {
    const branchA = buildChainFromIntents([...SHARED_PREFIX, ...BRANCH_A_SUFFIX]);
    const branchB = buildChainFromIntents([...SHARED_PREFIX, ...BRANCH_B_SUFFIX]);

    const spliced = [...branchA.chain];
    spliced[3] = branchB.chain[3];
    expect(verifyChain(spliced)).toBe(false);
  });

  it('failure is explicit for every fork attack vector', () => {
    const branchA = buildChainFromIntents([...SHARED_PREFIX, ...BRANCH_A_SUFFIX]);
    const branchB = buildChainFromIntents([...SHARED_PREFIX, ...BRANCH_B_SUFFIX]);

    expect(verifyReceiptHistory(branchA.chain, branchB.root)).toBe(false);

    expect(verifySignedHead(EDGE_NODE_PUBLIC_KEY, branchA.root, branchB.signedHead)).toBe(false);

    const injected = [...branchB.chain];
    injected[3] = branchA.chain[3];
    expect(verifyChain(injected)).toBe(false);

    const attackerHead = signHead(ATTACKER_SEED, branchA.root);
    expect(verifySignedHead(EDGE_NODE_PUBLIC_KEY, branchA.root, attackerHead)).toBe(false);
  });
});
