// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Durable, consume-once ledger of applied proposalHashes — closes a real replay/downgrade vulnerability
 * found in adversarial review: `aumlokAuthorityRoot.ts`'s `verifyPromotionReceipt` has NO nonce-replay
 * check at all, so a validly-signed receipt can be verified as valid repeatedly. Naively treating "live
 * content already matches" as idempotent is UNSAFE — replaying an old signed receipt after newer
 * legitimate edits landed would silently overwrite that newer work with the old signed content (a
 * downgrade attack). This ledger makes a second application of the SAME proposalHash a hard, explicit
 * refusal, never a silent no-op.
 *
 * Durable (disk-persisted outside the repo, under ${AUKORA_SYMBIOTE_HOME}) because `BoundedNonceLedger`
 * (in-memory, epoch-bound) explicitly does NOT survive a process restart — not suitable here, since a
 * live-apply invocation is a fresh, short-lived CLI process every time, not a long-running server.
 *
 * Concurrency note: read-check-write is atomic WITHIN one Node process (synchronous, no other JS runs
 * between the check and the write) and the write itself is atomic on disk (write-to-temp + rename).
 * There is no cross-process lock — two live-apply invocations racing at the exact same instant could
 * both pass the check before either writes. This is an accepted, documented limitation for a
 * human-triggered, one-at-a-time ceremony, not a high-frequency automated path.
 */
import * as fs from 'fs';
import * as path from 'path';

export interface AppliedProposalLedgerEntry {
  proposalHash: string;
  appliedAt: string;
  commitSha: string;
}

export interface AppliedProposalLedgerOptions {
  homeDir?: string; // defaults to ${AUKORA_SYMBIOTE_HOME:-~/.aukora-symbiote}
}

function resolveLedgerPath(homeDir?: string): string {
  const home = homeDir ?? process.env.AUKORA_SYMBIOTE_HOME ?? path.join(process.env.HOME || '', '.aukora-symbiote');
  return path.join(home, 'aumlok', 'applied-ledger.json');
}

function isValidEntry(e: unknown): e is AppliedProposalLedgerEntry {
  return !!e && typeof e === 'object'
    && typeof (e as any).proposalHash === 'string' && (e as any).proposalHash.length > 0
    && typeof (e as any).appliedAt === 'string'
    && typeof (e as any).commitSha === 'string';
}

// A MISSING ledger file (first-ever use) is a legitimate empty state. A ledger file that EXISTS but
// fails to parse is NOT treated as empty — silently doing so would let a replay succeed precisely when
// the ledger is corrupted, exactly backwards for a replay-prevention mechanism. Corruption THROWS, so
// the enforcement path (consumeProposalOnce) fails the whole operation closed rather than proceeding.
function readLedgerOrThrow(ledgerPath: string): AppliedProposalLedgerEntry[] {
  let text: string;
  try { text = fs.readFileSync(ledgerPath, 'utf-8'); } catch { return []; } // ENOENT — first use, legitimately empty
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error(`applied-proposal ledger is corrupt (invalid JSON) at ${ledgerPath}`); }
  if (!Array.isArray(raw)) throw new Error(`applied-proposal ledger is corrupt (not an array) at ${ledgerPath}`);
  if (!raw.every(isValidEntry)) throw new Error(`applied-proposal ledger is corrupt (malformed entry) at ${ledgerPath}`);
  return raw;
}

function writeLedgerAtomic(ledgerPath: string, entries: AppliedProposalLedgerEntry[]): void {
  const dir = path.dirname(ledgerPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmpPath = path.join(dir, `.applied-ledger.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(tmpPath, JSON.stringify(entries, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, ledgerPath); // atomic replace on POSIX — never a half-written ledger on disk
}

/** Read-only, ADVISORY/DISPLAY-ONLY check (e.g. a status panel) — a corrupt ledger reads as "unknown",
 *  never throws. This is NOT the enforcement path; `consumeProposalOnce` is, and it fails closed. */
export function isProposalAlreadyApplied(proposalHash: string, opts: AppliedProposalLedgerOptions = {}): AppliedProposalLedgerEntry | null {
  let entries: AppliedProposalLedgerEntry[];
  try { entries = readLedgerOrThrow(resolveLedgerPath(opts.homeDir)); } catch { return null; }
  return entries.find((e) => e.proposalHash === proposalHash) ?? null;
}

/** Read-only, ADVISORY/DISPLAY-ONLY bulk listing (#178 round 4: the seat-ledger owner-decision join
 *  reads the applied facts through this). Unlike the enforcement path, corruption here is an HONEST
 *  REFUSAL ({ok:false}) rather than a throw — an advisory reader must report "cannot be trusted",
 *  never crash, and never guess empty (guessing empty would let a corrupt ledger read as "nothing was
 *  ever signed"). A missing file is the legitimate first-use empty state. */
export function listAppliedProposals(opts: AppliedProposalLedgerOptions = {}): { ok: true; entries: AppliedProposalLedgerEntry[] } | { ok: false; reason: string } {
  try {
    return { ok: true, entries: readLedgerOrThrow(resolveLedgerPath(opts.homeDir)) };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export type ConsumeResult =
  | { ok: true }
  | { ok: false; existing: AppliedProposalLedgerEntry }
  | { ok: false; corrupt: true; reason: string };

/** ATOMIC (within-process) check-and-record — THE enforcement path. Returns {ok:true} the first time
 *  this exact proposalHash is consumed; {ok:false, existing} on any repeat (hard refusal, never a silent
 *  no-op); {ok:false, corrupt:true} if the ledger cannot be trusted — callers MUST refuse the live apply
 *  in that case rather than proceed as if nothing had ever been applied. */
export function consumeProposalOnce(proposalHash: string, commitSha: string, now: string, opts: AppliedProposalLedgerOptions = {}): ConsumeResult {
  const ledgerPath = resolveLedgerPath(opts.homeDir);
  let entries: AppliedProposalLedgerEntry[];
  try { entries = readLedgerOrThrow(ledgerPath); } catch (e) { return { ok: false, corrupt: true, reason: e instanceof Error ? e.message : String(e) }; }
  const existing = entries.find((e) => e.proposalHash === proposalHash);
  if (existing) return { ok: false, existing };
  entries.push({ proposalHash, appliedAt: now, commitSha });
  writeLedgerAtomic(ledgerPath, entries);
  return { ok: true };
}
