import { describe, expect, it } from 'vitest';
import { createEmptyBrain, eraseMemory, ingestMemory, recall, verifyBrainState } from '../src/kiraBrain';
import {
  convexContractSummary,
  convexMirrorGrantsAuthority,
  fromConvexMirror,
  toConvexMirror,
} from '../src/kiraConvexMirror';

describe('Kira Convex mirror contract', () => {
  it('round-trips the brain through Convex-shaped rows without changing recall', () => {
    let state = createEmptyBrain('2026-07-01T00:00:00.000Z');
    state = ingestMemory(state, {
      text: 'Convex persistence stores Kira receipts and atoms as durable rows.',
      source: 'contract',
      scope: 'convex',
      tags: ['convex', 'persistence'],
      now: '2026-07-01T00:00:01.000Z',
    }).state;

    const mirror = toConvexMirror(state);
    expect(mirror.head).toMatchObject({
      table: 'kira_head',
      receiptCount: 1,
      atomCount: 1,
      grantsAuthority: false,
    });
    expect(mirror.receipts[0].table).toBe('kira_receipts');
    expect(mirror.atoms[0].table).toBe('kira_atoms');
    expect(convexMirrorGrantsAuthority(mirror)).toBe(false);

    const restored = fromConvexMirror(mirror);
    expect(restored.receipts[0].id).toBe(state.receipts[0].id);
    expect(recall(restored, 'convex durable rows', 1).hits[0].receiptId).toBe(state.receipts[0].id);
  });

  it('HARDENING: carries erasure marks through the round-trip (recall stays dead, containment survives)', () => {
    let state = createEmptyBrain('2026-07-01T00:00:00.000Z');
    state = ingestMemory(state, { text: 'a secret to be forgotten', source: 'x', scope: 'y', now: '2026-07-01T00:00:01.000Z' }).state;
    state = ingestMemory(state, { text: 'a fact that stays', source: 'x', scope: 'z', now: '2026-07-01T00:00:02.000Z' }).state;
    const erased = eraseMemory(state, state.atoms[0].id, { now: '2026-07-01T00:00:03.000Z' });
    const mirror = toConvexMirror(erased.state);
    expect(mirror.head.erasedCount).toBe(1);
    const back = fromConvexMirror(mirror);
    const a = back.atoms.find((x) => x.id === state.atoms[0].id)!;
    expect(a.erased).toBe(true); // NOT silently un-erased on the round-trip
    expect(recall(back, 'secret forgotten').hits.map((h) => h.atomId)).not.toContain(a.id);
    expect(verifyBrainState(back)).toMatchObject({ ok: true, erasedCount: 1 });
  });

  it('HARDENING: carries quarantine marks through the round-trip (jailed content is not resurrected)', () => {
    let state = createEmptyBrain('2026-07-01T00:00:00.000Z');
    state = ingestMemory(state, { text: 'healthy atom', source: 'x', scope: 'y', now: '2026-07-01T00:00:01.000Z' }).state;
    // simulate a load-time quarantine mark on the atom
    (state.atoms[0] as { quarantined?: true; quarantineReason?: string }).quarantined = true;
    (state.atoms[0] as { quarantineReason?: string }).quarantineReason = 'content hash mismatch';
    const mirror = toConvexMirror(state);
    expect(mirror.head.quarantinedCount).toBe(1);
    const back = fromConvexMirror(mirror);
    expect(back.atoms[0].quarantined).toBe(true); // NOT un-jailed
    expect(recall(back, 'healthy atom').hits.length).toBe(0);
  });

  it('rejects tampered Convex rows that break the receipt chain', () => {
    const state = ingestMemory(createEmptyBrain(), {
      text: 'Tamper detection must survive the Convex mirror.',
      source: 'contract',
      scope: 'verify',
    }).state;
    const mirror = toConvexMirror(state);
    mirror.receipts[0].previousHash = 'fake';
    expect(() => fromConvexMirror(mirror)).toThrow(/invalid_rows/);
  });

  it('states the Convex law honestly', () => {
    expect(convexContractSummary()).toContain('does not add authority');
    expect(convexContractSummary()).toContain('advisory-only');
  });
});
