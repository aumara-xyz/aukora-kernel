// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// aura-trace-v1 pins (AURA lane round 2). The epoch is a QUALITATIVE substrate: ordered one-way
// commitments to governed receipt-chain evidence, deterministic commitment + glyph seed, optional
// drand freshness evidence, truth limits stamped verbatim — and NEVER a score, balance, rank,
// count-as-AURA, or personhood number. Every rule the CODEX round-2 instruction names is pinned:
// deterministic replay, input reordering, tamper/missing commitments, malformed drand, the
// no-authority literals, forbidden numeric-AURA fields, privacy bounds, erased-source behavior.
import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import {
  buildAuraTraceEpoch,
  verifyAuraTraceEpoch,
  commitEvidence,
  AuraTraceError,
  TRACE_LIMITS,
  MAX_TRACE_COMMITMENTS,
  auraTraceGrantsAuthority,
  type TraceEvidenceInput,
} from '../src/auraTrace';

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const OWNER = 'aumara.root';
const AT = '2026-07-10T12:00:00.000Z';

// Fixture evidence: chain keys + head hashes shaped exactly like the governed store's chains.
const ev = (key: string, salt = 'head'): TraceEvidenceInput => ({
  chainKey: `mem:${OWNER}:${key}`,
  chainHeadHash: sha(`${salt}:${key}`),
});
const EVIDENCE = [ev('canon.safety-laws.76905af79b5f'), ev('turn.20260708t011134662z.0'), ev('focus.20260708t040707185z.0')];
// Real quicknet round, already pinned by drandAnchor.test.ts. The AURA trace independently
// verifies this signature against the repository's pinned chain key, fully offline.
const DRAND = {
  round: 30_226_057,
  randomness: '95443ca4a22318a59f34f9a1933d2afa8cfc1df8a05bc0f1020993c351e1f109',
  signature: '8a60dcbcfc1036a69c229bbc5ff59ced72d960fa13dcb7e1561201afa918210fb5a668c9b251fc794d54705dcb5c3369',
};

const build = (over: Partial<Parameters<typeof buildAuraTraceEpoch>[0]> = {}) =>
  buildAuraTraceEpoch({ epochOf: OWNER, at: AT, evidence: EVIDENCE, drand: DRAND, prevEpochCommitment: null, ...over });

describe('determinism — same ordered inputs, same epoch, forever', () => {
  it('replays byte-identically: commitment, glyph seed, whole payload', () => {
    const a = build();
    const b = build();
    expect(a).toEqual(b);
    expect(a.epochCommitment).toMatch(/^[0-9a-f]{64}$/);
    expect(a.glyphSeed).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyAuraTraceEpoch(a)).toMatchObject({ valid: true, epochCommitment: a.epochCommitment });
  });

  it('REORDERED inputs are a DIFFERENT epoch — order is identity, never silently normalized', () => {
    const a = build();
    const reordered = build({ evidence: [EVIDENCE[1], EVIDENCE[0], EVIDENCE[2]] });
    expect(reordered.epochCommitment).not.toBe(a.epochCommitment);
    expect(reordered.glyphSeed).not.toBe(a.glyphSeed);
    // and the ORIGINAL epoch refuses to verify against reordered live evidence
    const v = verifyAuraTraceEpoch(a, { evidence: [EVIDENCE[1], EVIDENCE[0], EVIDENCE[2]] });
    expect(v).toMatchObject({ valid: false, reason: expect.stringContaining('trace_evidence_mismatch_at') });
  });

  it('a MISSING or EXTRA source fails the count check — never padded, never guessed', () => {
    const a = build();
    expect(verifyAuraTraceEpoch(a, { evidence: EVIDENCE.slice(0, 2) })).toMatchObject({ valid: false, reason: 'trace_evidence_count_mismatch' });
    expect(verifyAuraTraceEpoch(a, { evidence: [...EVIDENCE, ev('extra.row')] })).toMatchObject({ valid: false, reason: 'trace_evidence_count_mismatch' });
  });

  it('epoch chaining: prevEpochCommitment changes the identity (continuity across epochs)', () => {
    const genesis = build();
    const second = build({ prevEpochCommitment: genesis.epochCommitment });
    expect(second.epochCommitment).not.toBe(genesis.epochCommitment);
    expect(verifyAuraTraceEpoch(second)).toMatchObject({ valid: true });
  });
});

describe('tamper — every altered byte is a refusal, never a repair', () => {
  it('an edited commitment, timestamp, owner, drand round, or randomness all fail closed', () => {
    const a = build();
    for (const mutate of [
      (x: any) => { x.commitments = [...x.commitments]; x.commitments[0] = sha('forged'); },
      (x: any) => { x.at = '2026-07-11T12:00:00.000Z'; },
      (x: any) => { x.epochOf = 'someone.else'; },
      (x: any) => { x.drand = { ...x.drand, round: x.drand.round + 1 }; },
      (x: any) => { x.drand = { ...x.drand, randomness: sha('forged-randomness') }; },
      (x: any) => { x.prevEpochCommitment = sha('fake-parent'); },
    ]) {
      const copy = JSON.parse(JSON.stringify(a));
      mutate(copy);
      const verdict = verifyAuraTraceEpoch(copy);
      expect(verdict.valid).toBe(false);
      if (!verdict.valid) expect(verdict.reason).toMatch(/^trace_/);
    }
  });

  it('a forged glyph seed is caught even when the commitment matches', () => {
    const copy = JSON.parse(JSON.stringify(build()));
    copy.glyphSeed = sha('prettier-shape-please');
    expect(verifyAuraTraceEpoch(copy)).toMatchObject({ valid: false, reason: 'trace_glyph_seed_mismatch' });
  });

  it('a CHANGED live source (the erased-source case) fails verification at its index', () => {
    const a = build();
    // erasure grows the chain: the head hash changes; the old epoch must fail against live evidence
    const live = [EVIDENCE[0], { ...EVIDENCE[1], chainHeadHash: sha('head-after-erasure-receipt') }, EVIDENCE[2]];
    expect(verifyAuraTraceEpoch(a, { evidence: live })).toMatchObject({ valid: false, reason: 'trace_evidence_mismatch_at:1' });
    // while the payload itself stays internally consistent — history is not rewritten, it is outgrown
    expect(verifyAuraTraceEpoch(a)).toMatchObject({ valid: true });
  });
});

describe('malformed inputs — typed, fail-closed, no best-effort epochs', () => {
  it('builder refuses bad owners, timestamps, evidence shapes, drand, and overflow', () => {
    const code = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof AuraTraceError) return e.code; throw e; } return 'no-throw'; };
    expect(code(() => build({ epochOf: 'NOT VALID!' }))).toBe('trace_owner_invalid');
    expect(code(() => build({ at: 'yesterday-ish' }))).toBe('trace_at_invalid');
    expect(code(() => build({ evidence: [] }))).toBe('trace_evidence_empty');
    expect(code(() => build({ evidence: [{ chainKey: '../etc', chainHeadHash: sha('x') }] }))).toBe('trace_chain_key_invalid');
    expect(code(() => build({ evidence: [{ chainKey: `mem:${OWNER}:k`, chainHeadHash: 'short' }] }))).toBe('trace_head_hash_invalid');
    expect(code(() => build({ drand: { round: -5, randomness: sha('x'), signature: DRAND.signature } }))).toBe('trace_drand_invalid');
    expect(code(() => build({ drand: { round: 9, randomness: 'nope', signature: 'nope' } }))).toBe('trace_drand_invalid');
    expect(code(() => build({ drand: { ...DRAND, signature: `0${DRAND.signature.slice(1)}` } }))).toBe('trace_drand_unverified');
    expect(code(() => build({ drand: { ...DRAND, randomness: sha('wrong') } }))).toBe('trace_drand_randomness_mismatch');
    expect(code(() => build({ evidence: Array.from({ length: MAX_TRACE_COMMITMENTS + 1 }, (_, i) => ev(`k${i}`)) }))).toBe('trace_evidence_overflow');
  });

  it('verifier refuses malformed drand evidence in a stored epoch', () => {
    const copy = JSON.parse(JSON.stringify(build()));
    copy.drand = { ...copy.drand, round: 'seventeen' };
    expect(verifyAuraTraceEpoch(copy)).toMatchObject({ valid: false, reason: 'trace_drand_malformed' });
  });

  it('verifier rejects uncommitted nested carriers in drand and limits', () => {
    const drandCarrier = JSON.parse(JSON.stringify(build()));
    drandCarrier.drand.note = 'hidden content';
    expect(verifyAuraTraceEpoch(drandCarrier)).toMatchObject({ valid: false, reason: 'trace_drand_shape_invalid' });

    const limitsCarrier = JSON.parse(JSON.stringify(build()));
    limitsCarrier.limits.note = 'hidden content';
    expect(verifyAuraTraceEpoch(limitsCarrier)).toMatchObject({ valid: false, reason: 'trace_limits_shape_invalid' });
  });

  it('an epoch without drand claims NO freshness — honestly', () => {
    const a = build({ drand: null });
    const v = verifyAuraTraceEpoch(a);
    expect(v.valid).toBe(true);
    if (v.valid) expect(v.claims.freshness).toBe('none claimed');
  });
});

describe('the boundaries travel with the payload — or the payload is refused', () => {
  it('the no-authority literals are required', () => {
    for (const strip of [(x: any) => { x.advisoryOnly = false; }, (x: any) => { x.grantsAuthority = true; }]) {
      const copy = JSON.parse(JSON.stringify(build()));
      strip(copy);
      expect(verifyAuraTraceEpoch(copy).valid).toBe(false);
    }
  });

  it('the stamped limits must be VERBATIM — a softened boundary is a refusal', () => {
    const copy = JSON.parse(JSON.stringify(build()));
    copy.limits = { ...copy.limits, drand: 'proves you are a fresh human' }; // the lie
    expect(verifyAuraTraceEpoch(copy)).toMatchObject({ valid: false, reason: 'trace_limits_altered:drand' });
  });

  it('forbidden numeric-AURA fields are refused anywhere in the payload, however nested', () => {
    for (const inject of [
      (x: any) => { x.score = 97; },
      (x: any) => { x.drand = { ...x.drand, personhood: 0.93 }; },
      (x: any) => { x.limits = { ...x.limits, aura: 42 }; },
    ]) {
      const copy = JSON.parse(JSON.stringify(build()));
      inject(copy);
      const v = verifyAuraTraceEpoch(copy);
      expect(v.valid).toBe(false);
      expect((v as { reason: string }).reason).toMatch(/trace_forbidden_field|trace_unknown_field/);
    }
  });

  it('valid claims come with their limits FUSED — no quotable claim without its boundary', () => {
    const v = verifyAuraTraceEpoch(build());
    expect(v.valid).toBe(true);
    if (v.valid) {
      expect(v.claims.continuity).toContain(TRACE_LIMITS.receipts);
      expect(v.claims.freshness).toContain(TRACE_LIMITS.drand);
      expect(v.claims.never).toBe(TRACE_LIMITS.never);
      expect(JSON.stringify(v.claims)).not.toMatch(/\bhuman\b(?!ity)/i); // no humanity claim sneaks into claims text
    }
    expect(auraTraceGrantsAuthority()).toBe(false);
  });
});

describe('privacy bounds — commitments only, nothing recoverable', () => {
  it('the serialized epoch contains NO chain keys, row keys, or evidence hashes — only one-way commitments', () => {
    const a = build();
    const payload = JSON.stringify(a);
    for (const e of EVIDENCE) {
      expect(payload).not.toContain(e.chainKey);
      expect(payload).not.toContain(e.chainHeadHash);
      const rowKey = e.chainKey.split(':')[2];
      expect(payload).not.toContain(rowKey); // canon slugs / turn timestamps never leak
    }
    expect(payload).not.toContain('mem:');
    // and each carried commitment is exactly the domain-tagged one-way hash
    expect(a.commitments).toEqual(EVIDENCE.map(commitEvidence));
  });

  it('an epoch is bounded: strict field set, capped commitments, no free-form carriers', () => {
    const copy = JSON.parse(JSON.stringify(build()));
    copy.note = 'a place to smuggle content';
    expect(verifyAuraTraceEpoch(copy)).toMatchObject({ valid: false, reason: 'trace_unknown_field:note' });
  });
});
