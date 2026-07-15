// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * BoundedNonceLedger — a replay-nonce ledger that remembers seen nonces to reject replays, but CAPS memory
 * with FIFO eviction so a flood of distinct nonces cannot exhaust memory (Fusion Council finding #3).
 *
 * Tradeoff: eviction yields a bounded replay window — only the *oldest* nonces become forgettable, and only
 * after `max` newer ones have arrived. That is acceptable because proposer nonces are short-lived; a true
 * time-based TTL needs nonce timestamps (a Step-4 hardening, not available in the current nonce shape).
 *
 * Drop-in for the `Set<string>` it replaces: same has / add / clear surface. Kept as its own organ so the
 * bound is unit-tested directly without exporting the kernel's private ledger.
 */
export class BoundedNonceLedger {
  private readonly seen = new Set<string>();
  private epochId = 0;

  constructor(private readonly max: number) {
    if (!Number.isInteger(max) || max <= 0) {
      throw new Error('BoundedNonceLedger: max must be a positive integer');
    }
  }

  has(nonce: string): boolean {
    return this.seen.has(nonce);
  }

  add(nonce: string): void {
    if (this.seen.has(nonce)) return;
    if (this.seen.size >= this.max) {
      // Set preserves insertion order → the first key is the oldest. FIFO eviction bounds memory.
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    this.seen.add(nonce);
  }

  /**
   * ATOMIC check-and-add — the single source of replay truth used by the gate. Returns true the FIRST time a
   * fresh nonce is seen, and false on a replay OR a malformed nonce (fail closed). Because it is synchronous
   * there is no separable has-then-add window: a replayed nonce can never receive two `true`s. Replay
   * protection is EPOCH-bound + in-memory (see `clear` / `epoch`).
   */
  consume(nonce: unknown): boolean {
    if (typeof nonce !== 'string' || nonce.length === 0) return false; // malformed -> fail closed
    if (this.seen.has(nonce)) return false;                            // replay -> refused
    if (this.seen.size >= this.max) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    this.seen.add(nonce);
    return true;
  }

  /**
   * A reset/restart starts a NEW replay-protection EPOCH with an empty ledger. Replay protection is IN-MEMORY
   * and within-epoch only — nonces are NOT remembered across a reset or a process restart. Durable
   * cross-restart replay protection is NOT built (it needs a persistent ledger — a Step-4 hardening). The
   * epoch counter makes the session boundary explicit and testable.
   */
  clear(): void {
    this.seen.clear();
    this.epochId++;
  }

  get epoch(): number {
    return this.epochId;
  }

  get size(): number {
    return this.seen.size;
  }
}
