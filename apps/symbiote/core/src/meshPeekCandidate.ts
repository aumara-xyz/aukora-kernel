// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * mesh_peek CANDIDATE (DORMANT) — a pure, read-only, receipt-keyed cross-origin recall
 * library. Round-12 GHP deliverable: the accepted Gaussian/braid evidence (issue #45,
 * probes/gaussian-memory, landed via PR #258) re-shaped onto production-shaped handles.
 *
 * HONEST SCOPE — read this before wiring it into a lane:
 *   - DORMANT: nothing imports this module. No Convex wiring, no recall router, no
 *     memory_peek replacement, no UI. Promotion is a separate MAIN decision.
 *   - PURE + DETERMINISTIC: no clock, no randomness, no IO, no network. Two indexes
 *     built from the same rows are structurally identical.
 *   - ADVISORY ONLY: a peek returns stored text + provenance; it grants nothing.
 *     A clump handle is a VIEW over governed rows — never the canonical memory and
 *     never an authority signal. Every handle expands to exact source row ids.
 *   - `turnsAgo` is a TRUE COUNT of distinct newer turn keys in the origin (the
 *     MAIN-ratified definition), never a time delta.
 *   - Supersede comes from the ROW (`supersedes: rowId`, receipt-provided), never
 *     inferred from geometry. History is never deleted: superseded handles stay
 *     reachable through lineage with sources intact.
 *
 * Mechanism (the benchmark-supported findings, and only those): subject keys bucket
 * clumping (same-value/different-subject rows can never fuse); claim-level similarity
 * gates merges within a bucket (whole-row thresholds proved unsound); value anchors
 * (numbers/times/versions/glyph-runs) veto conflicting merges; evidence mass is
 * log-weighted for recall and linearly/fresh-first for digests.
 *
 * DEPENDENCY BOUNDARY: core/ is typechecked in isolation; this module imports nothing.
 */

export type GovernedRow = {
  /** governed row / receipt key — the only canonical identity */
  rowId: string;
  /** receipt subject key (e.g. the `key` of `mem:{owner}:{key}`) */
  subject: string;
  /** writing surface/thread id */
  origin: string;
  /** origin-scoped turn key; distinct per turn of that origin */
  turnKey: string;
  /** receipt sequence order (createdAt ordinal); strictly increasing per index */
  seq: number;
  /** bounded claim text (a view of the row, not the row) */
  claim: string;
  /** rowId this row supersedes (receipt-provided correction), if any */
  supersedes?: string;
};

export type ClumpHandle = {
  handleId: number;
  subject: string;
  /** medoid claim of the first absorbed row — a label, never canonical content */
  claimLabel: string;
  /** exact source row ids, every absorbed row, always */
  sourceRowIds: string[];
  /** every contributing origin, preserved */
  origins: string[];
  evidenceMass: number;
  newestSeq: number;
  supersededBy: number | null;
  /** handleIds this handle superseded */
  lineage: number[];
};

export type PeekResult = {
  handle: ClumpHandle;
  score: number;
  /** per contributing origin: distinct newer turn keys since the handle's newest row there */
  turnsAgo: Record<string, number>;
};

const DIM = 512;

/** Research-stress configuration (round 13). Defaults reproduce the accepted
 * benchmark byte-for-byte; non-default values exist ONLY so the stress harness can
 * measure stability across embedding capacity and hash bases. Production use (if
 * ever promoted) is the default config. */
export type MeshPeekConfig = { dim?: number; hashSeed?: number };
const TAU_CLAIM = 0.78;
/** relaxed merge floor when subject matches AND anchor sets agree exactly (accepted
 * probe finding: subject key + exact value agreement is strong same-claim evidence) */
const TAU_ANCHOR_EQUAL = 0.35;
/** recency decay in peek scoring, per elapsed distinct TURN of the handle's
 * freshest origin — semantic time, like turnsAgo. (Round-13 stress finding: the
 * braid's raw-sequence decay does not scale — at ~2,500 rows exp(-0.01*seqDist)
 * annihilates every older memory, collapsing recall to ~0.09 while bookkeeping
 * gates stayed green. Turn-based decay is bounded by conversation length, not by
 * store size.) */
const TURN_DECAY = 0.05;
const WORD_WEIGHT = 2.0;
const ANCHOR_WEIGHT = 4.0;
const ANCHOR_BOOST = 1.5;

const ANCHOR_RE = /\b(?:\d+(?:[:.]\d+)?(?:am|pm)?|v\d+|#\d+)\b/g;
const GLYPH_RE = /[^\x00-\x7f]{4,}/g;
const TOKEN_RE = /[a-z0-9:.#]+|[^\x00-\x7f]{2,}/g;

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

function anchorsOf(text: string): Set<string> {
  const t = norm(text);
  return new Set([...(t.match(ANCHOR_RE) ?? []), ...(t.match(GLYPH_RE) ?? [])]);
}

/** VALUE anchors only (numbers/times/versions/ids). Glyph runs mark topics, not
 * values: they veto conflicting merges but never justify a relaxed merge floor. */
function valueAnchorsOf(text: string): Set<string> {
  return new Set(norm(text).match(ANCHOR_RE) ?? []);
}

/** FNV-1a 32-bit — stable across platforms, no crypto dependency. hashSeed=0 is
 * the accepted basis; other seeds exist only for the stress harness. */
function fnv(s: string, hashSeed: number): number {
  let h = (0x811c9dc5 ^ hashSeed) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function embed(text: string, dim: number, hashSeed: number): Float64Array {
  const v = new Float64Array(dim);
  const t = norm(text);
  const padded = `  ${t}  `;
  for (let i = 0; i < padded.length - 2; i++) {
    const h = fnv('3g:' + padded.slice(i, i + 3), hashSeed);
    v[h % dim] += (h & 0x10000) ? 1 : -1;
  }
  for (const tok of t.match(TOKEN_RE) ?? []) {
    const h = fnv('w:' + tok, hashSeed);
    const isAnchor = new RegExp(`^(?:${ANCHOR_RE.source})$`).test(tok) || /^[^\x00-\x7f]{4,}$/.test(tok);
    v[h % dim] += ((h & 0x10000) ? 1 : -1) * (isAnchor ? ANCHOR_WEIGHT : WORD_WEIGHT);
  }
  let n = 0;
  for (let i = 0; i < dim; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < dim; i++) v[i] /= n;
  return v;
}

function cos(a: Float64Array, b: Float64Array): number {
  let s = 0;
  const d = Math.min(a.length, b.length);
  for (let i = 0; i < d; i++) s += a[i] * b[i];
  return s;
}

type InternalHandle = ClumpHandle & { mu: Float64Array; anchors: Set<string>; valueAnchors: Set<string> };

export class MeshPeekIndex {
  private readonly dim: number;
  private readonly hashSeed: number;
  constructor(config: MeshPeekConfig = {}) {
    const dim = config.dim ?? DIM;
    if (!Number.isSafeInteger(dim) || dim <= 0 || dim > 1 << 20) {
      throw new Error('mesh_peek_invalid_dim'); // bounded positive safe integer; fail closed
    }
    const hashSeed = config.hashSeed ?? 0;
    if (!Number.isSafeInteger(hashSeed)) throw new Error('mesh_peek_invalid_hash_seed');
    this.dim = dim;
    this.hashSeed = hashSeed >>> 0; // fnv folds it in as uint32
  }
  private embed(text: string): Float64Array { return embed(text, this.dim, this.hashSeed); }
  private handles: InternalHandle[] = [];
  private rowText = new Map<string, string>();
  private rowMeta = new Map<string, { origin: string; turnKey: string; seq: number }>();
  private handleOfRow = new Map<string, number>();
  /** per origin: distinct turn keys in first-seen seq order, + key -> ordinal */
  private turnOrder = new Map<string, string[]>();
  private turnIndex = new Map<string, Map<string, number>>();
  private lastSeq = -Infinity;

  addRow(row: GovernedRow): ClumpHandle {
    if (row.seq <= this.lastSeq) throw new Error('mesh_peek_rows_must_arrive_in_seq_order');
    this.lastSeq = row.seq;
    if (this.rowText.has(row.rowId)) throw new Error('mesh_peek_duplicate_row_id');
    this.rowText.set(row.rowId, row.claim);
    this.rowMeta.set(row.rowId, { origin: row.origin, turnKey: row.turnKey, seq: row.seq });
    if (!this.turnIndex.has(row.origin)) {
      this.turnIndex.set(row.origin, new Map());
      this.turnOrder.set(row.origin, []);
    }
    const ti = this.turnIndex.get(row.origin)!;
    if (!ti.has(row.turnKey)) {
      ti.set(row.turnKey, this.turnOrder.get(row.origin)!.length);
      this.turnOrder.get(row.origin)!.push(row.turnKey);
    }

    const supersededHandle = row.supersedes !== undefined
      ? this.handles[this.handleOfRow.get(row.supersedes) ?? -1] ?? null
      : null;

    const x = this.embed(row.claim);
    const a = anchorsOf(row.claim);
    let best: InternalHandle | null = null;
    let bestSim = -1;
    for (const h of this.handles) {
      if (h.supersededBy !== null || h.subject !== row.subject) continue;
      if (supersededHandle && h.handleId === supersededHandle.handleId) continue; // a correction never merges into its target
      const s = cos(x, h.mu);
      if (s > bestSim) { best = h; bestSim = s; }
    }
    let target: InternalHandle;
    const va = valueAnchorsOf(row.claim);
    const valueAnchorsEqual = va.size > 0 && best !== null && best.valueAnchors.size === va.size
      && [...va].every((x) => best.valueAnchors.has(x));
    const mergeable = best !== null && this.anchorsCompatible(best, a)
      && (bestSim >= TAU_CLAIM || (valueAnchorsEqual && bestSim >= TAU_ANCHOR_EQUAL));
    if (best && mergeable) {
      const m = best.evidenceMass;
      const d = this.dim; // configurable path MUST use the instance dimension, not the module default
      for (let i = 0; i < d; i++) best.mu[i] = (m * best.mu[i] + x[i]) / (m + 1);
      let n = 0;
      for (let i = 0; i < d; i++) n += best.mu[i] * best.mu[i];
      n = Math.sqrt(n) || 1;
      for (let i = 0; i < d; i++) best.mu[i] /= n;
      best.evidenceMass += 1;
      best.newestSeq = row.seq;
      best.sourceRowIds.push(row.rowId);
      if (!best.origins.includes(row.origin)) best.origins.push(row.origin);
      for (const an of a) best.anchors.add(an);
      for (const an of va) best.valueAnchors.add(an);
      target = best;
    } else {
      target = {
        handleId: this.handles.length, subject: row.subject, claimLabel: row.claim.slice(0, 120),
        sourceRowIds: [row.rowId], origins: [row.origin], evidenceMass: 1, newestSeq: row.seq,
        supersededBy: null, lineage: [], mu: x, anchors: a, valueAnchors: va,
      };
      this.handles.push(target);
    }
    this.handleOfRow.set(row.rowId, target.handleId);
    if (supersededHandle && supersededHandle.handleId !== target.handleId) {
      supersededHandle.supersededBy = target.handleId;
      target.lineage.push(supersededHandle.handleId);
    }
    return this.snapshot(target);
  }

  private anchorsCompatible(h: InternalHandle, a: Set<string>): boolean {
    if (a.size === 0) return true;
    if (h.anchors.size === 0) return true;
    if (h.anchors.size !== a.size) return false;
    for (const x of a) if (!h.anchors.has(x)) return false;
    return true;
  }

  private snapshot(h: InternalHandle): ClumpHandle {
    const { mu: _mu, anchors: _anchors, valueAnchors: _valueAnchors, ...pub } = h;
    return { ...pub, sourceRowIds: [...h.sourceRowIds], origins: [...h.origins], lineage: [...h.lineage] };
  }

  turnsAgo(h: ClumpHandle | InternalHandle): Record<string, number> {
    const newest = new Map<string, number>();
    for (const rid of h.sourceRowIds) {
      const m = this.rowMeta.get(rid)!;
      const ord = this.turnIndex.get(m.origin)!.get(m.turnKey)!;
      newest.set(m.origin, Math.max(newest.get(m.origin) ?? -1, ord));
    }
    const out: Record<string, number> = {};
    for (const [origin, ord] of newest) {
      out[origin] = this.turnOrder.get(origin)!.length - 1 - ord;
    }
    return out;
  }

  /** Read-only recall. Newest valid superseding claim ranks first; superseded handles
   * are excluded here and reachable only via lineage(). */
  peek(query: { text?: string; subject?: string }, k = 5): PeekResult[] {
    const qv = query.text !== undefined ? this.embed(query.text) : null;
    const qa = query.text !== undefined ? anchorsOf(query.text) : new Set<string>();
    const scored: { h: InternalHandle; score: number }[] = [];
    for (const h of this.handles) {
      if (h.supersededBy !== null) continue;
      if (query.subject !== undefined && h.subject !== query.subject) continue;
      let s = 1;
      if (qv) {
        let boost = 1;
        if (qa.size) for (const an of qa) if (h.anchors.has(an)) { boost = ANCHOR_BOOST; break; }
        const ta = this.turnsAgo(h);
        const freshest = Object.values(ta).length ? Math.min(...Object.values(ta)) : 0;
        const recency = Math.exp(-TURN_DECAY * freshest);
        s = cos(qv, h.mu) * (1 + Math.log1p(h.evidenceMass)) * recency * boost;
      }
      scored.push({ h, score: s });
    }
    scored.sort((p, q) => q.score - p.score || q.h.newestSeq - p.h.newestSeq || p.h.handleId - q.h.handleId);
    return scored.slice(0, k).map(({ h, score }) => ({ handle: this.snapshot(h), score, turnsAgo: this.turnsAgo(h) }));
  }

  /** What happened in each OTHER origin since `sinceSeq` — ranked by fresh evidence
   * first (total mass second): the braid's digest law. */
  digest(callerOrigin: string, sinceSeq: number, perOrigin = 4): Record<string, { handle: ClumpHandle; freshRowIds: string[] }[]> {
    const out: Record<string, { handle: ClumpHandle; freshRowIds: string[] }[]> = {};
    const origins = [...this.turnOrder.keys()].filter((o) => o !== callerOrigin).sort();
    for (const origin of origins) {
      const items: { h: InternalHandle; fresh: string[] }[] = [];
      for (const h of this.handles) {
        if (h.supersededBy !== null) continue;
        const fresh = h.sourceRowIds.filter((rid) => {
          const m = this.rowMeta.get(rid)!;
          return m.origin === origin && m.seq > sinceSeq;
        });
        if (fresh.length) items.push({ h, fresh });
      }
      items.sort((p, q) => q.fresh.length - p.fresh.length || q.h.evidenceMass - p.h.evidenceMass || p.h.handleId - q.h.handleId);
      out[origin] = items.slice(0, perOrigin).map(({ h, fresh }) => ({ handle: this.snapshot(h), freshRowIds: fresh }));
    }
    return out;
  }

  /** Expand a handle to its exact governed rows (id + stored claim text). */
  expand(handleId: number): { rowId: string; claim: string; origin: string; seq: number }[] {
    const h = this.handles[handleId];
    if (!h) throw new Error('mesh_peek_unknown_handle');
    return h.sourceRowIds.map((rid) => {
      const m = this.rowMeta.get(rid)!;
      return { rowId: rid, claim: this.rowText.get(rid)!, origin: m.origin, seq: m.seq };
    });
  }

  /** Full supersede chain behind a handle (oldest last). History is never deleted. */
  lineage(handleId: number): ClumpHandle[] {
    const out: ClumpHandle[] = [];
    let frontier = [handleId];
    const seen = new Set<number>();
    while (frontier.length) {
      const next: number[] = [];
      for (const id of frontier) {
        if (seen.has(id)) continue;
        seen.add(id);
        const h = this.handles[id];
        if (!h) continue;
        out.push(this.snapshot(h));
        next.push(...h.lineage);
      }
      frontier = next;
    }
    return out;
  }

  /** Every row id reachable through handles (superseded included) — deletion audit. */
  reachableRowIds(): Set<string> {
    const s = new Set<string>();
    for (const h of this.handles) for (const rid of h.sourceRowIds) s.add(rid);
    return s;
  }

  liveHandles(): ClumpHandle[] {
    return this.handles.filter((h) => h.supersededBy === null).map((h) => this.snapshot(h));
  }

  allHandles(): ClumpHandle[] {
    return this.handles.map((h) => this.snapshot(h));
  }
}
