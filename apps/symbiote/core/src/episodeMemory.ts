/**
 * 24Z.29 — Receipt-Labeled Episode Memory (evidence-only; the safe diet Fable may LATER learn from).
 *
 * An episode bundles the HASH REFERENCES of what already happened — a sandbox-apply receipt, a canonicalization
 * receipt, HRT traces, an Accord verdict, and a structured-truth snapshot — with hard SOURCE LABELS. It carries
 * NO raw prompt / model output / hidden or decoded payload / key / signature / grant material, and no generic
 * meta/payload escape hatch. Core law: Fable may ingest EVIDENCE, propose STRUCTURE, and NEVER authorize action.
 * A synthetic / test-double / fixture episode can NEVER be upgraded to "real model behavior".
 */
import { scanForbiddenKeys, scanForbiddenValues } from './forbiddenContent';
import { isPlainJsonShaped } from './hrtAccordSchema';

export type EpisodeSource = 'real' | 'test_double' | 'fixture';
export type EpisodeEngine = 'opencode' | 'local_engine' | 'fixture' | 'unknown';
export type AccordTier = 'evidence_only' | 'failed' | 'quarantined' | 'untested';
export type NotesCategory = 'sandbox_loop' | 'refusal' | 'parked' | 'fixture_seed' | 'incomplete' | 'quarantined';

export interface EpisodeRecord {
  episodeId: string;
  episodeSource: EpisodeSource;
  createdAtBucket: number;          // bucketed time (never raw ms)
  sourceRound: string;             // e.g. '24Z.29'
  engineSource: EpisodeEngine;
  realModelRan: boolean;
  synthetic: boolean;
  sandboxReceiptHash?: string;     // hex hash ref only
  canonicalizationReceiptHash?: string;
  hrtTraceHash?: string;
  accordVerdictHash?: string;
  accordTier: AccordTier;          // the Accord gate input (safe enum)
  structuredTruthHash?: string;
  complete: boolean;               // all required artifact refs present
  appliedLive: false;
  grantsAuthority: false;
  fableIngestible: boolean;
  fableAuthority: false;
  notesCategory: NotesCategory;
}

export const EPISODE_ALLOWED_FIELDS: ReadonlySet<string> = new Set([
  'episodeId', 'episodeSource', 'createdAtBucket', 'sourceRound', 'engineSource', 'realModelRan', 'synthetic',
  'sandboxReceiptHash', 'canonicalizationReceiptHash', 'hrtTraceHash', 'accordVerdictHash', 'accordTier',
  'structuredTruthHash', 'complete', 'appliedLive', 'grantsAuthority', 'fableIngestible', 'fableAuthority', 'notesCategory',
]);

const SOURCES = new Set<string>(['real', 'test_double', 'fixture']);
const ENGINES = new Set<string>(['opencode', 'local_engine', 'fixture', 'unknown']);
const TIERS = new Set<string>(['evidence_only', 'failed', 'quarantined', 'untested']);
const NOTES = new Set<string>(['sandbox_loop', 'refusal', 'parked', 'fixture_seed', 'incomplete', 'quarantined']);
const HEX_HASH = /^[0-9a-f]{1,64}$/;
const HASH_FIELDS = ['sandboxReceiptHash', 'canonicalizationReceiptHash', 'hrtTraceHash', 'accordVerdictHash', 'structuredTruthHash'] as const;
// the artifact refs an episode MUST carry to be "complete" (and thus eligible for Fable ingestion).
const REQUIRED_HASH_FIELDS = ['sandboxReceiptHash', 'canonicalizationReceiptHash', 'accordVerdictHash', 'structuredTruthHash'] as const;
const refsPresent = (r: Record<string, unknown>): boolean => REQUIRED_HASH_FIELDS.every((k) => typeof r[k] === 'string' && HEX_HASH.test(r[k] as string));

export interface EpisodeSanitizeResult { ok: boolean; episode: EpisodeRecord | null; droppedFields: string[]; reason: string }

/**
 * The Fable gate: an episode is ingestible ONLY if it is complete, carries a source label, its Accord verdict is
 * `evidence_only`, it grants no authority, and its source/realModelRan are CONSISTENT (a non-real source can never
 * claim realModelRan — so synthetic/test-double can never masquerade as real). Quarantined/failed/untested → never.
 */
export function isFableIngestible(e: { episodeSource?: string; accordTier?: string; complete?: boolean; realModelRan?: boolean; synthetic?: boolean; grantsAuthority?: unknown }): boolean {
  if (!e || !SOURCES.has(String(e.episodeSource))) return false;        // source label is load-bearing
  if (e.complete !== true) return false;                               // incomplete episodes are never ingestible
  if (e.accordTier !== 'evidence_only') return false;                  // Accord gate: only evidence_only passes
  if (e.grantsAuthority !== false) return false;
  // source ↔ realModelRan consistency: only a `real` source may have realModelRan=true; others MUST be synthetic.
  if (e.episodeSource === 'real') { if (e.realModelRan !== true) return false; }
  else { if (e.realModelRan !== false || e.synthetic !== true) return false; }
  return true;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v.slice(0, 120) : undefined);
const numB = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0);

/** Sanitize a raw episode: fail-closed on non-plain shape / forbidden content; allowlist; validate enums + hex
 *  hash refs; recompute `fableIngestible` from the gate (never trust an incoming `fableIngestible`/authority flag). */
export function sanitizeEpisode(raw: unknown): EpisodeSanitizeResult {
  if (raw === null || typeof raw !== 'object') return { ok: false, episode: null, droppedFields: [], reason: 'not an object' };
  if (!isPlainJsonShaped(raw)) return { ok: false, episode: null, droppedFields: [], reason: 'episode must be plain JSON (no Map/Set/class/function)' };
  const r = raw as Record<string, unknown>;
  const droppedFields = Object.keys(r).filter((k) => !EPISODE_ALLOWED_FIELDS.has(k));
  if (!SOURCES.has(String(r.episodeSource))) return { ok: false, episode: null, droppedFields, reason: 'episodeSource label required (real|test_double|fixture)' };
  // 24Z.31 red-team (MEDIUM): episodeId must be a SAFE identifier — never free text / unicode / `,`|`|` delimiters
  // (a bad id would carry a covert payload downstream AND break the consolidation id's group serialization).
  if (r.episodeId !== undefined && !(typeof r.episodeId === 'string' && /^[A-Za-z0-9_.:-]{1,120}$/.test(r.episodeId))) {
    return { ok: false, episode: null, droppedFields, reason: 'episodeId must be a safe identifier' };
  }
  // hex-validate the dedicated hash-ref fields FIRST (a non-hex "hash" = a smuggled payload → reject) — then a
  // legitimate sha256 ref (64-hex) must NOT trip the generic secret-value scanner, so exclude these fields from it.
  for (const hk of HASH_FIELDS) if (r[hk] !== undefined && !(typeof r[hk] === 'string' && HEX_HASH.test(r[hk] as string))) {
    return { ok: false, episode: null, droppedFields, reason: `${hk} must be a hex hash ref (not a payload)` };
  }
  const scanTarget: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) if (!(HASH_FIELDS as readonly string[]).includes(k)) scanTarget[k] = v;
  const forbidden = [...scanForbiddenKeys(r), ...scanForbiddenValues(scanTarget).map((p) => `value@${p}`)];
  if (forbidden.length) return { ok: false, episode: null, droppedFields, reason: `forbidden content: ${forbidden.join(', ')}` };
  const episodeSource = r.episodeSource as EpisodeSource;
  const realModelRan = r.realModelRan === true;
  // a non-real source can NEVER be real: synthetic is forced true and realModelRan forced false for test_double/fixture.
  const synthetic = episodeSource === 'real' ? r.synthetic === true : true;
  const base: EpisodeRecord = {
    episodeId: str(r.episodeId) ?? `ep_${numB(r.createdAtBucket)}`,
    episodeSource,
    createdAtBucket: numB(r.createdAtBucket),
    sourceRound: str(r.sourceRound) ?? 'unknown',
    engineSource: (ENGINES.has(String(r.engineSource)) ? r.engineSource : 'unknown') as EpisodeEngine,
    realModelRan: episodeSource === 'real' ? realModelRan : false,
    synthetic,
    sandboxReceiptHash: str(r.sandboxReceiptHash),
    canonicalizationReceiptHash: str(r.canonicalizationReceiptHash),
    hrtTraceHash: str(r.hrtTraceHash),
    accordVerdictHash: str(r.accordVerdictHash),
    accordTier: (TIERS.has(String(r.accordTier)) ? r.accordTier : 'untested') as AccordTier,
    structuredTruthHash: str(r.structuredTruthHash),
    // 24Z.29 red-team (MEDIUM): DERIVE completeness from required-ref PRESENCE — never trust the incoming flag
    // (sanitizeEpisode is the trust boundary; a forged {complete:true, no refs} must not become ingestible).
    complete: r.complete === true && refsPresent(r),
    appliedLive: false,
    grantsAuthority: false,
    fableIngestible: false,        // recomputed below — never trust an incoming value
    fableAuthority: false,
    notesCategory: (NOTES.has(String(r.notesCategory)) ? r.notesCategory : 'incomplete') as NotesCategory,
  };
  base.fableIngestible = isFableIngestible(base);
  const rec = base as unknown as Record<string, unknown>;
  for (const k of Object.keys(rec)) if (rec[k] === undefined) delete rec[k];
  return { ok: true, episode: base, droppedFields, reason: 'ok' };
}

export interface EpisodeBuildInput {
  episodeId: string; episodeSource: EpisodeSource; sourceRound: string; engineSource: EpisodeEngine;
  realModelRan?: boolean; createdAtBucket?: number; accordTier?: AccordTier;
  sandboxReceiptHash?: string; canonicalizationReceiptHash?: string; hrtTraceHash?: string;
  accordVerdictHash?: string; structuredTruthHash?: string; notesCategory?: NotesCategory;
}

/** Build an episode from already-safe artifact HASH refs. Missing a required ref ⇒ incomplete + not ingestible. */
export function buildEpisode(input: EpisodeBuildInput): EpisodeRecord {
  const required = [input.sandboxReceiptHash, input.canonicalizationReceiptHash, input.accordVerdictHash, input.structuredTruthHash];
  const complete = required.every((h) => typeof h === 'string' && HEX_HASH.test(h));
  const res = sanitizeEpisode({
    episodeId: input.episodeId, episodeSource: input.episodeSource, createdAtBucket: input.createdAtBucket ?? 0,
    sourceRound: input.sourceRound, engineSource: input.engineSource, realModelRan: input.realModelRan === true,
    synthetic: input.episodeSource !== 'real',
    sandboxReceiptHash: input.sandboxReceiptHash, canonicalizationReceiptHash: input.canonicalizationReceiptHash,
    hrtTraceHash: input.hrtTraceHash, accordVerdictHash: input.accordVerdictHash, accordTier: input.accordTier ?? 'untested',
    structuredTruthHash: input.structuredTruthHash, complete,
    notesCategory: input.notesCategory ?? (complete ? 'sandbox_loop' : 'incomplete'),
  });
  return res.episode!;   // sanitize of a well-formed build input always succeeds
}
