// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * The first real, autonomous, tool-calling coding agent native to this repo — not an external agent
 * (OpenCode, Hermes) wrapped and gated, but Aukora's own closed 10-tool contract (ideToolContract.ts)
 * driven by a real LLM via real OpenRouter function-calling.
 *
 * Scope, deliberately narrow: the model only ever sees 6 of the 10 tools —
 * status / self_map / list_files / read_file / search (pure exploration, already bounded/advisory) and
 * propose_patch (drafts a change; writes nothing, only classifies + hashes). The model explores the
 * repo however it wants, then calls propose_patch exactly once to submit its final answer — THAT call's
 * `files` argument, proposalHash, and the model id that produced them are returned to the CALLER (today:
 * workbenchCommandLoop.ts's "agent:" and "run:" commands) as a candidate. This module never calls
 * sandbox_apply/run_tests/write_receipt/rollback_sandbox itself, and never exposes them to the model —
 * the caller drives that sequence itself, via the same OWNER-typed command handlers used for a
 * manually-authored "propose patch", through dispatchIdeToolWithState (nativeIdeDispatcher.ts's single
 * chokepoint) — NOT via sandboxEngineBridge.ts's runSandboxEngine(), which is a separate pipeline used
 * by the unrelated LocalPlannerEngine/OpenCodeSandboxEngine callers and is never invoked from this file.
 *
 * Every dispatched tool call goes through dispatchIdeToolWithState — the SAME single chokepoint every
 * other caller in this repo uses. The model can only ever do what that dispatcher already allows: no
 * live write, no subprocess, no network, no signing-key import (see nativeIdeDispatcher.ts's own header
 * for the full list of structural guarantees). This module adds no new authority surface — it is a real
 * caller of already-advisory-only machinery, nothing more.
 */
import { dispatchIdeToolWithState } from './nativeIdeDispatcher';
import type { IdeToolName, IdeToolResult } from './ideToolContract';
import { resolveApiKey, resolveAgentModel } from './fusionConfig';
import type { SandboxPatchFile } from './sandboxApply';
import { reconstructProposalFiles, proposalAuthoringForm, type RawProposalFile } from './proposalDiffReconstruct';

const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';
// Round cap: 8 was calibrated when read_file had a single fixed window. Paged reads changed the
// arithmetic — honestly reading a 30KB file now costs ~4 rounds BEFORE any searching or proposing,
// and a live run (deepseek-v4-pro on spatial/app/style.css, 2026-07-07) paged the whole file
// correctly and then hit max_rounds with zero rounds left to propose in. Raised so paging + a
// proposal fit; env-overridable like the token cap; still hard-bounded (a runaway loop stays
// impossible). Changes NO gate/apply/authority behavior — exploration only ever drafts.
const DEFAULT_MAX_ROUNDS = 14;
function maxRoundsFromEnv(): number {
  const n = Number(process.env.AUKORA_AGENT_MAX_ROUNDS);
  return Number.isInteger(n) && n >= 1 && n <= 30 ? n : DEFAULT_MAX_ROUNDS;
}
const DEFAULT_BUDGET = 1.0; // dollars — same order of magnitude as the aukora-fu engine's per-run budget
// The per-call output cap. The old value (1500) was fine for exploration turns (read_file args are tiny)
// but far too small once the agent's FINAL answer is a propose_patch carrying whole FILE CONTENTS: a
// 700-line file is ~7-8k tokens, so 1500 truncated the tool call mid-file — every model either emitted a
// cut-off file (caught downstream by the real typecheck + the #91 file-shrink guard) or failed to emit a
// valid call at all. Proven live 2026-07-05 across 5 models on core/src/kiraBrain.ts (734 lines). Raised so
// a legitimate full-file patch fits; env-overridable. This changes NO gate/apply/authority behavior — the
// agent still only DRAFTS, and every downstream guard + the owner signature are unchanged.
const DEFAULT_AGENT_MAX_TOKENS = 16000;
function agentMaxTokens(): number {
  const n = Number(process.env.AUKORA_AGENT_MAX_TOKENS);
  return Number.isInteger(n) && n >= 256 && n <= 64000 ? n : DEFAULT_AGENT_MAX_TOKENS;
}

// Only the exploration + propose tools are ever exposed to the model. sandbox_apply/run_tests/
// write_receipt/rollback_sandbox are NOT in this list — the caller drives them after this loop hands
// off a candidate, never by the model directly.
const EXPOSED_TOOLS: readonly IdeToolName[] = ['status', 'self_map', 'list_files', 'read_file', 'search', 'propose_patch'];

function toolSchemas(): Array<{ type: 'function'; function: { name: string; description: string; parameters: object } }> {
  const schemas: Record<string, { description: string; parameters: object }> = {
    status: { description: 'Read the organism\'s own status (organ count, AUMLOK mode, live-promotion state). No arguments.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
    self_map: { description: 'Read a summary of the organism\'s own registered organs. No arguments.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
    list_files: { description: 'List files in a repo-relative directory.', parameters: { type: 'object', properties: { dir: { type: 'string', description: 'Repo-relative directory path, e.g. "core/src"' } }, required: ['dir'], additionalProperties: false } },
    read_file: { description: 'Read a repo-relative file\'s content (one bounded 8000-char window per call; sensitive/secret-shaped paths are refused). If the result says truncated:true, call it again with `offset` (the result echoes offset and totalLength) to page through the rest — ALWAYS read the region you intend to edit before proposing.', parameters: { type: 'object', properties: { relPath: { type: 'string', description: 'Repo-relative file path, e.g. "core/src/index.ts"' }, offset: { type: 'integer', minimum: 0, description: 'Optional CHARACTER offset to start the window at (default 0) — NOT a line number. To reach line N from a search hit, page forward window by window (offset 0, 8000, 16000, …) until the region is in view.' } }, required: ['relPath'], additionalProperties: false } },
    search: { description: 'Search repo text files for a query string (bounded results).', parameters: { type: 'object', properties: { query: { type: 'string', minLength: 2 }, dir: { type: 'string', description: 'Optional repo-relative directory to scope the search to; defaults to the whole repo.' } }, required: ['query'], additionalProperties: false } },
    propose_patch: {
      description: 'Submit your final proposed change. Call this EXACTLY ONCE, when you are done exploring and ready to answer. This does not write anything live — it only drafts and hashes the proposal for gated review.',
      parameters: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: 'One-sentence description of what this change does.' },
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                relPath: { type: 'string', description: 'repo-relative path' },
                content: { type: 'string', description: 'the full new content of the file (use for NEW or small files)' },
                edits: {
                  type: 'array',
                  description: 'PREFERRED for editing existing files (large or small): search/replace blocks. Each find must be an EXACT snippet copied from the current file that occurs exactly once (include enough surrounding lines to be unique); replace is what it becomes. No line numbers to count — this is the reliable way to edit.',
                  items: { type: 'object', properties: { find: { type: 'string' }, replace: { type: 'string' } }, required: ['find', 'replace'], additionalProperties: false },
                },
                diff: { type: 'string', description: 'a unified diff against the file\'s CURRENT content (also supported, but harder to author correctly than edits).' },
              },
              required: ['relPath'],
              additionalProperties: false,
            },
            description: 'The files you are changing. Each carries EXACTLY ONE of: content (whole file) · edits (search/replace blocks — best for editing existing files) · diff (unified diff).',
          },
        },
        required: ['goal', 'files'],
        additionalProperties: false,
      },
    },
  };
  return EXPOSED_TOOLS.map((name) => ({ type: 'function' as const, function: { name, description: schemas[name].description, parameters: schemas[name].parameters } }));
}

const SYSTEM_PROMPT = [
  'You are Aukora\'s own native coding agent, operating through its closed 10-tool contract.',
  'You may explore the repository with status/self_map/list_files/read_file/search.',
  'When you are ready to answer, call propose_patch EXACTLY ONCE with your complete proposed change.',
  'For each file, choose ONE authoring form. To EDIT an existing file (large or small), PREFER `edits`:',
  'search/replace blocks where each `find` is an exact snippet you copied verbatim from the file (read it',
  'first) that appears exactly once — include enough surrounding lines to be unique — and `replace` is what',
  'it becomes. This is the reliable way to edit: no line numbers to count. Use `content` only for a NEW or',
  'small whole file. (`diff`, a unified diff, is also accepted but harder to get right.) A find that is not',
  'present verbatim, or matches more than once, is refused — copy it exactly from the real file.',
  'propose_patch does not write anything live — it only drafts a hashed, classified proposal for a',
  'separate, already-governed gated review (sandbox test, Fusion Council review, human AUMLOK signature)',
  'before anything could ever reach the live repository. You are never authorized to apply anything',
  'yourself; your only job is to explore and propose.',
].join(' ');

export interface ToolCallLogEntry {
  round: number;
  tool: IdeToolName;
  args: Record<string, unknown>;
  ok: boolean;
  reason?: string;
}

export type NativeAgentStopReason = 'proposed_patch' | 'max_rounds_no_patch' | 'no_tool_calls' | 'model_error' | 'budget_exceeded';

export interface NativeAgentRunResult {
  goal: string;
  rounds: number;
  toolCalls: ToolCallLogEntry[];
  proposedGoal: string | null;
  candidateFiles: SandboxPatchFile[] | null;
  // Round 2 (issue #22): retained from the propose_patch dispatch instead of discarded — the caller
  // needs this SAME hash (not a re-derived one) to hand off to sandbox_apply/write_receipt without a
  // confused-deputy risk of the two ever drifting apart. Non-null iff stoppedReason === 'proposed_patch'.
  proposalHash: string | null;
  stoppedReason: NativeAgentStopReason;
  advisoryOnly: true;
  grantsAuthority: false;
  // Round 5 (issue #25): the model id resolveAgentModel() actually resolved for this run, so a report
  // (workbenchRunReport.ts) can disclose which model produced a proposal instead of leaving it implicit.
  model: string;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

/** Never throws: a raw network failure (DNS, connection reset, timeout) or a 200-OK response with a
 *  malformed/non-JSON body both degrade to the SAME { message: null } shape as an explicit HTTP error
 *  status, so the caller's loop always gets a clean 'model_error' stop reason instead of an unhandled
 *  rejection propagating out of runNativeAgent. (Adversarial review finding, fixed before first commit:
 *  the only try/catch previously in this file was the JSON.parse for tool-call arguments — the network
 *  call itself had no equivalent guard.) */
async function callModel(apiKey: string, model: string, messages: ChatMessage[]): Promise<{ message: ChatMessage | null; costEstimate: number }> {
  let resp: Response;
  try {
    resp = await fetch(OPENROUTER, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://aukora.xyz',
        'X-Title': 'aukora-native-agent',
      },
      body: JSON.stringify({
        model,
        messages,
        tools: toolSchemas(),
        temperature: 0.2,
        max_tokens: agentMaxTokens(), // large enough for a full-file propose_patch (see DEFAULT_AGENT_MAX_TOKENS)
      }),
    });
  } catch {
    return { message: null, costEstimate: 0 }; // network-level throw (DNS/timeout/reset) — fail closed
  }
  if (!resp.ok) return { message: null, costEstimate: 0 };
  let data: any;
  try {
    data = await resp.json();
  } catch {
    return { message: null, costEstimate: 0 }; // malformed/non-JSON 200 body — fail closed, never throw
  }
  const msg = data.choices?.[0]?.message ?? null;
  // Rough token-based cost estimate — same order-of-magnitude heuristic the aukora-fu engine uses, not a
  // billing-accurate figure (real cost accounting belongs to the API provider, not this module).
  const promptChars = messages.reduce((s, m) => s + (m.content?.length ?? 0), 0);
  const costEstimate = (promptChars + 1500) / 4 / 1e6 * 1.0;
  return { message: msg, costEstimate };
}

// Issue #30 (Round 6 QA): two real live agent: runs through the chat door (default model
// moonshotai/kimi-k2.7-code) both halted with stoppedReason=no_tool_calls at round 4 of the default
// 8 — the model returned plain-text prose instead of a tool call, well before it would ever reach a
// "rounds running low" nudge. A round-N-2 nudge alone (the originally-suggested mechanism) would not
// have fixed either observed failure. Two nudges below, evidence-grounded:
//   1. NO_TOOL_CALLS RECOVERY — the one that actually matches the repro: if the model stops calling
//      tools at all before proposing, give it exactly ONE chance to reconsider (never more, to avoid an
//      infinite loop) instead of treating the first prose reply as a final, honest halt.
//   2. ROUNDS-RUNNING-LOW — Fable's originally-suggested mechanism, kept as a second safety net for a
//      DIFFERENT failure mode (a model that keeps calling exploration tools indefinitely, never
//      proposing) — fires once, at round maxRounds-2, only if no proposal has landed yet.
const PROPOSE_NUDGE =
  'Reminder: your job here is to call propose_patch with a concrete file change, not to describe or ' +
  'explain one in prose. If your exploration so far is enough to know what to change, call propose_patch ' +
  'now with your complete proposed change.';

/** Runs the real native tool-calling agent. Bounded by the round cap and a dollar budget; never authorizes
 *  or applies anything itself — its only output is a candidate file list (plus the proposal hash and
 *  resolved model id) for the caller to drive through the same OWNER-typed command handlers a manual
 *  "propose patch" would use. */
export async function runNativeAgent(
  goal: string,
  opts: { apiKey?: string; model?: string; maxRounds?: number; budget?: number } = {},
): Promise<NativeAgentRunResult> {
  const apiKey = opts.apiKey ?? resolveApiKey()?.key ?? '';
  const model = opts.model ?? resolveAgentModel();
  const maxRounds = opts.maxRounds ?? maxRoundsFromEnv();
  const budget = opts.budget ?? DEFAULT_BUDGET;

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: goal },
  ];
  const toolCalls: ToolCallLogEntry[] = [];
  let cost = 0;
  const nudgeAtRound = maxRounds - 2;
  let nudgedForRoundsRunningLow = false;
  let nudgedOnNoToolCalls = false;

  for (let round = 1; round <= maxRounds; round++) {
    if (cost > budget) {
      return { goal, rounds: round - 1, toolCalls, proposedGoal: null, candidateFiles: null, proposalHash: null, stoppedReason: 'budget_exceeded', advisoryOnly: true, grantsAuthority: false, model };
    }

    if (round === nudgeAtRound && nudgeAtRound >= 1 && !nudgedForRoundsRunningLow) {
      messages.push({ role: 'user', content: PROPOSE_NUDGE });
      nudgedForRoundsRunningLow = true;
    }

    const { message, costEstimate } = await callModel(apiKey, model, messages);
    cost += costEstimate;
    if (!message) {
      return { goal, rounds: round, toolCalls, proposedGoal: null, candidateFiles: null, proposalHash: null, stoppedReason: 'model_error', advisoryOnly: true, grantsAuthority: false, model };
    }

    const calls = message.tool_calls ?? [];
    if (calls.length === 0) {
      // Issue #30: the model answered in plain text with no tool call. Give it exactly one nudge-and-
      // retry before treating this as a genuine, honest halt (matches the real repro'd failure mode).
      if (!nudgedOnNoToolCalls && round < maxRounds) {
        messages.push({ role: 'assistant', content: message.content ?? null });
        messages.push({ role: 'user', content: PROPOSE_NUDGE });
        nudgedOnNoToolCalls = true;
        continue;
      }
      return { goal, rounds: round, toolCalls, proposedGoal: null, candidateFiles: null, proposalHash: null, stoppedReason: 'no_tool_calls', advisoryOnly: true, grantsAuthority: false, model };
    }

    messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: calls });

    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { args = {}; }
      const toolName = call.function.name as IdeToolName;

      if (!EXPOSED_TOOLS.includes(toolName)) {
        // The model hallucinated a tool name outside its exposed surface — refuse, never dispatch.
        toolCalls.push({ round, tool: toolName, args, ok: false, reason: 'tool not exposed to this agent' });
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, reason: 'tool not exposed to this agent' }) });
        continue;
      }

      if (toolName === 'propose_patch') {
        const rawFiles = Array.isArray(args.files) ? (args.files as RawProposalFile[]) : [];
        const proposedGoalText = typeof args.goal === 'string' ? args.goal : goal;
        // #104: a file may be authored as a unified DIFF against current disk instead of whole-file
        // content. Reconstruct to content HERE, once, from the real disk bytes (exact-match or refuse) —
        // so propose_patch hashes, and the caller sandboxes/signs, the SAME reconstructed content. A diff
        // that does not apply cleanly is refused back to the model like any other propose_patch refusal.
        const recon = reconstructProposalFiles(rawFiles);
        if (!recon.ok) {
          toolCalls.push({ round, tool: 'propose_patch', args, ok: false, reason: `diff reconstruction refused: ${recon.reason}` });
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, reason: `your diff did not apply cleanly to the current file on disk (re-read the file and regenerate the diff, or send whole-file content): ${recon.reason}` }) });
          continue;
        }
        const files = recon.files as SandboxPatchFile[];
        // propose_patch classifies + hashes the RECONSTRUCTED content-files (never the raw diff form).
        const reconArgs = { ...args, files };
        const { result } = dispatchIdeToolWithState({ tool: 'propose_patch', args: reconArgs });
        const authored = rawFiles.map((f) => proposalAuthoringForm(f)).join(',');
        toolCalls.push({ round, tool: 'propose_patch', args: { ...reconArgs, authoredAs: authored }, ok: result.ok, reason: result.reason });
        if (result.ok && files.length > 0) {
          // Terminal action — the model submitted its answer. Stop here; the caller (not this loop)
          // drives sandbox_apply/run_tests/write_receipt from here, via OWNER-typed command handlers.
          return { goal, rounds: round, toolCalls, proposedGoal: proposedGoalText, candidateFiles: files, proposalHash: (result.output as { proposalHash?: string } | undefined)?.proposalHash ?? null, stoppedReason: 'proposed_patch', advisoryOnly: true, grantsAuthority: false, model };
        }
        // propose_patch was refused (e.g. sacred path, oversized) — report the refusal back to the
        // model as a tool result so it can try again, rather than silently ending the loop.
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, reason: result.reason }) });
        continue;
      }

      const dispatched = dispatchIdeToolWithState({ tool: toolName, args });
      toolCalls.push({ round, tool: toolName, args, ok: dispatched.result.ok, reason: dispatched.result.reason });
      messages.push({ role: 'tool', tool_call_id: call.id, content: boundedToolResultJson(dispatched.result) });
    }
  }

  return { goal, rounds: maxRounds, toolCalls, proposedGoal: null, candidateFiles: null, proposalHash: null, stoppedReason: 'max_rounds_no_patch', advisoryOnly: true, grantsAuthority: false, model };
}

// Tool results are already bounded by ideToolContract.ts's MAX_OUTPUT_JSON_LENGTH before they reach
// here; this just keeps the message fed back to the model itself from growing unbounded across rounds.
const MAX_TOOL_MESSAGE_CHARS = 4000;
function boundedToolResultJson(result: IdeToolResult): string {
  const s = JSON.stringify({ ok: result.ok, output: result.output, reason: result.reason });
  return s.length > MAX_TOOL_MESSAGE_CHARS ? s.slice(0, MAX_TOOL_MESSAGE_CHARS) + '...(truncated)' : s;
}
