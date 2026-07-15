// Fusion Council hardening (2026-06-30) — regression tests for the three verified chokepoint findings.
// #1 getChain() must hand out an immutable snapshot; #2 _resetChain must have no runtime-global bypass;
// #3 the nonce ledger must be the bounded organ. Source-level guards prevent silent reintroduction.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { evaluateIntent, getChain, _resetChain, PrincipalRegistry } from '../src/index';
import { getTestPublicKey, signPoP, hash, canonicalIntentSerialize } from '../src/crypto';
import { normalizeProposal } from '../src/normalizer';

const INDEX_SRC = readFileSync(join(__dirname, '..', 'src', 'index.ts'), 'utf-8');

const POP_SEED = '77'.repeat(32);
function validPoP(rawIntent: any, nonce: string) {
  const intent = normalizeProposal(rawIntent);
  const argsHash = hash(canonicalIntentSerialize(intent));
  return signPoP(POP_SEED, { principalId: 'replay-admin', methodId: 'evaluateIntent', argsHash, nonce });
}

describe('council #1 — getChain() returns an immutable snapshot, not the live chain', () => {
  it('the returned chain is frozen and cannot be mutated', () => {
    _resetChain();
    evaluateIntent({ action: 'read_file', resource: 'x.txt', ring: 'local' } as any, null); // pushes a receipt
    const chain = getChain();
    expect(chain.length).toBe(1);
    expect(Object.isFrozen(chain)).toBe(true);
    expect(() => (chain as any).push({})).toThrow();
    expect(() => (chain as any).splice(0, 1)).toThrow();
    expect(() => ((chain as any)[0] = { tampered: true })).toThrow();
  });

  it('tampering the returned array cannot affect the real chain', () => {
    _resetChain();
    evaluateIntent({ action: 'read_file', resource: 'a' } as any, null);
    evaluateIntent({ action: 'read_file', resource: 'b' } as any, null);
    const before = getChain().length;
    try { (getChain() as any).push({ fake: true }); } catch { /* frozen — expected */ }
    expect(getChain().length).toBe(before); // real chain unchanged
  });

  it('each call returns a fresh snapshot, never the same live reference', () => {
    _resetChain();
    evaluateIntent({ action: 'read_file', resource: 'c' } as any, null);
    expect(getChain()).not.toBe(getChain());     // distinct array objects
    expect(getChain().length).toBe(getChain().length);
  });
});

describe('council #2 — _resetChain has no runtime-global bypass', () => {
  it('throws outside NODE_ENV=test even if a sentinel global is set', () => {
    const prev = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      expect(() => _resetChain()).toThrow(/test-only/);
      (globalThis as any).__AUKORA_TEST_SENTINEL__ = true;        // the OLD bypass...
      expect(() => _resetChain()).toThrow(/test-only/);           // ...no longer works
    } finally {
      delete (globalThis as any).__AUKORA_TEST_SENTINEL__;
      process.env.NODE_ENV = prev;                                 // restore for other tests
    }
  });

  it('the production path no longer references the sentinel global', () => {
    expect(INDEX_SRC).not.toContain('__AUKORA_TEST_SENTINEL__');
  });
});

describe('council #3 — the nonce ledger is bounded, not an unbounded Set', () => {
  it('index.ts wires the BoundedNonceLedger organ', () => {
    expect(INDEX_SRC).toContain('BoundedNonceLedger');
    expect(INDEX_SRC).not.toMatch(/NonceLedger\s*=\s*new Set/);
  });

  it('replay protection still holds end-to-end: a reused nonce is refused after a golden success', () => {
    _resetChain();
    PrincipalRegistry.set('replay-admin', getTestPublicKey(POP_SEED));
    const raw = { action: 'read_file', resource: 'z.txt', ring: 'local' };
    const pop = validPoP(raw, 'nonce-replay-1');
    expect(evaluateIntent(raw as any, pop).verdict).toBe('golden_success'); // fresh nonce → golden
    expect(evaluateIntent(raw as any, pop).verdict).toBe('refused');        // same nonce → refused by the bounded ledger
    expect(getChain().length).toBe(2);
  });
});

describe('council #4 — cheap trust-anchor checks happen before lattice verification', () => {
  it('evaluateIntent checks the pinned registry/key/method/args before verifyPoP, then consumes the nonce last', () => {
    const body = INDEX_SRC.slice(INDEX_SRC.indexOf('export function evaluateIntent'), INDEX_SRC.indexOf('// Generate Receipt'));
    const registryAt = body.indexOf('PrincipalRegistry.get');
    const pinnedAt = body.indexOf('pinnedKey &&');
    const publicKeyAt = body.indexOf('pop.publicKey === pinnedKey');
    const verifyAt = body.indexOf('verifyPoP(pop)');
    const consumeAt = body.indexOf('NonceLedger.consume');

    expect(registryAt).toBeGreaterThanOrEqual(0);
    expect(pinnedAt).toBeGreaterThan(registryAt);
    expect(publicKeyAt).toBeGreaterThan(pinnedAt);
    expect(verifyAt).toBeGreaterThan(publicKeyAt);
    expect(consumeAt).toBeGreaterThan(verifyAt);
  });
});
