// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// ONE CORE MEMORY (#45/#244) — the cross-surface proof. Three different surfaces (typed chat,
// heard presence, the self-mod outcome projection) write through the ONE governed append path and
// now IDENTIFY, inside their stored values, the same core instance and the same memory namespace.
// Hermetic: fake kernel, fake leases, no fs beyond the projection's own tmp journal, no network.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  buildTurnSummaryValue,
  captureTurn,
  withCoreStamp,
  MAX_TURN_SUMMARY_CHARS,
  type CaptureTurnDeps,
  type CaptureUseLease,
  type TurnSummaryValue,
} from '../src/conversationShadowCapture';
import { REGISTERED_GOVERNED_MUTATION } from '../src/memoryAppend';
import { buildCoreReceiptStamp, deriveCoreInstanceId, readCoreReceiptStamp } from '../src/coreMemoryEnvelope';
import { projectSelfModOutcomes } from '../src/selfModOutcomeProjection';
import { recordSignedAppliedDisposition } from '../src/proposalDispositionWrite';

const OWNER = 'aumara.root';
const URL = 'http://127.0.0.1:3210';
const AT = '2026-07-13T09:15:30.123Z';
const EXPECTED_CORE = deriveCoreInstanceId(URL, OWNER);

function fakeKernel() {
  const calls: Array<{ name: string; payload: { req: Record<string, unknown>; subjectSig: string; value: string } }> = [];
  const invoke = async (name: string, payload: { req: Record<string, unknown>; subjectSig: string; value: string }) => {
    calls.push({ name, payload });
    const req = payload.req as { ownerRootId: string; key: string };
    const memoryHash = createHash('sha256').update(`${req.ownerRootId}:${req.key}:${payload.value}`, 'utf8').digest('hex');
    return { ok: true, receiptHash: 'r'.repeat(16), memoryHash };
  };
  return { calls, invoke };
}

function lease(seq = 0): CaptureUseLease {
  return { manifestId: 'mft-core-test', subjectId: 'capture.door', useSeq: seq, signConsume: async () => 'sig-test' };
}

function deps(k = fakeKernel()): CaptureTurnDeps & { calls: typeof k.calls } {
  return { ownerRootId: OWNER, deploymentUrl: URL, invoke: k.invoke, nextUse: async () => lease(), calls: k.calls };
}

const TURN = {
  ownerText: 'Please remember: we decided the send button stays teal for the demo.',
  replyText: 'Understood — the send button stays teal; I will treat that as the decided color.',
  model: 'anthropic/claude-fable-5',
  at: AT,
  thread: 'sess.20260713t090000000z.ab12',
  sourceCommit: 'b973ffec1234',
};

describe('acceptance 1+2 — chat and presence write through one core path and SAY the same core + namespace', () => {
  it('a chat-door turn stamps coreInstanceId, namespace, origin, thread, commit', async () => {
    const d = deps();
    const r = await captureTurn({ ...TURN, origin: 'chat' }, d);
    expect(r.ok).toBe(true);
    expect(d.calls.length).toBe(1);
    expect(d.calls[0].name).toBe(REGISTERED_GOVERNED_MUTATION);
    const value = JSON.parse(d.calls[0].payload.value) as TurnSummaryValue;
    expect(value.origin).toBe('chat');
    const stamp = readCoreReceiptStamp(value.core);
    expect(stamp).not.toBeNull();
    if (!stamp) return;
    expect(stamp.coreInstanceId).toBe(EXPECTED_CORE);
    expect(stamp.namespace).toBe(`mem:${OWNER}`);
    expect(stamp.provenance).toBe('distilled-turn');
    expect(stamp.thread).toBe(TURN.thread);
    expect(stamp.sourceCommit).toBe('b973ffec1234');
    expect(stamp.advisoryOnly).toBe(true);
    expect(stamp.grantsAuthority).toBe(false);
  });

  it('a presence turn through the SAME deps carries the IDENTICAL core identity', async () => {
    const d = deps();
    const chat = await captureTurn({ ...TURN, origin: 'chat' }, d);
    const presence = await captureTurn({ ...TURN, origin: 'presence' }, d);
    expect(chat.ok && presence.ok).toBe(true);
    const [a, b] = d.calls.map((c) => readCoreReceiptStamp((JSON.parse(c.payload.value) as TurnSummaryValue).core));
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.coreInstanceId).toBe(b!.coreInstanceId);
    expect(a!.namespace).toBe(b!.namespace);
    expect(a!.thread).toBe(b!.thread); // one process boot = one thread; the DOOR is told apart by origin
    expect((JSON.parse(d.calls[0].payload.value) as TurnSummaryValue).origin).toBe('chat');
    expect((JSON.parse(d.calls[1].payload.value) as TurnSummaryValue).origin).toBe('presence');
  });

  it('a DIFFERENT deployment would stamp a DIFFERENT core id — divergence is detectable, not cosmetic', async () => {
    const k = fakeKernel();
    const d: CaptureTurnDeps = { ownerRootId: OWNER, deploymentUrl: 'http://127.0.0.1:9999', invoke: k.invoke, nextUse: async () => lease() };
    const r = await captureTurn({ ...TURN, origin: 'chat' }, d);
    expect(r.ok).toBe(true);
    const stamp = readCoreReceiptStamp((JSON.parse(k.calls[0].payload.value) as TurnSummaryValue).core);
    expect(stamp!.coreInstanceId).not.toBe(EXPECTED_CORE);
  });
});

describe('acceptance 1+2 — the self-mod outcome surface identifies the SAME core instance', () => {
  it('a signed_applied disposition projects with the same coreInstanceId + namespace as chat', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'one-core-selfmod-'));
    try {
      const appended = recordSignedAppliedDisposition(
        {
          proposalHash: 'a'.repeat(64),
          decidedAt: AT,
          commitSha: 'b973ffec',
          receiptHash: 'c'.repeat(64),
        },
        home,
      );
      expect(appended.ok).toBe(true);
      const k = fakeKernel();
      const result = await projectSelfModOutcomes(
        { ownerRootId: OWNER, deploymentUrl: URL, invoke: k.invoke, nextUse: async () => lease(), sourceCommit: 'b973ffec1234' },
        { homeDir: home },
      );
      expect(result.ok).toBe(true);
      expect(result.projected.length).toBe(1);
      const value = JSON.parse(k.calls[0].payload.value) as { core?: unknown; schema: string };
      expect(value.schema).toBe('self-mod-outcome-v1');
      const stamp = readCoreReceiptStamp(value.core);
      expect(stamp).not.toBeNull();
      if (!stamp) return;
      expect(stamp.coreInstanceId).toBe(EXPECTED_CORE); // == the chat door's id: one core, provable
      expect(stamp.namespace).toBe(`mem:${OWNER}`);
      expect(stamp.provenance).toBe('selfmod-outcome');
      expect(stamp.sourceCommit).toBe('b973ffec1234');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('the stamp can never cost a memory', () => {
  it('an invalid thread/commit is dropped and the turn still captures (origin-tag law extended)', async () => {
    const d = deps();
    const r = await captureTurn({ ...TURN, thread: 'NOT VALID', sourceCommit: 'nope', origin: 'chat' }, d);
    expect(r.ok).toBe(true);
    const stamp = readCoreReceiptStamp((JSON.parse(d.calls[0].payload.value) as TurnSummaryValue).core);
    expect(stamp).not.toBeNull();
    expect(stamp && 'thread' in stamp).toBe(false);
    expect(stamp && 'sourceCommit' in stamp).toBe(false);
  });

  it('withCoreStamp drops the STAMP (never the value) when the stamped bytes would exceed the cap', () => {
    const built = buildTurnSummaryValue(TURN);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const stamp = buildCoreReceiptStamp({ deploymentUrl: URL, ownerRootId: OWNER, provenance: 'distilled-turn', at: AT });
    expect(stamp).not.toBeNull();
    // Inflate the value to sit just under the cap so the stamp cannot fit.
    const nearCap: TurnSummaryValue = {
      ...built.value,
      atoms: [...built.value.atoms, { ...built.value.atoms[0], text: 'x'.repeat(MAX_TURN_SUMMARY_CHARS - JSON.stringify(built.value).length - 40) }],
    };
    const stamped = withCoreStamp(nearCap, stamp);
    expect(stamped).toBe(nearCap); // unstamped original travels — identification metadata never costs a memory
    // and the normal path stamps:
    expect(withCoreStamp(built.value, stamp).core).toEqual(stamp);
    expect(withCoreStamp(built.value, null)).toBe(built.value);
  });
});
