// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * G1 hard-stop + teardown timers. NO network, no filesystem — only timers, an AbortController, and (as a
 * last resort) a process force-exit. Two INDEPENDENT deadlines guard the sealed VM:
 *
 *   1. hard-stop deadline  — the controller loop calls shouldStop(now) each generation and MUST stop
 *                            advancing once the monotonic clock passes it. Cooperative.
 *   2. teardown deadline   — an independent timer that aborts + tears the process down regardless of what
 *                            the loop is doing. Not cooperative.
 *
 * A THIRD, separate 'local teardown backup' watchdog force-exits the process if the primary teardown timer
 * did not complete (threw, hung, or never fired). So no single failure — a wedged loop, a hung onTeardown,
 * a swallowed timer — can keep the VM alive past its budget.
 *
 * Monotonic time: shouldStop compares against a monotonic clock (performance.now), never wall-clock, so an
 * NTP step or clock skew on the VM cannot move the deadline.
 */

/** Suggested canary budget (operator overrides via armTeardown args). Documented in deploy/vm-policy.md. */
export const DEFAULT_HARD_STOP_MS = 8 * 60 * 60 * 1000;          // 8 hours of run, then stop advancing
export const DEFAULT_TEARDOWN_MS = 8 * 60 * 60 * 1000 + 5 * 60 * 1000; // teardown 5 min after hard-stop
export const DEFAULT_BACKUP_GRACE_MS = 60 * 1000;               // backup watchdog fires 60s after teardown
export const EXIT_CODE_BACKUP_TEARDOWN = 137;                    // distinct exit code for the forced backup path

/** Monotonic milliseconds. performance.now if present (monotonic, unaffected by wall-clock steps), else Date.now. */
export function monotonicNowMs(): number {
  const p = (globalThis as { performance?: { now(): number } }).performance;
  return p && typeof p.now === 'function' ? p.now() : Date.now();
}

/** Injection seams so tests drive timers/clock/exit deterministically with NO real waiting or process kill. */
export interface TeardownEnv {
  now?: () => number;
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  forceExit?: (code: number) => void;
}

export interface TeardownArgs extends TeardownEnv {
  /** ms from arm() until the hard-stop deadline (loop must stop advancing). */
  readonly hardStopMs: number;
  /** ms from arm() until the independent teardown deadline (abort + tear down). Should be >= hardStopMs. */
  readonly teardownMs: number;
  /** ms after the teardown deadline before the backup watchdog force-exits. Default DEFAULT_BACKUP_GRACE_MS. */
  readonly backupGraceMs?: number;
  /** Invoked once when the hard-stop deadline is reached. Errors are swallowed (loud teardown still proceeds). */
  readonly onHardStop: () => void;
  /** Invoked once when the teardown deadline is reached. If it throws/hangs, the backup watchdog force-exits. */
  readonly onTeardown: () => void;
}

/**
 * Monotonic hard-stop state the controller loop consults each generation. Immutable deadlines; the only
 * mutable bit is a latch set once either deadline fires so shouldStop stays true forever after.
 */
export class HardStop {
  readonly armedAtMs: number;
  readonly hardStopAtMs: number;
  readonly teardownAtMs: number;
  private latched = false;

  constructor(armedAtMs: number, hardStopMs: number, teardownMs: number) {
    if (!(hardStopMs >= 0) || !(teardownMs >= 0)) throw new Error('E_BAD_DEADLINE');
    this.armedAtMs = armedAtMs;
    this.hardStopAtMs = armedAtMs + hardStopMs;
    this.teardownAtMs = armedAtMs + teardownMs;
  }

  /** SYNCHRONOUS predicate the controller checks BEFORE each generation. True once the monotonic clock has
   *  passed the hard-stop deadline, or once a deadline timer has latched it. Never advances again after true. */
  shouldStop(nowMs: number): boolean {
    if (this.latched) return true;
    if (nowMs >= this.hardStopAtMs) { this.latched = true; return true; }
    return false;
  }

  /** Force the latch (called by the hard-stop / teardown timers so a mid-generation loop stops next check). */
  latch(): void { this.latched = true; }

  isLatched(): boolean { return this.latched; }

  remainingMs(nowMs: number): number { const r = this.hardStopAtMs - nowMs; return r > 0 ? r : 0; }
}

export interface TeardownHandle {
  readonly hardStop: HardStop;
  /** Aborts when either the hard-stop or teardown deadline fires; carries the reason. */
  readonly controller: AbortController;
  readonly signal: AbortSignal;
  /** True once the primary teardown timer's onTeardown returned successfully. */
  completed(): boolean;
  /** Clean-shutdown path: clears ALL timers (hard-stop, teardown, backup) so nothing force-exits. Idempotent. */
  cancel(): void;
}

/**
 * Arm the two independent deadline timers plus the local teardown backup watchdog. Returns a handle whose
 * `hardStop` the controller loop consults each generation. Uses setTimeout (default) and an AbortController;
 * every seam is injectable for tests.
 */
export function armTeardown(args: TeardownArgs): TeardownHandle {
  const now = args.now ?? monotonicNowMs;
  const setTimer = args.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer = args.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const forceExit = args.forceExit ?? defaultForceExit;
  const backupGraceMs = args.backupGraceMs ?? DEFAULT_BACKUP_GRACE_MS;

  const hardStop = new HardStop(now(), args.hardStopMs, args.teardownMs);
  const controller = new AbortController();

  let teardownCompleted = false;
  let cancelled = false;

  // Timer 1 — HARD STOP: latch the loop and abort with a distinct reason. Cooperative stop.
  const t1 = setTimer(() => {
    hardStop.latch();
    try { controller.abort(new Error('E_HARD_STOP')); } catch { /* already aborted */ }
    try { args.onHardStop(); } catch { /* loud teardown proceeds regardless */ }
  }, args.hardStopMs);

  // Timer 2 — TEARDOWN (independent): fires on its own deadline regardless of the loop. onTeardown runs
  // LAST; teardownCompleted is set only if it returns, so a throw/hang leaves it false for the backup.
  const t2 = setTimer(() => {
    hardStop.latch();
    try { controller.abort(new Error('E_TEARDOWN')); } catch { /* already aborted */ }
    try { args.onTeardown(); teardownCompleted = true; } catch { /* backup watchdog will force-exit */ }
  }, args.teardownMs);

  // Timer 3 — LOCAL TEARDOWN BACKUP (separate watchdog): if the primary teardown did NOT complete by
  // teardownMs + grace (it threw, hung, or never ran), force-exit the process. Independent of timers 1/2 so
  // no single failure keeps the VM alive past budget. Cleared only on an explicit clean cancel().
  const t3 = setTimer(() => {
    if (!teardownCompleted && !cancelled) forceExit(EXIT_CODE_BACKUP_TEARDOWN);
  }, args.teardownMs + backupGraceMs);

  return {
    hardStop,
    controller,
    signal: controller.signal,
    completed: () => teardownCompleted,
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      clearTimer(t1); clearTimer(t2); clearTimer(t3);
    },
  };
}

/** Default force-exit. Uses process.exit when present; otherwise throws so the failure is at least loud. */
function defaultForceExit(code: number): void {
  const proc = (globalThis as { process?: { exit?: (c: number) => never } }).process;
  if (proc && typeof proc.exit === 'function') proc.exit(code);
  else throw new Error(`E_FORCE_EXIT:${code}`);
}
