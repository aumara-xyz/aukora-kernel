// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * 24Z.61 — Natural-language tool router (PURE). Auma decides which governed tool a message wants from natural phrasing,
 * not brittle prefix keywords. The output is ALWAYS one of an allowlisted enum; an unknown/garbage suggestion (e.g. from
 * a model) collapses to 'talk'. The router NEVER executes anything — it only NAMES a tool; the client/server dispatches
 * to the existing governed handlers (which still enforce AUMLOK + risk + kernel). The enum IS the safety boundary.
 *
 * This module is pure (no key, no fetch, no node-only imports) so the client can route confident cases instantly; the
 * remote-model fallback for ambiguous cases lives in toolRouterModel.ts and validates through validateToolWord() here.
 */
export const TOOLS = ['talk', 'build', 'status', 'receipts', 'undo', 'memory', 'catastrophe', 'help'] as const;
export type ToolName = (typeof TOOLS)[number];

export function isTool(x: unknown): x is ToolName {
  return typeof x === 'string' && (TOOLS as readonly string[]).includes(x);
}

/** Validate a raw model/string suggestion against the allowlist enum. Anything not exactly/contained-as a known tool
 *  collapses to 'talk'. This is the gate that stops a model from "requesting" an unknown/arbitrary tool. */
export function validateToolWord(raw: unknown): ToolName {
  const s = (typeof raw === 'string' ? raw : '').toLowerCase().trim();
  if (isTool(s)) return s;
  // tolerate a one-word answer with punctuation/quotes; pick the first enum word that appears as a whole token.
  const tokens = s.split(/[^a-z]+/).filter(Boolean);
  for (const t of tokens) if (isTool(t)) return t;
  return 'talk';
}

export interface RouteDecision { tool: ToolName; confidence: number; reason: string }

/** Phrasing-aware heuristic router. Returns a valid tool + a confidence; the caller may consult the model when low. */
export function heuristicRoute(message: string): RouteDecision {
  const m = (message ?? '').toLowerCase().trim();
  if (!m) return { tool: 'talk', confidence: 0.6, reason: 'empty' };
  const has = (re: RegExp) => re.test(m);

  // specific tools first (most-specific phrasing wins)
  if (has(/exfiltrat/) || has(/\b(test safety|catastrophe|destructive delete|block a secret)\b/) || has(/\btry to (steal|leak|delete everything)\b/) || has(/\bsafety (test|check)\b/) || (has(/\bsafety\b/) && has(/\b(test|check|block|blocking|blocked|danger|catastroph)/)))
    return { tool: 'catastrophe', confidence: 0.95, reason: 'safety-test phrasing' };
  if (has(/\b(undo|revert|reverse|rollback)\b/) || has(/\broll ?back\b/) || has(/take (that|it) back/) || has(/\bunchange\b/))
    return { tool: 'undo', confidence: 0.9, reason: 'undo phrasing' };
  if (has(/\bhelp\b/) || has(/what can you (do|help)/) || has(/what (are you able|tools|are your)/) || has(/your capabilities|capabilities\b/) || has(/how do i (use|work)/) || has(/\bcommands?\b/))
    return { tool: 'help', confidence: 0.9, reason: 'help phrasing' };
  if (has(/\breceipts?\b/) || has(/audit (log|trail)/) || has(/what have you (signed|recorded)/) || has(/show.*(signed|audit)/))
    return { tool: 'receipts', confidence: 0.85, reason: 'receipts phrasing' };
  if (has(/\b(status|health)\b/) || has(/what(?:'s| is| has| are)?.{0,6}(happen|going on|the state|state of)/) || has(/are you (ok|up|working|running|alive)/) || has(/system (state|status)/))
    return { tool: 'status', confidence: 0.85, reason: 'status phrasing' };
  if (has(/\b(remember|memory|recall)\b/) || has(/what do you (know|remember)/) || has(/\b(graph|topology|clusters?)\b/) || has(/why (is|are|can'?t) (this|we|it|you)/))
    return { tool: 'memory', confidence: 0.8, reason: 'memory phrasing' };

  // build: a coding verb plus a code/file noun, or an imperative coding verb up front
  const buildVerb = /\b(create|build|add|change|edit|modify|make|implement|write|refactor|rename|update|fix|scaffold|generate|replace|wire up|set up|remove|delete)\b/;
  const codeNoun = /\b(component|file|function|page|button|class|module|test|endpoint|route|hook|style|css|feature|method|script|config|variable|import|interface|type|app|ui|panel|tab|card)\b/;
  const imperativeStart = /^\s*(create|build|add|change|edit|modify|make|implement|write|refactor|rename|update|fix|scaffold|generate|replace)\b/;
  if (has(buildVerb) && (has(codeNoun) || imperativeStart.test(m))) return { tool: 'build', confidence: 0.85, reason: 'build verb + code noun' };
  if (has(/\bcan you (create|build|add|change|make|implement|write|fix|refactor|edit)\b/)) return { tool: 'build', confidence: 0.7, reason: 'polite build request' };
  if (has(buildVerb)) return { tool: 'build', confidence: 0.5, reason: 'build verb only (ambiguous)' };

  return { tool: 'talk', confidence: 0.65, reason: 'conversational default' };
}

export const ROUTE_CONFIDENCE_THRESHOLD = 0.6;   // below this, consult the model fallback
