// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * CANON INGEST CEREMONY (#62) — owner-run, never called by any lane or door.
 *
 *   bun scripts/canonIngestCli.ts plan                      # dry: chunk + diff, write nothing
 *   bun scripts/canonIngestCli.ts ingest [--erase-superseded]
 *   bun scripts/canonIngestCli.ts ingest --docs docs/A.md docs/B.md
 *
 * Curated LOW-PII default set (issue #62's "curated docs first" call). The identity corpus
 * (~/.aukora-symbiote/identity/) is DELIBERATELY not ingestable here — #62 marks it a separate
 * owner decision (it already reaches her via the anchor injection). The path boundary is
 * enforced: only repo docs/*.md and README.md are accepted.
 *
 * Loud on every outcome. Resumable by construction (content-hashed keys: present = skip).
 * Superseded chunks (a doc changed) are NAMED; with --erase-superseded each gets the standard
 * owner-signed receipted erase — append-only store, visible tombstones, no silent replacement.
 */
import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { chunkCanonDoc, planCanonIngest, ingestCanonChunks, type CanonChunk, type CanonLedger } from '../core/src/canonIngest';
import { createGovernedHttpInvoke, readAdminKeyStrict, DEFAULT_BRAIN_URL } from '../core/src/memoryKernelTransport';
import { readOwnerSeedStrict } from '../core/src/memoryRecall';
import { isLoopbackUrl } from '../core/src/convexBrainReadonly';
import { createHash } from 'crypto';

const URL = process.env.AUKORA_CONVEX_URL ?? DEFAULT_BRAIN_URL;
const REPO = path.resolve(__dirname, '..');

/** The curated shelf (#62: low-PII canon that gives recall real targets). Extend via --docs. */
export const DEFAULT_CANON_DOCS = [
  'docs/SAFETY_LAWS.md',
  'docs/ARCHITECTURE.md',
  'docs/COHESION_INVARIANTS.md',
  'docs/ROUND_PROTOCOL.md',
  'docs/R5_RECALL_STATUS.md',
  'docs/ORGANISM_FABRIC.md',
  'docs/UNIFIED_IDENTITY_STACK.md',
  'docs/PROPOSER_CONTRACT.md',
  'README.md',
];

const LEDGER_PATH = path.join(process.env.AUKORA_SYMBIOTE_HOME ?? path.join(homedir(), '.aukora-symbiote'), 'convex', 'canon-ledger.json');

function readLedgerSafe(): CanonLedger {
  try {
    const raw = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf-8')) as Record<string, unknown>;
    const out: CanonLedger = {};
    for (const [k, v] of Object.entries(raw)) if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === 'string');
    return out;
  } catch {
    return {};
  }
}

function writeLedger(l: CanonLedger): void {
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(l, null, 2), { mode: 0o600 });
  fs.chmodSync(LEDGER_PATH, 0o600);
}

function resolveDocs(): string[] {
  const i = process.argv.indexOf('--docs');
  const list = i >= 0 ? process.argv.slice(i + 1).filter((a) => !a.startsWith('--')) : DEFAULT_CANON_DOCS;
  const out: string[] = [];
  for (const d of list) {
    const rel = d.replace(/^\.\//, '');
    // path boundary: repo canon only — docs/*.md (no subdir escapes) or README.md. Never identity.
    if (!(rel === 'README.md' || (/^docs\/[A-Za-z0-9._-]+\.md$/.test(rel)))) {
      console.error(`refused: ${d} is outside the canon boundary (docs/*.md or README.md only; the identity corpus is a separate owner decision per #62)`);
      process.exit(1);
    }
    const abs = path.join(REPO, rel);
    if (!fs.existsSync(abs)) { console.error(`refused: ${rel} does not exist`); process.exit(1); }
    out.push(rel);
  }
  return out;
}

function chunkAll(docs: string[]): { byDoc: Map<string, CanonChunk[]>; shaByDoc: Map<string, string>; dropped: number } {
  const byDoc = new Map<string, CanonChunk[]>();
  const shaByDoc = new Map<string, string>();
  let dropped = 0;
  for (const rel of docs) {
    const content = fs.readFileSync(path.join(REPO, rel), 'utf-8');
    shaByDoc.set(rel, createHash('sha256').update(content, 'utf8').digest('hex'));
    const { chunks, droppedForbidden } = chunkCanonDoc(rel, content);
    dropped += droppedForbidden;
    byDoc.set(rel, chunks);
  }
  return { byDoc, shaByDoc, dropped };
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (cmd !== 'plan' && cmd !== 'ingest') {
    console.log('usage: bun scripts/canonIngestCli.ts plan | ingest [--erase-superseded] [--docs docs/A.md ...]');
    return;
  }
  if (!isLoopbackUrl(URL)) { console.error(`refused: non-loopback backend URL ${URL} (local-only by law)`); process.exit(1); }

  const docs = resolveDocs();
  const { byDoc, shaByDoc, dropped } = chunkAll(docs);
  const total = [...byDoc.values()].reduce((n, c) => n + c.length, 0);
  console.log(`canon: ${docs.length} docs -> ${total} guarded chunks (${dropped} dropped by the forbidden-content law)`);

  const { ownerRecallByKey } = await import('./memoryRecallAdapter');
  const ledger = readLedgerSafe();
  const plan = await planCanonIngest(byDoc, ledger, ownerRecallByKey);
  console.log(`plan: ${plan.toWrite.length} to write · ${plan.toSkip.length} already present (identical) · ${plan.superseded.length} superseded`);
  for (const k of plan.superseded) console.log(`  superseded: ${k}`);
  if (cmd === 'plan') { console.log('DONE — plan only, nothing written.'); return; }

  const { ensureCaptureWriter } = await import('./captureSubjectAdapter');
  let ensured = await ensureCaptureWriter();
  if (!ensured.ok) { console.error(`refused: ${ensured.refused}`); process.exit(1); }
  let writer = ensured.writer;
  const invoke = createGovernedHttpInvoke({ url: writer.deploymentUrl });

  // best-effort local embedder: canon rows land WITH vectors when the daemon is up (R5c road).
  const { embedText, embedderHealth } = await import('./embedClient');
  const embedHealthy = (await embedderHealth()).ok;
  console.log(embedHealthy ? 'embedder: healthy — canon rows will carry vectors' : 'embedder: absent — canon rows land without vectors (backfill later; zero-egress law)');

  const report = await ingestCanonChunks(plan.toWrite, shaByDoc, {
    ownerRootId: writer.ownerRootId,
    deploymentUrl: writer.deploymentUrl,
    invoke,
    nextUse: async () => {
      try {
        return await writer.nextUse();
      } catch {
        // manifest exhausted/expired mid-ceremony: re-ceremony once and continue (resume-safe).
        const again = await ensureCaptureWriter();
        if (!again.ok) throw new Error(again.refused);
        writer = again.writer;
        return writer.nextUse();
      }
    },
    ...(embedHealthy ? { embed: (t: string) => embedText(t) } : {}),
  });

  console.log(`ingest: ${report.written.length} written · ${report.refused.length} refused · ${report.embedded} with vectors · ${report.embedRefused} embed-refused`);
  for (const r of report.refused) console.error(`  refuse ${r.key}: ${r.reason}`);

  if (process.argv.includes('--erase-superseded') && plan.superseded.length > 0) {
    const { eraseHead } = await import('../convex/aumlokMemory');
    const { signChainHeadV3 } = await import('../convex/aukoraSignedHead');
    const rootSeed = readOwnerSeedStrict();
    const adminKey = readAdminKeyStrict();
    let erased = 0;
    for (const key of plan.superseded) {
      const req = { v: 1, ownerRootId: writer.ownerRootId, key, eraseReason: 'canon superseded by re-ingest', timestamp: Date.now() };
      const ownerSig = await signChainHeadV3(rootSeed, await eraseHead(req), 'aumlokMemErase');
      const res = await fetch(`${URL}/api/mutation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Convex ${adminKey}` },
        body: JSON.stringify({ path: 'aumlokMemory:aumlokMemoryErase', args: { req, ownerSig }, format: 'json' }),
        signal: AbortSignal.timeout(30_000),
      });
      const parsed = JSON.parse(await res.text()) as { status?: string; value?: any };
      if (parsed.status === 'success' && parsed.value?.ok) erased += 1;
      else console.error(`  erase refused ${key}: ${parsed.value?.reason ?? parsed.status}`);
    }
    console.log(`superseded: ${erased}/${plan.superseded.length} erased (receipted tombstones).`);
  } else if (plan.superseded.length > 0) {
    console.log('superseded keys NOT erased (re-run with --erase-superseded, or erase individually).');
  }

  // ledger = what THIS ingest produced per doc (written + still-present skips)
  const newLedger: CanonLedger = { ...ledger };
  for (const [docPath, chunks] of byDoc.entries()) newLedger[docPath] = chunks.map((c) => c.key);
  writeLedger(newLedger);
  console.log(`DONE — canon shelf updated. Ledger: ${LEDGER_PATH}`);
  if (report.refused.length > 0) process.exit(1);
}

main().catch((e) => { console.error(`refused: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
