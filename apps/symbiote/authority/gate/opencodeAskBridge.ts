// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * 24Z.65 — the AUMLOK gate bridge. Its REAL live caller today is memory-write gating
 * (`memory/memory.ts`'s `aukoraGovernAsk({ permission: 'memory', ... })`, called before every
 * remember/forget) — routed through the SAME gate every other write-capable action uses. The
 * `OpenCodeAskReq` shape (`{permission, patterns, always, metadata}`) is a generic per-action ask
 * request, not tied to any specific external tool; the docstring previously described a
 * "LIVE OpenCode ctx.ask" caller and a `scripts/dev/apply-aukora-ide-gate.sh` patch script — neither
 * exists in this repo (fixed 2026-07-02, issue #24). If a real external-tool integration is ever
 * built, it would call this same `aukoraGovernAsk` entrypoint, unchanged.
 *
 * Fail-closed: the AUMLOK session is read from a local file and defaults to LOCKED → write-capable tools PAUSE until an
 * AUMLOK session is explicitly unlocked. No phrase/secret is read here; only an {unlocked, expiresAt} session record.
 */
import { readFileSync, appendFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { aukoraGate } from './aukoraGate';
import type { AukoraAskInput, AukoraSession, GateDecision } from './types';
import { symbioteHome, aumlokSessionPath } from '../symbiotePaths';

export interface OpenCodeAskReq {
  permission?: string;
  patterns?: string[];
  always?: string[];
  metadata?: { filepath?: string; diff?: string; command?: string; [k: string]: unknown };
}

// Fixed 2026-07-02 (issue #24 follow-up): SESSION_FILE resolution now comes from the SAME shared
// resolver authority/aumlok/ceremony.ts (the writer) uses — the two used to drift independently,
// which is exactly the bug this follow-up exists to close. RECEIPT_FILE isn't part of the ceremony's
// own writer/reader contract, so it stays local here, but still resolves under the same symbiote home.
//
// Fixed 2026-07-02 (issue #25 follow-up, Fable QA): both of these used to be module-level `const`s,
// resolved ONCE at import time — before any test's beforeEach could override AUKORA_SYMBIOTE_HOME.
// Real consequence, caught by Fable's own verification pass: running the ceremony round-trip test
// (which imports this module statically) appended real gate-decision lines to the OWNER'S actual
// ~/.aukora-symbiote/aukora-ide-receipts.jsonl. Both are now resolved FRESH at every call — matching
// kiraBrain.ts's defaultKiraStatePath() pattern (a plain function, never a cached module-level const).
function receiptFilePath(): string {
  return process.env.AUKORA_IDE_RECEIPTS_FILE || join(symbioteHome(), 'aukora-ide-receipts.jsonl');
}

/** Read the AUMLOK IDE session record. Fail-closed → LOCKED on any error/missing file. No phrase is read. */
export function readAukoraSession(file: string = aumlokSessionPath()): AukoraSession {
  try {
    const j = JSON.parse(readFileSync(file, 'utf-8')) as { unlocked?: boolean; expiresAt?: number };
    return { unlocked: !!j.unlocked, expiresAt: typeof j.expiresAt === 'number' ? j.expiresAt : undefined };
  } catch {
    return { unlocked: false };
  }
}

function recordReceipt(d: GateDecision, file: string = receiptFilePath()): void {
  try { mkdirSync(dirname(file), { recursive: true }); appendFileSync(file, JSON.stringify(d.receipt) + '\n'); } catch { /* receipts best-effort; never block the gate */ }
}

/** The gate entrypoint every write-capable ask routes through (today: memory/memory.ts's writes).
 *  Decides allow/deny/pause + records a receipt (no secret value). */
export function aukoraGovernAsk(req: OpenCodeAskReq, session?: AukoraSession): GateDecision {
  const sess = session ?? readAukoraSession();
  const input: AukoraAskInput = {
    tool: req.permission ?? 'tool',
    permission: req.permission ?? 'tool',
    patterns: req.patterns,
    always: req.always,            // captured but NEVER used to skip the risk decision (anti-bypass)
    metadata: req.metadata,
  };
  const decision = aukoraGate(input, sess);
  recordReceipt(decision);
  return decision;
}
