#!/usr/bin/env bun
// start-node.ts — the one command for a sovereign node, on ANY OS.
//
//   bun run start
//
// Installs deps if needed, starts the two local servers the Spatial app needs — the read surface (:7090)
// and the chat door (:7091, where Auma answers) — waits until the app is up, and opens it in your browser.
// The servers run in THIS terminal; keep it open and press Ctrl-C to stop.
//
// Pure Bun — NO bash, no lsof, no `open`/`nohup`. It runs the same on Windows, macOS, and Linux. (The only
// per-OS bit is which command opens the browser.) Loopback only; no shipped owner key or owner memory.

import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const REPO = join(import.meta.dir, '..');
const SPATIAL_PORT = Number(process.env.AUKORA_SPATIAL_PORT ?? 7090);
const CHAT_PORT = Number(process.env.AUKORA_SPATIAL_CHAT_PORT ?? 7091);
const ARC3_PORT = Number(process.env.AUKORA_ARC3_PORT ?? 7093); // 7092 belongs to the Auma Live / KNVS voice sidecar
const BIND_PORT = Number(process.env.AUKORA_AUMLOK_BIND_PORT ?? 7095);
const APPROVE_PORT = Number(process.env.AUKORA_AUMLOK_APPROVE_PORT ?? 7094);
const DRAIN_PORT = Number(process.env.AUKORA_DRAIN_PORT ?? 7089); // 7096 is taken on the coordinator node; 7089 is clean
const BUN = process.execPath; // the exact bun running this script (bun.exe on Windows)
const SYMBIOTE_HOME = process.env.AUKORA_SYMBIOTE_HOME ?? join(homedir(), '.aukora-symbiote');
const AUMLOK_DIR = join(SYMBIOTE_HOME, 'aumlok');
const HYBRID_DIR = join(AUMLOK_DIR, 'hybrid-v2');
// Presence-only startup routing. A hybrid node counts as bound only when the complete published
// identity shape exists; a partial bundle is sent back to the fail-closed ceremony door.
const HYBRID_STARTUP_FILES = [
  'authority-ed25519.key', 'authority-mldsa65.key', 'authority-root-v2.json',
  'binding-receipt-v2.json', 'bind-commit-v2.json',
] as const;
const LEGACY_BOUND = existsSync(join(AUMLOK_DIR, 'authority-ed25519.key'));
const HYBRID_BOUND = HYBRID_STARTUP_FILES.every((name) => existsSync(join(HYBRID_DIR, name)));
const NODE_IS_UNBOUND = !(LEGACY_BOUND || HYBRID_BOUND);
const SPATIAL_URL = `http://127.0.0.1:${SPATIAL_PORT}`;
const BIND_URL = `http://127.0.0.1:${BIND_PORT}`;
const URL = NODE_IS_UNBOUND ? BIND_URL : SPATIAL_URL;

async function portUp(port: number): Promise<boolean> {
  try { await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(600) }); return true; }
  catch { return false; }
}

const servers: Array<ReturnType<typeof Bun.spawn>> = [];
// One-shot doors (the AUMLOK binding ceremony) EXIT on success by design — they are killed on shutdown
// like everything else, but never babysat: their planned exit must not take the node down with it.
const oneShotDoors: Array<ReturnType<typeof Bun.spawn>> = [];

async function startIfDown(name: string, script: string, port: number, opts: { babysit?: boolean; env?: Record<string, string> } = {}) {
  if (await portUp(port)) { console.log(`▸ ${name} already running on :${port}`); return; }
  console.log(`▸ starting ${name} on :${port}`);
  (opts.babysit === false ? oneShotDoors : servers).push(Bun.spawn([BUN, 'run', join('spatial', script)], {
    cwd: REPO, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, ...(opts.env ?? {}) },
  }));
}

function openBrowser() {
  const cmd = process.platform === 'win32' ? ['cmd', '/c', 'start', '', URL]
    : process.platform === 'darwin' ? ['open', URL]
    : ['xdg-open', URL];
  try { Bun.spawn(cmd, { stdio: ['ignore', 'ignore', 'ignore'] }); }
  catch { console.log(`  open this in your browser: ${URL}`); }
}

async function main() {
  if (!existsSync(join(REPO, 'core', 'node_modules'))) {
    console.log('▸ Installing lightweight runtime dependencies (first run)…');
    // The repo is a workspace, but the friend-node launcher does not need the heavy
    // embedder workspace. Installing only the core package avoids the optional
    // Sharp/node-gyp/Python path on fresh Windows machines, while still including
    // TypeScript because one runtime verifier imports it.
    const inst = Bun.spawn([BUN, 'install', '--filter', 'aukora-edge-node'], {
      cwd: REPO,
      stdio: ['inherit', 'inherit', 'inherit'],
    });
    if ((await inst.exited) !== 0) { console.error('✗ dependency install failed'); process.exit(1); }
  }

  // Bring up the memory brain (the local Convex backend — Auma's nervous system) unless told to skip.
  // First run downloads the backend binary for your OS (~55 MB) + provisions it. Best-effort: if it can't
  // start (e.g. no network), the app still runs on file-based memory and we tell you how to retry.
  if (process.env.AUKORA_NO_BRAIN !== '1') {
    console.log('▸ bringing up the memory brain (Convex)…');
    try {
      const b = Bun.spawn([BUN, 'run', join('scripts', 'brain-setup.ts')], { cwd: REPO, stdio: ['ignore', 'inherit', 'inherit'], env: process.env });
      if ((await b.exited) !== 0) console.log('  (memory brain did not start — the app still runs; retry any time with `bun run brain`)');
    } catch { console.log('  (could not launch the brain step — retry with `bun run brain`)'); }
  }

  // Bound nodes default to the full governed Aukora posture: seat tools on, Convex recall on by
  // router default, and shadow-capture ARMED unless the owner explicitly turns it off. This keeps
  // the live organism's memory honest without a manual env dance every restart.
  const boundNodeEnv = NODE_IS_UNBOUND ? {} : {
    AUKORA_MEMORY_SHADOW_CAPTURE: process.env.AUKORA_MEMORY_SHADOW_CAPTURE ?? '1',
  };
  await startIfDown('spatial', 'serve.ts', SPATIAL_PORT, { env: boundNodeEnv });
  const voiceSeatEnv = NODE_IS_UNBOUND ? {} : {
    ...boundNodeEnv,
    AUKORA_VOICE_READ_TOOLS: process.env.AUKORA_VOICE_READ_TOOLS ?? '1',
    AUKORA_VOICE_PROPOSE: process.env.AUKORA_VOICE_PROPOSE ?? '1',
    AUKORA_VOICE_REHEARSE: process.env.AUKORA_VOICE_REHEARSE ?? '1',
    AUKORA_VOICE_READ_REHEARSAL_LOGS: process.env.AUKORA_VOICE_READ_REHEARSAL_LOGS ?? '1',
    AUKORA_VOICE_INBOX_APPEND: process.env.AUKORA_VOICE_INBOX_APPEND ?? '1',
  };
  await startIfDown('spatial-chat', 'chat-serve.ts', CHAT_PORT, { env: voiceSeatEnv });
  await startIfDown('arc3-door', 'arc3-serve.ts', ARC3_PORT);
  // Canonical-ceremony round (#242): the binding door runs on BOTH postures — unbound it serves the
  // first binding; sovereign it serves ONLY in-app phrase rotation (typed current phrase + lockout;
  // the kernel refuses keygen when bound, so there is still no standing keygen surface). The
  // old rebind env flag is retired — rotation never requires editing an environment variable.
  // One-shot: the door closes itself after a completed ceremony, so it is deliberately NOT babysat.
  await startIfDown('aumlok-binding', 'aumlok-bind-serve.ts', BIND_PORT, { babysit: false });
  // The approval gate runs on a BOUND node (owner directive 2026-07-08: AUMLOK lives natively in the
  // shell — the AUMLOK organ embeds this gate in-place; no separate tab, no terminal, no hand-arming).
  // Long-running and babysat like the other doors. AUKORA_AUMLOK_UI_APPROVE=0 keeps it off.
  if (!NODE_IS_UNBOUND && process.env.AUKORA_AUMLOK_UI_APPROVE !== '0') {
    await startIfDown('aumlok-approve', 'aumlok-approve-serve.ts', APPROVE_PORT, { env: boundNodeEnv });
  }
  // AUTO-DRAIN (#69/#102, the handoff brick, 2026-07-08): on a BOUND node, queued rehearsals run in
  // the background — day-budgeted (drainBudget.ts), receipted, always stopping at the owner's
  // signature. The owner appears only at decision points (the gate; lineage-locked escalations).
  // AUKORA_AUTODRAIN=0 is the off-switch.
  if (!NODE_IS_UNBOUND && process.env.AUKORA_AUTODRAIN !== '0') {
    await startIfDown('auto-drain', 'drain-serve.ts', DRAIN_PORT);
  }

  process.stdout.write('▸ waiting for the app');
  let up = false;
  for (let i = 0; i < 40; i++) { if (await portUp(SPATIAL_PORT)) { up = true; break; } process.stdout.write('.'); await Bun.sleep(400); }
  console.log(up ? ' — up.' : ' — timeout.');
  if (!up) { console.error(`✗ the app did not come up on :${SPATIAL_PORT} — check the output above`); process.exit(1); }

  if (process.env.AUKORA_NO_OPEN === '1') { console.log(`▸ app ready at ${URL} (auto-open skipped)`); }
  else { console.log(`▸ opening ${URL}`); openBrowser(); }

  console.log('');
  console.log(`  Spatial app: ${SPATIAL_URL}`);
  console.log('  First stop:  System → Settings → paste your OpenRouter key → talk to Auma.');
  if (NODE_IS_UNBOUND) {
    console.log(`  This node is UNBOUND — the browser opened the binding: ${BIND_URL}`);
  }
  if (!servers.length && !oneShotDoors.length) { console.log('  (the servers were already running; this terminal can close.)'); return; }
  console.log('  Keep this terminal open. Press Ctrl-C to stop the node.');

  const shutdown = () => { for (const p of [...servers, ...oneShotDoors]) { try { p.kill(); } catch { /* already gone */ } } process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // Babysit: if any server exits on its own (crash), stop the rest and report.
  await Promise.race(servers.map((p) => p.exited));
  console.error('\n✗ a server stopped unexpectedly. Shutting the node down.');
  shutdown();
}

main();
