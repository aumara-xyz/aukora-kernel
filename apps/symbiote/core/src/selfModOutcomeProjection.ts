// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Self-mod outcome memory projection — the last memory half of issue #244 (Round 8).
 *
 * After the AUMLOK ceremony records a `signed_applied` proposal-disposition (append-only,
 * integrity-checked journal — core/src/proposalDispositionWrite.ts), this module PROJECTS that
 * already-validated closure into ONE bounded governed memory row (`self-mod-outcome-v1`) so Auma
 * can RECALL that her change was applied without the owner relaying it.
 *
 * Laws (each carried by core/tests/selfModOutcome.test.ts):
 *   - DOWNSTREAM EVIDENCE ONLY. The projection runs strictly AFTER a completed signed apply and is
 *     best-effort: a Convex refusal is returned loudly but can never reverse, block, repeat, or
 *     downgrade the apply. This module imports NOTHING from the signing/apply lane and is never
 *     imported by it (nativeLiveApply.ts is untouched — structural pin).
 *   - ONE WRITE PATH. The row travels through the EXISTING governed memoryAppend + capture-subject
 *     lease (same manifest/PoP machinery as shadow-capture). No second Convex write path, no signer.
 *   - BOUNDED METADATA ONLY: disposition, proposal hash, decidedAt, commit SHA, receipt hash, and
 *     the literal advisory stamps. No diff, no file contents, no prompts, no secrets — and the
 *     owner-private `ownerNote` NEVER travels (allow-list construction, pinned).
 *   - IDEMPOTENT: keyed deterministically by proposal hash; a success marker (written ONLY after a
 *     receipted write) makes every later drain skip it. A refused write leaves no marker, so the
 *     next drain retries honestly.
 *   - TAMPER-FAIL-CLOSED: rows come ONLY from readProposalDispositionRows (which refuses a tampered
 *     journal); a reader refusal projects nothing.
 *   - Every row: advisoryOnly:true, grantsAuthority:false. Memory never grants authority.
 */
import * as fs from 'fs';
import * as path from 'path';
import { readProposalDispositionRows } from './proposalDispositionRead';
import type { ProposalDispositionArtifactV1 } from './proposalDisposition';
import { memoryAppend, MEM_KEY_RE, type MemoryAppendRequest, type MemoryAppendDeps } from './memoryAppend';
import type { CaptureUseLease } from './conversationShadowCapture';
import { buildCoreReceiptStamp, type CoreReceiptStampV1 } from './coreMemoryEnvelope';

export const SELF_MOD_OUTCOME_SCHEMA = 'self-mod-outcome-v1' as const;

export interface SelfModOutcomeValue {
  schema: typeof SELF_MOD_OUTCOME_SCHEMA;
  proposalHash: string;
  disposition: 'signed_applied';
  decidedAt: string;
  commitSha?: string;
  receiptHash?: string;
  /** ADDITIVE core receipt stamp (one-core-memory round, #45/#244) — the SAME identification block
   *  turn-summary rows carry, so the self-mod surface provably writes into the same core instance
   *  and namespace as the chat/presence doors. Attached at drain time (only the drain knows the
   *  deployment); dropped — never failed over — when it cannot be built. */
  core?: CoreReceiptStampV1;
  advisoryOnly: true;
  grantsAuthority: false;
}

const HEX64_RE = /^[0-9a-f]{64}$/;
const COMMIT_RE = /^[0-9a-f]{7,64}$/;
const MAX_DRAIN_PER_RUN = 8; // bounded work per drain — never unbounded from one call

/** Deterministic governed-memory key for a proposal's outcome row: `selfmod.` + the first 56 hex
 *  chars of the proposal hash — exactly 64 chars, MEM_KEY_RE-safe, stable across drains. */
export function selfModOutcomeKey(proposalHash: string): string {
  return `selfmod.${proposalHash.slice(0, 56)}`;
}

/** Allow-list construction of the bounded memory value from an already-validated journal artifact.
 *  Refuses anything that is not a well-shaped signed_applied closure. ownerNote and artifactHash
 *  are deliberately NOT copied — owner-private text and journal bookkeeping stay in the journal. */
export function buildSelfModOutcomeValue(row: ProposalDispositionArtifactV1):
  | { ok: true; value: SelfModOutcomeValue }
  | { ok: false; refused: string } {
  if (!row || typeof row !== 'object') return { ok: false, refused: 'selfmod_outcome_row_invalid' };
  if (row.disposition !== 'signed_applied') return { ok: false, refused: 'selfmod_outcome_not_signed_applied' };
  if (typeof row.proposalHash !== 'string' || !HEX64_RE.test(row.proposalHash)) return { ok: false, refused: 'selfmod_outcome_hash_invalid' };
  if (typeof row.decidedAt !== 'string' || row.decidedAt.length === 0 || row.decidedAt.length > 40) return { ok: false, refused: 'selfmod_outcome_decidedat_invalid' };
  const commitSha = typeof row.commitSha === 'string' && COMMIT_RE.test(row.commitSha) ? row.commitSha : undefined;
  const receiptHash = typeof row.receiptHash === 'string' && /^[0-9a-f]{8,128}$/.test(row.receiptHash) ? row.receiptHash : undefined;
  return {
    ok: true,
    value: {
      schema: SELF_MOD_OUTCOME_SCHEMA,
      proposalHash: row.proposalHash,
      disposition: 'signed_applied',
      decidedAt: row.decidedAt,
      ...(commitSha ? { commitSha } : {}),
      ...(receiptHash ? { receiptHash } : {}),
      advisoryOnly: true,
      grantsAuthority: false,
    },
  };
}

/** Success markers live beside the other aumlok evidence dirs — one small file per projected
 *  proposal hash, written ONLY after a receipted governed write. */
export function selfModOutcomeMarkerDir(homeDir?: string): string {
  const home = homeDir ?? process.env.AUKORA_SYMBIOTE_HOME ?? path.join(process.env.HOME || '', '.aukora-symbiote');
  return path.join(home, 'aumlok', 'selfmod-outcome-projected');
}

function isProjected(dir: string, proposalHash: string): boolean {
  try { return fs.existsSync(path.join(dir, `${proposalHash}.json`)); } catch { return false; }
}

function markProjected(dir: string, proposalHash: string, info: { key: string; receiptHash: string; at: string }): void {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, `${proposalHash}.json`), JSON.stringify({ schema: 'selfmod-outcome-marker-v1', proposalHash, ...info, advisoryOnly: true, grantsAuthority: false }, null, 1), { mode: 0o600 });
  } catch { /* a failed marker only means one redundant (kernel-deduped-on-read) retry next drain */ }
}

/** The transport the drain writes through — the SAME capture-subject machinery shadow-capture uses
 *  (ensureCaptureWriter lease + governed HTTP invoke). Injected so tests are hermetic. */
export interface SelfModOutcomeTransport {
  ownerRootId: string;
  deploymentUrl: string;
  /** EXACTLY memoryAppend's injected invoke — the one registered governed mutation, nothing else. */
  invoke: MemoryAppendDeps['invoke'];
  nextUse: () => Promise<CaptureUseLease>;
  now?: () => number;
  /** OPTIONAL repo commit of the draining process (resolved by the edge). Stamp metadata only. */
  sourceCommit?: string;
}

export interface SelfModOutcomeDrainResult {
  ok: boolean;
  advisoryOnly: true;
  grantsAuthority: false;
  /** rows written this drain (receipted) */
  projected: Array<{ proposalHash: string; key: string; receiptHash: string }>;
  /** rows already projected on a prior drain */
  alreadyProjected: number;
  /** rows skipped because they are not signed_applied closures */
  notApplicable: number;
  /** loud, bounded refusals — a refusal never throws and never touches the apply */
  refused: Array<{ proposalHash: string; reason: string }>;
  /** set when the journal itself could not be trusted — nothing projects in that case */
  journalRefused: string | null;
}

/**
 * Drain: project every unprojected `signed_applied` disposition into one governed memory row each
 * (bounded per run). NEVER throws. A refusal is reported loudly in the result and retried on the
 * next drain — the already-completed applies are untouchable from here by construction.
 */
export async function projectSelfModOutcomes(
  transport: SelfModOutcomeTransport,
  opts: { homeDir?: string } = {},
): Promise<SelfModOutcomeDrainResult> {
  const base: SelfModOutcomeDrainResult = { ok: true, advisoryOnly: true, grantsAuthority: false, projected: [], alreadyProjected: 0, notApplicable: 0, refused: [], journalRefused: null };
  let rowsRead;
  try {
    rowsRead = readProposalDispositionRows(opts.homeDir, 100);
  } catch (e) {
    return { ...base, ok: false, journalRefused: `journal read threw: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (rowsRead.refusedReason) return { ...base, ok: false, journalRefused: rowsRead.refusedReason };

  const markerDir = selfModOutcomeMarkerDir(opts.homeDir);
  let budget = MAX_DRAIN_PER_RUN;
  for (const row of rowsRead.rows) {
    if (budget <= 0) break;
    if (row.disposition !== 'signed_applied') { base.notApplicable++; continue; }
    if (typeof row.proposalHash === 'string' && isProjected(markerDir, row.proposalHash)) { base.alreadyProjected++; continue; }
    const built = buildSelfModOutcomeValue(row);
    if (!built.ok) { base.refused.push({ proposalHash: String(row.proposalHash).slice(0, 64), reason: built.refused }); base.ok = false; continue; }
    budget--;

    const key = selfModOutcomeKey(built.value.proposalHash);
    if (!MEM_KEY_RE.test(key)) { base.refused.push({ proposalHash: built.value.proposalHash, reason: 'selfmod_outcome_key_invalid' }); base.ok = false; continue; }
    try {
      const lease = await transport.nextUse();
      const req: MemoryAppendRequest = {
        action: 'memory.write',
        ring: 'local-write',
        key,
        ownerRootId: transport.ownerRootId,
        resource: `mem:${transport.ownerRootId}`,
        v: 1,
        manifestId: lease.manifestId,
        subjectId: lease.subjectId,
        intentCodec: 'json_action_v1',
        useSeq: lease.useSeq,
        timestamp: (transport.now ?? Date.now)(),
      };
      const subjectSig = await lease.signConsume(req);
      // ONE CORE MEMORY (#45/#244): the same identification stamp the chat/presence doors carry —
      // built from the SAME (deploymentUrl, ownerRootId), so a reader can prove both surfaces
      // intended one core instance and one namespace. Null (unbuildable) stamps drop silently:
      // identification metadata never costs a projection.
      const stamp = buildCoreReceiptStamp({
        deploymentUrl: transport.deploymentUrl,
        ownerRootId: transport.ownerRootId,
        provenance: 'selfmod-outcome',
        at: built.value.decidedAt,
        ...(transport.sourceCommit !== undefined ? { sourceCommit: transport.sourceCommit } : {}),
      });
      const value: SelfModOutcomeValue = stamp ? { ...built.value, core: stamp } : built.value;
      const result = await memoryAppend(
        { req, subjectSig, value },
        { deploymentUrl: transport.deploymentUrl, invoke: transport.invoke },
      );
      if (result.ok) {
        try { lease.onSuccess?.(); } catch { /* lease bookkeeping never turns a success into a failure */ }
        markProjected(markerDir, built.value.proposalHash, { key, receiptHash: result.receiptHash, at: new Date().toISOString() });
        base.projected.push({ proposalHash: built.value.proposalHash, key, receiptHash: result.receiptHash });
      } else {
        base.refused.push({ proposalHash: built.value.proposalHash, reason: result.refused });
        base.ok = false;
      }
    } catch (e) {
      base.refused.push({ proposalHash: built.value.proposalHash, reason: `selfmod_outcome_transport_threw: ${e instanceof Error ? e.message : String(e)}` });
      base.ok = false;
    }
  }
  return base;
}
