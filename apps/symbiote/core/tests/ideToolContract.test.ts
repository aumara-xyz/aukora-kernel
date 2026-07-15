import { describe, it, expect } from 'vitest';
import {
  IDE_TOOL_NAMES, isIdeToolName, validateIdeToolResult, ideToolResultGrantsAuthority,
  MAX_OUTPUT_JSON_LENGTH, type IdeToolResult,
} from '../src/ideToolContract';

const NOW = '2026-07-01T00:00:00.000Z';

function baseResult(over: Partial<IdeToolResult> = {}): IdeToolResult {
  return {
    schema: 'ide-tool-result-v1', tool: 'status', ok: true, output: { a: 1 },
    advisoryOnly: true, grantsAuthority: false, createdAt: NOW, ...over,
  };
}

describe('ide-tool-contract-v1: the fixed 10-tool set', () => {
  it('IDE_TOOL_NAMES is exactly the 10 named tools', () => {
    expect([...IDE_TOOL_NAMES].sort()).toEqual([
      'list_files', 'propose_patch', 'read_file', 'rollback_sandbox', 'run_tests',
      'sandbox_apply', 'search', 'self_map', 'status', 'write_receipt',
    ].sort());
  });

  it('isIdeToolName accepts only the fixed set', () => {
    for (const t of IDE_TOOL_NAMES) expect(isIdeToolName(t)).toBe(true);
    expect(isIdeToolName('shell')).toBe(false);
    expect(isIdeToolName('write_file')).toBe(false);
    expect(isIdeToolName('delete_path')).toBe(false);
    expect(isIdeToolName(123)).toBe(false);
    expect(isIdeToolName(undefined)).toBe(false);
  });
});

describe('validateIdeToolResult: fail-closed on the exact result contract', () => {
  it('accepts a well-formed result', () => {
    expect(validateIdeToolResult(baseResult())).toEqual({ valid: true });
  });

  it('rejects a non-object', () => {
    expect(validateIdeToolResult(null).valid).toBe(false);
    expect(validateIdeToolResult('x').valid).toBe(false);
    expect(validateIdeToolResult([1, 2]).valid).toBe(false);
  });

  it('rejects an unknown/legacy schema', () => {
    expect(validateIdeToolResult(baseResult({ schema: 'ide-tool-result-v0' as any })).valid).toBe(false);
  });

  it('rejects an unknown top-level key', () => {
    const r: any = { ...baseResult(), extra: 'field' };
    const v = validateIdeToolResult(r);
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/unknown top-level key/);
  });

  it('rejects an unknown tool name', () => {
    const r: any = { ...baseResult(), tool: 'shell' };
    expect(validateIdeToolResult(r).valid).toBe(false);
  });

  it('rejects non-boolean ok', () => {
    expect(validateIdeToolResult({ ...baseResult(), ok: 'yes' as any }).valid).toBe(false);
  });

  it('rejects advisoryOnly !== true and grantsAuthority !== false', () => {
    expect(validateIdeToolResult({ ...baseResult(), advisoryOnly: false as any }).valid).toBe(false);
    expect(validateIdeToolResult({ ...baseResult(), grantsAuthority: true as any }).valid).toBe(false);
  });

  it('rejects a missing/empty createdAt', () => {
    expect(validateIdeToolResult({ ...baseResult(), createdAt: '' }).valid).toBe(false);
    expect(validateIdeToolResult({ ...baseResult(), createdAt: undefined as any }).valid).toBe(false);
  });

  it('rejects a non-string reason when present', () => {
    expect(validateIdeToolResult({ ...baseResult(), reason: 42 as any }).valid).toBe(false);
  });

  it('rejects output that exceeds the bounded size', () => {
    const big = { blob: 'x'.repeat(MAX_OUTPUT_JSON_LENGTH + 100) };
    const v = validateIdeToolResult(baseResult({ output: big }));
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/not bounded/);
  });

  it('rejects a forbidden secret-shaped key in output (e.g. privateKey)', () => {
    const v = validateIdeToolResult(baseResult({ output: { privateKey: 'nope' } }));
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/forbidden secret/);
  });

  it('rejects secret-shaped content in a non-hash field (e.g. a PEM block)', () => {
    const v = validateIdeToolResult(baseResult({ output: { content: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----' } }));
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/secret-shaped value/);
  });

  it('does NOT reject a legitimate sha256 hash stored in a *Hash-named field', () => {
    const sha256hex = 'a'.repeat(64);
    const v = validateIdeToolResult(baseResult({ output: { proposalHash: sha256hex, sandboxPathHash: sha256hex } }));
    expect(v.valid).toBe(true);
  });

  it('still flags a bare 64-hex-char value in a NON-hash-named field', () => {
    const sha256hex = 'a'.repeat(64);
    const v = validateIdeToolResult(baseResult({ output: { snippet: sha256hex } }));
    expect(v.valid).toBe(false);
  });

  it('ideToolResultGrantsAuthority is always false', () => {
    expect(ideToolResultGrantsAuthority(baseResult())).toBe(false);
  });
});
