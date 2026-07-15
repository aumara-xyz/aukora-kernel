// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * AUTO-DRAIN WATCHER — the hands-free half of inward-out recursion (#69/#102).
 *
 * When Auma queues a rehearsal from her seat (rehearse_intent → an order in
 * ~/.aukora-symbiote/aumlok/rehearsal-queue/), this watcher notices and drains it AUTOMATICALLY —
 * so a chat "make the send button gold" reaches the owner's gate with NO terminal step. The owner
 * types → she drafts → it rehearses itself → it waits at the gate. One human gesture remains: the
 * signature.
 *
 * SAFETY — this changes NOTHING about authority:
 *   - It automates ONLY the rehearsal, which itself STOPS at AWAITING_OWNER_SIGNATURE. There is no
 *     apply path here; only Peter's key applies anything, exactly as before.
 *   - It does not author, sign, or apply. It shells the EXISTING, unit-tested runner verbatim
 *     (scripts/rehearsalQueueRunner.ts --execute --max 1) — zero new drain logic, zero new trust.
 *   - OFF BY DEFAULT: runs only under AUKORA_AUTO_DRAIN=1. Landing this arms nothing.
 *   - Ring ceiling: by default only Ring>=3 (lowest-risk, app/docs surface) auto-drains; kernel/
 *     authority-touching orders (Ring<3) are left for a deliberate manual drain.
 *   - Serial: one drain at a time, so two orders never race the workbench.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const HOME = process.env.AUKORA_SYMBIOTE_HOME ?? path.join(os.homedir(), '.aukora-symbiote');
const QUEUE = path.join(HOME, 'aumlok', 'rehearsal-queue');
const REPO = path.resolve(__dirname, '..');
const BUN = process.execPath;
const POLL_MS = Number(process.env.AUKORA_AUTO_DRAIN_POLL_MS ?? 2500);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
// Lowest-risk floor by default: only Ring>=3 (app/docs) auto-drains. Override deliberately.
const RING_CEILING = process.env.AUKORA_AUTO_DRAIN_RING_CEILING ?? '3';

function pendingOrderCount(): number {
  try {
    return fs.readdirSync(QUEUE).filter((f) => f.endsWith('.json')).length;
  } catch {
    return 0; // queue dir not created yet — nothing to drain
  }
}

function drainOnce(): Promise<void> {
  return new Promise((resolve) => {
    // eslint-disable-next-line no-console
    console.log('[auto-drain] order detected — rehearsing (stops at owner signature; nothing applies)…');
    const child = Bun.spawn(
      [BUN, 'run', path.join('scripts', 'rehearsalQueueRunner.ts'), '--execute', '--max', '1', '--ring-ceiling', RING_CEILING],
      { cwd: REPO, stdio: ['ignore', 'inherit', 'inherit'], env: process.env },
    );
    child.exited.then(() => resolve());
  });
}

async function main(): Promise<void> {
  if (process.env.AUKORA_AUTO_DRAIN !== '1') {
    // eslint-disable-next-line no-console
    console.log('[auto-drain] OFF (set AUKORA_AUTO_DRAIN=1 to arm). Exiting.');
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`[auto-drain] ARMED · watching ${QUEUE} every ${POLL_MS}ms · ring ceiling ${RING_CEILING} · rehearsal only, never signs.`);
  for (;;) {
    if (pendingOrderCount() > 0) {
      try { await drainOnce(); } catch (e) { console.error('[auto-drain] drain error (non-fatal):', e instanceof Error ? e.message : String(e)); }
    }
    await sleep(POLL_MS);
  }
}

main();
