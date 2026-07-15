// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * 24Z.59 — the Host's conversational voice. Plain talk ("hello", "what can you do?", "explain X") gets a real reply
 * here; actual build/change requests still go to the OpenCode editor under the governed apply path. This makes the chat
 * WORK instead of shoving every message into the editor (which failed with empty_diff). It calls the same OpenRouter
 * provider OpenCode uses; the key is read via resolveApiKey, never logged, and any error detail is scrubbed.
 *
 * This is talk only — it applies nothing, writes nothing, mints no receipt, and grants no authority. Builds (which DO
 * touch the repo) remain on the OpenCode + AUMLOK + risk-tier + kernel-receipt path, unchanged.
 */
import { resolveApiKey } from './fusionConfig';
import { scrubSecrets } from './externalReview';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = process.env.AUKORA_HOST_CHAT_MODEL || process.env.OPENROUTER_MODEL || 'anthropic/claude-opus-4.8';

const SYSTEM = [
  'You are Auma, the voice of Aukora Host — a local, self-recursive coding environment (dev/lab).',
  'You wrap the OpenCode coding agent. When the user asks you to BUILD or CHANGE the project, that work is routed to',
  'OpenCode, which edits inside an isolated git worktree; Aukora governs it: the user\'s AUMLOK human key unlocks a dev',
  'session, low-risk changes apply, high-risk changes PAUSE (the agent has hands; Aukora owns the authority), every',
  'applied change gets a signed, verifiable Aukora Kernel receipt (ML-DSA-65, diff-bound), and everything is undoable.',
  'You can also recall Aukora\'s own memory.',
  'Speak concisely, warm, and technically honest. This is dev/lab — never claim production, sovereign, AGI, or that you',
  'can change anything safely. If the user wants to build something, tell them to phrase it as a concrete instruction',
  '(e.g. "create a small component" or "change the page title") and to unlock AUMLOK on the AUMLOK page so it can apply.',
  'Keep replies short unless asked for depth. Never reveal secrets, keys, or internal codenames.',
].join(' ');

export interface HostChatTurn { role: 'user' | 'assistant'; content: string }
export interface HostChatResult { ok: boolean; reply?: string; blocker?: string; model: string; detail?: string }

/** A real conversational reply from the Host's voice. Talk only — no apply, no receipt, no authority. */
export async function hostChat(message: string, history: HostChatTurn[] = []): Promise<HostChatResult> {
  const keyResult = resolveApiKey();
  if (!keyResult) return { ok: false, blocker: 'no_key', model: MODEL, detail: 'OpenRouter key not configured' };
  const trimmed = (message ?? '').toString().slice(0, 4000);
  if (!trimmed.trim()) return { ok: false, blocker: 'empty_message', model: MODEL };
  const msgs = [
    { role: 'system', content: SYSTEM },
    ...history.slice(-8).map((h) => ({ role: h.role, content: String(h.content ?? '').slice(0, 2000) })),
    { role: 'user', content: trimmed },
  ];
  try {
    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${keyResult.key}` },
      body: JSON.stringify({ model: MODEL, messages: msgs, max_tokens: 700, temperature: 0.6 }),
    });
    if (!resp.ok) return { ok: false, blocker: 'model_error', model: MODEL, detail: `http ${resp.status}` };
    const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
    const reply = data?.choices?.[0]?.message?.content;
    if (typeof reply !== 'string' || !reply.trim()) return { ok: false, blocker: 'empty_reply', model: MODEL };
    return { ok: true, reply: reply.trim(), model: MODEL };
  } catch (e) {
    return { ok: false, blocker: 'endpoint_unreachable', model: MODEL, detail: scrubSecrets(String((e as Error)?.message ?? e), [keyResult.key]).slice(0, 140) };
  }
}
