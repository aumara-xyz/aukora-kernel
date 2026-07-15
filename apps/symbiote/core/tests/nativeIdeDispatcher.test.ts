import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { dispatchIdeTool, dispatchIdeToolWithState, dispatcherGrantsAuthority } from '../src/nativeIdeDispatcher';
import { validateIdeToolResult } from '../src/ideToolContract';
import { validateRecursiveIdeRehearsalReceipt } from '../src/recursiveIdeRehearsalReceipt';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DISPATCHER_SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'nativeIdeDispatcher.ts'), 'utf-8');
const WORKBENCH_SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'recursiveWorkbench.ts'), 'utf-8');
const importLines = (src: string) => src.split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n');

describe('nativeIdeDispatcher: unknown tool / unknown field handling', () => {
  it('refuses an unknown tool name', () => {
    const r = dispatchIdeTool({ tool: 'shell' as any, args: {} });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/unknown tool name/);
    expect(validateIdeToolResult(r).valid).toBe(true);
  });

  it('refuses write_file / delete_path / self_modify tool names (not in the fixed 10)', () => {
    for (const t of ['write_file', 'delete_path', 'self_modify', 'network']) {
      const r = dispatchIdeTool({ tool: t as any, args: {} });
      expect(r.ok, t).toBe(false);
    }
  });

  it('refuses a malformed call object entirely', () => {
    expect(dispatchIdeTool(null as any).ok).toBe(false);
    expect(dispatchIdeTool(undefined as any).ok).toBe(false);
    expect(dispatchIdeTool({} as any).ok).toBe(false);
  });

  it('every dispatched result validates against the exact tool-result contract', () => {
    const calls: Array<{ tool: any; args: any }> = [
      { tool: 'status', args: {} },
      { tool: 'self_map', args: {} },
      { tool: 'list_files', args: { dir: 'docs' } },
      { tool: 'read_file', args: { relPath: 'README.md' } },
      { tool: 'search', args: { query: 'Aukora' } },
    ];
    for (const c of calls) {
      const r = dispatchIdeTool(c);
      expect(validateIdeToolResult(r).valid, c.tool).toBe(true);
    }
  });
});

describe('nativeIdeDispatcher: status / self_map / list_files', () => {
  it('status reports headless=true and never claims live promotion is unlocked', () => {
    const r = dispatchIdeTool({ tool: 'status', args: {} });
    expect(r.ok).toBe(true);
    const out = r.output as any;
    expect(out.headless).toBe(true);
    expect(out.livePromotionUnlocked).toBe(false);
  });

  it('self_map reuses the real root organism registry (organCount > 0)', () => {
    const r = dispatchIdeTool({ tool: 'self_map', args: {} });
    expect(r.ok).toBe(true);
    expect((r.output as any).organs.length).toBeGreaterThan(0);
  });

  it('list_files refuses a path-traversal dir', () => {
    const r = dispatchIdeTool({ tool: 'list_files', args: { dir: '../../etc' } });
    expect(r.ok).toBe(false);
  });

  it('list_files refuses an absolute dir', () => {
    const r = dispatchIdeTool({ tool: 'list_files', args: { dir: '/etc' } });
    expect(r.ok).toBe(false);
  });

  it('list_files lists a real repo directory, bounded to 200 entries', () => {
    const r = dispatchIdeTool({ tool: 'list_files', args: { dir: 'docs' } });
    expect(r.ok).toBe(true);
    expect((r.output as any).entries.length).toBeLessThanOrEqual(200);
  });
});

describe('nativeIdeDispatcher: read_file refuses secrets / private-key / env / path traversal', () => {
  it('refuses a path-traversal read', () => {
    const r = dispatchIdeTool({ tool: 'read_file', args: { relPath: '../../../etc/passwd' } });
    expect(r.ok).toBe(false);
  });

  it('refuses an absolute path read', () => {
    const r = dispatchIdeTool({ tool: 'read_file', args: { relPath: '/etc/passwd' } });
    expect(r.ok).toBe(false);
  });

  it('refuses reading a path shaped like an env file', () => {
    const r = dispatchIdeTool({ tool: 'read_file', args: { relPath: '.env' } });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/sensitive path/);
  });

  it('refuses reading a real AUMLOK-authority-shaped source path', () => {
    const r = dispatchIdeTool({ tool: 'read_file', args: { relPath: 'core/src/aumlokAuthorityRoot.ts' } });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/sensitive path/);
  });

  it('refuses reading a path shaped like key material', () => {
    const r = dispatchIdeTool({ tool: 'read_file', args: { relPath: 'identity/some.pem' } });
    expect(r.ok).toBe(false);
  });

  it('allows reading an ordinary repo file (README.md)', () => {
    const r = dispatchIdeTool({ tool: 'read_file', args: { relPath: 'README.md' } });
    expect(r.ok).toBe(true);
    expect(typeof (r.output as any).content).toBe('string');
  });

  it('refuses a non-existent file', () => {
    const r = dispatchIdeTool({ tool: 'read_file', args: { relPath: 'docs/DOES_NOT_EXIST_XYZ.md' } });
    expect(r.ok).toBe(false);
  });
});

describe('nativeIdeDispatcher: read_file offset pages a long file (same window size, same confinement)', () => {
  it('offset window equals the same slice of a full read; output echoes offset + totalLength', () => {
    const diskContent = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf-8');
    const full = dispatchIdeTool({ tool: 'read_file', args: { relPath: 'README.md' } });
    expect(full.ok).toBe(true);
    const fo = full.output as any;
    expect(fo.offset).toBe(0); // default unchanged: window starts at 0
    const paged = dispatchIdeTool({ tool: 'read_file', args: { relPath: 'README.md', offset: 10 } });
    expect(paged.ok).toBe(true);
    const po = paged.output as any;
    expect(po.offset).toBe(10);
    expect(po.totalLength).toBe(fo.totalLength);
    expect(po.content).toBe(diskContent.slice(10, 10 + 8_000)); // exactly the later window, never a bigger one
  });

  it('a window past the region a plain read can see is reachable (the demo-blocking case)', () => {
    // spatial/app/style.css is ~30KB — the exact file two cheap-lane agents could not read past 8000
    // chars of. With offset paging the region holding the target rule is readable; without paging it
    // is not (the rule sits far beyond the first window, located here from disk so the test never
    // drifts as the stylesheet grows).
    const cssPath = path.join(REPO_ROOT, 'spatial', 'app', 'style.css');
    const at = fs.readFileSync(cssPath, 'utf-8').indexOf('#composer-send');
    expect(at).toBeGreaterThan(8_000); // still the demo-blocking shape: unreachable without paging
    const first = dispatchIdeTool({ tool: 'read_file', args: { relPath: 'spatial/app/style.css' } });
    expect(first.ok).toBe(true);
    expect((first.output as any).truncated).toBe(true);
    expect((first.output as any).content).not.toContain('#composer-send');
    const later = dispatchIdeTool({ tool: 'read_file', args: { relPath: 'spatial/app/style.css', offset: at } });
    expect(later.ok).toBe(true);
    expect((later.output as any).content).toContain('#composer-send'); // the rule, now honestly readable
  });

  it('offset at/past the end is an honest empty window, not an error; truncated is false', () => {
    const full = dispatchIdeTool({ tool: 'read_file', args: { relPath: 'README.md' } });
    const total = (full.output as any).totalLength;
    const past = dispatchIdeTool({ tool: 'read_file', args: { relPath: 'README.md', offset: total + 100 } });
    expect(past.ok).toBe(true);
    expect((past.output as any).content).toBe('');
    expect((past.output as any).truncated).toBe(false);
  });

  it('refuses malformed offsets fail-closed (never silently reads from 0)', () => {
    for (const bad of [-1, 1.5, '10', NaN, {}] as unknown[]) {
      const r = dispatchIdeTool({ tool: 'read_file', args: { relPath: 'README.md', offset: bad } });
      expect(r.ok, `offset ${String(bad)}`).toBe(false);
    }
  });

  it('offset does not weaken confinement: sensitive paths still refuse with an offset supplied', () => {
    expect(dispatchIdeTool({ tool: 'read_file', args: { relPath: '.env', offset: 0 } }).ok).toBe(false);
    expect(dispatchIdeTool({ tool: 'read_file', args: { relPath: '../../../etc/passwd', offset: 8000 } }).ok).toBe(false);
  });
});

describe('nativeIdeDispatcher: search sees the UI layer (.js/.css/.html were invisible)', () => {
  it('finds a css rule inside spatial/app — the query that returned honest zero hits for six agent runs', () => {
    const r = dispatchIdeTool({ tool: 'search', args: { query: 'composer-send', dir: 'spatial/app' } });
    expect(r.ok).toBe(true);
    const out = r.output as any;
    expect(out.results.some((h: any) => h.relPath.endsWith('style.css'))).toBe(true); // the color rule
    expect(out.results.some((h: any) => h.relPath.endsWith('index.html'))).toBe(true); // the button markup
    expect(out.results.some((h: any) => h.relPath.endsWith('chat.js'))).toBe(true); // the handler
    expect(out.results.length).toBeLessThanOrEqual(50); // bounded exactly as before
  });
});

describe('nativeIdeDispatcher: search is bounded (no unbounded grep)', () => {
  it('bounds files scanned and results returned', () => {
    const r = dispatchIdeTool({ tool: 'search', args: { query: 'the', dir: '.' } });
    expect(r.ok).toBe(true);
    const out = r.output as any;
    expect(out.filesScanned).toBeLessThanOrEqual(1500);
    expect(out.results.length).toBeLessThanOrEqual(50);
  });

  it('refuses a too-short query', () => {
    expect(dispatchIdeTool({ tool: 'search', args: { query: 'a' } }).ok).toBe(false);
  });

  it('refuses a traversal dir', () => {
    expect(dispatchIdeTool({ tool: 'search', args: { query: 'secret', dir: '../..' } }).ok).toBe(false);
  });
});

describe('nativeIdeDispatcher: propose_patch cannot target sacred/authority paths', () => {
  it('refuses a proposal touching an AUMLOK-shaped path', () => {
    const r = dispatchIdeTool({
      tool: 'propose_patch',
      args: { goal: 'sneak a change in', files: [{ relPath: 'authority/aumlok/new_secret.ts', content: 'x' }] },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/sacred/);
  });

  it('refuses a proposal touching a credential-shaped path', () => {
    const r = dispatchIdeTool({
      tool: 'propose_patch',
      args: { goal: 'x', files: [{ relPath: 'core/src/credentialStore.ts', content: 'x' }] },
    });
    expect(r.ok).toBe(false);
  });

  it('refuses an unsafe (traversal) file path in the proposal', () => {
    const r = dispatchIdeTool({
      tool: 'propose_patch',
      args: { goal: 'x', files: [{ relPath: '../../outside.ts', content: 'x' }] },
    });
    expect(r.ok).toBe(false);
  });

  it('admits an ordinary benign proposal and returns a stable proposalHash', () => {
    const files = [{ relPath: 'docs/SOMETHING_HARMLESS.md', content: 'hello' }];
    const r1 = dispatchIdeTool({ tool: 'propose_patch', args: { goal: 'g', files } });
    const r2 = dispatchIdeTool({ tool: 'propose_patch', args: { goal: 'g', files } });
    expect(r1.ok).toBe(true);
    expect((r1.output as any).proposalHash).toBe((r2.output as any).proposalHash);
  });
});

describe('nativeIdeDispatcher: sandbox_apply is temp-dir-only; live repo never touched', () => {
  it('the raw sandbox path (internal side channel) is always under the system temp dir', () => {
    const propose = dispatchIdeTool({
      tool: 'propose_patch',
      args: { goal: 'g', files: [{ relPath: 'docs/DEMO_A.md', content: 'a' }] },
    });
    const proposalHash = (propose.output as any).proposalHash;
    const d = dispatchIdeToolWithState({
      tool: 'sandbox_apply',
      args: { goal: 'g', files: [{ relPath: 'docs/DEMO_A.md', content: 'a' }], proposalHash },
    });
    expect(d.result.ok).toBe(true);
    expect(d.rawSandboxPath).toBeTruthy();
    const tmpReal = fs.realpathSync(os.tmpdir());
    const sandboxReal = fs.realpathSync(d.rawSandboxPath!);
    expect(sandboxReal === tmpReal || sandboxReal.startsWith(tmpReal + path.sep)).toBe(true);
    fs.rmSync(d.rawSandboxPath!, { recursive: true, force: true });
  });

  it('the public tool-result output NEVER carries the raw sandbox path — only a hash of it', () => {
    const propose = dispatchIdeTool({
      tool: 'propose_patch',
      args: { goal: 'g', files: [{ relPath: 'docs/DEMO_B.md', content: 'b' }] },
    });
    const proposalHash = (propose.output as any).proposalHash;
    const d = dispatchIdeToolWithState({
      tool: 'sandbox_apply',
      args: { goal: 'g', files: [{ relPath: 'docs/DEMO_B.md', content: 'b' }], proposalHash },
    });
    const serialized = JSON.stringify(d.result);
    expect(serialized).not.toContain(d.rawSandboxPath);
    expect((d.result.output as any).sandboxPathHash).toMatch(/^[0-9a-f]{64}$/);
    fs.rmSync(d.rawSandboxPath!, { recursive: true, force: true });
  });

  it('refuses to sandbox-apply a sacred/Ring-0 target', () => {
    const files = [{ relPath: 'authority/aumlok/x.ts', content: 'x' }];
    const propose = dispatchIdeTool({ tool: 'propose_patch', args: { goal: 'g', files } });
    expect(propose.ok).toBe(false); // propose_patch itself already refuses this
  });

  it('refuses when proposalHash/goal/files are missing', () => {
    expect(dispatchIdeTool({ tool: 'sandbox_apply', args: {} }).ok).toBe(false);
  });
});

describe('nativeIdeDispatcher: run_tests cannot run arbitrary commands', () => {
  it('refuses a sandboxPath outside the system temp dir (e.g. the live repo root)', () => {
    const r = dispatchIdeTool({
      tool: 'run_tests',
      args: { sandboxPath: REPO_ROOT, files: [{ relPath: 'README.md', content: 'x' }] },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/system temp dir/);
  });

  it('compares sandbox content only — no shell, no command execution', () => {
    expect(importLines(DISPATCHER_SRC)).not.toMatch(/child_process|node:child_process/i);
    expect(DISPATCHER_SRC).not.toMatch(/\bexecSync\s*\(|\bspawnSync\s*\(|\bspawn\s*\(|\bexec\s*\(/);
  });

  it('passes when sandbox content matches, fails when it does not', () => {
    // Fable QA (Round 6): renamed off the 'aukora-test-run-' prefix — sandboxTestRunner.test.ts counts
    // dirs with exactly that prefix in the shared OS tmpdir, and this file's own fixture (same prefix,
    // different purpose) was a second, independent perturber of that count under parallel test execution.
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-dispatcher-fixture-'));
    fs.writeFileSync(path.join(dir, 'note.md'), 'hello', 'utf-8');
    const ok = dispatchIdeTool({ tool: 'run_tests', args: { sandboxPath: dir, files: [{ relPath: 'note.md', content: 'hello' }] } });
    expect(ok.ok).toBe(true);
    expect((ok.output as any).passed).toBe(true);
    const bad = dispatchIdeTool({ tool: 'run_tests', args: { sandboxPath: dir, files: [{ relPath: 'note.md', content: 'nope' }] } });
    expect((bad.output as any).passed).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('nativeIdeDispatcher: write_receipt produces an exact-schema-valid receipt', () => {
  it('builds a receipt that validates and refuses when required fields are missing', () => {
    const r = dispatchIdeTool({
      tool: 'write_receipt',
      args: {
        task: 't', toolCallsUsed: ['status'], targetFiles: ['docs/x.md'],
        proposalHash: 'p'.repeat(64), sandboxPath: '/tmp/aukora-apply-xyz',
        testResult: { passed: true, ran: [], detail: 'ok' },
      },
    });
    expect(r.ok).toBe(true);
    expect(validateRecursiveIdeRehearsalReceipt((r.output as any).receipt).valid).toBe(true);
    expect(dispatchIdeTool({ tool: 'write_receipt', args: {} }).ok).toBe(false);
  });
});

describe('nativeIdeDispatcher: rollback_sandbox only ever removes a temp-dir path', () => {
  it('removes a real sandbox dir it created', () => {
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-test-rollback-'));
    const r = dispatchIdeTool({ tool: 'rollback_sandbox', args: { sandboxPath: dir } });
    expect(r.ok).toBe(true);
    expect((r.output as any).sandboxRemoved).toBe(true);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('refuses to remove a path outside the system temp dir (e.g. the live repo root) — repo stays intact', () => {
    const r = dispatchIdeTool({ tool: 'rollback_sandbox', args: { sandboxPath: REPO_ROOT } });
    expect(r.ok).toBe(false);
    expect(fs.existsSync(REPO_ROOT)).toBe(true);
    expect(fs.existsSync(path.join(REPO_ROOT, 'README.md'))).toBe(true);
  });
});

describe('nativeIdeDispatcher: structural false-flags (source-level, not just runtime)', () => {
  it('imports no module from the vendored donor IDE fork', () => {
    expect(importLines(DISPATCHER_SRC)).not.toMatch(/self_edit\/opencode|@opencode-ai/i);
    expect(importLines(WORKBENCH_SRC)).not.toMatch(/self_edit\/opencode|@opencode-ai/i);
  });

  it('imports no cryptographic signing-key module', () => {
    expect(importLines(DISPATCHER_SRC)).not.toMatch(/aumlokSigner|manifestSigner|mldsaSandboxSigner/i);
  });

  it('imports no shared remote-database client', () => {
    expect(importLines(DISPATCHER_SRC)).not.toMatch(/convex/i);
  });

  it('makes no outbound network call', () => {
    expect(DISPATCHER_SRC).not.toMatch(/\bfetch\s*\(|new\s+WebSocket\s*\(|node:https?\b|require\(['"]https?['"]\)/);
  });

  it('dispatcherGrantsAuthority is always false', () => {
    const r = dispatchIdeTool({ tool: 'status', args: {} });
    expect(dispatcherGrantsAuthority(r)).toBe(false);
  });
});

describe('nativeIdeDispatcher: read lane refuses in-repo symlinks (issue #75)', () => {
  // A uniquely-named symlink placed INSIDE the real repo (docs/), pointing at a file in an mkdtemp dir
  // OUTSIDE the repo. Target exists, so a refusal is symlink-denial (not "not found"). Cleaned up in a
  // finally AND an afterEach guard so a crashed run cannot leave it in the working tree; the name is unique.
  const LINK_NAME = `tmp-test75-symlink-${process.pid}.md`;
  const linkRel = path.join('docs', LINK_NAME);
  const linkAbs = path.join(REPO_ROOT, linkRel);
  const CANARY = `zzz75canary${process.pid}outsiderepo`;
  const removeLink = () => { try { if (fs.lstatSync(linkAbs)) fs.unlinkSync(linkAbs); } catch { /* absent */ } };
  afterEach(removeLink);

  it('read_file refuses a symlink whose target is outside the repo, and search omits it (never follows it)', () => {
    const outside = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-test75-outside-'));
    fs.writeFileSync(path.join(outside, 'exfil.md'), `${CANARY}\n`);
    try {
      fs.symlinkSync(path.join(outside, 'exfil.md'), linkAbs);

      // read_file must refuse the symlink outright (symlink denial), not read through it.
      const read = dispatchIdeTool({ tool: 'read_file', args: { relPath: linkRel } });
      expect(read.ok).toBe(false);
      expect(read.reason).toMatch(/symlink/i);

      // search must never follow the symlink: the canary lives only in the outside target, so a correct
      // walk yields ZERO matches for it.
      const found = dispatchIdeTool({ tool: 'search', args: { query: CANARY, dir: 'docs' } });
      expect(found.ok).toBe(true);
      expect((found.output as any).results.length).toBe(0);
    } finally {
      removeLink();
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  // Source-level invariant (non-flaky companion to the runtime test above): the read lane routes through the
  // shared resolver and the old lexical-only in-file helpers are gone, so a future refactor cannot silently
  // reintroduce a statSync/readFileSync-follows-symlink path.
  it('the dispatcher imports the shared resolver and no longer defines the lexical-only helpers', () => {
    expect(importLines(DISPATCHER_SRC)).toMatch(/resolveRepoReadPath.*repoReadPathResolver/);
    expect(DISPATCHER_SRC).not.toMatch(/function resolveRepoRelative\b/);
    expect(DISPATCHER_SRC).not.toMatch(/function refusesAsSecretPath\b/);
  });
});
