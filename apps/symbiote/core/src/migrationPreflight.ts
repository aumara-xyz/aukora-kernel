// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Brick M4 prep — the migration PREFLIGHT: an INDEPENDENT verifier of the 77-atom JSON brain,
 * run before any atom ever moves to the Convex kernel.
 *
 * WHY INDEPENDENT: the plan's M4 clause ("content re-derivation — recompute each atom's inputHash
 * from its content per the kiraBrain formula AND re-verify receipt ids + prevHash links; ABORT
 * wholesale on any mismatch") exists because "verify then migrate" must not launder provenance a
 * buggy verifier would self-certify. So this module deliberately RE-IMPLEMENTS the kiraBrain
 * hash/chain formulas from their documented literals instead of importing them — a preflight that
 * calls the store's own verify can never catch that verify lying. kiraBrain.verifyBrainState IS
 * still run as a SECOND opinion; the two implementations must agree or the preflight aborts
 * (divergence between them is itself a finding).
 *
 * WHAT THIS IS NOT (hard rule, stated structurally): there is NO write half here. This module has
 * zero transport imports, zero Convex imports, and returns a PLAN — it cannot write anywhere. The
 * executor that consumes the plan is a separate M4 brick and stays unbuilt until M2b (owner-ratified
 * erasure) is green, per Codex's stop-condition: memories only move onto a floor that can both
 * catch corruption (M2a, landed) and truly forget (M2b, awaiting the owner's pen).
 *
 * ERASED ATOMS: excluded from the content plan and COUNTED. Whether an erased atom becomes a
 * countable stub row on Convex (Auma's condition: "erasure leaves a countable stub, never an
 * invisible hole") is an M2b-contract decision — the preflight reports the count so the decision
 * is made with the real number in hand, never silently.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import {
  KiraBrainState,
  KiraReceipt,
  MemoryAtom,
  verifyBrainState,
} from './kiraBrain';
import { canonicalMemoryValue, MEM_KEY_RE } from './memoryAppend';

const GENESIS = 'genesis'; // kiraBrain.ts literal, duplicated on purpose (see header)

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// kiraBrain.ts ingest literal, duplicated on purpose: inputHash binds EXACTLY these fields in
// EXACTLY this key order. If kiraBrain ever drifts from this, the second-opinion cross-check
// below turns red — which is the alarm working, not a nuisance.
function independentAtomContentHash(atom: MemoryAtom): string {
  return sha256(JSON.stringify({ kind: atom.kind, text: atom.text, source: atom.source, scope: atom.scope, tags: atom.tags, links: atom.links }));
}

// kiraBrain.ts makeReceiptId literal, duplicated on purpose.
function independentReceiptId(r: KiraReceipt): string {
  return sha256(JSON.stringify([r.sequence, r.previousHash, r.atomId, r.inputHash, r.createdAt, r.kind, r.source, r.scope]));
}

/** The pinned migration value shape (V1). The M4 executor MUST produce these exact bytes for each
 *  atom — the preflight publishes their hashes so any drift between "what was planned" and "what
 *  was written" is provable later from the plan alone. Carries the full original atom + its ingest
 *  receipt (provenance-honest: the Convex row can always be re-verified against the JSON source). */
export function migrationValueV1(atom: MemoryAtom, ingestReceipt: KiraReceipt): string {
  return canonicalMemoryValue({
    schema: 'AUKORA_KIRA_ATOM_MIGRATION_V1',
    atom: {
      id: atom.id, kind: atom.kind, source: atom.source, scope: atom.scope,
      text: atom.text, supportQuote: atom.supportQuote,
      tags: atom.tags, tokens: atom.tokens, trigrams: atom.trigrams, links: atom.links,
      receiptId: atom.receiptId, createdAt: atom.createdAt,
    },
    ingestReceipt: {
      id: ingestReceipt.id, sequence: ingestReceipt.sequence, previousHash: ingestReceipt.previousHash,
      atomId: ingestReceipt.atomId, inputHash: ingestReceipt.inputHash, createdAt: ingestReceipt.createdAt,
      kind: ingestReceipt.kind, source: ingestReceipt.source, scope: ingestReceipt.scope,
    },
  });
}

export interface MigrationPlanEntry {
  /** Convex memory key = the atom's own id (unique by construction; uniqueness still ASSERTED). */
  key: string;
  kind: string;
  inputHash: string;
  /** sha256 of the exact V1 value bytes the executor must send. */
  valueSha256: string;
  /** What the kernel will compute+bind as memoryHash for this row: sha256(`${owner}:${key}:${value}`). */
  plannedMemoryHash: string;
  valueBytes: number;
}

export interface MigrationPreflightReport {
  ok: boolean;
  /** Wholesale: ANY error means NOTHING migrates. */
  errors: string[];
  ownerRootId: string;
  liveAtoms: number;
  erasedExcluded: number;
  receiptCount: number;
  entries: MigrationPlanEntry[];
  /** kiraBrain's own verify, run as a second opinion — must agree with the independent checks. */
  secondOpinion: { ok: boolean; quarantinedCount: number; erasedCount: number; errorCount: number };
}

/** Run every preflight check over an in-memory brain state. Pure: no clock, no fs, no network. */
export function migrationPreflight(state: KiraBrainState, ownerRootId: string): MigrationPreflightReport {
  const errors: string[] = [];
  const entries: MigrationPlanEntry[] = [];

  if (typeof ownerRootId !== 'string' || !MEM_KEY_RE.test(ownerRootId)) {
    errors.push(`owner_root_id_invalid:${String(ownerRootId).slice(0, 64)}`);
  }

  // ── independent structural walk (own literals, no kiraBrain internals) ──
  const receipts = Array.isArray(state?.receipts) ? state.receipts : null;
  const atoms = Array.isArray(state?.atoms) ? state.atoms : null;
  if (!receipts || !atoms || state.schema !== 'AUKORA_KIRA_BRAIN_V1') {
    return {
      ok: false, errors: ['brain_shape_invalid'], ownerRootId, liveAtoms: 0, erasedExcluded: 0,
      receiptCount: 0, entries: [], secondOpinion: { ok: false, quarantinedCount: 0, erasedCount: 0, errorCount: 0 },
    };
  }
  const receiptById = new Map(receipts.map((r) => [r.id, r]));
  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i];
    if (r.sequence !== i) errors.push(`receipt_${i}_sequence_mismatch`);
    const expectedPrev = i === 0 ? GENESIS : receipts[i - 1].id;
    if (r.previousHash !== expectedPrev) errors.push(`receipt_${i}_prevhash_broken`);
    if (independentReceiptId(r) !== r.id) errors.push(`receipt_${i}_id_mismatch`);
  }

  // ── per-atom re-derivation + plan construction ──
  let erasedExcluded = 0;
  const seenKeys = new Set<string>();
  for (const atom of atoms) {
    if (atom.quarantined) {
      // a brain that carries jailed atoms is NOT a migration source — surgery first, then migrate.
      errors.push(`atom_quarantined:${atom.id}`);
      continue;
    }
    if (atom.erased) { erasedExcluded++; continue; } // counted, excluded; stub semantics ride with M2b
    const ingest = receiptById.get(atom.receiptId);
    if (!ingest) { errors.push(`atom_missing_receipt:${atom.id}`); continue; }
    if (ingest.atomId !== atom.id) { errors.push(`atom_receipt_atomid_mismatch:${atom.id}`); continue; }
    if (independentAtomContentHash(atom) !== ingest.inputHash) {
      errors.push(`atom_content_rederivation_failed:${atom.id}`);
      continue;
    }
    if (!MEM_KEY_RE.test(atom.id)) { errors.push(`atom_key_grammar_invalid:${atom.id.slice(0, 64)}`); continue; }
    if (seenKeys.has(atom.id)) { errors.push(`atom_key_duplicate:${atom.id}`); continue; }
    seenKeys.add(atom.id);
    let value: string;
    try {
      value = migrationValueV1(atom, ingest);
    } catch {
      errors.push(`atom_value_uncanonical:${atom.id}`);
      continue;
    }
    entries.push({
      key: atom.id,
      kind: atom.kind,
      inputHash: ingest.inputHash,
      valueSha256: sha256(value),
      plannedMemoryHash: sha256(`${ownerRootId}:${atom.id}:${value}`),
      valueBytes: Buffer.byteLength(value, 'utf8'),
    });
  }

  // ── second opinion: the store's own verifier must agree (divergence = abort + finding) ──
  const second = verifyBrainState(state);
  if (!second.ok) errors.push(`second_opinion_red:${second.errors.slice(0, 3).join('|')}`);
  if (second.quarantinedCount > 0 && !errors.some((e) => e.startsWith('atom_quarantined:'))) {
    errors.push('second_opinion_saw_quarantine_we_missed'); // the alarm about the alarms
  }

  return {
    ok: errors.length === 0,
    errors,
    ownerRootId,
    liveAtoms: entries.length,
    erasedExcluded,
    receiptCount: receipts.length,
    entries,
    secondOpinion: {
      ok: second.ok,
      quarantinedCount: second.quarantinedCount,
      erasedCount: second.erasedCount,
      errorCount: second.errors.length,
    },
  };
}

/** File-loading wrapper for the CLI. Raw JSON.parse — deliberately NOT loadBrainState, whose
 *  quarantine-at-load containment is right for a living organ and WRONG for a migration source
 *  (a source that needs containment must abort, not self-medicate and proceed). */
export function migrationPreflightFromFile(filePath: string, ownerRootId: string): MigrationPreflightReport {
  const raw = fs.readFileSync(filePath, 'utf8'); // missing file throws loud — no empty-brain default here
  return migrationPreflight(JSON.parse(raw) as KiraBrainState, ownerRootId);
}
