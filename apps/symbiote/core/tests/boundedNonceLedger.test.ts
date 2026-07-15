// Council finding #3 — the replay-nonce ledger must be bounded so a flood of distinct nonces cannot
// exhaust memory, while still rejecting replays of recent nonces.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BoundedNonceLedger } from '../src/boundedNonceLedger';
import { evaluateIntent, _resetChain, PrincipalRegistry, getChain } from '../src/index';
import { getTestPublicKey, signPoP, hash, canonicalIntentSerialize, verifyChain, type Receipt } from '../src/crypto';
import { normalizeProposal } from '../src/normalizer';

describe('BoundedNonceLedger — bounded replay ledger', () => {
  it('rejects replays: a seen nonce is remembered', () => {
    const l = new BoundedNonceLedger(10);
    expect(l.has('a')).toBe(false);
    l.add('a');
    expect(l.has('a')).toBe(true);
  });

  it('caps memory: size never exceeds max under a flood; FIFO-evicts the oldest', () => {
    const l = new BoundedNonceLedger(100);
    for (let i = 0; i < 10_000; i++) l.add('n' + i);
    expect(l.size).toBe(100);          // bounded — NOT 10,000
    expect(l.has('n9999')).toBe(true); // newest retained
    expect(l.has('n9900')).toBe(true); // within the window
    expect(l.has('n0')).toBe(false);   // oldest evicted
  });

  it('adding a duplicate does not grow the ledger or churn eviction', () => {
    const l = new BoundedNonceLedger(3);
    l.add('x'); l.add('x'); l.add('x');
    expect(l.size).toBe(1);
  });

  it('clear empties it', () => {
    const l = new BoundedNonceLedger(5);
    l.add('x'); l.add('y');
    l.clear();
    expect(l.size).toBe(0);
    expect(l.has('x')).toBe(false);
  });

  it('rejects an invalid max', () => {
    expect(() => new BoundedNonceLedger(0)).toThrow();
    expect(() => new BoundedNonceLedger(-1)).toThrow();
    expect(() => new BoundedNonceLedger(1.5)).toThrow();
  });
});

describe('BoundedNonceLedger.consume — ATOMIC check-and-add (the gate replay-truth)', () => {
  it('returns true the FIRST time, false on replay', () => {
    const l = new BoundedNonceLedger(10);
    expect(l.consume('a')).toBe(true);
    expect(l.consume('a')).toBe(false);
    expect(l.consume('b')).toBe(true);
  });
  it('fails closed on a malformed nonce (non-string / empty)', () => {
    const l = new BoundedNonceLedger(10);
    expect(l.consume(undefined as any)).toBe(false);
    expect(l.consume(123 as any)).toBe(false);
    expect(l.consume('')).toBe(false);
  });
  it('still caps memory under a flood (FIFO eviction via consume)', () => {
    const l = new BoundedNonceLedger(100);
    for (let i = 0; i < 10_000; i++) l.consume('n' + i);
    expect(l.size).toBe(100);
    expect(l.consume('n9999')).toBe(false); // newest still remembered
    expect(l.consume('n0')).toBe(true);     // oldest evicted -> consumable again (bounded-memory tradeoff)
  });
  it('EPOCH boundary (honest restart limitation): clear() opens a new epoch where a prior nonce is consumable again', () => {
    const l = new BoundedNonceLedger(10);
    expect(l.epoch).toBe(0);
    expect(l.consume('x')).toBe(true);
    expect(l.consume('x')).toBe(false);     // single-use WITHIN an epoch
    l.clear();                              // a reset / restart = a NEW epoch with an empty ledger
    expect(l.epoch).toBe(1);
    expect(l.consume('x')).toBe(true);      // DOCUMENTED limitation: replay protection is in-memory + epoch-bound
  });
});

describe('nonce/replay end-to-end through evaluateIntent (atomic; provenance + chain intact)', () => {
  const SEED = '55'.repeat(32);
  it('fresh nonce -> golden (provenance + monotonic seq); replay -> refused; verifyChain green', () => {
    _resetChain();
    PrincipalRegistry.set('nr-admin', getTestPublicKey(SEED));
    const raw = { action: 'read_file', resource: 'nr.txt', ring: 'local' };
    const intent = normalizeProposal(raw);
    const pop = signPoP(SEED, { principalId: 'nr-admin', methodId: 'evaluateIntent', argsHash: hash(canonicalIntentSerialize(intent)), nonce: 'nr-1' });
    const first = evaluateIntent(raw as any, pop);
    expect(first.verdict).toBe('golden_success');
    expect(first.receipt.provenance?.nonceHash).toBe(hash('nr-1')); // receipt STILL binds PoP provenance
    expect(first.receipt.seq).toBe(0);                              // monotonic seq intact
    expect(evaluateIntent(raw as any, pop).verdict).toBe('refused'); // SAME nonce -> atomic consume false
    expect(getChain().length).toBe(2);
    expect(verifyChain(getChain() as Receipt[])).toBe(true);        // chain still verifies
  });
  it('the gate uses the ATOMIC consume — no separable has/add path in evaluateIntent', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'index.ts'), 'utf-8');
    expect(src).toContain('NonceLedger.consume(');
    expect(src).not.toContain('NonceLedger.has(');
    expect(src).not.toContain('NonceLedger.add(');
  });
});
