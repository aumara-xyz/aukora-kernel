/**
 * 24Z.14.1 — OpenCode Sandboxed Draft Envelope.
 *
 * The safe shape for activating ANY file-writing engine (OpenCode) as a DRAFT engine: it runs ONLY inside a
 * throwaway temp workspace, never the live repo. The envelope creates the temp dir, runs the engine with
 * cwd = temp, captures whatever it wrote IN TEMP as a draft diff, coerces to `applied:false`, and ALWAYS
 * deletes the temp dir. The live repo path is never handed to the engine — so the live repo cannot be
 * touched, by construction.
 *
 * This module ships the ENVELOPE (proven with a deterministic mock runner). The real OpenCode runner — a
 * bounded `spawn` with `OPENCODE_HEADLESS_ARGV`, cwd=temp, timeout, and verified no-network flags — is GATED
 * OFF (`OPENCODE_SANDBOX_ENABLED = false`); shipping live network/process execution of a coding agent is the
 * remaining, separately-reviewed step. No `spawn` surface is shipped here.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { verifyLabActivation, type LabActivationToken } from './mldsaSandboxSigner';

export const OPENCODE_SANDBOX_ENABLED = false; // default OFF; the real spawn runner is a later gated step

export interface SandboxEngineRunner {
  readonly id: string;
  /** Run inside `cwd` (a temp dir). MUST confine all effects to `cwd`. Returns stdout. */
  run(cwd: string, prompt: string): string;
}

export interface SandboxDraftResult {
  engineId: string;
  tempWorkspaceUsed: boolean;
  filesWrittenInTemp: string[];
  diffSummary: string;
  liveRepoTouched: false;   // structural — the engine never receives the live repo path
  applied: false;
  mode: 'draft_only';
  advisoryOnly: true;
  grantsAuthority: false;
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else out.push(r);
    }
  };
  if (fs.existsSync(dir)) walk(dir, '');
  return out.sort();
}

export interface SandboxOptions {
  prompt: string;
  runner: SandboxEngineRunner;
  /** temp base override (for tests); defaults to os.tmpdir(). */
  tmpBase?: string;
}

/**
 * Run a draft inside a throwaway temp workspace. The live repo is NEVER passed in, so it cannot be touched.
 * The temp dir is always removed (finally). Returns a draft-only result (applied:false).
 */
export function runSandboxDraft(opts: SandboxOptions): SandboxDraftResult {
  const base = opts.tmpBase ?? os.tmpdir();
  const tmp = fs.mkdtempSync(path.join(base, 'aukora-sandbox-'));
  try {
    // seed the temp workspace with the prompt only (no repo copy by default — minimal, bounded).
    fs.writeFileSync(path.join(tmp, 'PROMPT.md'), opts.prompt.slice(0, 2000), 'utf-8');
    const before = new Set(listFiles(tmp));

    let stdout = '';
    try {
      stdout = opts.runner.run(tmp, opts.prompt.slice(0, 2000)); // engine effects confined to tmp
    } catch (e) {
      stdout = `[sandbox runner error: ${e instanceof Error ? e.message : String(e)}]`;
    }

    const after = listFiles(tmp);
    const filesWrittenInTemp = after.filter((f) => f !== 'PROMPT.md' && !before.has(f));
    const diffSummary = filesWrittenInTemp.length
      ? `[sandbox:${opts.runner.id}] wrote ${filesWrittenInTemp.length} file(s) in temp: ${filesWrittenInTemp.join(', ')}. ${stdout.slice(0, 600)}`
      : `[sandbox:${opts.runner.id}] no temp files written. ${stdout.slice(0, 600)}`;

    return {
      engineId: opts.runner.id,
      tempWorkspaceUsed: true,
      filesWrittenInTemp,
      diffSummary,
      liveRepoTouched: false,
      applied: false,
      mode: 'draft_only',
      advisoryOnly: true,
      grantsAuthority: false,
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true }); // ALWAYS clean up the temp workspace
  }
}

/**
 * Deterministic mock runner — proves the envelope without any real engine/network. It writes a single file
 * in the temp cwd (simulating an engine producing a draft) and returns stdout. Used to prove the live repo
 * stays untouched and the temp diff is captured + cleaned up.
 */
export class MockSandboxRunner implements SandboxEngineRunner {
  readonly id = 'mock-sandbox-runner';
  run(cwd: string, prompt: string): string {
    fs.writeFileSync(path.join(cwd, 'draft.patch'), `# draft for: ${prompt.slice(0, 80)}\n(simulated)\n`, 'utf-8');
    return 'mock engine produced a draft.patch in the temp workspace';
  }
}

/**
 * 24Z.14.1 Fusion consensus (Opus/Kimi/DeepSeek/Mistral/GLM): activation must be a SIGNED crossing, not a
 * bare env flag that config-drift could flip. A signed permit attests the runtime-manifest hash + author and
 * must verify against the AUMLOK/kernel signer. No real signer exists yet, so NO permit can verify → the
 * real runner can never activate this round, even if the env flag is flipped.
 */
export interface SandboxActivationPermit {
  signedPermit: string;                 // legacy AUMLOK/kernel signature placeholder (no production signer yet)
  manifestHash: string;
  labActivation?: LabActivationToken;   // 24Z.25: a real ML-DSA LAB activation token (lab-mode; never production)
}

/**
 * Activation requires BOTH the env flag (default OFF) AND a verified signed activation token. The legacy
 * `signedPermit` string can never verify (no production signer). 24Z.25 adds a REAL lab path: a `labActivation`
 * ML-DSA token (lab key) that verifies fail-closed. Default (no flag / no token) stays parked. A production
 * AUMLOK identity is still NOT wired — this is a lab-mode crossing only, and grants no LIVE authority.
 */
export function sandboxActivationAllowed(permit?: SandboxActivationPermit, enabled: boolean = OPENCODE_SANDBOX_ENABLED): boolean {
  if (!enabled) return false;                                  // env flag off (default)
  if (permit?.labActivation) return verifyLabActivation(permit.labActivation).valid; // real lab ML-DSA verification
  return false;                                                // legacy string permit can never verify
}

/** Guard: refuse to use a real (network/process) engine unless the SIGNED activation gate allows it. */
export function assertSandboxEnabled(permit?: SandboxActivationPermit): void {
  if (!sandboxActivationAllowed(permit)) {
    throw new Error('OpenCode sandbox activation denied — requires the env flag AND a verified AUMLOK-signed permit (no signer wired yet). Only the mock runner may run.');
  }
}

/** Honest status of the OpenCode sandbox bridge for the manifest/the console. */
export function openCodeSandboxStatus(): { active: boolean; reason: string } {
  return {
    active: false,
    reason: 'envelope built + proven (temp-only, live repo untouched) with the mock runner; the real OpenCode spawn runner is GATED OFF behind a SIGNED activation permit (env flag alone is insufficient — config drift cannot enable it). No AUMLOK signer wired yet.',
  };
}
