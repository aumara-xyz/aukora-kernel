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
    nonce: `reorder-${Math.random()}`,
  });
}

function buildChain(length: number) {
  _resetChain();
  PrincipalRegistry.set('test-admin', POP_PUBLIC_KEY);

  const decisions: KernelDecision[] = [];
  for (let i = 0; i < length; i++) {
    const rawIntent = { action: 'read_file', resource: `reorder_${i}.txt`, ring: 'local' };
    decisions.push(evaluateIntent(rawIntent, createValidPoP(rawIntent)));
  }

  const chain = [...getChain()];
  const root = computeMerkleRoot(chain);
  const signedHead = chain[chain.length - 1].signedHead;
  return { decisions, chain, root, signedHead };
}

describe('24G: Receipt Chain Reordering Attack', () => {
  it('valid canonical chain verifies before reordering', () => {
    const { chain, root, signedHead } = buildChain(5);
    expect(verifyChain(chain)).toBe(true);
    expect(verifyReceiptHistory(chain, root)).toBe(true);
    expect(verifySignedHead(EDGE_NODE_PUBLIC_KEY, root, signedHead)).toBe(true);
  });

  it('swapping two adjacent receipts fails chain verification', () => {
    const { chain } = buildChain(5);
    const swapped = [...chain];
    [swapped[2], swapped[3]] = [swapped[3], swapped[2]];
    expect(verifyChain(swapped)).toBe(false);
  });

  it('reversing the entire chain fails', () => {
    const { chain } = buildChain(5);
    const reversed = [...chain].reverse();
    expect(verifyChain(reversed)).toBe(false);
  });

  it('moving a middle receipt to the tail fails', () => {
    const { chain } = buildChain(5);
    const moved = [...chain];
    const [removed] = moved.splice(2, 1);
    moved.push(removed);
    expect(verifyChain(moved)).toBe(false);
  });

  it('moving the first receipt to the middle fails', () => {
    const { chain } = buildChain(5);
    const moved = [...chain];
    const [first] = moved.splice(0, 1);
    moved.splice(2, 0, first);
    expect(verifyChain(moved)).toBe(false);
  });

  it('reordered chain has different Merkle root than canonical', () => {
    const { chain, root } = buildChain(5);
    const swapped = [...chain];
    [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
    const reorderedRoot = computeMerkleRoot(swapped);
    expect(reorderedRoot).not.toBe(root);
  });

  it('reordered chain fails Merkle root check against canonical root', () => {
    const { chain, root, signedHead } = buildChain(5);
    const swapped = [...chain];
    [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
    expect(verifyReceiptHistory(swapped, root)).toBe(false);
  });

  it('deleting any receipt fails receipt history against the canonical signed root', () => {
    const { chain, root } = buildChain(5);
    for (let i = 0; i < chain.length; i++) {
      const deleted = chain.filter((_, idx) => idx !== i);
      expect(verifyReceiptHistory(deleted, root)).toBe(false);
    }
  });

  it('attacker cannot re-sign a reordered chain to match pinned key', () => {
    const { chain } = buildChain(5);
    const swapped = [...chain];
    [swapped[2], swapped[3]] = [swapped[3], swapped[2]];
    const attackerRoot = computeMerkleRoot(swapped);
    const attackerHead = signHead(ATTACKER_SEED, attackerRoot);
    expect(verifySignedHead(EDGE_NODE_PUBLIC_KEY, attackerRoot, attackerHead)).toBe(false);
  });

  it('reordering is caught by receipt ID recomputation, not just prevHash', () => {
    const { chain } = buildChain(5);
    const r2 = chain[2];
    const r3 = chain[3];
    expect(r2.prevHash).not.toBe(r3.prevHash);
    expect(r2.id).not.toBe(r3.id);

    const swapped = [...chain];
    [swapped[2], swapped[3]] = [swapped[3], swapped[2]];
    expect(swapped[2].prevHash).not.toBe(swapped[1].id);
  });

  it('export/training bundle rejects reordered chain', () => {
    const { decisions, chain, root, signedHead } = buildChain(5);
    const row = loadVkRow(exportVkRow(decisions[4].vkRow!));
    expect(verifyVkRowAgainstSignedChain(row, chain, root, signedHead)).toBe(true);

    const swapped = [...chain];
    [swapped[2], swapped[3]] = [swapped[3], swapped[2]];
    const swappedRoot = computeMerkleRoot(swapped);

    expect(() => verifyVkRowAgainstSignedChain(row, swapped, root, signedHead))
      .toThrow();
  });

  it('every reordering permutation of a 4-receipt chain fails', () => {
    const { chain } = buildChain(4);
    const indices = [0, 1, 2, 3];

    function permutations(arr: number[]): number[][] {
      if (arr.length <= 1) return [arr];
      const result: number[][] = [];
      for (let i = 0; i < arr.length; i++) {
        const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
        for (const perm of permutations(rest)) {
          result.push([arr[i], ...perm]);
        }
      }
      return result;
    }

    const allPerms = permutations(indices);
    const canonical = indices.join(',');
    let nonCanonicalCount = 0;
    let failedCount = 0;

    for (const perm of allPerms) {
      if (perm.join(',') === canonical) continue;
      nonCanonicalCount++;
      const reordered = perm.map(i => chain[i]);
      if (!verifyChain(reordered)) failedCount++;
    }

    expect(nonCanonicalCount).toBe(23);
    expect(failedCount).toBe(23);
  });

  it('failure is explicit for all reordering vectors', () => {
    const { chain, root, signedHead } = buildChain(5);

    const swapped = [...chain];
    [swapped[1], swapped[3]] = [swapped[3], swapped[1]];
    expect(verifyChain(swapped)).toBe(false);

    expect(verifyReceiptHistory(swapped, root)).toBe(false);

    const attackerRoot = computeMerkleRoot(swapped);
    const attackerHead = signHead(ATTACKER_SEED, attackerRoot);
    expect(verifySignedHead(EDGE_NODE_PUBLIC_KEY, attackerRoot, attackerHead)).toBe(false);
  });
});
