/**
 * 24Z.25 — OpenCode spawn transport (the SOLE process-spawn in the codebase; quarantined + gated).
 *
 * This is the ONLY module that touches `child_process`. It runs OpenCode via `execFileSync` — never via a shell,
 * and never the unsafe exec-family or process-spawn calls — using a pre-validated spec from `prepareOpenCodeSpawn`
 * (which already asserted the all-three gate: detection AND a signed lab activation AND a configured loopback model).
 * Defense-in-depth at the boundary: re-assert cwd is under the system temp dir, refuse any shell flag, scrub the
 * env down to the spec's allowed var NAMES, bound the timeout + output. Returns raw stdout text for the
 * normalizer to sanitize — this transport NEVER parses or trusts the output.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { OpenCodeSpawnSpec } from './openCodeSandboxRunner';

export type OpenCodeTransport = (spec: OpenCodeSpawnSpec) => string;

const MAX_OUTPUT_BYTES = 256 * 1024;

/**
 * PURE safety pre-check (no spawn) — re-asserts at the spawn boundary, never trusting the caller even post-gate:
 * no shell, the fixed command, and cwd resolving under the system temp dir (never the live repo). Throws on any
 * violation. Exported so the boundary is unit-tested independently of an actual process.
 */
export function assertTransportSpecSafe(spec: OpenCodeSpawnSpec, env: NodeJS.ProcessEnv = process.env): void {
  if (!spec || spec.shell !== false) throw new Error('OpenCode spawn refused: shell spawn is never allowed');
  if (spec.cmd !== 'bun') throw new Error('OpenCode spawn refused: unexpected command');
  if (!Array.isArray(spec.argv)) throw new Error('OpenCode spawn refused: argv must be an array');
  const tmpReal = fs.realpathSync(os.tmpdir());
  let cwdReal: string;
  try { cwdReal = fs.realpathSync(spec.cwd); } catch { throw new Error('OpenCode spawn refused: cwd does not exist'); }
  if (cwdReal !== tmpReal && !cwdReal.startsWith(tmpReal + path.sep)) throw new Error('OpenCode spawn refused: cwd must be under the system temp dir');
  void env;
}

/**
 * PURE env scrub (no spawn) — the spawn env contains ONLY the spec's allowed var NAMES that are actually present;
 * every other process env var (secrets included) is dropped. Exported so the scrub is unit-tested independently.
 */
export function buildScrubbedEnv(spec: OpenCodeSpawnSpec, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const scrubbed: NodeJS.ProcessEnv = {};
  for (const name of spec.allowedEnvVars) if (typeof env[name] === 'string') scrubbed[name] = env[name];
  return scrubbed;
}

/** The real gated spawn. Pure safety pre-check + env scrub (both tested), then the SOLE execFileSync call. */
export const realOpenCodeTransport: OpenCodeTransport = (spec) => {
  assertTransportSpecSafe(spec);
  const env = buildScrubbedEnv(spec);
  const out = execFileSync(spec.cmd, spec.argv, {
    cwd: spec.cwd,
    timeout: spec.timeoutMs,
    shell: false,            // never a shell — fixed argv only
    env,                     // scrubbed
    maxBuffer: MAX_OUTPUT_BYTES,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return typeof out === 'string' ? out : String(out);
};
