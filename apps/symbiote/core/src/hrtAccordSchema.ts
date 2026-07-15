/**
 * 24Z.28 — HRT Accord schema (TELEMETRY_ONLY / OFFLINE_ANALYSIS — the stethoscope's notebook, not a hand).
 *
 * A typed record for OFFLINE analysis of boundary telemetry. Same discipline as the 24Z.20 trace recorder, with
 * the 24Z.26 canonicalization signals added — but ONLY as enums / counts / HASH REFS, never as payload:
 *   - positive ALLOWLIST only (no generic meta/payload escape hatch); unknown fields dropped (fail-closed).
 *   - RECURSIVE forbidden-key/value scanner rejects the whole record on any hit at any depth.
 *   - canonicalization telemetry = {action enum, category COUNTS, raw/canonical HASH REFS (hex only)} — a hash
 *     ref that is not hex (i.e. a smuggled payload) is rejected; raw/decoded payload, prompt text, secrets, keys,
 *     signatures, and grant tokens can never appear.
 *   - timing is BUCKETED before storage (raw ms / exact cadence never stored) — timing is evidence, never authority.
 * Core law: telemetry may become EVIDENCE; telemetry may never become AUTHORITY. grantsAuthority is always false.
 */
import { scanForbiddenKeys, scanForbiddenValues } from './forbiddenContent';
import type { ReceiptMode, TraceSource } from './boundaryTraceTelemetry';

export type CanonicalizationAction = 'allow' | 'sanitize' | 'quarantine' | 'refuse';

// the only canonicalization categories that may be COUNTED (mirrors the sentinel's HiddenChannelFinding kinds + the
// authority-word flag) — an arbitrary nested key is NOT a valid count bucket (no escape hatch).
export const ACCORD_CANON_CATEGORIES: ReadonlySet<string> = new Set([
  'zero_width', 'bidi_control', 'private_use', 'tag_char', 'control_char', 'homoglyph_risk', 'format_char', 'confusable_authority',
]);

export interface AccordRecord {
  recordId: string;
  timestampBucket?: number;        // BUCKETED time index (not raw ms / not exact cadence)
  boundaryMode: ReceiptMode;       // write | witness | release | unknown
  gateVerdict?: string;            // safe category only
  refusalCause?: string;           // safe category only
  retryCount?: number;
  latencyBucket?: number;          // BUCKETED latency (secondary evidence; never raw ms)
  stabilityDelta?: number;
  witnessHeldTension?: number;     // advisory (offline)
  witnessPlateauScore?: number;    // advisory plateau (offline-computed)
  canonicalizationAction?: CanonicalizationAction;
  canonicalizationCategoryCounts?: Record<string, number>;  // {zero_width: 2, ...} — COUNTS only
  rawHashRef?: string;             // sha256 HEX only — never the payload
  canonicalHashRef?: string;       // sha256 HEX only — never the payload
  source: TraceSource;
  classification: 'TELEMETRY_ONLY';
  grantsAuthority: false;
}

export const ACCORD_ALLOWED_FIELDS: ReadonlySet<string> = new Set([
  'recordId', 'timestampBucket', 'boundaryMode', 'gateVerdict', 'refusalCause', 'retryCount', 'latencyBucket',
  'stabilityDelta', 'witnessHeldTension', 'witnessPlateauScore', 'canonicalizationAction',
  'canonicalizationCategoryCounts', 'rawHashRef', 'canonicalHashRef', 'source', 'classification', 'grantsAuthority',
]);

const RECEIPT_MODES: ReadonlySet<string> = new Set(['write', 'witness', 'release', 'unknown']);
const TRACE_SOURCES: ReadonlySet<string> = new Set(['activeInference', 'gate', 'hypothesisMemory', 'sandboxApply', 'testFixture']);
const CANON_ACTIONS: ReadonlySet<string> = new Set(['allow', 'sanitize', 'quarantine', 'refuse']);
const HEX_HASH = /^[0-9a-f]{1,64}$/;

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v.slice(0, 200) : undefined);

/** True only for plain-JSON values: primitives, plain arrays, and plain objects (Object.prototype/null proto).
 *  Rejects Map/Set/Date/class instances/functions — containers the recursive scanner cannot introspect. */
export function isPlainJsonShaped(v: unknown, depth = 0): boolean {
  if (depth > 64) return false;                                  // bound recursion (hostile deep nesting)
  if (v === null || v === undefined) return true;                // null/undefined are JSON-droppable, not containers
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'boolean') return true;
  if (t === 'function' || t === 'symbol' || t === 'bigint') return false;
  if (Array.isArray(v)) return v.every((x) => isPlainJsonShaped(x, depth + 1));
  if (t === 'object') {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return false;   // Map/Set/Date/class instance → reject
    return Object.values(v as Record<string, unknown>).every((x) => isPlainJsonShaped(x, depth + 1));
  }
  return false;
}

export interface AccordSanitizeResult {
  ok: boolean;
  record: AccordRecord | null;
  droppedFields: string[];
  forbiddenFound: string[];
  reason: string;
}

/**
 * Sanitize a raw record into a stored Accord record. (1) recursive forbidden scan → reject the WHOLE record on any
 * hit (fail-closed); (2) allowlist → keep only known fields; (3) validate enums, count buckets (known categories →
 * finite non-negative ints only), and HASH REFS (hex only — a non-hex "hash" is a smuggled payload → rejected).
 */
export function sanitizeAccordRecord(raw: unknown): AccordSanitizeResult {
  if (raw === null || typeof raw !== 'object') return { ok: false, record: null, droppedFields: [], forbiddenFound: [], reason: 'not an object' };
  // 24Z.28 Fusion (Opus): the recursive scanner can only introspect plain objects/arrays/primitives. A non-plain
  // container (Map/Set/class instance/function/Date) could hide a payload the scanner can't see → FAIL CLOSED:
  // reject any record that is not plain-JSON-shaped before scanning (telemetry is always plain JSON data).
  if (!isPlainJsonShaped(raw)) return { ok: false, record: null, droppedFields: [], forbiddenFound: [], reason: 'record must be plain JSON (no Map/Set/class/function — non-plain containers are not introspectable)' };
  const r = raw as Record<string, unknown>;
  const droppedFields = Object.keys(r).filter((k) => !ACCORD_ALLOWED_FIELDS.has(k));

  // hash refs MUST be hex (a non-hex value is a smuggled payload, not a hash) — validate FIRST, then exclude these
  // fields from the generic secret-value scan so a legitimate 64-hex sha256 ref does not trip the hex-secret rule.
  const HASH_FIELDS = ['rawHashRef', 'canonicalHashRef'];
  for (const hk of HASH_FIELDS) {
    if (r[hk] !== undefined && !(typeof r[hk] === 'string' && HEX_HASH.test(r[hk] as string))) {
      return { ok: false, record: null, droppedFields, forbiddenFound: [], reason: `${hk} must be a hex hash ref (not a payload)` };
    }
  }
  const scanTarget: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) if (!HASH_FIELDS.includes(k)) scanTarget[k] = v;
  const forbiddenFound = [...scanForbiddenKeys(r), ...scanForbiddenValues(scanTarget).map((p) => `value@${p}`)];
  if (forbiddenFound.length) return { ok: false, record: null, droppedFields, forbiddenFound, reason: `forbidden content at depth: ${forbiddenFound.join(', ')}` };
  // canonicalization counts: known categories → finite non-negative integers only (no arbitrary nested keys/values).
  let counts: Record<string, number> | undefined;
  if (r.canonicalizationCategoryCounts !== undefined) {
    const c = r.canonicalizationCategoryCounts;
    if (c === null || typeof c !== 'object') return { ok: false, record: null, droppedFields, forbiddenFound: [], reason: 'canonicalizationCategoryCounts must be an object' };
    counts = {};
    for (const [k, v] of Object.entries(c as Record<string, unknown>)) {
      if (!ACCORD_CANON_CATEGORIES.has(k)) return { ok: false, record: null, droppedFields, forbiddenFound: [], reason: `unknown canonicalization category: ${k}` };
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return { ok: false, record: null, droppedFields, forbiddenFound: [], reason: `canonicalization count for ${k} must be a non-negative integer` };
      counts[k] = v;
    }
  }
  const canonAction = (typeof r.canonicalizationAction === 'string' && CANON_ACTIONS.has(r.canonicalizationAction)) ? (r.canonicalizationAction as CanonicalizationAction) : undefined;

  const record: AccordRecord = {
    recordId: str(r.recordId) ?? `acc_${num(r.timestampBucket) ?? 0}`,
    timestampBucket: num(r.timestampBucket),
    boundaryMode: (typeof r.boundaryMode === 'string' && RECEIPT_MODES.has(r.boundaryMode)) ? (r.boundaryMode as ReceiptMode) : 'unknown',
    gateVerdict: str(r.gateVerdict),
    refusalCause: str(r.refusalCause),
    retryCount: num(r.retryCount),
    latencyBucket: num(r.latencyBucket),
    stabilityDelta: num(r.stabilityDelta),
    witnessHeldTension: num(r.witnessHeldTension),
    witnessPlateauScore: num(r.witnessPlateauScore),
    canonicalizationAction: canonAction,
    canonicalizationCategoryCounts: counts,
    rawHashRef: str(r.rawHashRef),
    canonicalHashRef: str(r.canonicalHashRef),
    source: (typeof r.source === 'string' && TRACE_SOURCES.has(r.source)) ? (r.source as TraceSource) : 'testFixture',
    classification: 'TELEMETRY_ONLY',
    grantsAuthority: false,
  };
  const rec = record as unknown as Record<string, unknown>;
  for (const k of Object.keys(rec)) if (rec[k] === undefined) delete rec[k];
  return { ok: true, record, droppedFields, forbiddenFound: [], reason: 'ok' };
}

/** Bucket a raw timestamp/latency before it can be stored — raw ms / exact cadence never enters an Accord record. */
export function bucketTime(rawMs: number, bucketMs = 250): number { return Number.isFinite(rawMs) ? Math.floor(rawMs / bucketMs) : 0; }
export function bucketLatency(rawMs: number, bucketMs = 80): number { return Number.isFinite(rawMs) ? Math.floor(rawMs / bucketMs) : 0; }
