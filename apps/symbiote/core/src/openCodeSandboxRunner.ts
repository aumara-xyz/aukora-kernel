/**
 * 24Z.19 — OpenCode-as-Sandbox-Engine runner (BOUNDED, no-shell, GATED — parked by default).
 *
 * Honest detection of the local OpenCode lab + a real bounded runner that, IF ever activated, would invoke
 * OpenCode through a FIXED argv (execFile, never a shell, never a sync-exec call, never model-provided commands) with
 * cwd = a throwaway temp workspace, a bounded prompt, and NO live-repo path. Activation requires the existing
 * signed activation gate (`sandboxActivationAllowed`) AND a real model wire — neither exists, so the real
 * spawn is parked: `status` is `parked_partial`. The bridge proves the full pipeline with a deterministic
 * engine instead. OpenCode never: touches the live repo, runs arbitrary shell, reads secrets, or calls Convex.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { sandboxActivationAllowed, type SandboxActivationPermit } from './openCodeSandboxDraftEngine';
import { resolveModelConfig, modelConfigured, type OpenCodeModelConfig } from './openCodeModelWire';
import { realOpenCodeTransport, type OpenCodeTransport } from './openCodeSpawnTransport';
import { parseOpenCodePatch, type OpenCodePatchCandidate } from './openCodeOutputNormalizer';
import { probeLocalEndpoint, callLocalModel, type CallLocalModelOptions } from './localModelClient';

export type OpenCodeEngineStatus = 'unavailable' | 'parked_partial' | 'sandbox_engine_probe' | 'active';

export interface OpenCodeDetection {
  detected: boolean;
  cliPath: string | null;
  sourcePath: string;
  reason: string;
}

// FIXED argv — read-only, no-apply, headless. NEVER interpolate model output into this; NEVER pass via a shell.
export const OPENCODE_SANDBOX_ARGV: readonly string[] = ['run', '--print-logs', '--readonly', '--no-apply'];

export function detectOpenCode(repoRoot: string): OpenCodeDetection {
  const sourcePath = path.join(repoRoot, 'internal', 'opencode-lab', 'opencode-dev');
  // OpenCode ships as source (no standalone binary). The honest marker is the package entry — the bounded
  // runner would invoke it via `bun <entry>` with the fixed argv (when activated).
  const entry = path.join(sourcePath, 'packages', 'opencode', 'src', 'index.ts');
  const detected = fs.existsSync(sourcePath) && fs.existsSync(entry);
  return {
    detected,
    cliPath: detected ? entry : null,
    sourcePath,
    reason: detected
      ? 'OpenCode lab SOURCE present (packages/opencode/src/index.ts) — a file-writing/network coding agent. No standalone CLI binary / model wire; kept parked behind the signed activation gate.'
      : 'OpenCode lab source not found on disk.',
  };
}

export interface OpenCodeEngineState {
  status: OpenCodeEngineStatus;
  detected: boolean;
  canSpawn: boolean;          // hard-false until detection AND the signed gate AND a configured model all hold
  modelConfigured: boolean;   // 24Z.24: a usable model provider is configured (default: false → parked)
  cliPath: string | null;
  argv: readonly string[];
  liveRepoHandle: false;      // OpenCode never receives a live-repo path
  shell: false;               // never a shell — fixed argv via execFile only
  reason: string;
}

/**
 * Resolve OpenCode's engine state. The real spawn is allowed ONLY if ALL THREE hold: OpenCode is detected, the
 * signed activation gate passes (no production signer → false today), AND a model provider is configured
 * (default `none` → false today). So `canSpawn` is effectively always false; status = `parked_partial`.
 */
export function resolveOpenCodeEngine(repoRoot: string, opts: { permit?: SandboxActivationPermit; modelConfig?: OpenCodeModelConfig; enabled?: boolean } = {}): OpenCodeEngineState {
  const det = detectOpenCode(repoRoot);
  const gateOpen = opts.enabled === undefined ? sandboxActivationAllowed(opts.permit) : sandboxActivationAllowed(opts.permit, opts.enabled); // env flag by default; false today
  const modelOk = modelConfigured(opts.modelConfig ?? resolveModelConfig()); // false today (provider=none)
  const canSpawn = det.detected && gateOpen && modelOk;             // requires ALL THREE; false today
  const status: OpenCodeEngineStatus = !det.detected ? 'unavailable' : canSpawn ? 'active' : 'parked_partial';
  return {
    status, detected: det.detected, canSpawn, modelConfigured: modelOk, cliPath: det.cliPath,
    argv: OPENCODE_SANDBOX_ARGV, liveRepoHandle: false, shell: false,
    reason: !det.detected ? det.reason
      : `OpenCode detected + bounded spawn SPEC built (fixed argv, no shell, cwd=temp, no live path, no secrets in context); spawn PARKED — needs the signed activation gate (gateOpen=${gateOpen}) AND a configured model (modelConfigured=${modelOk}). The sandbox route is OpenCode-ready; the actual execFile is a separately-reviewed activation step.`,
  };
}

/** Guard: refuse to spawn OpenCode unless the engine genuinely resolves to `active` (never today). */
export function assertOpenCodeSpawnAllowed(repoRoot: string, permit?: SandboxActivationPermit): void {
  const e = resolveOpenCodeEngine(repoRoot, { permit });
  if (!e.canSpawn || e.status !== 'active') {
    throw new Error(`OpenCode spawn denied — ${e.reason}`);
  }
}

/**
 * 24Z.24 — the bounded spawn SPEC: inspectable DATA describing exactly how OpenCode WOULD be invoked, so the
 * safety (no shell, cwd under the system temp dir, fixed argv, bounded prompt, scrubbed env that lists only
 * allowed var NAMES — never secret values, no live-repo path) is verifiable WITHOUT shipping a process spawn.
 * No process-spawn module is imported while parked. `buildOpenCodeSpawnSpec` throws on an unsafe cwd/prompt.
 */
export interface OpenCodeSpawnSpec {
  cmd: 'bun';
  argv: string[];
  cwd: string;                // MUST be under the system temp dir
  timeoutMs: number;
  shell: false;
  allowedEnvVars: string[];   // NAMES only (e.g. PATH + the configured key env var) — never values
  liveRepoHandle: false;
  promptBytes: number;
}
export function buildOpenCodeSpawnSpec(tempCwd: string, prompt: string, cfg: OpenCodeModelConfig): OpenCodeSpawnSpec {
  const tmpReal = fs.realpathSync(os.tmpdir());
  let cwdReal: string;
  try { cwdReal = fs.realpathSync(tempCwd); } catch { throw new Error('spawn cwd does not exist'); }
  if (cwdReal !== tmpReal && !cwdReal.startsWith(tmpReal + path.sep)) throw new Error('spawn cwd must be under the system temp dir (never the live repo)');
  if (typeof prompt !== 'string' || prompt.length > 8000) throw new Error('prompt must be a bounded string (<=8000)');
  const allowedEnvVars = ['PATH', 'HOME'];
  if (cfg.provider === 'openrouter' && cfg.keyEnvVar) allowedEnvVars.push(cfg.keyEnvVar); // NAME only; value injected at the (future) reviewed spawn
  // local loopback provider: pass the LOOPBACK endpoint + model id as inspectable argv flags (a loopback URL is not
  // a secret). No key is ever passed for `local`. resolveModelConfig already rejects non-loopback endpoints.
  const modelFlags: string[] = [];
  if (cfg.provider === 'local' && cfg.endpoint) { modelFlags.push('--model-endpoint', cfg.endpoint); if (cfg.model) modelFlags.push('--model', cfg.model); }
  return {
    cmd: 'bun',
    argv: ['packages/opencode/src/index.ts', ...OPENCODE_SANDBOX_ARGV, ...modelFlags, '--prompt', prompt.slice(0, 8000)],
    cwd: tempCwd, timeoutMs: 60_000, shell: false, allowedEnvVars, liveRepoHandle: false, promptBytes: Math.min(prompt.length, 8000),
  };
}

/**
 * 24Z.24 (Fusion GLM/Gemini/Kimi hardening): the ONLY supported way to obtain a spec destined for EXECUTION.
 * It RE-ASSERTS the full ALL-THREE gate (detection AND signed activation AND a configured model) and only then
 * returns the safe-by-construction spec. A future execFile activation MUST call this (never bare
 * `buildOpenCodeSpawnSpec`), so the spec's safety can never be wired to a process while the gate is closed —
 * the gate check and the spec build are fused into one chokepoint. Throws today (parked).
 */
export function prepareOpenCodeSpawn(repoRoot: string, tempCwd: string, prompt: string, opts: { permit?: SandboxActivationPermit; modelConfig?: OpenCodeModelConfig; enabled?: boolean } = {}): OpenCodeSpawnSpec {
  const e = resolveOpenCodeEngine(repoRoot, opts);
  if (!e.canSpawn || e.status !== 'active') throw new Error(`OpenCode spawn denied — ${e.reason}`);
  return buildOpenCodeSpawnSpec(tempCwd, prompt, opts.modelConfig ?? resolveModelConfig());
}

// A bounded, JSON-only prompt contract: the model must answer with STRICT JSON the normalizer can parse as data.
const OPENCODE_PROMPT_PREAMBLE =
  'Respond with ONLY strict JSON: {"objective": string, "files": [{"relPath": string, "content": string}]}. ' +
  'Repo-relative paths only (no absolute, no ".."). No prose, no code fences, no hidden characters. Task: ';

export function buildOpenCodePrompt(task: string): string {
  return (OPENCODE_PROMPT_PREAMBLE + String(task)).slice(0, 8000);
}

export interface RunOpenCodeDiffOptions {
  permit?: SandboxActivationPermit;
  modelConfig?: OpenCodeModelConfig;
  enabled?: boolean;
  transport?: OpenCodeTransport;     // injectable for tests; default = the real gated execFile transport
}

/**
 * 24Z.25 — produce a sanitized OpenCode patch candidate. Fused chokepoint: assert the all-three gate + build the
 * spec (`prepareOpenCodeSpawn`), run the gated transport in a THROWAWAY temp cwd (never the live repo), then pass
 * the raw output through the defensive boundary (`parseOpenCodePatch`: NFC-normalize → refuse hidden channels →
 * parse-as-data → forbiddenContent on metadata). Throws when parked. The temp cwd is always cleaned up.
 */
export function runOpenCodeSandboxDiff(repoRoot: string, task: string, opts: RunOpenCodeDiffOptions = {}): OpenCodePatchCandidate {
  const tempCwd = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'opencode-spawn-'));
  try {
    const spec = prepareOpenCodeSpawn(repoRoot, tempCwd, buildOpenCodePrompt(task), opts); // throws if parked
    const transport = opts.transport ?? realOpenCodeTransport;
    const raw = transport(spec);
    return parseOpenCodePatch(raw); // defensive boundary — normalize, refuse hidden channels, parse as data
  } finally {
    try { fs.rmSync(tempCwd, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  }
}

export function summarizeOpenCodeEngine(e: OpenCodeEngineState): string {
  return [
    `OpenCode engine: status=${e.status}, detected=${e.detected}, canSpawn=${e.canSpawn} (no live-repo handle, no shell).`,
    e.reason,
    'OpenCode has NO authority: it cannot apply to the live repo, run shell, read secrets, or write Convex/memory.',
  ].join('\n');
}

export interface LocalLoopbackCandidate {
  ran: boolean;                 // a real local endpoint actually responded with a parsed candidate
  reachable: boolean;           // the loopback endpoint answered the probe
  parked: boolean;              // honestly parked (gate closed / not configured / unreachable) — NOT a failure
  candidate?: OpenCodePatchCandidate;
  reason?: string;
}

/**
 * 24Z.27 — produce a sanitized candidate from a REAL local LOOPBACK model, honestly. Gate first (the chokepoint:
 * detected AND signed lab activation AND a configured loopback model — parked, not thrown, if not). Then probe the
 * loopback endpoint; if unreachable, stay PARKED (no fake). If it answers, call it (loopback-hard, no key, bounded)
 * and pass the UNTRUSTED output through the Canonicalization Sentinel (`parseOpenCodePatch`) before it is a candidate
 * — a hidden channel / homoglyph'd authority word REFUSES (throws). Never touches the live repo; cwd is temp-only.
 */
export async function runLocalLoopbackOpenCodeDiff(repoRoot: string, task: string, opts: RunOpenCodeDiffOptions & { call?: typeof callLocalModel; probe?: typeof probeLocalEndpoint; modelCallOpts?: CallLocalModelOptions } = {}): Promise<LocalLoopbackCandidate> {
  const cfg = opts.modelConfig ?? resolveModelConfig();
  if (cfg.provider !== 'local' || !cfg.endpoint) return { ran: false, reachable: false, parked: true, reason: 'no local loopback model configured (provider!=local or no loopback endpoint)' };
  // GATE (the chokepoint): detected AND signed lab activation AND a configured model. Parked (not thrown) if closed.
  const engine = resolveOpenCodeEngine(repoRoot, { permit: opts.permit, modelConfig: cfg, enabled: opts.enabled });
  if (!engine.canSpawn) return { ran: false, reachable: false, parked: true, reason: `gate closed — ${engine.reason}` };

  const probe = opts.probe ?? probeLocalEndpoint;
  const pr = await probe(cfg.endpoint, { timeoutMs: opts.modelCallOpts?.timeoutMs });
  if (!pr.reachable) return { ran: false, reachable: false, parked: true, reason: `local endpoint not reachable — ${pr.reason ?? 'no response'}` };

  const call = opts.call ?? callLocalModel;
  const res = await call(cfg.endpoint, buildOpenCodePrompt(task), { ...opts.modelCallOpts, model: cfg.model });
  if (!res.ok || typeof res.text !== 'string') return { ran: false, reachable: true, parked: true, reason: `local model call failed — ${res.reason ?? 'no text'}` };

  // UNTRUSTED model output → Canonicalization Sentinel → candidate (throws HiddenChannelError/PatchParseError on refusal).
  const candidate = parseOpenCodePatch(res.text);
  return { ran: true, reachable: true, parked: false, candidate };
}
