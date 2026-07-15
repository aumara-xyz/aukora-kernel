import { describe, it, expect } from 'vitest';
import { evaluateIntent, PrincipalRegistry, _resetChain, getChain } from '../src/index';
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
    nonce: `trunc-${Math.random()}`,
  });
}

function buildChain(length: number) {
  _resetChain();
  PrincipalRegistry.set('test-admin', POP_PUBLIC_KEY);

  const decisions = [];
  for (let i = 0; i < length; i++) {
    const rawIntent = { action: 'read_file', resource: `file_${i}.txt`, ring: 'local' };
    const decision = evaluateIntent(rawIntent, createValidPoP(rawIntent));
    decisions.push(decision);
  }

  const chain = getChain();
  const root = computeMerkleRoot(chain);
  const signedHead = chain[chain.length - 1].signedHead;

  return { decisions, chain: [...chain], root, signedHead };
}

describe('24D: Receipt Chain Truncation Attack', () => {
  it('full chain verifies before any truncation', () => {
    const { chain, root, signedHead } = buildChain(5);
    expect(verifyChain(chain)).toBe(true);
    expect(verifyReceiptHistory(chain, root)).toBe(true);
    expect(verifySignedHead(EDGE_NODE_PUBLIC_KEY, root, signedHead)).toBe(true);
  });

  it('removing a middle receipt breaks chain verification', () => {
    const { chain } = buildChain(5);
    const truncated = [...chain];
    truncated.splice(2, 1);
    expect(verifyChain(truncated)).toBe(false);
  });

  it('removing the tail receipt breaks Merkle root match', () => {
    const { chain, root, signedHead } = buildChain(5);
    const truncated = chain.slice(0, -1);
    expect(verifyChain(truncated)).toBe(true);
    const truncatedRoot = computeMerkleRoot(truncated);
    expect(truncatedRoot).not.toBe(root);
    expect(verifyReceiptHistory(truncated, root)).toBe(false);
    expect(verifySignedHead(EDGE_NODE_PUBLIC_KEY, root, signedHead)).toBe(true);
    expect(verifySignedHead(EDGE_NODE_PUBLIC_KEY, truncatedRoot, signedHead)).toBe(false);
  });

  it('removing the first receipt breaks chain verification', () => {
    const { chain } = buildChain(5);
    const truncated = chain.slice(1);
    expect(verifyChain(truncated)).toBe(false);
  });

  it('removing multiple middle receipts breaks chain verification', () => {
    const { chain } = buildChain(7);
    const truncated = [chain[0], chain[1], chain[4], chain[5], chain[6]];
    expect(verifyChain(truncated)).toBe(false);
  });

  it('truncated chain cannot produce a valid signed training bundle', () => {
    const { decisions, chain, root, signedHead } = buildChain(5);
    const lastDecision = decisions[4];
    const loadedRow = loadVkRow(exportVkRow(lastDecision.vkRow!));

    expect(verifyVkRowAgainstSignedChain(loadedRow, chain, root, signedHead)).toBe(true);

    const truncated = chain.slice(0, 3);
    const truncatedRoot = computeMerkleRoot(truncated);

    expect(() => verifyVkRowAgainstSignedChain(loadedRow, truncated, root, signedHead))
      .toThrow();
  });

  it('VK row referencing a removed receipt fails verification', () => {
    const { decisions, chain, root, signedHead } = buildChain(5);
    const middleRow = loadVkRow(exportVkRow(decisions[2].vkRow!));

    const truncated = [chain[0], chain[1], chain[3], chain[4]];

    expect(() => verifyVkRowAgainstSignedChain(middleRow, truncated, root, signedHead))
      .toThrow(/No matching receipt found in chain/);
  });

  it('attacker re-signing a truncated chain is rejected by pinned key', () => {
    const { decisions, chain } = buildChain(5);
    const truncated = chain.slice(0, 3);
    const attackerRoot = computeMerkleRoot(truncated);
    const attackerHead = signHead(ATTACKER_SEED, attackerRoot);

    expect(verifySignedHead(EDGE_NODE_PUBLIC_KEY, attackerRoot, attackerHead)).toBe(false);

    const row = loadVkRow(exportVkRow(decisions[0].vkRow!));
    expect(() => verifyVkRowAgainstSignedChain(row, truncated, attackerRoot, attackerHead))
      .toThrow(/signed head signature invalid/);
  });

  it('empty chain is valid but has empty Merkle root', () => {
    expect(verifyChain([])).toBe(true);
    const root = computeMerkleRoot([]);
    expect(root).toBeTruthy();
  });

  it('single-receipt chain truncated to empty breaks Merkle match', () => {
    const { chain, root, signedHead } = buildChain(1);
    expect(verifyChain(chain)).toBe(true);
    expect(verifyReceiptHistory(chain, root)).toBe(true);

    const emptyRoot = computeMerkleRoot([]);
    expect(emptyRoot).not.toBe(root);
    expect(verifyReceiptHistory([], root)).toBe(false);
  });

  it('failure is explicit, not silent — each truncation type throws or returns false', () => {
    const { decisions, chain, root, signedHead } = buildChain(4);

    const middleTruncated = [chain[0], chain[2], chain[3]];
    expect(verifyChain(middleTruncated)).toBe(false);

    const tailTruncated = chain.slice(0, -1);
    expect(verifyReceiptHistory(tailTruncated, root)).toBe(false);

    const headTruncated = chain.slice(1);
    expect(verifyChain(headTruncated)).toBe(false);

    const row = loadVkRow(exportVkRow(decisions[3].vkRow!));
    expect(() => verifyVkRowAgainstSignedChain(row, tailTruncated, root, signedHead))
      .toThrow();
  });
});
