// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * AURA EVIDENCE DIAGNOSTIC — owner-run, read-only, loopback-only (AURA lane round 3).
 *
 *   bun scripts/auraEvidenceCli.ts
 *
 * Gathers the node's CONTENT-FREE local key knowledge (canon ledger, focus pointer, capture
 * status), assembles the live evidence set through core/src/auraEvidenceReader (twice-checked
 * snapshot, deterministic order), and prints ONLY: class counts, refusal categories, the
 * one-way evidence commitments, and the would-be epoch commitment + glyph seed. It NEVER
 * prints chain keys, row keys, or head hashes; it PERSISTS NOTHING (no epoch is written); it
 * fetches NO drand. The store verifier and head reads reuse the kernel's own surfaces
 * (aumlokMemoryVerify; getReceiptChainHeadPublic through parseReceiptHead's fail-closed
 * contract), admin-authed under the same custody law as every owner ceremony.
 */
import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { readLiveEvidence, type KnownKey } from '../core/src/auraEvidenceReader';
import { buildAuraTraceEpoch, commitEvidence } from '../core/src/auraTrace';
import { readFocusPointerSafe } from '../core/src/focusRegister';
import { readAdminKeyStrict, DEFAULT_BRAIN_URL } from '../core/src/memoryKernelTransport';
import { isLoopbackUrl, parseReceiptHead, unwrapConvexEnvelope } from '../core/src/convexBrainReadonly';
import { readCaptureStatusSafe } from '../spatial/shadowCapture';

const OWNER_ROOT_ID = 'aumara.root';
const URL = process.env.AUKORA_CONVEX_URL ?? DEFAULT_BRAIN_URL;
const HOME = process.env.AUKORA_SYMBIOTE_HOME ?? path.join(homedir(), '.aukora-symbiote');

/** Admin-authed read of ONE allowlisted query — the owner-ceremony read pattern (cliStatus /
 *  cliRecall precedent), with the response validated by the EXISTING fail-closed contracts. */
const READ_QUERIES = new Set(['aumlokMemory:aumlokMemoryVerify', 'aukoraReceipts:getReceiptChainHeadPublic']);
async function adminRead(adminKey: string, queryName: string, args: Record<string, unknown>): Promise<unknown> {
  if (!READ_QUERIES.has(queryName)) throw new Error(`query_not_in_reader_allowlist: ${queryName}`);
  const res = await fetch(`${URL}/api/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Convex ${adminKey}` },
    body: JSON.stringify({ path: queryName, args, format: 'json' }),
    signal: AbortSignal.timeout(15_000),
  });
  const env = unwrapConvexEnvelope(await res.json());
  if (!env.ok) throw new Error(env.errorMessage ?? 'kernel error');
  return env.value;
}

/** The node's content-free key knowledge — identifiers only, gathered from the three classes. */
function gatherKnownKeys(): KnownKey[] {
  const keys: KnownKey[] = [];
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(HOME, 'convex', 'canon-ledger.json'), 'utf-8')) as Record<string, unknown>;
    for (const v of Object.values(raw)) {
      if (Array.isArray(v)) for (const k of v) if (typeof k === 'string') keys.push({ source: 'canon-ledger', key: k });
    }
  } catch { /* no canon shelf on this node — honest absence, counted as zero */ }
  const focus = readFocusPointerSafe();
  if (focus) keys.push({ source: 'focus-pointer', key: focus.key });
  const capture = readCaptureStatusSafe();
  if (capture?.lastKey) keys.push({ source: 'capture-status', key: capture.lastKey });
  return keys;
}

async function main(): Promise<void> {
  if (!isLoopbackUrl(URL)) { console.error('refused: non-loopback backend URL (local-only by law)'); process.exit(1); }
  const adminKey = readAdminKeyStrict(); // custody-gated; loud typed refusal on violation

  const knownKeys = gatherKnownKeys();
  const result = await readLiveEvidence(knownKeys, {
    ownerRootId: OWNER_ROOT_ID,
    verifyStore: async () => {
      const v = (await adminRead(adminKey, 'aumlokMemory:aumlokMemoryVerify', { ownerRootId: OWNER_ROOT_ID })) as { ok?: boolean; flagged?: unknown[]; checked?: number };
      return { ok: v?.ok === true, flagged: Array.isArray(v?.flagged) ? v.flagged.length : 1, checked: Number(v?.checked ?? -1) };
    },
    readHead: async (chainKey) => {
      const data = (await adminRead(adminKey, 'aukoraReceipts:getReceiptChainHeadPublic', { chainKey })) as Record<string, unknown> | null;
      const head = parseReceiptHead(data); // the existing fail-closed contract — junk is never a head
      return head ? { exists: head.exists, count: head.count, lastChainHash: head.lastChainHash } : null;
    },
  });

  if (!result.ok) {
    console.error(`refused: ${result.refusal}`); // category only — never a key or hash
    process.exit(1);
  }

  console.log('AURA EVIDENCE — live, read-only, twice-checked snapshot');
  console.log(`  classes: canon-ledger ${result.classCounts['canon-ledger']} · focus-pointer ${result.classCounts['focus-pointer']} · capture-status ${result.classCounts['capture-status']}`);
  console.log(`  store rows verified green: ${result.storeChecked} (technical count, not AURA)`);
  console.log(`  excluded (the honest gap): ${result.excluded.join(' · ')}`);
  console.log('  evidence commitments (one-way):');
  for (const e of result.evidence) console.log(`    ${commitEvidence(e)}`);
  // the would-be epoch — computed, shown, NEVER persisted; no drand this round by instruction
  const epoch = buildAuraTraceEpoch({ epochOf: OWNER_ROOT_ID, at: new Date().toISOString(), evidence: result.evidence, drand: null, prevEpochCommitment: null });
  console.log(`  epoch commitment (not persisted): ${epoch.epochCommitment}`);
  console.log(`  glyph seed (not wired): ${epoch.glyphSeed}`);
  console.log('DONE — nothing written, nothing fetched beyond the loopback brain.');
}

main().catch((e) => { console.error(`refused: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
