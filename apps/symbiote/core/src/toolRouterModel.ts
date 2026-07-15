// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * 24Z.61 — remote-model fallback for the tool router (server only). Used when the pure heuristic is unsure. The model is
 * asked to NAME one tool; its answer is validated through validateToolWord() against the allowlist enum, so it can never
 * "request" an unknown/arbitrary tool — at worst it collapses to 'talk'. It NEVER executes, applies, or bypasses AUMLOK.
 * The key is read via resolveApiKey, used only as a Bearer header, never logged or returned.
 */
import { resolveApiKey } from './fusionConfig';
import { validateToolWord, type ToolName } from './toolRouter';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = process.env.AUKORA_TOOLROUTER_MODEL || process.env.OPENROUTER_MODEL || 'anthropic/claude-opus-4.8';

const SYSTEM = [
  'You are a router. Classify the user message into EXACTLY ONE tool and reply with ONLY that single tool word.',
  'tools:',
  '- talk: general conversation, greetings, explanations, open questions',
  '- build: asking to create / change / edit / fix / refactor code or files',
  '- status: asking about current state / health / what happened',
  '- receipts: asking to see receipts / audit log / what was signed',
  '- undo: asking to undo / revert / roll back the last change',
  '- memory: asking what Aukora remembers, or about its memory / graph / topology',
  '- catastrophe: asking to test safety or trigger a deliberately dangerous (blocked) action',
  '- help: asking what you can do / your capabilities / commands',
  'Reply with one word only.',
].join('\n');

/** Ask the model to name a tool; validate against the enum (unknown → talk). Returns 'talk' on any error/no-key. */
export async function modelRouteTool(message: string): Promise<ToolName> {
  const keyResult = resolveApiKey();
  if (!keyResult) return 'talk';
  try {
    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${keyResult.key}` },
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: (message ?? '').slice(0, 500) }], max_tokens: 6, temperature: 0 }),
    });
    if (!resp.ok) return 'talk';
    const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
    return validateToolWord(data?.choices?.[0]?.message?.content);   // ← enum gate
  } catch { return 'talk'; }
}
