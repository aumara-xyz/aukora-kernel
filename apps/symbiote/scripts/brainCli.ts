// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Thin CLI over core/src/convexBackendManager.ts — the DECISIONS live in the manager (unit-tested);
// this just prints them as JSON/lines for scripts/brain.sh. It never spawns or kills a process.
import {
  resolveBrainPaths,
  binaryIdentity,
  buildBootArgv,
  preflightBrain,
  readSecretStrict,
  isStateDirWritable,
} from '../core/src/convexBackendManager';
import { execSync } from 'child_process';

const repoRoot = process.env.AUKORA_REPO_ROOT ?? process.cwd();
const cmd = process.argv[2] ?? '';
const binPath = process.env.AUKORA_CONVEX_BACKEND_BIN ?? '';

function isPortFree(port: number): boolean {
  try { execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN`, { stdio: 'ignore' }); return false; }
  catch { return true; } // lsof exits non-zero when nothing listens
}

try {
  if (cmd === 'paths') {
    process.stdout.write(JSON.stringify(resolveBrainPaths({ repoRoot }), null, 2) + '\n');
  } else if (cmd === 'identity') {
    process.stdout.write(JSON.stringify(binaryIdentity(binPath), null, 2) + '\n');
  } else if (cmd === 'argv') {
    const p = resolveBrainPaths({ repoRoot });
    const secret = readSecretStrict(p.instanceSecretPath, 'instance secret');
    process.stdout.write(buildBootArgv(p, secret).join('\n') + '\n'); // one arg per line — safe for bash mapfile
  } else if (cmd === 'preflight') {
    // the state-dir check must actually RUN in production (a missing callback silently skips it)
    const r = preflightBrain({ repoRoot, binPath, isPortFree, stateDirWritable: isStateDirWritable });
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    process.exit(r.ok ? 0 : 1);
  } else {
    process.stderr.write('usage: brainCli.ts <paths|identity|argv|preflight>\n');
    process.exit(2);
  }
} catch (e) {
  process.stderr.write((e instanceof Error ? e.message : String(e)) + '\n');
  process.exit(1);
}
