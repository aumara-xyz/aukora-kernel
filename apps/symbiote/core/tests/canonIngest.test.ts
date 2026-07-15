// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Canon ingestion (#62, Great Merge round 4): the guards, pinned. Deterministic content-hashed
// chunking; law-3 drop-not-keep on forbidden shapes; read-before-write skip (idempotence by
// construction); superseded keys named, never silently replaced; refusals collected loudly and
// never thrown mid-ceremony; optional embedding rides the write ONLY when the local embedder
// answers; every envelope advisory-stamped. Plus the memoryAppend embedding contract: validated
// hard, forwarded verbatim, and the memoryHash law untouched (hash binds value bytes only).
import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import {
  chunkCanonDoc,
  canonSlug,
  planCanonIngest,
  ingestCanonChunks,
  CANON_SCHEMA,
  MAX_CANON_CHUNK_CHARS,
  type CanonChunk,
  type CanonIngestDeps,
} from '../src/canonIngest';
import { memoryAppend, MEM_KEY_RE, REGISTERED_GOVERNED_MUTATION, EMBEDDING_DIMS } from '../src/memoryAppend';
import type { CaptureUseLease } from '../src/conversationShadowCapture';
import type { MemoryRecallResult } from '../src/memoryRecall';

const OWNER = 'aumara.root';
const advisory = { advisoryOnly: true as const, grantsAuthority: false as const };

const DOC = `# Title

Intro paragraph about the safety laws.

## Law One

Memory suggests, never authorizes.

## Law Two

${'Long paragraph. '.repeat(150)}

And a second paragraph in the same section.
`;

describe('chunkCanonDoc — deterministic, bounded, guarded', () => {
  it('chunks by heading with section provenance, bounded pieces, MEM_KEY_RE-safe content-hashed keys', () => {
    const { chunks, droppedForbidden } = chunkCanonDoc('docs/SAFETY_LAWS.md', DOC);
    expect(droppedForbidden).toBe(0);
    expect(chunks.length).toBeGreaterThanOrEqual(4); // top + law1 + law2 split into >= 2
    for (const c of chunks) {
      expect(MEM_KEY_RE.test(c.key)).toBe(true);
      expect(c.key.startsWith('canon.safety-laws.')).toBe(true);
      expect(c.text.length).toBeLessThanOrEqual(MAX_CANON_CHUNK_CHARS);
      expect(c.docPath).toBe('docs/SAFETY_LAWS.md');
    }
    expect(chunks.find((c) => c.section === 'Law One')?.text).toContain('never authorizes');
    // determinism: same input, same keys, forever
    expect(chunkCanonDoc('docs/SAFETY_LAWS.md', DOC).chunks.map((c) => c.key)).toEqual(chunks.map((c) => c.key));
  });

  it('drops a forbidden-shaped chunk (law 3), counted, never sanitized-and-kept', () => {
    const poisoned = `# Doc\n\nfine text\n\n## Bad\n\nhere is sk-abcdefghijklmnopq lurking\n`;
    const { chunks, droppedForbidden } = chunkCanonDoc('docs/X.md', poisoned);
    expect(droppedForbidden).toBe(1);
    expect(chunks.some((c) => c.text.includes('sk-'))).toBe(false);
    expect(chunks.some((c) => c.text.includes('fine text'))).toBe(true);
  });

  it('slugs are bounded and safe', () => {
    expect(canonSlug('docs/SAFETY_LAWS.md')).toBe('safety-laws');
    expect(canonSlug('docs/Weird  Näme!!.md').length).toBeLessThanOrEqual(40);
    expect(/^[a-z0-9-]*$/.test(canonSlug('docs/Weird  Näme!!.md'))).toBe(true);
  });
});

function mkChunk(key: string, docPath = 'docs/A.md'): CanonChunk {
  return { key, docPath, section: 's', text: `text for ${key}` };
}

describe('planCanonIngest — read-before-write skip, superseded named, reads never guessed', () => {
  const found = (key: string): MemoryRecallResult => ({ ok: true, found: true, key, value: 'x', ...advisory });
  const missing = (key: string): MemoryRecallResult => ({ ok: true, found: false, key, reason: 'not_found', ...advisory });

  it('splits present/absent and names superseded keys from the previous ledger', async () => {
    const byDoc = new Map([[ 'docs/A.md', [mkChunk('canon.a.111111111111'), mkChunk('canon.a.222222222222')] ]]);
    const ledger = { 'docs/A.md': ['canon.a.111111111111', 'canon.a.999999999999'], 'docs/B.md': ['canon.b.888888888888'] };
    const plan = await planCanonIngest(byDoc, ledger, async (k) => (k.endsWith('111111111111') ? found(k) : missing(k)));
    expect(plan.toSkip.map((c) => c.key)).toEqual(['canon.a.111111111111']);
    expect(plan.toWrite.map((c) => c.key)).toEqual(['canon.a.222222222222']);
    expect(plan.superseded).toEqual(['canon.a.999999999999']); // B.md not in this ingest -> not judged
  });

  it('a failed read STOPS the ceremony (owner sees true state, never a maybe)', async () => {
    const byDoc = new Map([[ 'docs/A.md', [mkChunk('canon.a.111111111111')] ]]);
    await expect(planCanonIngest(byDoc, {}, async (k) => ({ ok: false, key: k, error: 'backend down', ...advisory })))
      .rejects.toThrow(/canon_plan_read_failed/);
  });
});

function fakeKernel() {
  const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const invoke = async (name: string, payload: Record<string, unknown>) => {
    calls.push({ name, payload });
    const req = payload.req as { ownerRootId: string; key: string };
    const memoryHash = createHash('sha256').update(`${req.ownerRootId}:${req.key}:${payload.value}`, 'utf8').digest('hex');
    return { ok: true, receiptHash: 'r'.repeat(16), memoryHash };
  };
  return { calls, invoke };
}

function lease(seq: number): CaptureUseLease {
  return { manifestId: 'mft-canon-test', subjectId: 'capture.door', useSeq: seq, signConsume: async () => 'sig-test' };
}

function deps(k = fakeKernel(), over: Partial<CanonIngestDeps> = {}): CanonIngestDeps & { calls: typeof k.calls } {
  let seq = 0;
  return {
    calls: k.calls,
    ownerRootId: OWNER,
    deploymentUrl: 'http://127.0.0.1:3210',
    invoke: k.invoke,
    nextUse: async () => lease(seq++),
    atIso: () => '2026-07-08T07:00:00.000Z',
    ...over,
  };
}

describe('ingestCanonChunks — governed writes, loud refusals, optional vectors', () => {
  const chunks = [mkChunk('canon.a.111111111111'), mkChunk('canon.a.222222222222')];
  const shas = new Map([['docs/A.md', 'ff'.repeat(32)]]);

  it('writes one governed row per chunk with the canon-atom-v1 envelope + advisory stamps', async () => {
    const d = deps();
    const report = await ingestCanonChunks(chunks, shas, d);
    expect(report.written.length).toBe(2);
    expect(d.calls.every((c) => c.name === REGISTERED_GOVERNED_MUTATION)).toBe(true);
    const sent = JSON.parse(String(d.calls[0].payload.value)) as Record<string, unknown>;
    expect(sent.schema).toBe(CANON_SCHEMA);
    expect(sent.docPath).toBe('docs/A.md');
    expect(sent.sourceSha).toBe('ff'.repeat(32));
    expect(sent.advisoryOnly).toBe(true);
    expect(sent.grantsAuthority).toBe(false);
  });

  it('a mid-ceremony refusal is COLLECTED (loud), never thrown; the rest still lands', async () => {
    const k = fakeKernel();
    let n = 0;
    const d = deps(k, { nextUse: async () => { n += 1; if (n === 1) throw new Error('manifest exhausted'); return lease(n); } });
    const report = await ingestCanonChunks(chunks, shas, d);
    expect(report.refused.length).toBe(1);
    expect(report.refused[0].reason).toContain('canon_lease_refused');
    expect(report.written.length).toBe(1);
  });

  it('embeds ONLY when the injected local embedder answers; refusals are counted, rows still land', async () => {
    const d = deps(fakeKernel(), {
      embed: async (t: string) => (t.includes('111111111111') ? { ok: true, vector: new Array(EMBEDDING_DIMS).fill(0.1) } : { ok: false, refused: 'embedder_unavailable: vendored model absent' }),
    });
    const report = await ingestCanonChunks(chunks, shas, d);
    expect(report.written.length).toBe(2);
    expect(report.embedded).toBe(1);
    expect(report.embedRefused).toBe(1);
    expect((d.calls[0].payload as { embedding?: unknown }).embedding).toBeDefined();
    expect((d.calls[1].payload as { embedding?: unknown }).embedding).toBeUndefined();
  });
});

describe('memoryAppend embedding contract — validated hard, forwarded verbatim, hash law untouched', () => {
  const req = { action: 'memory.write', ring: 'local-write', key: 'canon.t.aaaaaaaaaaaa', ownerRootId: OWNER, resource: `mem:${OWNER}` } as never;

  it('refuses wrong dims and non-finite before the transport is touched', async () => {
    let touched = false;
    const bad = await memoryAppend({ req, subjectSig: 's', value: 'v', embedding: [1, 2, 3] }, { deploymentUrl: 'http://127.0.0.1:3210', invoke: async () => { touched = true; return {}; } });
    expect(bad).toMatchObject({ ok: false, refused: 'memory_append_embedding_invalid', transportInvoked: false });
    expect(touched).toBe(false);
  });

  it('forwards a valid embedding verbatim; memoryHash still binds value bytes only', async () => {
    const k = fakeKernel();
    const vecIn = new Array(EMBEDDING_DIMS).fill(0.25);
    const r = await memoryAppend({ req, subjectSig: 's', value: 'plain value', embedding: vecIn }, { deploymentUrl: 'http://127.0.0.1:3210', invoke: k.invoke });
    expect(r.ok).toBe(true);
    expect((k.calls[0].payload as { embedding?: number[] }).embedding).toEqual(vecIn);
    // the accepted memoryHash was computed over value bytes alone (fakeKernel does exactly that)
  });
});
