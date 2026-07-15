// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * R5b recall benchmark CLI — runs the yardstick (core/src/recallBenchmark.ts) against a real
 * node's Kira brain and writes the evidence report. READ-ONLY: loads brain.json, runs recall
 * probes in memory, writes one markdown report. Never touches recall.source, the lanes, or the
 * Convex brain.
 *
 *   bun scripts/r5bRecallBenchmark.ts [--state <path>] [--out <path>] [--max-queries N] [--k N]
 *
 * The Convex candidate (R5b, 2026-07-07): `aumlokMemory:aumlokMemorySearch` — owner-root PoP per
 * probe under the dedicated `aumlokMemSearch` domain, ranked KEYS ONLY. Scoring assumes the
 * M4-migrated corpus, where row key == Kira atom id (byte-parity guaranteed by the migration
 * ceremony), so key hits score directly against probe relevance. Shadow-capture rows (turn.*)
 * may surface as competing noise — honest: the candidate must beat noise too. Every missing
 * prerequisite (backend down, custody refusal, function not deployed) is reported as an HONEST
 * absence in the evidence report — never a faked score. Cutover remains a separate owner-reviewed
 * brick, only after this candidate demonstrably wins on this harness.
 */
import * as fs from 'fs';
import * as path from 'path';
import { defaultKiraStatePath, loadBrainState, recall } from '../core/src/kiraBrain';
import {
  deriveProbeQueries,
  scoreCandidate,
  renderEvidenceReport,
  type CandidateRecallFn,
} from '../core/src/recallBenchmark';
import { readAdminKeyStrict, DEFAULT_BRAIN_URL } from '../core/src/memoryKernelTransport';
import { readOwnerSeedStrict } from '../core/src/memoryRecall';
import { isLoopbackUrl } from '../core/src/convexBrainReadonly';
// the kernel's OWN head + signer — imported, never mirrored, so the candidate's signatures can
// never drift from what the kernel verifies (the memoryRecallAdapter precedent).
import { searchHead, vecSearchHead, vectorHashHex } from '../convex/aumlokMemory';
import { signChainHeadV3 } from '../convex/aukoraSignedHead';
import { embedText, embedderHealth } from './embedClient';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const OWNER_ROOT_ID = 'aumara.root'; // the M4/capture constant — the corpus owner on a real node
const URL = process.env.AUKORA_CONVEX_URL ?? DEFAULT_BRAIN_URL;
const KEY_DIR = process.env.AUKORA_CONVEX_KEY_DIR;
const SEARCH_QUERY_PATH = 'aumlokMemory:aumlokMemorySearch'; // the ONE query this CLI may call

/** Admin-authenticated read of the ONE allowlisted search query (m4 adminCall pattern, read-only). */
async function searchQuery(adminKey: string, args: unknown): Promise<any> {
  const res = await fetch(`${URL}/api/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Convex ${adminKey}` },
    body: JSON.stringify({ path: SEARCH_QUERY_PATH, args, format: 'json' }),
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await res.text();
  if (raw.length > 4_000_000) throw new Error('oversized backend response');
  const parsed = JSON.parse(raw) as { status?: string; value?: unknown; errorMessage?: unknown };
  if (parsed.status === 'error') throw new Error(String(parsed.errorMessage ?? 'kernel error'));
  if (parsed.status !== 'success') throw new Error(`unexpected envelope: ${raw.slice(0, 200)}`);
  return parsed.value;
}

/** The R5b contender: aumlokMemorySearch over the local brain, owner-root signed per probe.
 *  Every missing prerequisite is an HONEST absence (never a faked score): backend down, custody
 *  refusal, or the search function not yet deployed on this backend. */
async function convexCandidate(): Promise<{ fn: CandidateRecallFn } | { absent: string }> {
  if (!isLoopbackUrl(URL)) return { absent: `refusing non-loopback backend URL ${URL} (local-only by law)` };
  const version = await fetch(`${URL}/version`, { signal: AbortSignal.timeout(5_000) }).then((r) => (r.ok ? r.text() : null)).catch(() => null);
  if (!version) return { absent: `backend not answering at ${URL} — start it with: bun run brain` };
  let adminKey: string, rootSeed: string;
  try {
    adminKey = readAdminKeyStrict(KEY_DIR ? path.join(KEY_DIR, 'admin-key.txt') : undefined);
    rootSeed = readOwnerSeedStrict(KEY_DIR ? path.join(KEY_DIR, 'memory-root.seed') : undefined);
  } catch (e) {
    return { absent: `custody refusal (fail-closed, not weakened): ${e instanceof Error ? e.message : String(e)}` };
  }
  // one probe call to learn whether the search function is deployed on THIS backend.
  try {
    const req = { v: 1, ownerRootId: OWNER_ROOT_ID, query: 'deployment probe', readerPrincipalId: OWNER_ROOT_ID, timestamp: Date.now() };
    const readerSig = await signChainHeadV3(rootSeed, await searchHead(req), 'aumlokMemSearch');
    await searchQuery(adminKey, { req, readerSig });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/FunctionPathNotFound|couldn't find/i.test(msg)) {
      return { absent: 'search function not deployed on this backend yet — re-deploy the kernel after merging (m4/provision deploy pattern), then rerun' };
    }
    return { absent: `probe call failed: ${msg}` };
  }
  const fn: CandidateRecallFn = async (query, k) => {
    const req = { v: 1, ownerRootId: OWNER_ROOT_ID, query, readerPrincipalId: OWNER_ROOT_ID, timestamp: Date.now(), limit: Math.min(20, Math.max(1, k)) };
    const readerSig = await signChainHeadV3(rootSeed, await searchHead(req), 'aumlokMemSearch');
    const res = await searchQuery(adminKey, { req, readerSig });
    if (!res?.ok) throw new Error(`search refused: ${res?.reason ?? 'unknown'}`);
    return (res.hits as Array<{ key: string }>).map((h) => ({ atomId: h.key }));
  };
  return { fn };
}


/** Admin-authenticated call of the ONE allowlisted vector-search ACTION (R5c contender). */
async function vectorAction(adminKey: string, args: unknown): Promise<any> {
  const res = await fetch(`${URL}/api/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Convex ${adminKey}` },
    body: JSON.stringify({ path: 'aumlokMemory:aumlokMemoryVectorSearch', args, format: 'json' }),
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await res.text();
  if (raw.length > 4_000_000) throw new Error('oversized backend response');
  const parsed = JSON.parse(raw) as { status?: string; value?: unknown; errorMessage?: unknown };
  if (parsed.status === 'error') throw new Error(String(parsed.errorMessage ?? 'kernel error'));
  if (parsed.status !== 'success') throw new Error(`unexpected envelope: ${raw.slice(0, 200)}`);
  return parsed.value;
}

/** The R5c contender: LOCAL embedding -> owner-signed vector search. Every missing prerequisite
 *  is an HONEST absence (never a faked score): daemon/vendored model missing, custody refusal,
 *  kernel behind, or rows not yet backfilled with vectors. */
async function vectorCandidate(): Promise<{ fn: CandidateRecallFn } | { absent: string }> {
  if (!isLoopbackUrl(URL)) return { absent: `refusing non-loopback backend URL ${URL} (local-only by law)` };
  const health = await embedderHealth();
  if (!health.ok) return { absent: `local embedder not available (${health.detail}) — start bun memory/embedder/embedder-daemon.ts with the OWNER-vendored model dir (zero-egress law: never auto-downloaded)` };
  let adminKey: string, rootSeed: string;
  try {
    adminKey = readAdminKeyStrict(KEY_DIR ? path.join(KEY_DIR, 'admin-key.txt') : undefined);
    rootSeed = readOwnerSeedStrict(KEY_DIR ? path.join(KEY_DIR, 'memory-root.seed') : undefined);
  } catch (e) {
    return { absent: `custody refusal (fail-closed, not weakened): ${e instanceof Error ? e.message : String(e)}` };
  }
  // one probe call to learn whether the vector surface is deployed and rows carry vectors.
  try {
    const probeVec = await embedText('deployment probe');
    if (!probeVec.ok) return { absent: probeVec.refused };
    const req = { v: 1, ownerRootId: OWNER_ROOT_ID, queryVectorHash: await vectorHashHex(probeVec.vector), readerPrincipalId: OWNER_ROOT_ID, timestamp: Date.now(), limit: 8 };
    const readerSig = await signChainHeadV3(rootSeed, await vecSearchHead(req), 'aumlokMemVecSearch');
    const probe = await vectorAction(adminKey, { req, readerSig, queryVector: probeVec.vector });
    if (!probe?.ok) return { absent: `vector probe refused: ${probe?.reason ?? 'unknown'}` };
    if (!Array.isArray(probe.hits) || probe.hits.length === 0) {
      return { absent: 'vector index empty for this owner — run bun scripts/embedBackfill.ts --state <brain.json> first (rows have no embeddings yet)' };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/FunctionPathNotFound|couldn't find/i.test(msg)) {
      return { absent: 'vector search not deployed on this backend yet — re-deploy the kernel after merging, then rerun' };
    }
    return { absent: `probe call failed: ${msg}` };
  }
  const fn: CandidateRecallFn = async (query, k) => {
    const embedded = await embedText(query);
    if (!embedded.ok) throw new Error(embedded.refused);
    const req = { v: 1, ownerRootId: OWNER_ROOT_ID, queryVectorHash: await vectorHashHex(embedded.vector), readerPrincipalId: OWNER_ROOT_ID, timestamp: Date.now(), limit: Math.min(20, Math.max(1, k)) };
    const readerSig = await signChainHeadV3(rootSeed, await vecSearchHead(req), 'aumlokMemVecSearch');
    const res = await vectorAction(adminKey, { req, readerSig, queryVector: embedded.vector });
    if (!res?.ok) throw new Error(`vector search refused: ${res?.reason ?? 'unknown'}`);
    return (res.hits as Array<{ key: string }>).map((h) => ({ atomId: h.key }));
  };
  return { fn };
}

async function main() {
  const statePath = arg('--state') ?? defaultKiraStatePath();
  const outPath = arg('--out');
  const maxQueries = Number(arg('--max-queries') ?? 50);
  const k = Number(arg('--k') ?? 5);

  if (!fs.existsSync(statePath)) {
    console.error(`refused: no Kira brain state at ${statePath} — pass --state <path to brain.json>.`);
    console.error('This node may simply have no local memories yet; the benchmark needs a real corpus.');
    process.exit(1);
  }
  const state = loadBrainState(statePath);
  const liveAtoms = state.atoms.filter((a) => !a.erased && !a.quarantined).length;
  const queries = deriveProbeQueries(state, { maxQueries });
  if (queries.length === 0) {
    console.error('refused: the corpus yielded zero probe queries (too few/too short live atoms).');
    process.exit(1);
  }

  const baseline = await scoreCandidate('kira.recall (baseline)', queries, async (q, kk) => {
    const r = recall(state, q, kk);
    return r.hits.map((h) => ({ atomId: h.atomId }));
  }, { k });

  const convex = await convexCandidate();
  const vector = await vectorCandidate();
  const candidates = [] as Awaited<ReturnType<typeof scoreCandidate>>[];
  const absentCandidates: Array<{ name: string; reason: string }> = [];
  if ('fn' in convex) candidates.push(await scoreCandidate('convex recall (R5b candidate)', queries, convex.fn, { k }));
  else absentCandidates.push({ name: 'convex recall (R5b candidate)', reason: convex.absent });
  if ('fn' in vector) candidates.push(await scoreCandidate('convex vector (R5c contender)', queries, vector.fn, { k }));
  else absentCandidates.push({ name: 'convex vector (R5c contender)', reason: vector.absent });
  const report = renderEvidenceReport({
    corpusLabel: `${path.basename(statePath)} @ ${statePath}`,
    atomCount: state.atoms.length,
    liveAtomCount: liveAtoms,
    queries,
    baseline,
    candidates,
    absentCandidates,
  });

  if (outPath) {
    fs.writeFileSync(outPath, report);
    console.log(`evidence report written: ${outPath}`);
  } else {
    console.log(report);
  }
}

main().catch((e) => { console.error(`refused: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
