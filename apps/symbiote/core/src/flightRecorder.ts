// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Capability flight recorder (issue #54) + integrity chain (issue #60). An append-only JSONL witness of
 * every capability event — starting with #55's owner-lockdown mode-change, and (from #44 onward) every
 * read-only tool call. The evidence base a later stage earns trust from: "before Auma gets tools, every
 * capability call must be measurable" — and, from #60, "the conversation layer becomes as auditable as
 * the write layer already is."
 *
 * Integrity (issue #60): each event is HASH-CHAINED to the one before it — `eventHash` is computed over
 * the event's own bytes PLUS the previous event's `eventHash` (genesis for the first of a day). Tampering
 * with, reordering, inserting, or deleting any event breaks the chain, and `verifyFlightChain` reports
 * exactly where. This is the same "black box" property the write lane already has (hash-chained receipts),
 * brought to the capability/chat lane. The chain is per-day-file (daily rotation keeps each file bounded);
 * cross-file continuity is a deliberate follow-up, not silently implied.
 *
 * Boundaries (from the issues):
 *   - Append-only local state, NOT authority. A flight line never grants a capability; it records one.
 *   - No secrets / raw keys / env values / huge file contents. Every free-text field passes through the
 *     shared hex chokepoint (any 40+ hex run collapses), then the canonical secret scanner (burnDataset)
 *     — a residual secret-shaped value is REDACTED to a marker, never written verbatim — then a hard cap.
 *   - No raw hidden prompts or chain-of-thought: callers pass bounded `detail`/`meta` digests, never model
 *     scratch. The recorder enforces the size/redaction ceiling regardless.
 *   - FAIL-CLOSED for promoted capabilities: recordCapabilityEvent returns {ok}. A promoted capability
 *     (from #44) MUST refuse to run if ok===false — "if it cannot be logged, it does not run." The
 *     recorder itself does not enforce that; it reports honestly and the caller decides. (A safety
 *     DEMOTION like lockdown logs but proceeds regardless — you never block a downgrade on a log write.)
 *
 * Concurrency note (issue #83): appending reads the current tail to chain to it; that read→append is not
 * cross-process locked here. Stage 0 is single-writer; the lock is #83's job, tracked there, not faked here.
 *
 * Pure w.r.t. the clock: `now` is passed in, never read here (keeps events deterministic and testable).
 */
import { existsSync, mkdirSync, appendFileSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { truncateHexRunsForCapture } from './hexTruncation';
import { scanForSecrets } from './burnDataset';

const SCHEMA = 'aukora-flight-event-v2'; // v2 = hash-chained (v1 was per-event-hash only)
const MAX_DETAIL_CHARS = 500;
const MAX_META_VALUE_CHARS = 200;
/** The prevHash of the first event in a day file. 64 zeros keeps every prevHash uniformly hash-shaped. */
export const GENESIS_PREV_HASH = '0'.repeat(64);
const SECRET_REDACTION = '[redacted: secret-shaped value]';

export interface CapabilityEvent {
  /** The capability name, e.g. 'mode_change' (#55) or a tool name (#44). */
  kind: string;
  /** Human-readable, bounded, hex- + secret-sanitized description of what happened. */
  detail: string;
  /** Optional small structured context (mode snapshot, branch/HEAD, args digest). String values are
   *  hex- + secret-sanitized + capped; never put raw content or secrets here. */
  meta?: Record<string, string | number | boolean>;
}

export interface FlightRecordResult {
  ok: boolean;
  /** The file the line was appended to (on success). */
  path?: string;
  /** The exact JSON line written (on success) — handy for a caller that also wants to echo it. */
  line?: string;
  /** Why the write failed (on ok:false) — an honest reason for a fail-closed caller to surface. */
  error?: string;
}

/** Hex-collapse, then refuse any residual secret-shaped value, then cap. The scanned bytes are exactly
 *  the bytes that would be written, so what survives is what's stored. */
function safeText(s: string, cap: number): string {
  const collapsed = truncateHexRunsForCapture(s).slice(0, cap);
  return scanForSecrets(collapsed).clean ? collapsed : SECRET_REDACTION;
}

function safeMeta(meta: Record<string, string | number | boolean> | undefined): Record<string, string | number | boolean> {
  if (!meta) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(meta)) {
    out[k] = typeof v === 'string' ? safeText(v, MAX_META_VALUE_CHARS) : v;
  }
  return out;
}

/** The daily flight file for a given ISO timestamp (UTC date). Daily rotation keeps any single file
 *  bounded and makes "count clean read sessions" queries (the issue's later test) simple. */
export function flightFilePath(dir: string, nowIso: string): string {
  const day = nowIso.slice(0, 10); // YYYY-MM-DD from an ISO string
  return join(dir, `flight-${day}.jsonl`);
}

// The exact, key-ordered object that gets hashed — used identically by the writer and the verifier, so
// a recomputed hash can never drift from key-order differences. prevHash is part of the hashed bytes:
// that is what makes the log a CHAIN rather than a bag of independently-hashed lines.
interface FlightPayload {
  schema: string;
  at: string;
  kind: string;
  detail: string;
  meta: Record<string, string | number | boolean>;
  prevHash: string;
}
function hashPayload(p: FlightPayload): string {
  return createHash('sha256').update(JSON.stringify(p)).digest('hex');
}

/** Appends one event, hash-chained to the current tail. Returns {ok:true, path, line} on success,
 *  {ok:false, error} on any failure — never throws, so a fail-closed caller gets a clean boolean. */
export function recordCapabilityEvent(dir: string, event: CapabilityEvent, nowIso: string): FlightRecordResult {
  try {
    const prior = readFlightLog(dir, nowIso);
    const prevHash = prior.length > 0 ? prior[prior.length - 1].eventHash : GENESIS_PREV_HASH;
    const payload: FlightPayload = {
      schema: SCHEMA,
      at: nowIso,
      kind: safeText(event.kind, 120),
      detail: safeText(event.detail, MAX_DETAIL_CHARS),
      meta: safeMeta(event.meta),
      prevHash,
    };
    const eventHash = hashPayload(payload);
    const line = JSON.stringify({ ...payload, eventHash }) + '\n';

    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(flightFilePath(dir, nowIso), line);
    return { ok: true, path: flightFilePath(dir, nowIso), line };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export interface FlightEvent {
  schema: string;
  at: string;
  kind: string;
  detail: string;
  meta: Record<string, string | number | boolean>;
  prevHash: string;
  eventHash: string;
}

/** Reads back a day's events (for tests, inspection, chaining, and the future "count clean read
 *  sessions" query). Returns [] for a missing file; skips any unparseable line rather than throwing. */
export function readFlightLog(dir: string, nowIso: string): FlightEvent[] {
  const p = flightFilePath(dir, nowIso);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => { try { return JSON.parse(l) as FlightEvent; } catch { return null; } })
    .filter((e): e is FlightEvent => e !== null);
}

export interface ChainVerifyResult {
  ok: boolean;
  length: number;
  /** 0-based index of the first event that fails to verify, or null when the chain is intact. */
  brokenAt: number | null;
  /** Honest reason for the break (content-tamper vs. broken linkage vs. bad genesis), or null. */
  reason: string | null;
}

/**
 * Verifies a day's chain end to end. Detects: (a) content tampering — an event whose stored `eventHash`
 * no longer matches a hash of its own bytes; (b) a broken link — an event whose `prevHash` does not equal
 * the previous event's `eventHash`; (c) a bad genesis — the first event not anchored to GENESIS_PREV_HASH.
 * Any insertion/deletion/reorder shows up as one of (b) or (a). An empty/missing log is a valid empty chain.
 */
export function verifyFlightChain(dir: string, nowIso: string): ChainVerifyResult {
  const events = readFlightLog(dir, nowIso);
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const expectedPrev = i === 0 ? GENESIS_PREV_HASH : events[i - 1].eventHash;
    if (e.prevHash !== expectedPrev) {
      return { ok: false, length: events.length, brokenAt: i, reason: i === 0 ? 'first event not anchored to genesis' : 'prevHash does not match the previous event (insert/delete/reorder/tamper)' };
    }
    const recomputed = hashPayload({ schema: e.schema, at: e.at, kind: e.kind, detail: e.detail, meta: e.meta, prevHash: e.prevHash });
    if (recomputed !== e.eventHash) {
      return { ok: false, length: events.length, brokenAt: i, reason: 'eventHash does not match the event contents (tampered)' };
    }
  }
  return { ok: true, length: events.length, brokenAt: null, reason: null };
}

/** All flight files present in the directory (newest-day last), for a full-history walk. */
export function listFlightFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^flight-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort();
}
