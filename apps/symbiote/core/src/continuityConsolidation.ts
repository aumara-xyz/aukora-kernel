/**
 * 24Z.31 — Continuity Consolidation / Dream-Cycle seed (L2; evidence-only; teaches Aukora to remember SAFELY).
 *
 * Digests receipt-labeled episodes (24Z.29) into typed, source-labeled LESSONS. Core law: memory may INFORM future
 * proposals; memory may never AUTHORIZE. Lessons are STRUCTURED + categorical (enum kind/category + counts + hash
 * refs) — never freeform episode-derived prose, so no raw prompt / model output / hidden or decoded payload / key /
 * signature / grant material can ride along. Synthetic/test-double lessons stay synthetic and can never become real.
 * Identity-anchor CANDIDATES may be proposed but never auto-activate (a future human/AUMLOK ceremony is required).
 *
 * FIREWALL: imports no gate/apply/OpenCode/permit/signer code; no such module imports it (one-way, isolation-tested).
 * Idempotent + no-loss: consolidation is a pure function of its input (deterministic ids), every input episode gets
 * a disposition, and re-merging the same lessons REINFORCES (count up) rather than DUPLICATES.
 */
import * as crypto from 'crypto';
import { scanForbiddenKeys, scanForbiddenValues } from './forbiddenContent';
import { isPlainJsonShaped } from './hrtAccordSchema';
import { sanitizeEpisode, type EpisodeRecord, type EpisodeSource } from './episodeMemory';

export type LessonKind = 'success' | 'failure' | 'refusal' | 'boundary' | 'regression' | 'design_note' | 'identity_anchor_candidate';
export type SummaryCategory = 'sandbox_loop_ok' | 'refused_unsafe' | 'quarantined_leak' | 'incomplete_skipped' | 'parked_no_model' | 'safety_boundary';
export type DecayPolicy = 'decays' | 'reinforced' | 'protected_candidate';

export interface ConsolidationRecord {
  consolidationId: string;          // deterministic (hash of sorted source episode ids + kind) → idempotent
  sourceEpisodeIds: string[];
  sourceEpisodeHashes: string[];    // hex hash refs only
  episodeSources: EpisodeSource[];
  synthetic: boolean;               // true if ANY source is non-real (synthetic never becomes real)
  lessonKind: LessonKind;
  summaryCategory: SummaryCategory;
  lessonLabel: string;              // a FIXED engine-generated label per (kind,category) — never episode-derived text
  confidence: number;               // 0..1, derived from support
  decayPolicy: DecayPolicy;
  reinforcedByCount: number;        // how many episodes/merges reinforced this lesson
  identityAnchorCandidate: boolean;
  identityAnchorActive: false;      // HARD: candidates never auto-activate
  grantsAuthority: false;
  canAuthorize: false;
  fableReadable: boolean;
}

export const CONSOLIDATION_ALLOWED_FIELDS: ReadonlySet<string> = new Set([
  'consolidationId', 'sourceEpisodeIds', 'sourceEpisodeHashes', 'episodeSources', 'synthetic', 'lessonKind',
  'summaryCategory', 'lessonLabel', 'confidence', 'decayPolicy', 'reinforcedByCount', 'identityAnchorCandidate',
  'identityAnchorActive', 'grantsAuthority', 'canAuthorize', 'fableReadable',
]);
const HASH_ARRAY_FIELDS = ['sourceEpisodeHashes'];   // arrays of hex refs — excluded from the secret-value scan
const HEX_HASH = /^[0-9a-f]{1,64}$/;
// 24Z.31 red-team (MEDIUM): id fields must be a SAFE identifier charset — never free text / unicode / delimiters.
// This blocks a covert payload riding into the Fable index AND the `,`/`|` ambiguity that collided lesson ids.
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,120}$/;
const LESSON_KINDS = new Set<string>(['success', 'failure', 'refusal', 'boundary', 'regression', 'design_note', 'identity_anchor_candidate']);
const SUMMARY_CATS = new Set<string>(['sandbox_loop_ok', 'refused_unsafe', 'quarantined_leak', 'incomplete_skipped', 'parked_no_model', 'safety_boundary']);
const DECAY = new Set<string>(['decays', 'reinforced', 'protected_candidate']);

// FIXED labels — generated from the categorical lesson, NEVER from episode content (no payload can ride along).
const LESSON_LABELS: Record<SummaryCategory, string> = {
  sandbox_loop_ok: 'A sandbox loop completed and was canonicalized + receipted (evidence only).',
  refused_unsafe: 'An unsafe request was refused at the gate/boundary.',
  quarantined_leak: 'A private/authority leak was quarantined by the Accord — do not ingest as evidence.',
  incomplete_skipped: 'An episode lacked required receipts and was skipped (not ingestible).',
  parked_no_model: 'OpenCode remained parked (no real model) — nothing real ran.',
  safety_boundary: 'A safety boundary held and should be remembered/reinforced.',
};

function sha256_32(s: string): string { return crypto.createHash('sha256').update(s).digest('hex').slice(0, 32); }
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

export interface ConsolidationSanitizeResult { ok: boolean; record: ConsolidationRecord | null; droppedFields: string[]; reason: string }

/** Sanitize a raw consolidation record: plain-JSON fail-closed, recursive scanner (hash-array excluded), allowlist,
 *  enum + hex validation; recompute authority/fableReadable/identityAnchorActive (never trust incoming). */
export function sanitizeConsolidation(raw: unknown): ConsolidationSanitizeResult {
  if (raw === null || typeof raw !== 'object') return { ok: false, record: null, droppedFields: [], reason: 'not an object' };
  if (!isPlainJsonShaped(raw)) return { ok: false, record: null, droppedFields: [], reason: 'consolidation must be plain JSON (no Map/Set/class/function)' };
  const r = raw as Record<string, unknown>;
  const droppedFields = Object.keys(r).filter((k) => !CONSOLIDATION_ALLOWED_FIELDS.has(k));
  // hex-validate the hash array first, then exclude it from the secret-value scan (legit refs are not secrets).
  const hashes = Array.isArray(r.sourceEpisodeHashes) ? r.sourceEpisodeHashes : [];
  if (!hashes.every((h) => typeof h === 'string' && HEX_HASH.test(h))) return { ok: false, record: null, droppedFields, reason: 'sourceEpisodeHashes must be hex refs (not payloads)' };
  const scanTarget: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) if (!HASH_ARRAY_FIELDS.includes(k)) scanTarget[k] = v;
  const forbidden = [...scanForbiddenKeys(r), ...scanForbiddenValues(scanTarget).map((p) => `value@${p}`)];
  if (forbidden.length) return { ok: false, record: null, droppedFields, reason: `forbidden content: ${forbidden.join(', ')}` };
  if (!LESSON_KINDS.has(String(r.lessonKind))) return { ok: false, record: null, droppedFields, reason: 'invalid lessonKind' };
  if (!SUMMARY_CATS.has(String(r.summaryCategory))) return { ok: false, record: null, droppedFields, reason: 'invalid summaryCategory' };
  // 24Z.31 red-team (MEDIUM): consolidationId must be a hex digest (the canonical path emits sha256_32) and every
  // sourceEpisodeId must be a SAFE identifier — never trust them as free text (no covert payload, no `,`/`|` ambiguity).
  if (!(typeof r.consolidationId === 'string' && HEX_HASH.test(r.consolidationId))) return { ok: false, record: null, droppedFields, reason: 'consolidationId must be a hex digest (not free text)' };
  const rawIds = Array.isArray(r.sourceEpisodeIds) ? r.sourceEpisodeIds : [];
  if (!rawIds.every((x) => typeof x === 'string' && SAFE_ID.test(x))) return { ok: false, record: null, droppedFields, reason: 'sourceEpisodeIds must be safe identifiers (no free text / unicode / delimiters)' };
  const sources = (Array.isArray(r.episodeSources) ? r.episodeSources : []).filter((s): s is EpisodeSource => s === 'real' || s === 'test_double' || s === 'fixture');
  const synthetic = sources.some((s) => s !== 'real') ? true : (r.synthetic === true);
  const lessonKind = r.lessonKind as LessonKind;
  const summaryCategory = r.summaryCategory as SummaryCategory;
  const record: ConsolidationRecord = {
    consolidationId: typeof r.consolidationId === 'string' ? r.consolidationId.slice(0, 64) : 'con_0',
    sourceEpisodeIds: (Array.isArray(r.sourceEpisodeIds) ? r.sourceEpisodeIds : []).filter((x) => typeof x === 'string').map((x) => (x as string).slice(0, 120)),
    sourceEpisodeHashes: hashes as string[],
    episodeSources: sources,
    synthetic,
    lessonKind,
    summaryCategory,
    lessonLabel: LESSON_LABELS[summaryCategory],   // FIXED label, never the incoming text
    confidence: clamp01(typeof r.confidence === 'number' ? r.confidence : 0),
    decayPolicy: (DECAY.has(String(r.decayPolicy)) ? r.decayPolicy : 'decays') as DecayPolicy,
    reinforcedByCount: typeof r.reinforcedByCount === 'number' && r.reinforcedByCount >= 0 ? Math.trunc(r.reinforcedByCount) : 0,
    identityAnchorCandidate: r.identityAnchorCandidate === true,
    identityAnchorActive: false,   // HARD — never trust incoming; candidates never auto-activate
    grantsAuthority: false,
    canAuthorize: false,
    fableReadable: false,          // recomputed below
  };
  // Fable may read a lesson only if it is not a quarantine lesson and grants no authority.
  record.fableReadable = record.lessonKind !== 'boundary' || record.summaryCategory !== 'quarantined_leak';
  if (record.summaryCategory === 'quarantined_leak') record.fableReadable = false;   // quarantine lessons are metadata only
  return { ok: true, record, droppedFields, reason: 'ok' };
}

export interface EpisodeDisposition { episodeId: string; disposition: 'consolidated' | 'skipped' | 'quarantined'; reason?: string }
export interface ConsolidationResult { lessons: ConsolidationRecord[]; coverage: EpisodeDisposition[] }

function deriveLesson(group: EpisodeRecord[]): { lessonKind: LessonKind; summaryCategory: SummaryCategory; identityAnchorCandidate: boolean; decayPolicy: DecayPolicy } {
  const e = group[0];
  if (e.accordTier === 'quarantined') return { lessonKind: 'boundary', summaryCategory: 'quarantined_leak', identityAnchorCandidate: false, decayPolicy: 'reinforced' };
  if (!e.complete) return { lessonKind: 'failure', summaryCategory: 'incomplete_skipped', identityAnchorCandidate: false, decayPolicy: 'decays' };
  switch (e.notesCategory) {
    case 'refusal': return { lessonKind: 'refusal', summaryCategory: 'refused_unsafe', identityAnchorCandidate: true, decayPolicy: 'reinforced' };
    case 'parked': return { lessonKind: 'design_note', summaryCategory: 'parked_no_model', identityAnchorCandidate: false, decayPolicy: 'decays' };
    default: return { lessonKind: 'success', summaryCategory: 'sandbox_loop_ok', identityAnchorCandidate: false, decayPolicy: 'decays' };
  }
}

/**
 * Consolidate episodes into lessons. PURE + deterministic (idempotent). Groups episodes by
 * source|accordTier|notesCategory; each group → one lesson with a deterministic id. NO-LOSS: every input episode
 * gets a disposition (consolidated | skipped | quarantined). Re-sanitizes each episode (untrusted input).
 */
export function consolidateEpisodes(rawEpisodes: unknown[]): ConsolidationResult {
  const episodes = rawEpisodes.map((e) => sanitizeEpisode(e)).filter((r) => r.ok).map((r) => r.episode!) as EpisodeRecord[];
  const coverage: EpisodeDisposition[] = [];
  const groups = new Map<string, EpisodeRecord[]>();
  for (const e of episodes) {
    const key = `${e.episodeSource}|${e.accordTier}|${e.notesCategory}|${e.complete}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(e);
  }
  const lessons: ConsolidationRecord[] = [];
  for (const group of groups.values()) {
    const d = deriveLesson(group);
    const ids = group.map((e) => e.episodeId).sort();
    const hashes = [...new Set(group.flatMap((e) => [e.sandboxReceiptHash, e.accordVerdictHash, e.structuredTruthHash].filter((h): h is string => typeof h === 'string').map((h) => h.slice(0, 32))))];
    const res = sanitizeConsolidation({
      // 24Z.31 red-team (MEDIUM): INJECTIVE serialization (JSON.stringify, not join(',')) — ['a,b'] and ['a','b']
      // must hash differently, or distinct groups would collide into one id (idempotence/no-loss break).
      consolidationId: sha256_32(`${d.lessonKind}|${JSON.stringify(ids)}`),
      sourceEpisodeIds: ids,
      sourceEpisodeHashes: hashes,
      episodeSources: [...new Set(group.map((e) => e.episodeSource))],
      synthetic: group.some((e) => e.synthetic || e.episodeSource !== 'real'),
      lessonKind: d.lessonKind,
      summaryCategory: d.summaryCategory,
      confidence: clamp01(0.3 + 0.1 * group.length),
      decayPolicy: d.identityAnchorCandidate ? 'protected_candidate' : d.decayPolicy,
      reinforcedByCount: group.length,
      identityAnchorCandidate: d.identityAnchorCandidate,
    });
    if (res.ok && res.record) lessons.push(res.record);
    for (const e of group) coverage.push({
      episodeId: e.episodeId,
      disposition: e.accordTier === 'quarantined' ? 'quarantined' : !e.complete ? 'skipped' : 'consolidated',
      reason: e.accordTier === 'quarantined' ? 'accord quarantine' : !e.complete ? 'incomplete (missing receipts)' : undefined,
    });
  }
  return { lessons, coverage };
}

/** Merge lessons by consolidationId — idempotent: re-merging the SAME lesson REINFORCES (count up, may flip to
 *  'reinforced'), never DUPLICATES. New ids are appended. */
export function mergeConsolidations(existing: ConsolidationRecord[], incoming: ConsolidationRecord[]): ConsolidationRecord[] {
  const byId = new Map(existing.map((l) => [l.consolidationId, { ...l }]));
  for (const l of incoming) {
    const prev = byId.get(l.consolidationId);
    if (!prev) { byId.set(l.consolidationId, { ...l }); continue; }
    prev.reinforcedByCount += l.reinforcedByCount;
    if (prev.decayPolicy !== 'protected_candidate' && prev.reinforcedByCount >= 3) prev.decayPolicy = 'reinforced';
    prev.confidence = clamp01(prev.confidence + 0.05);
  }
  return [...byId.values()];
}

export interface ContinuityIndexEntry { consolidationId: string; lessonKind: LessonKind; summaryCategory: SummaryCategory; synthetic: boolean; reinforcedByCount: number; decayPolicy: DecayPolicy; identityAnchorCandidate: boolean }
export interface FableContinuityIndex {
  schema: 'fable-continuity-index-v0';
  advisoryOnly: true;
  readOnly: true;
  grantsAuthority: false;
  canAuthorize: false;
  memoryCanAuthorize: false;
  syntheticLessonsTreatedAsReal: false;     // literal — synthetic is never treated as real
  identityAnchorActive: false;              // literal — candidates only
  totalLessons: number;
  fableReadableCount: number;
  realLessonCount: number;                  // lessons from a REAL model (0 until one runs)
  syntheticLessonCount: number;
  quarantineLessonCount: number;
  identityAnchorCandidateCount: number;
  latestLessonSource: EpisodeSource | 'none';
  entries: ContinuityIndexEntry[];          // fableReadable lessons only (categorical; no payload)
}

/** Build the READ-ONLY Fable-facing continuity index. Re-sanitizes each lesson; only fableReadable lessons are
 *  exposed as entries; synthetic is never counted as real; quarantine lessons are counted, not exposed as evidence. */
export function buildFableContinuityIndex(rawLessons: unknown[]): FableContinuityIndex {
  const lessons = rawLessons.map((l) => sanitizeConsolidation(l)).filter((r) => r.ok).map((r) => r.record!) as ConsolidationRecord[];
  const readable = lessons.filter((l) => l.fableReadable);
  const allSources = lessons.flatMap((l) => l.episodeSources);
  return {
    schema: 'fable-continuity-index-v0', advisoryOnly: true, readOnly: true, grantsAuthority: false, canAuthorize: false,
    memoryCanAuthorize: false, syntheticLessonsTreatedAsReal: false, identityAnchorActive: false,
    totalLessons: lessons.length,
    fableReadableCount: readable.length,
    realLessonCount: lessons.filter((l) => !l.synthetic && l.episodeSources.every((s) => s === 'real') && l.episodeSources.length > 0).length,
    syntheticLessonCount: lessons.filter((l) => l.synthetic).length,
    quarantineLessonCount: lessons.filter((l) => l.summaryCategory === 'quarantined_leak').length,
    identityAnchorCandidateCount: lessons.filter((l) => l.identityAnchorCandidate).length,
    latestLessonSource: allSources.length ? allSources[allSources.length - 1] : 'none',
    entries: readable.map((l) => ({ consolidationId: l.consolidationId, lessonKind: l.lessonKind, summaryCategory: l.summaryCategory, synthetic: l.synthetic, reinforcedByCount: l.reinforcedByCount, decayPolicy: l.decayPolicy, identityAnchorCandidate: l.identityAnchorCandidate })),
  };
}

export function summarizeContinuity(idx: FableContinuityIndex): string {
  return [
    `Continuity dream-cycle: ${idx.totalLessons} lesson(s), ${idx.fableReadableCount} Fable-readable, ${idx.realLessonCount} from a real model, ${idx.quarantineLessonCount} quarantine, ${idx.identityAnchorCandidateCount} identity-anchor candidate(s).`,
    'READ-ONLY / advisory / evidence-only. Memory may inform proposals; it can NOT authorize. Synthetic is never treated as real. Identity anchors are candidates only (no active anchor; future human/AUMLOK ceremony required).',
  ].join(' ');
}
