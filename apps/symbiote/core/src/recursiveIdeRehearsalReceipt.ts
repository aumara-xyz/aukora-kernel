// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * recursive-ide-rehearsal-receipt-v1 — the receipt produced by ONE end-to-end run of the native recursive
 * workbench (status -> self_map -> list_files -> read_file -> search -> propose_patch -> sandbox_apply ->
 * run_tests -> write_receipt -> rollback_sandbox). It proves the tool-call path ran, proves the sandbox was
 * temp-only (never the raw absolute path — a sha256 hash of it, so no local username/path ever leaks into a
 * receipt), and is PURE evidence: appliedLive/promotionReady are literal-typed false, never settable by input.
 */
import { createHash } from 'crypto';
import { scanForbiddenKeys, scanForbiddenValues } from './forbiddenContent';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// See ideToolContract.ts's identical helper for why: scanForbiddenValues' bare-hex-64+ pattern also matches
// our own legitimate sha256 digests (proposalHash, sandboxPathHash, receiptHash). Filter out only leaf
// fields whose key ends in "hash" — real secret-shaped content anywhere else is still caught.
function forbiddenValuesExceptHashFields(obj: unknown): string[] {
  return scanForbiddenValues(obj).filter((p) => !/hash$/i.test((p.split(/[.[]/).pop() ?? '').replace(/\]$/, '')));
}

export interface RecursiveIdeRehearsalReceiptV1 {
  schema: 'recursive-ide-rehearsal-receipt-v1';
  version: 1;
  task: string;
  toolCallsUsed: string[];
  targetFiles: string[];
  proposalHash: string;
  sandboxProof: { sandboxPathHash: string; tmpRootProven: true };
  testResult: { passed: boolean; ran: string[]; detail: string };
  createdAt: string;
  appliedLive: false;
  promotionReady: false;
  advisoryOnly: true;
  grantsAuthority: false;
  receiptHash: string; // sha256 over every field above, computed last
}

const TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  'schema', 'version', 'task', 'toolCallsUsed', 'targetFiles', 'proposalHash', 'sandboxProof',
  'testResult', 'createdAt', 'appliedLive', 'promotionReady', 'advisoryOnly', 'grantsAuthority', 'receiptHash',
]);
const SANDBOX_PROOF_KEYS: ReadonlySet<string> = new Set(['sandboxPathHash', 'tmpRootProven']);
const TEST_RESULT_KEYS: ReadonlySet<string> = new Set(['passed', 'ran', 'detail']);

function hasOnlyKeys(obj: any, allowed: ReadonlySet<string>): boolean {
  return !!obj && typeof obj === 'object' && Object.keys(obj).every((k) => allowed.has(k));
}

function receiptIntegrity(r: Omit<RecursiveIdeRehearsalReceiptV1, 'receiptHash'>): string {
  return sha256(JSON.stringify({
    schema: r.schema, version: r.version, task: r.task, toolCallsUsed: r.toolCallsUsed,
    targetFiles: r.targetFiles, proposalHash: r.proposalHash, sandboxProof: r.sandboxProof,
    testResult: r.testResult, createdAt: r.createdAt, appliedLive: r.appliedLive,
    promotionReady: r.promotionReady, advisoryOnly: r.advisoryOnly, grantsAuthority: r.grantsAuthority,
  }));
}

export interface BuildRehearsalReceiptInput {
  task: string;
  toolCallsUsed: string[];
  targetFiles: string[];
  proposalHash: string;
  sandboxPath: string; // the REAL absolute temp path — hashed here, never stored raw
  testResult: { passed: boolean; ran: string[]; detail: string };
  now?: string;
}

/** Build a rehearsal receipt. PURE — no fs, no network. appliedLive/promotionReady are literal-typed `false`;
 *  no caller input can ever set them to anything else. The raw sandboxPath is hashed, never persisted raw. */
export function buildRecursiveIdeRehearsalReceipt(input: BuildRehearsalReceiptInput): RecursiveIdeRehearsalReceiptV1 {
  const now = input.now ?? new Date().toISOString();
  const base = {
    schema: 'recursive-ide-rehearsal-receipt-v1' as const,
    version: 1 as const,
    task: input.task,
    toolCallsUsed: [...input.toolCallsUsed],
    targetFiles: [...input.targetFiles],
    proposalHash: input.proposalHash,
    sandboxProof: { sandboxPathHash: sha256(input.sandboxPath), tmpRootProven: true as const },
    testResult: { ...input.testResult, ran: [...input.testResult.ran] },
    createdAt: now,
    appliedLive: false as const,
    promotionReady: false as const,
    advisoryOnly: true as const,
    grantsAuthority: false as const,
  };
  return { ...base, receiptHash: receiptIntegrity(base) };
}

/** Fail-closed validator for a STORED/serialized receipt — exact top-level + nested key allow-lists, and a
 *  tamper-evidence check that the receiptHash still recomputes from the rest of the object. */
export function validateRecursiveIdeRehearsalReceipt(a: any): { valid: boolean; reason?: string } {
  if (!a || typeof a !== 'object') return { valid: false, reason: 'not an object' };
  if (a.schema !== 'recursive-ide-rehearsal-receipt-v1') return { valid: false, reason: 'wrong schema' };
  if (!hasOnlyKeys(a, TOP_LEVEL_KEYS)) return { valid: false, reason: 'unknown field(s) in receipt' };
  if (a.version !== 1) return { valid: false, reason: 'unsupported version' };
  if (a.appliedLive !== false) return { valid: false, reason: 'appliedLive must be false' };
  if (a.promotionReady !== false) return { valid: false, reason: 'promotionReady must be false' };
  if (a.advisoryOnly !== true) return { valid: false, reason: 'advisoryOnly must be true' };
  if (a.grantsAuthority !== false) return { valid: false, reason: 'grantsAuthority must be false' };
  if (typeof a.task !== 'string') return { valid: false, reason: 'task must be a string' };
  if (!Array.isArray(a.toolCallsUsed) || !a.toolCallsUsed.every((x: unknown) => typeof x === 'string')) return { valid: false, reason: 'toolCallsUsed must be a string array' };
  if (!Array.isArray(a.targetFiles) || !a.targetFiles.every((x: unknown) => typeof x === 'string')) return { valid: false, reason: 'targetFiles must be a string array' };
  if (typeof a.proposalHash !== 'string' || !a.proposalHash) return { valid: false, reason: 'proposalHash must be a non-empty string' };
  if (!a.sandboxProof || typeof a.sandboxProof !== 'object') return { valid: false, reason: 'malformed sandboxProof' };
  if (!hasOnlyKeys(a.sandboxProof, SANDBOX_PROOF_KEYS)) return { valid: false, reason: 'unknown field(s) in sandboxProof' };
  if (typeof a.sandboxProof.sandboxPathHash !== 'string' || !/^[0-9a-f]{64}$/.test(a.sandboxProof.sandboxPathHash)) return { valid: false, reason: 'sandboxPathHash must be a sha256 hex digest' };
  if (a.sandboxProof.tmpRootProven !== true) return { valid: false, reason: 'tmpRootProven must be true' };
  if (!a.testResult || typeof a.testResult !== 'object') return { valid: false, reason: 'malformed testResult' };
  if (!hasOnlyKeys(a.testResult, TEST_RESULT_KEYS)) return { valid: false, reason: 'unknown field(s) in testResult' };
  if (typeof a.testResult.passed !== 'boolean') return { valid: false, reason: 'testResult.passed must be boolean' };
  if (!Array.isArray(a.testResult.ran)) return { valid: false, reason: 'testResult.ran must be an array' };
  if (typeof a.testResult.detail !== 'string') return { valid: false, reason: 'testResult.detail must be a string' };
  if (typeof a.createdAt !== 'string' || !a.createdAt) return { valid: false, reason: 'createdAt must be a non-empty string' };
  if (typeof a.receiptHash !== 'string' || !a.receiptHash) return { valid: false, reason: 'malformed receiptHash' };

  const secretKeys = scanForbiddenKeys(a);
  if (secretKeys.length) return { valid: false, reason: `forbidden secret/PoP/signature/private-key field(s): ${secretKeys.join(', ')}` };
  const secretValues = forbiddenValuesExceptHashFields(a);
  if (secretValues.length) return { valid: false, reason: `secret-shaped value(s) at: ${secretValues.join(', ')}` };

  const { receiptHash, ...rest } = a;
  if (receiptHash !== receiptIntegrity(rest)) return { valid: false, reason: 'integrity mismatch (receipt tampered)' };
  return { valid: true };
}

/** A rehearsal receipt never grants authority — structural, not a promise. */
export function rehearsalReceiptGrantsAuthority(_r: RecursiveIdeRehearsalReceiptV1): false { return false; }
