// Council #4 (receipt/PoP binding) + #5 (atomicity). EVIDENCE-FIRST: prove what the receipt cryptographically
// binds by tampering each field and showing verification fails; prove the synchronous append is sequentially
// consistent. What is NOT bound (PoP principal/nonce, explicit monotonic seq) is documented honestly in
// docs/COUNCIL_FINDINGS_2026-06-30.md as a Step-4 blocker — NOT claimed here.
import { describe, it, expect } from 'vitest';
import { evaluateIntent, getChain, _resetChain } from '../src/index';
import { Receipt, verifyChain, verifyReceiptHistory, verifySignedHead, computeMerkleRoot, hash, getTestPublicKey } from '../src/crypto';
import { normalizeProposal } from '../src/normalizer';

const EDGE_NODE_SEED = '88'.repeat(32);            // the seed the kernel signs heads with under test
const EDGE_KEY = getTestPublicKey(EDGE_NODE_SEED);

// build a real chain, then return a MUTABLE deep-ish copy of the frozen snapshot for tamper tests
function freshChain(n: number): Receipt[] {
  _resetChain();
  for (let i = 0; i < n; i++) evaluateIntent({ action: 'read_file', resource: `f${i}.txt`, ring: 'local' } as any, null);
  return getChain().map((r) => ({ ...r, normalizedIntent: { ...r.normalizedIntent } }));
}

describe('council #4 — the receipt cryptographically binds the decision (tamper-evident)', () => {
  it('the normalized intent IS the complete bound surface — normalization strips every extra field', () => {
    const n = normalizeProposal({ action: 'read_file', resource: 'x', ring: 'local', grantsAuthority: true, payload: 'evil', principalId: 'attacker' } as any);
    expect(Object.keys(n).sort()).toEqual(['action', 'resource', 'ring']);
    expect((n as any).grantsAuthority).toBeUndefined();
    expect((n as any).payload).toBeUndefined();
    // => binding {action,resource,ring} binds the COMPLETE normalized intent; nothing else survives.
  });

  it('tampering action / resource / ring breaks verifyChain', () => {
    for (const field of ['action', 'resource', 'ring'] as const) {
      const c = freshChain(4);
      (c[1].normalizedIntent as any)[field] = 'TAMPERED';
      expect(verifyChain(c)).toBe(false);
    }
  });

  it('tampering the verdict breaks verifyChain (id no longer recomputes)', () => {
    const c = freshChain(4);
    c[1].verdict = 'golden_success';
    expect(verifyChain(c)).toBe(false);
  });

  it('tampering the intentHash breaks verifyChain (intent-body mismatch)', () => {
    const c = freshChain(4);
    c[1].intentHash = hash('forged');
    expect(verifyChain(c)).toBe(false);
  });

  it('tampering prevHash (the chain link) breaks verifyChain', () => {
    const c = freshChain(4);
    c[2].prevHash = hash('forged');
    expect(verifyChain(c)).toBe(false);
  });

  it('tampering a receipt id breaks verifyChain', () => {
    const c = freshChain(4);
    c[1].id = hash('forged');
    expect(verifyChain(c)).toBe(false);
  });

  it('tampering a receipt breaks the Merkle history check too', () => {
    const c = freshChain(5);
    const root = computeMerkleRoot(c);
    expect(verifyReceiptHistory(c, root)).toBe(true);
    (c[2].normalizedIntent as any).resource = 'TAMPERED';
    expect(verifyReceiptHistory(c, root)).toBe(false);
  });

  it('tampering the signed head fails ML-DSA signature verification', () => {
    _resetChain();
    for (let i = 0; i < 3; i++) evaluateIntent({ action: 'read_file', resource: `s${i}`, ring: 'local' } as any, null);
    const chain = getChain() as Receipt[];
    const root = computeMerkleRoot(chain);
    const goodHead = chain[chain.length - 1].signedHead;
    expect(verifySignedHead(EDGE_KEY, root, goodHead)).toBe(true);
    const forged = goodHead.slice(0, -2) + (goodHead.endsWith('00') ? '11' : '00');
    expect(verifySignedHead(EDGE_KEY, root, forged)).toBe(false);
  });
});

describe('council #5 — synchronous append is sequentially consistent (no race window)', () => {
  it('evaluateIntent is synchronous — returns a value, not a Promise (no async interleaving point)', () => {
    _resetChain();
    const r = evaluateIntent({ action: 'read_file', resource: 'x', ring: 'local' } as any, null);
    expect(r).not.toBeInstanceOf(Promise);
    expect(r.receipt).toBeDefined();
  });

  it('N synchronous appends yield one ordered, fully-verifiable chain', () => {
    _resetChain();
    const N = 25;
    for (let i = 0; i < N; i++) evaluateIntent({ action: 'read_file', resource: `seq${i}`, ring: 'local' } as any, null);
    const chain = getChain() as Receipt[];
    expect(chain.length).toBe(N);
    expect(verifyChain(chain)).toBe(true);
    const root = computeMerkleRoot(chain);
    expect(verifyReceiptHistory(chain, root)).toBe(true);
    expect(verifySignedHead(EDGE_KEY, root, chain[N - 1].signedHead)).toBe(true);
    for (let i = 1; i < N; i++) expect(chain[i].prevHash).toBe(chain[i - 1].id); // strict ordering
  });
});
