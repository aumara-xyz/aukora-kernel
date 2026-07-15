// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Self-mod outcome projection — door glue (issue #244, Round 8). Fire-and-forget bridge between a
 * freshly-recorded `signed_applied` disposition and the governed memory projection drain
 * (core/src/selfModOutcomeProjection.ts).
 *
 * Same posture as shadowCapture.ts, deliberately:
 *   - GATE: reuses the ONE owner switch for governed memory capture — AUKORA_MEMORY_SHADOW_CAPTURE=1
 *     AND advisory capability mode (lockdown silences it), re-checked per call, fail-closed.
 *   - FIRE-AND-FORGET: the approve door calls `void projectSelfModOutcomesNow()` AFTER the apply has
 *     already succeeded and the response is already decided. Nothing here can reverse, block, repeat,
 *     or downgrade the apply — this module is not imported by any signing/apply code.
 *   - ONE TRANSPORT: the same capture-subject writer (ensureCaptureWriter lease) + governed HTTP
 *     invoke shadow-capture uses. No second Convex write path, no signer.
 *   - LOUD HONESTY: results and refusals go to the console and (best-effort) the flight recorder.
 */
import { shadowCaptureAvailable } from './shadowCapture';
import { capabilityModePath, flightRecorderDir } from '../authority/symbiotePaths';
import { recordCapabilityEvent } from '../core/src/flightRecorder';
import { createGovernedHttpInvoke } from '../core/src/memoryKernelTransport';
import { projectSelfModOutcomes, type SelfModOutcomeDrainResult } from '../core/src/selfModOutcomeProjection';
import { currentSourceCommit } from './coreSession';

/** Drain now, fire-and-forget. NEVER throws and never rejects — the door calls it with `void`. */
export async function projectSelfModOutcomesNow(modePath: string = capabilityModePath()): Promise<SelfModOutcomeDrainResult | null> {
  try {
    if (!shadowCaptureAvailable(modePath)) return null; // not armed (or lockdown) — project nothing, silently lawful
    // Lazy adapter import (the shadowCapture precedent): convex-touching machinery loads only when armed.
    const adapter = await import('../scripts/captureSubjectAdapter');
    const ensured = await adapter.ensureCaptureWriter();
    if (!ensured.ok) {
      console.error(`[selfmod-outcome] projection skipped: ${ensured.refused}`);
      return null;
    }
    const w = ensured.writer;
    const sourceCommit = currentSourceCommit();
    const result = await projectSelfModOutcomes({
      ownerRootId: w.ownerRootId,
      deploymentUrl: w.deploymentUrl,
      invoke: createGovernedHttpInvoke({ url: w.deploymentUrl }),
      nextUse: w.nextUse,
      // one-core-memory (#45/#244): the running commit rides the outcome row's core stamp.
      ...(sourceCommit !== undefined ? { sourceCommit } : {}),
    });
    const line = `projected=${result.projected.length} already=${result.alreadyProjected} n/a=${result.notApplicable} refused=${result.refused.length}${result.journalRefused ? ` journalRefused=${result.journalRefused}` : ''}`;
    if (result.projected.length || result.refused.length || result.journalRefused) {
      console.error(`[selfmod-outcome] ${result.ok ? 'ok' : 'REFUSALS (apply untouched; retried next drain)'}: ${line}`);
    }
    // Best-effort witness — a recorder failure never blocks or hides the projection outcome above.
    try {
      recordCapabilityEvent(flightRecorderDir(), {
        kind: 'selfmod_outcome_projection',
        detail: `selfmod outcome drain -> ${line}`.slice(0, 300),
        meta: { ok: result.ok, projected: result.projected.length, refused: result.refused.length },
      }, new Date().toISOString());
    } catch { /* witnessed best-effort */ }
    return result;
  } catch (e) {
    console.error(`[selfmod-outcome] projection errored (apply untouched): ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
