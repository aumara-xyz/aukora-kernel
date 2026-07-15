import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { runNativeAgent } from '../src/nativeToolCallingEngine';

let originalFetch: typeof globalThis.fetch;
beforeEach(() => { originalFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = originalFetch; });

/** A scripted sequence of model "turns" — each entry is what the mocked model returns for that round. */
function scriptedFetch(turns: Array<{ tool_calls?: Array<{ name: string; args: object }>; content?: string | null } | 'http_error' | 'network_throw' | 'malformed_json'>) {
  let call = 0;
  return vi.fn(async () => {
    const turn = turns[Math.min(call, turns.length - 1)];
    call++;
    if (turn === 'http_error') return { ok: false, status: 500 };
    if (turn === 'network_throw') throw new Error('ECONNRESET'); // fetch() itself rejects — DNS/timeout/reset
    if (turn === 'malformed_json') return { ok: true, json: async () => { throw new SyntaxError('Unexpected token'); } };
    const message: any = { content: turn.content ?? null };
    if (turn.tool_calls) {
      message.tool_calls = turn.tool_calls.map((tc, i) => ({
        id: `call_${call}_${i}`, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args) },
      }));
    }
    return { ok: true, json: async () => ({ choices: [{ message }] }) };
  });
}

describe('nativeToolCallingEngine: the real native agent loop', () => {
  it('explores (list_files, read_file) then proposes a patch — terminal action stops the loop', async () => {
    globalThis.fetch = scriptedFetch([
      { tool_calls: [{ name: 'list_files', args: { dir: 'core/src' } }] },
      { tool_calls: [{ name: 'read_file', args: { relPath: 'core/src/index.ts' } }] },
      { tool_calls: [{ name: 'propose_patch', args: { goal: 'add a doc note', files: [{ relPath: 'docs/AGENT_TEST_NOTE.md', content: 'hello' }] } }] },
    ]) as any;

    const result = await runNativeAgent('add a doc note', { apiKey: 'test-key' });
    expect(result.stoppedReason).toBe('proposed_patch');
    expect(result.candidateFiles).not.toBeNull();
    expect(result.candidateFiles![0].relPath).toBe('docs/AGENT_TEST_NOTE.md');
    expect(result.proposedGoal).toBe('add a doc note');
    expect(result.rounds).toBe(3);
    expect(result.toolCalls.map((t) => t.tool)).toEqual(['list_files', 'read_file', 'propose_patch']);
    expect(result.toolCalls.every((t) => t.ok)).toBe(true);
  });

  // Round 2 (issue #22): proposalHash used to be discarded after dispatchIdeToolWithState computed it —
  // the caller (workbenchCommandLoop's `agent: <goal>` command) needs this SAME hash to hand off to
  // sandbox_apply/write_receipt without re-deriving it (a confused-deputy risk if the two ever drifted).
  it('retains the real proposalHash from the propose_patch dispatch on a terminal proposed_patch stop', async () => {
    globalThis.fetch = scriptedFetch([
      { tool_calls: [{ name: 'propose_patch', args: { goal: 'add a doc note', files: [{ relPath: 'docs/AGENT_TEST_NOTE.md', content: 'hello' }] } }] },
    ]) as any;

    const result = await runNativeAgent('add a doc note', { apiKey: 'test-key' });
    expect(result.stoppedReason).toBe('proposed_patch');
    expect(typeof result.proposalHash).toBe('string');
    expect(result.proposalHash).not.toBe('');
  });

  it('proposalHash is null on every non-terminal stop reason (budget/model_error/no_tool_calls/max_rounds)', async () => {
    globalThis.fetch = scriptedFetch([{ tool_calls: [{ name: 'search', args: { query: 'foo' } }] }]) as any;
    const maxRounds = await runNativeAgent('do something', { apiKey: 'test-key', maxRounds: 2 });
    expect(maxRounds.stoppedReason).toBe('max_rounds_no_patch');
    expect(maxRounds.proposalHash).toBeNull();

    globalThis.fetch = scriptedFetch(['http_error']) as any;
    const modelError = await runNativeAgent('do something', { apiKey: 'test-key' });
    expect(modelError.stoppedReason).toBe('model_error');
    expect(modelError.proposalHash).toBeNull();

    globalThis.fetch = scriptedFetch([{ content: 'no changes needed' }]) as any;
    const noToolCalls = await runNativeAgent('do something', { apiKey: 'test-key' });
    expect(noToolCalls.stoppedReason).toBe('no_tool_calls');
    expect(noToolCalls.proposalHash).toBeNull();

    globalThis.fetch = scriptedFetch([{ tool_calls: [{ name: 'search', args: { query: 'foo' } }] }]) as any;
    const budgetExceeded = await runNativeAgent('do something', { apiKey: 'test-key', budget: 0 });
    expect(budgetExceeded.stoppedReason).toBe('budget_exceeded');
    expect(budgetExceeded.proposalHash).toBeNull();
  });

  it('a model that never calls propose_patch within maxRounds stops honestly with no candidate', async () => {
    globalThis.fetch = scriptedFetch([
      { tool_calls: [{ name: 'search', args: { query: 'foo' } }] },
    ]) as any; // same turn repeats every round via the scriptedFetch clamp

    const result = await runNativeAgent('do something', { apiKey: 'test-key', maxRounds: 3 });
    expect(result.stoppedReason).toBe('max_rounds_no_patch');
    expect(result.candidateFiles).toBeNull();
    expect(result.rounds).toBe(3);
  });

  // Issue #30 (Round 6 QA): this test used to stop at round 1. Real live repro showed the default
  // model doing exactly this — replying in prose instead of calling a tool — as early as round 4 of 8.
  // Fixed with a one-time nudge-and-retry (below); a model that STILL never calls a tool after being
  // nudged once genuinely, honestly halts — this test now proves that final case (2 rounds, not 1).
  it('a model that returns plain text with no tool calls, even after one nudge, honestly halts', async () => {
    globalThis.fetch = scriptedFetch([
      { content: 'I don\'t think this needs any code changes.' },
    ]) as any; // clamped — every round gets the same prose reply, so the nudge never recovers it

    const result = await runNativeAgent('is this fine?', { apiKey: 'test-key' });
    expect(result.stoppedReason).toBe('no_tool_calls');
    expect(result.candidateFiles).toBeNull();
    expect(result.rounds).toBe(2); // round 1: prose, nudged; round 2: prose again, genuine halt
  });

  it('issue #30: a model that dawdles in prose once, then proposes after the no-tool-calls nudge — a real recovery, not a false halt', async () => {
    globalThis.fetch = scriptedFetch([
      { content: 'Let me think about this before I decide what to change...' }, // round 1: no tool call
      { tool_calls: [{ name: 'propose_patch', args: { goal: 'g', files: [{ relPath: 'docs/AGENT_NUDGE_TEST.md', content: 'x' }] } }] }, // round 2: proposes after the nudge
    ]) as any;

    const result = await runNativeAgent('goal', { apiKey: 'test-key' });
    expect(result.stoppedReason).toBe('proposed_patch');
    expect(result.rounds).toBe(2);
    expect(result.candidateFiles![0].relPath).toBe('docs/AGENT_NUDGE_TEST.md');
  });

  it('issue #30: the no-tool-calls recovery nudge text is actually sent to the model on the retry round', async () => {
    const bodies: any[] = [];
    let call = 0;
    globalThis.fetch = vi.fn(async (_url: unknown, opts: { body: string }) => {
      bodies.push(JSON.parse(opts.body));
      call++;
      if (call === 1) return { ok: true, json: async () => ({ choices: [{ message: { content: 'thinking...' } }] }) };
      const args = JSON.stringify({ goal: 'g', files: [{ relPath: 'docs/AGENT_NUDGE_TEST2.md', content: 'x' }] });
      return { ok: true, json: async () => ({ choices: [{ message: { tool_calls: [{ id: 'c1', type: 'function', function: { name: 'propose_patch', arguments: args } }] } }] }) };
    }) as any;

    await runNativeAgent('goal', { apiKey: 'test-key' });
    expect(bodies.length).toBe(2);
    const round2Messages = bodies[1].messages as Array<{ role: string; content: string }>;
    expect(round2Messages.some((m) => m.role === 'user' && m.content?.includes('propose_patch'))).toBe(true);
  });

  it('issue #30: the rounds-running-low nudge fires once at round maxRounds-2 for a model that keeps exploring without proposing', async () => {
    const bodies: any[] = [];
    globalThis.fetch = vi.fn(async (_url: unknown, opts: { body: string }) => {
      bodies.push(JSON.parse(opts.body));
      if (bodies.length < 3) {
        return { ok: true, json: async () => ({ choices: [{ message: { tool_calls: [{ id: `c${bodies.length}`, type: 'function', function: { name: 'search', arguments: JSON.stringify({ query: 'foo' }) } }] } }] }) };
      }
      const args = JSON.stringify({ goal: 'g', files: [{ relPath: 'docs/AGENT_NUDGE_TEST3.md', content: 'y' }] });
      return { ok: true, json: async () => ({ choices: [{ message: { tool_calls: [{ id: 'cp', type: 'function', function: { name: 'propose_patch', arguments: args } }] } }] }) };
    }) as any;

    // maxRounds=4 -> nudgeAtRound = 2 — the SECOND request (bodies[1]) must carry the nudge.
    const result = await runNativeAgent('goal', { apiKey: 'test-key', maxRounds: 4 });
    expect(result.stoppedReason).toBe('proposed_patch');
    const round2Messages = bodies[1].messages as Array<{ role: string; content: string }>;
    expect(round2Messages.some((m) => m.role === 'user' && m.content?.includes('propose_patch'))).toBe(true);
  });

  it('a real HTTP failure from the model provider stops as model_error, never crashes', async () => {
    globalThis.fetch = scriptedFetch(['http_error']) as any;
    const result = await runNativeAgent('goal', { apiKey: 'test-key' });
    expect(result.stoppedReason).toBe('model_error');
    expect(result.candidateFiles).toBeNull();
  });

  it('a raw network-level throw (DNS/timeout/reset) from fetch() itself stops as model_error, never an unhandled rejection', async () => {
    // Adversarial review finding: callModel() originally had no try/catch around fetch() itself, only
    // around the !resp.ok HTTP-status path — a real network throw would have propagated as an
    // unhandled exception out of runNativeAgent instead of this clean stop reason. Fixed before commit.
    globalThis.fetch = scriptedFetch(['network_throw']) as any;
    await expect(runNativeAgent('goal', { apiKey: 'test-key' })).resolves.toMatchObject({ stoppedReason: 'model_error', candidateFiles: null });
  });

  it('a 200 OK response with a malformed/non-JSON body stops as model_error, never an unhandled rejection', async () => {
    globalThis.fetch = scriptedFetch(['malformed_json']) as any;
    await expect(runNativeAgent('goal', { apiKey: 'test-key' })).resolves.toMatchObject({ stoppedReason: 'model_error', candidateFiles: null });
  });

  it('a hallucinated tool name outside the exposed 6-tool surface is refused, never dispatched, loop continues', async () => {
    globalThis.fetch = scriptedFetch([
      { tool_calls: [{ name: 'sandbox_apply', args: { goal: 'g', files: [], proposalHash: 'x' } }] },
      { tool_calls: [{ name: 'propose_patch', args: { goal: 'g', files: [{ relPath: 'docs/AGENT_TEST_NOTE2.md', content: 'x' }] } }] },
    ]) as any;

    const result = await runNativeAgent('goal', { apiKey: 'test-key' });
    const hallucinated = result.toolCalls.find((t) => t.tool === 'sandbox_apply');
    expect(hallucinated?.ok).toBe(false);
    expect(hallucinated?.reason).toMatch(/not exposed/i);
    expect(result.stoppedReason).toBe('proposed_patch'); // still recovers and completes via the next round
  });

  it('propose_patch refused (e.g. a sacred path) is reported back to the model, not treated as terminal', async () => {
    globalThis.fetch = scriptedFetch([
      { tool_calls: [{ name: 'propose_patch', args: { goal: 'bad', files: [{ relPath: 'authority/aumlok/x.ts', content: 'evil' }] } }] },
      { tool_calls: [{ name: 'propose_patch', args: { goal: 'good', files: [{ relPath: 'docs/AGENT_TEST_NOTE3.md', content: 'ok' }] } }] },
    ]) as any;

    const result = await runNativeAgent('goal', { apiKey: 'test-key' });
    expect(result.toolCalls[0].tool).toBe('propose_patch');
    expect(result.toolCalls[0].ok).toBe(false); // sacred path refusal, not silently swallowed
    expect(result.stoppedReason).toBe('proposed_patch');
    expect(result.candidateFiles![0].relPath).toBe('docs/AGENT_TEST_NOTE3.md');
  });

  it('budget cap is enforced — a tiny budget stops the loop before exhausting maxRounds', async () => {
    globalThis.fetch = scriptedFetch([
      { tool_calls: [{ name: 'search', args: { query: 'foo' } }] },
    ]) as any;

    const result = await runNativeAgent('goal', { apiKey: 'test-key', maxRounds: 100, budget: 0 });
    expect(result.stoppedReason).toBe('budget_exceeded');
  });

  it('advisory-only discipline: every result is pinned, regardless of outcome', async () => {
    globalThis.fetch = scriptedFetch([{ content: 'done' }]) as any;
    const result = await runNativeAgent('goal', { apiKey: 'test-key' });
    expect(result.advisoryOnly).toBe(true);
    expect(result.grantsAuthority).toBe(false);
  });

  // Round 5 (issue #25): `model` used to be resolved and then discarded — workbenchRunReport.ts needs
  // to disclose which model actually produced a proposal. Check it's populated on both a terminal
  // proposed_patch stop AND a non-terminal stop (the model is known the instant it's resolved, at the
  // top of the run, regardless of how the loop ends).
  it('the resolved model id is present on the result regardless of how the run ends', async () => {
    globalThis.fetch = scriptedFetch([
      { tool_calls: [{ name: 'propose_patch', args: { goal: 'g', files: [{ relPath: 'docs/AGENT_TEST_MODEL_FIELD.md', content: 'x' }] } }] },
    ]) as any;
    const proposed = await runNativeAgent('goal', { apiKey: 'test-key', model: 'test-org/explicit-model' });
    expect(proposed.model).toBe('test-org/explicit-model');

    globalThis.fetch = scriptedFetch(['http_error']) as any;
    const errored = await runNativeAgent('goal', { apiKey: 'test-key', model: 'test-org/explicit-model' });
    expect(errored.model).toBe('test-org/explicit-model');
  });
});

// Round 4 (issue #24): the model used to be a hardcoded constant here, unreachable via opts from the
// real workbench call site (agent: <goal> calls runNativeAgent(goal) with no options). Moved to
// fusionConfig.ts's resolveAgentModel() so an env override actually reaches the outgoing request.
describe('nativeToolCallingEngine: agent model is configurable (issue #24)', () => {
  let prevAgentModel: string | undefined;
  beforeEach(() => { prevAgentModel = process.env.AUKORA_AGENT_MODEL; });
  afterEach(() => {
    if (prevAgentModel === undefined) delete process.env.AUKORA_AGENT_MODEL; else process.env.AUKORA_AGENT_MODEL = prevAgentModel;
  });

  function capturingFetch() {
    const bodies: any[] = [];
    const fetchMock = vi.fn(async (_url: unknown, opts: { body: string }) => {
      bodies.push(JSON.parse(opts.body));
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'no changes needed' } }] }) };
    });
    return { fetchMock, bodies };
  }

  it('defaults to moonshotai/kimi-k2.7-code when no env override and no opts.model are given', async () => {
    delete process.env.AUKORA_AGENT_MODEL;
    const { fetchMock, bodies } = capturingFetch();
    globalThis.fetch = fetchMock as any;
    await runNativeAgent('goal', { apiKey: 'test-key' });
    expect(bodies[0].model).toBe('moonshotai/kimi-k2.7-code');
  });

  it('AUKORA_AGENT_MODEL env override reaches the real outgoing request body', async () => {
    process.env.AUKORA_AGENT_MODEL = 'test-org/test-override-model';
    const { fetchMock, bodies } = capturingFetch();
    globalThis.fetch = fetchMock as any;
    await runNativeAgent('goal', { apiKey: 'test-key' });
    expect(bodies[0].model).toBe('test-org/test-override-model');
  });

  it('an explicit opts.model still wins over both the env override and the default', async () => {
    process.env.AUKORA_AGENT_MODEL = 'test-org/env-model';
    const { fetchMock, bodies } = capturingFetch();
    globalThis.fetch = fetchMock as any;
    await runNativeAgent('goal', { apiKey: 'test-key', model: 'test-org/explicit-opts-model' });
    expect(bodies[0].model).toBe('test-org/explicit-opts-model');
  });
});

describe('nativeToolCallingEngine: structural safety', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'nativeToolCallingEngine.ts'), 'utf-8');

  it('never exposes sandbox_apply/run_tests/write_receipt/rollback_sandbox to the model', () => {
    // The caller (not this loop) drives these, via the same OWNER-typed command handlers a manually-
    // authored "propose patch" uses — see nativeToolCallingEngine.ts's own header for the full story.
    const exposedMatch = src.match(/const EXPOSED_TOOLS:[^;]+;/);
    expect(exposedMatch).not.toBeNull();
    const exposedBlock = exposedMatch![0];
    expect(exposedBlock).not.toContain('sandbox_apply');
    expect(exposedBlock).not.toContain('run_tests');
    expect(exposedBlock).not.toContain('write_receipt');
    expect(exposedBlock).not.toContain('rollback_sandbox');
  });

  it('every dispatched call routes through dispatchIdeToolWithState — the single existing chokepoint', () => {
    expect(src).toContain('dispatchIdeToolWithState');
    // No direct fs/child_process import for anything other than the network call to the model provider.
    const importLines = src.split('\n').filter((l) => /^\s*import\b/.test(l));
    for (const line of importLines) {
      expect(line).not.toMatch(/\bchild_process\b/);
      expect(line).not.toMatch(/\bfs\b/);
    }
  });

  it('only one hardcoded network endpoint exists in the module', () => {
    const codeOnly = src.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
    const fetchSites = (codeOnly.match(/\bfetch\(/g) ?? []).length;
    expect(fetchSites).toBe(1);
  });
});
