#!/usr/bin/env bun
// stop-node.ts — stop the contributor-node servers, on any OS.
//
// If you started the node with `bun run start`, the clean stop is Ctrl-C in that terminal. This is a
// best-effort fallback that kills any lingering spatial/chat server processes from another terminal.

const TARGETS = [
  'spatial/serve.ts',
  'spatial/chat-serve.ts',
  'spatial/arc3-serve.ts',
  'spatial/aumlok-approve-serve.ts',
  'spatial/aumlok-bind-serve.ts',
  'spatial/autoDrainWatcher.ts',
];
const PM2_NAMES = [
  'spatial',
  'spatial-chat',
  'arc3-door',
  'aumlok-approve',
  'aumlok-binding',
  'auto-drain',
];

function tryKill(cmd: string[]) {
  try { Bun.spawnSync(cmd, { stdio: ['ignore', 'ignore', 'ignore'] }); } catch { /* tool not present */ }
}

if (process.platform === 'win32') {
  // Match bun processes whose command line includes our server scripts, and kill them.
  // start-node spawns them with a SINGLE backslash (path.join), so match that — and the
  // forward-slash form too, for servers someone started by hand.
  for (const t of TARGETS) {
    const needle = t.replace('/', '\\');
    tryKill(['powershell', '-NoProfile', '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${needle}*' -or $_.CommandLine -like '*${t}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`]);
  }
} else {
  for (const name of PM2_NAMES) tryKill(['pm2', 'stop', name]);
  for (const t of TARGETS) tryKill(['pkill', '-f', t]);
}
console.log('▸ stop signal sent. (If the node was started with `bun run start`, Ctrl-C in that terminal is the clean stop.)');
