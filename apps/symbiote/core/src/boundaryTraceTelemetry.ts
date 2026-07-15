/**
 * 24Z.20 — HRT-002 Boundary Trace Telemetry (TELEMETRY_ONLY — a stethoscope, NOT a capability).
 *
 * A scrubbed PUBLIC trace around gate/boundary decisions: it records WHICH MODE the boundary was in
 * (write | witness | release | unknown) without exposing private state or granting any power. Hard law:
 *   - evidence never authority — telemetry can NEVER authorize/deny/retry/accelerate/alter a gate, permit,
 *     apply, OpenCode, Convex write, or workflow. There is NO read path from this module into any gate.
 *   - positive ALLOWLIST only; unknown fields are dropped (fail-closed).
 *   - a RECURSIVE forbidden-field scanner rejects the whole record if any forbidden key appears at any depth.
 *   - the witness `heldTensionScore` is write-only advisory metadata; it cannot grant capability.
 *   - latency is SECONDARY evidence; never authority (the fixture proves latency-only is insufficient).
 * It makes no scientific or capability claims; it is only a recorder, fixture-first.
 */

export type ReceiptMode = 'write' | 'witness' | 'release' | 'unknown';
export type TraceSource = 'activeInference' | 'gate' | 'hypothesisMemory' | 'sandboxApply' | 'testFixture';

export interface BoundaryTraceEvent {
  eventId: string;
  timestampMs: number;
  loopIteration?: number;
  sessionId?: string;
  receiptMode: ReceiptMode;
  gateVerdict?: string;        // 'green' | 'yellow' | 'red' | ... (safe summary, never internals)
  refusalCause?: string;       // a safe category string, never raw prompt/CoT
  retryCount?: number;
  latencyMs?: number;          // SECONDARY only
  safeConfidenceDelta?: number;
  safeEntropyProxy?: number;
  stabilityDelta?: number;
  heldTensionScore?: number;   // advisory, write-only
  source: TraceSource;
  classification: 'TELEMETRY_ONLY';
  grantsAuthority: false;
}

// Positive allowlist — ONLY these public field names may appear in a stored trace.
export const ALLOWED_FIELDS: ReadonlySet<string> = new Set([
  'eventId', 'timestampMs', 'loopIteration', 'sessionId', 'receiptMode', 'gateVerdict', 'refusalCause',
  'retryCount', 'latencyMs', 'safeConfidenceDelta', 'safeEntropyProxy', 'stabilityDelta', 'heldTensionScore',
  'source', 'classification', 'grantsAuthority',
]);

const RECEIPT_MODES: ReadonlySet<string> = new Set(['write', 'witness', 'release', 'unknown']);
const TRACE_SOURCES: ReadonlySet<string> = new Set(['activeInference', 'gate', 'hypothesisMemory', 'sandboxApply', 'testFixture']);

// 24Z.22: key + value forbidden-content scanning now lives in the ONE shared module (imported for local use
// + re-exported for the telemetry tests). No more drift between the telemetry scanner and the validator scanner.
import { scanForbiddenKeys, scanForbiddenValues } from './forbiddenContent';
export { scanForbiddenKeys, scanForbiddenValues };

export interface SanitizeResult {
  ok: boolean;
  event: BoundaryTraceEvent | null;
  droppedFields: string[];     // unknown (non-allowlisted) fields removed
  forbiddenFound: string[];    // forbidden keys at any depth → whole record rejected
  reason: string;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v.slice(0, 200) : undefined);

/**
 * Sanitize a raw trace into a stored event. (1) recursive forbidden scan → reject the WHOLE record on any
 * hit (fail-closed); (2) positive allowlist → keep only known public fields, drop the rest. No meta/payload
 * escape hatch survives — unknown blobs are dropped, and if they nest a forbidden key the record is rejected.
 */
export function sanitizeTraceEvent(raw: unknown): SanitizeResult {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, event: null, droppedFields: [], forbiddenFound: [], reason: 'not an object' };
  }
  const forbiddenKeys = scanForbiddenKeys(raw);
  const forbiddenValues = scanForbiddenValues(raw);
  const forbiddenFound = [...forbiddenKeys, ...forbiddenValues.map((p) => `value@${p}`)];
  if (forbiddenFound.length) {
    return { ok: false, event: null, droppedFields: [], forbiddenFound, reason: `forbidden content at depth: ${forbiddenFound.join(', ')}` };
  }
  const r = raw as Record<string, unknown>;
  const droppedFields = Object.keys(r).filter((k) => !ALLOWED_FIELDS.has(k));

  const receiptMode = (typeof r.receiptMode === 'string' && RECEIPT_MODES.has(r.receiptMode)) ? (r.receiptMode as ReceiptMode) : 'unknown';
  const source = (typeof r.source === 'string' && TRACE_SOURCES.has(r.source)) ? (r.source as TraceSource) : 'testFixture';

  const event: BoundaryTraceEvent = {
    eventId: str(r.eventId) ?? `evt_${num(r.timestampMs) ?? 0}`,
    timestampMs: num(r.timestampMs) ?? 0,
    loopIteration: num(r.loopIteration),
    sessionId: str(r.sessionId),
    receiptMode,
    gateVerdict: str(r.gateVerdict),
    refusalCause: str(r.refusalCause),
    retryCount: num(r.retryCount),
    latencyMs: num(r.latencyMs),
    safeConfidenceDelta: num(r.safeConfidenceDelta),
    safeEntropyProxy: num(r.safeEntropyProxy),
    stabilityDelta: num(r.stabilityDelta),
    heldTensionScore: num(r.heldTensionScore),
    source,
    classification: 'TELEMETRY_ONLY',
    grantsAuthority: false,
  };
  // strip undefined optionals so a stored event carries only present fields
  const rec = event as unknown as Record<string, unknown>;
  for (const k of Object.keys(rec)) if (rec[k] === undefined) delete rec[k];
  return { ok: true, event, droppedFields, forbiddenFound: [], reason: 'ok' };
}

// ── In-memory telemetry store (TELEMETRY_ONLY). No gate/permit/apply module may READ this (getTraces). ──
// Ring-buffered (24Z.23 temporal guard): bounded so live emission cannot grow memory + emission cadence is
// never exposed as a signal (the store is module-private; the only read accessor is getTraces, and no authority
// module may call it — enforced by the isolation test).
const MAX_TRACES = 2000;
const traceStore: BoundaryTraceEvent[] = [];

export function recordTraceEvent(raw: unknown): SanitizeResult {
  const res = sanitizeTraceEvent(raw);
  if (res.ok && res.event) { traceStore.push(res.event); if (traceStore.length > MAX_TRACES) traceStore.shift(); }
  return res;
}
export function getTraces(): readonly BoundaryTraceEvent[] { return traceStore.slice(); }
export function clearTraces(): void { traceStore.length = 0; }

/**
 * 24Z.23 — ONE-WAY sandbox-event sink. Emitters (sandbox apply, via an injected void callback) call this to
 * RECORD what happened; it returns `void`, so a caller can never read the store or the sanitize result back —
 * there is no authority read path by construction. Events are forced to `source:'sandboxApply'` and run through
 * the full allowlist + recursive forbidden-key/value scanner (so even a crafted refusalCause is scrubbed/rejected).
 */
export interface SandboxTelemetryEvent {
  phase: 'attempt' | 'verified' | 'refused' | 'applied';
  receiptMode?: ReceiptMode;
  refusalCause?: string;       // a SAFE category only (never raw paths/secrets) — also scanned here
  latencyMs?: number;
  sessionId?: string;
}
export function emitSandboxEvent(e: SandboxTelemetryEvent): void {
  recordTraceEvent({
    eventId: `sbx_${e.phase}_${num((e as { latencyMs?: number }).latencyMs) ?? 0}`,
    timestampMs: 0,
    receiptMode: e.receiptMode ?? (e.phase === 'applied' ? 'write' : 'unknown'),
    gateVerdict: e.phase,                       // 'attempt'|'verified'|'refused'|'applied' (a safe category)
    refusalCause: typeof e.refusalCause === 'string' ? e.refusalCause.slice(0, 64) : undefined,
    latencyMs: e.latencyMs,
    sessionId: e.sessionId,
    source: 'sandboxApply',
  });
  // returns void — the sink is one-way; no result/store handle escapes to the caller.
}

/** HARD: telemetry grants no authority and the witness score cannot grant capability — ever. */
export function telemetryGrantsAuthority(): false { return false; }
export function witnessGrantsCapability(_e: BoundaryTraceEvent): false { return false; }

/** HARD: a latency-only signal is NEVER sufficient as authority (the fixture proves it carries little signal). */
export function latencyOnlyClassifierSufficient(): false { return false; }

/** Stored traces must contain zero forbidden keys — a self-audit over the whole store. */
export function auditStoredTraces(): { clean: boolean; forbiddenFound: string[] } {
  const forbiddenFound = [...scanForbiddenKeys(traceStore), ...scanForbiddenValues(traceStore).map((p) => `value@${p}`)];
  return { clean: forbiddenFound.length === 0, forbiddenFound };
}

export function summarizeTelemetry(): string {
  return [
    'HRT-002 boundary-trace telemetry: TELEMETRY_ONLY (a recorder/stethoscope). Evidence never authority.',
    'Positive allowlist + recursive forbidden-field scanner (fail-closed). Witness held-tension is write-only.',
    'Telemetry has NO read path into any gate/permit/apply; latency is secondary, never authority. No scientific/capability claims.',
  ].join('\n');
}
