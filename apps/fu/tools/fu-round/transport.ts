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
const MAX_RESPONSE_BYTES = 262_144; // 256 KiB — a hostile/huge body is truncated, not parsed unbounded (V7)

/** V7: read a response body up to a byte cap, honoring the fetch AbortSignal (a slow/huge body cannot
 *  hang or exhaust memory — over-cap or a stream abort returns null → a non-vote). */
async function readBoundedJson(res: Response, maxBytes: number): Promise<unknown | null> {
  const reader = res.body?.getReader();
  if (!reader) { const t = await res.text(); return t.length > maxBytes ? null : safeParse(t); }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) { await reader.cancel(); return null; }
        chunks.push(value);
      }
    }
  } catch { return null; } // abort during body read (deadline) → non-vote
  const buf = new Uint8Array(total);
  let off = 0; for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  return safeParse(new TextDecoder().decode(buf));
}
function safeParse(t: string): unknown | null { try { return JSON.parse(t); } catch { return null; } }

/** Query the live catalogue ONCE; returns the set of served model ids, or null if the query failed. */
async function fetchAvailableModels(apiKey: string, signal: AbortSignal): Promise<Set<string> | null> {
  try {
    const res = await fetch(OPENROUTER_MODELS, { headers: { authorization: `Bearer ${apiKey}` }, signal });
    if (!res.ok) return null;
    const data = (await readBoundedJson(res, 4 * MAX_RESPONSE_BYTES)) as { data?: Array<{ id?: string }> } | null;
    if (!data) return null;
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
    // Worst-case cost for THIS paid call. Used as (a) the provider-missing cost fallback when a successful
    // response carries no `usage.cost`, and (b) the charge for an aborted/orphaned paid call — the provider
    // may have billed a request we could not measure, so we never undercount it (R24 accounting).
    const worstCaseUsd = (Math.max(seat.costPer1M, 0) * MAX_OUTPUT_TOKENS) / 1_000_000;
    try {
      const res = await fetch(OPENROUTER_CHAT, {
        method: 'POST', signal,
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: seat.slug, max_tokens: MAX_OUTPUT_TOKENS, temperature: 0.2,
          usage: { include: true },
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      // 429 / HTTP error are provider REJECTIONS (not billed) → cost 0; the attempt is already counted.
      if (res.status === 429) return record(meter, seat, { text: '', served: undefined, finishReason: 'rate_limited' });
      if (!res.ok) return record(meter, seat, { text: '', served: undefined, finishReason: `http_${res.status}` });
      const parsed = await readBoundedJson(res, MAX_RESPONSE_BYTES);
      // A response WAS received (likely billed) but is uninterpretable/over-cap → charge worst-case (V7 + billing).
      if (parsed === null) return record(meter, seat, { text: '', served: undefined, costUsd: worstCaseUsd, finishReason: 'body_cap_or_parse' });
      const data = parsed as {
        model?: string; choices?: Array<{ message?: { content?: string }; finish_reason?: string; native_finish_reason?: string }>;
        usage?: { completion_tokens?: number; cost?: number };
      };
      const text = data.choices?.[0]?.message?.content ?? '';
      // Never let a leaked key echo back into the artifact: scrub any secret-shaped response to empty.
      const safeText = textHasSecret(text) ? '' : text;
      const providerCost = typeof data.usage?.cost === 'number' ? data.usage.cost : undefined;
      return record(meter, seat, {
        text: safeText,
        served: typeof data.model === 'string' ? data.model : undefined,
        outputTokens: data.usage?.completion_tokens,
        costUsd: providerCost ?? worstCaseUsd, // provider-missing cost fallback (R24)
        finishReason: data.choices?.[0]?.finish_reason ?? data.choices?.[0]?.native_finish_reason,
      });
    } catch (e) {
      // Abort / network failure AFTER the request was sent → an ORPHANED paid call: the provider may have
      // billed it though we never measured a response. Charge worst-case, then rethrow so the council
      // records the timeout/error non-vote. paidCalls already counted this attempt.
      meter.costUsd.set(seat.id, (meter.costUsd.get(seat.id) ?? 0) + worstCaseUsd);
      throw e;
    }
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
