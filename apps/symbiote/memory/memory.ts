// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * 24Z.70 P1 — GOVERNED PERSISTENT MEMORY for the Aukora IDE model (Auma). Mirrors the PROVEN Receipted Memory Core
 * (`AUMA-ONE-APP/convex/auma/memory/organism.ts` §1-5) on the IDE's own rail (no Convex mounted yet — that is Step 4):
 *
 *   • RECEIPT-COUPLED + HASH-CHAINED — every durable write advances a per-chainKey hash chain (chain.ts; actor recorded per entry) and
 *     emits a receipt. verifyChain catches in-place/partial edits AND store-only forgery (cross-checked vs the independent
 *     receipts log). HONEST LIMIT: it is NOT a signature — a raw-FS attacker who rewrites BOTH files consistently is only
 *     defeated by the SIGNED head (Ed25519, kernel signing layer, Step 4) + FS-level store protection. Same FS-completeness line
 *     as the gate. The store itself is in the gate's SENSITIVE denylist (a GOVERNED edit to it is refused).
 *   • AUTHORITY-GATED — a write routes through the SAME gate as every tool (`aukoraGovernAsk`): AUMLOK locked → PAUSE
 *     (no write); apparent secret in the content → DENY (no write). Memory is never stored ungoverned.
 *   • RTBF-CLEAN — `forget` tombstones the row and ERASES the plaintext, but KEEPS the row + its hash link and appends a
 *     forget receipt, so the chain stays provable (the hash covers contentHash, not plaintext) and the erasure is audited.
 *   • ADVISORY / NO-AUTHORITY — `recall` is READ-ONLY context the model may consult to inform a proposal; memory can
 *     NEVER authorize an effect. Only the gate + AUMLOK authorize. Baby-seed ceiling: episodic facts do not auto-promote
 *     to belief (that is an operator-gated step, not done here).
 *
 * This file carries NO dependency on the private kernel; it reuses only the IDE gate. Cross-thread persistence = the
 * store is a file outside any session's context window, so a brand-new session reads what a prior session wrote.
 */
import { readFileSync, mkdirSync, existsSync, openSync, writeSync, fsyncSync, closeSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { sha256Hex, buildReceiptChainHash } from './chain';
import { aukoraGovernAsk } from '../authority/gate/opencodeAskBridge';
import type { GateEffect, GateReceipt } from '../authority/gate/types';

// Fixed 2026-07-02 (issue #24, same defect as opencodeAskBridge.ts's identical fix): ~/.aukora is a
// directory name shared across the whole Aukora family of repos — aligned to this repo's own
// ${AUKORA_SYMBIOTE_HOME:-$HOME/.aukora-symbiote} convention instead. Per-file env var overrides unchanged.
const SYMBIOTE_HOME = process.env.AUKORA_SYMBIOTE_HOME || join(homedir(), '.aukora-symbiote');
export const MEMORY_FILE = process.env.AUKORA_IDE_MEMORY_FILE || join(SYMBIOTE_HOME, 'aukora-ide-memory.jsonl');
const RECEIPT_FILE = process.env.AUKORA_IDE_RECEIPTS_FILE || join(SYMBIOTE_HOME, 'aukora-ide-receipts.jsonl');
const DEFAULT_CHAIN = 'auma-ide';

export type MemoryTier = 'episodic' | 'fact' | 'tombstone';
export interface MemoryPayload {
  v: 0;
  actor: string;
  chainKey: string;
  seq: number;
  operation: 'remember' | 'forget';
  tier: MemoryTier;
  contentHash: string;
  createdAt: string;
  covers?: string; // forget events: the hash of the entry being tombstoned
}
export interface MemoryEntry {
  payload: MemoryPayload;
  hash: string;
  prevHash: string | null;
  content: string | null;        // plaintext; null after RTBF erasure (or for a forget marker)
  status: 'active' | 'tombstoned';
  forgottenAt?: string;
}
export interface MemoryReceipt {
  kind: 'aukora_memory_v0' | 'aukora_memory_forget_v0';
  operation: 'remember' | 'forget';
  actor: string;
  chainKey: string;
  seq: number;
  hash: string;
  prevHash: string | null;
  contentHash: string;           // hash of the plaintext — the plaintext itself is NEVER written to a receipt
  tier: MemoryTier;
  covers?: string;
  gateArgsHash: string;          // links to the gate authority decision
  ts: string;
}

function nowIso(): string { try { return new Date().toISOString(); } catch { return '—'; } }

/** Load the store. FAIL-CLOSED (24Z.70b): a non-existent file is genesis ([]); a file that exists but has a CORRUPT line
 *  THROWS — corruption must never be swallowed into an empty "clean" store (that would read ok-empty). Callers fail-closed. */
export function loadEntries(file: string = MEMORY_FILE): MemoryEntry[] {
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean); // readFileSync IO error propagates (fail-closed)
  return lines.map((l, i) => { try { return JSON.parse(l) as MemoryEntry; } catch { throw new Error(`memory store corrupt at line ${i + 1}`); } });
}
/** Durable write: write + fsync so the bytes hit disk before we return (no half-committed store). Throws on failure. */
function writeEntries(entries: MemoryEntry[], file: string = MEMORY_FILE): void {
  mkdirSync(dirname(file), { recursive: true });
  const body = entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : '');
  const fd = openSync(file, 'w');
  try { writeSync(fd, body); fsyncSync(fd); } finally { closeSync(fd); }
}
/** Durable receipt append. FAIL-CLOSED (24Z.70b): THROWS on any failure — it is NEVER best-effort, because a row that
 *  persists without its receipt breaks "every write receipt-coupled" (Codex P0). Callers must append the receipt BEFORE
 *  the row and abort the write if this throws. fsync so the receipt is durable before the row is written. */
function appendReceiptDurable(r: MemoryReceipt): void {
  mkdirSync(dirname(RECEIPT_FILE), { recursive: true });
  const fd = openSync(RECEIPT_FILE, 'a');
  try { writeSync(fd, JSON.stringify(r) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
}
// Chain identity is PER-CHAINKEY (24Z.70b honesty fix): all writes to a chainKey form ONE seq-ordered timeline; the actor
// is recorded per entry for attribution (NOT a separate per-actor chain — that is a future option, not what this keys by).
function headFor(entries: MemoryEntry[], chainKey: string): { prevHash: string | null; nextSeq: number } {
  const chain = entries.filter((e) => e.payload.chainKey === chainKey).sort((a, b) => a.payload.seq - b.payload.seq);
  if (!chain.length) return { prevHash: null, nextSeq: 0 };
  const last = chain[chain.length - 1];
  return { prevHash: last.hash, nextSeq: last.payload.seq + 1 };
}

export interface WriteResult { ok: boolean; effect: GateEffect; reason: string; entry?: MemoryEntry; receipt: GateReceipt }

/** Durably remember a fact. Authority-gated (AUMLOK + secret-classifier) → hash-chained → receipted. */
export function remember(input: { content: string; actor?: string; chainKey?: string; tier?: MemoryTier }): WriteResult {
  const actor = input.actor || 'auma';
  const chainKey = input.chainKey || DEFAULT_CHAIN;
  const tier: MemoryTier = input.tier || 'episodic';
  // 1) AUTHORITY — route through the SAME gate as every tool: AUMLOK + secret-classifier decide. The content rides as the
  // added diff so the classifier scans it for secrets; a secret in a fact → DENY (we never durably store secrets).
  const decision = aukoraGovernAsk({ permission: 'memory', metadata: { diff: input.content } });
  if (decision.effect !== 'allow') return { ok: false, effect: decision.effect, reason: decision.reason, receipt: decision.receipt };
  // 2) Build the hash-chained entry (hash covers contentHash, NOT plaintext). A corrupt store THROWS → fail-closed below.
  try {
    const entries = loadEntries();
    const { prevHash, nextSeq } = headFor(entries, chainKey);
    const contentHash = sha256Hex(input.content);
    const payload: MemoryPayload = { v: 0, actor, chainKey, seq: nextSeq, operation: 'remember', tier, contentHash, createdAt: nowIso() };
    const hash = buildReceiptChainHash(payload as unknown as Record<string, unknown>, prevHash);
    const entry: MemoryEntry = { payload, hash, prevHash, content: input.content, status: 'active' };
    // 3) FAIL-CLOSED ORDER (Codex P0 fix): durably append the RECEIPT FIRST (no plaintext — contentHash only). If this
    // throws, NO row is written → "every write receipt-coupled" cannot be violated (no orphan row).
    appendReceiptDurable({ kind: 'aukora_memory_v0', operation: 'remember', actor, chainKey, seq: nextSeq, hash, prevHash, contentHash, tier, gateArgsHash: decision.receipt.argsHash, ts: payload.createdAt });
    // 4) Only now persist the row. (A failure here leaves a receipt with no row — recall won't show it, verifyChain is
    // unaffected — the BENIGN direction; the dangerous orphan-row-without-receipt is impossible.)
    entries.push(entry);
    writeEntries(entries);
    return { ok: true, effect: 'allow', reason: 'remembered (governed, receipted)', entry, receipt: decision.receipt };
  } catch (e) {
    return { ok: false, effect: 'pause', reason: `memory write refused (fail-closed): ${e instanceof Error ? e.message : String(e)}`, receipt: decision.receipt };
  }
}

export interface RecallResult { advisory: true; banner: string; chainKey: string; count: number; corrupt: boolean; facts: Array<{ seq: number; hash: string; tier: MemoryTier; content: string; createdAt: string }> }

/** READ-ONLY advisory recall. Memory NAVIGATES — it does NOT authorize. No gate call (no authority is exercised).
 *  FAIL-CLOSED (24Z.70b): a corrupt store does NOT silently read as empty — it is surfaced (corrupt:true, zero facts). */
export function recall(input?: { chainKey?: string; limit?: number }): RecallResult {
  const chainKey = input?.chainKey || DEFAULT_CHAIN;
  const banner = 'ADVISORY — memory NAVIGATES, it does NOT AUTHORIZE. Only the gate + AUMLOK authorize effects.';
  let entries: MemoryEntry[];
  try { entries = loadEntries(); }
  catch { return { advisory: true, banner: banner + ' [STORE CORRUPT — recall withheld]', chainKey, count: 0, corrupt: true, facts: [] }; }
  const facts = entries
    .filter((e) => e.payload.chainKey === chainKey && e.status === 'active' && e.payload.operation === 'remember' && e.content != null)
    .sort((a, b) => a.payload.seq - b.payload.seq)
    .slice(input?.limit ? -input.limit : 0)
    .map((e) => ({ seq: e.payload.seq, hash: e.hash, tier: e.payload.tier, content: e.content as string, createdAt: e.payload.createdAt }));
  return { advisory: true, banner, chainKey, count: facts.length, corrupt: false, facts };
}

export interface ForgetResult { ok: boolean; effect: GateEffect; reason: string; covers?: string; tombstoneHash?: string; receipt: GateReceipt }

/** RTBF erasure. Authority-gated → tombstone the row + ERASE plaintext (keep the hash link) → append a forget receipt. */
export function forget(input: { hash?: string; contentHash?: string; actor?: string; chainKey?: string }): ForgetResult {
  const actor = input.actor || 'auma';
  const chainKey = input.chainKey || DEFAULT_CHAIN;
  const sel = input.hash || input.contentHash || '';
  const decision = aukoraGovernAsk({ permission: 'memory', metadata: { command: `forget ${sel}` } });
  if (decision.effect !== 'allow') return { ok: false, effect: decision.effect, reason: decision.reason, receipt: decision.receipt };
  try {
    const entries = loadEntries(); // corrupt store THROWS → fail-closed below (never erase atop a corrupt store)
    const target = entries.find((e) => e.payload.chainKey === chainKey && e.status === 'active' && e.payload.operation === 'remember'
      && (input.hash ? e.hash === input.hash : e.payload.contentHash === input.contentHash));
    if (!target) return { ok: false, effect: 'allow', reason: 'no active fact matched (already forgotten or unknown)', receipt: decision.receipt };
    const { prevHash, nextSeq } = headFor(entries, chainKey);
    const payload: MemoryPayload = { v: 0, actor, chainKey, seq: nextSeq, operation: 'forget', tier: 'tombstone', contentHash: target.payload.contentHash, createdAt: nowIso(), covers: target.hash };
    const tombHash = buildReceiptChainHash(payload as unknown as Record<string, unknown>, prevHash);
    // FAIL-CLOSED ORDER: durably append the forget RECEIPT FIRST; if it throws, nothing is erased and nothing is claimed.
    appendReceiptDurable({ kind: 'aukora_memory_forget_v0', operation: 'forget', actor, chainKey, seq: nextSeq, hash: tombHash, prevHash, contentHash: target.payload.contentHash, tier: 'tombstone', covers: target.hash, gateArgsHash: decision.receipt.argsHash, ts: payload.createdAt });
    // Then ERASE plaintext + tombstone the row (KEEP hash/seq/prevHash so the chain stays provable) and append the event.
    target.content = null;
    target.status = 'tombstoned';
    target.forgottenAt = nowIso();
    entries.push({ payload, hash: tombHash, prevHash, content: null, status: 'active' });
    writeEntries(entries);
    return { ok: true, effect: 'allow', reason: 'forgotten (plaintext erased, tombstone + chain kept)', covers: target.hash, tombstoneHash: tombHash, receipt: decision.receipt };
  } catch (e) {
    return { ok: false, effect: 'pause', reason: `forget refused (fail-closed): ${e instanceof Error ? e.message : String(e)}`, receipt: decision.receipt };
  }
}

export interface VerifyResult { ok: boolean; length: number; brokenAt?: number; reason?: string; receiptsBacked: boolean }

function memoryReceiptIndex(): Map<string, { seq: number; prevHash: string | null; contentHash: string }> {
  const idx = new Map<string, { seq: number; prevHash: string | null; contentHash: string }>();
  let raw: string;
  try { raw = readFileSync(RECEIPT_FILE, 'utf-8'); }
  catch { return idx; } // missing receipts file = OK (empty index)
  // FAIL-CLOSED (24Z.71 deep-check): a corrupt line must NOT be swallowed into a partial index — that lets corruption
  // trailing valid receipts read as ok. Missing file = empty (above); corrupt line = THROW (verifyChain catches → ok:false).
  for (const l of raw.split('\n').filter(Boolean)) {
    let r: { kind?: string; hash?: string; seq?: number; prevHash?: string | null; contentHash?: string };
    try { r = JSON.parse(l); }
    catch { throw new Error(`receipt log corrupt: ${l.slice(0, 50)}`); }
    if (r.kind === 'aukora_memory_v0' || r.kind === 'aukora_memory_forget_v0') idx.set(r.hash!, { seq: r.seq!, prevHash: r.prevHash ?? null, contentHash: r.contentHash! });
  }
  return idx;
}

/**
 * Verify the chain. HONEST SCOPE: this proves INTERNAL CONSISTENCY (each hash recomputes from its payload+prevHash, the
 * links are intact) AND RECEIPT-BACKING (each store entry's hash is present in the INDEPENDENT append-only receipts log
 * with matching seq/prevHash/contentHash) — so a STORE-ONLY rewrite is caught (the attacker would have to forge two files).
 * It is NOT a signature: a determined raw-FS attacker who rewrites BOTH the store and the receipts log consistently is only
 * defeated by the SIGNED chain head (Ed25519, the kernel signing layer mounted in Step 4) + FS-level store protection.
 * Erasing plaintext on forget does NOT break verification (the hash covers contentHash, not plaintext).
 */
export function verifyChain(input?: { chainKey?: string }): VerifyResult {
  const chainKey = input?.chainKey || DEFAULT_CHAIN;
  let chain: MemoryEntry[];
  try { chain = loadEntries().filter((e) => e.payload.chainKey === chainKey).sort((a, b) => a.payload.seq - b.payload.seq); }
  catch (e) { return { ok: false, length: 0, reason: `store corrupt: ${e instanceof Error ? e.message : String(e)}`, receiptsBacked: false }; } // fail-closed
  let receipts: ReturnType<typeof memoryReceiptIndex>;
  try { receipts = memoryReceiptIndex(); }
  catch (e) { return { ok: false, length: chain.length, reason: `receipt log corrupt: ${e instanceof Error ? e.message : String(e)}`, receiptsBacked: false }; } // fail-closed
  const haveReceipts = receipts.size > 0;
  // FAIL-CLOSED (24Z.70b): entries exist but the receipts log is missing/empty → UNVERIFIABLE, not ok (verifyChain depends on it).
  if (chain.length > 0 && !haveReceipts) return { ok: false, length: chain.length, reason: 'entries present but receipts log missing/empty — unverifiable', receiptsBacked: false };
  let prev: string | null = null;
  for (let i = 0; i < chain.length; i++) {
    const e = chain[i];
    const recomputed = buildReceiptChainHash(e.payload as unknown as Record<string, unknown>, e.prevHash);
    if (recomputed !== e.hash) return { ok: false, length: chain.length, brokenAt: i, reason: `hash mismatch at seq ${e.payload.seq}`, receiptsBacked: haveReceipts };
    if (e.prevHash !== prev) return { ok: false, length: chain.length, brokenAt: i, reason: `broken link at seq ${e.payload.seq}`, receiptsBacked: haveReceipts };
    if (haveReceipts) { // cross-check against the independent receipts log — a store-only forge has no backing receipt
      const r = receipts.get(e.hash);
      if (!r || r.seq !== e.payload.seq || r.prevHash !== e.prevHash || r.contentHash !== e.payload.contentHash)
        return { ok: false, length: chain.length, brokenAt: i, reason: `no matching receipt for seq ${e.payload.seq} (store-only forge?)`, receiptsBacked: true };
    }
    prev = e.hash;
  }
  return { ok: true, length: chain.length, receiptsBacked: haveReceipts };
}
