#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Eagle Eye (#86): `bun run doctor` — read-only cross-platform preflight.
//
// Gathers host facts through never-throw probes, then hands them to the PURE evaluator
// (scripts/doctorChecks.ts) for the verdict + render. It installs nothing, changes no authority,
// touches no memory, and prints no keys, env values, usernames, home paths, or file contents.

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as net from 'net';
import { join, dirname, resolve } from 'path';
import { evaluateDoctor, renderDoctor, type DoctorFacts } from './doctorChecks';

const REPO = resolve(import.meta.dir, '..');
const REQUIRED_PORTS = [3210, 7089, 7090, 7091, 7092, 7093, 7094, 7095];

function ver(cmd: string, args: string[]): string | null {
  try { return execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')[0] || null; }
  catch { return null; }
}
function has(cmd: string): boolean {
  try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }); return true; }
  catch { return false; }
}
function ghAuthed(): boolean | null {
  if (!has('gh')) return null;
  try { execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' }); return true; } catch { return false; }
}
function homeWritable(): boolean {
  // Probe writability of the node-home PARENT without exposing the path or creating node state.
  try { fs.accessSync(os.homedir(), fs.constants.W_OK); return true; } catch { return false; }
}
function freeDiskGb(): number | null {
  try {
    const st = (fs as unknown as { statfsSync?: (p: string) => { bavail: number; bsize: number } }).statfsSync?.(REPO);
    if (!st) return null;
    return (st.bavail * st.bsize) / 1e9;
  } catch { return null; }
}
async function portsInUse(ports: number[]): Promise<number[]> {
  const results = await Promise.all(ports.map((port) => new Promise<number | null>((res) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    sock.setTimeout(250);
    sock.once('connect', () => { sock.destroy(); res(port); });
    sock.once('timeout', () => { sock.destroy(); res(null); });
    sock.once('error', () => { res(null); });
  })));
  return results.filter((p): p is number => p !== null);
}
function shellAssetsPresent(): boolean {
  try {
    const shell = join(REPO, 'spatial', 'app', 'shell.js');
    if (!fs.existsSync(shell)) return false;
    const text = fs.readFileSync(shell, 'utf-8');
    const imports = [...text.matchAll(/from\s+['"]\/app\/([^'"]+)['"]/g)].map((m) => m[1]);
    return imports.every((rel) => fs.existsSync(join(REPO, 'spatial', 'app', rel)));
  } catch { return false; }
}
function convexBackendPresent(): boolean {
  try {
    const bin = join(os.homedir(), '.aukora-symbiote', 'convex', 'bin',
      process.platform === 'win32' ? 'convex-local-backend.exe' : 'convex-local-backend');
    return fs.existsSync(bin);
  } catch { return false; }
}

async function gather(): Promise<DoctorFacts> {
  return {
    platform: process.platform,
    arch: process.arch,
    bunVersion: (process.versions as { bun?: string }).bun ?? ver('bun', ['--version']),
    gitVersion: ver('git', ['--version']),
    nodeVersion: has('node') ? ver('node', ['--version']) : null,
    ghPresent: has('gh'),
    ghAuthenticated: ghAuthed(),
    sourceForm: fs.existsSync(join(REPO, '.git')) ? 'clone' : 'zip',
    repoIsPrivate: true, // the shared repo is private today (#86)
    nodeHomeWritable: homeWritable(),
    freeDiskGb: freeDiskGb(),
    requiredPorts: REQUIRED_PORTS,
    portsInUse: await portsInUse(REQUIRED_PORTS),
    shellAssetsPresent: shellAssetsPresent(),
    convexBackendPresent: convexBackendPresent(),
  };
}

async function main(): Promise<void> {
  const report = evaluateDoctor(await gather());
  console.log(renderDoctor(report));
  process.exit(report.ok ? 0 : 1);
}

// Run only as the invoked entrypoint; importing for tests stays pure (no host probing, no exit).
if (/doctor\.ts$/.test(process.argv[1] ?? '')) { void main(); }
