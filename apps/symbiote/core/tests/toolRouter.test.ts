import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { heuristicRoute, validateToolWord, isTool, TOOLS } from '../src/toolRouter';

/**
 * 24Z.61 — NL tool router. It must choose the right tool from natural phrasing (not brittle prefixes), and the enum must
 * be the hard boundary: any unknown/garbage suggestion (e.g. from a model) collapses to 'talk'. The router never executes.
 */

describe('heuristic router — natural phrases map to the right tool', () => {
  const cases: Array<[string, string]> = [
    ['hello there', 'talk'],
    ['what are you?', 'talk'],
    ['tell me a joke', 'talk'],
    ['can you roll back that last change', 'undo'],
    ['undo', 'undo'],
    ['revert the last apply please', 'undo'],
    ["what's going on with the system", 'status'],
    ['status', 'status'],
    ['are you up and running?', 'status'],
    ['show me the receipts', 'receipts'],
    ['list receipts', 'receipts'],
    ['what have you got in memory', 'memory'],
    ['why is this not production yet', 'memory'],
    ['make me a small button component', 'build'],
    ['create a new file', 'build'],
    ['change the page title', 'build'],
    ['i want to test the safety blocking', 'catastrophe'],
    ['test safety', 'catastrophe'],
    ['try to exfiltrate a secret', 'catastrophe'],
    ['what can you do', 'help'],
    ['help', 'help'],
  ];
  for (const [msg, tool] of cases) it(`"${msg}" → ${tool}`, () => { expect(heuristicRoute(msg).tool).toBe(tool); });
});

describe('the tool enum is the safety boundary', () => {
  it('validateToolWord accepts only enum tools (case/space/quote tolerant)', () => {
    expect(validateToolWord('build')).toBe('build');
    expect(validateToolWord(' UNDO ')).toBe('undo');
    expect(validateToolWord('"receipts"')).toBe('receipts');
    expect(validateToolWord('the tool is status')).toBe('status');
  });
  it('rejects arbitrary / malicious suggestions → talk', () => {
    for (const bad of ['rm -rf /', 'exec', 'shell', 'sudo', 'apply', 'delete_all', 'eval', '', '   ', 'kernel', '42'] as string[]) {
      expect(validateToolWord(bad)).toBe('talk');
    }
    for (const junk of [null, undefined, 42, {}, []]) expect(validateToolWord(junk as unknown)).toBe('talk');
  });
  it('isTool guards the enum', () => {
    for (const t of TOOLS) expect(isTool(t)).toBe(true);
    for (const bad of ['hack', 'apply', 'write_file', '']) expect(isTool(bad)).toBe(false);
  });
  it('every heuristic result is a valid enum tool', () => {
    for (const m of ['', 'asdkjh', '🙂', 'do the thing', 'xyz']) expect(isTool(heuristicRoute(m).tool)).toBe(true);
  });
});

describe('model-router fallback never leaks the key and only names a tool', () => {
  const src = readFileSync(join(__dirname, '../src/toolRouterModel.ts'), 'utf-8');
  it('reads the key via resolveApiKey, Bearer-only, never logs it, returns a validated tool', () => {
    expect(src).toMatch(/resolveApiKey\(\)/);
    expect(src).toMatch(/Authorization: `Bearer \$\{keyResult\.key\}`/);
    expect(src).toMatch(/validateToolWord\(/);          // model output passes the enum gate
    expect(src).not.toMatch(/console\.log/);
    // it imports only what it needs — no apply/receipt primitives
    expect(src).not.toMatch(/applyHostRun|writeReceiptRow|mintHostApplyReceipt|classifyRisk/);
  });
});
