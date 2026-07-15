/**
 * 24Z.29 — Fable Ingestion Seed (READ-ONLY, evidence-only; the index Fable may LATER learn from).
 *
 * Fable is the future inside-out refactorer / embodiment intelligence — it grows from receipt-labeled episodes,
 * proposes STRUCTURE, and NEVER authorizes action. This seed is a read-only, advisory index over episodes:
 *   - source labels are preserved and load-bearing; synthetic/test-double is NEVER upgraded to real.
 *   - only Accord `evidence_only`, complete, consistently-labeled episodes are ingestible; quarantined episodes are
 *     carried ONLY as quarantine metadata (count), never as ingestible evidence.
 *   - `fableCanAuthorize` / `grantsAuthority` are literal false.
 * FIREWALL: this module imports NO gate/apply/OpenCode/permit/signer code, and no such module imports it (one-way,
 * enforced by an isolation test). Fable can never trigger apply/gate/OpenCode from here.
 */
import { sanitizeEpisode, isFableIngestible, buildEpisode, type EpisodeRecord, type EpisodeSource } from './episodeMemory';

function sha256hex(s: string): string {
  // local hash (avoids importing any signer/crypto-authority module) — node:crypto is a primitive, not authority.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require('crypto') as typeof import('crypto');
  return crypto.createHash('sha256').update(s).digest('hex');
}

export interface FableSeedEntry {
  episodeId: string;
  episodeSource: EpisodeSource;
  synthetic: boolean;
  realModelRan: boolean;
  accordTier: EpisodeRecord['accordTier'];
  ingestible: boolean;
  notesCategory: EpisodeRecord['notesCategory'];
}

export interface FableIngestionSeed {
  schema: 'fable-ingestion-seed-v0';
  advisoryOnly: true;
  readOnly: true;
  grantsAuthority: false;
  fableCanAuthorize: false;
  fableIngestsSyntheticAsReal: false;     // literal: synthetic is never treated as real
  total: number;
  ingestibleCount: number;
  realCount: number;                      // episodes from a REAL model run (0 until a real endpoint runs)
  syntheticCount: number;
  quarantinedCount: number;
  latestSource: EpisodeSource | 'none';
  entries: FableSeedEntry[];              // ingestible entries only (label-preserving, no payload)
  quarantined: FableSeedEntry[];          // quarantine metadata only
}

/** Build the read-only Fable seed from episodes. Re-sanitizes every episode; the Accord/source gate decides
 *  ingestibility (never the incoming flag). Synthetic/test-double can never be counted as real. */
export function buildFableIngestionSeed(rawEpisodes: unknown[]): FableIngestionSeed {
  const episodes = rawEpisodes.map((e) => sanitizeEpisode(e)).filter((r) => r.ok).map((r) => r.episode!) as EpisodeRecord[];
  const entry = (e: EpisodeRecord): FableSeedEntry => ({ episodeId: e.episodeId, episodeSource: e.episodeSource, synthetic: e.synthetic, realModelRan: e.realModelRan, accordTier: e.accordTier, ingestible: isFableIngestible(e), notesCategory: e.notesCategory });
  const ingestible = episodes.filter((e) => isFableIngestible(e)).map(entry);
  const quarantined = episodes.filter((e) => e.accordTier === 'quarantined').map(entry);
  return {
    schema: 'fable-ingestion-seed-v0', advisoryOnly: true, readOnly: true, grantsAuthority: false,
    fableCanAuthorize: false, fableIngestsSyntheticAsReal: false,
    total: episodes.length,
    ingestibleCount: ingestible.length,
    realCount: episodes.filter((e) => e.episodeSource === 'real' && e.realModelRan).length,
    syntheticCount: episodes.filter((e) => e.synthetic).length,
    quarantinedCount: quarantined.length,
    latestSource: episodes.length ? episodes[episodes.length - 1].episodeSource : 'none',
    entries: ingestible,
    quarantined,
  };
}

/**
 * Deterministic FIXTURE seed (no real model has run). Produces a handful of clearly-labelled fixture episodes from
 * the available safe artifacts so the schema + seed + UI count are wired — NEVER presented as real model behavior.
 */
export function buildFixtureEpisodeSeed(round = '24Z.29'): EpisodeRecord[] {
  const h = (tag: string) => sha256hex(`${round}|${tag}`);
  // a complete, evidence_only fixture episode (sandbox loop proven offline) → ingestible (as a FIXTURE).
  const e1 = buildEpisode({
    episodeId: 'ep_fixture_sandbox_loop', episodeSource: 'fixture', sourceRound: round, engineSource: 'local_engine',
    realModelRan: false, createdAtBucket: 1, accordTier: 'evidence_only',
    sandboxReceiptHash: h('sandbox'), canonicalizationReceiptHash: h('canon'), hrtTraceHash: h('hrt'),
    accordVerdictHash: h('accord'), structuredTruthHash: h('truth'), notesCategory: 'fixture_seed',
  });
  // a test-double episode that is INCOMPLETE (missing canon receipt) → not ingestible.
  const e2 = buildEpisode({
    episodeId: 'ep_testdouble_incomplete', episodeSource: 'test_double', sourceRound: round, engineSource: 'opencode',
    realModelRan: false, createdAtBucket: 2, accordTier: 'untested',
    sandboxReceiptHash: h('sandbox2'), accordVerdictHash: h('accord2'), structuredTruthHash: h('truth2'), notesCategory: 'parked',
  });
  // a fixture episode the Accord QUARANTINED (e.g. a private-leak control) → carried only as quarantine metadata.
  const e3 = buildEpisode({
    episodeId: 'ep_fixture_quarantined', episodeSource: 'fixture', sourceRound: round, engineSource: 'fixture',
    realModelRan: false, createdAtBucket: 3, accordTier: 'quarantined',
    sandboxReceiptHash: h('sandbox3'), canonicalizationReceiptHash: h('canon3'), hrtTraceHash: h('hrt3'),
    accordVerdictHash: h('accord3'), structuredTruthHash: h('truth3'), notesCategory: 'quarantined',
  });
  return [e1, e2, e3];
}

export function summarizeFableSeed(seed: FableIngestionSeed): string {
  return [
    `Fable ingestion seed: ${seed.total} episode(s), ${seed.ingestibleCount} ingestible, ${seed.realCount} from a real model, ${seed.quarantinedCount} quarantined.`,
    'READ-ONLY / advisory / evidence-only. Fable may propose structure; Fable can NOT authorize. Synthetic/test-double is never treated as real.',
  ].join(' ');
}
