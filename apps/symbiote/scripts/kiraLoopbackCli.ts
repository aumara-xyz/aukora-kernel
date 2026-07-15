#!/usr/bin/env bun
import * as fs from 'fs';
import * as path from 'path';
import { createKiraLoopbackServer } from '../receiver/kiraLoopback';

function repoRoot(): string {
  return path.resolve(__dirname, '..');
}

function defaultStatePath(): string {
  return process.env.AUKORA_KIRA_STATE ?? path.join(repoRoot(), 'state', 'kira', 'brain.json');
}

function arg(name: string, fallback = ''): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

// Issue #21 (rename fallout): refuse to boot serving an empty brain when a real, unmigrated legacy
// brain is sitting right next to it — see core/src/kiraCli.ts's refuseIfOrphanedLegacyBrain for the
// full story. Checked once at startup, not per-request. Must resolve the legacy path the SAME way
// kiraCli.ts does (AUKORA_KIRA_LEGACY_STATE override first) — a hardcoded default here would let the
// two guards silently disagree about which path is "the legacy brain" whenever a caller (e.g. a test,
// or a future multi-instance setup) overrides the env var, which is exactly the kind of silent
// divergence this whole round exists to close.
function legacyStatePath(): string {
  return process.env.AUKORA_KIRA_LEGACY_STATE ?? path.join(repoRoot(), 'state', 'mega-mind', 'brain.json');
}

function refuseIfOrphanedLegacyBrain(): void {
  const legacyPath = legacyStatePath();
  if (fs.existsSync(defaultStatePath())) return;
  if (!fs.existsSync(legacyPath)) return;
  process.stderr.write(
    `REFUSING TO START: ${defaultStatePath()} does not exist, but a legacy (pre-rename) brain state\n` +
    `file was found at ${legacyPath}. Run the one-time migration first: kira.sh migrate\n`,
  );
  process.exit(1);
}

refuseIfOrphanedLegacyBrain();

const host = arg('host', '127.0.0.1');
const port = Number(arg('port', '3220'));
const server = createKiraLoopbackServer({ statePath: defaultStatePath() });

server.listen(port, host, () => {
  process.stdout.write(JSON.stringify({
    ok: true,
    mode: 'kira_loopback_readonly',
    url: `http://${host}:${port}`,
    statePath: defaultStatePath(),
    advisoryOnly: true,
    grantsAuthority: false,
  }, null, 2) + '\n');
});
