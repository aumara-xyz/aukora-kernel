// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Brick W3c — the local Convex brain as a MANAGED service (the deploy-lifecycle foundation).
 *
 * This module owns the DECISIONS of the brain runtime — where data lives, where keys live, how the
 * backend is booted loopback-only, what a healthy instance looks like, and every fail-closed
 * preflight — as PURE, unit-testable functions. The actual spawn/kill/status side effects live in
 * `scripts/brain.sh`, which asks this module (via `scripts/brainCli.ts`) for the argv/env/preflight
 * and then runs them. Nothing here starts a process; nothing here runs on import.
 *
 * Runtime posture (identical assumptions the Nebius twin will use — see docs/TWIN_CONTAINER_SPEC.md):
 *   - LOOPBACK ONLY. The boot argv always pins `--interface 127.0.0.1`. The binary defaults to
 *     0.0.0.0; that default is the documented LAN-exposure failure mode, so we never omit the flag.
 *   - DATA in `state/convex/` (repo default — gitignored + already apply-fenced by the #99 fence's
 *     PROTECTED_STATE_DIRS=['state']). Overridable via AUKORA_CONVEX_STATE_DIR so a container/Nebius
 *     host can point it at a mounted volume. Keys NEVER live here.
 *   - KEYS in ~/.aukora-symbiote/convex/ (admin-key.txt + instance-secret.txt), 0600/0400 custody,
 *     the SAME AUMLOK-tier location the write transport reads. Never in the repo, env files, or logs.
 *   - EGRESS off: DISABLE_BEACON=true on the backend, CI=1 for any CLI.
 */
import { createHash } from 'crypto';
import { statSync, lstatSync, readFileSync, accessSync, constants, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { homedir } from 'os';
import { ADMIN_KEY_DIR, ADMIN_KEY_PATH } from './memoryKernelTransport';

export const DEFAULT_BRAIN_PORT = 3210;
export const DEFAULT_INSTANCE_NAME = 'aukora-brain';
export const INSTANCE_SECRET_PATH = join(ADMIN_KEY_DIR, 'instance-secret.txt');

export class BrainManagerError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'BrainManagerError';
  }
}
const fail = (code: string, message: string): never => { throw new BrainManagerError(code, message); };

export interface BrainPaths {
  repoRoot: string;
  stateDir: string;          // where the SQLite data lives
  adminKeyPath: string;      // ~/.aukora-symbiote/convex/admin-key.txt
  instanceSecretPath: string;
  port: number;
  sitePort: number;
  url: string;               // loopback API url
  instanceName: string;
}

/** Resolve every path/port the runtime uses. PURE (given env). Data dir is env-overridable for
 *  containers; keys are NOT (custody location is fixed). */
export function resolveBrainPaths(opts: { repoRoot: string; env?: NodeJS.ProcessEnv } = { repoRoot: process.cwd() }): BrainPaths {
  const env = opts.env ?? process.env;
  const repoRoot = resolve(opts.repoRoot);
  const stateDir = env.AUKORA_CONVEX_STATE_DIR
    ? resolve(env.AUKORA_CONVEX_STATE_DIR)
    : join(repoRoot, 'state', 'convex');
  // Key custody dir: fixed AUMLOK-tier default, but env-overridable so a container/Nebius host (with a
  // different home) and the throwaway lifecycle proof can redirect it. Keys still NEVER go in the repo.
  const keyDir = env.AUKORA_CONVEX_KEY_DIR ? resolve(env.AUKORA_CONVEX_KEY_DIR) : ADMIN_KEY_DIR;
  const port = Number(env.AUKORA_CONVEX_PORT ?? DEFAULT_BRAIN_PORT);
  // upper bound is 65534, not 65535: sitePort = port + 1 must ALSO be a valid TCP port.
  if (!Number.isInteger(port) || port < 1 || port > 65534) fail('brain_port_invalid', `AUKORA_CONVEX_PORT="${env.AUKORA_CONVEX_PORT}" is not a valid port (need 1..65534 so site-proxy port+1 fits)`);
  return {
    repoRoot,
    stateDir,
    adminKeyPath: env.AUKORA_CONVEX_KEY_DIR ? join(keyDir, 'admin-key.txt') : ADMIN_KEY_PATH,
    instanceSecretPath: env.AUKORA_CONVEX_KEY_DIR ? join(keyDir, 'instance-secret.txt') : INSTANCE_SECRET_PATH,
    port,
    sitePort: port + 1,
    url: `http://127.0.0.1:${port}`,
    instanceName: env.AUKORA_CONVEX_INSTANCE_NAME ?? DEFAULT_INSTANCE_NAME,
  };
}

export interface BinaryIdentity { path: string; exists: boolean; executable: boolean; sha256?: string; sizeBytes?: number; }

/** Identity of the backend binary — printed on start/status so a run is reproducible + a swapped
 *  binary is visible. Reads the file; never executes it. */
export function binaryIdentity(binPath: string): BinaryIdentity {
  let st;
  try { st = statSync(binPath); } catch { return { path: binPath, exists: false, executable: false }; }
  if (!st.isFile()) return { path: binPath, exists: false, executable: false };
  let executable = true;
  try { accessSync(binPath, constants.X_OK); } catch { executable = false; }
  return { path: binPath, exists: true, executable, sha256: createHash('sha256').update(readFileSync(binPath)).digest('hex'), sizeBytes: st.size };
}

/** Loopback-pinned boot argv. PURE. The interface flag is ALWAYS present and ALWAYS loopback. */
export function buildBootArgv(p: BrainPaths, instanceSecret: string): string[] {
  return [
    '--interface', '127.0.0.1',      // never the binary's 0.0.0.0 default — the LAN-exposure trap
    '--port', String(p.port),
    '--site-proxy-port', String(p.sitePort),
    '--instance-name', p.instanceName,
    '--instance-secret', instanceSecret,
  ];
}

/** Boot env: beacon off (no backend egress), plus whatever the caller passes. PURE. */
export function buildBootEnv(base: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...base, DISABLE_BEACON: 'true', CI: '1' };
}

/** Strict custody read of a secret file (admin key OR instance secret) — mirror of the transport's
 *  readAdminKeyStrict: regular file, no symlink, no group/other bits, single-line non-empty. LOUD. */
export function readSecretStrict(secretPath: string, label: string): string {
  let st;
  try { st = lstatSync(secretPath); } catch { return fail('brain_secret_missing', `${label} not found at ${secretPath} — provision it (scripts/brain.sh provisions on first start)`); }
  if (st.isSymbolicLink()) return fail('brain_secret_symlink_refused', `${label} at ${secretPath} is a symlink; must be a regular file`);
  if (!st.isFile()) return fail('brain_secret_not_regular_file', `${label} at ${secretPath} is not a regular file`);
  if ((st.mode & 0o077) !== 0) return fail('brain_secret_permissions_open', `${label} at ${secretPath} is group/world accessible (mode ${(st.mode & 0o777).toString(8)}) — chmod 600 it`);
  const raw = readFileSync(secretPath, 'utf-8').trim();
  if (!raw) return fail('brain_secret_empty', `${label} at ${secretPath} is empty`);
  if (/\r|\n/.test(raw)) return fail('brain_secret_malformed', `${label} at ${secretPath} must hold exactly one value on one line`);
  return raw;
}

/** True iff the state dir is writable OR creatable: when it doesn't exist yet, walk up to the
 *  NEAREST EXISTING ancestor and check that (start's `mkdir -p` creates every level below it).
 *  Nothing under state/ is tracked in git, so on a fresh clone/twin host the dir — and its
 *  parent — don't exist; probing only one parent level refused exactly that first run. */
export function isStateDirWritable(dir: string): boolean {
  let target = resolve(dir);
  while (!existsSync(target)) {
    const parent = dirname(target);
    if (parent === target) return false; // reached the fs root without finding an existing ancestor
    target = parent;
  }
  try { accessSync(target, constants.W_OK); return true; } catch { return false; }
}

export interface PreflightProblem { code: string; message: string; }
export interface PreflightResult { ok: boolean; problems: PreflightProblem[]; paths: BrainPaths; binary: BinaryIdentity; }

/** Compose all fail-closed checks WITHOUT throwing — returns a structured report the script prints.
 *  `isPortFree` is injected so this is testable without touching the network. A start MUST refuse if
 *  ok===false. Custody of the admin key + instance secret is checked here so a bad-perms key is caught
 *  at start, not at first write. */
export function preflightBrain(opts: {
  repoRoot: string;
  binPath: string;
  env?: NodeJS.ProcessEnv;
  isPortFree: (port: number) => boolean;
  stateDirWritable?: (dir: string) => boolean;
}): PreflightResult {
  const paths = resolveBrainPaths({ repoRoot: opts.repoRoot, env: opts.env });
  const binary = binaryIdentity(opts.binPath);
  const problems: PreflightProblem[] = [];

  if (!binary.exists) problems.push({ code: 'brain_binary_missing', message: `backend binary not found at ${opts.binPath} (set AUKORA_CONVEX_BACKEND_BIN)` });
  else if (!binary.executable) problems.push({ code: 'brain_binary_not_executable', message: `backend binary at ${opts.binPath} is not executable` });

  if (!opts.isPortFree(paths.port)) problems.push({ code: 'brain_port_busy', message: `port ${paths.port} is already in use — stop the other backend or set AUKORA_CONVEX_PORT` });

  if (opts.stateDirWritable && !opts.stateDirWritable(paths.stateDir)) {
    problems.push({ code: 'brain_state_dir_unwritable', message: `state dir ${paths.stateDir} is not writable` });
  }

  // custody of both secrets (loud → captured as problems here, not thrown, so the report is complete)
  for (const [p, label] of [[paths.adminKeyPath, 'admin key'], [paths.instanceSecretPath, 'instance secret']] as const) {
    try { readSecretStrict(p, label); }
    catch (e) { problems.push({ code: e instanceof BrainManagerError ? e.code : 'brain_secret_error', message: e instanceof Error ? e.message : String(e) }); }
  }

  return { ok: problems.length === 0, problems, paths, binary };
}

/** True iff `p` is inside `~/.aukora-symbiote/` (keys) or the repo's `state/` (data). The invariant
 *  test asserts the manager only ever points at these two roots — no stray personal dirs, no /tmp,
 *  no cloud. PURE. */
export function isControlledRuntimePath(p: string, repoRoot: string): boolean {
  const abs = resolve(p);
  const keyRoot = join(homedir(), '.aukora-symbiote');
  const stateRoot = join(resolve(repoRoot), 'state');
  return abs === keyRoot || abs.startsWith(keyRoot + '/') || abs === stateRoot || abs.startsWith(stateRoot + '/');
}
