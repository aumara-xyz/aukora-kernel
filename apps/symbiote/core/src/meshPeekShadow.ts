// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * mesh_peek SHADOW READER (RESEARCH ONLY, DORMANT) — one-core-memory round (#45/#244).
 *
 * The Gaussian/braid work (issue #45; probes/gaussian-memory, PRs #258/#262/#268) is real,
 * benchmarked, and NOT the live memory engine. This module is the governed harness that lets the
 * dormant MeshPeekIndex be evaluated AS A SHADOW against a baseline retriever on SYNTHETIC or
 * SANITIZED receipt fixtures — nothing else. Its laws:
 *
 *   - DORMANT: no live lane imports this module (pinned structurally by the benchmark test, the
 *     same law as meshPeekCandidate). Promotion into live recall is a separate MAIN decision.
 *   - SHADOW CANNOT SPEAK: compare() returns METRICS ONLY — no recalled text ever leaves this
 *     module toward a user response. The baseline remains authoritative by construction.
 *   - RECEIPT-FED ONLY: rows enter through governedRowFromReceipt (a receipt key + a value that
 *     may carry the core receipt stamp). Derived structures here are caches, never authority.
 *   - AUTO-DISABLE: any receipt mismatch (an indexed row id the governed ledger does not know),
 *     ingest failure, or rebuild failure latches `disabled` with a reason. A disabled shadow
 *     answers nothing until rebuilt from scratch.
 *   - ERASE INVALIDATES DERIVED DATA: eraseRow() removes the row from the governed ledger and
 *     REBUILDS the index from the remaining live rows — an erased row can never surface again
 *     from the derived structure (memory law M2b carried into the shadow tier).
 *   - VERSIONED: every reader records the encoder/config digest so drift between runs is a fact,
 *     not a suspicion.
 *
 * Memory never grants permission and never overrides AUMLOK; a shadow of memory grants even less.
 */
import { createHash } from 'crypto';
import { MeshPeekIndex, type GovernedRow, type MeshPeekConfig, type PeekResult } from './meshPeekCandidate';
import { readCoreReceiptStamp, CORE_SLUG_RE } from './coreMemoryEnvelope';

/** Version tag of the shadow encoder lineage — bump on ANY behavioral change to the mapping or
 *  the underlying candidate's scoring so recorded digests separate the runs. */
export const MESH_PEEK_SHADOW_VERSION = 'mesh-peek-shadow-v1/candidate-r13' as const;

/** The encoder/version digest recorded with every benchmark: config + version, canonical bytes. */
export function meshPeekEncoderDigest(config: MeshPeekConfig = {}): string {
  const body = JSON.stringify({ version: MESH_PEEK_SHADOW_VERSION, dim: config.dim ?? 512, hashSeed: config.hashSeed ?? 0 });
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

/** One receipt-shaped record as the governed store serves it: the row KEY (canonical identity
 *  inside the namespace), the stored value string, and the receipt-sequence ordinal. */
export interface ReceiptRecord {
  key: string;
  value: string;
  seq: number;
}

/** Map a receipt record to the candidate's GovernedRow, using the core receipt stamp when the
 *  value carries one (thread/origin/turn identity, supersedesKey → supersedes row id) and honest
 *  fallbacks when it does not (origin 'unknown', turnKey = the row's own key: every turn distinct).
 *  Pure; never throws on malformed values — the raw string is still an indexable claim. */
export function governedRowFromReceipt(rec: ReceiptRecord, ownerRootId: string): GovernedRow {
  let claim = rec.value;
  let origin = 'unknown';
  let turnKey = rec.key;
  let supersedes: string | undefined;
  let subject = rec.key.replace(/\.[^.]*$/, ''); // key family (turn.<ts>): a bounded default bucket
  try {
    const parsed = JSON.parse(rec.value) as Record<string, unknown>;
    const stamp = readCoreReceiptStamp(parsed.core);
    const rt = (parsed as { recentTurn?: { text?: unknown } }).recentTurn;
    if (rt && typeof rt.text === 'string' && rt.text.length > 0) claim = rt.text;
    else if (typeof parsed.text === 'string' && parsed.text.length > 0) claim = parsed.text;
    if (typeof parsed.subject === 'string' && parsed.subject.length > 0 && parsed.subject.length <= 64) subject = parsed.subject;
    if (stamp) {
      // untrusted-input discipline: the door slug is re-validated exactly as the live reader does
      // (review round) — a hostile stored origin string never becomes shadow provenance.
      const door = typeof parsed.origin === 'string' && CORE_SLUG_RE.test(parsed.origin) ? parsed.origin : 'door-unknown';
      origin = `${door}/${stamp.thread ?? 'thread-unknown'}`;
      turnKey = `${stamp.thread ?? 'thread-unknown'}.${stamp.at}`;
      if (stamp.supersedesKey) supersedes = `mem:${ownerRootId}:${stamp.supersedesKey}`;
    }
  } catch { /* not JSON — the raw value is the claim, identity honestly unknown */ }
  return { rowId: `mem:${ownerRootId}:${rec.key}`, subject, origin, turnKey, seq: rec.seq, claim, ...(supersedes ? { supersedes } : {}) };
}

export interface ShadowCompareMetrics {
  query: string;
  /** rank of the expected row in the SHADOW's expansion order, 1-based; null = not surfaced */
  shadowRankOfExpected: number | null;
  /** rank of the expected row in the BASELINE hit list, 1-based; null = not surfaced */
  baselineRankOfExpected: number | null;
  /** every shadow source row id ⊆ the governed ledger (false would have disabled the reader) */
  contaminationFree: boolean;
  /** provenance carried: the top shadow handle names its contributing origins */
  topHandleOrigins: string[];
  /** injected-clock latencies; null when no clock was injected */
  shadowLatencyMs: number | null;
  baselineLatencyMs: number | null;
}

export interface ShadowStatus {
  version: typeof MESH_PEEK_SHADOW_VERSION;
  encoderDigest: string;
  disabled: boolean;
  disabledReason: string | null;
  liveRows: number;
  erasedRows: number;
  advisoryOnly: true;
  grantsAuthority: false;
}

/**
 * The opt-in shadow reader. Holds the governed receipt ledger (what rows exist, which are erased)
 * and a rebuildable MeshPeekIndex over the LIVE rows only. Compare-only: nothing here can serve a
 * user-visible memory.
 */
export class MeshPeekShadowReader {
  private readonly ownerRootId: string;
  private readonly config: MeshPeekConfig;
  readonly encoderDigest: string;
  private index: MeshPeekIndex;
  /** the governed ledger: every receipt ever ingested, in seq order (erased ones marked) */
  private ledger: Array<{ rec: ReceiptRecord; erased: boolean }> = [];
  private rowIds = new Set<string>();
  private disabled_ = false;
  private disabledReason_: string | null = null;
  private readonly now: (() => number) | null;

  constructor(ownerRootId: string, opts: { config?: MeshPeekConfig; now?: () => number } = {}) {
    this.ownerRootId = ownerRootId;
    this.config = opts.config ?? {};
    this.encoderDigest = meshPeekEncoderDigest(this.config);
    this.index = new MeshPeekIndex(this.config);
    this.now = opts.now ?? null;
  }

  private disable(reason: string): void {
    this.disabled_ = true;
    this.disabledReason_ = reason;
  }

  get disabled(): boolean {
    return this.disabled_;
  }

  status(): ShadowStatus {
    return {
      version: MESH_PEEK_SHADOW_VERSION,
      encoderDigest: this.encoderDigest,
      disabled: this.disabled_,
      disabledReason: this.disabledReason_,
      liveRows: this.ledger.filter((l) => !l.erased).length,
      erasedRows: this.ledger.filter((l) => l.erased).length,
      advisoryOnly: true,
      grantsAuthority: false,
    };
  }

  /** Ingest one receipt into the ledger + index. Any failure disables the shadow (never throws). */
  ingest(rec: ReceiptRecord): void {
    if (this.disabled_) return;
    try {
      const row = governedRowFromReceipt(rec, this.ownerRootId);
      if (this.rowIds.has(row.rowId)) {
        this.disable(`duplicate receipt row id: ${row.rowId}`);
        return;
      }
      this.index.addRow(row);
      this.ledger.push({ rec, erased: false });
      this.rowIds.add(row.rowId);
    } catch (e) {
      this.disable(`ingest failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** ERASE LAW: remove the row from the governed ledger and REBUILD the derived index from the
   *  remaining live rows. The derived structure can never serve an erased row again. */
  eraseRow(key: string): void {
    if (this.disabled_) return;
    const rowId = `mem:${this.ownerRootId}:${key}`;
    const entry = this.ledger.find((l) => l.rec.key === key && !l.erased);
    if (!entry) return; // unknown or already erased — nothing derived to invalidate
    entry.erased = true;
    this.rowIds.delete(rowId);
    try {
      const rebuilt = new MeshPeekIndex(this.config);
      for (const l of this.ledger) {
        if (l.erased) continue;
        rebuilt.addRow(governedRowFromReceipt(l.rec, this.ownerRootId));
      }
      this.index = rebuilt;
      // fail-closed self-check: nothing reachable may reference the erased row
      if (this.index.reachableRowIds().has(rowId)) this.disable(`erase invalidation failed for ${rowId}`);
    } catch (e) {
      this.disable(`rebuild after erase failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Receipt-mismatch tripwire: every row id the derived index can reach MUST be in the governed
   *  ledger's live set. Callable any time; the benchmark calls it after every mutation. */
  verifyReceipts(): boolean {
    if (this.disabled_) return false;
    for (const rid of this.index.reachableRowIds()) {
      if (!this.rowIds.has(rid)) {
        this.disable(`receipt mismatch: derived index reaches unledgered row ${rid}`);
        return false;
      }
    }
    return true;
  }

  /** TEST SEAM (drift simulation only): push a row STRAIGHT into the derived index, bypassing the
   *  ledger — models index corruption/drift so the tripwire can be proven to latch. */
  _driftForTests(row: GovernedRow): void {
    this.index.addRow(row);
  }

  /**
   * The shadow comparison — metrics only, never content. `baselineRowIds` is the baseline
   * retriever's ranked answer (authoritative; produced OUTSIDE this module); `expectedRowId` is
   * the fixture's labeled right answer. The shadow peeks its index, expands handles to row ids,
   * and reports where the expected row landed on each side. A disabled shadow returns null.
   */
  compare(query: string, baselineRowIds: string[], expectedRowId: string, k = 5): ShadowCompareMetrics | null {
    if (this.disabled_) return null;
    const t0 = this.now ? this.now() : null;
    let peeked: PeekResult[];
    try {
      peeked = this.index.peek({ text: query }, k);
    } catch (e) {
      this.disable(`peek failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
    const t1 = this.now ? this.now() : null;
    // contamination check: every source row of every returned handle must be ledgered + live
    let contaminationFree = true;
    for (const p of peeked) {
      for (const rid of p.handle.sourceRowIds) {
        if (!this.rowIds.has(rid)) {
          contaminationFree = false;
          this.disable(`receipt mismatch in peek result: ${rid}`);
        }
      }
    }
    // shadow rank: first handle (in score order) whose sources contain the expected row
    let shadowRank: number | null = null;
    for (let i = 0; i < peeked.length; i++) {
      if (peeked[i].handle.sourceRowIds.includes(expectedRowId)) { shadowRank = i + 1; break; }
    }
    const b = baselineRowIds.indexOf(expectedRowId);
    return {
      query,
      shadowRankOfExpected: shadowRank,
      baselineRankOfExpected: b >= 0 ? b + 1 : null,
      contaminationFree,
      topHandleOrigins: peeked.length ? [...peeked[0].handle.origins] : [],
      shadowLatencyMs: t0 !== null && t1 !== null ? t1 - t0 : null,
      baselineLatencyMs: null, // measured by the caller that RAN the baseline, if it chooses to
    };
  }

  /** Research-only lineage view for the supersede gate of the benchmark (row ids, no text). */
  lineageRowIds(query: string): string[][] {
    if (this.disabled_) return [];
    const top = this.index.peek({ text: query }, 1);
    if (!top.length) return [];
    return this.index.lineage(top[0].handle.handleId).map((h) => [...h.sourceRowIds]);
  }
}

/** The shadow never grants authority — mirrored mechanical guarantee. */
export function meshPeekShadowGrantsAuthority(): false {
  return false;
}
