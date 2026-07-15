// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/** Deterministic OFFLINE tests for the Fu round controller. No network, no keys, no I/O. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CANONICAL_SEATS, SpendMeter } from '../src/aukoraFuCouncil';
import { runFuRound } from '../tools/fu-round/controller';
import { newMeter, syntheticFixtureTransport, offlineTransport, liveOpenRouterTransport } from '../tools/fu-round/transport';
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

// ── Round-22 hardening: adjudicated vector fixes ──────────────────────────────────────────────────
import * as nodefs from 'node:fs';
import * as nodeos from 'node:os';
import * as nodepath from 'node:path';
import { safeReadTargetFile } from '../tools/fu-round/reader';

describe('V3: safe target reader (symlink / dir / oversize)', () => {
  const dir = nodefs.mkdtempSync(nodepath.join(nodeos.tmpdir(), 'fu-reader-'));
  it('refuses a symlink (never follows it)', () => {
    const real = nodepath.join(dir, 'secret.txt'); nodefs.writeFileSync(real, 'private');
    const link = nodepath.join(dir, 'link.md');
    try { nodefs.symlinkSync(real, link); } catch { return; } // skip if symlinks unavailable
    const r = safeReadTargetFile(link);
    expect(r.ok).toBe(false); if (r.ok) return; expect(r.code).toBe('E_SYMLINK_REFUSED');
  });
  it('refuses a directory and a missing path', () => {
    expect((safeReadTargetFile(dir) as any).code).toBe('E_MISSING_EVIDENCE');
    expect((safeReadTargetFile(nodepath.join(dir, 'nope')) as any).code).toBe('E_MISSING_EVIDENCE');
  });
  it('refuses oversize (no silent truncation) and reads a normal file', () => {
    const big = nodepath.join(dir, 'big.md'); nodefs.writeFileSync(big, 'x'.repeat(2048));
    expect((safeReadTargetFile(big, 1024) as any).code).toBe('E_LIMIT_FILE_BYTES');
    const ok = nodepath.join(dir, 'ok.md'); nodefs.writeFileSync(ok, 'hello');
    const r = safeReadTargetFile(ok); expect(r.ok && r.content).toBe('hello');
  });
});

describe('V4: secret scan of the bytes that reach a provider (problem/claims)', () => {
  it('refuses a secret-shaped problem statement', async () => {
    const meter = newMeter();
    const r = await runFuRound(base({ problem: 'review sk-or-' + 'a'.repeat(24), transport: offlineTransport(meter), meter }));
    expect(r.ok).toBe(false); if (r.ok) return; expect(r.code).toBe('E_SECRET_CONTENT');
  });
  it('refuses a secret-shaped claim', async () => {
    const meter = newMeter();
    const r = await runFuRound(base({ claims: ['fine', 'ghp_' + 'a'.repeat(36)], transport: offlineTransport(meter), meter }));
    expect(r.ok).toBe(false); if (r.ok) return; expect(r.code).toBe('E_SECRET_CONTENT');
  });
});

describe('V1: modes are structurally exclusive', () => {
  it('a non-live mode cannot record a provider contact or paid calls', () => {
    const g = { schema: 'aukora-fu-round-v1', mode: 'synthetic', liveEligible: false,
      target: { repoId: 'r', commit: COMMIT, tree: TREE, path: 'p.md' }, evidencePackDigest: 'a'.repeat(64),
      claimBasisDigest: 'b'.repeat(64), requestedRoster: [], servedRoster: [], seats: [], votes: 0, nonVotes: [],
      dissent: { verdict: 'insufficient-quorum', geometrySuspect: false, dissentingSeatIds: [] },
      quorum: { met: false, minVotes: 6, minFamilies: 6, requireSeatId: 'FBL', votingFamilies: 0, fableVerified: false },
      synthesis: { source: 'insufficient-quorum', answer: 'x', usedClaims: null },
      providerContacted: true, paidCalls: 0, estimatedCostMicroUsd: 0, actualCostMicroUsd: 0,
      advisoryOnly: true, grantsAuthority: false };
    expect((validateFuRoundArtifact(g) as any).code).toBe('E_MODE_EXCLUSIVE');
  });
});

describe('V8 + V11: spend ceiling refusal + frozen artifact', () => {
  it('refuses when the worst-case estimate breaches the spend ceiling', async () => {
    const meter = newMeter();
    const r = await runFuRound(base({ transport: syntheticFixtureTransport(allSeatsVote(), meter), meter, spend: new SpendMeter({ perPassUsd: 0.0001, perDayUsd: 0.0001 }) }));
    expect(r.ok).toBe(false); if (r.ok) return; expect(r.code).toBe('E_SPEND_CEILING');
  });
  it('the returned artifact is deeply frozen', async () => {
    const meter = newMeter();
    const r = await runFuRound(base({ transport: syntheticFixtureTransport(allSeatsVote(), meter), meter }));
    expect(r.ok).toBe(true); if (!r.ok) return;
    expect(Object.isFrozen(r.artifact)).toBe(true);
    expect(Object.isFrozen(r.artifact.target)).toBe(true);
    expect(Object.isFrozen(r.artifact.seats)).toBe(true);
  });
});

// ── Round-24 hardening: live-transport cost accounting + non-circular integrity ────────────────────
// A minimal fake Response: `body: null` routes readBoundedJson through its `res.text()` fallback path,
// so no ReadableStream is needed. Exercises the REAL liveOpenRouterTransport (mocked fetch, no network).
function fakeRes(status: number, bodyObj: unknown): unknown {
  const text = JSON.stringify(bodyObj);
  return { ok: status >= 200 && status < 300, status, body: null, text: async () => text };
}
const CATALOGUE = { data: CANONICAL_SEATS.map((s) => ({ id: s.slug })) }; // advertise all 8 seat slugs

describe('R24: provider-missing cost fallback', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it('a successful paid call that omits usage.cost is charged the worst-case, never $0', async () => {
    vi.stubGlobal('fetch', async (url: unknown, init?: { body?: string }) => {
      if (String(url).includes('/models')) return fakeRes(200, CATALOGUE);
      const model = JSON.parse(init!.body!).model as string;
      // 200 OK, served == requested, a valid packet, usage present but NO `cost` field.
      return fakeRes(200, { model, choices: [{ message: { content: pkt() }, finish_reason: 'stop' }], usage: { completion_tokens: 100 } });
    });
    const meter = newMeter();
    const r = await runFuRound(base({ mode: 'live', transport: liveOpenRouterTransport('sk-test-key', meter), meter, spend: new SpendMeter() }));
    expect(r.ok).toBe(true); if (!r.ok) return;
    const a = r.artifact;
    expect(a.providerContacted).toBe(true);
    expect(a.paidCalls).toBeGreaterThan(0);
    // No paid seat is free despite the missing usage.cost — each is charged ≥ one call's worst-case.
    for (const seat of a.seats) {
      const cs = CANONICAL_SEATS.find((c) => c.id === seat.seatId)!;
      const perCallMicro = Math.round((cs.costPer1M * 900 / 1_000_000) * 1_000_000);
      expect(seat.costMicroUsd).toBeGreaterThanOrEqual(perCallMicro);
    }
    expect(a.actualCostMicroUsd).toBeGreaterThan(0);
  });
});

describe('R24: abort/orphan billing accounting', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it('a paid call that throws after dispatch is charged worst-case and recorded as a non-vote', async () => {
    const victim = CANONICAL_SEATS[1]!; // QWN — a non-required seat, so the run still assembles an artifact
    vi.stubGlobal('fetch', async (url: unknown, init?: { body?: string }) => {
      if (String(url).includes('/models')) return fakeRes(200, CATALOGUE);
      const model = JSON.parse(init!.body!).model as string;
      if (model === victim.slug) throw new Error('network abort after send'); // orphaned paid call
      return fakeRes(200, { model, choices: [{ message: { content: pkt() }, finish_reason: 'stop' }], usage: { completion_tokens: 100, cost: 0.0001 } });
    });
    const meter = newMeter();
    const r = await runFuRound(base({ mode: 'live', transport: liveOpenRouterTransport('sk-test-key', meter), meter, spend: new SpendMeter() }));
    expect(r.ok).toBe(true); if (!r.ok) return;
    const a = r.artifact;
    const seat = a.seats.find((s) => s.seatId === victim.id)!;
    expect(seat.status.startsWith('nonvote')).toBe(true);      // orphaned → non-vote, never a silent success
    expect(seat.costMicroUsd).toBeGreaterThan(0);              // R24: the possibly-billed orphan IS charged
    // the top-level actual is never below any single seat's charge (Math.max reconciliation in the controller)
    expect(a.actualCostMicroUsd).toBeGreaterThanOrEqual(seat.costMicroUsd);
  });
});

describe('R24: integrity is external (no circular self-attestation)', () => {
  it('an independent verifier reproduces the digest from the serialized bytes alone', async () => {
    const meter = newMeter();
    const r = await runFuRound(base({ transport: syntheticFixtureTransport(allSeatsVote(), meter), meter }));
    expect(r.ok).toBe(true); if (!r.ok) return;
    const producerDigest = fuRoundDigest(r.artifact);
    // A verifier only ever receives the bytes — not the producer's live/frozen object, its meter, or closures.
    const overWire = JSON.parse(JSON.stringify(r.artifact)) as FuRoundArtifactV1;
    expect(Object.isFrozen(overWire)).toBe(false); // genuinely a distinct object graph
    expect(fuRoundDigest(overWire)).toBe(producerDigest);
    expect(validateFuRoundArtifact(overWire).ok).toBe(true);
    // The artifact carries NO field asserting its own verification/authenticity — integrity is recomputed,
    // not self-claimed; and it never grants authority.
    expect((r.artifact as unknown as Record<string, unknown>).verified).toBeUndefined();
    expect((r.artifact as unknown as Record<string, unknown>).sealed).toBeUndefined();
    expect((r.artifact as unknown as Record<string, unknown>).signature).toBeUndefined();
    expect(r.artifact.grantsAuthority).toBe(false);
    expect(r.artifact.advisoryOnly).toBe(true);
  });
  it('tampering with any field changes the digest (the seal binds content, not object identity)', async () => {
    const meter = newMeter();
    const r = await runFuRound(base({ transport: syntheticFixtureTransport(allSeatsVote(), meter), meter }));
    expect(r.ok).toBe(true); if (!r.ok) return;
    const tampered = JSON.parse(JSON.stringify(r.artifact)) as FuRoundArtifactV1;
    (tampered as { votes: number }).votes = tampered.votes + 1;
    expect(fuRoundDigest(tampered)).not.toBe(fuRoundDigest(r.artifact));
  });
});
