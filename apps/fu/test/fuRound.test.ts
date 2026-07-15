// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/** Deterministic OFFLINE tests for the Fu round controller. No network, no keys, no I/O. */
import { describe, it, expect } from 'vitest';
import { CANONICAL_SEATS, SpendMeter } from '../src/aukoraFuCouncil';
import { runFuRound } from '../tools/fu-round/controller';
import { newMeter, syntheticFixtureTransport, offlineTransport } from '../tools/fu-round/transport';
import { fuRoundDigest, validateFuRoundArtifact, canonicalFuRound, type FuRoundArtifactV1 } from '../tools/fu-round/artifact';
import type { PackTargetFile } from '../tools/fu-round/pack';

const COMMIT = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const PROBLEM = 'Is the design sound and honest?';
const CLAIMS = ['internally consistent', 'not overclaimed'] as const;
const TARGET: PackTargetFile[] = [{ path: 'plan.md', content: '# Plan\nA sound, honest, in-scope design.\n' }];

// A well-formed glyph packet for a 2-claim basis (ids C1,C2).
function pkt(stance = '⊕'): string {
  return [
    '<<<AUKORA_FU_PACKET>>>',
    `STANCE:${stance} CONFIDENCE:↑ STRATEGY:↙ FRAMEWORK:statistical DIST:(explore=0.1,exploit=0.3,verify=0.5,abstain=0.1)`,
    'CLAIMS:(C1=0.8,C2=0.5)',
    'HYP:"the design holds"',
    '<<<END_AUKORA_FU_PACKET>>>',
  ].join('\n');
}
function allSeatsVote(): Record<string, { text: string; served?: string }> {
  const f: Record<string, { text: string; served?: string }> = {};
  for (const s of CANONICAL_SEATS) f[s.id] = { text: pkt(), served: s.slug };
  return f;
}
const base = (over: Record<string, unknown> = {}) => (({
  targetRepoId: 'aumara-xyz/aukora-fu', targetCommit: COMMIT, targetTree: TREE, reviewPath: 'plan.md',
  files: TARGET, mode: 'synthetic' as const, problem: PROBLEM, claims: CLAIMS,
  toolVersions: { 'fu-round': 'v1' }, spend: new SpendMeter(), now: 1000, ...over,
}) as unknown as Parameters<typeof runFuRound>[0]);

describe('Fu round controller — synthetic vote path', () => {
  it('8 valid packets → quorum met, artifact validates, NOT liveEligible (synthetic)', async () => {
    const meter = newMeter();
    const r = await runFuRound(base({ transport: syntheticFixtureTransport(allSeatsVote(), meter), meter }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const a = r.artifact;
    expect(a.votes).toBe(8);
    expect(a.quorum.met).toBe(true);
    expect(a.quorum.votingFamilies).toBe(8);
    expect(a.mode).toBe('synthetic');
    expect(a.liveEligible).toBe(false);       // requirement 8: synthetic can never claim live
    expect(a.providerContacted).toBe(false);  // synthetic contacts no provider
    expect(a.paidCalls).toBe(0);
    expect(a.advisoryOnly).toBe(true);
    expect(a.grantsAuthority).toBe(false);
    expect(validateFuRoundArtifact(a).ok).toBe(true);
  });
  it('artifact digest is deterministic (same inputs → same digest)', async () => {
    const run = async () => {
      const m = newMeter();
      const r = await runFuRound(base({ transport: syntheticFixtureTransport(allSeatsVote(), m), meter: m }));
      return r.ok ? fuRoundDigest(r.artifact) : 'REFUSED';
    };
    expect(await run()).toBe(await run());
  });
});

describe('Fu round controller — offline (no provider)', () => {
  it('all seats are no-provider non-votes; quorum unmet; no live claim', async () => {
    const meter = newMeter();
    const r = await runFuRound(base({ mode: 'offline', transport: offlineTransport(meter), meter }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const a = r.artifact;
    expect(a.votes).toBe(0);
    expect(a.quorum.met).toBe(false);
    expect(a.providerContacted).toBe(false);
    expect(a.paidCalls).toBe(0);
    expect(a.liveEligible).toBe(false);
    expect(a.seats.every((s) => s.status === 'nonvote_no_provider')).toBe(true);
    expect(a.servedRoster).toEqual([]);
    expect(a.synthesis.source).toBe('insufficient-quorum');
  });
});

describe('Fu round controller — no silent substitution', () => {
  it('a mismatched served identity becomes a non-vote', async () => {
    const fixtures = allSeatsVote();
    fixtures[CANONICAL_SEATS[0]!.id] = { text: pkt(), served: 'someone-else/wrong-model' };
    const meter = newMeter();
    const r = await runFuRound(base({ transport: syntheticFixtureTransport(fixtures, meter), meter }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const seat0 = r.artifact.seats.find((s) => s.seatId === CANONICAL_SEATS[0]!.id)!;
    expect(seat0.status.startsWith('nonvote')).toBe(true);
    expect(seat0.served).toBe('someone-else/wrong-model'); // recorded truthfully
    expect(r.artifact.votes).toBe(7);
  });
});

describe('Fu round controller — refusals (requirement 9)', () => {
  it('refuses missing evidence', async () => {
    const meter = newMeter();
    const r = await runFuRound(base({ files: [{ path: 'x.md', content: '   ' }], transport: offlineTransport(meter), meter }));
    expect(r.ok).toBe(false); if (r.ok) return; expect(r.code).toBe('E_MISSING_EVIDENCE');
  });
  it('refuses a mismatched (non-40-hex) target', async () => {
    const meter = newMeter();
    const r = await runFuRound(base({ targetCommit: 'nothex', transport: offlineTransport(meter), meter }));
    expect(r.ok).toBe(false); if (r.ok) return; expect(r.code).toBe('E_MISMATCHED_TARGET');
  });
  it('refuses secret-shaped target content', async () => {
    const meter = newMeter();
    const r = await runFuRound(base({ files: [{ path: 'c.md', content: 'key = sk-or-' + 'a'.repeat(24) }], transport: offlineTransport(meter), meter }));
    expect(r.ok).toBe(false); if (r.ok) return; expect(r.code).toBe('E_SECRET_CONTENT');
  });
});

describe('FuRoundArtifactV1 validator', () => {
  const good = (): FuRoundArtifactV1 => ({
    schema: 'aukora-fu-round-v1', mode: 'offline', liveEligible: false,
    target: { repoId: 'r', commit: COMMIT, tree: TREE, path: 'plan.md' },
    evidencePackDigest: 'a'.repeat(64), claimBasisDigest: 'b'.repeat(64),
    requestedRoster: ['x/y'], servedRoster: [], seats: [], votes: 0, nonVotes: [],
    dissent: { verdict: 'insufficient-quorum', geometrySuspect: false, dissentingSeatIds: [] },
    quorum: { met: false, minVotes: 6, minFamilies: 6, requireSeatId: 'FBL', votingFamilies: 0, fableVerified: false },
    synthesis: { source: 'insufficient-quorum', answer: 'x', usedClaims: null },
    providerContacted: false, paidCalls: 0, estimatedCostMicroUsd: 0, actualCostMicroUsd: 0,
    advisoryOnly: true, grantsAuthority: false,
  });
  it('accepts a well-formed artifact', () => { expect(validateFuRoundArtifact(good()).ok).toBe(true); });
  it('refuses an unknown field', () => { expect((validateFuRoundArtifact({ ...good(), extra: 1 }) as any).code).toBe('E_UNKNOWN_FIELD'); });
  it('refuses an authority literal', () => { expect((validateFuRoundArtifact({ ...good(), grantsAuthority: true }) as any).code).toBe('E_AUTHORITY_LITERAL'); });
  it('refuses a synthetic/offline artifact that claims liveEligible', () => {
    expect((validateFuRoundArtifact({ ...good(), mode: 'synthetic', liveEligible: true }) as any).code).toBe('E_LIVE_INELIGIBLE');
  });
  it('refuses secret-shaped content in the answer', () => {
    const a = good(); (a.synthesis as any).answer = 'leak sk-or-' + 'a'.repeat(24);
    expect((validateFuRoundArtifact(a) as any).code).toBe('E_SECRET_CONTENT');
  });
  it('canonical form round-trips', () => { expect(JSON.parse(canonicalFuRound(good())).schema).toBe('aukora-fu-round-v1'); });
});
