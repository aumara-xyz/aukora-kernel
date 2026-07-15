// RAIL: editblocks-find-once — ENGINE-level pins for the only production call site of the guard:
// nativeToolCallingEngine.ts's propose_patch handler (reconstructProposalFiles at its line ~287).
//
// This is the layer where find-once becomes load-bearing on the real proposal path: a propose_patch
// carrying `edits` is reconstructed against CURRENT disk bytes (via defaultRepoFileReader, the
// #75-confined resolver) BEFORE dispatch, so the owner only ever signs a full-content hash derived
// from real disk. Pinned here:
//   1. a non-unique (ambiguous) edits anchor is refused BACK TO THE MODEL as a tool message and the
//      loop CONTINUES (retry chance — the live 32B refusal-then-retry flow), never terminal;
//   2. a corrected unique-find retry terminates as 'proposed_patch' whose candidateFiles carry the
//      RECONSTRUCTED whole-file content (never the raw edits array) and a real proposalHash;
//   3. a missing edits target (hermetic — no such file) refuses the same way and a content-form retry
//      recovers.
//
// Hermetic discipline: the model provider is a scripted fetch stub (never a real OpenRouter call);
// the only disk touched is a committed benign fixture INSIDE the repo read-confinement
// (core/tests/fixtures/editblocks-find-once/widget-source.txt); the run stops at stoppedReason
// 'proposed_patch' (advisoryOnly:true, grantsAuthority:false — pinned) and never reaches
// sandbox_apply or any signing/ceremony code.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { runNativeAgent } from '../src/nativeToolCallingEngine';

let originalFetch: typeof globalThis.fetch;
beforeEach(() => { originalFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = originalFetch; });

/** Scripted model turns (same shape as nativeToolCallingEngine.test.ts's scriptedFetch) that ALSO
 *  captures every outgoing request body, so a test can assert what refusal text the model was fed. */
function scriptedCapturingFetch(turns: Array<{ tool_calls?: Array<{ name: string; args: object }>; content?: string | null }>) {
  const bodies: Array<{ messages: Array<{ role: string; content: string | null }> }> = [];
  const fn = vi.fn(async (_url: unknown, opts: { body: string }) => {
    bodies.push(JSON.parse(opts.body));
    const turn = turns[Math.min(bodies.length - 1, turns.length - 1)];
    const message: { content: string | null; tool_calls?: unknown[] } = { content: turn.content ?? null };
    if (turn.tool_calls) {
      message.tool_calls = turn.tool_calls.map((tc, i) => ({
        id: `call_${bodies.length}_${i}`, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args) },
      }));
    }
    return { ok: true, json: async () => ({ choices: [{ message }] }) };
  });
  return { fn, bodies };
}

// The committed benign fixture, addressed repo-relatively (how the engine's default reader sees it)
// and absolutely (how this test independently reads the same bytes to compute the expected result).
const FIXTURE_REL = 'core/tests/fixtures/editblocks-find-once/widget-source.txt';
const FIXTURE_ABS = path.join(__dirname, 'fixtures', 'editblocks-find-once', 'widget-source.txt');

describe('nativeToolCallingEngine: propose_patch with edits — find-once is load-bearing on the real path', () => {
  it('a non-unique edits anchor is refused back to the model (loop continues) and a corrected retry yields reconstructed candidateFiles', async () => {
    const fixture = fs.readFileSync(FIXTURE_ABS, 'utf-8');
    // Self-check the fixture's shape before pinning behavior on it.
    expect(fixture.split('return {').length - 1).toBe(2); // the ambiguous anchor
    expect(fixture.split("kind: 'alpha',").length - 1).toBe(1); // the unique anchor

    const ambiguousEdit = { find: 'return {', replace: 'return { // patched' };
    const uniqueEdit = { find: "kind: 'alpha',", replace: "kind: 'alpha',\n    patched: true," };
    const expectedContent = fixture.replace(uniqueEdit.find, uniqueEdit.replace);

    const { fn, bodies } = scriptedCapturingFetch([
      { tool_calls: [{ name: 'propose_patch', args: { goal: 'patch the widget', files: [{ relPath: FIXTURE_REL, edits: [ambiguousEdit] }] } }] },
      { tool_calls: [{ name: 'propose_patch', args: { goal: 'patch the widget', files: [{ relPath: FIXTURE_REL, edits: [uniqueEdit] }] } }] },
    ]);
    globalThis.fetch = fn as unknown as typeof globalThis.fetch;

    const result = await runNativeAgent('patch the widget', { apiKey: 'test-key' });

    // Round 1: the ambiguous anchor was REFUSED, logged honestly, and the loop was NOT terminal.
    expect(result.rounds).toBe(2);
    expect(result.toolCalls.length).toBe(2);
    expect(result.toolCalls[0].tool).toBe('propose_patch');
    expect(result.toolCalls[0].ok).toBe(false);
    expect(result.toolCalls[0].reason).toContain('diff reconstruction refused');
    expect(result.toolCalls[0].reason).toContain('ambiguous');
    expect(result.toolCalls[0].reason).toContain('occurs 2 times');

    // The refusal was fed BACK TO THE MODEL as a tool message on the next request (the retry chance).
    expect(bodies.length).toBe(2);
    const round2ToolMsgs = bodies[1].messages.filter((m) => m.role === 'tool');
    expect(round2ToolMsgs.some((m) =>
      typeof m.content === 'string' && m.content.includes('did not apply cleanly') && m.content.includes('ambiguous'),
    )).toBe(true);

    // Round 2: the corrected unique-find retry is TERMINAL with reconstructed content.
    expect(result.stoppedReason).toBe('proposed_patch');
    expect(result.candidateFiles).not.toBeNull();
    expect(result.candidateFiles!.length).toBe(1);
    expect(result.candidateFiles![0].relPath).toBe(FIXTURE_REL);
    // The bridge to the signature: candidateFiles carry the RECONSTRUCTED whole-file content —
    // byte-identical to an independent read of the same disk bytes with the edit applied — and
    // never the raw edits array.
    expect(result.candidateFiles![0].content).toBe(expectedContent);
    expect((result.candidateFiles![0] as unknown as { edits?: unknown }).edits).toBeUndefined();
    expect(typeof result.proposalHash).toBe('string');
    expect(result.proposalHash).not.toBe('');

    // Honest authorship logging: the terminal call records it was authored as edits.
    expect(result.toolCalls[1].ok).toBe(true);
    expect((result.toolCalls[1].args as { authoredAs?: string }).authoredAs).toBe('edits');

    // Advisory-only discipline holds on this path too — nothing here grants authority.
    expect(result.advisoryOnly).toBe(true);
    expect(result.grantsAuthority).toBe(false);
  });

  it('an edits target that does not exist on disk refuses back to the model; a content-form retry recovers', async () => {
    const missingRel = 'docs/RAIL3_EDITS_TARGET_DOES_NOT_EXIST.md';
    const { fn, bodies } = scriptedCapturingFetch([
      { tool_calls: [{ name: 'propose_patch', args: { goal: 'g', files: [{ relPath: missingRel, edits: [{ find: 'a', replace: 'b' }] }] } }] },
      { tool_calls: [{ name: 'propose_patch', args: { goal: 'g', files: [{ relPath: 'docs/AGENT_RAIL3_NOTE.md', content: 'hello\n' }] } }] },
    ]);
    globalThis.fetch = fn as unknown as typeof globalThis.fetch;

    const result = await runNativeAgent('goal', { apiKey: 'test-key' });

    // The missing-target refusal is a retryable tool refusal, not a crash and not terminal.
    expect(result.toolCalls[0].ok).toBe(false);
    expect(result.toolCalls[0].reason).toContain('diff reconstruction refused');
    expect(result.toolCalls[0].reason).toContain('not found');
    const round2ToolMsgs = bodies[1].messages.filter((m) => m.role === 'tool');
    expect(round2ToolMsgs.some((m) => typeof m.content === 'string' && m.content.includes('did not apply cleanly'))).toBe(true);

    // The content-form retry terminates normally.
    expect(result.stoppedReason).toBe('proposed_patch');
    expect(result.candidateFiles![0]).toEqual({ relPath: 'docs/AGENT_RAIL3_NOTE.md', content: 'hello\n' });
    expect((result.toolCalls[1].args as { authoredAs?: string }).authoredAs).toBe('content');
  });
});
