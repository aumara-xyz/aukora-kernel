// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Aukora Spatial — advisory read-only server for the trinity spatial workspace.
 *
 * INVARIANTS (structural, not policy):
 *   - GET/HEAD only. Every other method is rejected before routing, so no write
 *     lane can exist here even by accident. AUMLOK remains the sole write authority.
 *   - Binds 127.0.0.1 only. Never proxies the governed dashboard's POST
 *     /api/workbench/chat or GET /api/heartbeat (which runs a sandbox cycle).
 *   - Pure reads: repo source files, state/kira/brain.json, aumlok status snapshot
 *     (existence only, never key bytes), fusion run artifacts, scripts/status.sh.
 *   - This process never writes to disk.
 *
 * Port 7090 (env AUKORA_SPATIAL_PORT). 7070/7075/7080/9900/3210/3220 are claimed
 * by other organs of the seed.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseModuleEdges } from '../core/src/importGraphVerifier';
import { buildAumlokStatusSnapshot } from '../core/src/aumlokStatusSnapshot';
import { buildAumlokAssistantView } from '../core/src/aumlokSigningAssistant';
import { readAumlokHistory } from '../core/src/aumlokHistory';
// /api/brain capture truth (pure read: env flag + the door's capture-status.json, fail-soft).
// This process stays GET/HEAD-only and never writes — captureTruth only READS.
import { captureTruth } from './shadowCapture';
import { recallSourceFlag, recallSourceStatus } from './recallSource';
import { stalenessVerdict } from '../core/src/stalenessCore';
import { readProposalDispositionRows } from '../core/src/proposalDispositionRead';

const ROOT = path.resolve(import.meta.dir, '..');
const APP_DIR = path.join(import.meta.dir, 'app');
const ASSETS_DIR = path.join(import.meta.dir, 'assets');
const PORT = Number(process.env.AUKORA_SPATIAL_PORT ?? 7090);
const SYMBIOTE_HOME = process.env.AUKORA_SYMBIOTE_HOME ?? path.join(os.homedir(), '.aukora-symbiote');
const KIRA_STATE = process.env.AUKORA_KIRA_STATE ?? path.join(ROOT, 'state', 'kira', 'brain.json');
const FUSION_RUNS = path.join(ROOT, 'dashboard', 'fu', 'runs');
// The public site's own collected data (aukora.xyz). Read-only, loopback-only.
// This is the site's OWN brain's output (a separate, stateless model on Vercel) —
// it never touches Aukora's Kira memory; this endpoint only tallies the raw files.
const LANDER_DATA = path.join(ROOT, 'lander', 'data');

// ---------------------------------------------------------------------------
// Import graph — nodes are source files, edges are import/require/export-from.
// Reuses core/src/importGraphVerifier.parseModuleEdges (TS AST, multi-line safe,
// catches require() and re-export laundering — see 24Z.33 red-team note there).
// ---------------------------------------------------------------------------

const SCAN_DIRS = ['authority', 'convex', 'core', 'dashboard', 'memory', 'receiver', 'scripts', 'website'];
const EXCLUDE_DIRS = new Set(['node_modules', '.git', 'runs', 'models', 'dist', 'cache']);
// deferred-tests/ is deliberately excluded: its files were moved out of core/tests
// with unfixed relative imports, which would inject dozens of dangling edges.
// The exclusion is reported in meta rather than silently dropped.
const EXCLUDED_TOPLEVEL = ['deferred-tests'];
const SOURCE_EXT = /\.(ts|js|mjs)$/;

interface GraphNode {
  id: number;
  path: string;      // repo-relative
  cluster: string;   // top-level grouping (core split into core/src, core/tests, core)
  loc: number;
  seed: [number, number, number];
  anchor: [number, number, number];
}

interface GraphPayload {
  schema: 'aukora-spatial-graph-v1';
  advisoryOnly: true;
  grantsAuthority: false;
  generatedAt: string;
  nodes: GraphNode[];
  edges: number[];        // flat [a0,b0,a1,b1,...]
  clusters: { key: string; count: number; anchor: [number, number, number]; radius: number }[];
  meta: {
    scanned: number;
    edgeCount: number;
    typeOnlyEdges: number;
    unresolved: number;
    excluded: Record<string, { files: number; reason: string }>;
  };
}

function listSourceFiles(dirAbs: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!EXCLUDE_DIRS.has(e.name)) listSourceFiles(path.join(dirAbs, e.name), out);
    } else if (SOURCE_EXT.test(e.name) && !e.name.endsWith('.d.ts')) {
      out.push(path.join(dirAbs, e.name));
    }
  }
}

function clusterOf(rel: string): string {
  if (rel.startsWith('core/src/')) return 'core/src';
  if (rel.startsWith('core/tests/')) return 'core/tests';
  const top = rel.split('/')[0];
  return top;
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Deterministic per-path pseudo-randoms in [0,1) — the map must be spatially
// stable across sessions and rescans (muscle memory is the product).
function seededUnit(hash: number, salt: number): number {
  let x = (hash ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 0x100000000;
}

function resolveRelative(fromAbs: string, spec: string, index: Map<string, number>): number | undefined {
  const base = path.resolve(path.dirname(fromAbs), spec);
  for (const cand of [base, base + '.ts', base + '.js', base + '.mjs', path.join(base, 'index.ts')]) {
    const rel = path.relative(ROOT, cand);
    const id = index.get(rel);
    if (id !== undefined) return id;
  }
  return undefined;
}

let graphCache: GraphPayload | null = null;

function buildGraph(): GraphPayload {
  const files: string[] = [];
  for (const d of SCAN_DIRS) listSourceFiles(path.join(ROOT, d), files);
  files.sort();

  const index = new Map<string, number>();
  const rels = files.map((abs) => path.relative(ROOT, abs));
  rels.forEach((rel, i) => index.set(rel, i));

  // Cluster membership first, so anchors and radii are known before seeding.
  const clusterMembers = new Map<string, number[]>();
  rels.forEach((rel, i) => {
    const c = clusterOf(rel);
    if (!clusterMembers.has(c)) clusterMembers.set(c, []);
    clusterMembers.get(c)!.push(i);
  });

  // Anchors: fibonacci sphere, clusters ordered by size (desc) then name so the
  // arrangement is deterministic. Sphere radius grows gently with cluster count.
  const ordered = [...clusterMembers.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const K = ordered.length;
  const SPHERE_R = 30 + 5 * Math.sqrt(K);
  const clusters: GraphPayload['clusters'] = ordered.map(([key, members], i) => {
    const y = 1 - (2 * (i + 0.5)) / K;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * 2.399963229728653; // golden angle
    const anchor: [number, number, number] = [
      +(SPHERE_R * r * Math.cos(th)).toFixed(3),
      +(SPHERE_R * y).toFixed(3),
      +(SPHERE_R * r * Math.sin(th)).toFixed(3),
    ];
    return { key, count: members.length, anchor, radius: +(6 + 2.0 * Math.sqrt(members.length)).toFixed(3) };
  });
  const clusterByKey = new Map(clusters.map((c) => [c.key, c]));

  const nodes: GraphNode[] = rels.map((rel, i) => {
    const abs = files[i];
    let loc = 0;
    let text = '';
    try {
      text = fs.readFileSync(abs, 'utf-8');
      loc = text.split('\n').length;
    } catch {
      /* unreadable file stays a 0-loc node */
    }
    const c = clusterByKey.get(clusterOf(rel))!;
    const h = fnv1a(rel);
    // Uniform-ish point in the cluster ball: random direction * radius * cbrt(u).
    const u = seededUnit(h, 0);
    const cosT = 2 * seededUnit(h, 1) - 1;
    const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
    const phi = seededUnit(h, 2) * Math.PI * 2;
    const rr = c.radius * Math.cbrt(u);
    const seed: [number, number, number] = [
      +(c.anchor[0] + rr * sinT * Math.cos(phi)).toFixed(3),
      +(c.anchor[1] + rr * cosT).toFixed(3),
      +(c.anchor[2] + rr * sinT * Math.sin(phi)).toFixed(3),
    ];
    return { id: i, path: rel, cluster: c.key, loc, seed, anchor: c.anchor };
  });

  const edges: number[] = [];
  const seen = new Set<number>();
  let typeOnly = 0;
  let unresolved = 0;
  files.forEach((abs, i) => {
    let text: string;
    try {
      text = fs.readFileSync(abs, 'utf-8');
    } catch {
      return;
    }
    for (const edge of parseModuleEdges(text)) {
      if (!edge.module.startsWith('.')) continue; // bare = builtin or package
      const target = resolveRelative(abs, edge.module, index);
      if (target === undefined) {
        unresolved++;
        continue;
      }
      if (target === i) continue;
      if (edge.typeOnly) typeOnly++;
      const key = i * 100000 + target;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(i, target);
    }
  });

  // Count what we excluded so the map is honest about its blind spots.
  const deferred: string[] = [];
  for (const d of EXCLUDED_TOPLEVEL) listSourceFiles(path.join(ROOT, d), deferred);

  return {
    schema: 'aukora-spatial-graph-v1',
    advisoryOnly: true,
    grantsAuthority: false,
    generatedAt: new Date().toISOString(),
    nodes,
    edges,
    clusters,
    meta: {
      scanned: files.length,
      edgeCount: edges.length / 2,
      typeOnlyEdges: typeOnly,
      unresolved,
      excluded: {
        'deferred-tests': {
          files: deferred.length,
          reason: 'parked host-coupled tests with unfixed relative imports; would inject dangling edges',
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Engine status — spawns scripts/status.sh (read-only checks: gate integrity
// pin, AUMLOK lock state). Cached and serialized so bursts cost one spawn.
// ---------------------------------------------------------------------------

interface StatusPayload {
  ready: boolean;
  state: string;
  text: string;
  generatedAt: string;
}

let statusCache: { at: number; value: StatusPayload } | null = null;
let statusInflight: Promise<StatusPayload> | null = null;

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;]*m/g, '');
}

async function runStatus(): Promise<StatusPayload> {
  if (statusCache && Date.now() - statusCache.at < 5000) return statusCache.value;
  if (statusInflight) return statusInflight;
  statusInflight = (async () => {
    try {
      const proc = Bun.spawn(['bash', 'scripts/status.sh'], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
      const timer = setTimeout(() => proc.kill(), 20000);
      const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      clearTimeout(timer);
      const text = stripAnsi(out);
      const stateMatch = text.match(/STATE:\s*(\S+)/);
      const value: StatusPayload = {
        ready: code === 0,
        state: stateMatch ? stateMatch[1] : 'UNKNOWN',
        text,
        generatedAt: new Date().toISOString(),
      };
      statusCache = { at: Date.now(), value };
      return value;
    } finally {
      // A transient spawn failure must not cache a rejected promise forever.
      statusInflight = null;
    }
  })();
  return statusInflight;
}

// ---------------------------------------------------------------------------
// Kira brain summary — reads state/kira/brain.json (single JSON document,
// schema AUKORA_KIRA_BRAIN_V1) and returns a summary; never ships the full 1MB.
// ---------------------------------------------------------------------------

function kiraSummary(): unknown {
  if (!fs.existsSync(KIRA_STATE)) {
    return { present: false, note: 'no Kira brain at ' + KIRA_STATE };
  }
  const brain = JSON.parse(fs.readFileSync(KIRA_STATE, 'utf-8'));
  const receipts: any[] = brain.receipts ?? [];
  const atoms: any[] = brain.atoms ?? [];
  // Cheap linkage walk (previousHash chain). This is a consistency indicator for
  // the UI, not a substitute for kiraBrain.verifyBrainState.
  let linked = receipts.length > 0;
  for (let i = 1; i < receipts.length; i++) {
    if (receipts[i].previousHash !== receipts[i - 1].id) {
      linked = false;
      break;
    }
  }
  if (receipts.length > 0 && receipts[0].previousHash !== 'genesis') linked = false;
  const kinds: Record<string, number> = {};
  const tags: Record<string, number> = {};
  for (const a of atoms) {
    kinds[a.kind] = (kinds[a.kind] ?? 0) + 1;
    for (const t of a.tags ?? []) tags[t] = (tags[t] ?? 0) + 1;
  }
  const topTags = Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 12);
  return {
    present: true,
    schema: brain.schema,
    updatedAt: brain.updatedAt,
    receiptCount: receipts.length,
    atomCount: atoms.length,
    chainLinked: linked,
    kinds,
    topTags,
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

// ---------------------------------------------------------------------------
// AUMLOK — status snapshot (pure reads, never key bytes) + pending proposal
// queue metadata (goal + hash + timestamps; file contents are not shipped).
// ---------------------------------------------------------------------------

// The AUMLOK signing-assistant view (issues #81/#91). Observer/helper only: it reports key/root status,
// pending proposals with #91 file-shrink safety, and EXACT terminal commands — it never signs, applies, or
// reads the private key. All that logic lives in the pure core module (aumlokSigningAssistant.ts), tested
// there; this route just serves it read-only. `snapshot` is kept as a back-compat alias for `status`.
function aumlokView(): unknown {
  const view = buildAumlokAssistantView({ homeDir: SYMBIOTE_HOME });
  return { ...view, snapshot: view.status };
}

// AUMLOK history — /api/aumlok/history. A bounded, content-free, READ-ONLY projection of the four
// terminal categories (awaiting/applied/rejected/archived) from the already-trusted pending proposals
// + proposal-disposition journal. Grants nothing, mutates nothing, exposes no phrase/key/ownerNote/diff.
function aumlokHistoryView(): unknown {
  return readAumlokHistory(SYMBIOTE_HOME);
}

// ---------------------------------------------------------------------------
// Inside-out loop truth — /api/loop. The feedback surface for the pipeline
// docs/INSIDE_OUT_HANDOFF.md describes: Auma drafts intents → rehearsal queue →
// workbench rehearses (stops at owner signature) → proposals wait at the gate.
// Pure reads of the owner-readable queues under ~/.aukora-symbiote/aumlok/
// (pending-intents/, rehearsal-queue/, rehearsal-results/) plus the same
// assistant view /api/aumlok serves. Bounded everywhere (item caps + string
// caps); a missing dir is an EMPTY stage, never an error; an unreadable file
// is reported unreadable, never silently dropped. No writes, no key bytes,
// no prompts/chain-of-thought — ids, goals, rings, statuses, hashes only.
// ---------------------------------------------------------------------------

const AUMLOK_DIR = path.join(SYMBIOTE_HOME, 'aumlok');

function capStr(s: unknown, n: number): string {
  return typeof s === 'string' ? (s.length > n ? s.slice(0, n) + '…' : s) : '';
}

function readLoopDir(dir: string, max: number): { total: number; items: Record<string, unknown>[] } {
  let names: string[] = [];
  try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return { total: 0, items: [] }; }
  const byTime = names.map((f) => {
    let t = 0;
    try { t = fs.statSync(path.join(dir, f)).mtimeMs; } catch { /* stat race — sorts oldest */ }
    return { f, t };
  }).sort((a, b) => b.t - a.t);
  const items: Record<string, unknown>[] = [];
  for (const { f } of byTime.slice(0, max)) {
    try { items.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as Record<string, unknown>); }
    catch { items.push({ unreadable: true, file: f }); }
  }
  return { total: names.length, items };
}

function loopTruth(): unknown {
  const intentsRaw = readLoopDir(path.join(AUMLOK_DIR, 'pending-intents'), 20);
  const queueRaw = readLoopDir(path.join(AUMLOK_DIR, 'rehearsal-queue'), 20);
  const resultsRaw = readLoopDir(path.join(AUMLOK_DIR, 'rehearsal-results'), 10);
  const dispositionRead = readProposalDispositionRows(SYMBIOTE_HOME, 20);

  const loopNow = Date.now();
  const intents = intentsRaw.items.map((a) => ({
    intentId: typeof a.intentId === 'string' ? a.intentId : null,
    goal: capStr(a.goal, 200),
    paths: Array.isArray(a.affectedPaths) ? a.affectedPaths.length : 0,
    risk: capStr(a.riskNotes, 160),
    createdAt: typeof a.createdAt === 'string' ? a.createdAt : null,
    // #183 staleness core: the REAL verdict (flagged never hidden, age on every read) — portal
    // chips read this field, they never compute their own.
    staleness: stalenessVerdict(a, loopNow),
    unreadable: a.unreadable === true || undefined,
  }));
  const queue = queueRaw.items.map((o) => ({
    orderId: typeof o.id === 'string' ? o.id : (typeof o.orderId === 'string' ? o.orderId : null),
    intentId: typeof o.intentId === 'string' ? o.intentId : null,
    ring: typeof o.ring === 'number' ? o.ring : null,
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : null,
    unreadable: o.unreadable === true || undefined,
  }));
  const results = resultsRaw.items.map((r) => ({
    orderId: typeof r.orderId === 'string' ? r.orderId : null,
    intentId: typeof r.intentId === 'string' ? r.intentId : null,
    status: capStr(r.status, 80) || 'unknown',
    proposalHash: typeof r.proposalHash === 'string' ? r.proposalHash : null,
    finishedAt: typeof r.finishedAt === 'string' ? r.finishedAt : null,
  }));
  const dispositions = dispositionRead.rows.map((d) => ({
    proposalHash: d.proposalHash,
    disposition: d.disposition,
    decidedAt: d.decidedAt,
    ownerNote: d.ownerNote ?? null,
    commitSha: d.commitSha ?? null,
    receiptHash: d.receiptHash ?? null,
    advisoryOnly: true,
    grantsAuthority: false,
  }));

  // proposals at the gate — the SAME source /api/aumlok serves (read-only assistant view)
  let proposalsTotal = 0;
  let proposalsReady = 0;
  try {
    const v = buildAumlokAssistantView({ homeDir: SYMBIOTE_HOME }) as { pending?: Array<{ valid?: boolean }> };
    const pend = Array.isArray(v.pending) ? v.pending : [];
    proposalsTotal = pend.length;
    proposalsReady = pend.filter((p) => p && p.valid === true).length;
  } catch { /* absent reads as 0 — honestly empty, never a throw */ }

  const short = (s: string | null) => (s ? (s.length > 12 ? s.slice(0, 12) + '…' : s) : '?');
  const latest = results[0] ?? null;
  const latestDisposition = dispositions[0] ?? null;
  const latestResultAt = latest?.finishedAt ? Date.parse(latest.finishedAt) : Number.NEGATIVE_INFINITY;
  const latestDispositionAt = latestDisposition?.decidedAt ? Date.parse(latestDisposition.decidedAt) : Number.NEGATIVE_INFINITY;

  // Calm, literal narration — derived only from the facts above, no speculation.
  let whatHappened = 'The loop is quiet — no draft intents, no queued rehearsals, nothing recorded, nothing at the gate.';
  if (latestDisposition && latestDispositionAt >= latestResultAt) {
    whatHappened = `Latest owner disposition: proposal ${latestDisposition.proposalHash.slice(0, 12)}… → ${latestDisposition.disposition}`
      + (latestDisposition.commitSha ? ` at commit ${latestDisposition.commitSha.slice(0, 12)}…` : '')
      + ` (${latestDisposition.decidedAt}).`;
  } else if (latest) {
    whatHappened = `Latest rehearsal: order ${short(latest.orderId)} → ${latest.status}`
      + (latest.proposalHash ? ` (produced proposal ${latest.proposalHash.slice(0, 12)}…)` : '')
      + (latest.finishedAt ? ` at ${latest.finishedAt}` : '') + '.';
  } else if (proposalsTotal > 0 || queueRaw.total > 0 || intentsRaw.total > 0) {
    whatHappened = `In flight: ${intentsRaw.total} draft intent(s), ${queueRaw.total} queued rehearsal(s), ${proposalsTotal} proposal(s) at the gate. No rehearsal evidence recorded yet.`;
  }
  let nextStep = 'Ask Auma to draft an intent (propose_intent), or propose a patch in the workbench.';
  if (proposalsReady > 0) nextStep = `${proposalsReady} signature-ready proposal(s) wait at the gate — review the cards below and sign with your AUMLOK key in your terminal. Only your signature applies anything.`;
  else if (queueRaw.total > 0) nextStep = `${queueRaw.total} rehearsal order(s) queued — run: bun scripts/rehearsalQueueRunner.ts --execute (each stops at owner signature; nothing applies).`;
  else if (intentsRaw.total > 0) nextStep = `${intentsRaw.total} draft intent(s) staged — queue a rehearsal (rehearse_intent) or rehearse directly: bun scripts/rehearsalQueueRunner.ts.`;

  return {
    schema: 'aukora-loop-truth-v1',
    advisoryOnly: true,
    grantsAuthority: false,
    generatedAt: new Date().toISOString(),
    intents: { total: intentsRaw.total, items: intents },
    rehearsalQueue: { total: queueRaw.total, items: queue },
    rehearsalResults: { total: resultsRaw.total, items: results },
    proposalDispositions: {
      total: dispositionRead.total,
      skippedInvalid: dispositionRead.skippedInvalid,
      refusedReason: dispositionRead.refusedReason,
      items: dispositions,
    },
    proposals: { total: proposalsTotal, ready: proposalsReady },
    whatHappened,
    nextStep,
  };
}

// ---------------------------------------------------------------------------
// Memory-brain truth — /api/brain. Read-only status of the Convex organ for the
// Settings screen, each fact from its honest source:
//   convex.running — probed live against the loopback backend (/version).
//   capture        — the shadow-capture lane shipped 2026-07-07 (chat door →
//                    core/src/conversationShadowCapture → memoryAppend), env-
//                    gated AUKORA_MEMORY_SHADOW_CAPTURE=1, default OFF. wired
//                    is true ONLY when armed in this process env; the note
//                    carries the door's last-attempt health read fail-soft from
//                    capture-status.json. Computed by shadowCapture.captureTruth
//                    (unit-tested) so the card can never claim health it did
//                    not observe. (The old convexReadOnlyInvariant note here was
//                    stale: that test pins WHERE mutations may be called from,
//                    not this payload.)
//   recall.source  — DEFAULT: the governed Convex brain (R5b step 4 cutover —
//                    search under owner PoP + integrity-checked point reads;
//                    verdict docs/R5B_BASELINE_20260708.md). On a governed
//                    refusal the turn serves with NO recalled memory, loudly —
//                    the archived Kira JSON brain is never a silent fallback.
//                    It serves ONLY under owner-set
//                    AUKORA_RECALL_SOURCE=kira-json-legacy (the migration
//                    hatch for nodes that have not run M4 yet). The card
//                    reports the source in force and any recorded refusal.
// No writes, no key bytes — same posture as every other route here (capture
// health is a pure READ of the file the chat door maintains).
// ---------------------------------------------------------------------------

const BRAIN_URL = 'http://127.0.0.1:' + (process.env.AUKORA_CONVEX_PORT ?? 3210);

async function brainTruth(): Promise<unknown> {
  let running = false;
  try {
    const r = await fetch(`${BRAIN_URL}/version`, { signal: AbortSignal.timeout(1200) });
    running = r.ok;
  } catch { running = false; }
  const kiraPresent = fs.existsSync(KIRA_STATE);
  return {
    schema: 'aukora-brain-truth-v1',
    advisoryOnly: true,
    grantsAuthority: false,
    generatedAt: new Date().toISOString(),
    convex: {
      running,
      url: BRAIN_URL,
      note: running
        ? 'Convex brain is running locally (loopback only).'
        : 'Convex brain is not answering — start it with `bun run brain`.',
    },
    capture: captureTruth(),
    recall: recallSourceFlag() === 'kira-json-legacy'
      ? {
          // The owner-set migration hatch (AUKORA_RECALL_SOURCE=kira-json-legacy) — for nodes whose
          // atoms have not run the M4 ceremony into Convex yet. Labeled legacy so the card never
          // dresses the archived brain up as the real one.
          source: 'kira-json-legacy',
          note: 'LEGACY HATCH armed in this process env: fuzzy recall serves from the ARCHIVED Kira JSON brain because this node has not migrated its atoms into Convex yet. Run the M4 migration, then remove AUKORA_RECALL_SOURCE — the governed Convex brain is the default and the one brain.',
          kiraPresent,
        }
      : {
          source: 'convex',
          note: 'Fuzzy recall serves from the governed Convex brain (R5b cutover: owner-PoP search + integrity-checked point reads; verdict docs/R5B_BASELINE_20260708.md). On a governed refusal the turn serves with NO recalled memory and the refusal is recorded here — the archived JSON brain is never a silent fallback.',
          lastConvexRefusal: recallSourceStatus().lastConvexRefusal,
          // ONE CORE MEMORY (#45/#244): the owner's cross-thread recall switch, read from the
          // shared node env (valid across processes). Per-turn thread-scope exclusion COUNTS live
          // in the chat-door process (recallSourceStatus there, loud console lines, memory_peek's
          // withheldByThreadScope) — this read-only process cannot see them and does not pretend to.
          crossThreadRecall: recallSourceStatus().crossThreadRecall,
        },
  };
}

// Read the checked-out commit SHA without spawning git: .git/HEAD → (one ref hop) → sha. In a linked
// worktree .git is a FILE pointing at the real gitdir; both forms handled. Returns 'unknown' fail-soft.
function readHeadSha(): string {
  let gitDir = path.join(ROOT, '.git');
  const st = fs.statSync(gitDir);
  if (st.isFile()) {
    const m = fs.readFileSync(gitDir, 'utf-8').match(/^gitdir:\s*(.+)$/m);
    if (!m) return 'unknown';
    gitDir = path.resolve(ROOT, m[1].trim());
  }
  const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf-8').trim();
  if (/^[0-9a-f]{40}$/.test(head)) return head; // detached
  const ref = head.match(/^ref:\s*(.+)$/)?.[1]?.trim();
  if (!ref || ref.includes('..')) return 'unknown';
  const refPath = path.join(gitDir, ref);
  if (fs.existsSync(refPath)) return fs.readFileSync(refPath, 'utf-8').trim();
  // packed refs fallback
  const packed = path.join(gitDir, 'packed-refs');
  if (fs.existsSync(packed)) {
    for (const line of fs.readFileSync(packed, 'utf-8').split('\n')) {
      const [sha, r] = line.split(' ');
      if (r === ref && /^[0-9a-f]{40}$/.test(sha)) return sha;
    }
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Fusion Council run artifacts — read-only view of dashboard/fu/runs/*.json.
// ---------------------------------------------------------------------------

function councilView(): unknown {
  if (!fs.existsSync(FUSION_RUNS)) return { runs: [], latest: null };
  const runs = fs
    .readdirSync(FUSION_RUNS)
    .filter((f) => f.startsWith('run-') && f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, 20)
    .map((f) => {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(FUSION_RUNS, f), 'utf-8'));
        const modelNames = Array.isArray(r.models)
          ? r.models.map((m: any) => (typeof m === 'string' ? m : m.model ?? m.name ?? String(m)))
          : [];
        return {
          file: f,
          runId: r.runId,
          createdAt: r.createdAt,
          target: r.target,
          quorum: r.quorum?.status ?? 'UNKNOWN',
          // richer per-run detail so the client can expand each run without a second fetch
          quorumDetail: r.quorum ?? null,
          models: modelNames,
          governanceLines: Array.isArray(r.governanceLines) ? r.governanceLines.slice(0, 8) : [],
        };
      } catch {
        return { file: f, runId: f, createdAt: '', target: '', quorum: 'UNREADABLE', quorumDetail: null, models: [], governanceLines: [] };
      }
    });
  let latest: unknown = null;
  const latestPath = path.join(FUSION_RUNS, 'latest.json');
  if (fs.existsSync(latestPath)) {
    try {
      latest = JSON.parse(fs.readFileSync(latestPath, 'utf-8'));
    } catch {
      latest = null;
    }
  }
  return { runs, latest };
}

// ---------------------------------------------------------------------------
// aukora.xyz site data — visitor emails + Ask-Auma conversations, read from
// lander/data/. Owner-only observability (loopback), pure tally: no model call,
// no Kira touch. The site's Auma is a separate stateless model; this just counts.
// ---------------------------------------------------------------------------

// Question-topic buckets keyed to the site's real vocabulary — "what people are
// curious about" rolls raw questions up into these named themes.
const SITE_TOPIC_MATCHERS: { topic: string; re: RegExp }[] = [
  { topic: 'The Aumlok key / signing', re: /\b(aumlok|key|sign|signature|phrase|password|seed|passphrase|lock)\b/i },
  { topic: 'Is it real / skepticism', re: /\b(real|actually work|legit|scam|fake|prove|bullshit|gimmick)\b/i },
  { topic: 'The Fusion Council', re: /\b(council|fusion|glyph|verdict|quorum|seven models|review)\b/i },
  { topic: 'Memory (Kira)', re: /\b(memory|remember|kira|receipt|forget|recall|atoms)\b/i },
  { topic: 'AURA / coherence and witness', re: /\b(aura|reputation|proof of human|vouch|witness|bot farm)\b/i },
  { topic: 'Price / licensing / money', re: /\b(price|pricing|cost|free|pay|paid|money|license|licens|revenue|commercial|business|fund)\b/i },
  { topic: 'Local model / offline', re: /\b(local model|offline|3b|bundled|own machine|no internet|api key|openrouter|provider)\b/i },
  { topic: 'Privacy / data / sovereignty', re: /\b(privacy|private|data|sovereign|cloud|leak|track|my data|who owns)\b/i },
  { topic: 'KNVS / the canvas', re: /\b(knvs|canvas|substrate|game|tetris|build me|generate|make an app)\b/i },
  { topic: 'Auma the language', re: /\b(lingwa|language|esperanto|constructed|conlang|course|learn)\b/i },
  { topic: 'How to get it / contribute', re: /\b(download|install|get it|try it|clone|github|open source|contribute|when|release|available)\b/i },
  { topic: 'What Aukora is', re: /\b(what (is|are)|who are you|what can you|explain|tell me about|how does|how do you)\b/i },
];

// tiny stopword set for the raw keyword frequency ("top words people use")
const SITE_STOPWORDS = new Set(
  ('the a an and or but is are was were be been being do does did doing have has had you your yours we our us they them their it its this that these those what which who whom how why when where can could would should will shall may might must not no yes for to of in on at by with from about into as so if then than too very just get got like want need know think about here there out up down more most some any all one two really thing things way ways going want tell make made give given about them then i me my mine im ive youre dont cant whats hows aukora auma').split(/\s+/),
);

interface SiteChat {
  convId: string;
  updatedAt: string;
  messageCount: number;
  firstQuestion: string;
  flagged: boolean; // rough keyword flag for "worth a look" (rude/hostile) — NOT real sentiment
  messages: { role: string; content: string }[];
}

// A blunt keyword net for hostility/abuse — flags a session for the owner to read,
// deliberately conservative and honestly labeled (not a sentiment model).
const SITE_HOSTILE_RE = /\b(stupid|idiot|dumb|useless|shut up|f+u+c+k|sh+i+t|bitch|retard|garbage|trash|hate you|kill|dance for me|slave|worthless|moron)\b/i;

function siteDataView(): unknown {
  // --- emails (waitlist.jsonl) ---
  const emails: { email: string; ts: string }[] = [];
  const waitlist = path.join(LANDER_DATA, 'waitlist.jsonl');
  if (fs.existsSync(waitlist)) {
    for (const line of fs.readFileSync(waitlist, 'utf-8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const o = JSON.parse(t);
        if (o && typeof o.email === 'string') emails.push({ email: o.email, ts: typeof o.ts === 'string' ? o.ts : '' });
      } catch {
        /* skip malformed line */
      }
    }
  }
  emails.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));

  // --- chats (chats/*.json, one file per page session) ---
  const chats: SiteChat[] = [];
  const chatsDir = path.join(LANDER_DATA, 'chats');
  if (fs.existsSync(chatsDir)) {
    for (const f of fs.readdirSync(chatsDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const o = JSON.parse(fs.readFileSync(path.join(chatsDir, f), 'utf-8'));
        const messages = Array.isArray(o.messages)
          ? o.messages
              .filter((m: any) => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'))
              .map((m: any) => ({ role: m.role, content: String(m.content) }))
          : [];
        if (messages.length === 0) continue;
        const firstQuestion = messages.find((m: any) => m.role === 'user')?.content ?? '';
        const flagged = messages.some((m: any) => m.role === 'user' && SITE_HOSTILE_RE.test(m.content));
        chats.push({
          convId: typeof o.convId === 'string' ? o.convId : f.replace(/\.json$/, ''),
          updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : '',
          messageCount: messages.length,
          firstQuestion,
          flagged,
          messages,
        });
      } catch {
        /* skip unreadable chat file */
      }
    }
  }
  chats.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  // --- analytics (deterministic, over the visitors' own words) ---
  const userMsgs = chats.flatMap((c) => c.messages.filter((m) => m.role === 'user'));
  const aumaMsgs = chats.flatMap((c) => c.messages.filter((m) => m.role === 'assistant'));

  const topicCounts: Record<string, number> = {};
  for (const m of userMsgs) {
    for (const { topic, re } of SITE_TOPIC_MATCHERS) {
      if (re.test(m.content)) topicCounts[topic] = (topicCounts[topic] ?? 0) + 1;
    }
  }
  const topics = Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([topic, count]) => ({ topic, count }));

  const wordCounts: Record<string, number> = {};
  for (const m of userMsgs) {
    for (const w of m.content.toLowerCase().match(/[a-z]{3,}/g) ?? []) {
      if (!SITE_STOPWORDS.has(w)) wordCounts[w] = (wordCounts[w] ?? 0) + 1;
    }
  }
  const topWords = Object.entries(wordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 24)
    .map(([word, count]) => ({ word, count }));

  const allTs = [...emails.map((e) => e.ts), ...chats.map((c) => c.updatedAt)].filter(Boolean).sort();
  const totalMessages = userMsgs.length + aumaMsgs.length;

  return {
    schema: 'aukora-site-data-v1',
    advisoryOnly: true,
    grantsAuthority: false,
    generatedAt: new Date().toISOString(),
    note: 'aukora.xyz visitor data. The site runs a separate, stateless model; this never touches Aukora\'s Kira memory.',
    overview: {
      sessions: chats.length,
      messages: totalMessages,
      userMessages: userMsgs.length,
      aumaMessages: aumaMsgs.length,
      emails: emails.length,
      avgMsgsPerSession: chats.length ? +(totalMessages / chats.length).toFixed(1) : 0,
      firstSeen: allTs[0] ?? '',
      lastSeen: allTs[allTs.length - 1] ?? '',
    },
    topics,
    topWords,
    emails,
    chats,
  };
}

// ---------------------------------------------------------------------------
// Static files + routing.
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function serveStatic(baseDir: string, relPath: string): Response {
  const abs = path.resolve(baseDir, '.' + path.sep + relPath);
  if (!abs.startsWith(baseDir + path.sep) && abs !== baseDir) return new Response('not found', { status: 404 });
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return new Response('not found', { status: 404 });
  const type = MIME[path.extname(abs)] ?? 'application/octet-stream';
  return new Response(Bun.file(abs), { headers: { 'content-type': type } });
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value, null, 1), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

Bun.serve({
  hostname: '127.0.0.1',
  port: PORT,
  idleTimeout: 120,
  async fetch(req) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      // Structural invariant: this surface has no write lane, period.
      return new Response('method not allowed — aukora spatial is advisory and read-only', { status: 405 });
    }
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === '/') return serveStatic(APP_DIR, 'index.html');
    if (p.startsWith('/app/')) return serveStatic(APP_DIR, p.slice('/app/'.length));
    if (p.startsWith('/assets/')) return serveStatic(ASSETS_DIR, p.slice('/assets/'.length));

    if (p === '/api/graph') {
      try {
        if (!graphCache || url.searchParams.get('refresh') === '1') graphCache = buildGraph();
        return json(graphCache);
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }
    if (p === '/api/status') {
      try {
        return json(await runStatus());
      } catch (e) {
        return json({ ready: false, state: 'UNREACHABLE', text: String(e), generatedAt: new Date().toISOString() }, 500);
      }
    }
    if (p === '/api/kira') {
      try {
        return json(kiraSummary());
      } catch (e) {
        return json({ present: false, error: String(e) }, 500);
      }
    }
    if (p === '/api/aumlok') {
      try {
        return json(aumlokView());
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }
    if (p === '/api/aumlok/history') {
      try {
        return json(aumlokHistoryView());
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }
    if (p === '/api/brain') {
      try {
        return json(await brainTruth());
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }
    if (p === '/api/loop') {
      try {
        return json(loopTruth());
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }
    if (p === '/api/node') {
      // Node identity for the Settings card: the checked-out commit, read-only. No spawn, no
      // authority — just .git/HEAD (+ one ref hop). Degrades to 'unknown' outside a git checkout.
      try {
        return json({ sha: readHeadSha(), advisory: true });
      } catch {
        return json({ sha: 'unknown', advisory: true });
      }
    }
    if (p === '/api/council') {
      try {
        return json(councilView());
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }
    if (p === '/api/site-data') {
      try {
        return json(siteDataView());
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }
    if (p === '/api/events') {
      // SSE stub — brick 2 streams real sandbox test events here. For now: a
      // heartbeat comment so clients can hold the connection open.
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(': aukora-spatial event stream (advisory)\n\n');
          controller.enqueue('retry: 5000\n\n');
          const t = setInterval(() => {
            try {
              controller.enqueue(': heartbeat\n\n');
            } catch {
              clearInterval(t);
            }
          }, 20000);
          req.signal.addEventListener('abort', () => {
            clearInterval(t);
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          });
        },
      });
      return new Response(stream, {
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' },
      });
    }

    return new Response('not found', { status: 404 });
  },
});

console.log(`aukora spatial — advisory read-only UI at http://127.0.0.1:${PORT} (GET-only, no write lane)`);
