// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * AUMLOK DISPOSABLE WAVE HARNESS — owner-visible fresh-node walkthroughs, safely repeatable.
 *
 * Every wave gets its OWN throwaway home (`mkdtemp` under the OS temp dir) carrying a unique
 * SENTINEL file, and runs the canonical bind door (`spatial/aumlok-bind-serve.ts`) on a free port.
 * The harness will NEVER resolve to, read from, copy a key out of, or destroy the standing Aukora
 * home; it refuses to destroy any path that does not carry its own sentinel. It prints the exact
 * URL to click. It never prints, logs, or inspects phrase or key material — only content-free
 * posture.
 *
 *   bun scripts/aumlokWave.ts prepare   → mkdtemp home + free port + start the door, print URL
 *   bun scripts/aumlokWave.ts status    → content-free posture of every live wave
 *   bun scripts/aumlokWave.ts destroy [id]  → stop the process(es) and remove ONLY sentinel'd homes
 *
 * A wave is DISPOSABLE by construction: `destroy` is the only cleanup, and it is fenced three ways
 * (sentinel file present, path under the OS temp dir, path is not the standing home).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as net from 'net';
import { spawn, execFileSync } from 'child_process';
import {
  SENTINEL_NAME, assertDestroyable as fenceCheck, newSentinelToken,
  readRegistrySafe, writeRegistryAtomic, type WaveRecord,
} from '../core/src/aumlokWaveFence';

// per-user registry so two accounts on one host never share or clobber wave state
const REGISTRY = path.join(os.tmpdir(), `aumlok-wave-registry-${typeof process.getuid === 'function' ? process.getuid() : 'nouid'}.json`);
const STANDING_HOME = path.resolve(process.env.AUKORA_SYMBIOTE_HOME ?? path.join(os.homedir(), '.aukora-symbiote'));
// node-safe module dir (Bun's import.meta.dir is undefined under the vitest/node runner)
const HERE = path.dirname(new URL(import.meta.url).pathname);
const DOOR = path.resolve(HERE, '..', 'spatial', 'aumlok-bind-serve.ts');
const TMP_ROOT = path.resolve(os.tmpdir());

const readRegistry = (): WaveRecord[] => readRegistrySafe(REGISTRY);
const writeRegistry = (rows: WaveRecord[]): void => writeRegistryAtomic(REGISTRY, rows);

/** Three-fence safety check (core/src/aumlokWaveFence.ts), bound to THIS process's standing home
 *  and temp root: destroyable only if under the temp dir, not the standing home, and sentinel'd. */
function assertDestroyable(home: string, expectSentinel?: string) {
  return fenceCheck(home, expectSentinel, STANDING_HOME, TMP_ROOT);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error('no port'))));
    });
  });
}
function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** The OS process's launch identity — start time + full argv — via POSIX `ps`. Stable across a
 *  PID's life and distinct after PID reuse. Null when it cannot be read (then we fail closed). */
function procIdentity(pid: number): { start: string; args: string } | null {
  if (pid <= 0) return null;
  try {
    const start = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', timeout: 2000 }).trim();
    const args = execFileSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8', timeout: 2000 }).trim();
    return start && args ? { start, args } : null;
  } catch { return null; }
}

/** Is THIS record's PID actually our door — not a reused/unrelated process? Alive AND the current
 *  launch identity equals the one captured at spawn AND the argv is a door process. Fail-closed:
 *  no recorded identity, unreadable ps, or ANY mismatch → false (treat as exited, never signal). */
function isOurDoor(rec: WaveRecord): boolean {
  if (!rec.launch || !pidAlive(rec.pid)) return false;
  const id = procIdentity(rec.pid);
  if (!id) return false;
  return id.start === rec.launch.start && id.args === rec.launch.args && id.args.includes('aumlok-bind-serve');
}

/** Start the canonical door hermetically on `home`+`port`, capture its launch identity, and POLL
 *  /api/bind/status until it answers. Returns { pid, launch } only on a proven-ready door; on
 *  failure it kills the child and returns null — a caller must NEVER print READY without this. */
async function startDoorReady(home: string, port: number): Promise<{ pid: number; launch: { start: string; args: string } } | null> {
  const child = spawn('bun', [DOOR], {
    env: { ...process.env, AUKORA_SYMBIOTE_HOME: home, AUKORA_AUMLOK_BIND_PORT: String(port), AUKORA_NO_OPEN: '1' },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  const pid = child.pid ?? -1;
  const launch = procIdentity(pid); // captured the instant it starts — the anti-PID-reuse anchor
  for (let i = 0; i < 40; i++) { // up to ~10s
    await new Promise((r) => setTimeout(r, 250));
    if (!pidAlive(pid)) break; // died on startup
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/bind/status`, { signal: AbortSignal.timeout(1200) });
      if (r.ok && launch) return { pid, launch };
    } catch { /* not up yet */ }
  }
  try { if (pid > 0) process.kill(-pid); } catch { try { if (pid > 0) process.kill(pid); } catch { /* gone */ } }
  return null;
}

function printReady(verb: string, rec: WaveRecord): void {
  process.stdout.write([
    '',
    `AUMLOK disposable wave — ${verb}`,
    `  id     : ${rec.id}`,
    `  url    : http://127.0.0.1:${rec.port}/    ← open this to walk the ceremony`,
    `  home   : ${rec.home}  (throwaway; sentinel-guarded)`,
    `  port   : ${rec.port}  (free-picked)`,
    '',
    '  posture: bun scripts/aumlokWave.ts status',
    `  reopen : bun scripts/aumlokWave.ts resume ${rec.id}   (the door one-shot-exits after a ceremony — reopen the SAME home to continue the cycle)`,
    `  clean  : bun scripts/aumlokWave.ts destroy ${rec.id}`,
    '  (this harness never reads/prints your phrase or key; it only knows the port and posture.)',
    '',
  ].join('\n') + '\n');
}

async function prepare(): Promise<void> {
  const token = newSentinelToken();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aumlok-wave-'));
  fs.writeFileSync(path.join(home, SENTINEL_NAME), JSON.stringify({ schema: 'aumlok-wave-sentinel-v1', token, createdAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
  const port = await freePort();
  const started = await startDoorReady(home, port);
  if (started === null) {
    // startup failed: NEVER print READY. Record the home so `destroy` can still clean it safely.
    const dead: WaveRecord = { id: token, home, port, pid: -1, startedAt: new Date().toISOString(), sentinel: token };
    writeRegistry([...readRegistry(), dead]); // never discard existing rows — exited waves stay reopenable
    process.stdout.write(`\nAUMLOK wave FAILED TO START (door never became ready). It is safely cleanable:\n  bun scripts/aumlokWave.ts destroy ${token}\n\n`);
    process.exitCode = 1;
    return;
  }
  const rec: WaveRecord = { id: token, home, port, pid: started.pid, startedAt: new Date().toISOString(), sentinel: token, resumes: 0, launch: started.launch };
  writeRegistry([...readRegistry(), rec]); // NEVER prune exited rows — only `destroy` removes
  printReady('READY', rec);
}

async function resume(idArg?: string): Promise<void> {
  if (!idArg) { process.stdout.write('usage: bun scripts/aumlokWave.ts resume <id>\n'); process.exitCode = 2; return; }
  const rows = readRegistry();
  const rec = rows.find((r) => r.id === idArg);
  if (!rec) { process.stdout.write(`no wave with id ${idArg}. (exited waves are kept until destroy; check \`status\`.)\n`); process.exitCode = 1; return; }
  if (isOurDoor(rec)) { process.stdout.write(`wave ${idArg} is already up:\n`); printReady('ALREADY UP', rec); return; }
  // the home must still be a sentinel-verified disposable path with THIS record's token — the same
  // fence destroy uses, so resume can never reopen the standing home or a recycled stranger path.
  const guard = assertDestroyable(rec.home, rec.sentinel);
  if (!guard.ok) { process.stdout.write(`cannot resume ${idArg}: ${guard.why}\n`); process.exitCode = 1; return; }
  const port = await freePort();
  const started = await startDoorReady(rec.home, port);
  if (started === null) {
    process.stdout.write(`\nresume ${idArg} FAILED (door never became ready). The home is preserved and still cleanable:\n  bun scripts/aumlokWave.ts destroy ${idArg}\n\n`);
    process.exitCode = 1;
    return;
  }
  const next: WaveRecord = { ...rec, port, pid: started.pid, resumes: (rec.resumes ?? 0) + 1, launch: started.launch };
  writeRegistry(rows.map((r) => (r.id === idArg ? next : r)));
  printReady('RESUMED (same home)', next);
}

async function statusOf(rec: WaveRecord): Promise<string> {
  // "up" requires the PID to be OUR door — an alive-but-mismatched PID is a reused stranger and is
  // reported as exited (never "up"), so nothing downstream ever treats it as the door.
  if (!isOurDoor(rec)) {
    // an exited wave is NEVER forgotten — its home stands until an explicit destroy, and it can be
    // reopened to continue the cycle (the door one-shots after a ceremony BY DESIGN).
    const homeThere = fs.existsSync(rec.home);
    return homeThere ? `exited · REOPENABLE (bun scripts/aumlokWave.ts resume ${rec.id})` : 'exited · home already removed (run destroy to forget it)';
  }
  try {
    const r = await fetch(`http://127.0.0.1:${rec.port}/api/bind/status`, { signal: AbortSignal.timeout(1500) });
    const s = await r.json() as { posture?: string; phraseFormat?: string; candidateAlive?: boolean; recoveryRequired?: boolean };
    // content-free ONLY — posture words, never phrase/key bytes
    return `up · posture=${s.posture} · format=${s.phraseFormat} · candidateAlive=${s.candidateAlive} · recoveryRequired=${s.recoveryRequired}`;
  } catch { return 'up (door not answering status yet)'; }
}

async function status(): Promise<void> {
  const rows = readRegistry();
  if (rows.length === 0) { process.stdout.write('no waves registered. `bun scripts/aumlokWave.ts prepare` to start one.\n'); return; }
  process.stdout.write('\nAUMLOK waves:\n');
  for (const rec of rows) {
    process.stdout.write(`  ${rec.id}  :${rec.port}  ${await statusOf(rec)}\n`);
  }
  process.stdout.write('\n');
  // status is READ-ONLY over the registry — it NEVER prunes rows. Only `destroy` removes a wave.
}

function destroy(idArg?: string): void {
  const rows = readRegistry();
  const targets = idArg ? rows.filter((r) => r.id === idArg) : rows;
  if (targets.length === 0) { process.stdout.write(idArg ? `no wave with id ${idArg}.\n` : 'no waves to destroy.\n'); return; }
  const survivors: WaveRecord[] = idArg ? rows.filter((r) => r.id !== idArg) : [];
  for (const rec of targets) {
    const guard = assertDestroyable(rec.home, rec.sentinel);
    if (!guard.ok) { process.stdout.write(`  SKIP ${rec.id}: ${guard.why}\n`); survivors.push(rec); continue; }
    // ONLY signal a PID that is verifiably OUR door — an alive-but-mismatched PID is a reused
    // stranger and is NEVER signaled (its process group is left entirely alone). The home is still
    // sentinel-verified above, so removing it is always safe.
    if (isOurDoor(rec)) { try { process.kill(-rec.pid); } catch { try { process.kill(rec.pid); } catch { /* already gone */ } } }
    fs.rmSync(rec.home, { recursive: true, force: true });
    process.stdout.write(`  destroyed ${rec.id} (port ${rec.port}, home removed)\n`);
  }
  writeRegistry(survivors.filter((r) => pidAlive(r.pid) || fs.existsSync(r.home)));
}

// CLI dispatch runs ONLY when invoked directly (import.meta.main) — importing for tests is inert.
if (import.meta.main) {
  const cmd = process.argv[2];
  if (cmd === 'prepare') { await prepare(); }
  else if (cmd === 'resume') { await resume(process.argv[3]); }
  else if (cmd === 'status') { await status(); }
  else if (cmd === 'destroy') { destroy(process.argv[3]); }
  else {
    process.stdout.write('usage: bun scripts/aumlokWave.ts <prepare|resume <id>|status|destroy [id]>\n');
    process.exit(2);
  }
}
