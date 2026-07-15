// #105b — the approval challenge (anti-CSRF + informed-consent phrase). Pins Codex's requirements at the
// primitive level: wrong phrase refuses, stale (expired) refuses, replay (already-used) refuses, and a
// correct live phrase consumes exactly once. No bulk (one challenge per hash), no standing unlock (each is
// single-use and time-bound).
import { describe, it, expect } from 'vitest';
import {
  mintChallenge, verifyAndConsumeChallenge, sweepExpiredChallenges, generateChallengePhrase,
  DEFAULT_CHALLENGE_TTL_MS, type ChallengeStore,
} from '../src/aumlokApproveChallenge';

const HASH = 'a'.repeat(64);
const store = (): ChallengeStore => new Map();

describe('approval challenge — mint + verify (single-use, TTL, phrase-bound)', () => {
  it('a correct, live phrase verifies once and yields the binding nonce', () => {
    const s = store();
    const c = mintChallenge(s, HASH, 1000);
    expect(c.phrase.split('-')).toHaveLength(4); // human-readable words
    const v = verifyAndConsumeChallenge(s, HASH, c.phrase, 1500);
    expect(v).toEqual({ ok: true, nonce: c.nonce });
  });

  it('WRONG phrase refuses and does NOT consume the good challenge', () => {
    const s = store();
    const c = mintChallenge(s, HASH, 1000);
    expect(verifyAndConsumeChallenge(s, HASH, 'not-the-phrase-here', 1500)).toEqual({ ok: false, reason: 'phrase_mismatch' });
    // the real phrase still works afterward — a wrong guess never burns the challenge
    expect(verifyAndConsumeChallenge(s, HASH, c.phrase, 1500).ok).toBe(true);
  });

  it('REPLAY refuses — a consumed phrase cannot be used a second time (no standing unlock)', () => {
    const s = store();
    const c = mintChallenge(s, HASH, 1000);
    expect(verifyAndConsumeChallenge(s, HASH, c.phrase, 1500).ok).toBe(true);
    expect(verifyAndConsumeChallenge(s, HASH, c.phrase, 1600)).toEqual({ ok: false, reason: 'already_used' });
  });

  it('STALE refuses — an expired phrase is dead', () => {
    const s = store();
    const c = mintChallenge(s, HASH, 1000);
    const after = 1000 + DEFAULT_CHALLENGE_TTL_MS + 1;
    expect(verifyAndConsumeChallenge(s, HASH, c.phrase, after)).toEqual({ ok: false, reason: 'expired' });
  });

  it('no challenge for a hash refuses (cannot approve a proposal no challenge was minted for)', () => {
    expect(verifyAndConsumeChallenge(store(), HASH, 'anything', 1000)).toEqual({ ok: false, reason: 'no_challenge' });
  });

  it('minting a new challenge REPLACES the prior one for the same hash (only the newest is live)', () => {
    const s = store();
    const c1 = mintChallenge(s, HASH, 1000);
    const c2 = mintChallenge(s, HASH, 1010);
    expect(c2.phrase).not.toBe(c1.phrase); // overwhelmingly likely distinct; and the old one is gone
    expect(verifyAndConsumeChallenge(s, HASH, c1.phrase, 1020).ok).toBe(false); // old phrase dead
    expect(verifyAndConsumeChallenge(s, HASH, c2.phrase, 1020).ok).toBe(true);
  });

  it('sweep drops expired challenges', () => {
    const s = store();
    mintChallenge(s, HASH, 1000);
    sweepExpiredChallenges(s, 1000 + DEFAULT_CHALLENGE_TTL_MS + 1);
    expect(s.size).toBe(0);
  });

  it('phrases are distinct across mints (fresh randomness per request)', () => {
    const seen = new Set(Array.from({ length: 40 }, () => generateChallengePhrase()));
    expect(seen.size).toBeGreaterThan(35); // essentially all distinct
  });
});
