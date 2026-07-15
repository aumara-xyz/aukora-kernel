// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Hermetic tests for the R5b recall benchmark yardstick: deterministic probe derivation, honest
// scoring (errors count as misses), and the report's boundary lines as CONTRACT — the evidence
// report must always state the recall source in force (convex since the step-4 cutover) and
// that its numbers are evidence, never authority.
import { describe, it, expect } from 'vitest';
import { createEmptyBrain, ingestMemory, recall, type KiraBrainState } from '../src/kiraBrain';
import { deriveProbeQueries, scoreCandidate, renderEvidenceReport } from '../src/recallBenchmark';

function fixtureBrain(): KiraBrainState {
  let state = createEmptyBrain('2026-07-07T00:00:00.000Z');
  const texts = [
    'the send button stays teal for the demo, decided with the owner',
    'convex backend runs loopback only on port three-two-one-zero, provisioned by brain setup',
    'the rehearsal queue archives every executed order under the archive subdirectory',
    'aumlok keygen ceremony creates an ed25519 keypair under owner-only permissions',
    'the flight recorder chains events by hash so tampering breaks the chain visibly',
    'kira recall ranks atoms with lexical trigram and topology perceivers together',
  ];
  for (const text of texts) state = ingestMemory(state, { text, source: 'bench-fixture' }).state;
  return state;
}

describe('deriveProbeQueries — deterministic, law-respecting', () => {
  it('derives one probe per eligible atom, deterministically (same input, same queries)', () => {
    const state = fixtureBrain();
    const a = deriveProbeQueries(state);
    const b = deriveProbeQueries(state);
    expect(a).toEqual(b);
    expect(a.length).toBe(6);
    for (const q of a) expect(q.relevantAtomIds.length).toBe(1);
  });

  it('excludes erased and quarantined atoms (recall law) and honors the cap', () => {
    const state = fixtureBrain();
    (state.atoms[0] as { erased?: true }).erased = true;
    (state.atoms[1] as { quarantined?: true }).quarantined = true;
    const qs = deriveProbeQueries(state, { maxQueries: 3 });
    expect(qs.length).toBe(3);
    const banned = new Set([state.atoms[0].id, state.atoms[1].id]);
    for (const q of qs) expect(banned.has(q.relevantAtomIds[0])).toBe(false);
  });

  it('skips atoms too short to probe fairly', () => {
    let state = createEmptyBrain('2026-07-07T00:00:00.000Z');
    state = ingestMemory(state, { text: 'ok yes', source: 'x' }).state;
    expect(deriveProbeQueries(state).length).toBe(0);
  });
});

describe('scoreCandidate — honest metrics', () => {
  const QS = [
    { id: 'q1', query: 'alpha', relevantAtomIds: ['a1'] },
    { id: 'q2', query: 'beta', relevantAtomIds: ['a2'] },
  ];

  it('a perfect candidate scores hit@1 = 1 and MRR = 1', async () => {
    const s = await scoreCandidate('perfect', QS, async (q) => [{ atomId: q === 'alpha' ? 'a1' : 'a2' }]);
    expect(s.hitAt1).toBe(1);
    expect(s.mrr).toBe(1);
    expect(s.advisoryOnly).toBe(true);
    expect(s.grantsAuthority).toBe(false);
  });

  it('rank-2 answers earn hit@3 but not hit@1; MRR reflects the rank', async () => {
    const s = await scoreCandidate('second', QS, async (q) => [{ atomId: 'wrong' }, { atomId: q === 'alpha' ? 'a1' : 'a2' }]);
    expect(s.hitAt1).toBe(0);
    expect(s.hitAt3).toBe(1);
    expect(s.mrr).toBeCloseTo(0.5, 5);
  });

  it('an ERRORING candidate counts misses, never throws (an engine that errors did not find it)', async () => {
    const s = await scoreCandidate('broken', QS, async () => { throw new Error('boom'); });
    expect(s.hitAt5).toBe(0);
    expect(s.mrr).toBe(0);
  });

  it('the real kira.recall baseline clears the fixture floor (finds its own atoms)', async () => {
    const state = fixtureBrain();
    const qs = deriveProbeQueries(state);
    const s = await scoreCandidate('kira', qs, async (q, k) => recall(state, q, k).hits.map((h) => ({ atomId: h.atomId })));
    expect(s.hitAt5).toBeGreaterThan(0.8); // the floor any contender must clear
  });
});

describe('renderEvidenceReport — the boundary lines are contract', () => {
  it('always states the pinned recall source, the not-claimed cutover, and absent candidates plainly', async () => {
    const state = fixtureBrain();
    const qs = deriveProbeQueries(state);
    const baseline = await scoreCandidate('kira.recall (baseline)', qs, async (q, k) => recall(state, q, k).hits.map((h) => ({ atomId: h.atomId })));
    const report = renderEvidenceReport({
      corpusLabel: 'fixture',
      atomCount: state.atoms.length,
      liveAtomCount: state.atoms.length,
      queries: qs,
      baseline,
      candidates: [],
      absentCandidates: [{ name: 'convex recall (R5b candidate)', reason: 'NOT BUILT — no kernel search/recall function' }],
    });
    expect(report).toContain("recall.source: 'convex'");
    expect(report).toContain('kira-json-legacy');
    expect(report).toContain('NOT authority');
    expect(report).toContain('NOT BUILT');
    expect(report).toContain('demonstrably');
    expect(report).toContain('kira.recall (baseline)');
    expect(report).toContain('advisoryOnly: true');
  });
});
