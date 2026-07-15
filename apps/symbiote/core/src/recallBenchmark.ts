// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * R5b recall benchmark — the YARDSTICK, built before the contender (stabilization round,
 * 2026-07-07). Nothing here reads or changes live recall; it scores engines on a corpus. The
 * 2026-07-08 run of this harness (docs/R5B_BASELINE_20260708.md) is the verdict that earned the
 * step-4 cutover to `recall.source: 'convex'`.
 *
 * THE RULE THIS SERVES (docs/R5_RECALL_STATUS.md + CONVEX_SHADOW_WRITE_PLAN.md): live fuzzy
 * recall does not cut over to Convex until a Convex-side search/recall DEMONSTRABLY WINS against
 * `kira.recall` on the same corpus and the same query set. That comparison needs a fixed,
 * deterministic harness FIRST — otherwise "demonstrably" decays into vibes. This module is that
 * harness: pure, injected, hermetically testable.
 *
 * Method (deterministic, no model, no randomness):
 *   - PROBE QUERIES are derived from the corpus itself, leave-the-atom-out style: for each live
 *     atom (sorted by id; erased/quarantined excluded — recall law), take its most distinctive
 *     tokens as the query; the atom is the query's one relevant answer. Self-referential by
 *     design — it measures "can the engine find the memory this text came from", the floor any
 *     recall engine must clear — and identically fair to every candidate.
 *   - Optional OWNER QUERIES (hand-written query → relevant atom ids) ride alongside when
 *     provided; the report scores the two sets separately.
 *   - METRICS: hit@1 / hit@3 / hit@5, MRR, mean latency. Same k, same order, every candidate.
 *
 * The Convex candidate slot exists but the kernel has NO search/recall function today — the CLI
 * (scripts/r5bRecallBenchmark.ts) reports that plainly instead of faking a score.
 */
import type { KiraBrainState } from './kiraBrain';
import { tokenize } from './kiraBrain';

export interface BenchQuery {
  id: string;
  query: string;
  /** Atom ids counted as correct answers for this query (probe queries have exactly one). */
  relevantAtomIds: string[];
}

/** A recall engine under test: same contract for the Kira baseline and any Convex candidate. */
export type CandidateRecallFn = (query: string, k: number) => Promise<Array<{ atomId: string }>>;

export interface CandidateScore {
  name: string;
  n: number;
  hitAt1: number;
  hitAt3: number;
  hitAt5: number;
  mrr: number;
  meanLatencyMs: number;
  advisoryOnly: true;
  grantsAuthority: false;
}

const STOP = new Set(['the', 'and', 'for', 'that', 'this', 'with', 'from', 'into', 'over', 'about', 'never', 'always']);

/** Derive deterministic probe queries from the corpus (sorted by atom id; erased/quarantined
 *  excluded; atoms with fewer than `minTokens` distinctive tokens skipped; capped). */
export function deriveProbeQueries(
  state: KiraBrainState,
  opts: { maxQueries?: number; tokensPerQuery?: number; minTokens?: number } = {},
): BenchQuery[] {
  const maxQueries = opts.maxQueries ?? 50;
  const tokensPerQuery = opts.tokensPerQuery ?? 6;
  const minTokens = opts.minTokens ?? 3;
  const out: BenchQuery[] = [];
  const atoms = [...state.atoms]
    .filter((a) => !a.erased && !a.quarantined)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const atom of atoms) {
    if (out.length >= maxQueries) break;
    // distinctive = longest unique non-stopword tokens; ties broken alphabetically (deterministic).
    const uniq = [...new Set(tokenize(atom.text ?? ''))].filter((t) => t.length >= 3 && !STOP.has(t));
    if (uniq.length < minTokens) continue;
    uniq.sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
    out.push({ id: `probe-${atom.id}`, query: uniq.slice(0, tokensPerQuery).join(' '), relevantAtomIds: [atom.id] });
  }
  return out;
}

/** Score one candidate over the query set. Never throws on candidate errors — a query whose
 *  recall call fails counts as a miss (an engine that errors is an engine that did not find it). */
export async function scoreCandidate(
  name: string,
  queries: BenchQuery[],
  recallFn: CandidateRecallFn,
  opts: { k?: number; now?: () => number } = {},
): Promise<CandidateScore> {
  const k = opts.k ?? 5;
  const now = opts.now ?? (() => performance.now());
  let hit1 = 0, hit3 = 0, hit5 = 0, mrrSum = 0, latSum = 0;
  for (const q of queries) {
    const t0 = now();
    let results: Array<{ atomId: string }> = [];
    try {
      results = (await recallFn(q.query, k)) ?? [];
    } catch {
      results = []; // errored = missed, counted honestly
    }
    latSum += now() - t0;
    const rank = results.findIndex((r) => q.relevantAtomIds.includes(r.atomId));
    if (rank >= 0) {
      if (rank < 1) hit1++;
      if (rank < 3) hit3++;
      if (rank < 5) hit5++;
      mrrSum += 1 / (rank + 1);
    }
  }
  const n = queries.length;
  return {
    name,
    n,
    hitAt1: n ? hit1 / n : 0,
    hitAt3: n ? hit3 / n : 0,
    hitAt5: n ? hit5 / n : 0,
    mrr: n ? mrrSum / n : 0,
    meanLatencyMs: n ? latSum / n : 0,
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

export interface EvidenceReportInput {
  corpusLabel: string;
  atomCount: number;
  liveAtomCount: number;
  queries: BenchQuery[];
  baseline: CandidateScore;
  /** Candidates actually scored (may be empty — e.g. Convex recall NOT BUILT yet). */
  candidates: CandidateScore[];
  /** Candidates that could not run, with the honest reason (e.g. 'NOT BUILT'). */
  absentCandidates: Array<{ name: string; reason: string }>;
  generatedAt?: string;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** Render the evidence report. The honesty lines are part of the CONTRACT (test-pinned): the
 *  report always states the recall source in force and what the numbers do and do not decide. */
export function renderEvidenceReport(input: EvidenceReportInput): string {
  const rows = [input.baseline, ...input.candidates]
    .map((c) => `| ${c.name} | ${c.n} | ${pct(c.hitAt1)} | ${pct(c.hitAt3)} | ${pct(c.hitAt5)} | ${c.mrr.toFixed(3)} | ${c.meanLatencyMs.toFixed(1)} ms |`)
    .join('\n');
  const absent = input.absentCandidates.map((a) => `- **${a.name}**: ${a.reason}`).join('\n');
  return [
    `# R5b recall benchmark — evidence report`,
    '',
    `Generated ${input.generatedAt ?? new Date().toISOString()} · corpus: **${input.corpusLabel}**`,
    `(${input.liveAtomCount} live atoms of ${input.atomCount} total; erased/quarantined excluded by recall law)`,
    `· ${input.queries.length} deterministic probe queries · advisoryOnly: true · grantsAuthority: false`,
    '',
    `| engine | n | hit@1 | hit@3 | hit@5 | MRR | mean latency |`,
    `|---|---|---|---|---|---|---|`,
    rows,
    '',
    absent ? `Candidates not scored:\n${absent}\n` : '',
    `## Boundary (unchanged by this report)`,
    '',
    `Since the R5b step-4 cutover, live fuzzy recall serves from the governed Convex brain —`,
    `\`recall.source: 'convex'\` by default; the archived Kira JSON brain serves ONLY under the`,
    `explicit \`kira-json-legacy\` hatch on nodes that have not run the M4 migration yet. This`,
    `report is evidence, NOT authority: numbers here re-score engines on a corpus, and any future`,
    `source change still requires a candidate scored by THIS harness, on the same corpus and query`,
    `set, demonstrably beating the incumbent — then an owner-reviewed brick, in that order.`,
    '',
  ].join('\n');
}
