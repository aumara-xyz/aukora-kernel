// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// AUMLOK WAVE LIFECYCLE — real-CLI integration (AUTOMATION, never owner acceptance).
// Drives scripts/aumlokWave.ts end-to-end in an ISOLATED sandbox (its own TMPDIR, so the registry
// and every disposable home land inside the sandbox and clean up wholesale). Pins the two owner
// cycles Codex required: prepare -> simulated door exit -> status(reopenable) -> resume(same home,
// fresh port), and prepare -> exit -> status -> destroy(home removed). Content-free throughout.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawn } from 'child_process';

const SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'aumlokWave.ts');
let sandbox: string;
let spawnedPids: number[] = [];

function run(args: string[]): string {
  return execFileSync('bun', [SCRIPT, ...args], { env: { ...process.env, TMPDIR: sandbox }, encoding: 'utf8', timeout: 30_000 });
}
function registryPath(): string {
  return path.join(sandbox, `aumlok-wave-registry-${typeof process.getuid === 'function' ? process.getuid() : 'nouid'}.json`);
}
function readReg(): Array<{ id: string; home: string; port: number; pid: number }> {
  try { return JSON.parse(fs.readFileSync(registryPath(), 'utf8')); } catch { return []; }
}
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }
function killWait(pid: number): void {
  try { process.kill(pid); } catch { /* gone */ }
  for (let i = 0; i < 40 && alive(pid); i++) { execFileSync('sleep', ['0.05']); }
}

beforeEach(() => { sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-lifecycle-')); spawnedPids = []; });
afterEach(() => {
  for (const rec of readReg()) { if (alive(rec.pid)) killWait(rec.pid); }
  for (const pid of spawnedPids) { if (alive(pid)) killWait(pid); }
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('the owner cycle survives the one-shot door across a resume', () => {
  it('prepare -> simulated exit -> status(REOPENABLE) -> resume(same home, fresh port)', () => {
    const out = run(['prepare']);
    expect(out).toContain('READY');
    const reg = readReg();
    expect(reg.length).toBe(1);
    const wave = reg[0];
    spawnedPids.push(wave.pid);
    expect(alive(wave.pid)).toBe(true);
    const homeBefore = wave.home;
    const portBefore = wave.port;

    // simulate the door's one-shot exit
    killWait(wave.pid);
    expect(alive(wave.pid)).toBe(false);

    // status must NOT forget it, and must say reopenable
    const st = run(['status']);
    expect(st).toContain(wave.id);
    expect(st).toMatch(/REOPENABLE/);
    expect(readReg().length).toBe(1); // never pruned

    // resume the EXACT same home on a fresh port
    const rz = run(['resume', wave.id]);
    expect(rz).toContain('RESUMED');
    const after = readReg()[0];
    spawnedPids.push(after.pid);
    expect(after.home).toBe(homeBefore); // same disposable home reused
    expect(after.port).not.toBe(portBefore); // fresh port
    expect(alive(after.pid)).toBe(true); // proven-ready door
    expect(fs.existsSync(path.join(after.home, '.aumlok-wave-sentinel.json'))).toBe(true);
  });

  it('prepare -> exit -> status -> destroy removes the home and forgets the wave', () => {
    run(['prepare']);
    const wave = readReg()[0];
    spawnedPids.push(wave.pid);
    const home = wave.home;
    killWait(wave.pid);

    const st = run(['status']);
    expect(st).toContain(wave.id); // preserved after exit

    const dz = run(['destroy', wave.id]);
    expect(dz).toContain('destroyed');
    expect(fs.existsSync(home)).toBe(false); // home removed
    expect(readReg().length).toBe(0); // forgotten only after explicit destroy
  });

  it('PID REUSE: an alive but mismatched PID is never called up and never signaled (status/destroy/resume)', () => {
    // a real, unrelated, alive process that happens to hold a PID we will pretend is a wave door
    const stranger = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
    stranger.unref();
    const strangerPid = stranger.pid!;
    spawnedPids.push(strangerPid);
    expect(alive(strangerPid)).toBe(true);

    // seed a registry record pointing at the stranger PID with a MISMATCHED launch identity
    const home = fs.mkdtempSync(path.join(sandbox, 'aumlok-wave-'));
    fs.writeFileSync(path.join(home, '.aumlok-wave-sentinel.json'), JSON.stringify({ schema: 'aumlok-wave-sentinel-v1', token: 'wave-' + 'a'.repeat(32) }) + '\n');
    fs.writeFileSync(registryPath(), JSON.stringify([{
      id: 'wave-reused', home, port: 59999, pid: strangerPid, startedAt: 'x', sentinel: 'wave-' + 'a'.repeat(32),
      launch: { start: 'Mon Jan  1 00:00:00 2001', args: 'bun /some/other/thing' }, // deliberately NOT the door identity
    }]));

    // status must NOT say "up" — the mismatched PID reads as exited/reopenable
    const st = run(['status']);
    expect(st).toContain('wave-reused');
    expect(st).toMatch(/REOPENABLE/);
    expect(st).not.toMatch(/wave-reused.*up ·/);

    // destroy must remove the home but NEVER signal the stranger
    const dz = run(['destroy', 'wave-reused']);
    expect(dz).toContain('destroyed');
    expect(fs.existsSync(home)).toBe(false); // sentinel'd home is safe to remove
    expect(alive(strangerPid)).toBe(true); // the unrelated process is untouched — the whole point
  });

  it('resume refuses an id whose home lost its sentinel (never reopens a stranger path)', () => {
    run(['prepare']);
    const wave = readReg()[0];
    spawnedPids.push(wave.pid);
    killWait(wave.pid);
    // strip the sentinel — the home is no longer a verified disposable wave
    fs.rmSync(path.join(wave.home, '.aumlok-wave-sentinel.json'), { force: true });
    let out = '';
    try { out = run(['resume', wave.id]); } catch (e) { out = String((e as { stdout?: Buffer }).stdout ?? e); }
    expect(out).toMatch(/cannot resume/i);
    expect(readReg().length).toBe(1); // still tracked, still cleanable
  });
});
