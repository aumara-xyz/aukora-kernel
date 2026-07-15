// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Pure rendering of a voice completion's `finish_reason` into what the user sees. Extracted from
 * voiceLane so it is unit-testable without a live model call.
 *
 * The bug this fixes: OpenRouter/Anthropic can return `finish_reason: 'content_filter'` — the
 * provider's OUTPUT filter cut the generation. It comes back either as PARTIAL text (a few words
 * then stop) or EMPTY. The voice lane only handled `'length'`, so a filtered reply displayed as a
 * bare fragment with no explanation ("The whole-repo"), and an EMPTY filter block threw
 * "voice model returned no text" — which surfaced as the misleading "voice model isn't reachable"
 * Kira fallback. Neither is honest: the model IS reachable and the key IS fine; the provider
 * filtered the content (it trips most often on security/exploit detail the read tools pull in).
 */

export const TOKEN_CAP_MARKER =
  '\n\n⚠ [reply still hit the token cap after automatic continuation — ask for a narrower slice if you want the rest]';

export const CONTENT_FILTER_PARTIAL_MARKER =
  '\n\n⚠ [the model provider’s content filter cut this reply short — this is not the whole thought. ' +
  'It usually trips on security/exploit detail; ask me for a narrower piece and I’ll continue.]';

export const CONTENT_FILTER_EMPTY_NOTICE =
  'My reply was stopped by the model provider’s content filter before I could get a word out — the ' +
  'chat and the key are both fine. The topic (often security/exploit detail, like the gate self-unlock ' +
  'write-up in the inbox) tripped the provider’s OUTPUT filter. Ask me about a narrower part and it’ll come through.';

export interface VoiceFinishRender {
  /** Text to show, WITH any marker appended. `null` means there is no text — use the empty handling. */
  displayText: string | null;
  /** The trimmed RAW model text (no marker) — what gets replayed to the model as history. Empty when null. */
  raw: string;
  /** True only when the empty response was specifically a content-filter block (not a generic empty). */
  emptyContentFiltered: boolean;
  /** The honest standalone notice to show for an empty content-filter block. */
  emptyContentFilterNotice?: string;
  /** Optional transparency diagnostic line (rendered as a voice tool_result). */
  diagnostic?: string;
}

/**
 * Decide how a finished completion should be presented. Pure: no I/O, no model call.
 * - normal (`stop`)            → show the text.
 * - `length` (token cap)       → show text + an honest "still capped" marker + diagnostic.
 * - `content_filter` + text    → show the PARTIAL text + an honest "cut short" marker + diagnostic.
 * - `content_filter` + empty   → no text; caller shows `emptyContentFilterNotice` (never "unreachable").
 * - empty, any other reason    → no text; caller decides (Auma route notice, or throw for recovery).
 */
export function renderVoiceFinish(
  rawText: string | undefined,
  finishReason: string | undefined,
  maxTokens: number,
): VoiceFinishRender {
  const text = (rawText ?? '').trim();
  const filtered = finishReason === 'content_filter';
  const lengthCapped = finishReason === 'length';

  if (!text) {
    if (filtered) {
      return { displayText: null, raw: '', emptyContentFiltered: true, emptyContentFilterNotice: CONTENT_FILTER_EMPTY_NOTICE };
    }
    return { displayText: null, raw: '', emptyContentFiltered: false };
  }
  if (lengthCapped) {
    return { displayText: text + TOKEN_CAP_MARKER, raw: text, emptyContentFiltered: false, diagnostic: `truncated: finish_reason=length at max_tokens=${maxTokens}` };
  }
  if (filtered) {
    return { displayText: text + CONTENT_FILTER_PARTIAL_MARKER, raw: text, emptyContentFiltered: false, diagnostic: 'partial: finish_reason=content_filter (provider output filter cut the reply)' };
  }
  return { displayText: text, raw: text, emptyContentFiltered: false };
}
