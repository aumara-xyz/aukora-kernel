// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * DRAND ANCHOR — externally verifiable proof-of-time for receipts (owner directive 2026-07-08).
 *
 * drand (drand.love) is the League of Entropy's public randomness beacon: every PERIOD seconds the
 * network emits a BLS threshold signature over the round number. Anyone, forever, can verify a round
 * against the network's pinned public key — so folding a round into one of our receipts proves the
 * receipt was created NO EARLIER than that round's time. (Precision note, kept honest: drand is a
 * verifiable randomness beacon, not a VDF; for anchoring "this existed by time T, provably" it gives
 * the same practical property, cheaper and audited.)
 *
 * Laws of this module:
 *   - ADVISORY ONLY. An anchor stamps receipts; it never gates, authorizes, or blocks anything
 *     (evidence is never authority — SAFETY_LAWS 3). Every record carries grantsAuthority:false.
 *   - ZERO-EGRESS BY DEFAULT. The one network fetch lives behind the owner's explicit
 *     AUKORA_DRAND_ANCHOR=1 (per-process env, re-read per call). Unarmed = no fetch, fail-closed,
 *     and callers proceed WITHOUT an anchor (a missing stamp is honest; a fake one is not).
 *   - PINNED TRUST. The quicknet chain public key is pinned IN THIS FILE — we verify rounds against
 *     the pin, never against whatever key the server claims. A response that fails BLS verification
 *     is discarded (verified:false is never returned; no anchor beats an unverified one).
 *   - Verification is PURE and OFFLINE (verifyDrandRound) — tests pin it with a captured live round.
 *
 * Scheme: quicknet · bls-unchained-g1-rfc9380 · 3s period. Unchained ⇒ message = sha256(BE64(round));
 * signature ∈ G1 (48B), public key ∈ G2 (96B); DST BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_.
 * Verification path proven live against round 30226057 before this module was written.
 */
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes } from '@noble/hashes/utils.js';

export const DRAND_CHAIN_HASH = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971'; // quicknet
export const DRAND_PUBLIC_KEY =
  '83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a';
export const DRAND_GENESIS_UNIX = 1692803367; // seconds
export const DRAND_PERIOD_S = 3;
const DST = 'BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_';
// Two independent operators of the same chain — the pin makes the transport untrusted anyway.
const ENDPOINTS = [
  `https://api.drand.sh/${DRAND_CHAIN_HASH}/public/latest`,
  `https://drand.cloudflare.com/${DRAND_CHAIN_HASH}/public/latest`,
];

export interface DrandAnchor {
  schema: 'drand-anchor-v1';
  chainHash: string;
  round: number;
  randomness: string;
  signature: string;
  /** BLS-verified against the PINNED chain key in this process — always true on a returned anchor. */
  verified: true;
  /** |fetched round − expected round for wall-clock now| in rounds; small = fresh, honest either way. */
  roundDriftFromClock: number;
  fetchedAt: string;
  advisoryOnly: true;
  grantsAuthority: false;
}

export function drandArmed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AUKORA_DRAND_ANCHOR === '1';
}

/** The round the beacon should be on at wall-clock `unixMs` (quicknet emits every 3s since genesis). */
export function expectedDrandRound(unixMs: number): number {
  return Math.floor((unixMs / 1000 - DRAND_GENESIS_UNIX) / DRAND_PERIOD_S) + 1;
}

/** PURE offline verification of one round against the pinned quicknet key. */
export function verifyDrandRound(round: number, signatureHex: string): boolean {
  try {
    if (!Number.isInteger(round) || round <= 0 || !/^[0-9a-f]{96}$/i.test(signatureHex)) return false;
    const be8 = new Uint8Array(8);
    new DataView(be8.buffer).setBigUint64(0, BigInt(round));
    const msg = sha256(be8); // unchained scheme: message binds the round number alone
    const sigPoint = bls12_381.G1.Point.fromHex(signatureHex);
    const pkPoint = bls12_381.G2.Point.fromHex(DRAND_PUBLIC_KEY);
    const hm = bls12_381.shortSignatures.hash(msg, DST);
    return bls12_381.shortSignatures.verify(sigPoint, hm, pkPoint) === true;
  } catch {
    return false; // malformed points/hex — an unverifiable round is no round
  }
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/**
 * Fetch + verify the latest round. NEVER throws. Unarmed → {ok:false} with zero network I/O.
 * A response that fails the pinned-key BLS check is treated as no response at all (fail-closed).
 */
export async function fetchDrandAnchor(
  deps: { env?: NodeJS.ProcessEnv; fetchImpl?: FetchLike; nowMs?: number } = {},
): Promise<{ ok: true; anchor: DrandAnchor } | { ok: false; reason: string }> {
  const env = deps.env ?? process.env;
  if (!drandArmed(env)) return { ok: false, reason: 'drand anchoring is not armed (owner-gated egress: set AUKORA_DRAND_ANCHOR=1)' };
  const fetchImpl: FetchLike = deps.fetchImpl ?? (fetch as unknown as FetchLike);
  const nowMs = deps.nowMs ?? Date.now();
  let lastErr = 'no endpoint answered';
  for (const url of ENDPOINTS) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) { lastErr = `endpoint refused: ${url}`; continue; }
      const body = (await res.json()) as { round?: unknown; randomness?: unknown; signature?: unknown };
      const round = typeof body.round === 'number' ? body.round : NaN;
      const signature = typeof body.signature === 'string' ? body.signature : '';
      const randomness = typeof body.randomness === 'string' ? body.randomness : '';
      if (!verifyDrandRound(round, signature)) { lastErr = 'round failed pinned-key BLS verification — discarded'; continue; }
      return {
        ok: true,
        anchor: {
          schema: 'drand-anchor-v1',
          chainHash: DRAND_CHAIN_HASH,
          round,
          randomness,
          signature,
          verified: true,
          roundDriftFromClock: Math.abs(expectedDrandRound(nowMs) - round),
          fetchedAt: new Date(nowMs).toISOString(),
          advisoryOnly: true,
          grantsAuthority: false,
        },
      };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  return { ok: false, reason: lastErr };
}
