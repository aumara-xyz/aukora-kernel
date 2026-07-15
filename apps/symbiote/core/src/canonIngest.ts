// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * CANON INGESTION (#62, Great Merge round 4, #178) — the docs corpus becomes GUARDED GOVERNED
 * ATOMS, so recall finally has the real shelf issue #62 diagnosed as empty ("brain is 92% test
 * files — identity/doc corpus never ingested").
 *
 * What lands: bounded, heading-scoped chunks of the CURATED canon docs, written through the SAME
 * governed ceremony as captured turns (manifest → subject PoP → grant → V4 receipt → row), each
 * value a typed `canon-atom-v1` envelope carrying its provenance (docPath + section + source
 * hash) — so the why-trace layer renders "from canon-atom-v1 <key> · age" for free.
 *
 * The guards (each pinned by test):
 *   - LAW 3, drop-not-keep: a chunk that trips the forbidden-content nets (keys, PEM, long hex,
 *     sk- families) is DROPPED and counted, never sanitized-and-kept.
 *   - BOUNDED: chunk text hard-capped; oversections split on paragraph seams; empty chunks never
 *     travel.
 *   - CONTENT-HASHED KEYS: `canon.<slug>.<sha8>` — idempotent by construction (an unchanged
 *     chunk maps to an existing key and is SKIPPED via read-before-write; a changed doc yields
 *     new keys and the old ones are reported as SUPERSEDED for the owner's receipted erase —
 *     append-only store, no silent replacement, exactly the M4 skip-if-identical discipline).
 *   - NO identity corpus: #62 explicitly separates the PII-heavy identity anchors as an OWNER
 *     decision (they are already delivered via the anchor injection). This module ingests
 *     repo-canon docs only; the CLI enforces the path boundary.
 *   - Advisory only: every envelope carries advisoryOnly:true / grantsAuthority:false. Canon in
 *     the brain INFORMS recall; the docs' authority remains the docs'.
 *
 * Pure module: chunking and planning have zero IO; the orchestrator takes injected reader /
 * writer / embedder (the conversationShadowCapture precedent) so everything tests hermetically
 * and core/ stays convex-free. Historical note: #62's other fixes (self-map test-flood cap,
 * per-scope diversity cap in kiraBrain.recall) targeted the JSON brain and died with the R5b
 * step-4 cutover — the empty-shelf fix is the part that survives, reborn governed.
 */
import { createHash } from 'crypto';
import { memoryAppend, MEM_KEY_RE, type MemoryAppendDeps, type MemoryAppendResult } from './memoryAppend';
import type { CaptureUseLease } from './conversationShadowCapture';
import { FORBIDDEN_VALUE_RE } from './forbiddenContent';
import type { MemoryRecallResult } from './memoryRecall';

export const CANON_SCHEMA = 'canon-atom-v1' as const;
export const MAX_CANON_CHUNK_CHARS = 1_600; // supportQuote-friendly, a few paragraphs
export const MAX_CANON_SECTION_CHARS = 120;
const CANON_EXTRA_SECRET_RE = /\bsk-[A-Za-z0-9_-]{10,}/;

export interface CanonChunk {
  key: string; // canon.<slug>.<sha8> — MEM_KEY_RE-safe, content-addressed
  docPath: string;
  section: string; // nearest heading trail, bounded
  text: string;
}

export interface CanonValue {
  schema: typeof CANON_SCHEMA;
  at: string;
  docPath: string;
  section: string;
  sourceSha: string; // sha256 of the WHOLE source file at ingest time (provenance, not integrity)
  text: string;
  advisoryOnly: true;
  grantsAuthority: false;
}

const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/** `docs/SAFETY_LAWS.md` → `safety-laws` (bounded, MEM_KEY_RE-safe). */
export function canonSlug(docPath: string): string {
  const base = docPath.replace(/^.*\//, '').replace(/\.md$/i, '');
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return slug || 'doc';
}

/** Deterministic, guarded chunking: split on markdown headings, keep the heading trail as the
 *  section label, split oversize sections on blank-line seams, DROP forbidden-shaped chunks
 *  (counted, never kept). Pure — same input, same chunks, same keys, forever. */
export function chunkCanonDoc(docPath: string, content: string): { chunks: CanonChunk[]; droppedForbidden: number } {
  const slug = canonSlug(docPath);
  const lines = content.split('\n');
  const sections: Array<{ section: string; body: string[] }> = [{ section: '(top)', body: [] }];
  for (const line of lines) {
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) sections.push({ section: h[2].trim().slice(0, MAX_CANON_SECTION_CHARS), body: [] });
    else sections[sections.length - 1].body.push(line);
  }
  const chunks: CanonChunk[] = [];
  let droppedForbidden = 0;
  for (const s of sections) {
    const whole = s.body.join('\n').trim();
    if (!whole) continue;
    // split oversize sections on paragraph seams, greedily packing up to the cap
    const paras = whole.split(/\n\s*\n/);
    let piece = '';
    const pieces: string[] = [];
    for (const p of paras) {
      const next = piece ? `${piece}\n\n${p}` : p;
      if (next.length > MAX_CANON_CHUNK_CHARS && piece) { pieces.push(piece); piece = p; }
      else piece = next;
    }
    if (piece) pieces.push(piece);
    for (const raw of pieces) {
      const text = raw.length > MAX_CANON_CHUNK_CHARS ? raw.slice(0, MAX_CANON_CHUNK_CHARS) : raw; // single mega-paragraph: hard bound
      if (FORBIDDEN_VALUE_RE.test(text) || CANON_EXTRA_SECRET_RE.test(text)) { droppedForbidden += 1; continue; }
      const key = `canon.${slug}.${sha256(`${docPath}\n${s.section}\n${text}`).slice(0, 12)}`;
      if (!MEM_KEY_RE.test(key)) { droppedForbidden += 1; continue; } // unreachable by construction; belt-and-braces
      chunks.push({ key, docPath, section: s.section, text });
    }
  }
  return { chunks, droppedForbidden };
}

export interface CanonLedger {
  // docPath → the keys the LAST completed ingest wrote/kept for that doc (node-local; content-free)
  [docPath: string]: string[];
}

export interface CanonPlan {
  toWrite: CanonChunk[];
  toSkip: CanonChunk[]; // already present (content-identical by key construction)
  superseded: string[]; // keys from the previous ingest no longer produced — owner's receipted erase
}

/** Plan an ingest against reality: read-before-write per key (present = skip), and diff against
 *  the previous ledger to name superseded keys. Never guesses: a read failure is a thrown,
 *  ceremony-stopping error (an owner ceremony must see true state, not a maybe). */
export async function planCanonIngest(
  chunksByDoc: Map<string, CanonChunk[]>,
  previousLedger: CanonLedger,
  recallByKey: (key: string) => Promise<MemoryRecallResult>,
): Promise<CanonPlan> {
  const toWrite: CanonChunk[] = [];
  const toSkip: CanonChunk[] = [];
  const produced = new Set<string>();
  for (const chunks of chunksByDoc.values()) {
    for (const c of chunks) {
      produced.add(c.key);
      const read = await recallByKey(c.key);
      if (!read.ok) throw new Error(`canon_plan_read_failed at ${c.key}: ${read.error}`);
      if (read.found) toSkip.push(c);
      else toWrite.push(c);
    }
  }
  const superseded: string[] = [];
  for (const [docPath, keys] of Object.entries(previousLedger)) {
    if (!chunksByDoc.has(docPath)) continue; // docs not part of THIS ingest are not judged
    for (const k of keys) if (!produced.has(k)) superseded.push(k);
  }
  return { toWrite, toSkip, superseded };
}

export interface CanonIngestDeps {
  ownerRootId: string;
  deploymentUrl: string;
  invoke: MemoryAppendDeps['invoke'];
  nextUse: () => Promise<CaptureUseLease>;
  /** Optional LOCAL embedder: when healthy, each canon row lands WITH its 384-d vector (the R5c
   *  road fills at write time). Absent/refusing embedder = rows land without vectors, counted. */
  embed?: (text: string) => Promise<{ ok: true; vector: number[] } | { ok: false; refused: string }>;
  now?: () => number;
  atIso?: () => string;
}

export interface CanonIngestReport {
  written: Array<{ key: string; receiptHash: string }>;
  refused: Array<{ key: string; reason: string }>;
  embedded: number;
  embedRefused: number;
}

/** Write the planned chunks through the governed path, one row per chunk. Refusals are collected
 *  and reported (loud), never thrown — an owner watches the counts; a partial ingest is resumable
 *  by construction (re-run: present keys skip). */
export async function ingestCanonChunks(plan: CanonChunk[], sourceShaByDoc: Map<string, string>, deps: CanonIngestDeps): Promise<CanonIngestReport> {
  const report: CanonIngestReport = { written: [], refused: [], embedded: 0, embedRefused: 0 };
  for (const chunk of plan) {
    const value: CanonValue = {
      schema: CANON_SCHEMA,
      at: (deps.atIso ?? (() => new Date().toISOString()))(),
      docPath: chunk.docPath,
      section: chunk.section,
      sourceSha: sourceShaByDoc.get(chunk.docPath) ?? 'unknown',
      text: chunk.text,
      advisoryOnly: true,
      grantsAuthority: false,
    };
    let embedding: number[] | undefined;
    if (deps.embed) {
      const e = await deps.embed(chunk.text);
      if (e.ok) { embedding = e.vector; report.embedded += 1; }
      else report.embedRefused += 1;
    }
    let lease: CaptureUseLease;
    try {
      lease = await deps.nextUse();
    } catch (e) {
      report.refused.push({ key: chunk.key, reason: `canon_lease_refused:${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    const req = {
      action: 'memory.write' as const,
      ring: 'local-write' as const,
      key: chunk.key,
      ownerRootId: deps.ownerRootId,
      resource: `mem:${deps.ownerRootId}`,
      v: 1,
      manifestId: lease.manifestId,
      subjectId: lease.subjectId,
      intentCodec: 'json_action_v1',
      useSeq: lease.useSeq,
      timestamp: (deps.now ?? Date.now)(),
    };
    let subjectSig: string;
    try {
      subjectSig = await lease.signConsume(req);
    } catch (e) {
      report.refused.push({ key: chunk.key, reason: `canon_sign_failed:${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    const result: MemoryAppendResult = await memoryAppend(
      { req, subjectSig, value, ...(embedding ? { embedding } : {}) },
      { deploymentUrl: deps.deploymentUrl, invoke: deps.invoke },
    );
    if (result.ok) {
      try { lease.onSuccess?.(); } catch { /* seq bookkeeping never turns success into a throw */ }
      report.written.push({ key: result.key, receiptHash: result.receiptHash });
    } else {
      report.refused.push({ key: chunk.key, reason: result.refused });
    }
  }
  return report;
}

export function canonIngestGrantsAuthority(): false { return false; }
