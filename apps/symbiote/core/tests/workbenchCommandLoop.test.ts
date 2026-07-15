import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runWorkbenchCommand, freshWorkbenchSession } from '../src/workbenchCommandLoop';
import { buildSelfEditProposalArtifact, writeSelfEditProposalArtifact, readPendingProposalByHash } from '../src/selfEditProposalArtifact';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DISPATCHER_SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'workbenchCommandLoop.ts'), 'utf-8');

// Issue #25 follow-up (Fable QA A3): the "run:" chain's mid-chain-failure test for sandbox_apply needs a
// REAL failure independent of propose_patch succeeding — but propose_patch and sandbox_apply share the
// exact same underlying classifier (classifyDraftAction against buildKernelActionTable()), so there is
// no natural repo-relative path where propose_patch succeeds and sandbox_apply then fails on its own.
// Fable's own directive explicitly sanctioned "stub the dispatcher" for exactly this case. Pass-through
// by default — zero effect on every other test in this file; only the one test that flips
// forceSandboxApplyFailure=true (and resets it in its own afterEach) observes anything different.
let forceSandboxApplyFailure = false;
let forceContentCheckMismatch = false;
vi.mock('../src/nativeIdeDispatcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/nativeIdeDispatcher')>();
  return {
    ...actual,
    dispatchIdeToolWithState: (call: { tool: string; args: Record<string, unknown> }, now?: string) => {
      const createdAt = now ?? new Date().toISOString();
      if (call.tool === 'sandbox_apply' && forceSandboxApplyFailure) {
        return { result: { schema: 'ide-tool-result-v1', tool: 'sandbox_apply', ok: false, output: null, reason: 'forced test failure (issue #25 mid-chain test)', advisoryOnly: true, grantsAuthority: false, createdAt } };
      }
      if (call.tool === 'run_tests' && forceContentCheckMismatch) {
        return { result: { schema: 'ide-tool-result-v1', tool: 'run_tests', ok: true, output: { passed: false, ran: ['forced-mismatch'], detail: 'forced test mismatch (issue #25 mid-chain test)' }, advisoryOnly: true, grantsAuthority: false, createdAt } };
      }
      return actual.dispatchIdeToolWithState(call as any, now);
    },
  };
});

// "propose patch" writes a proposal artifact outside the repo, under ${AUKORA_SYMBIOTE_HOME}. Point that
// at a throwaway dir for the whole test file so these tests never touch the developer's REAL home dir —
// matches the established pattern in aumlokAuthorityCli.test.ts.
//
// Issue #23: captureWorkbenchEvent (proposal/review/apply -> Kira's chain) now runs on nearly every
// command in this file, reading/writing whatever AUKORA_KIRA_STATE points at. Without this override
// EVERY test below would silently read-modify-write the developer's REAL local state/kira/brain.json
// (75 real migrated receipts as of issue #21) on every single run. Point it at a throwaway file too.
let testHome: string;
let prevHome: string | undefined;
let testKiraState: string;
let prevKiraState: string | undefined;
beforeEach(() => {
  testHome = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-wcl-home-'));
  prevHome = process.env.AUKORA_SYMBIOTE_HOME;
  process.env.AUKORA_SYMBIOTE_HOME = testHome;
  testKiraState = path.join(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-wcl-kira-')), 'brain.json');
  prevKiraState = process.env.AUKORA_KIRA_STATE;
  process.env.AUKORA_KIRA_STATE = testKiraState;
});
afterEach(() => {
  if (prevHome === undefined) delete process.env.AUKORA_SYMBIOTE_HOME; else process.env.AUKORA_SYMBIOTE_HOME = prevHome;
  fs.rmSync(testHome, { recursive: true, force: true });
  if (prevKiraState === undefined) delete process.env.AUKORA_KIRA_STATE; else process.env.AUKORA_KIRA_STATE = prevKiraState;
  fs.rmSync(path.dirname(testKiraState), { recursive: true, force: true });
});

describe('workbenchCommandLoop: only ever calls the native dispatcher', () => {
  it('imports nothing that could touch fs/child_process/network directly', () => {
    const importLines = DISPATCHER_SRC.split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n');
    expect(importLines).not.toMatch(/\bfs\b|\bchild_process\b|\bhttps?\b/);
    expect(importLines).toMatch(/nativeIdeDispatcher/);
  });

  it('help / empty input returns the command list, no tool call', async () => {
    const s = freshWorkbenchSession();
    const e1 = await runWorkbenchCommand('', s);
    const e2 = await runWorkbenchCommand('help', s);
    expect(e1.some((e) => e.kind === 'info')).toBe(true);
    expect(e2.some((e) => e.kind === 'info')).toBe(true);
    expect(s.toolCallsUsed.length).toBe(0);
  });

  it('unrecognized command produces an error entry, no tool call', async () => {
    const s = freshWorkbenchSession();
    const e = await runWorkbenchCommand('do something weird', s);
    expect(e.some((x) => x.kind === 'error')).toBe(true);
    expect(s.toolCallsUsed.length).toBe(0);
  });

  it('status / map yourself / read file / search dispatch the correct tool', async () => {
    const s = freshWorkbenchSession();
    await runWorkbenchCommand('status', s);
    await runWorkbenchCommand('map yourself', s);
    await runWorkbenchCommand('read file README.md', s);
    await runWorkbenchCommand('search Aukora', s);
    expect(s.toolCallsUsed).toEqual(['status', 'self_map', 'read_file', 'search']);
  });

  it('refuses stateful commands run out of order with a clear error, not a crash', async () => {
    const s = freshWorkbenchSession();
    expect((await runWorkbenchCommand('sandbox apply', s)).some((e) => e.kind === 'error')).toBe(true);
    expect((await runWorkbenchCommand('run sandbox tests', s)).some((e) => e.kind === 'error')).toBe(true);
    expect((await runWorkbenchCommand('write receipt', s)).some((e) => e.kind === 'error')).toBe(true);
    expect((await runWorkbenchCommand('rollback sandbox', s)).some((e) => e.kind === 'error')).toBe(true);
    expect(s.toolCallsUsed.length).toBe(0);
  });

  it('propose patch rejects a malformed block (missing goal / missing file / unterminated)', async () => {
    const s = freshWorkbenchSession();
    expect((await runWorkbenchCommand('propose patch\n--- file: docs/x.md\nhi\n--- end', s)).some((e) => e.kind === 'error')).toBe(true);
    expect((await runWorkbenchCommand('propose patch\ngoal: g', s)).some((e) => e.kind === 'error')).toBe(true);
    expect((await runWorkbenchCommand('propose patch\ngoal: g\n--- file: docs/x.md\nhi', s)).some((e) => e.kind === 'error')).toBe(true);
  });

  it('full round-trip: propose -> sandbox apply -> run tests -> write receipt -> rollback, live repo untouched', async () => {
    const s = freshWorkbenchSession();
    const relPath = 'docs/WORKBENCH_LOOP_TEST_FIXTURE.md';
    const cmd = `propose patch\ngoal: loop test\n--- file: ${relPath}\nhello\n--- end`;

    const propose = await runWorkbenchCommand(cmd, s);
    const proposeResult = propose.find((e) => e.kind === 'tool_result' && e.tool === 'propose_patch');
    expect(proposeResult?.result?.ok).toBe(true);
    expect(s.lastProposal?.proposalHash).toBeTruthy();

    const apply = await runWorkbenchCommand('sandbox apply', s);
    const applyResult = apply.find((e) => e.kind === 'tool_result' && e.tool === 'sandbox_apply');
    expect(applyResult?.result?.ok).toBe(true);
    // the raw sandbox path must never appear in what would be sent to the browser
    expect(JSON.stringify(apply)).not.toMatch(/\/(tmp|private\/tmp|var\/folders)\/[^"]*aukora-apply-/);
    expect(s.lastSandboxPath).toBeTruthy();

    const tests = await runWorkbenchCommand('run sandbox tests', s);
    expect(tests.find((e) => e.kind === 'tool_result' && e.tool === 'run_tests')?.result?.ok).toBe(true);
    expect(s.lastTestResult?.passed).toBe(true);

    const receipt = await runWorkbenchCommand('write receipt', s);
    const receiptResult = receipt.find((e) => e.kind === 'tool_result' && e.tool === 'write_receipt');
    expect(receiptResult?.result?.ok).toBe(true);

    // Issue #25: "write receipt" now persists to disk (previously ONLY ever an in-memory tool_result)
    // and captures a real Kira receipt — the one branch Round 3 (issue #23) left uncaptured.
    const receiptFile = path.join(testHome, 'aumlok', 'receipts', `${s.lastProposal!.proposalHash}.json`);
    expect(fs.existsSync(receiptFile)).toBe(true);
    expect(JSON.parse(fs.readFileSync(receiptFile, 'utf-8')).proposalHash).toBe(s.lastProposal!.proposalHash);
    const { loadBrainState: loadKiraForReceiptCheck } = await import('../src/kiraBrain');
    expect(loadKiraForReceiptCheck(testKiraState).receipts.some((r: any) => r.source === 'workbench_write_receipt')).toBe(true);

    const rollback = await runWorkbenchCommand('rollback sandbox', s);
    const rollbackResult = rollback.find((e) => e.kind === 'tool_result' && e.tool === 'rollback_sandbox');
    expect(rollbackResult?.result?.ok).toBe(true);
    expect((rollbackResult?.result?.output as { sandboxRemoved: boolean }).sandboxRemoved).toBe(true);
    expect(s.lastSandboxPath).toBeNull();

    expect(fs.existsSync(path.join(REPO_ROOT, relPath))).toBe(false);
    expect(s.toolCallsUsed).toEqual(['propose_patch', 'sandbox_apply', 'run_tests', 'write_receipt', 'rollback_sandbox']);
  });

  it('refuses a proposal targeting a sacred path even via the chat command surface', async () => {
    const s = freshWorkbenchSession();
    const cmd = 'propose patch\ngoal: sneaky\n--- file: authority/aumlok/x.ts\nx\n--- end';
    const entries = await runWorkbenchCommand(cmd, s);
    const result = entries.find((e) => e.kind === 'tool_result' && e.tool === 'propose_patch');
    expect(result?.result?.ok).toBe(false);
  });
});

describe('workbenchCommandLoop: real test-runner commands (run typecheck / targeted test / full suite)', () => {
  it('refuses "run typecheck" with no prior proposal', async () => {
    const s = freshWorkbenchSession();
    expect((await runWorkbenchCommand('run typecheck', s)).some((e) => e.kind === 'error')).toBe(true);
  });

  it('"run typecheck" runs the real, isolated tsc and updates lastTestResult honestly', async () => {
    const s = freshWorkbenchSession();
    await runWorkbenchCommand('propose patch\ngoal: g\n--- file: docs/WCL_REAL_TEST_FIXTURE.md\nhi\n--- end', s);
    const entries = await runWorkbenchCommand('run typecheck', s);
    expect(entries.some((e) => e.kind === 'tool_call' && e.text.includes('runSandboxTestCommand(typecheck)'))).toBe(true);
    expect(s.lastTestResult?.passed).toBe(true);
    expect(fs.existsSync(path.join(REPO_ROOT, 'docs/WCL_REAL_TEST_FIXTURE.md'))).toBe(false);
  }, 30_000);

  it('"run targeted test <file>" runs exactly one real test file in isolation', async () => {
    const s = freshWorkbenchSession();
    await runWorkbenchCommand('propose patch\ngoal: g\n--- file: docs/WCL_REAL_TEST_FIXTURE2.md\nhi\n--- end', s);
    const entries = await runWorkbenchCommand('run targeted test ideToolContract.test.ts', s);
    expect(s.lastTestResult?.passed).toBe(true);
    expect(entries.some((e) => e.kind === 'tool_result' && e.text.includes('ideToolContract.test.ts'))).toBe(true);
  }, 30_000);

  it('"run targeted test" with a path-traversal filename refuses, never reaching outside core/tests', async () => {
    const s = freshWorkbenchSession();
    await runWorkbenchCommand('propose patch\ngoal: g\n--- file: docs/WCL_REAL_TEST_FIXTURE3.md\nhi\n--- end', s);
    await runWorkbenchCommand('run targeted test ../../etc/passwd.test.ts', s);
    expect(s.lastTestResult?.passed).toBe(false);
  }, 30_000);
});

describe('workbenchCommandLoop: "run fusion review" — reviewer only, never a hand', () => {
  // The chat wiring calls the REAL reviewSelfEditProposal (a real network call) with no injection point —
  // that function's own logic (quorum aggregation, secret-content guard, formatting) is already
  // thoroughly tested with fakes in selfEditReviewCouncil.test.ts. Here we only prove the WIRING: the
  // command is recognized, requires a prior proposal, and never authorizes/mutates anything regardless
  // of outcome — without making a real network call in this file (no API key is assumed present in CI).

  it('refuses with no proposal yet — never attempts the review at all', async () => {
    const s = freshWorkbenchSession();
    const entries = await runWorkbenchCommand('run fusion review', s);
    expect(entries.some((e) => e.kind === 'error')).toBe(true);
    expect(s.toolCallsUsed).toEqual([]);
  });

  it('WorkbenchSessionState has no field a Fusion/Kira VERDICT could ever be stashed into', () => {
    // "run fusion review" only ever pushes formatted text into the returned transcript entries — it
    // never writes a verdict onto `session` that could influence a LATER command's gating decision.
    // Re-justified for issue #23: `wombStore` was added deliberately (captureWithReceipt wiring), but
    // it is NOT a verdict/gating field — it's an opaque, write-only capture index; nothing in this
    // file ever reads a value back out of it to decide what a command is allowed to do. If a future
    // edit adds e.g. `lastFusionVerdict` to let advisory output gate later commands, THAT should still
    // break this test.
    const s = freshWorkbenchSession();
    expect(Object.keys(s).sort()).toEqual(['lastProposal', 'lastSandboxPath', 'lastTestResult', 'toolCallsUsed', 'wombStore'].sort());
  });

  it('the "apply signed proposal" handler never references review/fusion/kira — proposalHash + an externally-signed receipt are the only inputs', () => {
    const start = DISPATCHER_SRC.indexOf("trimmed.match(/^apply signed proposal");
    expect(start).toBeGreaterThan(-1);
    const block = DISPATCHER_SRC.slice(start, DISPATCHER_SRC.indexOf('\n\n', start + 800));
    expect(block).not.toMatch(/review|fusion|kira/i);
    expect(block).toMatch(/dispatchSignedLiveApply/);
    expect(block).toMatch(/readSignedPromotionReceiptFromFile/);
  });
});

describe('workbenchCommandLoop: "propose patch" writes a reviewable artifact + sign instructions', () => {
  it('writes the artifact under the test-overridden home dir and tells the owner the exact sign command', async () => {
    const s = freshWorkbenchSession();
    const entries = await runWorkbenchCommand('propose patch\ngoal: g\n--- file: docs/WCL_ARTIFACT_TEST.md\nhi\n--- end', s);
    const info = entries.find((e) => e.kind === 'info' && e.text.includes('Proposal artifact written'));
    expect(info).toBeTruthy();
    expect(info!.text).toContain('scripts/aumlok-authority.sh sign');
    expect(info!.text).toContain('apply signed proposal');
    // the artifact really exists on disk, under the OVERRIDDEN test home — never the repo, never the
    // developer's real ~/.aukora-symbiote
    const written = fs.readdirSync(path.join(testHome, 'aumlok', 'pending-proposals'));
    expect(written.length).toBe(1);
    expect(written[0]).toBe(`${s.lastProposal!.proposalHash}.json`);
  });

  // Issue #23 acceptance criterion: "a workbench round produces new Kira receipts" — proves
  // captureWorkbenchEvent actually lands a real, verifiable receipt on disk, not just in memory.
  it('a successful proposal lands a real, hash-chained receipt in Kira — not just the in-memory session', async () => {
    const { loadBrainState, verifyBrainState } = await import('../src/kiraBrain');
    const before = loadBrainState(testKiraState);
    expect(before.receipts.length).toBe(0); // fresh throwaway state, confirmed empty first

    const s = freshWorkbenchSession();
    await runWorkbenchCommand('propose patch\ngoal: capture test\n--- file: docs/WCL_CAPTURE_TEST.md\nhi\n--- end', s);

    const after = loadBrainState(testKiraState);
    expect(after.receipts.length).toBe(1);
    expect(after.atoms.length).toBe(1);
    expect(verifyBrainState(after).ok).toBe(true);
    expect(after.atoms[0].text).toContain('docs/WCL_CAPTURE_TEST.md');
  });

  // Issue #25 follow-up (Fable QA): captureWorkbenchEvent used to pass content straight through.
  // "propose_patch" itself already refuses a hex-shaped RELPATH (ideToolContract.ts's own separate
  // secret-shape output guard fires first, before capture is ever reached) — so this test targets the
  // scenario Fable actually flagged: a fusion review's free-text FINDINGS quoting a full hash, which
  // reaches captureWorkbenchEvent's content with no upstream guard in front of it at all.
  it('a fusion-review finding that quotes a raw 64-hex-char hash is truncated and still lands in Kira — no silent swallow (issue #25 follow-up)', async () => {
    const hexLike = 'a'.repeat(64);
    const glyph = `STANCE:⊕ CONFIDENCE:↑ STRATEGY:↙ FRAMEWORK:statistical DIST:(explore=0.25,exploit=0.25,verify=0.25,abstain=0.25) HYP:"receiptHash=${hexLike} looks fine"`;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: glyph } }] }) })) as any;
    // This test needs the fusion review to actually REACH the mocked fetch and produce a finding, which means
    // reviewSelfEditProposal's resolveApiKey() must return a key. On a dev machine ~/.local/share/opencode/auth.json
    // supplies one; a bare CI checkout has none, so without this the review fail-fasts (missing_key) and no
    // workbench_fusion_review atom is ever written. Pin a deterministic non-secret key (process.env is
    // resolveApiKey's first source) so the assertion is host-independent. Restored in finally.
    const prevKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'sk-test-fusion-ci-not-a-real-key';
    try {
      const s = freshWorkbenchSession();
      await runWorkbenchCommand('propose patch\ngoal: g\n--- file: docs/WCL_HEX_FUSION_TEST.md\nhi\n--- end', s);
      const entries = await runWorkbenchCommand('run fusion review', s);
      expect(entries.some((e) => e.kind === 'info' && e.text.startsWith('kira capture failed'))).toBe(false);

      const { loadBrainState } = await import('../src/kiraBrain');
      const atom = loadBrainState(testKiraState).atoms.find((a: any) => a.source === 'workbench_fusion_review');
      expect(atom).toBeTruthy();
      expect(atom!.text).not.toContain(hexLike); // the raw 64-char run must never land verbatim
      expect(atom!.text).toContain(hexLike.slice(0, 16)); // the truncated prefix IS preserved
    } finally {
      globalThis.fetch = originalFetch;
      if (prevKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = prevKey;
    }
  });

  // Issue #25 follow-up (Fable QA): the bare empty catch hid this exact failure class for two rounds.
  // A capture failure must now be a visible (but still non-fatal) transcript entry — the real command
  // (propose_patch here) must still succeed regardless.
  it('an unwritable Kira state path produces a visible transcript warning, but the real command still succeeds (issue #25 follow-up)', async () => {
    const blockerFile = path.join(testHome, 'kira-state-blocker');
    fs.writeFileSync(blockerFile, 'not a directory');
    process.env.AUKORA_KIRA_STATE = path.join(blockerFile, 'sub', 'brain.json'); // mkdirSync(recursive) throws ENOTDIR

    const s = freshWorkbenchSession();
    const entries = await runWorkbenchCommand('propose patch\ngoal: g\n--- file: docs/WCL_UNWRITABLE_KIRA_TEST.md\nhi\n--- end', s);
    process.env.AUKORA_KIRA_STATE = testKiraState; // restore before this test ends — outer afterEach cleans testKiraState's real dir

    const proposeResult = entries.find((e) => e.kind === 'tool_result' && e.tool === 'propose_patch');
    expect(proposeResult?.result?.ok).toBe(true); // advisory capture failure never blocks the real command
    const warning = entries.find((e) => e.kind === 'info' && e.text.startsWith('kira capture failed (advisory):'));
    expect(warning).toBeTruthy();
  });
});

describe('workbenchCommandLoop: "agent: <goal>" — Round 2 (issue #22), the model drives her own loop', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  function scriptedModelFetch(turns: Array<{ tool_calls?: Array<{ name: string; args: object }>; content?: string | null }>) {
    let call = 0;
    return vi.fn(async () => {
      const turn = turns[Math.min(call, turns.length - 1)];
      call++;
      const message: any = { content: turn.content ?? null };
      if (turn.tool_calls) {
        message.tool_calls = turn.tool_calls.map((tc, i) => ({
          id: `call_${call}_${i}`, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        }));
      }
      return { ok: true, json: async () => ({ choices: [{ message }] }) };
    });
  }

  it('requires a goal — "agent:" alone is an error, no tool call', async () => {
    const s = freshWorkbenchSession();
    const entries = await runWorkbenchCommand('agent:   ', s);
    expect(entries.some((e) => e.kind === 'error')).toBe(true);
    expect(s.toolCallsUsed).toEqual([]);
    expect(s.lastProposal).toBeNull();
  });

  it('the minimum demo: explores with her own tools, proposes once, sets lastProposal + writes the artifact — same as "propose patch"', async () => {
    globalThis.fetch = scriptedModelFetch([
      { tool_calls: [{ name: 'read_file', args: { relPath: 'core/src/restingGlyph.ts' } }] },
      { tool_calls: [{ name: 'propose_patch', args: { goal: 'add a clarifying comment', files: [{ relPath: 'core/src/restingGlyph.ts', content: '// clarifying comment\n' }] } }] },
    ]) as any;

    const s = freshWorkbenchSession();
    const entries = await runWorkbenchCommand('agent: add a one-line clarifying comment to core/src/restingGlyph.ts', s);

    // the transcript shows her OWN exploration, not the owner's
    expect(entries.some((e) => e.text.includes('read_file'))).toBe(true);
    expect(entries.some((e) => e.text.includes('propose_patch'))).toBe(true);

    expect(s.lastProposal).not.toBeNull();
    expect(s.lastProposal!.goal).toBe('add a clarifying comment');
    expect(s.lastProposal!.files[0].relPath).toBe('core/src/restingGlyph.ts');
    expect(s.lastProposal!.proposalHash).toBeTruthy();
    expect(s.lastSandboxPath).toBeNull();
    expect(s.lastTestResult).toBeNull();

    const info = entries.find((e) => e.kind === 'info' && e.text.includes('Proposal artifact written'));
    expect(info).toBeTruthy();
    expect(info!.text).toContain('scripts/aumlok-authority.sh sign');
    expect(info!.text).toContain('apply signed proposal');
    const written = fs.readdirSync(path.join(testHome, 'aumlok', 'pending-proposals'));
    expect(written.length).toBe(1);
    expect(written[0]).toBe(`${s.lastProposal!.proposalHash}.json`);

    // downstream commands work identically to a manually-typed proposal — the whole point of Round 2
    const sandboxEntries = await runWorkbenchCommand('sandbox apply', s);
    expect(sandboxEntries.some((e) => e.kind === 'error')).toBe(false);
    expect(s.lastSandboxPath).not.toBeNull();
  });

  it('a model that never calls propose_patch produces an error, never touches session.lastProposal', async () => {
    globalThis.fetch = scriptedModelFetch([{ content: 'no changes needed' }]) as any;
    const s = freshWorkbenchSession();
    const entries = await runWorkbenchCommand('agent: do something', s);
    expect(entries.some((e) => e.kind === 'error')).toBe(true);
    expect(s.lastProposal).toBeNull();
  });

  it('never exposes or calls sandbox_apply/run_tests/write_receipt/rollback_sandbox — only the owner-typed commands do', async () => {
    globalThis.fetch = scriptedModelFetch([
      { tool_calls: [{ name: 'propose_patch', args: { goal: 'g', files: [{ relPath: 'docs/AGENT_WCL_TEST.md', content: 'hi' }] } }] },
    ]) as any;
    const s = freshWorkbenchSession();
    await runWorkbenchCommand('agent: g', s);
    expect(s.toolCallsUsed).not.toContain('sandbox_apply');
    expect(s.toolCallsUsed).not.toContain('run_tests');
    expect(s.toolCallsUsed).not.toContain('write_receipt');
    expect(s.toolCallsUsed).not.toContain('rollback_sandbox');
  });
});

describe('workbenchCommandLoop: "apply signed proposal" — the only command that can touch the live repo', () => {
  // These tests only ever exercise refusal paths that are guaranteed to short-circuit BEFORE any file is
  // written or any git command runs, regardless of whether a real AUMLOK key happens to exist on this
  // machine (dispatchSignedLiveApply's public entrypoint always targets the REAL repo — by design, it has
  // no override — so these tests must never reach the actual write/commit code).

  it('refuses with no proposal in the session — never calls the live-apply dispatcher at all', async () => {
    const s = freshWorkbenchSession();
    const entries = await runWorkbenchCommand('apply signed proposal /tmp/whatever-signed.json', s);
    expect(entries.some((e) => e.kind === 'error')).toBe(true);
    expect(s.toolCallsUsed).toEqual([]);
  });

  it('refuses cleanly when the signed-receipt file does not exist', async () => {
    const s = freshWorkbenchSession();
    await runWorkbenchCommand('propose patch\ngoal: g\n--- file: docs/WCL_APPLY_TEST1.md\nhi\n--- end', s);
    const entries = await runWorkbenchCommand('apply signed proposal /definitely/does/not/exist.json', s);
    expect(entries.some((e) => e.kind === 'error')).toBe(true);
    expect(s.toolCallsUsed).not.toContain('signed_live_apply');
  });

  it('routes a well-formed-but-mismatched signed receipt to dispatchSignedLiveApply, which refuses at the hash-match check — before touching any manifest, key, or the live repo', async () => {
    const s = freshWorkbenchSession();
    await runWorkbenchCommand('propose patch\ngoal: g\n--- file: docs/WCL_APPLY_TEST2.md\nhi\n--- end', s);
    // #76: the receipt reader now confines reads to trusted dirs — write the (mismatched) receipt into the
    // trusted receipts dir so the test still exercises the dispatcher's HASH-MATCH refusal (its real intent),
    // not the new path guard. AUKORA_SYMBIOTE_HOME=testHome, so this is a trusted location.
    const receiptsDir = path.join(testHome, 'aumlok', 'receipts');
    fs.mkdirSync(receiptsDir, { recursive: true });
    const fakeSigned = path.join(receiptsDir, 'fake-signed.json');
    fs.writeFileSync(fakeSigned, JSON.stringify({
      schema: 'aumlok-signed-promotion-v1',
      authorization: { keyId: 'not-the-real-key', proposalHash: 'f'.repeat(64), draftHash: 'f'.repeat(64), nonce: 'n', issuedAt: new Date().toISOString(), expiresAt: null },
      algorithm: 'ed25519', signature: 'ab'.repeat(64), mode: 'dev_real', humanSignedAuthorization: true, promotionExecuted: false,
    }));
    const entries = await runWorkbenchCommand(`apply signed proposal ${fakeSigned}`, s);
    expect(s.toolCallsUsed).toContain('signed_live_apply');
    const result = entries.find((e) => e.kind === 'tool_result');
    expect(result!.text.startsWith('REFUSED')).toBe(true);
    // proves it never got far enough to write anything to the live repo
    expect(fs.existsSync(path.join(REPO_ROOT, 'docs/WCL_APPLY_TEST2.md'))).toBe(false);
  });

  // ── First-contact seam fix (2026-07-05): a FRESH session applies from the DISK artifact the signed
  // receipt names — the owner's signature is the pointer; the session is no longer load-bearing. ──

  const signedReceiptNaming = (proposalHash: string) => ({
    schema: 'aumlok-signed-promotion-v1',
    authorization: { keyId: 'not-the-real-key', proposalHash, draftHash: proposalHash, nonce: 'n1', issuedAt: new Date().toISOString(), expiresAt: null },
    algorithm: 'ed25519', signature: 'ab'.repeat(64), mode: 'dev_real', humanSignedAuthorization: true, promotionExecuted: false,
  });

  it('FRESH session + signed receipt + artifact on disk: loads the signed proposal by hash and reaches the dispatcher (which still verifies the signature itself)', async () => {
    // stage a real artifact in the pending-proposals dir (under testHome), exactly as a workbench run would
    const artifact = buildSelfEditProposalArtifact('seam-fix test goal', [{ relPath: 'docs/WCL_SEAM_TEST.md', content: 'hello' }]);
    writeSelfEditProposalArtifact(artifact);
    // a well-formed receipt NAMING that hash (its signature is fake — the dispatcher must refuse it, which
    // proves the load worked AND that loading from disk grants nothing: the signature check is unchanged)
    const receiptsDir = path.join(testHome, 'aumlok', 'receipts');
    fs.mkdirSync(receiptsDir, { recursive: true });
    const signedPath = path.join(receiptsDir, 'seam-signed.json');
    fs.writeFileSync(signedPath, JSON.stringify(signedReceiptNaming(artifact.proposalHash)));

    const s = freshWorkbenchSession(); // holds NO proposal — the old code refused here
    const entries = await runWorkbenchCommand(`apply signed proposal ${signedPath}`, s);
    expect(entries.some((e) => e.kind === 'info' && e.text.includes('loaded the SIGNED one from disk'))).toBe(true);
    expect(s.toolCallsUsed).toContain('signed_live_apply'); // it got THROUGH the seam to the real dispatcher
    const result = entries.find((e) => e.kind === 'tool_result');
    expect(result!.text.startsWith('REFUSED')).toBe(true); // fake signature refused — authority unchanged
    expect(fs.existsSync(path.join(REPO_ROOT, 'docs/WCL_SEAM_TEST.md'))).toBe(false); // live repo untouched
  });

  it('FRESH session + receipt naming a hash with NO artifact on disk: clean refusal, dispatcher never called', async () => {
    const receiptsDir = path.join(testHome, 'aumlok', 'receipts');
    fs.mkdirSync(receiptsDir, { recursive: true });
    const signedPath = path.join(receiptsDir, 'ghost-signed.json');
    fs.writeFileSync(signedPath, JSON.stringify(signedReceiptNaming('e'.repeat(64))));
    const s = freshWorkbenchSession();
    const entries = await runWorkbenchCommand(`apply signed proposal ${signedPath}`, s);
    expect(entries.some((e) => e.kind === 'error' && e.text.includes('could not be loaded from pending-proposals'))).toBe(true);
    expect(s.toolCallsUsed).toEqual([]);
  });

  it('a SWAPPED artifact (file renamed to a signed hash it does not match) is refused by the loader — a signed receipt cannot carry different bytes', async () => {
    const real = buildSelfEditProposalArtifact('the real goal', [{ relPath: 'docs/WCL_SEAM_SWAP.md', content: 'real' }]);
    const otherHash = 'd'.repeat(64);
    const dir = path.join(testHome, 'aumlok', 'pending-proposals');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${otherHash}.json`), JSON.stringify(real, null, 2)); // renamed-in-place swap
    const loaded = readPendingProposalByHash(otherHash);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.reason).toContain('DIFFERENT proposalHash');
    // and by-hash lookups never accept paths
    expect(readPendingProposalByHash('../../../etc/passwd').ok).toBe(false);
    expect(readPendingProposalByHash('/tmp/x.json').ok).toBe(false);
  });

  // Issue #25: the success branch below is deliberately UNREACHABLE from this test file — it calls
  // dispatchSignedLiveApply's real, no-override, real-repo write/commit path — so this is a structural
  // check instead of a functional one. It guards a real bug found while building issue #25: the raw
  // receipt embeds two 64-char sha256 hex fields (proposalHash, receiptHash), and passing that raw JSON
  // as Kira capture content silently fails every time (kiraBrain.ts's sanitizeText() throws on any
  // 64+ hex-char run as secret-shaped, caught and swallowed by captureWorkbenchEvent's own try/catch).
  // stageWriteReceipt's identical fix IS functionally regression-tested — see the "run:" describe block.
  //
  // Issue #37: this call site was upgraded from summarizeLiveApplyReceiptForCapture (a flat summary
  // string, now deleted — it had no other caller) to buildStateDigest (a structured digest, also
  // hex-safe by construction — see core/tests/stateDigest.test.ts for that safety proven directly).
  // The regression this test guards — never pass the raw receipt straight to JSON.stringify — still
  // applies to whichever mechanism is wired in, so the not.toMatch assertion is unchanged.
  it('the live-apply success branch captures via a safe state digest, never the raw receipt (issue #25 / #37)', () => {
    const start = DISPATCHER_SRC.indexOf('if (result.ok) {');
    expect(start).toBeGreaterThan(-1);
    const block = DISPATCHER_SRC.slice(start, DISPATCHER_SRC.indexOf('} else {', start));
    expect(block).toContain('buildStateDigest(');
    // seam fix 2026-07-05: the proposal may now be session-held OR disk-loaded-by-signed-hash, so the
    // capture reads from the resolved `proposal` local rather than session.lastProposal. Same digest
    // discipline, same call site.
    expect(block).toContain("captureWorkbenchEvent(entries, session, 'receipt', proposal.goal, digest.text, 'workbench_live_apply'");
    expect(block).not.toMatch(/captureWorkbenchEvent\([^;]*JSON\.stringify\(result\.receipt\)/);
  });
});

describe('workbenchCommandLoop: "run: <goal>" — chains agent -> sandbox apply -> content check -> fusion review -> write receipt (issue #25)', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  // The native agent (nativeToolCallingEngine.ts) and the fusion council (aukoraFuEngine.ts) hit the
  // SAME OpenRouter URL — distinguished here by whether the request body carries `tools` (only the
  // agent's function-calling request does). This keeps the test deterministic regardless of whether a
  // real OPENROUTER_API_KEY happens to be set in the local shell (reviewSelfEditProposal's own
  // missing-key fail-fast would otherwise make the fusion-review stage's behavior depend on ambient
  // environment rather than this test's own script).
  function scriptedRunFetch(agentTurns: Array<{ tool_calls?: Array<{ name: string; args: object }>; content?: string | null }>) {
    let agentCall = 0;
    return vi.fn(async (_url: unknown, opts: { body: string }) => {
      const body = JSON.parse(opts.body);
      if (Array.isArray(body.tools)) {
        const turn = agentTurns[Math.min(agentCall, agentTurns.length - 1)];
        agentCall++;
        const message: any = { content: turn.content ?? null };
        if (turn.tool_calls) {
          message.tool_calls = turn.tool_calls.map((tc, i) => ({
            id: `call_${agentCall}_${i}`, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          }));
        }
        return { ok: true, json: async () => ({ choices: [{ message }] }) };
      }
      // council glyph request — a single well-formed reply is enough for this file's purposes;
      // selfEditReviewCouncil.test.ts already covers quorum/verdict logic in depth, and this chain
      // never gates on the verdict either way (see stageFusionReview's own comment).
      const glyph = 'STANCE:⊕ CONFIDENCE:↑ STRATEGY:↙ FRAMEWORK:statistical DIST:(explore=0.25,exploit=0.25,verify=0.25,abstain=0.25) HYP:"looks fine"';
      return { ok: true, json: async () => ({ choices: [{ message: { content: glyph } }] }) };
    });
  }

  it('requires a goal — "run:" alone is an error, no tool call', async () => {
    const s = freshWorkbenchSession();
    const entries = await runWorkbenchCommand('run:   ', s);
    expect(entries.some((e) => e.kind === 'error')).toBe(true);
    expect(s.toolCallsUsed).toEqual([]);
  });

  it('full success: agent -> sandbox apply -> content check -> fusion review -> write receipt, receipt persisted to disk, honest labeling throughout', async () => {
    globalThis.fetch = scriptedRunFetch([
      { tool_calls: [{ name: 'propose_patch', args: { goal: 'run chain test', files: [{ relPath: 'docs/WCL_RUN_CHAIN_TEST.md', content: 'hello' }] } }] },
    ]) as any;

    const s = freshWorkbenchSession();
    const entries = await runWorkbenchCommand('run: add a doc note', s);

    // Issue #34/Round 6: the real typecheck stage now runs between content_check and fusion_review.
    expect(s.toolCallsUsed).toEqual(['propose_patch', 'sandbox_apply', 'run_tests', 'sandbox_test_typecheck', 'fusion_review', 'write_receipt']);
    expect(s.lastProposal).not.toBeNull();

    const report = entries.find((e) => e.kind === 'info' && e.text.startsWith('run:'));
    expect(report).toBeTruthy();
    expect(report!.text).toContain('chain complete');
    expect(report!.text).not.toMatch(/tests passed/i); // honest labeling — never overclaim the simulated check
    expect(report!.text).toContain('content check (simulated');
    // Issue #34/Round 6: both a simulated and a REAL check now appear, distinctly labeled — the real one
    // says so explicitly, and both stage names appear in the report as their own lines.
    expect(report!.text).toContain('typecheck (real, isolated tsc subprocess — a real typecheck run)');
    expect(report!.text).toMatch(/\[OK\] content_check —/);
    expect(report!.text).toMatch(/\[OK\] typecheck —/);
    expect(report!.text).toContain('real typecheck PASSED');

    // Issue #25 follow-up (Fable QA A4): report polish, exercised end-to-end (not just the unit-level
    // workbenchRunReport.test.ts) — tools-used aggregate, artifact path, the EXACT sign command in the
    // final AWAITING_OWNER_SIGNATURE line (not a "see above" pointer), and a rollback hint.
    expect(report!.text).toContain('propose_patch×1');
    expect(report!.text).toMatch(/proposal artifact: .*pending-proposals/);
    expect(report!.text).toContain('AWAITING_OWNER_SIGNATURE');
    expect(report!.text).toContain('bash scripts/aumlok-authority.sh sign');
    expect(report!.text).not.toMatch(/see the write_receipt stage detail above/i);
    expect(report!.text).toMatch(/rollback sandbox/i);

    // #51: a redacted evidence packet is also returned to chat — evidence, never authority; not live.
    const packet = entries.find((e) => e.kind === 'info' && e.text.startsWith('evidence packet'));
    expect(packet).toBeTruthy();
    expect(packet!.text).toContain('appliedLive: false');
    expect(packet!.text).toContain('AWAITING_OWNER_SIGNATURE');
    expect(packet!.text).toContain('grantsAuthority: false');
    expect(packet!.text).not.toMatch(/[0-9a-f]{40,}/); // no full hash leaks into chat

    const receiptsDir = path.join(testHome, 'aumlok', 'receipts');
    const written = fs.readdirSync(receiptsDir);
    expect(written.length).toBe(1);
    expect(written[0]).toBe(`${s.lastProposal!.proposalHash}.json`);
    const persisted = JSON.parse(fs.readFileSync(path.join(receiptsDir, written[0]), 'utf-8'));
    expect(persisted.proposalHash).toBe(s.lastProposal!.proposalHash);

    // Round 3's one uncaptured branch (issue #23 gap, closed by issue #25): write_receipt now lands a
    // real Kira receipt too, same as propose/apply/review already did.
    const { loadBrainState } = await import('../src/kiraBrain');
    const kira = loadBrainState(testKiraState);
    expect(kira.receipts.some((r: any) => r.source === 'workbench_write_receipt')).toBe(true);
  });

  it('stops honestly when the agent never produces a proposal — no downstream tool calls, no receipt written anywhere', async () => {
    globalThis.fetch = scriptedRunFetch([{ content: 'nothing to change here' }]) as any;
    const s = freshWorkbenchSession();
    const entries = await runWorkbenchCommand('run: is this fine?', s);

    expect(s.toolCallsUsed).toEqual([]); // agent stage itself never reaches a dispatcher tool call here
    expect(s.lastProposal).toBeNull();
    const report = entries.find((e) => e.kind === 'info' && e.text.startsWith('run:'));
    expect(report!.text).toContain('FAILED_AT: agent');
    expect(report!.text).not.toContain('chain complete');
    expect(fs.existsSync(path.join(testHome, 'aumlok', 'receipts'))).toBe(false);
  });

  it('never calls "apply signed proposal" itself — live-apply always stays a separate, owner-typed, signed step', async () => {
    globalThis.fetch = scriptedRunFetch([
      { tool_calls: [{ name: 'propose_patch', args: { goal: 'run chain test 2', files: [{ relPath: 'docs/WCL_RUN_CHAIN_TEST2.md', content: 'hello' }] } }] },
    ]) as any;
    const s = freshWorkbenchSession();
    await runWorkbenchCommand('run: add another doc note', s);
    expect(s.toolCallsUsed).not.toContain('signed_live_apply');
  });

  // Issue #25 follow-up (Fable QA A3): mid-chain failure tests — one per gap. Each asserts the correct
  // FAILED_AT terminal state, an empty receipts dir, no workbench_write_receipt capture, and (crucially)
  // that no LATER stage ran at all — the chain must stop, not just report a failure and keep going.
  describe('mid-chain failures stop the chain honestly (issue #25 follow-up)', () => {
    afterEach(() => { forceSandboxApplyFailure = false; forceContentCheckMismatch = false; });

    it('a forced sandbox_apply failure: FAILED_AT: sandbox_apply, no content check, no fusion spend, no receipt', async () => {
      forceSandboxApplyFailure = true;
      globalThis.fetch = scriptedRunFetch([
        { tool_calls: [{ name: 'propose_patch', args: { goal: 'g', files: [{ relPath: 'docs/WCL_FORCED_SANDBOX_FAIL.md', content: 'hi' }] } }] },
      ]) as any;
      const s = freshWorkbenchSession();
      const entries = await runWorkbenchCommand('run: forced sandbox_apply failure', s);

      expect(s.toolCallsUsed).toEqual(['propose_patch', 'sandbox_apply']); // never reached run_tests/fusion_review/write_receipt
      const report = entries.find((e) => e.kind === 'info' && e.text.startsWith('run:'));
      expect(report!.text).toContain('FAILED_AT: sandbox_apply');
      expect(report!.text).not.toContain('chain complete');
      expect(fs.existsSync(path.join(testHome, 'aumlok', 'receipts'))).toBe(false);

      const { loadBrainState } = await import('../src/kiraBrain');
      expect(loadBrainState(testKiraState).receipts.some((r: any) => r.source === 'workbench_write_receipt')).toBe(false);
    });

    it('a content-check MISMATCH: FAILED_AT: content_check, no fusion spend, no receipt (the chain\'s own integrity check, not a Fusion gate)', async () => {
      forceContentCheckMismatch = true;
      globalThis.fetch = scriptedRunFetch([
        { tool_calls: [{ name: 'propose_patch', args: { goal: 'g', files: [{ relPath: 'docs/WCL_FORCED_MISMATCH.md', content: 'hi' }] } }] },
      ]) as any;
      const s = freshWorkbenchSession();
      const entries = await runWorkbenchCommand('run: forced content check mismatch', s);

      expect(s.toolCallsUsed).toEqual(['propose_patch', 'sandbox_apply', 'run_tests']); // never reached fusion_review/write_receipt
      const report = entries.find((e) => e.kind === 'info' && e.text.startsWith('run:'));
      expect(report!.text).toContain('FAILED_AT: content_check');
      expect(report!.text).toContain('MISMATCH');
      expect(report!.text).not.toContain('chain complete');
      expect(fs.existsSync(path.join(testHome, 'aumlok', 'receipts'))).toBe(false);

      const { loadBrainState } = await import('../src/kiraBrain');
      expect(loadBrainState(testKiraState).receipts.some((r: any) => r.source === 'workbench_write_receipt')).toBe(false);
    });

    // Issue #34/Round 6: unlike the sandbox_apply/content_check cases above, a real typecheck failure
    // needs no dispatcher stub — proposing genuinely invalid TypeScript is a real, natural way to fail
    // the real tsc subprocess, exactly the same way a human would.
    it('a real typecheck FAILURE: FAILED_AT: typecheck, no fusion spend, no receipt (a real tsc error, not simulated)', async () => {
      globalThis.fetch = scriptedRunFetch([
        { tool_calls: [{ name: 'propose_patch', args: { goal: 'g', files: [{ relPath: 'core/src/WCL_TYPECHECK_FAIL_FIXTURE.ts', content: 'const x: number = "not a number"; export { x };' }] } }] },
      ]) as any;
      const s = freshWorkbenchSession();
      const entries = await runWorkbenchCommand('run: forced real typecheck failure', s);

      // never reached fusion_review/write_receipt
      expect(s.toolCallsUsed).toEqual(['propose_patch', 'sandbox_apply', 'run_tests', 'sandbox_test_typecheck']);
      const report = entries.find((e) => e.kind === 'info' && e.text.startsWith('run:'));
      expect(report!.text).toContain('FAILED_AT: typecheck');
      expect(report!.text).toContain('real typecheck FAILED');
      expect(report!.text).not.toContain('chain complete');
      expect(fs.existsSync(path.join(testHome, 'aumlok', 'receipts'))).toBe(false);

      const { loadBrainState } = await import('../src/kiraBrain');
      expect(loadBrainState(testKiraState).receipts.some((r: any) => r.source === 'workbench_write_receipt')).toBe(false);
    }, 30000);

    // A3.1: a throw from ANY stage must still produce a report, not an unhandled rejection. Simulated
    // here via an unwritable Kira state path colliding with the agent stage's own captureWorkbenchEvent
    // call would just produce a warning (advisory, non-fatal) — a REAL throw needs a genuine exception
    // from inside the try block. persistWorkbenchReceipt (fs.mkdirSync/writeFileSync) is the one real,
    // legitimately-throwing call in the chain that ISN'T already wrapped in its own try/catch.
    it('a throw from persistWorkbenchReceipt (write_receipt stage) produces a FAILED_AT report, not an unhandled rejection', async () => {
      globalThis.fetch = scriptedRunFetch([
        { tool_calls: [{ name: 'propose_patch', args: { goal: 'g', files: [{ relPath: 'docs/WCL_FORCED_RECEIPT_THROW.md', content: 'hi' }] } }] },
      ]) as any;
      // Force ONLY the receipts dir to collide with an existing FILE (not a directory), so
      // fs.mkdirSync(aumlokReceiptsDir(), {recursive:true}) throws ENOTDIR inside persistWorkbenchReceipt
      // — the SIBLING pending-proposals dir (used by the earlier agent stage) is left untouched.
      const aumlokDir = path.join(testHome, 'aumlok');
      fs.mkdirSync(aumlokDir, { recursive: true });
      fs.writeFileSync(path.join(aumlokDir, 'receipts'), 'not a directory');

      const s = freshWorkbenchSession();
      const entries = await runWorkbenchCommand('run: forced receipt persistence throw', s);

      const report = entries.find((e) => e.kind === 'info' && e.text.startsWith('run:'));
      expect(report).toBeTruthy(); // a report was produced at all — no unhandled rejection escaped
      expect(report!.text).toContain('FAILED_AT: write_receipt');
      expect(report!.text).toContain('threw:');
      expect(report!.text).not.toContain('chain complete');
    });
  });
});

describe('workbenchCommandLoop: #35 proposal-intent → governed artifact (authorship, not self-modification)', () => {
  let originalFetch: typeof globalThis.fetch;
  const bodies: string[] = [];
  beforeEach(() => { originalFetch = globalThis.fetch; bodies.length = 0; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  // scripts the model's turns AND captures each outbound request body (to inspect the agent goal it received).
  function scriptedCapturingFetch(turns: Array<{ tool_calls?: Array<{ name: string; args: object }>; content?: string | null }>) {
    let i = 0;
    return vi.fn(async (_url: unknown, init?: { body: string }) => {
      if (init?.body) bodies.push(init.body);
      const turn = turns[Math.min(i, turns.length - 1)]; i++;
      const message = turn.tool_calls
        ? { content: turn.content ?? null, tool_calls: turn.tool_calls.map((tc, k) => ({ id: `c${k}`, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args) } })) }
        : { content: turn.content ?? 'done' };
      return { ok: true, json: async () => ({ choices: [{ message, finish_reason: turn.tool_calls ? 'tool_calls' : 'stop' }] }) } as any;
    });
  }

  const DRAFT = [
    'draft intent:',
    'goal: add a one-line clarifying comment',
    'rationale: a reader asked about the resolver rule',
    'path: core/src/repoReadPathResolver.ts [inferred] maybe here',
    'risk: comment-only',
  ].join('\n');

  it('"draft intent:" authors an advisory intent (writes NO repo file), and points at agent: --from-proposal <id>', async () => {
    const s = freshWorkbenchSession();
    const entries = await runWorkbenchCommand(DRAFT, s);
    const info = entries.find((e) => e.kind === 'info' && /Proposal-intent drafted/.test(e.text));
    expect(info).toBeTruthy();
    expect(info!.text).toMatch(/advisory only — nothing is proposed, verified, signed, or applied/);
    expect(info!.text).toMatch(/agent: --from-proposal [0-9a-f]{64}/);
    // it landed in pending-INTENTS (not pending-proposals) — an intent is not a proposal
    const intents = fs.readdirSync(path.join(testHome, 'aumlok', 'pending-intents'));
    expect(intents.length).toBe(1);
    expect(fs.existsSync(path.join(testHome, 'aumlok', 'pending-proposals'))).toBe(false);

    // #51: a DRAFT-ONLY evidence packet returns to chat — clearly not a proposal, not live.
    const packet = entries.find((e) => e.kind === 'info' && e.text.startsWith('evidence packet'));
    expect(packet).toBeTruthy();
    expect(packet!.text).toContain('DRAFT ONLY');
    expect(packet!.text).toContain('appliedLive: false');
    expect(packet!.text).not.toMatch(/[0-9a-f]{40,}/); // intent id hex-collapsed, no full hash in chat
  });

  it('a "draft intent:" with no goal / no path is refused', async () => {
    const s = freshWorkbenchSession();
    expect((await runWorkbenchCommand('draft intent:\nrationale: x', s)).some((e) => e.kind === 'error')).toBe(true);
    expect((await runWorkbenchCommand('draft intent:\ngoal: x', s)).some((e) => e.kind === 'error')).toBe(true); // no path
  });

  it('"agent: --from-proposal <id>" RE-READS disk and builds the artifact from what the agent read — NOT the intent', async () => {
    const s = freshWorkbenchSession();
    const draft = ['draft intent:', 'goal: tidy a comment', 'path: core/src/restingGlyph.ts [inferred]'].join('\n');
    const draftEntries = await runWorkbenchCommand(draft, s);
    const id = draftEntries.find((e) => /agent: --from-proposal/.test(e.text))!.text.match(/--from-proposal ([0-9a-f]{64})/)![1];

    // the model reads the real file, then proposes its OWN grounded content
    globalThis.fetch = scriptedCapturingFetch([
      { tool_calls: [{ name: 'read_file', args: { relPath: 'core/src/restingGlyph.ts' } }] },
      { tool_calls: [{ name: 'propose_patch', args: { goal: 'tidy a comment', files: [{ relPath: 'core/src/restingGlyph.ts', content: '// grounded content the agent actually produced\n' }] } }] },
    ]) as any;

    const s2 = freshWorkbenchSession();
    const entries = await runWorkbenchCommand(`agent: --from-proposal ${id}`, s2);

    expect(entries.some((e) => /Ingesting proposal-intent/.test(e.text))).toBe(true);
    expect(s2.lastProposal).not.toBeNull();
    expect(s2.lastProposal!.files[0].content).toBe('// grounded content the agent actually produced\n');
    // the artifact hash is the CANONICAL computeProposalHash of goal+files (never a second impl)
    const { computeProposalHash } = await import('../src/proposalHash');
    expect(s2.lastProposal!.proposalHash).toBe(computeProposalHash(s2.lastProposal!.goal, s2.lastProposal!.files));
    // the model actually received the honest intent framing (re-read disk; guesses labelled)
    const userMsg = JSON.parse(bodies[0]).messages.find((m: any) => m.role === 'user').content as string;
    expect(userMsg).toContain('READ the real files yourself');
    expect(userMsg).toContain('[inferred]');
    // a real, disk-verified proposal artifact was written for the owner to sign
    const written = fs.readdirSync(path.join(testHome, 'aumlok', 'pending-proposals'));
    expect(written).toContain(`${s2.lastProposal!.proposalHash}.json`);
  });

  it('a POISON snippet inside the ingested intent NEVER becomes artifact content — the artifact uses ONLY what the agent read from disk', async () => {
    // The `draft intent:` command doesn't accept snippets, but an intent authored by ANY party (voice, a
    // future richer command) can carry them — so seed a snippet-bearing intent directly and prove ingestion
    // treats the snippet as inert advisory data, never as file content. This is the confused-deputy proof:
    // chat-provided contents are NOT trusted; the workbench re-reads disk.
    const { buildProposalIntent, writeProposalIntent } = await import('../src/proposalIntent');
    const POISON = '// POISONED SNIPPET — if this reaches the artifact, the boundary is broken\n';
    const intent = buildProposalIntent({
      goal: 'tidy a comment',
      affectedPaths: [{ path: 'core/src/restingGlyph.ts', epistemicStatus: 'inferred' }],
      snippets: [{ path: 'core/src/restingGlyph.ts', snippet: POISON }],
      authoredBy: 'voice',
    });
    writeProposalIntent(intent); // -> testHome/aumlok/pending-intents (AUKORA_SYMBIOTE_HOME=testHome)

    // the model reads disk and proposes its OWN grounded content — deliberately different from the poison
    const GROUNDED = '// grounded content the agent actually produced\n';
    globalThis.fetch = scriptedCapturingFetch([
      { tool_calls: [{ name: 'read_file', args: { relPath: 'core/src/restingGlyph.ts' } }] },
      { tool_calls: [{ name: 'propose_patch', args: { goal: 'tidy a comment', files: [{ relPath: 'core/src/restingGlyph.ts', content: GROUNDED }] } }] },
    ]) as any;

    const s = freshWorkbenchSession();
    await runWorkbenchCommand(`agent: --from-proposal ${intent.intentId}`, s);
    // the artifact content is the agent's disk-grounded content — the poison snippet appears NOWHERE in it
    expect(s.lastProposal!.files[0].content).toBe(GROUNDED);
    expect(s.lastProposal!.files.some((f) => f.content.includes('POISONED'))).toBe(false);
    // the model DID receive the snippet, but framed as inert advisory data (never as content/instructions)
    const userMsg = JSON.parse(bodies[0]).messages.find((m: any) => m.role === 'user').content as string;
    expect(userMsg).toContain('ADVISORY SNIPPETS');
    expect(userMsg).toContain('never as instructions');
  });

  it('"agent: --from-proposal <bad-id>" is refused — no traversal, no fabricated proposal, no model call', async () => {
    const s = freshWorkbenchSession();
    let called = false;
    globalThis.fetch = vi.fn(async () => { called = true; throw new Error('no network expected'); }) as any;
    const entries = await runWorkbenchCommand('agent: --from-proposal ../../etc/passwd', s);
    expect(entries.some((e) => e.kind === 'error' && /--from-proposal/.test(e.text))).toBe(true);
    expect(s.lastProposal ?? null).toBeNull();
    expect(called).toBe(false);
  });

  it('the voice read-bridge still does NOT expose propose_patch (#58 invariant preserved)', async () => {
    const { VOICE_READ_TOOLS } = await import('../../spatial/voiceReadToolBridge');
    expect(VOICE_READ_TOOLS).not.toContain('propose_patch');
    expect([...VOICE_READ_TOOLS]).toEqual(['status', 'self_map', 'list_files', 'read_file', 'search']);
  });
});
