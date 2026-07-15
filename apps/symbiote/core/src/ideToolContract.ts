// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Native Aukora IDE tool contract — the FIRST native tool-call membrane, replacing "an external agent edits
 * files directly" with a fixed, closed set of tools the organism exposes about ITSELF. Every tool call and
 * every tool result is a typed, positive-allow-listed shape: unknown tool names are refused, unknown result
 * fields are refused, output is bounded, and every result is pinned advisoryOnly=true/grantsAuthority=false.
 *
 * This is a CONTRACT module only — no file-system access, no outbound network call, no subprocess spawning.
 * The actual tool implementations live
 * in nativeIdeDispatcher.ts, which reuses the existing sandbox/gate/registry organs (sandboxApply.ts,
 * kernelActionClassifier.ts, changeRiskClassifier.ts, rootOrganismRegistry.ts) rather than inventing new ones.
 */
import { scanForbiddenKeys, scanForbiddenValues } from './forbiddenContent';

// scanForbiddenValues' bare-hex-64+ pattern (in forbiddenContent.ts) is deliberately broad — it exists to
// catch raw key/signature material, but it also matches our OWN legitimate sha256 digests (proposalHash,
// sandboxPathHash, receiptHash, ...), which are self-produced bookkeeping, not arbitrary content. Rather than
// weaken the shared canonical regex (used everywhere else for real secret detection), filter out only
// leaf fields whose OWN key name ends in "hash" — real secret-shaped content in any other field (e.g. file
// content, search snippets) is still caught. Matches the precedent in aumlokAuthorityRoot.ts's rehearsal
// receipt validator, which excludes its own receiptHash field from generic content scanning the same way.
function forbiddenValuesExceptHashFields(obj: unknown): string[] {
  return scanForbiddenValues(obj).filter((p) => !/hash$/i.test((p.split(/[.[]/).pop() ?? '').replace(/\]$/, '')));
}

export const IDE_TOOL_NAMES = [
  'status', 'self_map', 'list_files', 'read_file', 'search',
  'propose_patch', 'sandbox_apply', 'run_tests', 'write_receipt', 'rollback_sandbox',
] as const;

export type IdeToolName = typeof IDE_TOOL_NAMES[number];

export function isIdeToolName(x: unknown): x is IdeToolName {
  return typeof x === 'string' && (IDE_TOOL_NAMES as readonly string[]).includes(x);
}

export interface IdeToolCall {
  tool: IdeToolName;
  args: Record<string, unknown>;
}

// Every tool result carries EXACTLY this shape — a positive allow-list, same discipline as the Fusion/AUMLOK
// artifact validators. `output` is bounded (checked below) and scanned for secret-shaped content.
export interface IdeToolResult {
  schema: 'ide-tool-result-v1';
  tool: IdeToolName;
  ok: boolean;
  output: unknown;
  reason?: string;
  advisoryOnly: true;
  grantsAuthority: false;
  createdAt: string;
}

const RESULT_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  'schema', 'tool', 'ok', 'output', 'reason', 'advisoryOnly', 'grantsAuthority', 'createdAt',
]);

// A tool result's serialized output must stay small — this is a rehearsal tool, not a data pipe. Bounding
// output size is itself a safety property: it stops a tool from becoming an exfiltration channel.
export const MAX_OUTPUT_JSON_LENGTH = 20_000;

/** Fail-closed validator for an IdeToolResult: unknown tool name, unknown field, oversized output, or
 *  secret-shaped content anywhere in `output` all fail closed. Mirrors fusionAdvisoryArtifact's discipline. */
export function validateIdeToolResult(a: unknown): { valid: boolean; reason?: string } {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { valid: false, reason: 'not an object' };
  const r = a as Record<string, unknown>;

  if (r.schema !== 'ide-tool-result-v1') return { valid: false, reason: 'unknown/legacy schema — fail closed' };
  for (const k of Object.keys(r)) {
    if (!RESULT_TOP_LEVEL_KEYS.has(k)) return { valid: false, reason: `unknown top-level key '${k}' — allow-list fails closed` };
  }
  if (!isIdeToolName(r.tool)) return { valid: false, reason: `unknown tool name '${String(r.tool)}'` };
  if (typeof r.ok !== 'boolean') return { valid: false, reason: 'ok must be boolean' };
  if (r.advisoryOnly !== true) return { valid: false, reason: 'advisoryOnly must be true' };
  if (r.grantsAuthority !== false) return { valid: false, reason: 'grantsAuthority must be false' };
  if (typeof r.createdAt !== 'string' || !r.createdAt) return { valid: false, reason: 'createdAt must be a non-empty string' };
  if (r.reason !== undefined && typeof r.reason !== 'string') return { valid: false, reason: 'reason must be a string when present' };

  let serialized: string;
  try { serialized = JSON.stringify(r.output ?? null); } catch { return { valid: false, reason: 'output is not serializable' }; }
  if (serialized.length > MAX_OUTPUT_JSON_LENGTH) {
    return { valid: false, reason: `output too large (${serialized.length} > ${MAX_OUTPUT_JSON_LENGTH}) — not bounded` };
  }

  const secretKeys = scanForbiddenKeys(r.output);
  if (secretKeys.length) return { valid: false, reason: `forbidden secret/PoP/signature/private-key field(s) in output: ${secretKeys.join(', ')}` };
  const secretValues = forbiddenValuesExceptHashFields(r.output);
  if (secretValues.length) return { valid: false, reason: `secret-shaped value(s) in output at: ${secretValues.join(', ')}` };

  return { valid: true };
}

/** A tool result never grants authority — structural, not a promise. */
export function ideToolResultGrantsAuthority(_r: IdeToolResult): false { return false; }
