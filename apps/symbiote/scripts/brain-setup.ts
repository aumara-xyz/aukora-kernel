#!/usr/bin/env bun
// brain-setup.ts — bring up the local Convex brain (Aukora's memory / nervous system) on ANY OS.
//
//   bun run brain          # download the backend binary if missing, provision, and start it on :3210
//   bun run brain status   # is it up?
//   bun run brain stop     # stop it
//
// Every node runs the SAME Convex backend: the `convex-local-backend` binary is downloaded per-platform at a
// PINNED version (reproducible), provisioned with a local instance secret + admin key (0600, in
// ~/.aukora-symbiote/convex, NEVER in git), and started LOOPBACK-ONLY on 127.0.0.1:3210. The brain's DATA and
// keys are yours and stay local; only the code+binary are shared. Pure Bun — no bash, no lsof.

import { existsSync, mkdirSync, chmodSync, writeFileSync, rmSync, readdirSync, statSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { randomBytes } from 'crypto';
import {
  resolveBrainPaths, buildBootArgv, buildBootEnv, binaryIdentity, DEFAULT_INSTANCE_NAME,
} from '../core/src/convexBackendManager';

// Pinned convex-local-backend release (get-convex/convex-backend). Bump deliberately for a reproducible fleet.
const TAG = 'precompiled-2026-06-09-b6aaa1a';
const REPO = join(import.meta.dir, '..');
const paths = resolveBrainPaths({ repoRoot: REPO });
const BIN_DIR = join(dirname(paths.adminKeyPath), 'bin');
const IS_WIN = process.platform === 'win32';
const BIN = join(BIN_DIR, IS_WIN ? 'convex-local-backend.exe' : 'convex-local-backend');
const LOG = join(paths.stateDir, 'brain.log');
const PIDFILE = join(paths.stateDir, '.brain.pid');

function target(): string {
  const key = `${process.platform}-${process.arch}`;
  const map: Record<string, string> = {
    'darwin-arm64': 'aarch64-apple-darwin',
    'darwin-x64': 'x86_64-apple-darwin',
    'linux-x64': 'x86_64-unknown-linux-gnu',
    'linux-arm64': 'aarch64-unknown-linux-gnu',
    'win32-x64': 'x86_64-pc-windows-msvc',
  };
  const t = map[key];
  if (!t) { console.error(`✗ no Convex backend build for ${key}. Supported: ${Object.keys(map).join(', ')}.`); process.exit(1); }
  return t;
}

async function up(): Promise<boolean> {
  try { const r = await fetch(`${paths.url}/version`, { signal: AbortSignal.timeout(1200) }); return r.ok; } catch { return false; }
}

async function unzip(zip: string, dest: string) {
  // cross-platform: bsdtar (mac + win10+) handles .zip; unzip on most linux. Try in order.
  const tries = IS_WIN
    ? [['tar', '-xf', zip, '-C', dest], ['powershell', '-NoProfile', '-Command', `Expand-Archive -Force -Path '${zip}' -DestinationPath '${dest}'`]]
    : [['unzip', '-o', '-q', zip, '-d', dest], ['tar', '-xf', zip, '-C', dest]];
  for (const cmd of tries) {
    try { const p = Bun.spawn(cmd, { stdio: ['ignore', 'ignore', 'ignore'] }); if ((await p.exited) === 0) return; } catch { /* try next */ }
  }
  throw new Error('could not unzip the backend (need unzip, or tar/PowerShell)');
}

async function download(url: string, dest: string) {
  // curl first (ships with macOS, Windows 10+, most Linux): retries, visible progress, and real stall
  // detection (abort under 1 KB/s for 30 s). fetch has none of that — a silently stalled body stream
  // hangs the whole first run with nothing on screen. fetch stays as the fallback where curl is absent.
  const tries: string[][] = [
    ['curl', '-fSL', '--retry', '3', '--connect-timeout', '15',
     '--speed-limit', '1024', '--speed-time', '30', '-o', dest, url],
  ];
  for (const cmd of tries) {
    try { const p = Bun.spawn(cmd, { stdio: ['ignore', 'inherit', 'inherit'] }); if ((await p.exited) === 0) return; } catch { /* try next */ }
  }
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  await Bun.write(dest, res);
}

async function ensureBinary() {
  if (binaryIdentity(BIN).exists) return;
  const t = target();
  const url = `https://github.com/get-convex/convex-backend/releases/download/${TAG}/convex-local-backend-${t}.zip`;
  console.log(`▸ downloading the Convex backend for ${t} (~55 MB, first run only)…`);
  mkdirSync(BIN_DIR, { recursive: true });
  const tmp = join(BIN_DIR, `.dl-${t}.zip`);
  try {
    await download(url, tmp);
  } catch (e) {
    rmSync(tmp, { force: true });
    console.error(`✗ download failed (${e instanceof Error ? e.message : e}) from ${url}`);
    console.error(`  Manual fallback: fetch that URL yourself (browser or curl), unzip it into ${BIN_DIR}`);
    console.error(`  so the binary sits at ${BIN}, then re-run: bun run start`);
    process.exit(1);
  }
  await unzip(tmp, BIN_DIR);
  rmSync(tmp, { force: true });
  // the zip may extract the binary under a subdir or a different case — find + place it
  if (!existsSync(BIN)) {
    const found = findBinary(BIN_DIR);
    if (found && found !== BIN) { renameSync(found, BIN); } // fs rename — `mv` doesn't exist on Windows
  }
  if (!existsSync(BIN)) { console.error(`✗ backend binary not found after unzip in ${BIN_DIR}`); process.exit(1); }
  if (!IS_WIN) chmodSync(BIN, 0o755);
  console.log('  ✓ backend binary ready.');
}

function findBinary(dir: string): string | null {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    try { if (statSync(p).isFile() && /convex-local-backend(\.exe)?$/.test(name)) return p; } catch { /* skip */ }
  }
  return null;
}

function provision() {
  mkdirSync(dirname(paths.instanceSecretPath), { recursive: true });
  try { chmodSync(dirname(paths.instanceSecretPath), 0o700); } catch { /* windows */ }
  if (!existsSync(paths.instanceSecretPath)) {
    writeFileSync(paths.instanceSecretPath, randomBytes(32).toString('hex'), { mode: 0o600 });
    try { chmodSync(paths.instanceSecretPath, 0o600); } catch { /* windows */ }
    console.log('  ✓ instance secret written (0600).');
  }
  const secret = require('fs').readFileSync(paths.instanceSecretPath, 'utf-8').trim();
  if (!existsSync(paths.adminKeyPath)) {
    const kg = Bun.spawnSync([BIN, 'keygen', 'admin-key', '--instance-name', DEFAULT_INSTANCE_NAME, '--instance-secret', secret]);
    const key = new TextDecoder().decode(kg.stdout).trim().split('\n').pop()?.trim() || '';
    if (!key) { console.error('✗ keygen produced no admin key'); process.exit(1); }
    writeFileSync(paths.adminKeyPath, key, { mode: 0o600 });
    try { chmodSync(paths.adminKeyPath, 0o600); } catch { /* windows */ }
    console.log('  ✓ admin key written (0600).');
  }
  return secret;
}

async function start() {
  if (await up()) { console.log(`▸ brain already up at ${paths.url}`); return; }
  await ensureBinary();
  const secret = provision();
  mkdirSync(paths.stateDir, { recursive: true });
  const argv = buildBootArgv(paths, secret);
  console.log(`▸ starting the brain on ${paths.url} (loopback only)…`);
  const proc = Bun.spawn([BIN, ...argv], {
    cwd: paths.stateDir, env: buildBootEnv(process.env), stdio: ['ignore', Bun.file(LOG), Bun.file(LOG)],
  });
  writeFileSync(PIDFILE, String(proc.pid));
  proc.unref();
  for (let i = 0; i < 60; i++) { if (await up()) { console.log(`  ✓ brain LIVE at ${paths.url} (pid ${proc.pid}).`); return; } await Bun.sleep(500); }
  console.error(`✗ brain did not answer on ${paths.url} — see ${LOG}`);
  process.exit(1);
}

const cmd = process.argv[2] ?? 'start';
if (cmd === 'status') { console.log(await up() ? `✓ brain up at ${paths.url}` : `✗ brain not answering at ${paths.url}`); }
else if (cmd === 'stop') {
  try { const pid = Number(require('fs').readFileSync(PIDFILE, 'utf-8').trim()); process.kill(pid); rmSync(PIDFILE, { force: true }); console.log(`▸ stopped brain (pid ${pid})`); }
  catch { console.log('▸ no managed brain pid (or already stopped)'); }
}
else { await start(); }
// The brain runs detached (unref'd); exit explicitly so `bun run brain` returns to the prompt.
process.exit(0);
