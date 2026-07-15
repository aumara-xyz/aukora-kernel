// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Self-mod outcome memory projection (issue #244, Round 8) — hermetic pins for every directive law:
// idempotency, tamper refusal, bounded metadata (no ownerNote/diff/secret leakage), governed-write-only
// structure, and the rule that a memory failure can never affect an already-successful signed apply.
// The journal rows come from the REAL writer (recordSignedAppliedDisposition) into a tmp home; the
// transport is a fake invoke that speaks memoryAppend's exact receipt contract.
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { recordSignedAppliedDisposition } from '../src/proposalDispositionWrite';
import { proposalDispositionJournalPath } from '../src/proposalDispositionRead';
import {
  SELF_MOD_OUTCOME_SCHEMA,
  selfModOutcomeKey,
  buildSelfModOutcomeValue,
  selfModOutcomeMarkerDir,
  projectSelfModOutcomes,
  type SelfModOutcomeTransport,
} from '../src/selfModOutcomeProjection';
import { MEM_KEY_RE, canonicalMemoryValue } from '../src/memoryAppend';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const OWNER = 'aumara.root';

function tmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'selfmod-outcome-'));
}

/** Fake transport speaking memoryAppend's exact contract: loopback URL, receipt + recomputed memoryHash. */
type InvokePayload = { req: Record<string, unknown>; subjectSig: string; value: string };
function fakeTransport(calls: Array<{ path: string; args: InvokePayload }>, opts: { refuse?: boolean } = {}): SelfModOutcomeTransport {
  let seq = 0;
  return {
    ownerRootId: OWNER,
    deploymentUrl: 'http://127.0.0.1:3210',
    invoke: async (p, payload) => {
      calls.push({ path: p, args: payload });
      if (opts.refuse) throw new Error('kernel says no (fake)');
      const req = payload.req as { ownerRootId: string; key: string };
      const memoryHash = createHash('sha256').update(`${req.ownerRootId}:${req.key}:${payload.value}`).digest('hex');
      return { ok: true, receiptHash: 'f'.repeat(64), memoryHash };
    },
    nextUse: async () => ({ manifestId: 'man-1', subjectId: 'subj-1', useSeq: seq++, signConsume: async () => 'fake-subject-sig' }),
  };
}

function writeDisposition(home: string, proposalHash: string, ownerNote?: string): void {
  const r = recordSignedAppliedDisposition({
    proposalHash,
    decidedAt: '2026-07-10T12:00:00.000Z',
    commitSha: 'abc1234',
    receiptHash: 'd'.repeat(64),
    ...(ownerNote ? { ownerNote } : {}),
  }, home);
  expect(r.ok).toBe(true);
}

describe('selfModOutcomeKey — deterministic, MEM_KEY_RE-safe', () => {
  it('is stable, 64 chars, and passes the governed key law', () => {
    const k = selfModOutcomeKey(HASH_A);
    expect(k).toBe(`selfmod.${'a'.repeat(56)}`);
    expect(k.length).toBe(64);
    expect(MEM_KEY_RE.test(k)).toBe(true);
    expect(selfModOutcomeKey(HASH_A)).toBe(k);
  });
});

describe('buildSelfModOutcomeValue — bounded allow-list, never more', () => {
  const ROW = {
    schema: 'proposal-disposition-v1', proposalHash: HASH_A, disposition: 'signed_applied',
    decidedAt: '2026-07-10T12:00:00.000Z', commitSha: 'abc1234', receiptHash: 'd'.repeat(64),
    ownerNote: 'PRIVATE: my real reason', advisoryOnly: true, grantsAuthority: false, artifactHash: 'e'.repeat(64),
  } as never;

  it('carries ONLY disposition, hash, decidedAt, commitSha, receiptHash + advisory stamps', () => {
    const r = buildSelfModOutcomeValue(ROW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      schema: SELF_MOD_OUTCOME_SCHEMA,
      proposalHash: HASH_A,
      disposition: 'signed_applied',
      decidedAt: '2026-07-10T12:00:00.000Z',
      commitSha: 'abc1234',
      receiptHash: 'd'.repeat(64),
      advisoryOnly: true,
      grantsAuthority: false,
    });
  });

  it("the owner-private ownerNote NEVER travels — not even as a key", () => {
    const r = buildSelfModOutcomeValue(ROW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.stringify(r.value)).not.toContain('PRIVATE');
    expect(Object.keys(r.value)).not.toContain('ownerNote');
    expect(Object.keys(r.value)).not.toContain('artifactHash');
  });

  it('refuses non-signed_applied dispositions (rejected/shelved/superseded are journal-only)', () => {
    for (const d of ['rejected', 'shelved', 'superseded']) {
      const r = buildSelfModOutcomeValue({ ...(ROW as object), disposition: d } as never);
      expect(r.ok).toBe(false);
    }
  });

  it('refuses a malformed hash or decidedAt (tampered row shapes)', () => {
    expect(buildSelfModOutcomeValue({ ...(ROW as object), proposalHash: 'not-hex' } as never).ok).toBe(false);
    expect(buildSelfModOutcomeValue({ ...(ROW as object), decidedAt: 'x'.repeat(41) } as never).ok).toBe(false);
  });
});

describe('projectSelfModOutcomes — the drain', () => {
  let home: string;
  beforeEach(() => { home = tmpHome(); });

  it('projects a signed_applied journal row through the governed transport, once, receipted', async () => {
    writeDisposition(home, HASH_A, 'PRIVATE: never travels');
    const calls: Array<{ path: string; args: InvokePayload }> = [];
    const r = await projectSelfModOutcomes(fakeTransport(calls), { homeDir: home });
    expect(r.ok).toBe(true);
    expect(r.projected).toHaveLength(1);
    expect(r.projected[0].key).toBe(selfModOutcomeKey(HASH_A));
    expect(calls).toHaveLength(1);
    // governed-write-only structure: the ONE registered mutation road, exact req shape
    expect(calls[0].args.subjectSig).toBe('fake-subject-sig');
    const req = calls[0].args.req as Record<string, unknown>;
    expect(req.action).toBe('memory.write');
    expect(req.ring).toBe('local-write');
    expect(req.resource).toBe(`mem:${OWNER}`);
    // no secret/diff/note leakage in the actual bytes that traveled
    expect(String(calls[0].args.value)).not.toContain('PRIVATE');
  });

  it('IDEMPOTENT: the second drain writes nothing (marker), even across fresh transports', async () => {
    writeDisposition(home, HASH_A);
    const calls1: never[] = [];
    await projectSelfModOutcomes(fakeTransport(calls1), { homeDir: home });
    const calls2: Array<{ path: string; args: InvokePayload }> = [];
    const r2 = await projectSelfModOutcomes(fakeTransport(calls2), { homeDir: home });
    expect(calls2).toHaveLength(0);
    expect(r2.alreadyProjected).toBe(1);
    expect(fs.existsSync(path.join(selfModOutcomeMarkerDir(home), `${HASH_A}.json`))).toBe(true);
  });

  it('a REFUSED write leaves no marker and is retried on the next drain — loud, never thrown', async () => {
    writeDisposition(home, HASH_A);
    const r1 = await projectSelfModOutcomes(fakeTransport([], { refuse: true }), { homeDir: home });
    expect(r1.ok).toBe(false);
    expect(r1.refused).toHaveLength(1);
    expect(r1.refused[0].reason).toContain('kernel');
    expect(fs.existsSync(path.join(selfModOutcomeMarkerDir(home), `${HASH_A}.json`))).toBe(false);
    const calls: Array<{ path: string; args: InvokePayload }> = [];
    const r2 = await projectSelfModOutcomes(fakeTransport(calls), { homeDir: home });
    expect(r2.projected).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it('TAMPERED journal → reader refuses → nothing projects (fail-closed)', async () => {
    writeDisposition(home, HASH_A);
    const jp = proposalDispositionJournalPath(home);
    const tampered = JSON.parse(fs.readFileSync(jp, 'utf-8').trim());
    tampered.commitSha = '9999999'; // silently edited closure — artifactHash no longer matches
    fs.writeFileSync(jp, JSON.stringify(tampered) + '\n');
    const calls: never[] = [];
    const r = await projectSelfModOutcomes(fakeTransport(calls), { homeDir: home });
    expect(calls).toHaveLength(0);
    expect(r.projected).toHaveLength(0);
  });

  it('projects each proposal once each — two applies, two rows, stable keys', async () => {
    writeDisposition(home, HASH_A);
    writeDisposition(home, HASH_B);
    const calls: Array<{ path: string; args: InvokePayload }> = [];
    const r = await projectSelfModOutcomes(fakeTransport(calls), { homeDir: home });
    expect(r.projected.map((p) => p.proposalHash).sort()).toEqual([HASH_A, HASH_B]);
    expect(calls).toHaveLength(2);
  });

  it('an empty/absent journal is an honest empty drain, not an error', async () => {
    const r = await projectSelfModOutcomes(fakeTransport([]), { homeDir: home });
    expect(r.ok).toBe(true);
    expect(r.projected).toHaveLength(0);
    expect(r.journalRefused).toBeNull();
  });

  it('the value that travels is canonical-codec clean (kernel-acceptable bytes)', async () => {
    writeDisposition(home, HASH_A);
    const calls: Array<{ path: string; args: InvokePayload }> = [];
    await projectSelfModOutcomes(fakeTransport(calls), { homeDir: home });
    expect(() => canonicalMemoryValue(JSON.parse(String(calls[0].args.value)))).not.toThrow();
  });
});

describe('structural pins — the apply lane is untouched and untouchable from here', () => {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf-8');

  it('nativeLiveApply.ts does not know the projection exists (directive rule 3)', () => {
    const src = read('core/src/nativeLiveApply.ts');
    expect(src).not.toContain('selfModOutcome');
    expect(src).not.toContain('SelfModOutcome');
  });

  it('the projection core imports NOTHING from the signing/apply lane', () => {
    const src = read('core/src/selfModOutcomeProjection.ts');
    expect(src).not.toMatch(/from '\.\/(nativeLiveApply|aumlokApproveCeremony|aumlokAuthorityRoot|aumlokSigner)'/);
  });

  it('the door fires the projection AFTER the apply result is decided, fire-and-forget (void)', () => {
    const src = read('spatial/aumlok-approve-serve.ts');
    expect(src).toContain('void projectSelfModOutcomesNow()');
    const applyIdx = src.indexOf('approveAndApplyProposal(hash');
    const projIdx = src.indexOf('void projectSelfModOutcomesNow()');
    expect(applyIdx).toBeGreaterThan(0);
    expect(projIdx).toBeGreaterThan(applyIdx);
  });

  it('a bound approval door inherits the same shadow-capture gate as the node', () => {
    const src = read('scripts/start-node.ts');
    expect(src).toContain("startIfDown('aumlok-approve', 'aumlok-approve-serve.ts', APPROVE_PORT, { env: boundNodeEnv })");
  });
});
