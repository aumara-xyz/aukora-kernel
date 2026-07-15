// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Transports for the Fu round controller. The council's injected `Transport` is the ONLY outside effect;
 * these implement the four honest modes:
 *  - live    : real OpenRouter calls (env-only key, availability-verified, NO silent substitution).
 *  - offline : contacts nothing → every seat is a `nonvote_no_provider` (also the live-without-key path).
 *  - synthetic: deterministic canned packets for tests — LABELED, never liveEligible.
 *  - replay  : replays recorded seat responses — LABELED, never liveEligible.
 *
 * A `TransportMeter` records, per seat, the served identity, ordered response digests, cost, whether a
 * provider was actually contacted, and the paid-call count. The controller reads it after the pass.
 */
import type { CouncilSeat, SeatResponse, Transport } from '../../src/aukoraFuCouncil';
import { sha256Hex, textHasSecret } from '../../src/evidence/index';

export interface TransportMeter {
  providerContacted: boolean;
  paidCalls: number;
  readonly served: Map<string, string | null>;    // seatId → last served identity (null = never contacted)
  readonly responseDigests: Map<string, string[]>; // seatId → ordered sha256 of raw response texts
  readonly costUsd: Map<string, number>;           // seatId → summed cost
}

export function newMeter(): TransportMeter {
  return { providerContacted: false, paidCalls: 0, served: new Map(), responseDigests: new Map(), costUsd: new Map() };
}

function record(meter: TransportMeter, seat: CouncilSeat, resp: SeatResponse): SeatResponse {
  meter.served.set(seat.id, resp.served ?? null);
  const digs = meter.responseDigests.get(seat.id) ?? [];
  digs.push(sha256Hex(new TextEncoder().encode(resp.text ?? '')));
  meter.responseDigests.set(seat.id, digs);
  meter.costUsd.set(seat.id, (meter.costUsd.get(seat.id) ?? 0) + (resp.costUsd ?? 0));
  return resp;
}

const OPENROUTER_CHAT = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODELS = 'https://openrouter.ai/api/v1/models';
const MAX_OUTPUT_TOKENS = 900;

/** Query the live catalogue ONCE; returns the set of served model ids, or null if the query failed. */
async function fetchAvailableModels(apiKey: string, signal: AbortSignal): Promise<Set<string> | null> {
  try {
    const res = await fetch(OPENROUTER_MODELS, { headers: { authorization: `Bearer ${apiKey}` }, signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    const ids = new Set<string>();
    for (const m of data.data ?? []) if (typeof m.id === 'string') ids.add(m.id);
    return ids.size ? ids : null;
  } catch { return null; }
}

/**
 * LIVE transport. `apiKey` comes from the environment at the CLI edge (never read/persisted here beyond
 * the Authorization header). If `apiKey` is null/empty, NOTHING is contacted and every seat is a
 * no-provider non-vote — the honest offline outcome, not a synthetic one.
 *
 * No silent substitution: we ask for `seat.slug`; the returned `served` is the provider's ACTUAL model
 * id verbatim. If a seat's model is absent from the availability catalogue we return an empty packet
 * (→ non-vote), never a swapped model. A 429 / truncation / throw all surface as the appropriate non-vote.
 */
export function liveOpenRouterTransport(apiKey: string | null, meter: TransportMeter): Transport {
  let availability: Set<string> | null | undefined; // undefined = not yet fetched
  return async (seat, prompt, _phase, signal): Promise<SeatResponse> => {
    if (!apiKey) return record(meter, seat, { text: '', served: undefined }); // offline: no provider
    if (availability === undefined) availability = await fetchAvailableModels(apiKey, signal);
    if (availability && !availability.has(seat.slug)) {
      // model unavailable on the live catalogue → non-vote (no substitution)
      return record(meter, seat, { text: '', served: undefined });
    }
    meter.providerContacted = true;
    meter.paidCalls += 1;
    const res = await fetch(OPENROUTER_CHAT, {
      method: 'POST', signal,
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: seat.slug, max_tokens: MAX_OUTPUT_TOKENS, temperature: 0.2,
        usage: { include: true },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (res.status === 429) return record(meter, seat, { text: '', served: undefined, finishReason: 'rate_limited' });
    if (!res.ok) return record(meter, seat, { text: '', served: undefined, finishReason: `http_${res.status}` });
    const data = (await res.json()) as {
      model?: string; choices?: Array<{ message?: { content?: string }; finish_reason?: string; native_finish_reason?: string }>;
      usage?: { completion_tokens?: number; cost?: number };
    };
    const text = data.choices?.[0]?.message?.content ?? '';
    // Never let a leaked key echo back into the artifact: scrub any secret-shaped response to empty.
    const safeText = textHasSecret(text) ? '' : text;
    return record(meter, seat, {
      text: safeText,
      served: typeof data.model === 'string' ? data.model : undefined,
      outputTokens: data.usage?.completion_tokens,
      costUsd: typeof data.usage?.cost === 'number' ? data.usage.cost : undefined,
      finishReason: data.choices?.[0]?.finish_reason ?? data.choices?.[0]?.native_finish_reason,
    });
  };
}

/** OFFLINE transport: contacts nothing; every seat is a no-provider non-vote. */
export function offlineTransport(meter: TransportMeter): Transport {
  return liveOpenRouterTransport(null, meter);
}

/**
 * SYNTHETIC-FIXTURE transport (tests only). Deterministic canned packets keyed by seatId. Provider is
 * NEVER marked contacted and paidCalls stays 0 — a synthetic artifact is structurally ineligible to
 * claim live review. `served` defaults to the seat slug so vote paths can be exercised.
 */
export function syntheticFixtureTransport(
  fixtures: Readonly<Record<string, Partial<SeatResponse> & { text: string }>>, meter: TransportMeter,
): Transport {
  return async (seat, _prompt, _phase, _signal): Promise<SeatResponse> => {
    const f = fixtures[seat.id];
    if (!f) return record(meter, seat, { text: '', served: undefined });
    return record(meter, seat, { served: seat.slug, ...f });
  };
}

/** REPLAY transport (recorded seat replies). Deterministic; never liveEligible (labeled by mode). */
export function replayTransport(
  recorded: Readonly<Record<string, SeatResponse>>, meter: TransportMeter,
): Transport {
  return async (seat, _prompt, _phase, _signal): Promise<SeatResponse> => {
    const r = recorded[seat.id];
    return record(meter, seat, r ?? { text: '', served: undefined });
  };
}
