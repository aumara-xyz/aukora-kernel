// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Fusion reading lane — the chat door's bridge to the hardened Aukora Fu council
 * (core/src/aukoraFuCouncil.ts) for FREE-TEXT questions.
 *
 * The owner picks "Fusion Council" in the voice switcher and asks anything. The lane
 * resolves the ACTUALLY CONFIGURED council (the canonical eight-seat roster by default;
 * AUKORA_FUSION_MODELS selects a subset fail-closed), runs one two-wave deliberation with
 * every seat CONCURRENT inside each wave (the old engine path fired seats sequentially and
 * capped at 5 — both fixed by the replayed PR #352 orchestrator), and renders ONE honest
 * reading that shows: the requested roster, the provider-SERVED model id per seat, votes and
 * non-votes with typed reasons, disagreement/geometry, timing, estimated + provider-metered
 * actual cost, and the synthesis. Missing, unavailable, empty, truncated, or substituted
 * seats are recorded as NON-VOTES — the lane never fakes a full council and never silently
 * substitutes a model.
 *
 * The packets the seats exchange are structured, API-visible semantic projections — that is,
 * transport representations. They are NOT raw model activations, latent states, or
 * chain-of-thought, and no surface of this lane may describe them as such.
 *
 * HARD LINE (same as every fusion surface): the council READS; it never authorizes. Nothing
 * here signs, applies, writes memory, or touches the workbench — the lane returns chat
 * entries and nothing else. Every reading carries the advisory line.
 *
 * Spend is fail-closed end to end: the day-to-date total is seeded from the persistent
 * ledger (a corrupt/unreadable ledger REFUSES the pass rather than under-counting), the
 * SpendMeter reserves worst-case before every batch, provider-returned cost is preferred for
 * actuals, and the pass's actual spend is appended back to the ledger.
 *
 * RETIRED KNOB: AUKORA_FUSION_ROUNDS drove the old sequential engine loop and is ignored —
 * the deliberation protocol is now fixed at two causally ordered waves plus one synthesis
 * (waves cannot be traded for wall-clock without changing what a deliberation IS). The wire
 * deadline knob AUKORA_FUSION_DEADLINE_MS survives, plus AUKORA_FUSION_SEAT_DEADLINE_MS for
 * the per-seat abort.
 */
import {
  runAukoraFuCouncil, CANONICAL_SEATS, SpendMeter, SpendCeilingExceeded, DEFAULT_SPEND_LIMITS,
  round2Prompt, extractPacketBlock, isVote,
  type CouncilSeat, type CouncilInput, type CouncilOpts, type CouncilOutcome,
  type Transport, type SeatResponse, type QuorumRule, type SeatResult,
} from '../core/src/aukoraFuCouncil';
import { AukoraFuSpendLedger, LedgerError } from '../core/src/aukoraFuSpendLedger';
import { resolveApiKey, resolveFusionCouncil } from '../core/src/fusionConfig';
import type { ChatEntry } from './voiceLane';
import * as os from 'os';
import * as path from 'path';

// The voice-switcher id the door routes here instead of the single-model voice
// lane. Defined once, in the roster (voiceLane.ts) — re-exported so the door and
// tests read it from either side without drift.
export { FUSION_VOICE_ID as FUSION_COUNCIL_ID } from './voiceLane';
export const FUSION_COUNCIL_NAME = 'Fusion Council';

// Matches the engine's own MAX_PROBLEM_CHARS — the lane never sends more than
// the engine would read anyway.
const MAX_QUESTION_CHARS = 12_000;

// ── Roster resolution: the REQUESTED council ──────────────────────────────────────────────────
// Default = the eight canonical voting seats (FUSION_REACTOR.md roster, every slug verified against
// the live OpenRouter catalog 2026-07-13). AUKORA_FUSION_MODELS selects a subset FAIL-CLOSED from the
// known seats below — an all-unknown override refuses to run rather than falling back to a roster the
// owner didn't ask for. GLM-5.2 and Llama-4 stay selectable so existing node env values (the live
// door runs AUKORA_FUSION_MODELS=anthropic/claude-fable-5,z-ai/glm-5.2 today) keep resolving.
export const EXTRA_KNOWN_SEATS: readonly CouncilSeat[] = [
  { id: 'GLM', slug: 'z-ai/glm-5.2',                name: 'GLM-5.2', family: 'zhipu', framework: 'symbolic',  costPer1M: 0.8 },
  { id: 'LMA', slug: 'meta-llama/llama-4-maverick', name: 'Llama-4', family: 'meta',  framework: 'narrative', costPer1M: 0.5 },
];
export const KNOWN_CHAT_SEATS: readonly CouncilSeat[] = [...CANONICAL_SEATS, ...EXTRA_KNOWN_SEATS];

export type ChatCouncilResolution =
  | { ok: true; seats: readonly CouncilSeat[]; source: 'default' | 'env-selected' }
  | { ok: false; reason: string };

export function resolveChatCouncil(): ChatCouncilResolution {
  const res = resolveFusionCouncil(CANONICAL_SEATS, KNOWN_CHAT_SEATS);
  if (!res.ok) return { ok: false, reason: res.reason };
  return { ok: true, seats: res.council, source: res.source };
}

/** The RESOLVED roster's display names, for honest UI: the chat door's /api/models serves these so
 *  the deliberation animation shows the REQUESTED roster (which the reading then reconciles against
 *  served identities), never a client-side guess. Fail-closed resolution reads as an empty list. */
export function fusionCouncilNames(): string[] {
  const res = resolveChatCouncil();
  return res.ok ? res.seats.map((s) => s.name) : [];
}

/** Richer honest roster detail for /api/models: requested seats WITH slugs, where the roster came
 *  from, the configured non-voting observers, and the protocol shape. Read-only metadata. */
export function fusionCouncilDetail(): {
  requested: Array<{ slug: string; name: string }>;
  source: 'default' | 'env-selected' | 'refused';
  refusedReason?: string;
  observers: Array<{ slug: string; name: string }>;
  protocol: string;
} {
  const res = resolveChatCouncil();
  return {
    requested: res.ok ? res.seats.map((s) => ({ slug: s.slug, name: s.name })) : [],
    source: res.ok ? res.source : 'refused',
    ...(res.ok ? {} : { refusedReason: res.reason }),
    observers: resolveObservers().filter((o) => o.known).map((o) => ({ slug: o.slug, name: o.name })),
    protocol: 'two concurrent waves + one synthesis · advisory only',
  };
}

// ── Deterministic chat claim basis ────────────────────────────────────────────────────────────
// The council module scores seats against a FROZEN enumerated claim basis (H4/H8). A free-text chat
// question has no pre-extracted claims, so the lane freezes three DETERMINISTIC dimensions that are
// scoreable for any question — no extra model call, no moving basis. They are deliberately generic:
// the per-seat signed scores on them are what make cross-seat agreement/shear comparable.
export const CHAT_CLAIMS: readonly string[] = [
  'the question as asked has one well-supported answer',
  'the recommended answer rests on verifiable evidence or sound reasoning, not just shared priors',
  'there is a material risk, uncertainty, or counter-consideration the answer must state',
];

// ── Quorum for the chat surface ───────────────────────────────────────────────────────────────
// PR #352's default rule (≥6 votes from ≥6 families + verified Fable) is a GATE rule sized to the
// eight-seat code-review council. The chat roster may be env-narrowed to two seats, so the chat lane
// applies a majority-of-requested-roster rule instead: more than half the requested seats must
// produce valid, identity-verified packets, from as many distinct families as the roster allows.
// No named seat is mandatory (a Fable-less env selection must still be able to read); the outcome
// still reports fableVerified and the exact rule applied, so nothing is hidden. Below quorum the
// council returns an honest insufficient-quorum diagnostic instead of an authoritative synthesis.
export function chatQuorumRule(seats: readonly CouncilSeat[]): QuorumRule {
  const majority = Math.floor(seats.length / 2) + 1;
  const distinctFamilies = new Set(seats.map((s) => s.family)).size;
  return { minVotes: majority, minFamilies: Math.min(majority, distinctFamilies), requireSeatId: null };
}

// ── Deadlines ─────────────────────────────────────────────────────────────────────────────────
// The wire has a hard ceiling: the chat door's socket closes at idleTimeout 240s. The lane races the
// whole council pass against this deadline and turns "too slow" into an honest entry. Inside the
// pass, every seat call carries its OWN abort (perSeatDeadlineMs) — so even an abandoned pass cannot
// bill past one per-seat deadline per in-flight call.
const DEFAULT_DEADLINE_MS = 210_000; // inside the door's 240s window, with margin
export function resolveDeadlineMs(): number {
  const n = Math.floor(Number(process.env.AUKORA_FUSION_DEADLINE_MS || DEFAULT_DEADLINE_MS));
  if (!Number.isFinite(n)) return DEFAULT_DEADLINE_MS;
  return Math.min(3_600_000, Math.max(10_000, n));
}

const DEFAULT_SEAT_DEADLINE_MS = 60_000;
export function resolveSeatDeadlineMs(): number {
  const n = Math.floor(Number(process.env.AUKORA_FUSION_SEAT_DEADLINE_MS || DEFAULT_SEAT_DEADLINE_MS));
  if (!Number.isFinite(n)) return DEFAULT_SEAT_DEADLINE_MS;
  return Math.min(240_000, Math.max(5_000, n));
}

// ONE aligned token cap: the same number goes to the spend guard AND the provider request (the
// PR #352 runner's discipline — a guard that budgets fewer tokens than the wire allows is a leak).
const MAX_TOKENS_PER_CALL = 1_000;

// ── The real OpenRouter transport ─────────────────────────────────────────────────────────────
const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';

/** Build the injected transport: one abortable OpenRouter call per seat. Extracts the provider-SERVED
 *  model id, finish reason (for truncation honesty), and provider-metered cost. An HTTP error THROWS
 *  (→ nonvote_error with the status, never a repair attempt at a dead endpoint). Latencies are
 *  recorded per seat+phase into the caller's map for honest timing display. */
export function buildOpenRouterTransport(apiKey: string, latencies: Map<string, number>): Transport {
  return async (seat, prompt, phase, signal): Promise<SeatResponse> => {
    const t0 = Date.now();
    try {
      const resp = await fetch(OPENROUTER, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://aukora.xyz',
          'X-Title': 'aukora-fu-chat',
        },
        body: JSON.stringify({
          model: seat.slug,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.4,
          max_tokens: MAX_TOKENS_PER_CALL,     // aligned with the guard's maxTokensPerCall
          reasoning: { effort: 'low' },
          usage: { include: true },            // ask OpenRouter for the real cost
        }),
      });
      if (!resp.ok) throw new Error(`upstream ${resp.status}`);
      const data = (await resp.json()) as {
        model?: unknown;
        choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>;
        usage?: { completion_tokens?: unknown; cost?: unknown };
      };
      const choice = data.choices?.[0];
      return {
        text: typeof choice?.message?.content === 'string' ? choice.message.content : '',
        served: typeof data.model === 'string' ? data.model : undefined,
        finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined,
        outputTokens: typeof data.usage?.completion_tokens === 'number' ? data.usage.completion_tokens : undefined,
        costUsd: typeof data.usage?.cost === 'number' ? data.usage.cost : undefined,
      };
    } finally {
      latencies.set(`${seat.id}:${phase}`, Date.now() - t0);
    }
  };
}

// ── Non-voting observers (optional, env-gated, OFF by default) ────────────────────────────────
// AUKORA_FUSION_OBSERVERS names observers from the REGISTERED table only. Observers receive the
// wave-1 packet set and comment; they can never vote, satisfy quorum, or replace a seat. Both are
// themselves orchestrators that may internally reuse council models — their served identity is
// recorded verbatim (openrouter/fusion routes by design), and an unknown name is reported as
// unavailable, never silently swapped for something else.
export const OBSERVER_TABLE: Readonly<Record<string, string>> = {
  'sakana/fugu-ultra': 'Fugu-Ultra',
  'openrouter/fusion': 'OpenRouter Fusion',
};

export interface ObserverSpec { slug: string; name: string; known: boolean }
export function resolveObservers(): ObserverSpec[] {
  const raw = process.env.AUKORA_FUSION_OBSERVERS;
  if (!raw || !raw.trim()) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean).map((slug) => ({
    slug,
    name: OBSERVER_TABLE[slug] ?? slug,
    known: slug in OBSERVER_TABLE,
  }));
}

export interface ObserverNote {
  slug: string;
  name: string;
  status: 'observed' | 'observer_unavailable';
  served?: string;
  note: string;
}

/** One bounded, abortable observer call. Observers are NOT seats: identity mismatch does not
 *  invalidate them (their inner composition may be opaque) — the served id is simply recorded. */
async function runObserver(
  spec: ObserverSpec, question: string, outcome: CouncilOutcome, transport: Transport, deadlineMs: number,
): Promise<ObserverNote> {
  if (!spec.known) {
    return { slug: spec.slug, name: spec.name, status: 'observer_unavailable', note: `not a registered observer (known: ${Object.keys(OBSERVER_TABLE).join(', ')})` };
  }
  const obSeat: CouncilSeat = { id: `OBS:${spec.slug}`, slug: spec.slug, name: spec.name, family: 'observer', framework: 'social', costPer1M: 5.0 };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  try {
    const resp = await transport(obSeat, round2Prompt(obSeat, question, outcome.basis, outcome.round1.filter(isVote)), 'round2', controller.signal);
    if (!resp.text?.trim()) return { slug: spec.slug, name: spec.name, status: 'observer_unavailable', served: resp.served, note: 'empty reply' };
    const extracted = extractPacketBlock(resp.text);
    const note = extracted.ok ? `"${extracted.hyp}"` : `no packet (${extracted.reason}); reply began: "${resp.text.trim().slice(0, 160)}"`;
    return { slug: spec.slug, name: spec.name, status: 'observed', served: resp.served, note };
  } catch (e) {
    return { slug: spec.slug, name: spec.name, status: 'observer_unavailable', note: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

// ── Spend wiring (persistent day ledger + fail-closed meter) ──────────────────────────────────
export interface SpendSession {
  spend: SpendMeter;
  dayToDateUsd: number;
  /** Persist the pass's actual spend; returns the new day total, or null if persisting failed. */
  recordActual: (usd: number) => number | null;
}

function realSpendSession(): SpendSession {
  const home = process.env.AUKORA_SYMBIOTE_HOME || path.join(os.homedir(), '.aukora-symbiote');
  const ledger = new AukoraFuSpendLedger(home);
  const dayToDateUsd = ledger.todayTotalUsd(); // throws LedgerError on corruption → the pass fails closed
  return {
    spend: new SpendMeter(DEFAULT_SPEND_LIMITS, dayToDateUsd),
    dayToDateUsd,
    recordActual: (usd) => { try { return ledger.append(usd, 'fusion chat reading'); } catch { return null; } },
  };
}

// ── Injectable seams so tests never touch network or the real ledger ──────────────────────────
export type FusionReadingDeps = {
  resolveKey: () => { key: string } | null;
  makeTransport: (apiKey: string, latencies: Map<string, number>) => Transport;
  runCouncil: (input: CouncilInput, transport: Transport, opts: CouncilOpts) => Promise<CouncilOutcome>;
  makeSpendSession: () => SpendSession;
};
const REAL_DEPS: FusionReadingDeps = {
  resolveKey: () => resolveApiKey(),
  makeTransport: buildOpenRouterTransport,
  runCouncil: runAukoraFuCouncil,
  makeSpendSession: realSpendSession,
};

const ADVISORY_LINE = 'advisory only — the council reads and recommends; it never signs, applies, or authorizes.';

// ── Presentation ──────────────────────────────────────────────────────────────────────────────
const STANCE_WORDS: Record<string, string> = { '⊕': 'agree', '⊖': 'challenge', '⊙': 'neutral', '⊘': 'reject', '⊚': 'abstain' };
const MAX_ANSWER_CHARS = 4_000;

function seatLine(seats: readonly CouncilSeat[], r: SeatResult, latencies: Map<string, number>): string {
  const seat = seats.find((s) => s.id === r.seatId);
  const name = (seat?.name ?? r.seatId).padEnd(17);
  const lat = latencies.get(`${r.seatId}:round2`) ?? latencies.get(`${r.seatId}:round1`);
  const latStr = lat !== undefined ? ` · ${(lat / 1000).toFixed(1)}s` : '';
  if (isVote(r)) {
    const p = r.packet!;
    const stance = STANCE_WORDS[p.stance] ?? p.stance;
    return `  ${name} VOTED  served ${(r.served ?? '?').slice(0, 60)} · ${stance}${r.repaired ? ' · (after one format repair)' : ''}${latStr}`;
  }
  const kind = r.status.replace('nonvote_', '').toUpperCase();
  return `  ${name} NON-VOTE (${kind}) ${r.reason ? `— ${r.reason.slice(0, 140)}` : ''}${latStr}`;
}

function formatReading(
  outcome: CouncilOutcome, seats: readonly CouncilSeat[], source: 'default' | 'env-selected',
  latencies: Map<string, number>, elapsedMs: number, dayToDateUsd: number, dayTotalAfter: number | null,
  observers: ObserverNote[],
): string {
  const lines: string[] = [];
  const rosterNote = source === 'default' ? 'canonical roster' : 'selected by AUKORA_FUSION_MODELS';
  lines.push(`⚡ Fusion Council reading — ${seats.length} seats requested (${rosterNote}), two concurrent waves + synthesis`);
  lines.push(`requested: ${seats.map((s) => s.name).join(' · ')}`);
  lines.push('');
  lines.push('seats (wave-2 outcome — a vote requires a complete packet from the VERIFIED requested model):');
  for (const r of outcome.round2) lines.push(seatLine(seats, r, latencies));
  const q = outcome.quorumRule;
  lines.push('');
  lines.push(`votes ${outcome.votes.length}/${seats.length} from ${outcome.votingFamilies} model families · quorum ${outcome.quorumMet ? 'MET' : 'NOT MET'} `
    + `(rule: more than half the requested seats — ≥${q.minVotes} votes from ≥${q.minFamilies} families${q.requireSeatId ? ` + verified ${q.requireSeatId}` : ''})`
    + ` · Fable seat verified: ${outcome.fableVerified ? 'yes' : 'no'}`);

  if (outcome.votes.length >= 2) {
    lines.push('');
    lines.push('disagreement:');
    const stances = outcome.votes.map((v) => STANCE_WORDS[v.packet!.stance] ?? v.packet!.stance);
    const counts = new Map<string, number>();
    for (const s of stances) counts.set(s, (counts.get(s) ?? 0) + 1);
    lines.push(`  stances: ${[...counts.entries()].map(([s, n]) => `${s} ${n}`).join(' · ')}`);
    lines.push(`  geometry: ${outcome.geometry.reason} (coherence ${outcome.geometry.coherence.toFixed(2)}, shear ${outcome.geometry.shearMagnitude.toFixed(2)})`);
    if (outcome.geometry.suspect) lines.push('  ⚠ consensus WITHOUT an evidence anchor — reads like matched priors, not verification; weigh accordingly');
    if (outcome.neutralReplay.material) lines.push(`  ⚠ stance-dependence: coherence moves ${outcome.neutralReplay.drift.toFixed(2)} when stances are neutralized`);
  }

  if (observers.length) {
    lines.push('');
    lines.push('observers (non-voting — they enrich critique; they can never satisfy quorum or replace a seat):');
    for (const o of observers) {
      lines.push(`  ${o.name.padEnd(17)} ${o.status === 'observed' ? `served ${(o.served ?? 'composition_opaque').slice(0, 60)} · ${o.note}` : `UNAVAILABLE — ${o.note}`}`);
    }
  }

  lines.push('');
  const truncatedAnswer = outcome.answer.length > MAX_ANSWER_CHARS;
  const answerLabel = outcome.answerSource === 'synthesis'
    ? `council's synthesis (rendered once, English-last)`
    : outcome.answerSource === 'fallback-top-hyp'
      ? `top-weighted seat's own hypothesis (synthesis unavailable — this is the fallback, not a council render)`
      : 'no synthesis — quorum not met';
  lines.push(`${answerLabel}:`);
  lines.push(outcome.answer.slice(0, MAX_ANSWER_CHARS) + (truncatedAnswer ? '\n  [answer truncated for display]' : ''));
  lines.push('');
  const dayStr = dayTotalAfter !== null
    ? `day $${dayTotalAfter.toFixed(2)}/$${DEFAULT_SPEND_LIMITS.perDayUsd.toFixed(0)}`
    : `day-to-date was $${dayToDateUsd.toFixed(2)} (this pass could not be persisted to the spend ledger)`;
  lines.push(`timing ${(elapsedMs / 1000).toFixed(0)}s · estimated ≤ $${outcome.estimatedUsd.toFixed(2)} · actual $${outcome.actualUsd.toFixed(3)} (provider-metered where available) · ${dayStr}`);
  lines.push(ADVISORY_LINE);
  return lines.join('\n');
}

/**
 * Run one bounded council deliberation over one free-text question and return chat entries.
 * Never throws: every failure path returns an honest entry.
 */
export async function fusionReading(ownerText: string, deps: Partial<FusionReadingDeps> = {}): Promise<ChatEntry[]> {
  const d: FusionReadingDeps = { ...REAL_DEPS, ...deps };
  const question = (ownerText ?? '').trim().slice(0, MAX_QUESTION_CHARS);
  if (!question) {
    return [{ kind: 'info', text: 'The Fusion Council needs a question to read. Type what you want the council to deliberate on.' }];
  }

  const resolved = d.resolveKey();
  if (!resolved?.key) {
    return [{
      kind: 'info',
      text: 'The Fusion Council runs over OpenRouter and no API key is configured. Add your OpenRouter key in Settings, then ask again.',
    }];
  }

  const councilRes = resolveChatCouncil();
  if (!councilRes.ok) {
    return [{ kind: 'error', text: `Fusion council roster refused (fail-closed): ${councilRes.reason}` }];
  }
  const seats = councilRes.seats;

  let session: SpendSession;
  try {
    session = d.makeSpendSession();
  } catch (e) {
    // A corrupt/locked spend ledger fails the pass CLOSED — an unknown day total must never let a
    // paid pass slip past the day ceiling (Codex spend ruling, 2026-07-12).
    const msg = e instanceof LedgerError ? e.message : (e instanceof Error ? e.message : String(e));
    return [{ kind: 'error', text: `Fusion Council refused before any paid call: spend ledger unavailable (${msg}).` }];
  }

  const latencies = new Map<string, number>();
  const transport = d.makeTransport(resolved.key, latencies);
  const t0 = Date.now();
  const laneDeadlineMs = resolveDeadlineMs();
  const seatDeadlineMs = resolveSeatDeadlineMs();

  let outcome: CouncilOutcome;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    outcome = await Promise.race([
      d.runCouncil(
        { problem: question, claims: CHAT_CLAIMS },
        transport,
        { seats, spend: session.spend, quorum: chatQuorumRule(seats), maxTokensPerCall: MAX_TOKENS_PER_CALL, perSeatDeadlineMs: seatDeadlineMs },
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(
          `the council was still deliberating at ${Math.round((Date.now() - t0) / 1000)}s — the reading was abandoned so this reply can reach you `
          + `(each in-flight call still aborts at its own ${Math.round(seatDeadlineMs / 1000)}s seat deadline, so background billing is bounded)`,
        )), laneDeadlineMs);
      }),
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof SpendCeilingExceeded) {
      return [{ kind: 'error', text: `Fusion Council refused fail-closed before overspending: ${msg}` }];
    }
    return [{ kind: 'error', text: `Fusion Council reading failed: ${msg}` }];
  } finally {
    clearTimeout(timer);
  }

  // Optional non-voting observers, only where configured (default: none), concurrent like any wave.
  // A failed observer is an honest UNAVAILABLE line, never a blocker for the seats' reading and never
  // a silent substitute. runObserver never rejects, so no allSettled dance is needed.
  const observers: ObserverNote[] = await Promise.all(
    resolveObservers().map((spec) => runObserver(spec, question, outcome, transport, seatDeadlineMs)),
  );

  const dayTotalAfter = session.recordActual(outcome.actualUsd);
  const elapsedMs = Date.now() - t0;
  const body = formatReading(outcome, seats, councilRes.source, latencies, elapsedMs, session.dayToDateUsd, dayTotalAfter, observers);

  return [
    {
      kind: 'tool_result',
      tool: 'fusion',
      text: `fusion: ${outcome.votes.length}/${seats.length} seats voted · quorum ${outcome.quorumMet ? 'met' : 'NOT met'} · ${Math.round(elapsedMs / 1000)}s · actual $${outcome.actualUsd.toFixed(3)} · ${ADVISORY_LINE}`,
    },
    { kind: 'info', text: body },
    // Same shape the voice lane emits — the chat UI folds this into the reply
    // header, so the bubble is honestly labeled "Fusion Council".
    { kind: 'tool_result', tool: 'voice', text: `voice: ${FUSION_COUNCIL_NAME} · ${ADVISORY_LINE}` },
  ];
}
