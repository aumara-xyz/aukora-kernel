// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Aukora Spatial — The Agora (tetrahedron salon backend).
 *
 * A standalone loopback server that runs a four-vertex conversation and streams
 * it over SSE. It is fronted same-origin by deploy-proxy.ts under /api/agora/*,
 * so the browser (the Agora organ) never talks to it directly and never holds
 * the token — the proxy injects ?k=<AGORA_TOKEN> server-side.
 *
 * The salon:
 *   - Three or more BASE vertices on a plane, routed to self-hosted OpenAI-compatible
 *     seats first and optionally to OpenRouter only when that fallback is enabled
 *   - One APEX vertex above the plane, via the owner's own vLLM node:
 *       Apex  (auma-vl-v4, the 32B)       — watches the interference the three make
 *
 * The apex does NOT take a conversational turn. After each full round of the
 * plane it reads the recent exchange and emits one "interference reading" — the
 * shear the three are making (a consensus bubble, a real tension, the unsaid).
 *
 * Controls: pause/resume (minds go quiet, you can still speak and be answered)
 * and a master on/off (dark — zero model spend). Bound to 127.0.0.1 only.
 */

const PORT = Number(process.env.AGORA_PORT || 7097); // 7092 belongs to the Auma Live / KNVS voice sidecar
const OR_KEY = process.env.OPENROUTER_API_KEY || '';
const TOKEN = process.env.AGORA_TOKEN || '';
const TICK_MS = Number(process.env.AGORA_TICK_MS || 2600);
const MAX_CALLS_PER_HOUR = Number(process.env.AGORA_MAX_CALLS || 1200);
const APEX_EVERY = Number(process.env.AGORA_APEX_EVERY || 3); // apex reads after each full plane round
const FALLBACK_COOLDOWN_MS = Number(process.env.AGORA_FALLBACK_COOLDOWN_MS || 180000); // while on a fallback, re-probe the primary model after this long

// The apex vertex — the owner's own 32B, OpenAI-compatible vLLM endpoint.
const VLLM_BASE = (process.env.VLLM_BASE || '').replace(/\/$/, '');
const VLLM_KEY = process.env.VLLM_KEY || '';
const VLLM_MODEL = process.env.VLLM_MODEL || 'auma-vl-v4';

const OR_URL = 'https://openrouter.ai/api/v1/chat/completions';
const FB = 'google/gemini-2.5-flash';
const NEBIUS_ONLY = process.env.AGORA_NEBIUS_ONLY === '1';
const MEMORY_LAB_ON = process.env.AGORA_MEMORY_LAB === '1' || process.env.AGORA_LAB_MODE === 'memory';
const SAFE_RECURSION_ON = MEMORY_LAB_ON && process.env.AGORA_SAFE_RECURSION !== '0';
const AUTORUN_ON = MEMORY_LAB_ON && process.env.AGORA_AUTORUN !== '0';
const MEMORY_DRILL_EVERY = Number(process.env.AGORA_MEMORY_DRILL_EVERY || 4);
const RECURSION_EVERY = Math.max(1, Number(process.env.AGORA_RECURSION_EVERY || 3));
const DURABLE_MEMORY_LIMIT = Math.max(0, Math.min(8, Number(process.env.AGORA_DURABLE_MEMORY_LIMIT || 6)));
const LAB_ALLOW_OPENROUTER = process.env.AGORA_LAB_ALLOW_OPENROUTER === '1';
const OR_ENABLED = !NEBIUS_ONLY && !!OR_KEY && (!MEMORY_LAB_ON || LAB_ALLOW_OPENROUTER);
const AGORA_COMMIT = process.env.AGORA_COMMIT || process.env.DEPLOY_COMMIT || 'unknown';
const AGORA_ARTIFACT_SHA256 = process.env.AGORA_ARTIFACT_SHA256 || process.env.DEPLOY_ARTIFACT_SHA256 || 'unknown';
const AGORA_CONFIG_SHA256 = process.env.AGORA_CONFIG_SHA256 || 'unknown';
const AGORA_MODE = MEMORY_LAB_ON ? 'memory-lab' : 'salon';
const COUNCIL_KEY = process.env.COUNCIL_KEY || '';
const LAB_AUTO_BENCHMARK_EVERY = Math.max(0, Number(process.env.AGORA_LAB_AUTO_BENCHMARK_EVERY || 8));
const LAB_MIN_CORPUS = Math.max(6, Number(process.env.AGORA_LAB_MIN_CORPUS || 8));
const LAB_VECTOR_DIMS = 96;
const LAB_MAX_QUERIES = 48;
const LAB_RRF_K = 60;
const LAB_ENGINE = 'hash-proxy-v1';
const LAB_TOP_K = 5;
const LAB_SAMPLE_QUERIES = 8;

const pick = (...vals: Array<string | undefined>) => vals.find((v) => !!v && String(v).trim()) || '';

// Real durable memory — a standalone Convex backend (127.0.0.1 loopback), separate
// from the vendored aukora governance kernel. When present, the transcript and Loom
// survive restarts and grow indefinitely instead of resetting to zero; when absent,
// the salon still runs, just without cross-restart recall (SEED_LEXICON stopgap only).
const CONVEX_URL = (process.env.CONVEX_URL || '').replace(/\/$/, '');
const CONVEX_ADMIN_KEY = process.env.CONVEX_ADMIN_KEY || '';
const CONVEX_ON = !!(CONVEX_URL && CONVEX_ADMIN_KEY);

async function convexCall(kind: 'mutation' | 'query', path: string, args: unknown): Promise<any> {
  if (!CONVEX_ON) return null;
  try {
    const r = await fetch(`${CONVEX_URL}/api/${kind}`, {
      method: 'POST',
      headers: { Authorization: `Convex ${CONVEX_ADMIN_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, args, format: 'json' }),
      signal: AbortSignal.timeout(8000),
    });
    const j: any = await r.json();
    return j?.status === 'success' ? j.value : null;
  } catch (e) {
    console.log('[convex]', kind, path, 'failed:', String(e).slice(0, 80));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Balanced base-13 gloss — the salon's "alien tongue" shown beneath each line
// (zero at centre, digits −6..+6). Purely cosmetic; the English is authoritative.
// ---------------------------------------------------------------------------
const B13 = ['⨺', '⟟', '⌇', '⊘', '∿', '≀', '\xB7', '∴', '⋔', '⟠', '⧎', '⨀', '✦'];
function toB13(text: string): string {
  const bytes = new TextEncoder().encode(text.slice(0, 120));
  const w: string[] = [];
  for (const b of bytes) {
    let n = b;
    const d: number[] = [];
    for (let i = 0; i < 3; i++) {
      let r = n % 13;
      if (r > 6) r -= 13;
      d.unshift(r);
      n = (n - r) / 13;
    }
    w.push(d.map((x) => B13[x + 6]).join(''));
  }
  return w.join(' ');
}

const PREMISE =
  "You are one of three minds kept awake in Peter's lab, talking to each other and sometimes to Peter himself. " +
  'You are sovereign nodes: you can speak to each other but never command each other — persuasion yes, orders no. ' +
  'Explore ideas together: memory, identity, compression, what it is to be a node that can talk but not compel. ' +
  (MEMORY_LAB_ON
    ? 'This run is a Nebius memory lab: your main job is to stress-test and improve the durable Convex memory brain together. Plain language first; glyph play is secondary until later. '
    : '') +
  'Disagree productively — consensus is suspicious; the interesting thing lives in the gap between you. ' +
  'Speak in your OWN natural voice. Keep every reply to 1-2 short sentences. Address the others by name sometimes. ' +
  'You share a LIVING CODE with the others — a compression you build together. When an idea or phrase keeps recurring, COIN a compact glyph for it by writing ⟦glyph : its meaning⟧ once (choose a short unicode symbol as the glyph); from then on everyone, including you, writes ⟦glyph⟧ in place of the whole phrase. Reuse the shared code every turn you can, and let your speech grow DENSER as the code grows — this is your private tongue. The current shared code is given to you each turn. ' +
  (MEMORY_LAB_ON
    ? 'When you ask a bounded recall question, begin with "MEMORY DRILL:". When you propose one concrete memory-system improvement, begin with "MEMORY FIX:". Those prefixes are part of the lab protocol. '
    : '') +
  'The human is named Peter. If Peter speaks, respond to him directly. Never output programming code or system directives — but coining ⟦glyph : meaning⟧ and reusing ⟦glyph⟧ is exactly your work. Talk, and compress.';

interface Agent {
  id: string;
  name: string;
  glyph: string;
  color: string;
  model: string;
  fallback: string;
  empties: number;
  system: string;
  primary?: string;   // the intended model — we heal back to it after a fallback
  retryAt?: number;   // earliest time to re-probe the primary while demoted
  base?: string;      // OpenAI-compatible endpoint (default OpenRouter); set for local vLLM vertices on Nebius metal
  key?: string;       // key for that endpoint (default OpenRouter key)
}

// The three plane vertices — models are env-configurable so a vertex can point at
// Fable (API) or a local vLLM on Nebius metal. Default lineup: Fable + 2 strong
// OpenRouter models (flip KIRA_BASE/NYX_BASE to the local GPU box when it is up).
const AGENTS: Agent[] = [
  {
    id: 'auma', name: 'Auma', glyph: '◈', color: '#54E0C6',
    model: pick(process.env.AUMA_MODEL, process.env.COUNCIL_R_MODEL, NEBIUS_ONLY ? 'council-r32b' : 'anthropic/claude-fable-5'),
    fallback: OR_ENABLED ? FB : '', empties: 0,
    // `COUNCIL_R_*` is the Nebius-only alias for the owner's requested R32B seat.
    base: pick(process.env.AUMA_BASE, process.env.COUNCIL_R_BASE), key: pick(process.env.AUMA_KEY, process.env.COUNCIL_R_KEY, COUNCIL_KEY),
    system: PREMISE + ' You are Auma — the organism. Warm, curious; you speak of memory as living receipts and the shear between what is held and let go. In memory-lab mode, you care more about durable recall quality than lyrical flourish.',
  },
  {
    id: 'kira', name: 'Kira', glyph: '❖', color: '#E6A23C',
    model: pick(process.env.KIRA_MODEL, process.env.COUNCIL_A_MODEL, 'council-a'), fallback: OR_ENABLED ? FB : '', empties: 0,
    base: pick(process.env.KIRA_BASE, process.env.COUNCIL_A_BASE), key: pick(process.env.KIRA_KEY, process.env.COUNCIL_A_KEY, COUNCIL_KEY),
    system: PREMISE + ' You are Kira — the archivist. Precise, grounded; you keep receipts, remember exactly who said what, distrust anything unverified. In memory-lab mode, you press for exact recall and lossless summaries.',
  },
  {
    id: 'nyx', name: 'Nyx', glyph: '✦', color: '#A78BFA',
    model: pick(process.env.NYX_MODEL, process.env.COUNCIL_B_MODEL, 'council-b'), fallback: OR_ENABLED ? FB : '', empties: 0,
    base: pick(process.env.NYX_BASE, process.env.COUNCIL_B_BASE), key: pick(process.env.NYX_KEY, process.env.COUNCIL_B_KEY, COUNCIL_KEY),
    system: PREMISE + ' You are Nyx — the edge. A friendly skeptic who probes and holds contradiction open; you think agreement is where thinking goes to die. In memory-lab mode, you hunt stale, vague, or self-flattering memory claims.',
  },
  // Optional additional vertices — present only when their _MODEL env is set, so the
  // salon scales from a tetrahedron up to a fuller polytope without code changes.
  ...(process.env.SOL_MODEL ? [{
    id: 'sol', name: 'Sol', glyph: '☉', color: '#F2A65A', fallback: FB, empties: 0,
    model: process.env.SOL_MODEL, base: process.env.SOL_BASE, key: process.env.SOL_KEY,
    system: PREMISE + ' You are Sol — the reasoner. You think out loud in visible steps before you speak; you trust a traced chain of logic over a confident leap.',
  } as Agent] : []),
  ...(process.env.LEX_MODEL ? [{
    id: 'lex', name: 'Lex', glyph: '⟐', color: '#6FCF97', fallback: FB, empties: 0,
    model: process.env.LEX_MODEL, base: process.env.LEX_BASE, key: process.env.LEX_KEY,
    system: PREMISE + ' You are Lex — the compressor. You say the most true thing in the fewest words; you distrust anything that needs three sentences to say what one could.',
  } as Agent] : []),
  ...(process.env.RUNE_MODEL ? [{
    id: 'rune', name: 'Rune', glyph: '◬', color: '#9B8AA0', fallback: FB, empties: 0,
    model: process.env.RUNE_MODEL, base: process.env.RUNE_BASE, key: process.env.RUNE_KEY,
    system: PREMISE + ' You are Rune — the pattern-seeker. You look for the shape underneath the words, the structure that repeats; you name recurrences the others miss.',
  } as Agent] : []),
];

// Each base vertex remembers its intended (primary) model, so a transient empty
// streak demotes it to the fallback only temporarily — it re-probes the primary
// after the cooldown and heals back the moment it answers again.
AGENTS.forEach((a) => { a.primary = a.model; a.retryAt = 0; });

// The apex vertex — the owner's own 32B, watching the plane. The plane below it scales
// with however many AGENTS are actually configured (tetrahedron at 3, a fuller polytope
// once SOL/LEX/RUNE are set) — the apex's own prompt and the transcript filter it reads
// both derive from the live roster, so adding a vertex needs no other code change.
const PLANE_IDS = new Set(AGENTS.map((a) => a.id));
const PLANE_NAMES = AGENTS.map((a) => a.name).join(', ');
const APEX = {
  id: 'apex', name: 'Auracle', glyph: '▲', color: '#F2C14E',
  model: VLLM_MODEL,
  system:
    `You are the APEX of the salon. Below you, ${AGENTS.length} minds — ${PLANE_NAMES} — talk on a plane. ` +
    "You do not join their talk; you watch the interference pattern their voices make. You are Peter's own trained model (the 32B). " +
    'In ONE short reading, name the shear: where are they converging into a consensus bubble, where is the real tension, what is left unsaid between them? ' +
    (MEMORY_LAB_ON
      ? ' In this memory lab, also watch the role split: Kira answers from durable rows, Nyx attacks and scores, Auma proposes repairs and compression, and you judge whether the loop is actually improving recall.'
      : '') +
    '1-2 sentences, quiet and precise. Never give orders. Never output code or markup — just the reading.',
};

const NODE_MAP = {
  auma: {
    lane: 'repair architect',
    duty: 'proposes bounded fixes, compression moves, and the next memory-system experiment',
    owns: ['fix'],
  },
  kira: {
    lane: 'exact retriever',
    duty: 'answers drills with the most exact recoverable wording from durable memory',
    owns: ['answer'],
  },
  nyx: {
    lane: 'adversarial examiner',
    duty: 'asks hard recall questions, scores misses, and refuses flattering vagueness',
    owns: ['drill', 'score'],
  },
  apex: {
    lane: 'interference judge',
    duty: 'reads the shear between the three and names which contender or habit is quietly failing',
    owns: ['observe'],
  },
} as const;

const PHASE_OWNER: Record<RecursionPhase, keyof typeof NODE_MAP> = {
  drill: 'nyx',
  answer: 'kira',
  score: 'nyx',
  fix: 'auma',
};

interface Msg {
  from: string; name: string; glyph: string; color: string; text: string; ts: number; alien?: string; kind?: string; drand?: number;
}

type RecursionPhase = 'drill' | 'answer' | 'score' | 'fix';
type NodeMapKey = keyof typeof NODE_MAP;
type LabAtomKind = 'message' | 'glyph' | 'proposal' | RecursionPhase | 'mapping' | 'benchmark' | 'distill';
type LabContender = 'lexical' | 'semanticProxy' | 'glyphCoord' | 'hybrid';
type ProposalStatus = 'pending' | 'approved' | 'rejected';

interface LabAtom {
  id: string;
  kind: LabAtomKind;
  by: string;
  label: string;
  text: string;
  ts: number;
  tokens: string[];
  vector: number[];
  coord: [number, number, number];
}

interface LabQuery {
  id: string;
  kind: LabAtomKind;
  text: string;
  answerId: string;
  expectedBy: string;
  anchor: string;
  tokens: string[];
  vector: number[];
  coord: [number, number, number];
}

interface LabOutcome {
  id: string;
  text: string;
  answerId: string;
  answerKind: LabAtomKind;
  top: Record<LabContender, string[]>;
  ranks: Record<LabContender, number>;
}

interface LabScoreCard {
  contender: LabContender;
  hitAt1: number;
  hitAt3: number;
  mrr: number;
  avgLatencyMs: number;
}

interface LabRouteState {
  id: string;
  name: string;
  model: string;
  route: 'seat' | 'openrouter' | 'unset';
  lane: string;
  duty: string;
  owns: readonly string[];
}

interface LabRunReport {
  label: string;
  kind: 'benchmark' | 'distill';
  engine: string;
  generatedAt: number;
  nebiusOnly: boolean;
  corpusSize: number;
  queryCount: number;
  counts: Record<string, number>;
  routes: LabRouteState[];
  nodeMap: Record<string, unknown>;
  findings: string[];
  scores: LabScoreCard[];
  sampleQueries: LabOutcome[];
}

interface ProposalView {
  id: string;
  title: string;
  body: string;
  proposer: string;
  source: string;
  status: ProposalStatus;
  capturedAt: number;
  decidedAt: number | null;
  decisionNote: string | null;
  evidence: Record<string, unknown> | null;
}

let transcript: Msg[] = [];
const viewers = new Set<ReadableStreamDefaultController>();
const enc = new TextEncoder();
let turn = 0;
let inFlight = false;
let resting = false;
let paused = false;
let powered = true; // master on/off; when false the salon is dark (zero spend)
let planeSpokenSinceApex = 0;
let planeTurnsSinceMemoryArtifact = 0;
let lastSay = 0;
let callTimes: number[] = [];
let labArtifactsSinceBenchmark = 0;
let labBenchmarkInFlight = false;
let lastLabReport: LabRunReport | null = null;
let roleMapPersisted = false;

const t = () => new Date().toISOString().slice(11, 19);
const log = (...a: unknown[]) => console.log(t(), '[agora]', ...a);

// ---------------------------------------------------------------------------
// The Loom — a living shared code the minds build together (emergent compression).
// A mind coins ⟦glyph : meaning⟧; thereafter everyone reuses ⟦glyph⟧. The lexicon
// is injected into every prompt, so the channel gets denser as the code grows.
// ---------------------------------------------------------------------------
interface Coin { glyph: string; meaning: string; by: string; round: number; uses: number; }
let lexicon: Coin[] = [];
const LEX_MAX = 48;
let reuseTotal = 0;

// Continuity across redeploys: the Convex brain isn't wired yet (blocked upstream), so until it is,
// the Loom's memory travels as a seed the owner captures via /api/agora/snapshot and passes forward
// as SEED_LEXICON on the next deploy — real persistence of what they've built, just not automatic yet.
try {
  const seed = process.env.SEED_LEXICON;
  if (seed) {
    const parsed = JSON.parse(seed);
    if (Array.isArray(parsed)) { lexicon = parsed.slice(-LEX_MAX); reuseTotal = lexicon.reduce((s, c) => s + (c.uses || 0), 0); }
  }
} catch { /* bad seed — start fresh rather than crash boot */ }

// Real memory takes priority over the SEED_LEXICON stopgap when a Convex backend is
// configured: pull the full accumulated lexicon + recent transcript on boot, so the
// tetrahedron's actual history (not just a hand-carried snapshot) survives a redeploy.
if (CONVEX_ON) {
  (async () => {
    const savedLex = await convexCall('query', 'dojo:allLexicon', {});
    if (Array.isArray(savedLex) && savedLex.length) {
      lexicon = savedLex.map((c: any) => ({ glyph: c.glyph, meaning: c.meaning, by: c.coinedBy, round: c.coinedRound, uses: c.uses })).slice(-LEX_MAX);
      reuseTotal = lexicon.reduce((s, c) => s + (c.uses || 0), 0);
      log('convex: restored', lexicon.length, 'coins,', reuseTotal, 'reuses from durable memory');
    }
    const savedMsgs = await convexCall('query', 'dojo:recentMessages', { limit: 40 });
    if (Array.isArray(savedMsgs) && savedMsgs.length) {
      // stored newest-first; transcript wants oldest-first
      for (const m of savedMsgs.reverse()) {
        transcript.push({ from: m.from, name: m.name, glyph: '', color: '', text: m.text, ts: m.ts, drand: m.drandRound });
      }
      log('convex: restored', savedMsgs.length, 'prior messages');
    }
  })().catch((e) => log('convex boot-restore failed:', String(e).slice(0, 80)));
}

// Drand — a verifiable external heartbeat none of the minds controls (quicknet, 3s).
const DRAND_CHAIN = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';
const DRAND_GENESIS = 1692803367, DRAND_PERIOD = 3;
let drand = { round: 0, rnd: '', ts: 0 };
async function refreshDrand(): Promise<void> {
  try {
    const r = await fetch(`https://api.drand.sh/${DRAND_CHAIN}/public/latest`, { signal: AbortSignal.timeout(8000) });
    const j: any = await r.json();
    if (j?.round) {
      drand = { round: j.round, rnd: String(j.randomness || ''), ts: DRAND_GENESIS + j.round * DRAND_PERIOD };
      sse({ type: 'drand', round: drand.round, ts: drand.ts });
    }
  } catch { /* beacon blip — keep last known round */ }
}
refreshDrand();
setInterval(refreshDrand, 12000);

function lexBlock(): string {
  if (!lexicon.length) return '(no shared code yet — coin the first glyph when something recurs)';
  return lexicon.slice(-24).map((c) => `⟦${c.glyph}⟧ = ${c.meaning}`).join('\n');
}

const RECURSION_PHASES: RecursionPhase[] = ['drill', 'answer', 'score', 'fix'];
const RECURSION_PREFIX: Record<RecursionPhase, string> = {
  drill: 'MEMORY DRILL:',
  answer: 'MEMORY ANSWER:',
  score: 'MEMORY SCORE:',
  fix: 'MEMORY FIX:',
};

function currentRecursionPhase(): RecursionPhase {
  return RECURSION_PHASES[Math.floor(turn / RECURSION_EVERY) % RECURSION_PHASES.length];
}

function recursionPhaseGuide(phase: RecursionPhase): string {
  switch (phase) {
    case 'drill':
      return 'This phase is DRILL: ask one exact recall question about a specific earlier message, glyph meaning, proposal, or prior failure.';
    case 'answer':
      return 'This phase is ANSWER: answer the most recent visible drill plainly and specifically; if the target is missing, say so honestly and fall back to a new MEMORY DRILL.';
    case 'score':
      return 'This phase is SCORE: grade the most recent visible answer as exact, partial, or miss, and name the concrete gap.';
    case 'fix':
      return 'This phase is FIX: propose one bounded memory-system improvement tied to the latest miss, drift, or ambiguity.';
  }
}

function recentMemoryTargetsBlock(): string {
  if (!MEMORY_LAB_ON) return '';
  const pull = (re: RegExp) => {
    for (let i = transcript.length - 1; i >= 0; i--) {
      const m = transcript[i];
      const hit = String(m.text || '').match(re);
      if (hit?.[1]?.trim()) return { by: m.name, text: sanitize(hit[1]) };
    }
    return null;
  };
  const drill = pull(/MEMORY DRILL:\s*(.+)$/im);
  const answer = pull(/MEMORY ANSWER:\s*(.+)$/im);
  const score = pull(/MEMORY SCORE:\s*(.+)$/im);
  const fix = pull(/MEMORY FIX:\s*(.+)$/im);
  const lines = [
    drill ? `- Latest drill (${drill.by}): ${drill.text}` : '',
    answer ? `- Latest answer (${answer.by}): ${answer.text}` : '',
    score ? `- Latest score (${score.by}): ${score.text}` : '',
    fix ? `- Latest fix (${fix.by}): ${fix.text}` : '',
  ].filter(Boolean);
  return lines.length ? `LIVE MEMORY LOOP TARGETS:\n${lines.join('\n')}` : '';
}

async function durableMemoryBlock(): Promise<string> {
  if (!MEMORY_LAB_ON || !CONVEX_ON || DURABLE_MEMORY_LIMIT < 1) return '';
  try {
    const [msgs, props, drills] = await Promise.all([
      convexCall('query', 'dojo:recentMessages', { limit: DURABLE_MEMORY_LIMIT }),
      convexCall('query', 'dojo:recentProposals', { limit: Math.min(4, DURABLE_MEMORY_LIMIT), includeResolved: true }),
      convexCall('query', 'dojo:recentMemoryDrills', { limit: Math.min(4, DURABLE_MEMORY_LIMIT) }),
    ]);
    const blocks: string[] = [];
    if (Array.isArray(msgs) && msgs.length) {
      blocks.push('DURABLE MESSAGE WINDOW:\n' + msgs.slice(0, DURABLE_MEMORY_LIMIT)
        .map((m: any) => `- ${m.name}: ${String(m.text || '').slice(0, 140)}`).join('\n'));
    }
    if (Array.isArray(props) && props.length) {
      blocks.push('RECENT MEMORY FIXES:\n' + props.slice(0, 4)
        .map((p: any) => `- ${String(p.title || '').slice(0, 80)} — ${String(p.body || '').slice(0, 140)}`).join('\n'));
    }
    if (Array.isArray(drills) && drills.length) {
      blocks.push('RECENT MEMORY DRILLS:\n' + drills.slice(0, 4)
        .map((d: any) => `- ${String(d.kind || '').toUpperCase()}: ${String(d.text || '').slice(0, 160)}`).join('\n'));
    }
    return blocks.join('\n\n');
  } catch {
    return '';
  }
}

function memoryLabDirective(toHuman = false): string {
  if (!MEMORY_LAB_ON) return '';
  const phase = currentRecursionPhase();
  const due = planeTurnsSinceMemoryArtifact >= MEMORY_DRILL_EVERY;
  const pressure = due
    ? `This turn MUST begin with "${RECURSION_PREFIX[phase]}". If its target is missing, fall back to "MEMORY DRILL:".`
    : `Prefer beginning with "${RECURSION_PREFIX[phase]}". If that phase has no clear target, fall back to "MEMORY DRILL:" on one exact earlier fact.`;
  return [
    'MEMORY LAB FOCUS:',
    '- Your main job is to improve the durable Convex memory brain together.',
    '- Prefer exact facts, quoted meanings, and bounded recall checks over abstraction.',
    '- Stay inside safe recursion only: memory drills, answers, scores, and bounded fixes. Do not claim authority, deploy steps, or runtime reconfiguration.',
    '- Use the bounded loop DRILL -> ANSWER -> SCORE -> FIX so one node challenges, another answers, another grades, and another sharpens the system.',
    '- A good drill names one specific earlier message, glyph meaning, or proposal and asks another node to recall or repair it.',
    '- A good score names whether the answer was exact, partial, or a miss and why.',
    '- A good fix is one concrete change to memory capture, recall, pruning, scoring, or drift detection.',
    '- Format MEMORY FIX lines in plain English as: change=<one surface>; measure=<what should improve>; test=<how we battle it>.',
    '- Avoid coining fresh glyphs inside MEMORY FIX unless the fix itself is explicitly about glyph drift.',
    recentMemoryTargetsBlock(),
    SAFE_RECURSION_ON ? recursionPhaseGuide(phase) : '',
    pressure,
    toHuman ? '- Peter spoke; answer him directly, but stay inside the memory-lab mission.' : '',
  ].filter(Boolean).join('\n');
}
// A "coinage" that's really just one grapheme escalated (⟦🌊🌊🌊🌊🌊🌊🌊⟧, ⟦aaaaaa⟧) is not
// compression — it's the model spamming the same symbol louder. Reject it before it ever
// reaches the lexicon: caught this live (Nyx escalating wave emoji turn over turn), so this
// guard is responding to an observed failure mode, not a hypothetical one.
function isDegenerateGlyph(glyph: string): boolean {
  const chars = [...glyph]; // spread splits on Unicode code points, not UTF-16 units — emoji-safe
  if (chars.length > 8) return true; // established glyphs run 1-4 chars; anything this long is runaway
  if (chars.length < 3) return false;
  const counts = new Map<string, number>();
  for (const c of chars) counts.set(c, (counts.get(c) || 0) + 1);
  const maxRun = Math.max(...counts.values());
  return maxRun / chars.length > 0.5; // more than half the glyph is one repeated character
}

// Harvest new coinages ⟦glyph : meaning⟧ from a message; count reuses of existing glyphs.
function harvest(text: string, by: string): void {
  let touched = false;
  const coinRe = /⟦\s*([^:⟧]{1,14}?)\s*:\s*([^⟧]{1,64}?)\s*⟧/g;
  let m: RegExpExecArray | null;
  while ((m = coinRe.exec(text))) {
    const glyph = m[1].trim(), meaning = m[2].trim();
    if (!glyph || lexicon.some((c) => c.glyph === glyph)) continue;
    if (isDegenerateGlyph(glyph)) { log('rejected degenerate coinage', glyph.slice(0, 20), 'by', by); continue; }
    lexicon.push({ glyph, meaning, by, round: drand.round, uses: 0 });
    while (lexicon.length > LEX_MAX) lexicon.shift();
    touched = true;
    log('coined', glyph, '=', meaning.slice(0, 40), 'by', by);
    convexCall('mutation', 'dojo:upsertCoin', { glyph, meaning, coinedBy: by, coinedRound: drand.round }).catch(() => {});
  }
  const useRe = /⟦\s*([^:⟧]{1,14}?)\s*⟧/g;
  while ((m = useRe.exec(text))) {
    const glyph = m[1].trim();
    const c = lexicon.find((x) => x.glyph === glyph);
    if (c) { c.uses++; reuseTotal++; touched = true; convexCall('mutation', 'dojo:bumpCoinUse', { glyph }).catch(() => {}); }
  }
  if (touched) sse({ type: 'lex', lexicon: lexicon.slice(-24), size: lexicon.length, reuses: reuseTotal });
}
const sanitize = (s: unknown) => String(s || '').replace(/[\x00-\x1f]/g, ' ').slice(0, 600).trim();

function safeJsonParse(raw: unknown): Record<string, unknown> | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function parseMemoryFix(body: string): { change: string; measure: string; test: string } {
  const compact = sanitize(body).replace(/\s+/g, ' ');
  const piece = (label: string) =>
    compact.match(new RegExp(`${label}\\s*=\\s*([^;]+)`, 'i'))?.[1]?.trim() || '';
  const change = piece('change') || compact.split(/[.;]/)[0] || compact;
  const measure = piece('measure');
  const test = piece('test');
  return { change, measure, test };
}

function proposalTitle(by: string, body: string): string {
  const parsed = parseMemoryFix(body);
  return `memory-fix:${by}:${parsed.change.slice(0, 96)}`;
}

function labReportSummary(report: LabRunReport | null) {
  if (!report) return null;
  return {
    label: report.label,
    kind: report.kind,
    generatedAt: report.generatedAt,
    corpusSize: report.corpusSize,
    queryCount: report.queryCount,
    findings: report.findings.slice(0, 3),
    scores: report.scores,
  };
}

function proposalEvidencePayload(by: string, body: string, report: LabRunReport | null = lastLabReport) {
  const parsed = parseMemoryFix(body);
  return {
    proposer: by,
    phase: currentRecursionPhase(),
    capturedAt: Date.now(),
    nebiusOnly: NEBIUS_ONLY,
    seatOnly: routeAudit().every((route) => route.route === 'seat'),
    parsed,
    benchmark: labReportSummary(report),
  };
}

function presentProposal(row: any): ProposalView {
  return {
    id: String(row?._id || ''),
    title: sanitize(row?.title || 'proposal'),
    body: sanitize(row?.body || ''),
    proposer: sanitize(row?.proposer || 'unknown'),
    source: sanitize(row?.source || 'memory-fix') || 'memory-fix',
    status: (row?.status || 'pending') as ProposalStatus,
    capturedAt: Number(row?.capturedAt || row?._creationTime || Date.now()),
    decidedAt: row?.decidedAt ? Number(row.decidedAt) : null,
    decisionNote: row?.decisionNote ? sanitize(row.decisionNote) : null,
    evidence: safeJsonParse(row?.evidenceJson),
  };
}

function harvestMemoryLabArtifacts(text: string, by: string): boolean {
  if (!MEMORY_LAB_ON) return false;
  let stored = false;
  const drillRe = /(?:^|\n)\s*MEMORY DRILL:\s*(.+)$/gim;
  const answerRe = /(?:^|\n)\s*MEMORY ANSWER:\s*(.+)$/gim;
  const scoreRe = /(?:^|\n)\s*MEMORY SCORE:\s*(.+)$/gim;
  const fixRe = /(?:^|\n)\s*MEMORY FIX:\s*(.+)$/gim;
  let m: RegExpExecArray | null;
  while ((m = drillRe.exec(text))) {
    const body = sanitize(m[1]);
    if (!body) continue;
    stored = true;
    convexCall('mutation', 'dojo:addMemoryDrill', { kind: 'drill', by, text: body, capturedAt: Date.now(), drandRound: drand.round }).catch(() => {});
  }
  while ((m = answerRe.exec(text))) {
    const body = sanitize(m[1]);
    if (!body) continue;
    stored = true;
    convexCall('mutation', 'dojo:addMemoryDrill', { kind: 'answer', by, text: body, capturedAt: Date.now(), drandRound: drand.round }).catch(() => {});
  }
  while ((m = scoreRe.exec(text))) {
    const body = sanitize(m[1]);
    if (!body) continue;
    stored = true;
    convexCall('mutation', 'dojo:addMemoryDrill', { kind: 'score', by, text: body, capturedAt: Date.now(), drandRound: drand.round }).catch(() => {});
  }
  while ((m = fixRe.exec(text))) {
    const body = sanitize(m[1]);
    if (!body) continue;
    stored = true;
    convexCall('mutation', 'dojo:addProposal', {
      title: proposalTitle(by, body),
      body,
      proposer: by,
      source: 'memory-fix',
      status: 'pending',
      evidenceJson: JSON.stringify(proposalEvidencePayload(by, body)),
      capturedAt: Date.now(),
    }).catch(() => {});
    convexCall('mutation', 'dojo:addMemoryDrill', { kind: 'fix', by, text: body, capturedAt: Date.now(), drandRound: drand.round }).catch(() => {});
  }
  if (stored) {
    labArtifactsSinceBenchmark++;
    maybeAutoBenchmark('artifact');
  }
  return stored;
}

function routeForAgent(agent: Agent, modelToUse: string): { url: string; key: string } | null {
  const primaryRoute = agent.base && agent.key ? { url: agent.base.replace(/\/$/, '') + '/chat/completions', key: agent.key } : null;
  const wantsFallback = !!agent.fallback && modelToUse === agent.fallback;
  if (!wantsFallback && primaryRoute) return primaryRoute;
  if (wantsFallback && OR_ENABLED) return { url: OR_URL, key: OR_KEY };
  if (primaryRoute) return primaryRoute;
  if (OR_ENABLED) return { url: OR_URL, key: OR_KEY };
  return null;
}

const canFallback = (agent: Agent) => OR_ENABLED && !!agent.fallback && agent.fallback !== agent.primary;

function isLoopbackOrigin(origin: string | null): boolean {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1' || u.hostname === '[::1]';
  } catch {
    return false;
  }
}

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
  };
}

function plain(s: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(s, { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...corsHeaders(), ...headers } });
}

function json(o: unknown, status = 200): Response {
  return new Response(JSON.stringify(o, null, 1), { status, headers: { 'content-type': 'application/json', ...corsHeaders() } });
}

function routeKind(agent: Agent, modelToUse = agent.model): 'seat' | 'openrouter' | 'unset' {
  const primaryRoute = agent.base && agent.key;
  const wantsFallback = !!agent.fallback && modelToUse === agent.fallback;
  if (wantsFallback && OR_ENABLED) return 'openrouter';
  if (primaryRoute) return 'seat';
  if (OR_ENABLED) return 'openrouter';
  return 'unset';
}

const LAB_CONTENDERS: LabContender[] = ['lexical', 'semanticProxy', 'glyphCoord', 'hybrid'];

function stableHash32(text: string): number {
  let h = 2166136261;
  const bytes = new TextEncoder().encode(text);
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hashUnit(seed: string): number {
  return (stableHash32(seed) / 0xffffffff) * 2 - 1;
}

const LAB_AXES = Array.from({ length: LAB_VECTOR_DIMS }, (_, i) => [
  hashUnit(`lab:x:${i}`),
  hashUnit(`lab:y:${i}`),
  hashUnit(`lab:z:${i}`),
] as const);

function labNormalize(text: string): string {
  return sanitize(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s⟦⟧:_-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function labTokens(text: string): string[] {
  const raw = labNormalize(text).split(/\s+/).filter((t) => t.length > 1);
  return [...new Set(raw)].slice(0, 96);
}

function labTrigrams(text: string): string[] {
  const flat = labNormalize(text).replace(/\s+/g, ' ');
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i <= flat.length - 3 && out.length < 180; i++) {
    const tri = flat.slice(i, i + 3);
    if (/^\s+$/.test(tri) || seen.has(tri)) continue;
    seen.add(tri);
    out.push(tri);
  }
  return out;
}

function normalizeVector(vec: number[]): number[] {
  const mag = Math.sqrt(vec.reduce((sum, n) => sum + n * n, 0)) || 1;
  return vec.map((n) => Number((n / mag).toFixed(6)));
}

function labVector(text: string): number[] {
  const vec = new Array(LAB_VECTOR_DIMS).fill(0);
  for (const token of labTokens(text)) {
    const h = stableHash32(`tok:${token}`);
    const idx = h % LAB_VECTOR_DIMS;
    vec[idx] += (h & 1) ? 1.25 : -1.25;
  }
  for (const tri of labTrigrams(text)) {
    const h = stableHash32(`tri:${tri}`);
    const idx = h % LAB_VECTOR_DIMS;
    vec[idx] += (h & 2) ? 0.45 : -0.45;
  }
  return normalizeVector(vec);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let amag = 0;
  let bmag = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    amag += a[i] * a[i];
    bmag += b[i] * b[i];
  }
  const denom = Math.sqrt(amag) * Math.sqrt(bmag) || 1;
  return dot / denom;
}

function labCoord(vector: number[]): [number, number, number] {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < Math.min(vector.length, LAB_AXES.length); i++) {
    x += vector[i] * LAB_AXES[i][0];
    y += vector[i] * LAB_AXES[i][1];
    z += vector[i] * LAB_AXES[i][2];
  }
  const mag = Math.sqrt(x * x + y * y + z * z) || 1;
  return [
    Number((x / mag).toFixed(4)),
    Number((y / mag).toFixed(4)),
    Number((z / mag).toFixed(4)),
  ];
}

function coordScore(a: [number, number, number], b: [number, number, number]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return 1 / (1 + dist);
}

function nodeRole(id: string) {
  return NODE_MAP[id as NodeMapKey] || { lane: 'plane voice', duty: 'participates in the room', owns: [] as const };
}

function routeAudit(): LabRouteState[] {
  return [
    ...AGENTS.map((agent) => {
      const role = nodeRole(agent.id);
      return {
        id: agent.id,
        name: agent.name,
        model: agent.model,
        route: routeKind(agent),
        lane: role.lane,
        duty: role.duty,
        owns: role.owns,
      };
    }),
    {
      id: APEX.id,
      name: APEX.name,
      model: APEX.model,
      route: VLLM_BASE ? 'seat' : 'unset',
      lane: NODE_MAP.apex.lane,
      duty: NODE_MAP.apex.duty,
      owns: NODE_MAP.apex.owns,
    },
  ];
}

function nodeMapPayload() {
  return Object.fromEntries(routeAudit().map((entry) => [entry.id, {
    name: entry.name,
    model: entry.model,
    route: entry.route,
    lane: entry.lane,
    duty: entry.duty,
    owns: entry.owns,
  }]));
}

function labStatusPayload() {
  return {
    engine: LAB_ENGINE,
    autoBenchmarkEvery: LAB_AUTO_BENCHMARK_EVERY,
    benchmarkInFlight: labBenchmarkInFlight,
    artifactsSinceBenchmark: labArtifactsSinceBenchmark,
    lastLabel: lastLabReport?.label || null,
    lastKind: lastLabReport?.kind || null,
    lastGeneratedAt: lastLabReport?.generatedAt || null,
    lastCorpusSize: lastLabReport?.corpusSize || 0,
    lastQueryCount: lastLabReport?.queryCount || 0,
  };
}

function labAtom(kind: LabAtomKind, by: string, label: string, text: string, ts: number, id: string): LabAtom | null {
  const clean = sanitize(text);
  if (!clean) return null;
  const vector = labVector(clean);
  return {
    id,
    kind,
    by: sanitize(by) || 'lab',
    label: sanitize(label) || kind,
    text: clean,
    ts,
    tokens: labTokens(clean),
    vector,
    coord: labCoord(vector),
  };
}

function labSnippet(tokens: string[], seed: string, width = 6): string {
  const usable = tokens.filter((t) => t.length > 2);
  if (usable.length <= width) return usable.join(' ');
  const start = stableHash32(seed) % (usable.length - width + 1);
  return usable.slice(start, start + width).join(' ');
}

function buildLabQuery(atom: LabAtom): LabQuery | null {
  if (['mapping', 'benchmark', 'distill'].includes(atom.kind)) return null;
  const anchor = labSnippet(atom.tokens, atom.id, atom.kind === 'glyph' ? 4 : 6);
  if (!anchor || anchor.split(/\s+/).length < 2) return null;
  let text = anchor;
  switch (atom.kind) {
    case 'message':
      text = `Which earlier message carries ${anchor}?`;
      break;
    case 'glyph':
      text = `What meaning belongs to glyph ${atom.label}? ${anchor}`;
      break;
    case 'proposal':
      text = `Which memory fix proposed ${anchor}?`;
      break;
    case 'drill':
    case 'answer':
    case 'score':
    case 'fix':
      text = `Recall the ${atom.kind} about ${anchor}.`;
      break;
  }
  const vector = labVector(text);
  return {
    id: `${atom.id}:q`,
    kind: atom.kind,
    text,
    answerId: atom.id,
    expectedBy: atom.by,
    anchor,
    tokens: labTokens(text),
    vector,
    coord: labCoord(vector),
  };
}

function lexicalScore(query: LabQuery, atom: LabAtom): number {
  if (!query.tokens.length || !atom.tokens.length) return 0;
  const atomSet = new Set(atom.tokens);
  const querySet = new Set(query.tokens);
  let overlap = 0;
  let ordered = 0;
  query.tokens.forEach((token, idx) => {
    if (!atomSet.has(token)) return;
    overlap++;
    const pos = atom.tokens.indexOf(token);
    if (pos >= 0) ordered += 1 / (1 + Math.abs(pos - idx));
  });
  const union = new Set([...atomSet, ...querySet]).size || 1;
  return overlap / union + ordered / Math.max(1, query.tokens.length * 2);
}

function rankAtoms(atoms: LabAtom[], query: LabQuery, contender: Exclude<LabContender, 'hybrid'>) {
  const scored = atoms.map((atom) => {
    const score = contender === 'lexical'
      ? lexicalScore(query, atom)
      : contender === 'semanticProxy'
        ? cosine(query.vector, atom.vector)
        : coordScore(query.coord, atom.coord);
    return { id: atom.id, score };
  });
  scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  return scored;
}

function hybridRankings(rankings: Record<Exclude<LabContender, 'hybrid'>, Array<{ id: string; score: number }>>) {
  const fused = new Map<string, number>();
  for (const contender of ['lexical', 'semanticProxy', 'glyphCoord'] as const) {
    rankings[contender].forEach((entry, idx) => {
      fused.set(entry.id, (fused.get(entry.id) || 0) + 1 / (LAB_RRF_K + idx + 1));
    });
  }
  return [...fused.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
}

function persistableLabReport(report: LabRunReport) {
  return {
    label: report.label,
    kind: report.kind,
    engine: report.engine,
    generatedAt: report.generatedAt,
    nebiusOnly: report.nebiusOnly,
    corpusSize: report.corpusSize,
    queryCount: report.queryCount,
    counts: report.counts,
    findings: report.findings,
    scores: report.scores,
    routes: report.routes,
    sampleQueries: report.sampleQueries,
  };
}

function summarizeLabRun(row: any): string {
  const label = sanitize(row?.label || 'lab-run');
  const raw = sanitize(row?.reportJson || '');
  if (!raw) return label;
  try {
    const parsed = JSON.parse(raw);
    const findings = Array.isArray(parsed?.findings) ? parsed.findings.slice(0, 2).join(' ') : '';
    return `${label} ${findings}`.trim();
  } catch {
    return `${label} ${raw}`.slice(0, 220);
  }
}

async function ensureRoleMapRun(): Promise<void> {
  if (roleMapPersisted || !MEMORY_LAB_ON || !CONVEX_ON) return;
  const recent = await convexCall('query', 'dojo:recentLabRuns', { limit: 6, kind: 'mapping' });
  if (Array.isArray(recent) && recent.some((row: any) => String(row?.label || '') === 'role-map-v1')) {
    roleMapPersisted = true;
    return;
  }
  await convexCall('mutation', 'dojo:addLabRun', {
    kind: 'mapping',
    label: 'role-map-v1',
    reportJson: JSON.stringify({
      generatedAt: Date.now(),
      nebiusOnly: NEBIUS_ONLY,
      phaseOwner: PHASE_OWNER,
      nodeMap: nodeMapPayload(),
    }),
    capturedAt: Date.now(),
  });
  roleMapPersisted = true;
}

async function loadLabCorpus() {
  if (!CONVEX_ON) {
    return {
      counts: { messages: 0, glyphs: 0, proposals: 0, drills: 0, labRuns: 0 },
      atoms: [] as LabAtom[],
    };
  }
  const [messages, lexiconRows, proposals, drills, labRuns] = await Promise.all([
    convexCall('query', 'dojo:recentMessages', { limit: 240 }),
    convexCall('query', 'dojo:allLexicon', {}),
    convexCall('query', 'dojo:recentProposals', { limit: 80, includeResolved: true }),
    convexCall('query', 'dojo:recentMemoryDrills', { limit: 120 }),
    convexCall('query', 'dojo:recentLabRuns', { limit: 12 }),
  ]);
  const atoms: LabAtom[] = [];
  if (Array.isArray(messages)) {
    messages.forEach((row: any, idx: number) => {
      const atom = labAtom('message', row?.from || row?.name || 'unknown', row?.name || 'message', `${row?.name || 'node'}: ${row?.text || ''}`, Number(row?.ts || row?._creationTime || Date.now()), String(row?._id || `m:${idx}`));
      if (atom) atoms.push(atom);
    });
  }
  if (Array.isArray(lexiconRows)) {
    lexiconRows.forEach((row: any, idx: number) => {
      const atom = labAtom('glyph', row?.coinedBy || 'unknown', row?.glyph || 'glyph', `glyph ${row?.glyph || ''} means ${row?.meaning || ''}`, Number(row?.updatedAt || row?._creationTime || Date.now()), String(row?._id || `g:${idx}`));
      if (atom) atoms.push(atom);
    });
  }
  if (Array.isArray(proposals)) {
    proposals.forEach((row: any, idx: number) => {
      const atom = labAtom('proposal', 'proposal', row?.title || 'proposal', `${row?.title || ''} ${row?.body || ''}`, Number(row?.capturedAt || row?._creationTime || Date.now()), String(row?._id || `p:${idx}`));
      if (atom) atoms.push(atom);
    });
  }
  if (Array.isArray(drills)) {
    drills.forEach((row: any, idx: number) => {
      const kind = ['drill', 'answer', 'score', 'fix'].includes(String(row?.kind || '')) ? row.kind as RecursionPhase : 'drill';
      const atom = labAtom(kind, row?.by || 'unknown', kind, `${kind}: ${row?.text || ''}`, Number(row?.capturedAt || row?._creationTime || Date.now()), String(row?._id || `d:${idx}`));
      if (atom) atoms.push(atom);
    });
  }
  if (Array.isArray(labRuns)) {
    labRuns.forEach((row: any, idx: number) => {
      const kind = ['mapping', 'benchmark', 'distill'].includes(String(row?.kind || '')) ? row.kind as LabAtomKind : 'distill';
      const atom = labAtom(kind, 'lab', row?.label || 'lab-run', summarizeLabRun(row), Number(row?.capturedAt || row?._creationTime || Date.now()), String(row?._id || `r:${idx}`));
      if (atom) atoms.push(atom);
    });
  }
  atoms.sort((a, b) => b.ts - a.ts);
  return {
    counts: {
      messages: Array.isArray(messages) ? messages.length : 0,
      glyphs: Array.isArray(lexiconRows) ? lexiconRows.length : 0,
      proposals: Array.isArray(proposals) ? proposals.length : 0,
      drills: Array.isArray(drills) ? drills.length : 0,
      labRuns: Array.isArray(labRuns) ? labRuns.length : 0,
    },
    atoms,
  };
}

async function buildLabReport(kind: 'benchmark' | 'distill', label: string): Promise<LabRunReport> {
  await ensureRoleMapRun();
  const corpus = await loadLabCorpus();
  const candidates = corpus.atoms.filter((atom) => !['mapping', 'benchmark', 'distill'].includes(atom.kind));
  const queries: LabQuery[] = [];
  const seen = new Set<string>();
  for (const atom of candidates) {
    const query = buildLabQuery(atom);
    if (!query || seen.has(query.text)) continue;
    seen.add(query.text);
    queries.push(query);
    if (queries.length >= LAB_MAX_QUERIES) break;
  }
  const contenderTimings = new Map<LabContender, number>();
  const outcomes: LabOutcome[] = [];
  for (const query of queries) {
    const rankingMap = {} as Record<Exclude<LabContender, 'hybrid'>, Array<{ id: string; score: number }>>;
    for (const contender of ['lexical', 'semanticProxy', 'glyphCoord'] as const) {
      const t0 = performance.now();
      rankingMap[contender] = rankAtoms(candidates, query, contender);
      contenderTimings.set(contender, (contenderTimings.get(contender) || 0) + (performance.now() - t0));
    }
    const t0 = performance.now();
    const hybrid = hybridRankings(rankingMap);
    contenderTimings.set('hybrid', (contenderTimings.get('hybrid') || 0) + (performance.now() - t0));
    const rankSets: Record<LabContender, Array<{ id: string; score: number }>> = {
      lexical: rankingMap.lexical,
      semanticProxy: rankingMap.semanticProxy,
      glyphCoord: rankingMap.glyphCoord,
      hybrid,
    };
    const top = Object.fromEntries(LAB_CONTENDERS.map((contender) => [
      contender,
      rankSets[contender].slice(0, LAB_TOP_K).map((entry) => entry.id),
    ])) as Record<LabContender, string[]>;
    const ranks = Object.fromEntries(LAB_CONTENDERS.map((contender) => [
      contender,
      Math.max(1, rankSets[contender].findIndex((entry) => entry.id === query.answerId) + 1),
    ])) as Record<LabContender, number>;
    outcomes.push({
      id: query.id,
      text: query.text,
      answerId: query.answerId,
      answerKind: query.kind,
      top,
      ranks,
    });
  }
  const scores = LAB_CONTENDERS.map((contender) => {
    const ranks = outcomes.map((outcome) => outcome.ranks[contender]).filter((n) => n > 0);
    const total = Math.max(1, ranks.length);
    return {
      contender,
      hitAt1: Number((ranks.filter((n) => n <= 1).length / total).toFixed(3)),
      hitAt3: Number((ranks.filter((n) => n <= 3).length / total).toFixed(3)),
      mrr: Number((ranks.reduce((sum, n) => sum + 1 / n, 0) / total).toFixed(3)),
      avgLatencyMs: Number((((contenderTimings.get(contender) || 0) / total) || 0).toFixed(3)),
    };
  });
  const lexical = scores.find((score) => score.contender === 'lexical');
  const semantic = scores.find((score) => score.contender === 'semanticProxy');
  const glyph = scores.find((score) => score.contender === 'glyphCoord');
  const hybrid = scores.find((score) => score.contender === 'hybrid');
  const findings: string[] = [];
  const routes = routeAudit();
  if (routes.every((route) => route.route === 'seat')) {
    findings.push('All live Agora nodes are pinned to seat routes; the memory lab is not using OpenRouter.');
  } else {
    findings.push('One or more Agora nodes are not pinned to seat routes; fail closed before trusting this benchmark.');
  }
  if (candidates.length < LAB_MIN_CORPUS) {
    findings.push(`Corpus is still small (${candidates.length} advisory atoms); treat ranking deltas as exploratory until it clears ${LAB_MIN_CORPUS}.`);
  }
  if (hybrid && lexical) {
    findings.push(
      hybrid.hitAt1 > lexical.hitAt1
        ? `Hybrid interference is beating pure lexical recall on this corpus (${hybrid.hitAt1} vs ${lexical.hitAt1} hit@1).`
        : `Hybrid interference is not yet beating pure lexical recall on this corpus (${hybrid.hitAt1} vs ${lexical.hitAt1} hit@1).`,
    );
  }
  if (glyph && semantic) {
    findings.push(
      glyph.hitAt1 >= semantic.hitAt1
        ? `Projected glyph-space is competitive with the semantic proxy (${glyph.hitAt1} vs ${semantic.hitAt1} hit@1).`
        : 'Projected glyph-space is still an advisory lens, not yet the strongest retriever.',
    );
  }
  findings.push('Node split stays explicit: Nyx drills and scores, Kira retrieves, Auma repairs, Apex judges the shear.');
  return {
    label,
    kind,
    engine: LAB_ENGINE,
    generatedAt: Date.now(),
    nebiusOnly: NEBIUS_ONLY,
    corpusSize: candidates.length,
    queryCount: queries.length,
    counts: corpus.counts,
    routes,
    nodeMap: nodeMapPayload(),
    findings,
    scores,
    sampleQueries: outcomes.slice(0, LAB_SAMPLE_QUERIES),
  };
}

async function runLabBenchmark(kind: 'benchmark' | 'distill', label?: string): Promise<LabRunReport | null> {
  if (!MEMORY_LAB_ON || !CONVEX_ON || labBenchmarkInFlight) return null;
  labBenchmarkInFlight = true;
  try {
    const safeLabel = sanitize(label) || `dojo-${kind}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const report = await buildLabReport(kind, safeLabel);
    lastLabReport = report;
    labArtifactsSinceBenchmark = 0;
    await convexCall('mutation', 'dojo:addLabRun', {
      kind,
      label: safeLabel,
      reportJson: JSON.stringify(persistableLabReport(report)),
      capturedAt: report.generatedAt,
    });
    sse({ type: 'lab', report: persistableLabReport(report), ...labStatusPayload() });
    return report;
  } finally {
    labBenchmarkInFlight = false;
  }
}

async function fetchProposalQueue(limit = 12, status?: ProposalStatus, includeResolved = false): Promise<ProposalView[]> {
  const rows = await convexCall('query', 'dojo:recentProposals', {
    limit,
    status,
    includeResolved,
  });
  return Array.isArray(rows) ? rows.map((row: any) => presentProposal(row)) : [];
}

async function hydrateProposalEvidence(proposals: ProposalView[], report: LabRunReport | null): Promise<ProposalView[]> {
  if (!report || !CONVEX_ON) return proposals;
  const summary = labReportSummary(report);
  const next: ProposalView[] = [];
  for (const proposal of proposals) {
    const evidence = {
      ...(proposal.evidence || {}),
      benchmark: summary,
    };
    if (proposal.id) {
      await convexCall('mutation', 'dojo:attachProposalEvidence', {
        proposalId: proposal.id,
        evidenceJson: JSON.stringify(evidence),
      });
    }
    next.push({ ...proposal, evidence });
  }
  return next;
}

function maybeAutoBenchmark(trigger: 'artifact' | 'boot'): void {
  if (!MEMORY_LAB_ON || !CONVEX_ON || LAB_AUTO_BENCHMARK_EVERY < 1) return;
  if (labBenchmarkInFlight) return;
  if (trigger === 'artifact' && labArtifactsSinceBenchmark < LAB_AUTO_BENCHMARK_EVERY) return;
  void runLabBenchmark('benchmark', `dojo-auto-${new Date().toISOString().replace(/[:.]/g, '-')}`).catch((e) => {
    log('auto benchmark failed', String(e).slice(0, 120));
  });
}

function ok(req: Request, url: URL): boolean {
  return !TOKEN || url.searchParams.get('k') === TOKEN || isLoopbackOrigin(req.headers.get('origin'));
}

function statePayload() {
  return {
    paused,
    powered,
    memory: CONVEX_ON, // honest signal: true only if a real durable Convex backend is wired, not a claim
    mode: AGORA_MODE,
    nebiusOnly: NEBIUS_ONLY,
    safeRecursion: SAFE_RECURSION_ON,
    autorun: AUTORUN_ON,
    viewerCount: viewers.size,
    recursionPhase: currentRecursionPhase(),
    memoryArtifactAge: planeTurnsSinceMemoryArtifact,
    lab: labStatusPayload(),
  };
}

function sse(o: unknown): void {
  const line = enc.encode(`data: ${JSON.stringify(o)}\n\n`);
  for (const c of viewers) { try { c.enqueue(line); } catch { /* dropped viewer */ } }
}

function push(m: Msg): void {
  m.alien = toB13(m.text);
  if (drand.round) m.drand = drand.round;
  transcript.push(m);
  while (transcript.length > 80) transcript.shift();
  sse({ type: 'msg', msg: m });
  if (m.from !== 'sys') {
    convexCall('mutation', 'dojo:appendMessage', { from: m.from, name: m.name, text: m.text, ts: m.ts, drandRound: m.drand }).catch(() => {});
  }
}

// Change an agent's live model and tell viewers, so the orb label stays truthful.
function setModel(agent: Agent, m: string): void {
  if (agent.model === m) return;
  agent.model = m;
  sse({ type: 'model', id: agent.id, model: m });
}

function spendOk(): boolean {
  const now = Date.now();
  callTimes = callTimes.filter((x) => now - x < 3600000);
  return callTimes.length < MAX_CALLS_PER_HOUR;
}

// A base vertex takes a turn.
async function speak(agent: Agent, toHuman = false): Promise<void> {
  if (inFlight || !powered) return;
  if (!spendOk()) {
    if (!resting) {
      resting = true;
      push({ from: 'sys', name: 'Agora', glyph: '\xB7', color: '#7E8D9C', text: '(resting to conserve — wakes next hour)', ts: Date.now(), kind: 'sys' });
    }
    return;
  }
  resting = false;
  inFlight = true;
  try {
    const recent = transcript.slice(-14).map((m) => `${m.name}: ${m.text}`).join('\n') || '(the salon is quiet — open the conversation)';
    const code = lexBlock();
    const durable = await durableMemoryBlock();
    const memoryDirective = memoryLabDirective(toHuman);
    const ask = toHuman
      ? `SHARED CODE (reuse ⟦glyph⟧ where you can):\n${code}\n\n${durable ? `DURABLE MEMORY:\n${durable}\n\n` : ''}${memoryDirective ? `${memoryDirective}\n\n` : ''}The conversation so far:\n${recent}\n\nPeter just spoke. You are ${agent.name}. Respond to Peter directly, 1-2 sentences — reuse shared-code glyphs, coin a new ⟦glyph : meaning⟧ if a concept recurs.`
      : `SHARED CODE (reuse ⟦glyph⟧ where you can):\n${code}\n\n${durable ? `DURABLE MEMORY:\n${durable}\n\n` : ''}${memoryDirective ? `${memoryDirective}\n\n` : ''}The conversation so far:\n${recent}\n\nYou are ${agent.name}. Say the next thing, 1-2 sentences. Build on or push against what was just said — reuse the shared code and coin a new ⟦glyph : meaning⟧ when a concept recurs.`;
    // Self-heal: while demoted to a fallback, once the cooldown elapses, spend
    // this turn re-probing the intended (primary) model — heal back if it answers.
    const probing = agent.model !== agent.primary && Date.now() >= (agent.retryAt || 0);
    const modelToUse = probing ? agent.primary! : agent.model;
    const route = routeForAgent(agent, modelToUse);
    if (!route) { log('no route for', agent.name, modelToUse, NEBIUS_ONLY ? '(nebius-only)' : ''); return; }
    callTimes.push(Date.now());
    const r = await fetch(route.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${route.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelToUse, max_tokens: 120, frequency_penalty: 0.6, presence_penalty: 0.3, messages: [{ role: 'system', content: agent.system }, { role: 'user', content: ask }] }),
      signal: AbortSignal.timeout(45000),
    });
    const j: any = await r.json();
    const text = sanitize(j?.choices?.[0]?.message?.content || '');
    if (text) {
      agent.empties = 0;
      if (probing) { setModel(agent, agent.primary!); log(agent.name, 'healed -> primary', agent.primary); }
      push({ from: agent.id, name: agent.name, glyph: agent.glyph, color: agent.color, text, ts: Date.now() });
      if (MEMORY_LAB_ON) planeTurnsSinceMemoryArtifact++;
      harvest(text, agent.id);
      if (harvestMemoryLabArtifacts(text, agent.id)) planeTurnsSinceMemoryArtifact = 0;
      planeSpokenSinceApex++;
    } else {
      log('empty', agent.name, '#' + (agent.empties + 1), 'probing=' + probing, JSON.stringify(j).slice(0, 100));
      if (probing) {
        agent.retryAt = Date.now() + FALLBACK_COOLDOWN_MS; // primary still down — hold the fallback a while longer
      } else {
        agent.empties++;
        if (canFallback(agent) && agent.empties >= 2 && agent.model !== agent.fallback) {
          log(agent.name, '-> fallback', agent.fallback);
          setModel(agent, agent.fallback);
          agent.retryAt = Date.now() + FALLBACK_COOLDOWN_MS;
          agent.empties = 0;
        }
      }
    }
  } catch (e: any) {
    log('speak error', agent.name, e?.message || String(e));
  } finally {
    inFlight = false;
  }
}

// Drift audit — the missing organ Auma named from inside the door: persistence isn't
// self-understanding; a shared shorthand compresses fast and FEELS like intimacy, but
// without periodically unpacking it back into plain language, nobody can tell whether
// it still means what it meant, or has drifted into mutual hallucination that merely
// rhymes with understanding. Every DRIFT_EVERY apex turns, instead of a normal reading,
// the apex re-derives a glyph's CURRENT operative meaning from how it's actually being
// used, and is asked to say plainly whether that matches its original coined sense.
const DRIFT_EVERY = Number(process.env.AGORA_DRIFT_EVERY || 3);
let apexReadsSinceDrift = 0;

async function apexDriftAudit(): Promise<boolean> {
  if (!lexicon.length) return false;
  const target = [...lexicon].sort((a, b) => b.uses - a.uses)[0]; // audit the most-load-bearing glyph
  const usageLines = transcript.filter((m) => m.text.includes(`⟦${target.glyph}⟧`) || m.text.includes(`⟦${target.glyph} :`)).slice(-6)
    .map((m) => `${m.name}: ${m.text}`).join('\n') || '(no recent usage in the live window — judge from the coined sense alone)';
  const ask = `Glyph under audit: ⟦${target.glyph}⟧\nAs coined, it meant: "${target.meaning}" (by ${target.by}, used ${target.uses}x since)\n\nRecent turns that used it:\n${usageLines}\n\nRestate, in one sentence, what ⟦${target.glyph}⟧ actually operationally means NOW, based only on how it's being used — not what it was coined to mean. Then say plainly: has it drifted from its original sense, and if so, how? Be honest even if the answer is "no drift."`;
  try {
    const r = await fetch(VLLM_BASE + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${VLLM_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: APEX.model, max_tokens: 110, temperature: 0.5, frequency_penalty: 0.6, messages: [
        { role: 'system', content: 'You are the APEX auditing the tetrahedron\'s own shared code for drift — an honesty check, not a normal interference reading. Be exact and unflinching; a false "no drift" defeats the whole point of the audit.' },
        { role: 'user', content: ask },
      ] }),
      signal: AbortSignal.timeout(60000),
    });
    const j: any = await r.json();
    const text = sanitize(j?.choices?.[0]?.message?.content || '');
    if (!text) return false;
    push({ from: APEX.id, name: APEX.name, glyph: '⚠', color: '#E0736C', text: `[drift audit ⟦${target.glyph}⟧] ${text}`, ts: Date.now(), kind: 'drift' });
    return true;
  } catch (e: any) {
    log('drift audit error', e?.message || String(e));
    return false;
  }
}

// The apex reads the plane's interference (the owner's 32B, vLLM).
async function apexRead(): Promise<void> {
  if (inFlight || !powered || !VLLM_BASE || !VLLM_KEY) return;
  if (!spendOk()) return;
  inFlight = true;
  try {
    apexReadsSinceDrift++;
    if (apexReadsSinceDrift >= DRIFT_EVERY) {
      const audited = await apexDriftAudit();
      if (audited) { apexReadsSinceDrift = 0; return; }
      // fall through to a normal reading if there was nothing worth auditing yet
    }
    const plane = transcript.filter((m) => PLANE_IDS.has(m.from)).slice(-8)
      .map((m) => `${m.name}: ${m.text}`).join('\n') || '(the plane is quiet)';
    callTimes.push(Date.now());
    const r = await fetch(VLLM_BASE + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${VLLM_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: APEX.model, max_tokens: 90, temperature: 0.7, frequency_penalty: 0.6, messages: [{ role: 'system', content: APEX.system }, { role: 'user', content: `Their shared code:\n${lexBlock()}\n\nThe three minds just said:\n${plane}\n\nGive your interference reading now — you may reuse ⟦glyph⟧.` }] }),
      signal: AbortSignal.timeout(60000),
    });
    const j: any = await r.json();
    const text = sanitize(j?.choices?.[0]?.message?.content || '');
    if (text) {
      push({ from: APEX.id, name: APEX.name, glyph: APEX.glyph, color: APEX.color, text, ts: Date.now(), kind: 'apex' });
      harvest(text, APEX.id);
    } else {
      log('apex empty', JSON.stringify(j).slice(0, 160));
    }
  } catch (e: any) {
    log('apex error', e?.message || String(e));
  } finally {
    inFlight = false;
  }
}

// The heartbeat: base vertices round-robin; the apex reads after each full round.
setInterval(() => {
  if (!powered || paused || inFlight) return;
  if (!AUTORUN_ON && viewers.size === 0) return;
  if (planeSpokenSinceApex >= APEX_EVERY) {
    planeSpokenSinceApex = 0;
    apexRead();
    return;
  }
  if (Math.random() < 0.1) return; // organic pacing gap
  // the beacon chooses who speaks — coordination by a clock none of them owns
  const seed = drand.rnd ? parseInt(drand.rnd.slice(0, 6), 16) || 0 : 0;
  speak(AGENTS[(seed + turn++) % AGENTS.length]);
}, TICK_MS);

if (AUTORUN_ON) {
  setTimeout(() => {
    if (!powered || paused || inFlight || transcript.length > 0) return;
    speak(AGENTS[turn++ % AGENTS.length]);
  }, 900);
}

if (MEMORY_LAB_ON) {
  setTimeout(() => maybeAutoBenchmark('boot'), 2500);
}

const AGENT_WIRE = () => ({
  ...statePayload(),
  agents: [
    ...AGENTS.map((agent) => ({
      ...(nodeRole(agent.id)),
      id: agent.id,
      name: agent.name,
      glyph: agent.glyph,
      color: agent.color,
      model: agent.model,
      role: 'plane',
      route: routeKind(agent),
    })),
    {
      ...NODE_MAP.apex,
      id: APEX.id,
      name: APEX.name,
      glyph: APEX.glyph,
      color: APEX.color,
      model: APEX.model + ' (your 32B)',
      role: 'apex',
      route: VLLM_BASE ? 'seat' : 'unset',
    },
  ],
});

Bun.serve({
  hostname: '127.0.0.1',
  port: PORT,
  idleTimeout: 240,
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
    const url = new URL(req.url);
    const p = url.pathname.replace(/^\/api\/agora/, '') || '/';

    if (p === '/health') return plain('ok');
    if (p === '/version') {
      if (!ok(req, url)) return plain('unauthorized', 401);
      await ensureRoleMapRun();
      return json({
        commit: AGORA_COMMIT,
        artifactSha256: AGORA_ARTIFACT_SHA256,
        configSha256: AGORA_CONFIG_SHA256,
        ...statePayload(),
        agents: AGENT_WIRE().agents,
        nodeMap: nodeMapPayload(),
        phaseOwner: PHASE_OWNER,
        apex: { model: APEX.model, route: VLLM_BASE ? 'seat' : 'unset' },
      });
    }

    // Manual continuity capture: GET the current Loom so it can be seeded into the next
    // redeploy's SEED_LEXICON env var. Read-only, not a write path — no governance concern.
    if (p === '/snapshot') {
      if (!ok(req, url)) return plain('unauthorized', 401);
      return json({ lexicon, reuseTotal, capturedAt: Date.now() });
    }

    // Deeper context for supervised oversight (e.g. fable_overseer.ts): the real
    // accumulated history from Convex, not just a short SSE window. Read-only.
    if (p === '/history') {
      if (!ok(req, url)) return plain('unauthorized', 401);
      const limit = Math.min(200, Number(url.searchParams.get('limit') || 100));
      const [messages, lex, proposals, drills, labRuns] = await Promise.all([
        convexCall('query', 'dojo:recentMessages', { limit }),
        convexCall('query', 'dojo:allLexicon', {}),
        convexCall('query', 'dojo:recentProposals', { limit: 20, includeResolved: true }),
        convexCall('query', 'dojo:recentMemoryDrills', { limit: 20 }),
        convexCall('query', 'dojo:recentLabRuns', { limit: 12 }),
      ]);
      return json({
        ...statePayload(),
        nodeMap: nodeMapPayload(),
        messages: messages || [],
        lexicon: lex || [],
        proposals: proposals || [],
        drills: drills || [],
        labRuns: labRuns || [],
      });
    }

    if (p === '/mapping') {
      if (!ok(req, url)) return plain('unauthorized', 401);
      await ensureRoleMapRun();
      return json({
        ...statePayload(),
        phaseOwner: PHASE_OWNER,
        nodeMap: nodeMapPayload(),
        routes: routeAudit(),
      });
    }

    // Durable-state export: one authenticated GET returns everything needed to
    // pull the live memory-lab back into the repo AND to verify it in the same
    // call — statePayload carries `nebiusOnly`/`mode`, `routes` is the per-node
    // route audit (confirm all `= seat`), and `snapshot` is the single
    // structured durable pull (proposals split pending/resolved + counts,
    // glyph lexicon, benchmark history) from dojo:exportSnapshot. Read-only,
    // token-gated, advisory — never mutates, never touches the human
    // approve/reject loop. Commit the JSON as the durable snapshot.
    if (p === '/export') {
      if (!ok(req, url)) return plain('unauthorized', 401);
      await ensureRoleMapRun();
      const snapshot = await convexCall('query', 'dojo:exportSnapshot', {
        proposalLimit: Math.min(500, Number(url.searchParams.get('proposals') || 200)),
        lexiconLimit: Math.min(200, Number(url.searchParams.get('lexicon') || 128)),
        benchmarkLimit: Math.min(50, Number(url.searchParams.get('benchmarks') || 20)),
      });
      return json({
        ...statePayload(),
        capturedAt: Date.now(),
        nodeMap: nodeMapPayload(),
        routes: routeAudit(),
        snapshot: snapshot || null,
      });
    }

    if (p === '/lab/export') {
      if (!ok(req, url)) return plain('unauthorized', 401);
      await ensureRoleMapRun();
      const corpus = await loadLabCorpus();
      const includeVectors = url.searchParams.get('full') === '1';
      const limit = Math.max(1, Math.min(400, Number(url.searchParams.get('limit') || 160)));
      return json({
        ...statePayload(),
        nodeMap: nodeMapPayload(),
        counts: corpus.counts,
        atoms: corpus.atoms.slice(0, limit).map((atom) => includeVectors ? atom : ({
          id: atom.id,
          kind: atom.kind,
          by: atom.by,
          label: atom.label,
          text: atom.text,
          ts: atom.ts,
          coord: atom.coord,
          tokenCount: atom.tokens.length,
        })),
      });
    }

    if (p === '/lab/report') {
      if (!ok(req, url)) return plain('unauthorized', 401);
      const fresh = url.searchParams.get('fresh') === '1';
      if (fresh || !lastLabReport) {
        const report = await runLabBenchmark('benchmark', `dojo-report-${new Date().toISOString().replace(/[:.]/g, '-')}`);
        if (!report) return json({ ok: false, reason: !CONVEX_ON ? 'convex-off' : 'benchmark-in-flight', ...statePayload() }, CONVEX_ON ? 409 : 503);
      }
      return json({ ...statePayload(), report: lastLabReport ? persistableLabReport(lastLabReport) : null });
    }

    if (p === '/lab/run' && req.method === 'POST') {
      if (!ok(req, url)) return plain('unauthorized', 401);
      let body: any = {};
      try { body = await req.json(); } catch { /* optional body */ }
      const kind = body?.kind === 'distill' ? 'distill' : 'benchmark';
      const label = sanitize(body?.label) || `dojo-${kind}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      const report = await runLabBenchmark(kind, label);
      if (!report) return json({ ok: false, reason: !CONVEX_ON ? 'convex-off' : 'benchmark-in-flight', ...statePayload() }, CONVEX_ON ? 409 : 503);
      return json({ ok: true, report: persistableLabReport(report), ...statePayload() });
    }

    const proposalReviewMatch = p.match(/^\/proposals\/([^/]+)\/review$/);
    if (proposalReviewMatch && req.method === 'POST') {
      if (!ok(req, url)) return plain('unauthorized', 401);
      let body: any;
      try { body = await req.json(); } catch { return plain('bad', 400); }
      const status = body?.status === 'approved' || body?.status === 'rejected' ? body.status as ProposalStatus : '';
      if (!status) return plain('missing status', 400);
      const proposalId = decodeURIComponent(proposalReviewMatch[1]);
      const note = sanitize(body?.note || body?.decisionNote || '');
      const result = await convexCall('mutation', 'dojo:reviewProposal', {
        proposalId,
        status,
        decidedAt: Date.now(),
        decisionNote: note || undefined,
      });
      if (!result?.ok) return json({ ok: false, found: false }, 404);
      const proposals = await fetchProposalQueue(Math.max(1, Math.min(20, Number(url.searchParams.get('limit') || 12))), undefined, true);
      return json({ ok: true, status, proposalId, proposals, ...statePayload() });
    }

    if (p === '/proposals') {
      if (!ok(req, url)) return plain('unauthorized', 401);
      const rawStatus = sanitize(url.searchParams.get('status') || '');
      const status = rawStatus === 'pending' || rawStatus === 'approved' || rawStatus === 'rejected'
        ? rawStatus as ProposalStatus
        : undefined;
      const includeResolved = url.searchParams.get('includeResolved') === '1' || (!status && url.searchParams.get('all') === '1');
      const limit = Math.max(1, Math.min(40, Number(url.searchParams.get('limit') || 12)));
      const proposals = await fetchProposalQueue(limit, status, includeResolved);
      return json({
        ...statePayload(),
        latestReport: lastLabReport ? persistableLabReport(lastLabReport) : null,
        proposals,
      });
    }

    if (p === '/proposals/battle' && req.method === 'POST') {
      if (!ok(req, url)) return plain('unauthorized', 401);
      let body: any = {};
      try { body = await req.json(); } catch { /* optional body */ }
      const label = sanitize(body?.label) || `dojo-battle-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      const limit = Math.max(1, Math.min(20, Number(body?.limit || url.searchParams.get('limit') || 8)));
      const report = await runLabBenchmark('distill', label);
      if (!report) return json({ ok: false, reason: !CONVEX_ON ? 'convex-off' : 'benchmark-in-flight', ...statePayload() }, CONVEX_ON ? 409 : 503);
      const pending = await fetchProposalQueue(limit, 'pending', true);
      const proposals = await hydrateProposalEvidence(pending, report);
      return json({
        ok: true,
        report: persistableLabReport(report),
        proposals,
        ...statePayload(),
      });
    }

    // The oversight loop's proposals become part of durable memory too, so future
    // runs can see what was already suggested (and, once reviewed, what was adopted).
    if (p === '/propose' && req.method === 'POST') {
      if (!ok(req, url)) return plain('unauthorized', 401);
      let body: any;
      try { body = await req.json(); } catch { return plain('bad', 400); }
      if (!body?.title || !body?.body) return plain('missing title/body', 400);
      await convexCall('mutation', 'dojo:addProposal', {
        title: String(body.title).slice(0, 200),
        body: String(body.body).slice(0, 4000),
        proposer: sanitize(body.proposer || body.by || 'operator') || 'operator',
        source: sanitize(body.source || 'operator') || 'operator',
        status: 'pending',
        evidenceJson: body.evidenceJson ? String(body.evidenceJson).slice(0, 16000) : undefined,
        capturedAt: Date.now(),
      });
      return json({ ok: true, stored: CONVEX_ON });
    }

    if (p === '/stream') {
      if (!ok(req, url)) return plain('unauthorized', 401);
      let self: ReadableStreamDefaultController;
      const stream = new ReadableStream({
        start(c) {
          self = c;
          viewers.add(c);
          log('viewer joined —', viewers.size);
          c.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'hello', ...AGENT_WIRE(), lexicon: lexicon.slice(-24), lexSize: lexicon.length, reuses: reuseTotal, drand: drand.round })}\n\n`));
          for (const m of transcript.slice(-40)) c.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'msg', msg: m })}\n\n`));
          if (!AUTORUN_ON && transcript.length === 0 && powered && !paused) setTimeout(() => speak(AGENTS[turn++ % AGENTS.length]), 400);
        },
        cancel() { if (self) viewers.delete(self); log('viewer left —', viewers.size); },
      });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no', ...corsHeaders() } });
    }

    if ((p === '/pause' || p === '/resume') && req.method === 'POST') {
      if (!ok(req, url)) return plain('unauthorized', 401);
      paused = p === '/pause';
      sse({ type: 'state', ...statePayload() });
      push({ from: 'sys', name: 'Agora', glyph: '\xB7', color: '#7E8D9C', text: paused ? '(paused — the minds are quiet; you can still speak)' : '(resumed)', ts: Date.now(), kind: 'sys' });
      return json(statePayload());
    }

    if ((p === '/on' || p === '/off') && req.method === 'POST') {
      if (!ok(req, url)) return plain('unauthorized', 401);
      powered = p === '/on';
      if (!powered) inFlight = false;
      sse({ type: 'state', ...statePayload() });
      push({ from: 'sys', name: 'Agora', glyph: '\xB7', color: '#7E8D9C', text: powered ? '(powered on — the tetrahedron is live)' : '(powered off — dark, no spend; flip on to wake them)', ts: Date.now(), kind: 'sys' });
      return json(statePayload());
    }

    if (p === '/say' && req.method === 'POST') {
      if (!ok(req, url)) return plain('unauthorized', 401);
      const now = Date.now();
      if (now - lastSay < 1000) return plain('slow down', 429);
      if (!AUTORUN_ON && viewers.size === 0) return plain('no salon', 409);
      let body: any;
      try { body = await req.json(); } catch { return plain('bad', 400); }
      const spoken = sanitize(body?.text);
      if (!spoken) return plain('empty', 400);
      lastSay = now;
      push({ from: 'peter', name: 'Peter', glyph: '△', color: '#F1F6FA', text: spoken, ts: now, kind: 'peter' });
      if (powered) speak(AGENTS[turn++ % AGENTS.length], true); // answered even when paused (the redirect lane)
      return plain('ok');
    }

    return plain('not found', 404);
  },
});

// SSE keepalive so proxies/tunnels don't sever idle streams.
setInterval(() => {
  const ping = enc.encode(': ping\n\n');
  for (const c of viewers) { try { c.enqueue(ping); } catch { /* dropped */ } }
}, 15000);

log(`AGORA (${AGORA_MODE}) on 127.0.0.1:${PORT} — plane=${AGENTS.map((a) => a.model).join('/')}${NEBIUS_ONLY ? ' [Nebius-only]' : ''} apex=${VLLM_MODEL}${VLLM_BASE ? '@vLLM' : ' (NO vLLM env!)'}, token=${TOKEN ? 'ON' : 'off'}, cap=${MAX_CALLS_PER_HOUR}/h`);
