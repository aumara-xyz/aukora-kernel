// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
// Hermetic tests for the pure shadow-capture orchestrator (no backend, no fs, no network):
// the directive's acceptance list — one governed invoke per completed turn, refusals never throw,
// forbidden content never travels, zero atoms → zero writes, advisory pins on every envelope.
import { describe, it, expect } from 'vitest';
import {
  buildTurnSummaryValue,
  captureTurn,
  makeTurnKey,
  MAX_TURN_SUMMARY_CHARS,
  TURN_SUMMARY_SCHEMA,
  type CaptureTurnDeps,
  type CaptureUseLease,
} from '../src/conversationShadowCapture';
import { MEM_KEY_RE, REGISTERED_GOVERNED_MUTATION } from '../src/memoryAppend';
import { createHash } from 'crypto';

const OWNER = 'aumara.root';
const AT = '2026-07-07T21:15:30.123Z';

function goodInput(overrides: Partial<Parameters<typeof buildTurnSummaryValue>[0]> = {}) {
  return {
    ownerText: 'Please remember: we decided the send button stays teal for the demo.',
    replyText: 'Understood — the send button stays teal; I will treat that as the decided color.',
    model: 'anthropic/claude-fable-5',
    at: AT,
    ...overrides,
  };
}

/** A well-behaved fake kernel: records calls, returns the envelope memoryAppend expects. */
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

function lease(seq = 0, onSuccess?: () => void): CaptureUseLease {
  return {
    manifestId: 'mft-capture-test',
    subjectId: 'capture.door',
    useSeq: seq,
    signConsume: async () => 'sig-test',
    onSuccess,
  };
}

function deps(overrides: Partial<CaptureTurnDeps> = {}): CaptureTurnDeps {
  const k = fakeKernel();
  return {
    ownerRootId: OWNER,
    deploymentUrl: 'http://127.0.0.1:3210',
    invoke: k.invoke,
    nextUse: async () => lease(),
    ...overrides,
  };
}

describe('buildTurnSummaryValue — distilled, bounded, advisory', () => {
  it('builds a turn-summary-v1 with distilled atoms for both speech acts', () => {
    const r = buildTurnSummaryValue(goodInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.schema).toBe(TURN_SUMMARY_SCHEMA);
    expect(r.value.at).toBe(AT);
    expect(r.value.advisoryOnly).toBe(true);
    expect(r.value.grantsAuthority).toBe(false);
    expect(r.value.atoms.length).toBeGreaterThan(0);
    expect(r.value.atoms.length).toBeLessThanOrEqual(4);
    for (const a of r.value.atoms) {
      expect(a.advisoryOnly).toBe(true);
      expect(a.grantsAuthority).toBe(false);
      expect(a.text.length).toBeLessThanOrEqual(280);
    }
  });

  it('zero summary-worthy content is a typed refusal (write nothing), not an empty value', () => {
    const r = buildTurnSummaryValue(goodInput({ ownerText: 'hi', replyText: 'yo' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refused).toBe('capture_zero_atoms');
    expect(r.advisoryOnly).toBe(true);
    expect(r.grantsAuthority).toBe(false);
  });

  it('an sk- key / 64-hex run / attachment-style secret never appears in the built value', () => {
    const secretKey = 'sk-or-v1-' + 'a1b2c3d4'.repeat(4);
    const hexRun = 'f'.repeat(64);
    const r = buildTurnSummaryValue(
      goodInput({
        ownerText: `here is my key ${secretKey} please keep it safe for me forever`,
        replyText: `I noticed a long value ${hexRun} in what you pasted, storing it now as requested.`,
      }),
    );
    // both atoms are forbidden-shaped → dropped → zero atoms → REFUSED, nothing travels.
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refused).toBe('capture_zero_atoms');
  });

  it('a clean turn alongside a forbidden one keeps only the clean atom', () => {
    const secretKey = 'sk-or-v1-' + 'a1b2c3d4'.repeat(4);
    const r = buildTurnSummaryValue(
      goodInput({ ownerText: `store this secret ${secretKey} in your memory please and thanks` }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const joined = JSON.stringify(r.value);
    expect(joined).not.toContain(secretKey);
    expect(joined).not.toContain('sk-or-v1');
  });

  it('caps the total value size', () => {
    // 4 atoms × ≤280 chars + metadata sits far under the cap; the cap itself is the contract.
    const r = buildTurnSummaryValue(goodInput({ ownerText: 'x'.repeat(39_000) + ' decided.' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.stringify(r.value).length).toBeLessThanOrEqual(MAX_TURN_SUMMARY_CHARS);
  });
});

describe('makeTurnKey — MEM_KEY_RE-safe, unique per seq', () => {
  it('builds a lowercase regex-safe key from ISO time + seq', () => {
    const k = makeTurnKey(AT, 7);
    expect(k).toBe('turn.20260707t211530123z.7');
    expect(MEM_KEY_RE.test(k)).toBe(true);
  });
  it('two seqs at the same instant never collide', () => {
    expect(makeTurnKey(AT, 1)).not.toBe(makeTurnKey(AT, 2));
  });
});

describe('captureTurn — one governed invoke, refusals never throw, advisory pins', () => {
  it('a completed turn calls the injected invoke EXACTLY once with the governed path + scoped req', async () => {
    const k = fakeKernel();
    const r = await captureTurn(goodInput(), deps({ invoke: k.invoke }));
    expect(r.ok).toBe(true);
    expect(k.calls.length).toBe(1);
    expect(k.calls[0].name).toBe(REGISTERED_GOVERNED_MUTATION);
    const req = k.calls[0].payload.req as Record<string, unknown>;
    expect(MEM_KEY_RE.test(String(req.key))).toBe(true);
    expect(req.resource).toBe(`mem:${OWNER}`);
    expect(req.ownerRootId).toBe(OWNER);
    expect(req.action).toBe('memory.write');
    expect(req.ring).toBe('local-write');
    expect(req.manifestId).toBe('mft-capture-test');
    expect(req.intentCodec).toBe('json_action_v1');
  });

  it('an invoke throw yields a refused envelope and never throws to the caller', async () => {
    const r = await captureTurn(
      goodInput(),
      deps({ invoke: async () => { throw new Error('aumlok_mem_no_authority'); } }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refused).toContain('aumlok_mem_no_authority');
    expect(r.transportInvoked).toBe(true);
    expect(r.advisoryOnly).toBe(true);
    expect(r.grantsAuthority).toBe(false);
  });

  it('zero-atom distillation → NO invoke call (write nothing, surface the refusal)', async () => {
    const k = fakeKernel();
    const r = await captureTurn(goodInput({ ownerText: 'ok', replyText: 'ok' }), deps({ invoke: k.invoke }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refused).toBe('capture_zero_atoms');
    expect(k.calls.length).toBe(0);
  });

  it('an all-forbidden turn writes NOTHING', async () => {
    const k = fakeKernel();
    const secretKey = 'sk-or-v1-' + 'a1b2c3d4'.repeat(4);
    const hexRun = 'e'.repeat(64);
    const r = await captureTurn(
      goodInput({
        ownerText: `my key is ${secretKey} and you must remember it exactly as written`,
        replyText: `the digest you asked about is ${hexRun} and I am repeating it back now`,
      }),
      deps({ invoke: k.invoke }),
    );
    expect(r.ok).toBe(false);
    expect(k.calls.length).toBe(0);
  });

  it('forbidden fragments never appear in the written value even when a clean atom travels', async () => {
    const k = fakeKernel();
    const secretKey = 'sk-or-v1-' + 'a1b2c3d4'.repeat(4);
    const r = await captureTurn(
      goodInput({ ownerText: `keep this safe: ${secretKey} — write it into your permanent memory` }),
      deps({ invoke: k.invoke }),
    );
    expect(r.ok).toBe(true);
    expect(k.calls.length).toBe(1);
    expect(k.calls[0].payload.value).not.toContain(secretKey);
    expect(k.calls[0].payload.value).not.toContain('sk-or-v1');
  });

  it('a nextUse rejection is a typed refusal, not a throw', async () => {
    const r = await captureTurn(
      goodInput(),
      deps({ nextUse: async () => { throw new Error('capture_manifest_exhausted'); } }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refused).toContain('capture_lease_refused');
    expect(r.refused).toContain('capture_manifest_exhausted');
  });

  it('a signConsume rejection is a typed refusal, not a throw', async () => {
    const badLease: CaptureUseLease = { ...lease(), signConsume: async () => { throw new Error('seed unavailable'); } };
    const r = await captureTurn(goodInput(), deps({ nextUse: async () => badLease }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refused).toContain('capture_sign_failed');
  });

  it('onSuccess fires exactly on kernel acceptance (seq advances only on success)', async () => {
    let advanced = 0;
    const k = fakeKernel();
    const r = await captureTurn(goodInput(), deps({ invoke: k.invoke, nextUse: async () => lease(0, () => { advanced++; }) }));
    expect(r.ok).toBe(true);
    expect(advanced).toBe(1);
    let advanced2 = 0;
    const r2 = await captureTurn(
      goodInput(),
      deps({ invoke: async () => { throw new Error('kernel down'); }, nextUse: async () => lease(0, () => { advanced2++; }) }),
    );
    expect(r2.ok).toBe(false);
    expect(advanced2).toBe(0);
  });

  it('advisory pins ride every envelope (success and refusal)', async () => {
    const okRes = await captureTurn(goodInput(), deps());
    const badRes = await captureTurn(goodInput({ ownerText: 'no', replyText: 'no' }), deps());
    for (const r of [okRes, badRes]) {
      expect(r.advisoryOnly).toBe(true);
      expect(r.grantsAuthority).toBe(false);
    }
  });
});
