// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Shadow-capture door glue — the env gate + fire-and-forget bridge between a completed voice turn
 * and the governed Convex memory write path (docs/CONVEX_SHADOW_WRITE_PLAN.md piece 3).
 *
 * Gate discipline (exactly the voiceReadToolBridge convention): explicit env opt-in
 * `AUKORA_MEMORY_SHADOW_CAPTURE=1`, default OFF — landing this code arms nothing; owner lockdown
 * disables it at this dispatch point; both are RE-CHECKED per call, never cached.
 *
 * Posture (the directive's hard rules, each carried by a test in core/tests/shadowCaptureDoor.test.ts):
 *   - FIRE-AND-FORGET: chat-serve calls `void captureCompletedTurn(...)`; every path in here is
 *     caught; a capture failure is IMPOSSIBLE to propagate into the HTTP response. No retry loop,
 *     no fallback store, no brain.json write for chat turns.
 *   - LOUD HONESTY: every refusal envelope is surfaced verbatim (hex-truncated) to the door's
 *     console, to a bounded status file (~/.aukora-symbiote/convex/capture-status.json, 0600) that
 *     the read-only truth surface (/api/brain, a DIFFERENT process) reads, and — best-effort — to
 *     the flight recorder ('shadow_capture' events). Never re-wrapped, never swallowed.
 *   - CONTENT LAW: only ownerText + the voiced reply text travel (extractVoiceReplyText). Never
 *     attachments, images, the per-turn recall-frame nonce (request-ephemeral BY CONTRACT,
 *     voiceLane.ts), Kira recall excerpts, tool outputs, or system prompts. Distillation and the
 *     forbidden-content law live in core/src/conversationShadowCapture.ts.
 *   - SERIALIZED: captures queue in-process (useSeq is strictly monotonic per manifest; the kernel
 *     refuses races — so we never create one).
 *   - RECALL UNTOUCHED: nothing here reads memory. Kira JSON remains the only fuzzy recall source
 *     until R5b (docs/R5_RECALL_STATUS.md).
 */
import * as fs from 'fs';
import * as path from 'path';
import { readCapabilityMode } from './capabilityMode';
import { capabilityModePath, flightRecorderDir, symbioteHome } from '../authority/symbiotePaths';
import { recordCapabilityEvent } from '../core/src/flightRecorder';
import { truncateHexRunsForCapture } from '../core/src/hexTruncation';
import { captureTurn, type CaptureTurnResult, type CaptureUseLease } from '../core/src/conversationShadowCapture';
import type { MemoryAppendDeps } from '../core/src/memoryAppend';
import { createGovernedHttpInvoke } from '../core/src/memoryKernelTransport';
import { currentSourceCommit, currentThreadId } from './coreSession';
import type { ChatEntry } from './voiceLane';
import type { CaptureWriter } from '../scripts/captureSubjectAdapter';

/** Gate 1: explicit env opt-in. Default OFF — a deliberate owner promotion, never on by default. */
export function shadowCaptureEnabledByEnv(): boolean {
  return process.env.AUKORA_MEMORY_SHADOW_CAPTURE === '1';
}

/** True iff capture may run this turn: env opt-in AND advisory capability mode. Lockdown (or the
 *  flag being unset) disables the lane, fail-closed, re-checked per call. */
export function shadowCaptureAvailable(modePath: string = capabilityModePath()): boolean {
  return shadowCaptureEnabledByEnv() && readCapabilityMode(modePath) === 'advisory';
}

/** Where the door records capture health for the read-only truth surface. */
export function captureStatusPath(): string {
  return path.join(symbioteHome(), 'convex', 'capture-status.json');
}

export interface CaptureStatusFile {
  schema: 'capture-status-v1';
  lastAttemptAt: string;
  lastOutcome: 'ok' | 'refused';
  /** Present when lastOutcome is 'refused' — the envelope's reason, hex-truncated. */
  lastRefused?: string;
  /** Present after a successful write: the row key (turn.<ts>.<seq> — not secret-shaped) and the
   *  hex-truncated receipt hash, so the owner's proof ceremony can recall the row without digging
   *  through the door console. */
  lastKey?: string;
  lastReceipt?: string;
  okCount: number;
  refusedCount: number;
  advisoryOnly: true;
  grantsAuthority: false;
}

/** Fail-soft read of the status file (absent/unreadable/malformed → null, never a throw) — the
 *  read-only server uses this; a broken status file must not break /api/brain. */
export function readCaptureStatusSafe(p: string = captureStatusPath()): CaptureStatusFile | null {
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as CaptureStatusFile;
    if (!raw || raw.schema !== 'capture-status-v1') return null;
    return {
      schema: 'capture-status-v1',
      lastAttemptAt: String(raw.lastAttemptAt ?? '').slice(0, 40),
      lastOutcome: raw.lastOutcome === 'ok' ? 'ok' : 'refused',
      ...(raw.lastRefused !== undefined ? { lastRefused: String(raw.lastRefused).slice(0, 300) } : {}),
      ...(raw.lastKey !== undefined ? { lastKey: String(raw.lastKey).slice(0, 80) } : {}),
      ...(raw.lastReceipt !== undefined ? { lastReceipt: String(raw.lastReceipt).slice(0, 40) } : {}),
      okCount: Number.isFinite(raw.okCount) ? Number(raw.okCount) : 0,
      refusedCount: Number.isFinite(raw.refusedCount) ? Number(raw.refusedCount) : 0,
      advisoryOnly: true,
      grantsAuthority: false,
    };
  } catch {
    return null;
  }
}

/**
 * The /api/brain capture block, computed honestly (pure given explicit inputs — unit-testable).
 * `wired` is true ONLY when the shipped lane is armed in THIS process's env; the note carries the
 * cross-process health the door wrote to the status file, degrading gracefully when absent.
 */
export function captureTruth(opts?: { enabled?: boolean; status?: CaptureStatusFile | null }): { wired: boolean; note: string } {
  const enabled = opts && 'enabled' in opts && opts.enabled !== undefined ? opts.enabled : shadowCaptureEnabledByEnv();
  const status = opts && 'status' in opts ? opts.status ?? null : readCaptureStatusSafe();
  const recallLine = 'Recall serves from the governed Convex brain by default (R5b cutover, verdict docs/R5B_BASELINE_20260708.md); the archived Kira JSON brain serves only under the explicit kira-json-legacy hatch on nodes that have not migrated yet.';
  if (!enabled) {
    return {
      wired: false,
      note: `Shadow-capture lane is shipped but DISABLED in this process (arm with AUKORA_MEMORY_SHADOW_CAPTURE=1 in the node env and restart). Chat turns are not being written into Convex. ${recallLine}`,
    };
  }
  const health = status
    ? `last attempt ${status.lastOutcome}${status.lastRefused ? ` — ${status.lastRefused}` : ''} at ${status.lastAttemptAt} (ok ${status.okCount}, refused ${status.refusedCount})${status.lastKey ? `; last written row: ${status.lastKey}` : ''}`
    : 'no capture attempt recorded yet on this node';
  return {
    wired: true,
    note: `Shadow-capture ENABLED — completed voice turns are distilled (bounded summary atoms only) and written through the governed memoryAppend path, fire-and-forget; a refusal never blocks chat. Capture health: ${health}. ${recallLine}`,
  };
}

/** The voiced reply is the info entry immediately preceding a `{kind:'tool_result', tool:'voice'}`
 *  provenance entry (voiceLane.ts builds exactly that shape; the LAST such pair wins so recovery
 *  prefix notes never shadow the real reply). Returns null when no such pair exists. */
export function extractVoiceReplyText(entries: unknown[]): string | null {
  if (!Array.isArray(entries)) return null;
  let found: string | null = null;
  for (let i = 1; i < entries.length; i++) {
    const e = entries[i] as ChatEntry | undefined;
    const prev = entries[i - 1] as ChatEntry | undefined;
    if (e?.kind === 'tool_result' && (e as { tool?: string }).tool === 'voice' && prev?.kind === 'info' && typeof prev.text === 'string') {
      found = prev.text;
    }
  }
  return found;
}

/** Hermetic-test seams. Production callers pass none of this. */
export interface ShadowCaptureOverrides {
  modePath?: string;
  statusPath?: string;
  deploymentUrl?: string;
  invoke?: MemoryAppendDeps['invoke'];
  nextUse?: () => Promise<CaptureUseLease>;
  ownerRootId?: string;
  recordEvent?: (detail: string, meta: Record<string, string | number | boolean>) => void;
  log?: (line: string) => void;
  /** Test seams for the core receipt stamp's per-process facts (one-core-memory round). */
  thread?: string;
  sourceCommit?: string;
}

// One writer per door process (fresh manifest per mint); dropped on lifecycle refusals so the
// NEXT turn re-runs the ceremony — no retry inside a turn, ever.
let cachedWriter: CaptureWriter | null = null;
// Captures serialize through this chain: useSeq is strictly monotonic per manifest, so two
// concurrent turns must never race a seq (same pattern as chat-serve's commandQueue).
let captureQueue: Promise<void> = Promise.resolve();

/** Test seam: forget the cached writer + queue between hermetic tests. */
export function _resetShadowCaptureForTests(): void {
  cachedWriter = null;
  captureQueue = Promise.resolve();
}

const MANIFEST_LIFECYCLE_RE = /capture_manifest_expired|capture_manifest_exhausted|manifest_(not_found|expired|spent|revoked)|use_seq|useseq|usedCount/i;

function writeStatus(
  statusPath: string,
  outcome: 'ok' | 'refused',
  refusedReason: string | undefined,
  written?: { key: string; receipt: string },
): void {
  const prev = readCaptureStatusSafe(statusPath);
  const next: CaptureStatusFile = {
    schema: 'capture-status-v1',
    lastAttemptAt: new Date().toISOString(),
    lastOutcome: outcome,
    ...(refusedReason !== undefined ? { lastRefused: truncateHexRunsForCapture(refusedReason).slice(0, 300) } : {}),
    // the row key survives refusals (it names the LAST successful write); the proof ceremony
    // recalls by exactly this key. Receipt is stored hex-truncated — display only, never a secret.
    ...(written ? { lastKey: written.key.slice(0, 80), lastReceipt: truncateHexRunsForCapture(written.receipt).slice(0, 40) }
      : prev?.lastKey !== undefined ? { lastKey: prev.lastKey, ...(prev.lastReceipt !== undefined ? { lastReceipt: prev.lastReceipt } : {}) }
      : {}),
    okCount: (prev?.okCount ?? 0) + (outcome === 'ok' ? 1 : 0),
    refusedCount: (prev?.refusedCount ?? 0) + (outcome === 'refused' ? 1 : 0),
    advisoryOnly: true,
    grantsAuthority: false,
  };
  fs.mkdirSync(path.dirname(statusPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(statusPath, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  try { fs.chmodSync(statusPath, 0o600); } catch { /* Windows has no POSIX perms — writeFileSync mode is enough */ }
}

/**
 * Capture one completed voice turn, fire-and-forget. NEVER throws and never rejects — the door
 * calls `void captureCompletedTurn(...)` and moves on; everything below is contained.
 */
export async function captureCompletedTurn(
  args: { ownerText: string; entries: unknown[]; model: string; origin?: string },
  overrides: ShadowCaptureOverrides = {},
): Promise<void> {
  // Gate 1 first, cheapest, ZERO side effects when the lane is not armed.
  if (!shadowCaptureEnabledByEnv()) return;

  const run = async (): Promise<void> => {
    const statusPath = overrides.statusPath ?? captureStatusPath();
    const log = overrides.log ?? ((line: string) => console.error(line));
    const recordEvent = overrides.recordEvent ?? ((detail: string, meta: Record<string, string | number | boolean>) => {
      // best-effort witness — a recorder failure never blocks capture or chat (lockdown precedent).
      try { recordCapabilityEvent(flightRecorderDir(), { kind: 'shadow_capture', detail, meta }, new Date().toISOString()); } catch { /* witnessed best-effort */ }
    });

    const finish = (
      outcome: 'ok' | 'refused',
      detail: string,
      meta: Record<string, string | number | boolean>,
      written?: { key: string; receipt: string },
    ) => {
      const bounded = truncateHexRunsForCapture(detail).slice(0, 400);
      try { writeStatus(statusPath, outcome, outcome === 'refused' ? bounded : undefined, written); } catch (e) {
        log(`[shadow-capture] status file write failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      log(outcome === 'ok' ? `[shadow-capture] ok: ${bounded}` : `[shadow-capture] refused: ${bounded}`);
      recordEvent(bounded, { ...meta, outcome });
    };

    // Gate 2: owner lockdown disables the lane at this dispatch point, like every promoted capability.
    if (readCapabilityMode(overrides.modePath ?? capabilityModePath()) !== 'advisory') {
      finish('refused', 'capture_lockdown_refused', {});
      return;
    }

    const replyText = extractVoiceReplyText(args.entries);
    if (replyText === null) {
      finish('refused', 'capture_no_reply_text', {});
      return;
    }

    // The ceremony adapter loads LAZILY on the first captured turn (it imports convex/ machinery).
    let nextUse = overrides.nextUse;
    let ownerRootId = overrides.ownerRootId ?? 'aumara.root';
    let deploymentUrl = overrides.deploymentUrl ?? 'http://127.0.0.1:3210';
    if (!nextUse) {
      if (!cachedWriter) {
        try {
          const adapter = await import('../scripts/captureSubjectAdapter');
          const ensured = await adapter.ensureCaptureWriter();
          if (!ensured.ok) {
            finish('refused', ensured.refused, {});
            return;
          }
          cachedWriter = ensured.writer;
        } catch (e) {
          finish('refused', `capture_ceremony_failed: ${e instanceof Error ? e.message : String(e)}`, {});
          return;
        }
      }
      const writer = cachedWriter;
      nextUse = writer.nextUse;
      ownerRootId = writer.ownerRootId;
      deploymentUrl = writer.deploymentUrl;
    }

    const invoke = overrides.invoke ?? createGovernedHttpInvoke({ url: deploymentUrl });
    // Core receipt stamp facts (one-core-memory, #45/#244): the process's session/thread id and
    // running commit ride the turn so BOTH doors in this process stamp the same thread — the
    // builder validates and drops anything invalid; a missing commit stamps nothing, honestly.
    const thread = overrides.thread ?? currentThreadId();
    const sourceCommit = overrides.sourceCommit ?? currentSourceCommit();
    const result: CaptureTurnResult = await captureTurn(
      // origin rides through verbatim — the builder validates the slug and drops anything invalid.
      {
        ownerText: args.ownerText,
        replyText,
        model: args.model,
        at: new Date().toISOString(),
        ...(args.origin ? { origin: args.origin } : {}),
        thread,
        ...(sourceCommit !== undefined ? { sourceCommit } : {}),
      },
      { ownerRootId, deploymentUrl, invoke, nextUse },
    );

    if (result.ok) {
      finish('ok', `key=${result.key} receipt=${result.receiptHash}`, { key: result.key }, { key: result.key, receipt: result.receiptHash });
    } else {
      // surfaced VERBATIM (hex-truncated) — the envelope's own reason, never re-wrapped.
      finish('refused', result.refused, { transportInvoked: result.transportInvoked });
      if (MANIFEST_LIFECYCLE_RE.test(result.refused)) cachedWriter = null; // next turn re-ceremonies
    }
  };

  const queued = captureQueue.then(run).catch((e) => {
    // The absolute backstop: fire-and-forget means even a bug in the glue never surfaces to chat.
    try { console.error(`[shadow-capture] contained internal error: ${e instanceof Error ? e.message : String(e)}`); } catch { /* nothing left to do */ }
  });
  captureQueue = queued;
  return queued;
}
