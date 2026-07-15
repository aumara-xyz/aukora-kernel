// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * G1 canary RUNNER (Round-24 R23 blockers 4 + 6). This is the CLI/service entry that proves the canary and
 * deadline claims and makes the runner / GPU / UI / egress state an EXPLICIT, checkable contract rather than a
 * prose assertion.
 *
 * The runner enforces a SEALED-ENVELOPE contract in software and REFUSES to run if the declared envelope
 * deviates from the mandated posture. The four postures are:
 *   - gpu:     'single-exclusive'  — exactly one GPU, reset before/after (physically enforced by the operator
 *                                    on the VM; the runner refuses any other declared value);
 *   - ui:      'loopback-only'     — observability UI bound to 127.0.0.1 only;
 *   - egress:  'denied'            — no outbound network;
 *   - signing: 'absent'            — no signing / apply / authority token in the envelope.
 *
 * Physical enforcement of GPU isolation and egress denial remains the operator's (documented in
 * deploy/vm-policy.md); the runner cannot open a GPU or a socket here. What it DOES enforce, in code, is that
 * the run refuses to proceed unless the envelope is declared in the mandated posture, that the loop stops at
 * the hard-stop deadline, that teardown is armed, and that the resulting lineage is durable and chain-valid.
 *
 * NO network, NO GPU, NO signing, NO VM creation. Timers/clock/exit are injectable so tests are deterministic.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runGenerations, DEFAULT_BUNDLE_ROOT, type RunSummary } from './controller';
import {
  armTeardown,
  monotonicNowMs,
  type TeardownEnv,
  type TeardownHandle,
} from './teardown';
import { readLineage, verifyLineageChain, type Generation } from './lineage';

/** The mandated sealed-envelope posture. Any deviation makes the runner refuse to proceed. */
export interface SealedEnvelope {
  readonly gpu: 'single-exclusive';
  readonly ui: 'loopback-only';
  readonly egress: 'denied';
  readonly signing: 'absent';
}

export const MANDATED_ENVELOPE: SealedEnvelope = Object.freeze({
  gpu: 'single-exclusive',
  ui: 'loopback-only',
  egress: 'denied',
  signing: 'absent',
});

export class EnvelopeContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvelopeContractError';
  }
}

/**
 * Refuse (throw) unless every declared envelope posture matches the mandated one exactly AND the envelope
 * carries no other keys. The exact-key closure (R24 amendment, P2) is essential: without it an envelope with
 * signing:'absent' PLUS authority-shaped extras (apply, authorityToken, signingKey) would be accepted and then
 * serialized verbatim into the operator-facing runner-status.json — a "no-authority" attestation that secretly
 * carries a token. Non-enumerable and symbol keys are counted via Reflect.ownKeys.
 */
export function assertEnvelope(env: unknown): asserts env is SealedEnvelope {
  if (env === null || typeof env !== 'object') throw new EnvelopeContractError('envelope-missing');
  const o = env as Record<string, unknown>;
  if (Object.keys(o).length !== 4 || Reflect.ownKeys(o).length !== 4) {
    throw new EnvelopeContractError('envelope-extra-keys');
  }
  if (o.gpu !== MANDATED_ENVELOPE.gpu) throw new EnvelopeContractError(`gpu:${String(o.gpu)}`);
  if (o.ui !== MANDATED_ENVELOPE.ui) throw new EnvelopeContractError(`ui:${String(o.ui)}`);
  if (o.egress !== MANDATED_ENVELOPE.egress) throw new EnvelopeContractError(`egress:${String(o.egress)}`);
  if (o.signing !== MANDATED_ENVELOPE.signing) throw new EnvelopeContractError(`signing:${String(o.signing)}`);
}

export type RunnerPhase =
  | 'idle'
  | 'running'
  | 'stopped-deadline'
  | 'stopped-count'
  | 'torn-down';

/** The explicit, checkable runner state contract returned to the operator/auditor. */
export interface RunnerState {
  readonly phase: RunnerPhase;
  readonly envelope: SealedEnvelope;
  readonly generationsRun: number;
  readonly stoppedByDeadline: boolean;
  readonly lineageDurable: boolean;
  readonly lineageChainValid: boolean;
  readonly teardownArmed: boolean;
}

export interface RunnerReport {
  readonly state: RunnerState;
  readonly summary: RunSummary;
  readonly lineage: Generation[];
}

export interface RunCanaryOptions {
  readonly envelope: SealedEnvelope;
  readonly seed0: number;
  readonly maxGenerations: number;
  /** ms from now until the hard-stop deadline (loop stops advancing). */
  readonly hardStopMs: number;
  /** ms from now until the independent teardown deadline (>= hardStopMs). */
  readonly teardownMs: number;
  readonly bundleRoot?: string;
  readonly outDir?: string;
  /** Injectable timer/clock/exit seams (tests). Real runs use monotonic timers + process.exit. */
  readonly env?: TeardownEnv;
}

/**
 * Run a bounded canary. Refuses unless the envelope is in the mandated posture; arms teardown; runs the
 * deadline-wired controller loop; then reads the durable lineage back and verifies its chain. Returns the
 * explicit runner state. The physical GPU/egress isolation is the operator's; this proves the STATE CONTRACT.
 */
export function runCanary(opts: RunCanaryOptions): RunnerReport {
  assertEnvelope(opts.envelope); // fail-closed on any envelope deviation / extra key BEFORE arming anything
  // Canonical copy: attest ONLY the four mandated fields, never the caller's object by reference (defense in
  // depth even though assertEnvelope already refused extras).
  const envelope: SealedEnvelope = {
    gpu: opts.envelope.gpu, ui: opts.envelope.ui, egress: opts.envelope.egress, signing: opts.envelope.signing,
  };

  const bundleRoot = opts.bundleRoot ?? DEFAULT_BUNDLE_ROOT;
  const outDir = opts.outDir ?? path.join(bundleRoot, '.g1-out');
  const now = opts.env?.now ?? monotonicNowMs;

  const handle: TeardownHandle = armTeardown({
    hardStopMs: opts.hardStopMs,
    teardownMs: opts.teardownMs,
    onHardStop: () => { /* cooperative stop is handled by the loop consulting hardStop.shouldStop */ },
    onTeardown: () => { /* independent teardown; no side effects needed in-process */ },
    ...opts.env,
  });

  let summary: RunSummary;
  try {
    summary = runGenerations(opts.seed0, opts.maxGenerations, {
      bundleRoot,
      outDir,
      hardStop: handle.hardStop,
      now,
    });
  } finally {
    handle.cancel(); // clean shutdown: clear all timers so nothing force-exits after a normal run
  }

  const lineage = readLineage(summary.lineageDir);
  const lineageDurable = lineage !== null && lineage.length === summary.generationsRun;
  const lineageChainValid = lineage !== null && verifyLineageChain(lineage);

  const phase: RunnerPhase = summary.stoppedByDeadline ? 'stopped-deadline' : 'stopped-count';
  const state: RunnerState = {
    phase,
    envelope,
    generationsRun: summary.generationsRun,
    stoppedByDeadline: summary.stoppedByDeadline,
    lineageDurable,
    lineageChainValid,
    teardownArmed: true,
  };

  return { state, summary, lineage: lineage ?? [] };
}

/** Best-effort JSON status writer for a loopback-only observability UI (no network; contained by the caller). */
export function writeRunnerStatus(outDir: string, state: RunnerState): void {
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'runner-status.json'), JSON.stringify(state, null, 2) + '\n');
  } catch {
    /* status is advisory only */
  }
}
