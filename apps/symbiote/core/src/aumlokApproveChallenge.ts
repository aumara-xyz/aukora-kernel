// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * #105b — the proposal-bound approval CHALLENGE. The device-local approve ceremony's anti-CSRF + informed-
 * consent primitive: before the local door will sign+apply a proposal, it mints a fresh, human-readable
 * challenge phrase BOUND to that exact proposalHash, shows it to the owner, and requires the owner to
 * re-enter it. A malicious cross-origin page cannot READ the phrase (the door serves it same-origin only,
 * no permissive CORS) and cannot GUESS it (fresh random words per request), so it can never forge an
 * approval — and even the legitimate UI cannot approve without the owner's deliberate re-entry.
 *
 * SINGLE-USE + SHORT-TTL: a phrase is consumed on first correct use and expires quickly, so a captured or
 * replayed phrase is dead. This is PURE (an in-memory store is passed in) so the door owns the lifetime and
 * this stays unit-testable. It signs NOTHING and grants NO authority — it only gates the owner's own gesture.
 */
import { randomBytes } from 'crypto';

/** A small, unambiguous wordlist (no homophones, no easily-confused pairs) — the phrase is read aloud/typed
 *  by a human, so clarity matters more than entropy density (4 words from 64 ≈ 16M combos, and the phrase is
 *  also single-use, short-TTL, and same-origin-only). */
const WORDS = [
  'amber', 'anchor', 'basin', 'birch', 'cedar', 'cinder', 'cobalt', 'copper',
  'coral', 'delta', 'ember', 'fern', 'flint', 'garnet', 'harbor', 'hazel',
  'indigo', 'ivory', 'jade', 'kelp', 'lark', 'linen', 'lumen', 'maple',
  'marsh', 'meadow', 'mica', 'north', 'ochre', 'onyx', 'opal', 'otter',
  'pebble', 'pewter', 'quartz', 'quill', 'raven', 'reef', 'river', 'rowan',
  'sable', 'sage', 'sand', 'seven', 'shale', 'slate', 'sorrel', 'spruce',
  'stone', 'storm', 'tansy', 'teal', 'thorn', 'tide', 'timber', 'umber',
  'vale', 'verdant', 'walnut', 'willow', 'wren', 'yarrow', 'zephyr', 'zinc',
] as const;
const PHRASE_WORDS = 4;

export interface ApprovalChallenge {
  proposalHash: string;
  phrase: string;
  nonce: string;      // carried into the signed authorization so the signature is bound to THIS challenge
  issuedAt: number;
  expiresAt: number;
  used: boolean;
}

export type ChallengeStore = Map<string, ApprovalChallenge>;

export const DEFAULT_CHALLENGE_TTL_MS = 120_000; // 2 minutes — long enough to read + type, short enough to be dead soon

function pickWord(): string {
  // rejection-sample a byte into [0,64) so the 64-word list has no modulo bias
  for (;;) {
    const b = randomBytes(1)[0];
    if (b < 256 - (256 % WORDS.length)) return WORDS[b % WORDS.length];
  }
}

/** A fresh human-readable phrase, e.g. "amber-otter-seven-quartz". */
export function generateChallengePhrase(): string {
  return generatePhraseOfWords(PHRASE_WORDS);
}

/** Same wordlist + unbiased sampling, caller-chosen length — the binding ceremony's standing phrase uses 5
 *  words (one more than a per-proposal challenge; it lives longer). ONE wordlist for every AUMLOK phrase so
 *  owners never learn two vocabularies. Bounded 1..12. */
export function generatePhraseOfWords(count: number): string {
  const n = Math.max(1, Math.min(12, Math.floor(count)));
  return Array.from({ length: n }, pickWord).join('-');
}

/**
 * Mint (or replace) the challenge for a proposal. Overwrites any prior challenge for the same hash — only the
 * newest is live, so an old phrase left on a stale UF tab is already dead. Returns the phrase to SHOW the owner
 * (and the nonce/expiry); the store keeps the authoritative copy. `nowMs` is injected for testability.
 */
export function mintChallenge(store: ChallengeStore, proposalHash: string, nowMs: number, ttlMs = DEFAULT_CHALLENGE_TTL_MS): ApprovalChallenge {
  const c: ApprovalChallenge = {
    proposalHash,
    phrase: generateChallengePhrase(),
    nonce: randomBytes(16).toString('hex'),
    issuedAt: nowMs,
    expiresAt: nowMs + ttlMs,
    used: false,
  };
  store.set(proposalHash, c);
  return c;
}

export type ChallengeVerdict =
  | { ok: true; nonce: string }
  | { ok: false; reason: 'no_challenge' | 'expired' | 'already_used' | 'phrase_mismatch' };

/**
 * Verify the owner's re-entered phrase against the live challenge for a proposal, and CONSUME it on success
 * (single-use). Fail-closed: no challenge, expired, already used, or a phrase that does not match EXACTLY all
 * refuse. A refused verify never consumes a good challenge (only a correct, live phrase consumes). Constant-ish
 * comparison is not required (the phrase is single-use + short-TTL + unguessable), but we still compare full
 * strings, never a prefix.
 */
export function verifyAndConsumeChallenge(store: ChallengeStore, proposalHash: string, phrase: string, nowMs: number): ChallengeVerdict {
  const c = store.get(proposalHash);
  if (!c) return { ok: false, reason: 'no_challenge' };
  if (nowMs > c.expiresAt) { store.delete(proposalHash); return { ok: false, reason: 'expired' }; }
  if (c.used) return { ok: false, reason: 'already_used' };
  if (typeof phrase !== 'string' || phrase !== c.phrase) return { ok: false, reason: 'phrase_mismatch' };
  c.used = true; // consume — a second confirm with the same phrase now refuses 'already_used'
  return { ok: true, nonce: c.nonce };
}

/** Drop expired challenges — the door may call this periodically so the store does not grow. Pure-ish (mutates the store). */
export function sweepExpiredChallenges(store: ChallengeStore, nowMs: number): void {
  for (const [k, c] of store) if (nowMs > c.expiresAt) store.delete(k);
}
