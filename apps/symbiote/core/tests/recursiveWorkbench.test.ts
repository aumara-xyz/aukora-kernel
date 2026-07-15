import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { runRecursiveWorkbenchDemo, DEMO_TASK, DEMO_NOTE_RELPATH } from '../src/recursiveWorkbench';
import { validateRecursiveIdeRehearsalReceipt } from '../src/recursiveIdeRehearsalReceipt';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WITNESS_FILE = path.join(REPO_ROOT, 'README.md');
const DEMO_NOTE_LIVE_PATH = path.join(REPO_ROOT, DEMO_NOTE_RELPATH);

describe('recursiveWorkbench: end-to-end native IDE rehearsal (sandbox-only)', () => {
  it('runs the full 8-step demo through the dispatcher\'s own 10-tool path', () => {
    const witnessBefore = fs.readFileSync(WITNESS_FILE, 'utf-8');

    const r = runRecursiveWorkbenchDemo();

    expect(r.task).toBe(DEMO_TASK);
    expect(r.steps.length).toBe(8);
    expect(r.steps.every((s) => s.ok)).toBe(true);
    expect(r.toolCallsUsed).toEqual([
      'status', 'self_map', 'list_files', 'read_file', 'search',
      'propose_patch', 'sandbox_apply', 'run_tests', 'write_receipt', 'rollback_sandbox',
    ]);
    expect(r.appliedLive).toBe(false);
    expect(r.rehearsalOnly).toBe(true);
    expect(r.liveRepoUntouched).toBe(true);
    expect(r.sandboxRemoved).toBe(true);
    expect(r.receiptValid).toBe(true);
    expect(r.receipt.appliedLive).toBe(false);
    expect(r.receipt.promotionReady).toBe(false);
    expect(r.receipt.advisoryOnly).toBe(true);
    expect(r.receipt.grantsAuthority).toBe(false);
    expect(validateRecursiveIdeRehearsalReceipt(r.receipt).valid).toBe(true);

    // false-flag #1: the demo's own note file was never actually written to the live repo
    expect(fs.existsSync(DEMO_NOTE_LIVE_PATH)).toBe(false);
    // false-flag #2: an unrelated live witness file is untouched byte-for-byte
    expect(fs.readFileSync(WITNESS_FILE, 'utf-8')).toBe(witnessBefore);
  });

  it('running the demo twice in a row leaves no residue (idempotent, no leaked sandboxes)', () => {
    const r1 = runRecursiveWorkbenchDemo();
    const r2 = runRecursiveWorkbenchDemo();
    expect(r1.receipt.receiptHash).not.toBe(r2.receipt.receiptHash); // different sandbox path each run
    expect(r2.liveRepoUntouched).toBe(true);
    expect(r2.sandboxRemoved).toBe(true);
    expect(fs.existsSync(DEMO_NOTE_LIVE_PATH)).toBe(false);
  });

  it('never stores the raw sandbox path in the returned receipt', () => {
    const r = runRecursiveWorkbenchDemo();
    const json = JSON.stringify(r.receipt);
    expect(json).not.toMatch(/\/(tmp|private\/tmp|var\/folders)\/[^"]*aukora-apply-/);
  });
});
