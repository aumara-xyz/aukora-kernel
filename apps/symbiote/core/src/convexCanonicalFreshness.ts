/**
 * 24Y.8 — Canonical Convex freshness / anti-replay.
 *
 * 24Y.7 made the canonical pin REAL: a backend is canonical only if its signed receipt head verifies
 * against an explicitly pinned ML-DSA-65 public key. But a signature proves "the kernel signed THIS
 * state at SOME point" — it does NOT prove freshness. A captured, genuinely-signed but STALE head can
 * be replayed by any backend; an older still-valid head is a rollback. This module adds a high-water
 * check (mirroring the kernel's evaluateHighWater in node-template/convex/aukoraSignedHead.ts) plus an
 * OPTIONAL timestamp-freshness window, so replay/rollback/fork are caught.
 *
 * Authority of ORDER is `count` (the monotonic receipt-append position / chain_length), NOT wall-clock
 * `headSignedAt` — exactly as the kernel treats it (ts is metadata, never the ordering authority).
 * Timestamp freshness is therefore OPT-IN and secondary; trusting it as primary would be its own bug.
 *
 * PURE: no Convex, no network, no secrets, no wall-clock reads (the caller supplies `now` so the
 * module stays deterministic/testable). State (the high-water record) is held by the caller —
 * local/in-memory or an evidence-file — and advanced ONLY after a full crypto+freshness verify.
 * No Convex writes.
 *
 * 24Y.9: adds an OPTIONAL keyed HMAC over the persisted high-water (tamper-resistance, distinct from
 * the SHA-256 corruption checksum). The MAC secret is EXPLICIT operator config (env/file), never
 * model-owned, never auto-generated, never printed. If absent → integrity is `checksum_only` (dev),
 * NEVER claimed tamper-resistant. The crypto/compare functions are pure; `resolveHighWaterMacSecret`
 * is the one function that reads env config.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export type FreshnessVerdict =
  | 'fresh'              // count advanced — a genuinely newer head
  | 'same_head'         // identical to the high-water (count+hash+root) — OK, no advance
  | 'stale'             // count not lower, but timestamp outside the enforced freshness window
  | 'rollback'          // count LOWER than the high-water — an older head replaced a newer one
  | 'fork'              // same count, DIFFERENT hash/root — equivocation at the same height
  | 'unknown_no_history'; // no prior high-water — first observation; cannot prove freshness yet

export type ReplayRisk = 'none' | 'low' | 'severe';

export interface HighWaterRecord {
  chainKey: string;
  maxCount: number;
  headHash: string;
  receiptLogRoot: string | null;
  headSignedAt: number | null;
  recordedAt: number; // wall-clock when WE recorded it (caller-supplied; module stays pure)
}

export interface FreshnessHeadInput {
  chainKey: string;
  count: number;
  lastChainHash: string | null;
  receiptLogRoot: string | null;
  headSignedAt: number | null;
}

export interface FreshnessOptions {
  maxAgeMs?: number; // if set (with `now`), enforce a timestamp-freshness window
  now?: number;      // current wall-clock ms (caller-supplied — keeps this module pure)
}

export interface FreshnessResult {
  verdict: FreshnessVerdict;
  /** TRUE only for a confirmed advance within the (optional) freshness window. same_head/unknown → false. */
  freshnessVerified: boolean;
  replayRisk: ReplayRisk;
  timestampStatus: 'within_window' | 'stale' | 'not_enforced';
  reason: string;
  /** Whether the high-water should advance after a FULL verify (crypto + non-severe freshness). */
  advanced: boolean;
}

/**
 * Evaluate a (cryptographically-verified) head against the remembered high-water. PURE. Caller must
 * have already crypto-verified the head; this only judges freshness/ordering. Advance the high-water
 * (advanceHighWater) ONLY after both checks pass.
 */
export function evaluateFreshness(
  record: HighWaterRecord | null,
  head: FreshnessHeadInput,
  opts: FreshnessOptions = {},
): FreshnessResult {
  // Timestamp window (secondary signal; opt-in).
  let timestampStatus: FreshnessResult['timestampStatus'];
  if (opts.maxAgeMs == null || opts.now == null) {
    timestampStatus = 'not_enforced';
  } else if (head.headSignedAt == null || !Number.isFinite(head.headSignedAt)) {
    timestampStatus = 'stale'; // enforcing but no usable timestamp → fail closed
  } else {
    timestampStatus = head.headSignedAt >= opts.now - opts.maxAgeMs ? 'within_window' : 'stale';
  }

  // Defensive: a record for a different chain must never be compared against this head.
  if (record && record.chainKey !== head.chainKey) {
    return { verdict: 'unknown_no_history', freshnessVerified: false, replayRisk: 'low',
      timestampStatus, reason: `highwater_chainkey_mismatch:${record.chainKey}!=${head.chainKey}`, advanced: false };
  }

  // No baseline → cannot prove freshness; first observation. Not GREEN, but allowed to seed the HWM.
  if (!record) {
    return { verdict: 'unknown_no_history', freshnessVerified: false, replayRisk: 'low',
      timestampStatus, reason: 'no_prior_high_water', advanced: true };
  }

  // count is the ordering authority.
  if (head.count < record.maxCount) {
    return { verdict: 'rollback', freshnessVerified: false, replayRisk: 'severe',
      timestampStatus, reason: `rollback:${head.count}<${record.maxCount}`, advanced: false };
  }
  if (head.count === record.maxCount) {
    const sameHash = head.lastChainHash === record.headHash;
    const sameRoot = (head.receiptLogRoot ?? null) === (record.receiptLogRoot ?? null);
    if (sameHash && sameRoot) {
      return { verdict: 'same_head', freshnessVerified: false, replayRisk: 'none',
        timestampStatus, reason: 'same_confirmed_head', advanced: false };
    }
    return { verdict: 'fork', freshnessVerified: false, replayRisk: 'severe',
      timestampStatus, reason: 'fork:same_count_different_head', advanced: false };
  }

  // count advanced. Honor the timestamp window if enforced.
  if (timestampStatus === 'stale') {
    return { verdict: 'stale', freshnessVerified: false, replayRisk: 'low',
      timestampStatus, reason: 'count_advanced_but_timestamp_outside_window', advanced: true };
  }
  return { verdict: 'fresh', freshnessVerified: true, replayRisk: 'none',
    timestampStatus, reason: 'count_advanced', advanced: true };
}

/** Build the next high-water record from a verified, advancing head. Caller supplies `now`. */
export function advanceHighWater(head: FreshnessHeadInput, now: number): HighWaterRecord {
  return {
    chainKey: head.chainKey,
    maxCount: head.count,
    headHash: head.lastChainHash ?? '',
    receiptLogRoot: head.receiptLogRoot ?? null,
    headSignedAt: head.headSignedAt ?? null,
    recordedAt: now,
  };
}

// ── High-water store (local only; no Convex) ──

export interface HighWaterStore {
  get(chainKey: string): HighWaterRecord | null;
  set(record: HighWaterRecord): void;
}

/** Default in-memory store (per-process). */
export class InMemoryHighWaterStore implements HighWaterStore {
  private map = new Map<string, HighWaterRecord>();
  get(chainKey: string): HighWaterRecord | null {
    return this.map.get(chainKey) ?? null;
  }
  set(record: HighWaterRecord): void {
    this.map.set(record.chainKey, record);
  }
}

// ── Persisted-record CORRUPTION integrity (not tamper-resistance) ──
// A SHA-256 self-checksum over the ordering-relevant fields. This catches accidental corruption /
// torn writes / truncation and a NAIVE edit (lower the count but forget the checksum) → the loader
// fails closed to "no baseline" (unknown_no_history), which is the SAFE direction (a replayed head is
// then shown but NEVER as `fresh`). It is NOT tamper-resistance: an attacker with local write access
// can recompute the checksum after lowering the count. True tamper-resistance needs a keyed MAC under
// a device-local (non-model-owned) secret — that is the 24Y.9 increment. Labeled honestly as such.
export function highWaterChecksum(record: HighWaterRecord): string {
  const canon = JSON.stringify([
    record.chainKey, record.maxCount, record.headHash,
    record.receiptLogRoot ?? null, record.headSignedAt ?? null,
  ]);
  return bytesToHex(sha256(new TextEncoder().encode(canon)));
}

/** Validate a record's shape + checksum. Returns the record only if intact; else null (fail closed). */
export function verifyHighWaterRecord(record: unknown, checksum: unknown): HighWaterRecord | null {
  if (!record || typeof record !== 'object') return null;
  const r = record as Record<string, unknown>;
  if (typeof r.chainKey !== 'string' || typeof r.maxCount !== 'number' || !Number.isSafeInteger(r.maxCount) || r.maxCount < 0) return null;
  if (typeof r.headHash !== 'string') return null;
  const rec: HighWaterRecord = {
    chainKey: r.chainKey,
    maxCount: r.maxCount,
    headHash: r.headHash,
    receiptLogRoot: typeof r.receiptLogRoot === 'string' ? r.receiptLogRoot : null,
    headSignedAt: typeof r.headSignedAt === 'number' ? r.headSignedAt : null,
    recordedAt: typeof r.recordedAt === 'number' ? r.recordedAt : 0,
  };
  if (typeof checksum !== 'string' || checksum !== highWaterChecksum(rec)) return null;
  return rec;
}

// ── 24Y.9: keyed MAC (tamper-resistance, distinct from the corruption checksum) ──

export type HighWaterIntegrity =
  | 'none'           // no usable record (corrupt/missing checksum) — fail closed
  | 'checksum_only'  // checksum valid, NO MAC secret configured — dev-grade, NOT tamper-resistant
  | 'mac_verified'   // MAC secret configured AND the stored MAC verifies — tamper-resistant
  | 'mac_missing'    // MAC secret configured but the stored entry has NO MAC — untrusted (fail closed)
  | 'mac_invalid';   // MAC secret configured but the stored MAC does NOT verify — TAMPER (fail closed)

export interface HighWaterMacSecret {
  key: string;             // operator secret (≥32 chars), never printed
  source: 'env' | 'file';
}

/**
 * Resolve the high-water MAC secret from EXPLICIT operator config ONLY. NO auto-generation, NO TOFU.
 * Unset → null (→ checksum_only, dev). Present-but-too-short → throw (fail closed). Never printed.
 *   AUKORA_HIGH_WATER_MAC_SECRET = the secret (≥32 chars), OR
 *   AUKORA_HIGH_WATER_MAC_SECRET_FILE = path to a file whose trimmed contents are the secret.
 */
export function resolveHighWaterMacSecret(
  env: NodeJS.ProcessEnv = process.env,
  readFile?: (p: string) => string,
): HighWaterMacSecret | null {
  const inline = env.AUKORA_HIGH_WATER_MAC_SECRET?.trim();
  if (inline) {
    if (inline.length < 32) throw new Error('aukora_high_water_mac_secret_too_short'); // fail closed
    return { key: inline, source: 'env' };
  }
  const file = env.AUKORA_HIGH_WATER_MAC_SECRET_FILE?.trim();
  if (file && readFile) {
    const val = readFile(file).trim();
    if (val.length < 32) throw new Error('aukora_high_water_mac_secret_too_short');
    return { key: val, source: 'file' };
  }
  return null; // unset → no tamper-resistance (checksum_only)
}

/** HMAC-SHA256 over the ordering-relevant fields, keyed by the operator secret. */
export function highWaterMac(record: HighWaterRecord, secret: HighWaterMacSecret): string {
  const canon = JSON.stringify([
    record.chainKey, record.maxCount, record.headHash,
    record.receiptLogRoot ?? null, record.headSignedAt ?? null,
  ]);
  const enc = new TextEncoder();
  return bytesToHex(hmac(sha256, enc.encode(secret.key), enc.encode(canon)));
}

/**
 * Constant-time hex compare via XOR accumulation: no data-dependent early-return inside the loop, so
 * it does not leak WHICH byte differs. The only early-return is on length, which is non-secret here
 * (the MAC is fixed-width HMAC-SHA256 = 64 hex chars). (24Y.9 Fusion: replaced an earlier hedged
 * comment with this precise guarantee — the comparator was already XOR-accumulation, not `===`.)
 */
function constantTimeHexEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function verifyHighWaterMac(record: HighWaterRecord, mac: unknown, secret: HighWaterMacSecret): boolean {
  return typeof mac === 'string' && constantTimeHexEqual(mac, highWaterMac(record, secret));
}

export interface HighWaterAssessment {
  record: HighWaterRecord | null; // the TRUSTED baseline, or null when it must not be used
  integrity: HighWaterIntegrity;
  tamperResistant: boolean;
}

/**
 * Assess a persisted entry { record, checksum, mac? } against the (optional) MAC secret. FAIL CLOSED:
 * a corrupt checksum, a missing-MAC-when-secret-configured, or an invalid MAC all yield record=null
 * (the baseline is not used → the freshness layer falls to unknown_no_history, the SAFE direction).
 */
export function assessHighWaterEntry(
  entry: { record?: unknown; checksum?: unknown; mac?: unknown } | null | undefined,
  secret: HighWaterMacSecret | null,
): HighWaterAssessment {
  if (!entry) return { record: null, integrity: 'none', tamperResistant: false };
  const rec = verifyHighWaterRecord(entry.record, entry.checksum);
  if (!rec) return { record: null, integrity: 'none', tamperResistant: false }; // corrupt → safe degrade
  if (!secret) return { record: rec, integrity: 'checksum_only', tamperResistant: false }; // dev
  if (entry.mac == null) return { record: null, integrity: 'mac_missing', tamperResistant: false }; // suspect
  if (!verifyHighWaterMac(rec, entry.mac, secret)) return { record: null, integrity: 'mac_invalid', tamperResistant: false }; // TAMPER
  return { record: rec, integrity: 'mac_verified', tamperResistant: true };
}
