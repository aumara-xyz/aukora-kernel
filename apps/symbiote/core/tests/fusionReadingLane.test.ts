// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Tests for the rewritten fusion reading lane (fusion-chat integration round, 2026-07-13):
 * the chat door's Fusion Council path now drives the hardened two-wave council
 * (core/src/aukoraFuCouncil.ts) through an injected transport. Everything here runs OFFLINE —
 * the fake transport returns canned packets keyed by slug+phase; the real orchestrator runs
 * underneath so the entries under test are the entries the owner actually sees.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  fusionReading, fusionCouncilNames, fusionCouncilDetail, resolveChatCouncil, chatQuorumRule,
  resolveDeadlineMs, resolveSeatDeadlineMs, resolveObservers,
  FUSION_COUNCIL_ID, FUSION_COUNCIL_NAME, KNOWN_CHAT_SEATS, CHAT_CLAIMS,
  type FusionReadingDeps, type SpendSession,
} from '../../spatial/fusionReadingLane';
import { VOICE_ROSTER, FUSION_VOICE_ID } from '../../spatial/voiceLane';
import {
  CANONICAL_SEATS, PACKET_OPEN, PACKET_CLOSE, SpendMeter, runAukoraFuCouncil,
  type Transport, type SeatResponse, type CouncilInput,
} from '../src/aukoraFuCouncil';

const KEY = { key: 'test-key-never-sent-anywhere' };

/** Build a well-formed, uniquely-tagged packet block (three chat claims → C1..C3). */
const pkt = (hyp = 'the answer holds'): string => [
  PACKET_OPEN,
  'STANCE:⊕ CONFIDENCE:↑ STRATEGY:↙ FRAMEWORK:statistical DIST:(explore=0.10,exploit=0.30,verify=0.50,abstain=0.10)',
  'CLAIMS:(C1=0.8,C2=0.7,C3=0.4)',
  `HYP:"${hyp}"`,
  PACKET_CLOSE,
].join('\n');

const SYNTH_TEXT = 'The council reads: the answer holds, with the stated caveat.';
const synth = (): SeatResponse => ({ text: `${SYNTH_TEXT}\nUSED_CLAIMS:(C1,C2)`, served: 'anthropic/claude-fable-5' });

/** Fake transport keyed `${slug}:${phase}` (or `${slug}:*`), defaulting to a valid identity-matched
 *  packet. Records every call so tests can assert what was (and was not) dispatched. */
function fakeTransport(script: Record<string, SeatResponse | 'throw'> = {}) {
  const calls: Array<{ slug: string; phase: string }> = [];
  const transport: Transport = async (seat, _prompt, phase) => {
    calls.push({ slug: seat.slug, phase });
    const r = script[`${seat.slug}:${phase}`] ?? script[`${seat.slug}:*`];
    if (r === 'throw') throw new Error('seat blew up');
    if (r) return r;
    if (phase === 'synthesis') return synth();
    return { text: pkt(), served: seat.slug, finishReason: 'stop' };
  };
  return { calls, transport };
}

function fakeSpendSession(over: Partial<SpendSession> = {}): SpendSession {
  return { spend: new SpendMeter(), dayToDateUsd: 0, recordActual: (usd) => usd, ...over };
}

function depsWith(transport: Transport, over: Partial<FusionReadingDeps> = {}): Partial<FusionReadingDeps> {
  return {
    resolveKey: () => KEY,
    makeTransport: () => transport,
    makeSpendSession: () => fakeSpendSession(),
    ...over,
  };
}

const ENV_KEYS = [
  'AUKORA_FUSION_MODELS', 'AUKORA_FUSION_ROUNDS', 'AUKORA_FUSION_DEADLINE_MS',
  'AUKORA_FUSION_SEAT_DEADLINE_MS', 'AUKORA_FUSION_OBSERVERS',
] as const;
const savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('fusionReadingLane — roster wiring (requested vs resolved)', () => {
  it('the voice roster carries the Fusion Council entry, ids agree', () => {
    expect(FUSION_COUNCIL_ID).toBe(FUSION_VOICE_ID);
    const entry = VOICE_ROSTER.find((m) => m.id === FUSION_COUNCIL_ID);
    expect(entry).toBeDefined();
    expect(entry?.name).toBe(FUSION_COUNCIL_NAME);
    // not a slug OpenRouter could ever resolve by accident
    expect(FUSION_COUNCIL_ID.includes('/')).toBe(false);
  });

  it('default requested roster is the eight canonical seats, in canon order', () => {
    expect(fusionCouncilNames()).toEqual([
      'Fable-5', 'Qwen-3.7', 'DeepSeek-V4', 'Kimi-K2.7', 'Mistral-Large', 'GPT-5.6-Sol', 'Gemini-3.5-Flash', 'Grok-4.5',
    ]);
    const res = resolveChatCouncil();
    expect(res.ok && res.source).toBe('default');
  });

  it('the live node\'s CURRENT env value still resolves (Fable + GLM stay selectable)', () => {
    process.env.AUKORA_FUSION_MODELS = 'anthropic/claude-fable-5,z-ai/glm-5.2';
    expect(fusionCouncilNames()).toEqual(['Fable-5', 'GLM-5.2']);
    const res = resolveChatCouncil();
    expect(res.ok && res.source).toBe('env-selected');
  });

  it('all-unknown AUKORA_FUSION_MODELS fails closed: empty names, refused detail', () => {
    process.env.AUKORA_FUSION_MODELS = 'not-a-real/model';
    expect(fusionCouncilNames()).toEqual([]);
    const detail = fusionCouncilDetail();
    expect(detail.source).toBe('refused');
    expect(detail.requested).toEqual([]);
    expect(detail.refusedReason).toMatch(/unknown slug/);
  });

  it('fusionCouncilDetail reports slugs, source, observers, and the protocol shape', () => {
    const detail = fusionCouncilDetail();
    expect(detail.requested).toHaveLength(8);
    expect(detail.requested[0]).toEqual({ slug: 'anthropic/claude-fable-5', name: 'Fable-5' });
    expect(detail.source).toBe('default');
    expect(detail.observers).toEqual([]); // observers are OFF unless configured
    expect(detail.protocol).toMatch(/advisory only/);
    process.env.AUKORA_FUSION_OBSERVERS = 'openrouter/fusion';
    expect(fusionCouncilDetail().observers).toEqual([{ slug: 'openrouter/fusion', name: 'OpenRouter Fusion' }]);
  });

  it('every KNOWN chat seat slug is unique and the extras never shadow a canonical seat', () => {
    const slugs = KNOWN_CHAT_SEATS.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).toContain('z-ai/glm-5.2');
    expect(slugs).toContain('meta-llama/llama-4-maverick');
  });

  it('chatQuorumRule is a strict majority of the requested roster, no mandatory seat', () => {
    expect(chatQuorumRule(CANONICAL_SEATS)).toEqual({ minVotes: 5, minFamilies: 5, requireSeatId: null });
    expect(chatQuorumRule(CANONICAL_SEATS.slice(0, 2))).toEqual({ minVotes: 2, minFamilies: 2, requireSeatId: null });
    expect(chatQuorumRule(CANONICAL_SEATS.slice(0, 3)).minVotes).toBe(2);
  });
});

describe('fusionReadingLane — fail-closed paths (no council, no network)', () => {
  it('empty question → one honest info entry, nothing dispatched', async () => {
    const { calls, transport } = fakeTransport();
    const entries = await fusionReading('   ', depsWith(transport));
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('info');
    expect(calls).toHaveLength(0);
  });

  it('no API key → honest info entry pointing at Settings, nothing dispatched', async () => {
    const { calls, transport } = fakeTransport();
    const entries = await fusionReading('what should we do?', depsWith(transport, { resolveKey: () => null }));
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('info');
    expect(entries[0].text).toMatch(/OpenRouter/);
    expect(entries[0].text).toMatch(/Settings/);
    expect(calls).toHaveLength(0);
  });

  it('all-unknown AUKORA_FUSION_MODELS → fail-closed error entry, nothing dispatched', async () => {
    process.env.AUKORA_FUSION_MODELS = 'not-a-real/model';
    const { calls, transport } = fakeTransport();
    const entries = await fusionReading('question', depsWith(transport));
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('error');
    expect(entries[0].text).toMatch(/fail-closed/);
    expect(calls).toHaveLength(0);
  });

  it('an unreadable spend ledger refuses the pass BEFORE any paid call (Codex spend ruling)', async () => {
    const { calls, transport } = fakeTransport();
    const entries = await fusionReading('question', depsWith(transport, {
      makeSpendSession: () => { throw new Error('corrupt ledger line (unparseable JSON) — failing closed'); },
    }));
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('error');
    expect(entries[0].text).toMatch(/spend ledger unavailable/);
    expect(calls).toHaveLength(0);
  });

  it('a spend-ceiling breach refuses fail-closed before any transport call', async () => {
    const { calls, transport } = fakeTransport();
    const entries = await fusionReading('question', depsWith(transport, {
      makeSpendSession: () => fakeSpendSession({ spend: new SpendMeter({ perPassUsd: 0.0001, perDayUsd: 10 }) }),
    }));
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('error');
    expect(entries[0].text).toMatch(/refused fail-closed before overspending/);
    expect(calls).toHaveLength(0);
  });
});

describe('fusionReadingLane — the reading (real orchestrator, fake transport)', () => {
  it('a full eight-seat pass renders requested roster, served ids, votes, quorum, synthesis, cost, advisory', async () => {
    const { transport } = fakeTransport();
    const entries = await fusionReading('is this safe?', depsWith(transport));

    // shape: [fusion meta note, the reading, voice header meta] — the last one is
    // what the chat UI folds into the bubble header, so it must name the council.
    expect(entries).toHaveLength(3);
    expect(entries[0].kind).toBe('tool_result');
    expect(entries[0].tool).toBe('fusion');
    expect(entries[0].text).toMatch(/8\/8 seats voted/);
    expect(entries[0].text).toMatch(/quorum met/);
    expect(entries[0].text).toMatch(/advisory only/);
    expect(entries[2].tool).toBe('voice');
    expect(entries[2].text).toMatch(new RegExp(`voice: ${FUSION_COUNCIL_NAME}`));
    expect(entries[2].text).toMatch(/never signs, applies, or authorizes/);

    const body = entries[1];
    expect(body.kind).toBe('info');
    expect(body.text).toMatch(/8 seats requested \(canonical roster\)/);
    expect(body.text).toMatch(/requested: Fable-5 · Qwen-3\.7 · DeepSeek-V4 · Kimi-K2\.7 · Mistral-Large · GPT-5\.6-Sol · Gemini-3\.5-Flash · Grok-4\.5/);
    expect(body.text).toMatch(/VOTED {2}served anthropic\/claude-fable-5/);
    expect(body.text).toMatch(/votes 8\/8 from 8 model families · quorum MET/);
    expect(body.text).toMatch(/council's synthesis/);
    expect(body.text).toContain(SYNTH_TEXT);
    expect(body.text).toMatch(/estimated ≤ \$/);
    expect(body.text).toMatch(/actual \$/);
    expect(body.text).toMatch(/advisory only — the council reads and recommends/);
    expect(body.text).not.toMatch(/observers \(non-voting/); // none configured
  });

  it('a SUBSTITUTED seat is an explicit non-vote with both identities shown; the council still reads', async () => {
    const { transport } = fakeTransport({
      'deepseek/deepseek-v4-pro:round1': { text: pkt(), served: 'openai/gpt-5.6-sol' },
      'deepseek/deepseek-v4-pro:round2': { text: pkt(), served: 'openai/gpt-5.6-sol' },
    });
    const entries = await fusionReading('question', depsWith(transport));
    const body = entries[1];
    expect(body.text).toMatch(/NON-VOTE \(SUBSTITUTED\)/);
    expect(body.text).toMatch(/served openai\/gpt-5\.6-sol ≠ requested deepseek\/deepseek-v4-pro/);
    expect(body.text).toMatch(/votes 7\/8/);
    expect(body.text).toMatch(/quorum MET/); // 7 ≥ majority 5
  });

  it('a TRUNCATED seat (non-stop finish, incomplete packet) is its own typed non-vote', async () => {
    const cut = pkt().slice(0, 60);
    const { transport } = fakeTransport({
      'google/gemini-3.5-flash:round1': { text: cut, served: 'google/gemini-3.5-flash', finishReason: 'length' },
      'google/gemini-3.5-flash:round2': { text: cut, served: 'google/gemini-3.5-flash', finishReason: 'length' },
    });
    const entries = await fusionReading('question', depsWith(transport));
    expect(entries[1].text).toMatch(/NON-VOTE \(TRUNCATED\)/);
    expect(entries[1].text).toMatch(/finish=length/);
  });

  it('an ERRORED seat (HTTP failure thrown by the transport) is a typed non-vote, never a whole-council failure', async () => {
    const { transport } = fakeTransport({ 'x-ai/grok-4.5:*': 'throw' });
    const entries = await fusionReading('question', depsWith(transport));
    expect(entries[1].text).toMatch(/NON-VOTE \(ERROR\)/);
    expect(entries[1].text).toMatch(/votes 7\/8/);
  });

  it('below majority quorum → honest partial result: seat table + diagnostic, NO authoritative synthesis', async () => {
    process.env.AUKORA_FUSION_MODELS = 'anthropic/claude-fable-5,z-ai/glm-5.2';
    const { transport } = fakeTransport({
      'z-ai/glm-5.2:round1': { text: '', served: 'z-ai/glm-5.2' },
      'z-ai/glm-5.2:round2': { text: '', served: 'z-ai/glm-5.2' },
    });
    const entries = await fusionReading('question', depsWith(transport));
    const body = entries[1];
    expect(body.text).toMatch(/2 seats requested \(selected by AUKORA_FUSION_MODELS\)/);
    expect(body.text).toMatch(/votes 1\/2/);
    expect(body.text).toMatch(/quorum NOT MET/);
    expect(body.text).toMatch(/no synthesis — quorum not met/);
    expect(body.text).toMatch(/insufficient quorum/);
    expect(entries[0].text).toMatch(/quorum NOT met/);
  });

  it('the two-seat env council CAN read when both vote (majority rule, honest source label)', async () => {
    process.env.AUKORA_FUSION_MODELS = 'anthropic/claude-fable-5,z-ai/glm-5.2';
    const { transport } = fakeTransport();
    const entries = await fusionReading('question', depsWith(transport));
    expect(entries[1].text).toMatch(/votes 2\/2 from 2 model families · quorum MET/);
    expect(entries[1].text).toContain(SYNTH_TEXT);
  });

  it('caps the question at the engine bound before any call', async () => {
    const seen: CouncilInput[] = [];
    const { transport } = fakeTransport();
    await fusionReading('x'.repeat(50_000), depsWith(transport, {
      runCouncil: (input, t, opts) => { seen.push(input); return runAukoraFuCouncil(input, t, opts); },
    }));
    expect(seen[0].problem.length).toBe(12_000);
    expect(seen[0].claims).toEqual(CHAT_CLAIMS);
  });

  it('AUKORA_FUSION_ROUNDS is retired: it does not multiply passes (exactly ONE council pass runs)', async () => {
    process.env.AUKORA_FUSION_ROUNDS = '4';
    let passes = 0;
    const { transport } = fakeTransport();
    await fusionReading('question', depsWith(transport, {
      runCouncil: (input, t, opts) => { passes++; return runAukoraFuCouncil(input, t, opts); },
    }));
    expect(passes).toBe(1);
  });

  it('a failed ledger APPEND after the pass is reported, not hidden (the reading still lands)', async () => {
    const { transport } = fakeTransport();
    const entries = await fusionReading('question', depsWith(transport, {
      makeSpendSession: () => fakeSpendSession({ recordActual: () => null }),
    }));
    expect(entries[1].text).toMatch(/could not be persisted to the spend ledger/);
  });
});

describe('fusionReadingLane — observers (non-voting, env-gated, OFF by default)', () => {
  it('no env → no observers resolved, no observer calls, no observer section', async () => {
    expect(resolveObservers()).toEqual([]);
    const { calls, transport } = fakeTransport();
    const entries = await fusionReading('question', depsWith(transport));
    expect(entries[1].text).not.toMatch(/observers/);
    expect(calls.some((c) => c.slug === 'openrouter/fusion' || c.slug === 'sakana/fugu-ultra')).toBe(false);
  });

  it('a configured observer is called once, shown non-voting with its served id VERBATIM, and never counts as a vote', async () => {
    process.env.AUKORA_FUSION_OBSERVERS = 'openrouter/fusion';
    const { calls, transport } = fakeTransport({
      // The router reports whatever model it actually routed to — recorded, not identity-rejected.
      'openrouter/fusion:round2': { text: pkt('router consensus view'), served: 'deepseek/deepseek-v4-pro' },
    });
    const entries = await fusionReading('question', depsWith(transport));
    const body = entries[1];
    expect(body.text).toMatch(/observers \(non-voting/);
    expect(body.text).toMatch(/OpenRouter Fusion/);
    expect(body.text).toMatch(/served deepseek\/deepseek-v4-pro/);
    expect(body.text).toMatch(/router consensus view/);
    expect(body.text).toMatch(/votes 8\/8/); // observer adds nothing to the vote count
    expect(calls.filter((c) => c.slug === 'openrouter/fusion')).toHaveLength(1);
  });

  it('an unknown observer name is UNAVAILABLE with the registered set named — never silently substituted, never called', async () => {
    process.env.AUKORA_FUSION_OBSERVERS = 'sakana/fugu';
    const { calls, transport } = fakeTransport();
    const entries = await fusionReading('question', depsWith(transport));
    expect(entries[1].text).toMatch(/UNAVAILABLE — not a registered observer/);
    expect(calls.filter((c) => c.slug === 'sakana/fugu')).toHaveLength(0);
  });

  it('a failing observer is an honest UNAVAILABLE line and never blocks the seats\' reading', async () => {
    process.env.AUKORA_FUSION_OBSERVERS = 'sakana/fugu-ultra';
    const { transport } = fakeTransport({ 'sakana/fugu-ultra:round2': 'throw' });
    const entries = await fusionReading('question', depsWith(transport));
    expect(entries[1].text).toMatch(/Fugu-Ultra/);
    expect(entries[1].text).toMatch(/UNAVAILABLE/);
    expect(entries[1].text).toContain(SYNTH_TEXT); // the reading itself is intact
  });
});

describe('fusionReadingLane — deadlines', () => {
  it('clamps AUKORA_FUSION_DEADLINE_MS to [10s, 1h], defaults inside the door socket window', () => {
    delete process.env.AUKORA_FUSION_DEADLINE_MS;
    expect(resolveDeadlineMs()).toBe(210_000);
    process.env.AUKORA_FUSION_DEADLINE_MS = '1';
    expect(resolveDeadlineMs()).toBe(10_000);
    process.env.AUKORA_FUSION_DEADLINE_MS = '99999999999';
    expect(resolveDeadlineMs()).toBe(3_600_000);
    process.env.AUKORA_FUSION_DEADLINE_MS = 'abc';
    expect(resolveDeadlineMs()).toBe(210_000);
  });

  it('clamps AUKORA_FUSION_SEAT_DEADLINE_MS to [5s, 240s], default 60s', () => {
    expect(resolveSeatDeadlineMs()).toBe(60_000);
    process.env.AUKORA_FUSION_SEAT_DEADLINE_MS = '1';
    expect(resolveSeatDeadlineMs()).toBe(5_000);
    process.env.AUKORA_FUSION_SEAT_DEADLINE_MS = '9999999';
    expect(resolveSeatDeadlineMs()).toBe(240_000);
  });

  it('a pass that outlives the lane deadline becomes an honest error naming the per-seat billing bound', async () => {
    vi.useFakeTimers();
    try {
      const { transport } = fakeTransport();
      const pending = fusionReading('question', depsWith(transport, {
        runCouncil: () => new Promise(() => { /* deliberates forever */ }),
      }));
      await vi.advanceTimersByTimeAsync(210_050);
      const entries = await pending;
      expect(entries).toHaveLength(1);
      expect(entries[0].kind).toBe('error');
      expect(entries[0].text).toMatch(/still deliberating/);
      expect(entries[0].text).toMatch(/seat deadline/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('fusionReadingLane — reviewer, never a hand (structural pins)', () => {
  const laneSrc = () => fs.readFileSync(path.join(__dirname, '..', '..', 'spatial', 'fusionReadingLane.ts'), 'utf-8');
  const doorSrc = () => fs.readFileSync(path.join(__dirname, '..', '..', 'spatial', 'chat-serve.ts'), 'utf-8');

  it('imports nothing from the signing/apply/memory-write lanes', () => {
    const src = laneSrc();
    for (const forbidden of ['nativeLiveApply', 'aumlok', 'kiraBrain', 'workbenchCommandLoop', 'memoryAppend']) {
      expect(src).not.toContain(`from '../core/src/${forbidden}`);
      expect(src).not.toContain(`from './${forbidden}`);
    }
    // and it never claims authority
    expect(src).toMatch(/never signs, applies, or authorizes/);
  });

  it('never calls English text latent glyphs: the lane names packets as transport representations', () => {
    expect(laneSrc()).toMatch(/transport\s+representations/);
    expect(laneSrc()).toMatch(/NOT raw model activations/);
  });

  it('the chat door routes the fusion-council id to fusionReading BEFORE the single-model voice path (dropdown route pin)', () => {
    const src = doorSrc();
    const fusionRoute = src.indexOf('reqModel === FUSION_COUNCIL_ID');
    const fusionCall = src.indexOf('await fusionReading(ownerText)');
    const voiceCall = src.indexOf('await voiceReply(ownerText');
    expect(fusionRoute).toBeGreaterThan(-1);
    expect(fusionCall).toBeGreaterThan(fusionRoute);
    expect(voiceCall).toBeGreaterThan(fusionCall); // ordinary chat path is untouched, and runs only when fusion was not selected
  });

  it('the door\'s /api/models serves both the honest names array and the detail object', () => {
    const src = doorSrc();
    expect(src).toContain('fusionCouncil: fusionCouncilNames()');
    expect(src).toContain('fusionCouncilDetail: fusionCouncilDetail()');
  });
});
