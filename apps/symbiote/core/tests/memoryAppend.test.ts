// Brick W3 — the single governed write path. These tests pin the THREE required properties
// before any live wiring exists:
//   1. "no direct write path"  — refusals never touch the transport; the happy path invokes
//      EXACTLY the one registered governed mutation, once; the write client refuses any
//      non-loopback deployment (CLOUD_DENY parity).
//   2. "ring/permission check required" — wrong ring/action/scope/key, or a missing subject
//      PoP signature, refuse pre-transport.
//   3. "decision token required" — the kernel mints+consumes the token inside the mutation;
//      when that gate refuses (aumlok_mem_no_authority), memoryAppend fails CLOSED with the
//      kernel's reason — no retry, no fallback store. (The token gate's own atomicity is
//      covered kernel-side in convex/tests/aumlokMemory.test.ts.)
// Every envelope — success or refusal — is stamped advisoryOnly:true / grantsAuthority:false.
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'crypto';
import {
  memoryAppend,
  canonicalMemoryValue,
  REGISTERED_GOVERNED_MUTATION,
  type MemoryAppendRequest,
} from '../src/memoryAppend';

const OWNER = 'root.alpha';
const goodReq = (over: Partial<MemoryAppendRequest> = {}): MemoryAppendRequest => ({
  action: 'memory.write',
  ring: 'local-write',
  key: 'note.one',
  ownerRootId: OWNER,
  resource: `mem:${OWNER}`,
  manifestId: 'mft.demo',
  timestamp: 1_751_700_000_000,
  useSeq: 0,
  ...over,
});

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

function kernelOkInvoke(captured: any[] = []) {
  return vi.fn(async (_name: string, payload: { req: Record<string, unknown>; subjectSig: string; value: string }) => {
    captured.push(payload);
    return {
      ok: true,
      receiptHash: 'rcpt_' + sha('chain'),
      memoryHash: sha(`${payload.req.ownerRootId}:${payload.req.key}:${payload.value}`),
    };
  });
}

const LOCAL = 'http://127.0.0.1:3210';

describe('W3 memoryAppend — no direct write path', () => {
  it('happy path invokes exactly the one registered governed mutation, once', async () => {
    const captured: any[] = [];
    const invoke = kernelOkInvoke(captured);
    const r = await memoryAppend(
      { req: goodReq(), subjectSig: 'sig', value: 'a quiet fact' },
      { deploymentUrl: LOCAL, invoke },
    );
    expect(r.ok).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).toBe(REGISTERED_GOVERNED_MUTATION);
    expect(REGISTERED_GOVERNED_MUTATION).toBe('aumlokMemory:aumlokMemoryWrite');
    // stamps ride the SUCCESS envelope too
    expect(r.advisoryOnly).toBe(true);
    expect(r.grantsAuthority).toBe(false);
  });

  it('a non-loopback deployment URL refuses BEFORE any transport (zero cloud on the write client)', async () => {
    for (const url of ['https://quirky-robin-188.convex.cloud', 'https://example.com:3210', 'http://192.168.1.5:3210']) {
      const invoke = kernelOkInvoke();
      const r = await memoryAppend({ req: goodReq(), subjectSig: 'sig', value: 'x' }, { deploymentUrl: url, invoke });
      expect(r).toMatchObject({ ok: false, refused: 'memory_append_nonloopback_refused', transportInvoked: false });
      expect(invoke).not.toHaveBeenCalled();
    }
  });

  it('the write path accepts no substitute result: missing receipt refuses, wrong hash refuses', async () => {
    const unreceipted = vi.fn(async () => ({ ok: true, memoryHash: sha(`${OWNER}:note.one:x`) }));
    const r1 = await memoryAppend({ req: goodReq(), subjectSig: 'sig', value: 'x' }, { deploymentUrl: LOCAL, invoke: unreceipted as any });
    expect(r1).toMatchObject({ ok: false, refused: 'memory_append_unreceipted', transportInvoked: true });

    const lying = vi.fn(async () => ({ ok: true, receiptHash: 'rcpt', memoryHash: sha('different bytes entirely') }));
    const r2 = await memoryAppend({ req: goodReq(), subjectSig: 'sig', value: 'x' }, { deploymentUrl: LOCAL, invoke: lying as any });
    expect(r2).toMatchObject({ ok: false, refused: 'memory_append_hash_mismatch', transportInvoked: true });
  });
});

describe('W3 memoryAppend — ring/permission check required', () => {
  const cases: Array<[string, Partial<MemoryAppendRequest>, string]> = [
    ['wrong ring', { ring: 'self-modify' as never }, 'memory_append_ring_refused'],
    ['wrong action', { action: 'file.write' as never }, 'memory_append_action_refused'],
    ['bad key grammar (colon would break the chainKey)', { key: 'a:b' }, 'memory_append_key_invalid'],
    ['resource scope mismatch', { resource: 'mem:someone.else' }, 'memory_append_resource_scope_refused'],
  ];
  for (const [name, over, code] of cases) {
    it(`${name} refuses pre-transport`, async () => {
      const invoke = kernelOkInvoke();
      const r = await memoryAppend({ req: goodReq(over), subjectSig: 'sig', value: 'x' }, { deploymentUrl: LOCAL, invoke });
      expect(r).toMatchObject({ ok: false, refused: code, transportInvoked: false, advisoryOnly: true, grantsAuthority: false });
      expect(invoke).not.toHaveBeenCalled();
    });
  }

  it('a missing subject PoP signature (the permission proof) refuses pre-transport', async () => {
    const invoke = kernelOkInvoke();
    const r = await memoryAppend({ req: goodReq(), subjectSig: '', value: 'x' }, { deploymentUrl: LOCAL, invoke });
    expect(r).toMatchObject({ ok: false, refused: 'memory_append_pop_missing', transportInvoked: false });
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('W3 memoryAppend — decision token required (kernel gate surfaces here, fail-closed)', () => {
  it('kernel no-authority (no decision token minted) refuses with the kernel reason and NO retry', async () => {
    const invoke = vi.fn(async () => { throw new Error('aumlok_mem_no_authority'); });
    const r = await memoryAppend({ req: goodReq(), subjectSig: 'sig', value: 'x' }, { deploymentUrl: LOCAL, invoke: invoke as any });
    expect(r).toMatchObject({
      ok: false,
      refused: 'memory_append_kernel_refused:aumlok_mem_no_authority',
      transportInvoked: true,
      advisoryOnly: true,
      grantsAuthority: false,
    });
    expect(invoke).toHaveBeenCalledTimes(1); // exactly one attempt — no retry loop, no fallback path
  });

  it('every other kernel refusal (spent use, stale PoP, manifest invalid) also fails closed', async () => {
    for (const kernelError of ['aumlok_mft_useseq_mismatch', 'aumlok_pop_stale', 'aumlok_manifest_revoked']) {
      const invoke = vi.fn(async () => { throw new Error(kernelError); });
      const r = await memoryAppend({ req: goodReq(), subjectSig: 'sig', value: 'x' }, { deploymentUrl: LOCAL, invoke: invoke as any });
      expect(r.ok).toBe(false);
      if (r.ok === false) expect(r.refused).toBe(`memory_append_kernel_refused:${kernelError}`);
    }
  });
});

describe('W3 canonical value bytes (deterministic JSON before hashing)', () => {
  it('key insertion order never changes the bytes or the hash', () => {
    const a = canonicalMemoryValue({ b: 1, a: { d: [3, 1], c: 'x' } });
    const b = canonicalMemoryValue({ a: { c: 'x', d: [3, 1] }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":"x","d":[3,1]},"b":1}'); // sorted keys, zero formatting whitespace
    expect(sha(a)).toBe(sha(b));
  });

  it('string values pass through verbatim (no double-encoding)', () => {
    expect(canonicalMemoryValue('already text')).toBe('already text');
  });

  it('values JSON cannot carry faithfully are refused, not silently mangled', async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalMemoryValue(cyclic)).toThrow();
    expect(() => canonicalMemoryValue(undefined)).toThrow();

    const invoke = kernelOkInvoke();
    const r = await memoryAppend({ req: goodReq(), subjectSig: 'sig', value: cyclic }, { deploymentUrl: LOCAL, invoke });
    expect(r).toMatchObject({ ok: false, refused: 'memory_append_value_uncanonical', transportInvoked: false });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('canonicalization matches the kernel stableStringify semantics on nested shapes', () => {
    // mirror of convex/aukoraCore.ts stableStringify: objects sorted recursively, arrays ordered
    const v = { z: [{ b: 2, a: 1 }], m: null, k: 'v' };
    expect(canonicalMemoryValue(v)).toBe('{"k":"v","m":null,"z":[{"a":1,"b":2}]}');
  });
});
