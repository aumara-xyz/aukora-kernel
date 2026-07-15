// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * AUTO-DRAIN door (#69/#102 — the handoff brick, owner-directed 2026-07-08: "time for her to fly").
 * A tiny loopback door that watches the rehearsal queue and runs the EXISTING runner for it, so a
 * chat-staged proposal auto-rehearses and lands at the AUMLOK gate with NO terminal step. The owner
 * appears only at decision points: the gate, and lineage-locked escalations.
 *
 * What this door is NOT: it is not a second executor. It SPAWNS `scripts/rehearsalQueueRunner.ts
 * --execute --max 1` — the same single source of truth the owner runs by hand — so every invariant
 * that runner holds (stops at AWAITING_OWNER_SIGNATURE, receipts every outcome, archives handled
 * orders, locks exhausted lineages) holds here by construction. The door only SCHEDULES and REPORTS.
 *
 * Guardrails:
 *   - Day budget (wishlist Brick 3.3, core/src/drainBudget.ts): at most N rehearsal STARTS per UTC
 *     day (default 12, AUKORA_DRAIN_BUDGET overrides, nonsense falls back to 12 — never unlimited).
 *     Exhausted = the queue holds, untouched, for tomorrow or the owner's own terminal run.
 *   - One drain at a time (in-process flag; the door owns its port, so one process owns the flag).
 *   - Poll is CHEAP: a read-only queue listing decides whether to spend anything at all.
 *   - Loopback-only, GET-only status surface. No POST, no controls — the off-switch is the env
 *     (AUKORA_AUTODRAIN=0 + restart), never an HTTP request.
 *   - ON by default on a node that runs it (same posture as the approve gate since 2026-07-08):
 *     scripts/start-node.ts starts it only on a BOUND node and honors AUKORA_AUTODRAIN=0.
 *
 * Authority: none. The drain can spend compute; it cannot sign, apply, or touch the key. Everything
 * it starts stops at the owner's signature, exactly as if he had typed the command himself.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readRehearsalQueue } from '../core/src/rehearsalQueue';
import {
  readDrainBudgetState, consumeDrainBudget, effectiveDrainMax, type DrainBudgetStateV1,
} from '../core/src/drainBudget';

const PORT = Number(process.env.AUKORA_DRAIN_PORT ?? 7089);
const REPO_ROOT = path.resolve(__dirname, '..');
const SYMBIOTE_HOME = process.env.AUKORA_SYMBIOTE_HOME ?? path.join(os.homedir(), '.aukora-symbiote');
const QUEUE_DIR = path.join(SYMBIOTE_HOME, 'aumlok', 'rehearsal-queue');
const BUDGET_PATH = path.join(SYMBIOTE_HOME, 'aumlok', 'drain-budget.json');
const BUDGET_MAX = effectiveDrainMax(Number(process.env.AUKORA_DRAIN_BUDGET ?? Number.NaN));
// Floor of 15s keeps a mistyped env from busy-looping; default one minute.
const INTERVAL_MS = Math.max(15_000, Number(process.env.AUKORA_DRAIN_INTERVAL_MS ?? 60_000) || 60_000);
// THE HANDS UPGRADE (owner-directed 2026-07-08: "be surgical with the powers — let her free"):
// rehearsals this door starts run with her MAIN mind by default. Real evidence forced this: THREE
// consecutive pocket-model rehearsals (2× ring-lint, 1× hot-corner fix) died at max_rounds_no_patch
// without ever producing a patch — competent drafts, hands too small to carry them. The day budget
// above is the spend guard that makes this default safe (12 starts/day, hard). Precedence: an
// explicit AUKORA_DRAIN_AGENT_MODEL wins; a node-level AUKORA_AGENT_MODEL is respected (never
// clobbered); otherwise her main mind. Model choice changes COMPETENCE only — every rehearsal still
// stops at the owner's signature.
const DRAIN_AGENT_MODEL = process.env.AUKORA_DRAIN_AGENT_MODEL ?? process.env.AUKORA_AGENT_MODEL ?? 'anthropic/claude-fable-5';

function readBudgetFile(nowIso: string): DrainBudgetStateV1 {
  let raw: unknown = null;
  try { raw = JSON.parse(fs.readFileSync(BUDGET_PATH, 'utf-8')); } catch { /* fresh/corrupt = fresh day */ }
  return readDrainBudgetState(raw, nowIso);
}
function writeBudgetFile(state: DrainBudgetStateV1): void {
  try {
    fs.mkdirSync(path.dirname(BUDGET_PATH), { recursive: true, mode: 0o700 });
    fs.writeFileSync(BUDGET_PATH, JSON.stringify(state, null, 1) + '\n', { mode: 0o600 });
  } catch { /* a failed budget write must not stop the node — the next read resets honestly */ }
}

interface LastRun { at: string; exitCode: number | null; lines: string[] }
let running = false;
let lastRun: LastRun | null = null;
let lastSkipReason: string | null = null;
let drainsStartedThisProcess = 0;

async function drainTick(): Promise<void> {
  if (running) return; // one at a time — a rehearsal can take minutes
  const { orders } = readRehearsalQueue(QUEUE_DIR);
  if (orders.length === 0) { lastSkipReason = null; return; } // nothing queued — spend nothing
  const nowIso = new Date().toISOString();
  const budget = consumeDrainBudget(readBudgetFile(nowIso), nowIso, BUDGET_MAX);
  if (!budget.ok) { lastSkipReason = budget.reason; return; } // queue holds, untouched
  writeBudgetFile(budget.next);
  lastSkipReason = null;
  running = true;
  drainsStartedThisProcess++;
  const startedAt = new Date().toISOString();
  try {
    // The runner is the single source of truth: receipts, evidence surfacing, archiving, the ladder.
    const proc = Bun.spawn(['bun', path.join('scripts', 'rehearsalQueueRunner.ts'), '--execute', '--max', '1'], {
      cwd: REPO_ROOT, stdout: 'pipe', stderr: 'pipe',
      env: { ...process.env, AUKORA_AGENT_MODEL: DRAIN_AGENT_MODEL },
    });
    const [out, err, exitCode] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ]);
    const lines = (out + (err ? '\n' + err : '')).split('\n').filter((l) => l.trim()).slice(-12).map((l) => l.slice(0, 300));
    lastRun = { at: startedAt, exitCode, lines };
    // eslint-disable-next-line no-console
    console.log(`auto-drain: rehearsal run finished (exit ${exitCode}) · budget ${budget.remaining} left today`);
  } catch (e) {
    lastRun = { at: startedAt, exitCode: null, lines: [`spawn failed: ${e instanceof Error ? e.message : String(e)}`] };
  } finally {
    running = false;
  }
}

setInterval(() => { void drainTick(); }, INTERVAL_MS);
// First look shortly after boot so a queued order doesn't wait a full interval.
setTimeout(() => { void drainTick(); }, 3_000);

const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

Bun.serve({
  hostname: '127.0.0.1',
  port: PORT,
  fetch(req) {
    const host = req.headers.get('host') ?? '';
    if (!ALLOWED_HOSTS.has(host)) return new Response('forbidden', { status: 403 });
    if (req.method !== 'GET') return new Response(JSON.stringify({ ok: false, reason: 'read-only door — the off-switch is AUKORA_AUTODRAIN=0, never an HTTP request' }), { status: 405, headers: { 'content-type': 'application/json' } });
    const nowIso = new Date().toISOString();
    const budgetState = readBudgetFile(nowIso);
    const { orders, skipped } = readRehearsalQueue(QUEUE_DIR);
    return new Response(JSON.stringify({
      ok: true,
      door: 'auto-drain',
      intervalMs: INTERVAL_MS,
      agentModel: DRAIN_AGENT_MODEL,
      running,
      queue: { orders: orders.length, skipped: skipped.length },
      budget: { day: budgetState.day, used: budgetState.used, max: BUDGET_MAX, remaining: Math.max(0, BUDGET_MAX - budgetState.used) },
      drainsStartedThisProcess,
      lastSkipReason,
      lastRun,
      advisoryOnly: true,
      grantsAuthority: false,
      note: 'every rehearsal this door starts stops at AWAITING_OWNER_SIGNATURE — the owner’s key is the only apply',
    }, null, 1), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  },
});

// eslint-disable-next-line no-console
console.log(`AUTO-DRAIN door on http://127.0.0.1:${PORT} · every ${Math.round(INTERVAL_MS / 1000)}s · budget ${BUDGET_MAX}/day · stops at the owner's signature, always`);
