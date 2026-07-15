// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * 24Z.43 — REAL-MODEL PROPOSER (edge-node). A real model (OpenRouter) proposes ONE bounded UI-theme change as
 * STRUCTURED INTENT only: { target:'wombPortalAccent', value:<allowlisted color>, rationale }. The model has NO
 * authority — it cannot return code, a file path, or a shell command, and even its color is re-validated against a
 * hardcoded allowlist here. The Aukora Kernel still holds the pen (the durable receipt path records the effect). If
 * no key / endpoint unreachable / bad output → an exact blocker is returned (never a fabricated "real model" label).
 *
 * Kept in edge-node (NOT the tauri shell): the OpenRouter wiring lives where the key lives + the shell src-scanner
 * forbids model wiring. Reuses externalReview's key resolution + endpoint allowlist + secret scrubbing.
 */
import { resolveApiKey } from './fusionConfig';
import { ALLOWED_ENDPOINTS, scrubSecrets, collectEnvSecrets } from './externalReview';

// Mirror of tauri-womb/src/lib/livePatchSpec NAMED_COLORS — the ONLY values a proposal may carry (defense in depth;
// the OS middleware re-validates via validateLivePatch). The model is constrained to choose from exactly these.
export const PROPOSER_COLORS = [
  'green', 'blue', 'purple', 'red', 'teal', 'gold', 'amber', 'cyan', 'magenta',
  'orange', 'pink', 'violet', 'indigo', 'lime', 'aqua', 'crimson', 'white',
];

export interface ThemeProposal {
  ok: boolean;
  source: 'openrouter_model' | 'none';
  model?: string;
  target?: 'wombPortalAccent';
  value?: string;
  rationale?: string;
  blocker?: 'no_key' | 'endpoint_unreachable' | 'model_invalid_proposal' | 'model_error' | 'bad_request';
  detail?: string;
}

const SYSTEM_PROMPT = [
  'You are a UI-THEME PROPOSER for Aukora OS. You have NO authority and NO ability to act — you only PROPOSE.',
  'The user wants to recolor the "Womb Portal" accent. Choose EXACTLY ONE color from this allowlist:',
  PROPOSER_COLORS.join(', ') + '.',
  'Return ONLY a raw JSON object, no markdown, no prose, matching exactly:',
  '{"target":"wombPortalAccent","value":"<one allowlisted color, lowercase>","rationale":"<one short clause, <=14 words>"}',
  'You MUST NOT output code, file paths, shell commands, URLs, or any field other than target/value/rationale.',
  'If the request is unclear, pick the closest sensible allowlisted color.',
].join(' ');

/** Ask a real model (OpenRouter) for ONE structured theme proposal. Validates the output against the allowlist. */
export async function proposeThemeChange(request: string, opts?: { modelSlug?: string; endpointOverride?: string; testMode?: boolean }): Promise<ThemeProposal> {
  const req = (typeof request === 'string' ? request : '').trim();
  if (!req || req.length > 2000) return { ok: false, source: 'none', blocker: 'bad_request' };

  const keyResult = resolveApiKey();
  if (!keyResult) return { ok: false, source: 'none', blocker: 'no_key', detail: 'OPENROUTER_API_KEY not resolvable' };

  const modelSlug = opts?.modelSlug ?? process.env.OPENROUTER_PROPOSER_MODEL ?? 'anthropic/claude-opus-4.8';
  const url = (opts?.testMode && opts?.endpointOverride) ? opts.endpointOverride : 'https://openrouter.ai/api/v1/chat/completions';
  if (!opts?.testMode && !ALLOWED_ENDPOINTS.includes(url)) return { ok: false, source: 'none', blocker: 'endpoint_unreachable', detail: 'endpoint not allowlisted' };

  const secrets = [...collectEnvSecrets(), keyResult.key];
  const userContent = scrubSecrets(req, secrets).slice(0, 2000);

  let parsed: Record<string, unknown> | null = null;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${keyResult.key}` },
      body: JSON.stringify({
        model: modelSlug,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userContent }],
        max_tokens: 200,
        response_format: { type: 'json_object' },
      }),
    });
    if (!resp.ok) return { ok: false, source: 'none', blocker: 'model_error', model: modelSlug, detail: `http ${resp.status}` };
    const json: any = await resp.json();
    const content = json?.choices?.[0]?.message?.content;
    parsed = typeof content === 'string' ? JSON.parse(content.replace(/^```(json)?|```$/g, '').trim()) : null;
  } catch (e) {
    return { ok: false, source: 'none', blocker: 'endpoint_unreachable', model: modelSlug, detail: String((e as Error)?.message ?? e).slice(0, 120) };
  }

  // Re-validate the model's output — it cannot escape the allowlist, and only target/value/rationale survive.
  const target = parsed?.target;
  const value = typeof parsed?.value === 'string' ? parsed.value.toLowerCase().trim() : '';
  const rationale = typeof parsed?.rationale === 'string' ? parsed.rationale.slice(0, 120) : '';
  if (target !== 'wombPortalAccent' || !PROPOSER_COLORS.includes(value)) {
    return { ok: false, source: 'none', blocker: 'model_invalid_proposal', model: modelSlug, detail: `target=${String(target)} value=${value}` };
  }
  return { ok: true, source: 'openrouter_model', model: modelSlug, target: 'wombPortalAccent', value, rationale };
}
